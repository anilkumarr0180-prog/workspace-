-- ============================================================================
-- Migration: 20261028000003_razorpay_webhook_reconciliation.sql
-- Description: Hardened atomic webhook reconciliation procedure with
--              least-privilege SECURITY DEFINER access, fail-closed validation,
--              and database-level idempotency across both payment paths.
-- ============================================================================

-- 1. ATOMIC WEBHOOK RECONCILIATION PROCEDURE
CREATE OR REPLACE FUNCTION public.reconcile_webhook_payment(
    p_milestone_id uuid,
    p_razorpay_order_id text,
    p_razorpay_payment_id text DEFAULT NULL,
    p_amount_subunits bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.payment_attempts;
    v_milestone public.contract_milestones;
    v_desc text;
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

    -- Strict atomic row lock on payment_attempts to eliminate race conditions
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE milestone_id = p_milestone_id
       AND razorpay_order_id = trim(p_razorpay_order_id)
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment attempt not found for milestone % and order %', p_milestone_id, p_razorpay_order_id
            USING ERRCODE = '23503';
    END IF;

    -- Strict fail-closed validation of payment amount against persisted attempt
    IF p_amount_subunits IS NOT NULL AND v_attempt.amount_subunits <> p_amount_subunits THEN
        RAISE EXCEPTION 'Webhook amount (% subunits) does not match persisted attempt (% subunits)', p_amount_subunits, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    -- Strict fail-closed validation of payment currency against persisted attempt
    IF p_currency IS NOT NULL AND upper(trim(v_attempt.currency)) <> upper(trim(p_currency)) THEN
        RAISE EXCEPTION 'Webhook currency (%) does not match persisted attempt (%)', p_currency, v_attempt.currency
            USING ERRCODE = '22023';
    END IF;

    -- Strict atomic row lock on contract_milestones
    SELECT * INTO v_milestone
      FROM public.contract_milestones
     WHERE id = p_milestone_id
       FOR UPDATE;

    IF NOT FOUND THEN
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

    v_desc := 'Escrow Funded via Razorpay (Webhook): Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';

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
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'status', 'funded',
        'milestone_id', v_milestone.id,
        'contract_id', v_milestone.contract_id,
        'razorpay_order_id', v_attempt.razorpay_order_id,
        'razorpay_payment_id', p_razorpay_payment_id
    );
END;
$$;

-- Revoke all public/client access and grant strictly to service_role
REVOKE ALL ON FUNCTION public.reconcile_webhook_payment FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_webhook_payment TO service_role;

-- 2. ENHANCE SYNCHRONOUS FUNDING FOR BIDIRECTIONAL IDEMPOTENCY
-- If already funded by webhook with the same order ID, return existing milestone gracefully
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
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_provider text;
    v_desc text;
    v_order_id text;
    v_payment_id text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Strict atomic row lock on milestone to eliminate race conditions
    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Authorization check
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
    v_payment_id := p_payment_metadata->>'razorpay_payment_id';

    -- Update payment attempt to captured if associated order ID exists
    IF v_order_id IS NOT NULL THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = v_payment_id,
               razorpay_signature = p_payment_metadata->>'razorpay_signature',
               updated_at = clock_timestamp()
         WHERE razorpay_order_id = v_order_id
           AND milestone_id = p_milestone_id;
    END IF;

    IF v_provider = 'razorpay' THEN
        v_desc := 'Escrow Funded via Razorpay (Test Mode): Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
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
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    RETURN v_milestone;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fund_milestone_with_payment FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fund_milestone_with_payment TO authenticated;
