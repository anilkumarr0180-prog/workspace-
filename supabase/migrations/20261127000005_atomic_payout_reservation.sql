-- ==============================================================================
-- Migration: 20261127000005_atomic_payout_reservation.sql
-- Description: Phase 2C.7.2 Atomic Payout Reservation & Retry Safety:
--   1. Partial unique index uq_payout_transfers_active_timesheet enforcing at
--      most one active/completed payout transfer per timesheet_id.
--   2. reserve_timesheet_payout_transfer() RPC: locks timesheet row, creates or
--      returns atomic reservation before external provider dispatch.
--   3. record_payout_transfer_dispatch() & mark_payout_transfer_failed() RPCs
--      for safe post-dispatch persistence and retryable failure transitions.
-- ==============================================================================

-- 1. Enforce at most one active or completed payout per timesheet_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transfers_active_timesheet
    ON public.payout_transfers (timesheet_id)
    WHERE timesheet_id IS NOT NULL
      AND status IN ('pending', 'eligible', 'processing', 'completed', 'on_hold');

-- 2. Atomic payout reservation RPC
CREATE OR REPLACE FUNCTION public.reserve_timesheet_payout_transfer(
    p_timesheet_id uuid,
    p_recipient_user_id uuid,
    p_gross_amount numeric,
    p_fee_amount numeric,
    p_net_amount numeric,
    p_currency text,
    p_provider_account_id text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_existing public.payout_transfers;
    v_transfer public.payout_transfers;
    v_currency text := NULLIF(upper(trim(COALESCE(p_currency, ''))), '');
    v_prior_count integer;
    v_attempt_no integer;
    v_gross_subunits bigint;
    v_idem_key text;
    v_placeholder_trf text;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reserve_timesheet_payout_transfer is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    IF p_timesheet_id IS NULL OR p_recipient_user_id IS NULL THEN
        RAISE EXCEPTION 'Timesheet ID and recipient user ID are required' USING ERRCODE = '22023';
    END IF;

    IF v_currency IS NULL OR v_currency NOT IN ('INR', 'USD') THEN
        RAISE EXCEPTION 'Unsupported or missing payout currency: %', p_currency USING ERRCODE = '22023';
    END IF;

    -- 1) Lock timesheet row to serialize concurrent payout reservations
    SELECT * INTO v_timesheet
      FROM public.timesheets
     WHERE id = p_timesheet_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.status <> 'paid' THEN
        RAISE EXCEPTION 'Timesheet % is in status "%"; payment must be settled before payout',
            p_timesheet_id, v_timesheet.status
            USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.freelancer_id <> p_recipient_user_id THEN
        RAISE EXCEPTION 'Recipient % does not match timesheet freelancer %',
            p_recipient_user_id, v_timesheet.freelancer_id
            USING ERRCODE = '22023';
    END IF;

    -- 2) Check for existing active or completed payout transfer
    SELECT * INTO v_existing
      FROM public.payout_transfers
     WHERE timesheet_id = p_timesheet_id
       AND status IN ('pending', 'eligible', 'processing', 'completed', 'on_hold')
     ORDER BY created_at DESC
     LIMIT 1
       FOR UPDATE;

    IF FOUND THEN
        -- Allow stale un-dispatched reservation (> 60s) to be recovered by retry caller
        IF v_existing.status = 'pending'
           AND v_existing.provider_transfer_id LIKE 'resv_%'
           AND v_existing.updated_at < (clock_timestamp() - interval '60 seconds') THEN
            UPDATE public.payout_transfers
               SET updated_at = clock_timestamp(),
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('recovered_at', clock_timestamp())
             WHERE id = v_existing.id
             RETURNING * INTO v_existing;

            RETURN jsonb_build_object(
                'reserved_by_caller', true,
                'transfer_id', v_existing.id,
                'status', v_existing.status,
                'idempotency_key', v_existing.idempotency_key,
                'provider_transfer_id', v_existing.provider_transfer_id,
                'gross_amount', v_existing.gross_amount,
                'fee_amount', v_existing.fee_amount,
                'net_amount', v_existing.net_amount,
                'on_hold', v_existing.on_hold,
                'attempt_no', COALESCE((v_existing.metadata->>'attempt_no')::integer, 1)
            );
        END IF;

        RETURN jsonb_build_object(
            'reserved_by_caller', false,
            'transfer_id', v_existing.id,
            'status', v_existing.status,
            'idempotency_key', v_existing.idempotency_key,
            'provider_transfer_id', v_existing.provider_transfer_id,
            'gross_amount', v_existing.gross_amount,
            'fee_amount', v_existing.fee_amount,
            'net_amount', v_existing.net_amount,
            'on_hold', v_existing.on_hold,
            'attempt_no', COALESCE((v_existing.metadata->>'attempt_no')::integer, 1)
        );
    END IF;

    -- 3) Create fresh atomic reservation (retry-aware attempt number if prior failed/reversed exist)
    SELECT COUNT(*) INTO v_prior_count
      FROM public.payout_transfers
     WHERE timesheet_id = p_timesheet_id;

    v_attempt_no := v_prior_count + 1;
    v_gross_subunits := ROUND(p_gross_amount * 100)::bigint;
    v_idem_key := CASE
        WHEN v_attempt_no = 1 THEN 'payout:timesheet:' || p_timesheet_id::text || ':' || v_gross_subunits::text
        ELSE 'payout:timesheet:' || p_timesheet_id::text || ':' || v_gross_subunits::text || ':retry:' || v_attempt_no::text
    END;
    v_placeholder_trf := 'resv_' || gen_random_uuid()::text;

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
        v_timesheet.contract_id,
        NULL,
        p_timesheet_id,
        p_recipient_user_id,
        'mock_route',
        v_placeholder_trf,
        p_provider_account_id,
        p_gross_amount,
        p_fee_amount,
        p_net_amount,
        v_currency,
        false,
        'pending',
        v_idem_key,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('attempt_no', v_attempt_no)
    )
    RETURNING * INTO v_transfer;

    RETURN jsonb_build_object(
        'reserved_by_caller', true,
        'transfer_id', v_transfer.id,
        'status', v_transfer.status,
        'idempotency_key', v_transfer.idempotency_key,
        'provider_transfer_id', v_transfer.provider_transfer_id,
        'gross_amount', v_transfer.gross_amount,
        'fee_amount', v_transfer.fee_amount,
        'net_amount', v_transfer.net_amount,
        'on_hold', v_transfer.on_hold,
        'attempt_no', v_attempt_no
    );
