-- ============================================================================
-- MIGRATION: 20261030000004_fix_security_definer_caller_identity.sql
-- DESCRIPTION: Fixes SECURITY DEFINER caller identity inspection.
--              In PostgreSQL SECURITY DEFINER functions, current_user switches
--              to the function owner (postgres). Relying on current_user to check
--              caller identity creates an authorization bypass.
--              This migration replaces current_user checks with authoritative
--              auth.role(), auth.uid(), and session_user verification.
-- ============================================================================

-- ============================================================================
-- 1. SUBMIT TIMESHEET PROCEDURE (Caller Identity Hardening)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_timesheet(
    p_timesheet_id uuid
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
BEGIN
    -- Reject unauthenticated callers (anon role or null auth.uid)
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    -- Only the assigned freelancer can submit (or backend service_role)
    IF v_role <> 'service_role' AND v_actor_id <> v_timesheet.freelancer_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can submit this timesheet' USING ERRCODE = '42501';
    END IF;

    IF v_timesheet.status NOT IN ('open', 'disputed') THEN
        RAISE EXCEPTION 'Timesheet is already "%"', v_timesheet.status USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.total_minutes <= 0 THEN
        RAISE EXCEPTION 'Cannot submit a timesheet with zero logged time' USING ERRCODE = '22023';
    END IF;

    UPDATE public.timesheets
       SET status = 'submitted',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_timesheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_timesheet(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. APPROVE TIMESHEET PROCEDURE (Caller Identity Hardening)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_timesheet(
    p_timesheet_id uuid
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_contract RECORD;
    v_is_authorized boolean := false;
BEGIN
    -- Reject unauthenticated callers (anon role or null auth.uid)
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;

    -- Strict check: Freelancers cannot approve their own timesheets
    IF v_role <> 'service_role' AND v_actor_id = v_timesheet.freelancer_id THEN
        RAISE EXCEPTION 'Freelancers cannot approve their own timesheets' USING ERRCODE = '42501';
    END IF;

    -- Authorization validation: Client, Company hiring manager, or service_role
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
        RAISE EXCEPTION 'Only the client can approve this timesheet' USING ERRCODE = '42501';
    END IF;

    IF v_timesheet.status NOT IN ('submitted', 'under_review') THEN
        RAISE EXCEPTION 'Timesheet in status "%" cannot be approved', v_timesheet.status USING ERRCODE = '22023';
    END IF;

    UPDATE public.timesheets
       SET status = 'approved',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_timesheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_timesheet(uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. DISPUTE TIMESHEET PROCEDURE (Caller Identity Hardening)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispute_timesheet(
    p_timesheet_id uuid,
    p_reason text
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_contract RECORD;
    v_is_authorized boolean := false;
BEGIN
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Dispute reason must be at least 5 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;

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
        RAISE EXCEPTION 'Only the client can dispute this timesheet' USING ERRCODE = '42501';
    END IF;

    UPDATE public.timesheets
       SET status = 'disputed',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

REVOKE ALL ON FUNCTION public.dispute_timesheet(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_timesheet(uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 4. RECORD TIMESHEET PAYMENT ATTEMPT PROCEDURE (Caller Identity Hardening)
-- ============================================================================

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

    -- Validate amount
    IF v_timesheet.total_amount <> p_amount THEN
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

-- ============================================================================
-- 5. GET PAYMENT ATTEMPT FOR TIMESHEET PROCEDURE (Caller Identity Hardening)
-- ============================================================================

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

-- ============================================================================
-- 6. FUND TIMESHEET WITH PAYMENT PROCEDURE (service_role Restriction)
-- ============================================================================

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
    -- Authoritative check: Must be service_role, or direct session superuser (outside PostgREST)
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

-- ============================================================================
-- 7. FUND MILESTONE WITH PAYMENT PROCEDURE (service_role Restriction)
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
    v_role text := COALESCE(auth.role(), '');
    v_milestone public.contract_milestones;
    v_contract public.contracts;
    v_amount numeric(12,2);
    v_currency text;
    v_desc text;
    v_order_id text;
    v_payment_id text;
BEGIN
    -- Authoritative check: Must be service_role, or direct session superuser
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: fund_milestone_with_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    IF v_milestone.status = 'funded' THEN
        RETURN v_milestone; -- Idempotent return
    END IF;

    IF v_milestone.status <> 'planned' THEN
        RAISE EXCEPTION 'Milestone % is not in planned state (current: %)', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;
    v_amount := v_milestone.amount;
    v_currency := v_milestone.currency;
    v_desc := 'Escrow Funded: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
    v_order_id := p_payment_metadata->>'razorpay_order_id';
    v_payment_id := p_payment_metadata->>'razorpay_payment_id';

    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    IF v_order_id IS NOT NULL THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = COALESCE(v_payment_id, razorpay_payment_id),
               metadata = metadata || p_payment_metadata,
               updated_at = clock_timestamp()
         WHERE milestone_id = p_milestone_id
           AND razorpay_order_id = v_order_id;
    END IF;

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
        v_contract.client_id,
        NULL,
        v_amount,
        v_currency,
        'escrow_funded',
        'succeeded',
        v_desc,
        p_payment_metadata
    );

    RETURN v_milestone;
END;
$$;

REVOKE ALL ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) TO service_role;

-- ============================================================================
-- 8. PAYOUT SETTLEMENT PROCEDURES (service_role Restriction)
-- ============================================================================

-- A. create_payout_transfer_record
CREATE OR REPLACE FUNCTION public.create_payout_transfer_record(
    p_contract_id uuid,
    p_recipient_user_id uuid,
    p_gross_amount numeric,
    p_fee_amount numeric,
    p_net_amount numeric,
    p_currency text,
    p_idempotency_key text,
    p_provider_transfer_id text,
    p_provider_account_id text,
    p_milestone_id uuid DEFAULT NULL,
    p_timesheet_id uuid DEFAULT NULL,
    p_on_hold boolean DEFAULT false,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_existing public.payout_transfers;
    v_transfer public.payout_transfers;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: create_payout_transfer_record is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing FROM public.payout_transfers WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN v_existing;
    END IF;

    INSERT INTO public.payout_transfers (
        contract_id,
        milestone_id,
        timesheet_id,
        recipient_user_id,
        provider,
        provider_transfer_id,
        provider_account_id,
        gross_amount,
        fee_amount,
        net_amount,
        currency,
        on_hold,
        status,
        idempotency_key,
        metadata
    ) VALUES (
        p_contract_id,
        p_milestone_id,
        p_timesheet_id,
        p_recipient_user_id,
        'mock_route',
        p_provider_transfer_id,
        p_provider_account_id,
        p_gross_amount,
        p_fee_amount,
        p_net_amount,
        p_currency,
        p_on_hold,
        'processing',
        p_idempotency_key,
        p_metadata
    )
    RETURNING * INTO v_transfer;

    RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payout_transfer_record(uuid, uuid, numeric, numeric, numeric, text, text, text, text, uuid, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_transfer_record(uuid, uuid, numeric, numeric, numeric, text, text, text, text, uuid, uuid, boolean, jsonb) TO service_role;

-- B. confirm_payout_transfer_completion
CREATE OR REPLACE FUNCTION public.confirm_payout_transfer_completion(
    p_transfer_id uuid,
    p_settled_at timestamptz DEFAULT clock_timestamp()
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_transfer public.payout_transfers;
    v_contract public.contracts;
    v_milestone public.contract_milestones;
    v_timesheet public.timesheets;
    v_remaining_count integer;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: confirm_payout_transfer_completion is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    PERFORM set_config('app.platform_billing', 'on', true);

    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    IF v_transfer.status = 'completed' THEN
        RETURN v_transfer; -- Idempotent return
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_transfer.contract_id;

    UPDATE public.payout_transfers
       SET status = 'completed',
           on_hold = false,
           settled_at = p_settled_at,
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
 RETURNING * INTO v_transfer;

    IF v_transfer.milestone_id IS NOT NULL THEN
        SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = v_transfer.milestone_id FOR UPDATE;
        
        UPDATE public.contract_milestones
           SET status = 'released',
               updated_at = clock_timestamp()
         WHERE id = v_transfer.milestone_id;

        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            v_contract.client_id,
            v_transfer.recipient_user_id,
            v_transfer.gross_amount,
            v_transfer.currency,
            'escrow_released',
            'succeeded',
            'Escrow Released: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')',
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            v_transfer.recipient_user_id,
            NULL,
            v_transfer.fee_amount,
            v_transfer.currency,
            'service_fee_deducted',
            'succeeded',
            'Platform Service Fee (10%): Milestone #' || v_milestone.sequence_order,
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            NULL,
            v_transfer.recipient_user_id,
            v_transfer.net_amount,
            v_transfer.currency,
            'payout_disbursed',
            'succeeded',
            'Payout Disbursed to Linked Account: ' || v_transfer.provider_account_id,
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        UPDATE public.profiles
           SET total_earnings = total_earnings + v_transfer.net_amount,
               updated_at = clock_timestamp()
         WHERE id = v_transfer.recipient_user_id;

        UPDATE public.profiles
           SET total_spent = total_spent + v_transfer.gross_amount,
               updated_at = clock_timestamp()
         WHERE id = v_contract.client_id;

        SELECT COUNT(*) INTO v_remaining_count
          FROM public.contract_milestones
         WHERE contract_id = v_transfer.contract_id
           AND status <> 'released';

        IF v_remaining_count = 0 THEN
            UPDATE public.contracts
               SET status = 'completed',
                   updated_at = clock_timestamp()
             WHERE id = v_transfer.contract_id
               AND status = 'active';
        END IF;

    ELSIF v_transfer.timesheet_id IS NOT NULL THEN
        SELECT * INTO v_timesheet FROM public.timesheets WHERE id = v_transfer.timesheet_id FOR UPDATE;

        INSERT INTO public.payment_ledger (
            contract_id,
            timesheet_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.timesheet_id,
            v_transfer.id,
            v_transfer.recipient_user_id,
            NULL,
            v_transfer.fee_amount,
            v_transfer.currency,
            'service_fee_deducted',
            'succeeded',
            'Platform Service Fee (10%): Timesheet week of ' || v_timesheet.week_start_date::text,
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        INSERT INTO public.payment_ledger (
            contract_id,
            timesheet_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.timesheet_id,
            v_transfer.id,
            NULL,
            v_transfer.recipient_user_id,
            v_transfer.net_amount,
            v_transfer.currency,
            'payout_disbursed',
            'succeeded',
            'Payout Disbursed to Linked Account: ' || v_transfer.provider_account_id,
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        UPDATE public.profiles
           SET total_earnings = total_earnings + v_transfer.net_amount,
               updated_at = clock_timestamp()
         WHERE id = v_transfer.recipient_user_id;

        UPDATE public.profiles
           SET total_spent = total_spent + v_transfer.gross_amount,
               updated_at = clock_timestamp()
         WHERE id = v_contract.client_id;
    END IF;

    RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_payout_transfer_completion(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payout_transfer_completion(uuid, timestamptz) TO service_role;

-- C. reverse_payout_transfer
CREATE OR REPLACE FUNCTION public.reverse_payout_transfer(
    p_transfer_id uuid,
    p_reversal_id text,
    p_reason text DEFAULT 'Marketplace transfer reversal'
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_transfer public.payout_transfers;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reverse_payout_transfer is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    IF v_transfer.status = 'reversed' THEN
        RETURN v_transfer;
    END IF;

    UPDATE public.payout_transfers
       SET status = 'reversed',
           reversal_id = p_reversal_id,
           failure_reason = p_reason,
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
 RETURNING * INTO v_transfer;

    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        timesheet_id,
        payout_transfer_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_transfer.contract_id,
        v_transfer.milestone_id,
        v_transfer.timesheet_id,
        v_transfer.id,
        v_transfer.recipient_user_id,
        NULL,
        v_transfer.net_amount,
        v_transfer.currency,
        'transfer_reversed',
        'reversed',
        'Transfer Reversal: ' || p_reason,
        jsonb_build_object('reversal_id', p_reversal_id, 'provider_transfer_id', v_transfer.provider_transfer_id)
    );

    RETURN v_transfer;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_payout_transfer(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payout_transfer(uuid, text, text) TO service_role;
