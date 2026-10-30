-- ============================================================================
-- Migration: 20261030000001_razorpay_gateway_hardening.sql
-- Description: Phase 1 Razorpay Gateway Hardening
--              1. Pre-validation and partial unique index on payment_attempts.razorpay_payment_id
--              2. Webhook event deduplication table (webhook_events) with audit tracking
--              3. Dynamic environment configuration in record_payment_attempt
--              4. Webhook event deduplication and out-of-order handling in reconcile_webhook_payment
--              5. Dynamic environment metadata in fund_milestone_with_payment
--              6. Safe webhook failure and receipt recording helper functions
-- ============================================================================

-- ============================================================================
-- 1. PAYMENT ID INTEGRITY: PARTIAL UNIQUE INDEX ON payment_attempts
-- ============================================================================

-- Pre-check: Ensure no duplicate non-null payment IDs exist before adding constraint
DO $$
DECLARE
    v_dup_count integer;
BEGIN
    SELECT count(*) INTO v_dup_count
    FROM (
        SELECT razorpay_payment_id
        FROM public.payment_attempts
        WHERE razorpay_payment_id IS NOT NULL
        GROUP BY razorpay_payment_id
        HAVING count(*) > 1
    ) dups;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'Cannot create unique index on payment_attempts(razorpay_payment_id): % duplicate payment ID(s) found in existing data', v_dup_count
            USING ERRCODE = '23505';
    END IF;
END $$;

-- Add partial unique index: ensures one Razorpay payment cannot be assigned to multiple attempts
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_razorpay_payment_id
    ON public.payment_attempts(razorpay_payment_id)
    WHERE razorpay_payment_id IS NOT NULL;

-- ============================================================================
-- 2. WEBHOOK EVENT DEDUPLICATION TABLE (webhook_events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id text UNIQUE NOT NULL,
    event_type text NOT NULL,
    provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'simulated')),
    environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
    payload_hash text NOT NULL,
    status text NOT NULL DEFAULT 'received' CONSTRAINT chk_webhook_event_status CHECK (
        status IN ('received', 'processing', 'processed', 'failed', 'ignored')
    ),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error_details jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.webhook_events IS 'Idempotent delivery log and deduplication ledger for gateway webhooks.';

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON public.webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type_status ON public.webhook_events(event_type, status);

-- Strict RLS: Revoke from public/anon/authenticated; granted strictly to service_role
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_events TO service_role;

CREATE POLICY webhook_events_service_role
    ON public.webhook_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Ensure service_role has read permissions on payment_ledger for reconciliation audits
GRANT SELECT ON public.payment_ledger TO service_role;

-- ============================================================================
-- 3. PROCEDURE: RECORD PAYMENT ATTEMPT (Dynamic Environment Support)
-- ============================================================================

DROP FUNCTION IF EXISTS public.record_payment_attempt(uuid, text, numeric, bigint, text, jsonb);

