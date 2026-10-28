-- Migration: 20261028000002_razorpay_payment_orders.sql
-- Description: Razorpay payment order attempts, tracking lifecycle, and hardened escrow funding procedure.

-- ============================================================================
-- 1. PAYMENT ATTEMPTS TABLE (Tracking Checkout Sessions & Lifecycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    milestone_id uuid NOT NULL REFERENCES public.contract_milestones(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'simulated')),
    environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
    razorpay_order_id text UNIQUE NOT NULL,
    razorpay_payment_id text,
    razorpay_signature text,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    amount_subunits bigint NOT NULL CHECK (amount_subunits > 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'created' CONSTRAINT chk_payment_attempt_status CHECK (
        status IN ('created', 'authorized', 'captured', 'failed', 'refunded')
    ),
    error_code text,
    error_description text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_attempts IS 'Checkout sessions and webhook reconciliations for gateway transactions.';

-- Indexes for performance & lookups
CREATE INDEX IF NOT EXISTS idx_payment_attempts_contract_id ON public.payment_attempts(contract_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_milestone_id ON public.payment_attempts(milestone_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_client_id ON public.payment_attempts(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_razorpay_order ON public.payment_attempts(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_razorpay_payment ON public.payment_attempts(razorpay_payment_id);

-- Enable RLS
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- Restrictive RLS: only involved contract participants can view attempts
CREATE POLICY payment_attempts_select_involved
    ON public.payment_attempts
    FOR SELECT
    USING (
        auth.uid() = client_id
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = payment_attempts.contract_id
               AND (c.freelancer_id = auth.uid() OR c.client_id = auth.uid())
        )
    );

-- Prohibit direct client-side INSERT/UPDATE/DELETE on payment_attempts
REVOKE ALL ON public.payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated;

-- ============================================================================
-- 2. PROCEDURE: RECORD PAYMENT ATTEMPT (Server Controlled)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_payment_attempt(
    p_milestone_id uuid,
    p_razorpay_order_id text,
    p_amount numeric,
    p_amount_subunits bigint,
    p_currency text,
    p_metadata jsonb DEFAULT '{}'::jsonb
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
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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
        'test',
        trim(p_razorpay_order_id),
        p_amount,
        p_amount_subunits,
        upper(trim(p_currency)),
        'created',
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_attempt;

    RETURN v_attempt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_payment_attempt FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_attempt TO authenticated;

-- ============================================================================
-- 3. PROCEDURE: GET PAYMENT ATTEMPT FOR MILESTONE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_payment_attempt_for_milestone(
    p_milestone_id uuid,
    p_razorpay_order_id text
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_attempt public.payment_attempts;
    v_contract RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE milestone_id = p_milestone_id
       AND razorpay_order_id = trim(p_razorpay_order_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment attempt not found for milestone % and order %', p_milestone_id, p_razorpay_order_id
            USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_attempt.contract_id;

    -- Authorization check
    IF v_attempt.client_id <> v_actor_id AND v_contract.freelancer_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Not authorized to view this payment attempt' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN v_attempt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_payment_attempt_for_milestone FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_attempt_for_milestone TO authenticated;

-- ============================================================================
-- 4. HARDENED ATOMIC ESCROW FUNDING PROCEDURE
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

    -- Concurrency check: fail closed if already funded or not in planned status
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
    v_order_id := p_payment_metadata->>'razorpay_order_id';
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