END;
$$;

-- 3. Record external provider dispatch on an owned reservation
CREATE OR REPLACE FUNCTION public.record_payout_transfer_dispatch(
    p_transfer_id uuid,
    p_provider_transfer_id text,
    p_status text DEFAULT 'processing',
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
    v_transfer public.payout_transfers;
    v_clean_trf_id text := NULLIF(trim(COALESCE(p_provider_transfer_id, '')), '');
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: record_payout_transfer_dispatch is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_trf_id IS NULL THEN
        RAISE EXCEPTION 'Provider transfer ID is required' USING ERRCODE = '22023';
    END IF;

    IF left(v_clean_trf_id, 5) = 'resv_' THEN
        RAISE EXCEPTION 'Placeholder transfer ID "%" cannot be recorded as an external provider transfer ID', v_clean_trf_id
            USING ERRCODE = '22023';
    END IF;

    IF p_status NOT IN ('processing', 'on_hold', 'pending') THEN
        RAISE EXCEPTION 'Unsupported dispatch status "%"', p_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    IF v_transfer.status = 'completed' THEN
        RETURN v_transfer;
    END IF;

    -- Never overwrite an already-recorded real external provider_transfer_id
    IF v_transfer.provider_transfer_id IS NOT NULL
       AND trim(v_transfer.provider_transfer_id) <> ''
       AND left(trim(v_transfer.provider_transfer_id), 5) <> 'resv_' THEN
        IF trim(v_transfer.provider_transfer_id) <> v_clean_trf_id THEN
            RAISE EXCEPTION 'Payout transfer % already has recorded provider_transfer_id "%"; cannot overwrite with "%"',
                p_transfer_id, v_transfer.provider_transfer_id, v_clean_trf_id
                USING ERRCODE = '23505';
        END IF;

        IF v_transfer.status = p_status AND v_transfer.on_hold = p_on_hold THEN
            RETURN v_transfer;
        END IF;

        UPDATE public.payout_transfers
           SET status = p_status,
               on_hold = p_on_hold,
               metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
               updated_at = clock_timestamp()
         WHERE id = p_transfer_id
         RETURNING * INTO v_transfer;

        RETURN v_transfer;
    END IF;

    UPDATE public.payout_transfers
       SET provider_transfer_id = v_clean_trf_id,
           status = p_status,
           on_hold = p_on_hold,
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;

    RETURN v_transfer;
END;
$$;

-- 4. Mark a definitively failed payout transfer (frees active timesheet slot for retry)
CREATE OR REPLACE FUNCTION public.mark_payout_transfer_failed(
    p_transfer_id uuid,
    p_failure_reason text,
    p_metadata jsonb DEFAULT '{}'::jsonb
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
        RAISE EXCEPTION 'Access denied: mark_payout_transfer_failed is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    IF v_transfer.status = 'completed' THEN
        RAISE EXCEPTION 'Completed payout transfer % cannot be marked failed', p_transfer_id
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.payout_transfers
       SET status = 'failed',
           failure_reason = COALESCE(NULLIF(trim(p_failure_reason), ''), 'Transfer failed'),
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
     RETURNING * INTO v_transfer;

    RETURN v_transfer;
END;
$$;

-- 5. Restrict execution strictly to service_role
REVOKE ALL ON FUNCTION public.reserve_timesheet_payout_transfer(uuid, uuid, numeric, numeric, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_timesheet_payout_transfer(uuid, uuid, numeric, numeric, numeric, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_payout_transfer_dispatch(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payout_transfer_dispatch(uuid, text, text, boolean, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.mark_payout_transfer_failed(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_transfer_failed(uuid, text, jsonb) TO service_role;