CREATE OR REPLACE FUNCTION public.record_payment_attempt(
    p_milestone_id uuid,
    p_razorpay_order_id text,
    p_amount numeric,
    p_amount_subunits bigint,
    p_currency text,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_environment text DEFAULT 'test'
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_attempt public.payment_attempts;
    v_env text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Validate environment parameter
    v_env := lower(trim(COALESCE(p_environment, 'test')));
    IF v_env NOT IN ('test', 'live') THEN
        RAISE EXCEPTION 'Invalid environment "%". Supported environments are "test" and "live"', v_env
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Validate client authorization
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can record payment attempts for this milestone' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validate milestone status
    IF v_milestone.status <> 'planned' THEN
        RAISE EXCEPTION 'Cannot create payment attempt for milestone in status "%"', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Validate amount matches milestone exactly
    IF v_milestone.amount <> p_amount THEN
        RAISE EXCEPTION 'Payment attempt amount (%) does not match milestone amount (%)', p_amount, v_milestone.amount
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_attempts (
        contract_id,
        milestone_id,
        client_id,
        provider,
        environment,
        razorpay_order_id,
        amount,
        amount_subunits,
        currency,
        status,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_actor_id,
        'razorpay',
        v_env,
        trim(p_razorpay_order_id),
        p_amount,
        p_amount_subunits,
        upper(trim(p_currency)),
        'created',
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('environment', v_env)
    )
    RETURNING * INTO v_attempt;

    RETURN v_attempt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_payment_attempt FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_attempt TO authenticated;

-- ============================================================================
-- 4. PROCEDURE: RECONCILE WEBHOOK PAYMENT (Hardened with Deduplication)
-- ============================================================================

DROP FUNCTION IF EXISTS public.reconcile_webhook_payment(uuid, text, text, bigint, text, jsonb);

CREATE OR REPLACE FUNCTION public.reconcile_webhook_payment(
    p_milestone_id uuid,
    p_razorpay_order_id text,
    p_razorpay_payment_id text DEFAULT NULL,
    p_amount_subunits bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb,
    p_event_id text DEFAULT NULL,
    p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.payment_attempts;
    v_milestone public.contract_milestones;
    v_webhook_event public.webhook_events;
    v_desc text;
    v_event_type text;
    v_environment text;
BEGIN
    -- Strict least-privilege authorization check: caller must be service_role or superuser/postgres
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reconcile_webhook_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    -- Fail-closed parameter validation
    IF p_milestone_id IS NULL THEN
        RAISE EXCEPTION 'Milestone ID cannot be null' USING ERRCODE = '22023';
    END IF;

    IF p_razorpay_order_id IS NULL OR trim(p_razorpay_order_id) = '' THEN
        RAISE EXCEPTION 'Razorpay order ID cannot be null or empty' USING ERRCODE = '22023';
    END IF;

    v_event_type := COALESCE(p_payment_metadata->>'event', 'payment.captured');
    v_environment := COALESCE(p_payment_metadata->>'environment', 'test');

    -- ========================================================================
    -- Webhook Event Deduplication Check
    -- ========================================================================
    IF p_event_id IS NOT NULL AND trim(p_event_id) <> '' THEN
        SELECT * INTO v_webhook_event
          FROM public.webhook_events
         WHERE event_id = trim(p_event_id)
           FOR UPDATE;

        IF FOUND THEN
            -- Event already fully processed previously: return idempotent success immediately
            IF v_webhook_event.status = 'processed' THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'idempotent', true,
                    'event_id', p_event_id,
                    'status', 'already_processed',
                    'message', 'Webhook event already processed previously'
                );
            END IF;

            -- If previous attempt failed or was received, mark as processing
            UPDATE public.webhook_events
               SET status = 'processing',
                   metadata = metadata || jsonb_build_object('retried_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        ELSE
            -- Record new incoming event in 'processing' status
            INSERT INTO public.webhook_events (
                event_id,
                event_type,
                provider,
                environment,
                payload_hash,
                status,
                metadata
            ) VALUES (
                trim(p_event_id),
                v_event_type,
                'razorpay',
                v_environment,
                COALESCE(p_payload_hash, 'none'),
                'processing',
                jsonb_build_object(
                    'order_id', trim(p_razorpay_order_id),
                    'payment_id', p_razorpay_payment_id,
                    'milestone_id', p_milestone_id
                )
            ) RETURNING * INTO v_webhook_event;
        END IF;
    END IF;

    -- Strict atomic row lock on payment_attempts to eliminate race conditions
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE milestone_id = p_milestone_id
       AND razorpay_order_id = trim(p_razorpay_order_id)
       FOR UPDATE;

    IF NOT FOUND THEN
        -- Record failure in webhook_events if event_id is tracked
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Payment attempt not found for order')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Payment attempt not found for milestone % and order %', p_milestone_id, p_razorpay_order_id
            USING ERRCODE = '23503';
    END IF;

    -- Strict fail-closed validation of payment amount against persisted attempt
    IF p_amount_subunits IS NOT NULL AND v_attempt.amount_subunits <> p_amount_subunits THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Amount mismatch')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Webhook amount (% subunits) does not match persisted attempt (% subunits)', p_amount_subunits, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    -- Strict fail-closed validation of payment currency against persisted attempt
    IF p_currency IS NOT NULL AND upper(trim(v_attempt.currency)) <> upper(trim(p_currency)) THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Currency mismatch')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Webhook currency (%) does not match persisted attempt (%)', p_currency, v_attempt.currency
            USING ERRCODE = '22023';
    END IF;

    -- Strict atomic row lock on contract_milestones
    SELECT * INTO v_milestone
      FROM public.contract_milestones
     WHERE id = p_milestone_id
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Milestone not found')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Milestone % not found', p_milestone_id
            USING ERRCODE = '23503';
    END IF;

    -- Database-level idempotency: if milestone is already funded or attempt is already captured, exit cleanly
    IF v_milestone.status = 'funded' OR v_attempt.status = 'captured' THEN
        -- Update payment ID on attempt if it was missing and is now provided
        IF p_razorpay_payment_id IS NOT NULL AND v_attempt.razorpay_payment_id IS NULL THEN
            UPDATE public.payment_attempts
               SET razorpay_payment_id = p_razorpay_payment_id,
                   updated_at = clock_timestamp()
             WHERE id = v_attempt.id;
        END IF;

        -- Mark webhook event as processed
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'processed',
                   processed_at = clock_timestamp()
             WHERE id = v_webhook_event.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', v_milestone.status,
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'razorpay_order_id', v_attempt.razorpay_order_id,
            'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id),
            'message', 'Milestone already funded or attempt already captured'
        );
    END IF;

    -- Fail-closed if milestone is in any unexpected state other than 'planned'
    IF v_milestone.status <> 'planned' THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Unexpected milestone status ' || v_milestone.status)
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Milestone % is in state "%" and cannot be funded via webhook', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Transition milestone status to 'funded'
    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    -- Update payment attempt to 'captured'
    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = COALESCE(p_razorpay_payment_id, razorpay_payment_id),
           metadata = metadata || COALESCE(p_payment_metadata, '{}'::jsonb),
           updated_at = clock_timestamp()
     WHERE id = v_attempt.id;

    -- Dynamic environment description
    v_desc := 'Escrow Funded via Razorpay' || 
              CASE WHEN v_attempt.environment = 'test' THEN ' (Test Mode)' ELSE '' END || 
              ' (Webhook): Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';

    -- Record append-only escrow deposit ledger entry
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_milestone.client_id,
        NULL,
        v_milestone.amount,
        v_milestone.currency,
        'escrow_funded',
        'succeeded',
        v_desc,
        jsonb_build_object(
            'provider', 'razorpay',
            'source', 'webhook',
            'environment', v_attempt.environment,
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'razorpay_order_id', v_attempt.razorpay_order_id,
            'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id),
            'captured_amount', v_attempt.amount_subunits,
            'captured_currency', v_attempt.currency,
            'event_id', p_event_id,
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    -- Mark webhook event as processed
    IF v_webhook_event.id IS NOT NULL THEN
        UPDATE public.webhook_events
           SET status = 'processed',
               processed_at = clock_timestamp()
         WHERE id = v_webhook_event.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'status', 'funded',
        'milestone_id', v_milestone.id,
        'contract_id', v_milestone.contract_id,
        'razorpay_order_id', v_attempt.razorpay_order_id,
        'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_webhook_payment FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_webhook_payment TO service_role;

-- ============================================================================
-- 5. PROCEDURE: FUND MILESTONE WITH PAYMENT (Dynamic Environment Support)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fund_milestone_with_payment(
    p_milestone_id uuid,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid;
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_provider text;
    v_environment text;
    v_desc text;
    v_order_id text;
    v_payment_id text;
BEGIN
    -- Strict least-privilege authorization check: caller must be service_role or superuser/postgres
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: fund_milestone_with_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    -- Strict atomic row lock on milestone to eliminate race conditions
    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Resolve authoritative funding actor from server-verified metadata or session
    v_actor_id := COALESCE(
        NULLIF(p_payment_metadata->>'funded_by', '')::uuid,
        NULLIF(p_payment_metadata->>'client_id', '')::uuid,
        auth.uid(),
        v_milestone.client_id
    );

    -- Authorization check on actor
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can fund this milestone' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_order_id := p_payment_metadata->>'razorpay_order_id';

    -- Bidirectional idempotency: if already funded by webhook with matching captured order attempt, exit gracefully
    IF v_milestone.status = 'funded' THEN
        IF v_order_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.payment_attempts
             WHERE razorpay_order_id = v_order_id
               AND milestone_id = p_milestone_id
               AND status = 'captured'
        ) THEN
            RETURN v_milestone;
        END IF;
        RAISE EXCEPTION 'Milestone % is already funded', p_milestone_id USING ERRCODE = '22023';
    END IF;

    -- Concurrency check: fail closed if not in planned status
    IF v_milestone.status <> 'planned' THEN
        RAISE EXCEPTION 'Milestone % is in state "%" and cannot be funded', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Transition milestone status
    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    v_provider := COALESCE(p_payment_metadata->>'provider', 'simulated');
    v_environment := COALESCE(p_payment_metadata->>'environment', 'test');
    v_payment_id := p_payment_metadata->>'razorpay_payment_id';

    -- Update payment attempt to captured if associated order ID exists
    IF v_order_id IS NOT NULL THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = v_payment_id,
               razorpay_signature = p_payment_metadata->>'razorpay_signature',
               metadata = metadata || COALESCE(p_payment_metadata, '{}'::jsonb),
               updated_at = clock_timestamp()
         WHERE razorpay_order_id = v_order_id
           AND milestone_id = p_milestone_id;
    END IF;

    -- Dynamic environment description
    IF v_provider = 'razorpay' THEN
        v_desc := 'Escrow Funded via Razorpay' || 
                  CASE WHEN v_environment = 'test' THEN ' (Test Mode)' ELSE '' END || 
                  ': Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
    ELSE
        v_desc := 'Escrow Funded: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
    END IF;

    -- Record append-only escrow deposit ledger entry
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_milestone.client_id,
        NULL,
        v_milestone.amount,
        v_milestone.currency,
        'escrow_funded',
        'succeeded',
        v_desc,
        jsonb_build_object(
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'funded_by', v_actor_id,
            'environment', v_environment,
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    RETURN v_milestone;
END;
$$;

REVOKE ALL ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) TO service_role;

-- ============================================================================
-- 6. HELPER FUNCTIONS: WEBHOOK EVENT RECEIPT & FAILURE LOGGING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_webhook_event_receipt(
    p_event_id text,
    p_event_type text,
    p_payload_hash text,
    p_environment text DEFAULT 'test',
    p_status text DEFAULT 'received',
    p_error_details jsonb DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_event public.webhook_events;
BEGIN
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: record_webhook_event_receipt is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.webhook_events (
        event_id,
        event_type,
        provider,
        environment,
        payload_hash,
        status,
        processed_at,
        error_details,
        metadata
    ) VALUES (
        trim(p_event_id),
        p_event_type,
        'razorpay',
        lower(trim(COALESCE(p_environment, 'test'))),
        p_payload_hash,
        p_status,
        CASE WHEN p_status IN ('processed', 'ignored') THEN clock_timestamp() ELSE NULL END,
        p_error_details,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (event_id) DO UPDATE
        SET status = EXCLUDED.status,
            processed_at = CASE WHEN EXCLUDED.status IN ('processed', 'ignored') THEN clock_timestamp() ELSE webhook_events.processed_at END,
            error_details = COALESCE(EXCLUDED.error_details, webhook_events.error_details),
            metadata = webhook_events.metadata || EXCLUDED.metadata
    RETURNING * INTO v_event;

    RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.record_webhook_event_receipt FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_event_receipt TO service_role;
