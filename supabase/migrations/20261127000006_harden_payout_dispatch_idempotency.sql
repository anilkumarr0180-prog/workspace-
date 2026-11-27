-- ==============================================================================
-- Migration: 20261127000006_harden_payout_dispatch_idempotency.sql
-- Description: Corrective forward migration hardening
--   public.record_payout_transfer_dispatch() to prevent overwriting an already
--   recorded external provider_transfer_id while preserving idempotent retries
--   and valid status/on_hold transitions.
-- ==============================================================================

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

REVOKE ALL ON FUNCTION public.record_payout_transfer_dispatch(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payout_transfer_dispatch(uuid, text, text, boolean, jsonb) TO service_role;
