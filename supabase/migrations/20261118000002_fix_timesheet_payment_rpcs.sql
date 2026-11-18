-- Migration: 20261118000002_fix_timesheet_payment_rpcs.sql
-- Description: Ensures tables payment_attempts and payment_ledger support timesheets,
-- and defines record_timesheet_payment_attempt, get_payment_attempt_for_timesheet, and fund_timesheet_with_payment.

-- 1. Ensure columns on public.payment_attempts
ALTER TABLE public.payment_attempts
    ALTER COLUMN milestone_id DROP NOT NULL;

ALTER TABLE public.payment_attempts
    ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'milestone';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_attempt_target'
    ) THEN
        ALTER TABLE public.payment_attempts
            ADD CONSTRAINT chk_payment_attempt_target CHECK (
                (billing_type = 'milestone' AND milestone_id IS NOT NULL) OR
                (billing_type = 'timesheet' AND timesheet_id IS NOT NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_timesheet_id ON public.payment_attempts (timesheet_id)
    WHERE timesheet_id IS NOT NULL;

-- 2. Ensure columns and constraints on public.payment_ledger
ALTER TABLE public.payment_ledger
    ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payout_transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_payment_ledger_timesheet_id ON public.payment_ledger (timesheet_id)
    WHERE timesheet_id IS NOT NULL;

ALTER TABLE public.payment_ledger
    DROP CONSTRAINT IF EXISTS chk_ledger_event_type,
    DROP CONSTRAINT IF EXISTS chk_ledger_status;

ALTER TABLE public.payment_ledger
    ADD CONSTRAINT chk_ledger_event_type CHECK (
        event_type IN (
            'escrow_funded',
            'escrow_released',
            'payout_disbursed',
            'service_fee_deducted',
            'escrow_refund',
            'hourly_funded',
            'hourly_billed',
            'payout_initiated',
            'transfer_held',
            'transfer_released',
            'transfer_reversed',
            'transfer_failed'
        )
    ),
    ADD CONSTRAINT chk_ledger_status CHECK (
        status IN ('succeeded', 'pending', 'reversed', 'failed')
    );

-- 3. Procedure: record_timesheet_payment_attempt
CREATE OR REPLACE FUNCTION public.record_timesheet_payment_attempt(
    p_contract_id uuid,
    p_timesheet_id uuid,
    p_client_id uuid,
    p_amount numeric,
    p_amount_subunits bigint,
    p_currency text,
    p_razorpay_order_id text,
    p_environment text DEFAULT 'test',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_contract RECORD;
    v_attempt public.payment_attempts;
    v_env text;
    v_is_authorized boolean := false;
BEGIN
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    v_env := lower(trim(COALESCE(p_environment, 'test')));
    IF v_env NOT IN ('test', 'live') THEN
        RAISE EXCEPTION 'Invalid environment "%". Supported environments are "test" and "live"', v_env
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.contract_id <> p_contract_id THEN
        RAISE EXCEPTION 'Timesheet % does not belong to contract %', p_timesheet_id, p_contract_id
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = p_contract_id;

    -- Validate client authorization
    IF v_role = 'service_role' THEN
        v_is_authorized := true;
    ELSIF v_actor_id = v_timesheet.client_id THEN
        v_is_authorized := true;
    ELSIF v_contract.company_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Only the client can record payment attempts for this timesheet' USING ERRCODE = '42501';
    END IF;

    -- Validate timesheet status
    IF v_timesheet.status <> 'approved' THEN
        RAISE EXCEPTION 'Timesheet must be approved before payment attempt (current: %)', v_timesheet.status
            USING ERRCODE = '22023';
    END IF;

    -- Validate amount (allow small floating point tolerance)
    IF abs(v_timesheet.total_amount - p_amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment attempt amount (%) does not match timesheet amount (%)', p_amount, v_timesheet.total_amount
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_attempts (
        contract_id,
        timesheet_id,
        billing_type,
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
        p_contract_id,
        p_timesheet_id,
        'timesheet',
        v_timesheet.client_id,
        'razorpay',
        v_env,
        p_razorpay_order_id,
        p_amount,
        p_amount_subunits,
        p_currency,
        'created',
        p_metadata
    )
    RETURNING * INTO v_attempt;

    RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.record_timesheet_payment_attempt(uuid, uuid, uuid, numeric, bigint, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_timesheet_payment_attempt(uuid, uuid, uuid, numeric, bigint, text, text, text, jsonb) TO authenticated, service_role;

-- 4. Procedure: get_payment_attempt_for_timesheet
CREATE OR REPLACE FUNCTION public.get_payment_attempt_for_timesheet(
    p_timesheet_id uuid,
    p_razorpay_order_id text
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_role text := COALESCE(auth.role(), '');
    v_attempt public.payment_attempts;
    v_contract RECORD;
    v_is_authorized boolean := false;
BEGIN
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = trim(p_razorpay_order_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment attempt not found for timesheet % and order %', p_timesheet_id, p_razorpay_order_id
            USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_attempt.contract_id;

    -- Authorization check: client or freelancer involved, or company member, or service_role
    IF v_role = 'service_role' THEN
        v_is_authorized := true;
    ELSIF v_actor_id = v_attempt.client_id OR v_actor_id = v_contract.freelancer_id THEN
        v_is_authorized := true;
    ELSIF v_contract.company_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Not authorized to view this payment attempt' USING ERRCODE = '42501';
    END IF;

    RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_attempt_for_timesheet(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_attempt_for_timesheet(uuid, text) TO authenticated, service_role;

-- 5. Procedure: fund_timesheet_with_payment
CREATE OR REPLACE FUNCTION public.fund_timesheet_with_payment(
    p_timesheet_id uuid,
    p_razorpay_payment_id text,
    p_razorpay_order_id text,
    p_razorpay_signature text,
    p_amount_subunits bigint,
    p_currency text,
    p_environment text DEFAULT 'test',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_contract public.contracts;
    v_attempt public.payment_attempts;
    v_amount numeric(12,2);
BEGIN
    -- Authoritative check: Must be service_role, or direct session superuser
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: fund_timesheet_with_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        RETURN v_timesheet; -- Idempotent return
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;
    v_amount := v_timesheet.total_amount;

    -- Update payment attempt
    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = p_razorpay_payment_id,
           razorpay_signature = p_razorpay_signature,
           updated_at = clock_timestamp()
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = p_razorpay_order_id
 RETURNING * INTO v_attempt;

    -- Transition timesheet to paid
    UPDATE public.timesheets
       SET status = 'paid',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    -- Record hourly payment funding in ledger
    INSERT INTO public.payment_ledger (
        contract_id,
        timesheet_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_timesheet.contract_id,
        v_timesheet.id,
        v_timesheet.client_id,
        NULL,
        v_amount,
        p_currency,
        'hourly_funded',
        'succeeded',
        'Hourly Invoice Payment for Week of ' || v_timesheet.week_start_date::text || ' (' || v_timesheet.total_minutes || ' mins)',
        jsonb_build_object(
            'provider', 'razorpay',
            'environment', p_environment,
            'razorpay_payment_id', p_razorpay_payment_id,
            'razorpay_order_id', p_razorpay_order_id
        ) || p_metadata
    );

    RETURN v_timesheet;
END;
$$;

REVOKE ALL ON FUNCTION public.fund_timesheet_with_payment(uuid, text, text, text, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_timesheet_with_payment(uuid, text, text, text, bigint, text, text, jsonb) TO service_role;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

