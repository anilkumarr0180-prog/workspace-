-- Migration: 20261027000004_time_tracking_security_hardening.sql
-- Description: Security hardening for contract time-tracking:
--              1. Revoke direct write grants on active_timer_sessions, time_entries, and timesheets.
--              2. Add trusted, atomic stored procedures for start_timer_session, stop_timer_session,
--                 and discard_timer_session.
--              3. Strictly prohibit manual time entries for release 1 via CHECK constraints.
--              4. Enforce strict duration consistency between timestamps and duration_minutes.
--              5. Enforce authoritative server timestamps (clock_timestamp()) preventing client tampering.

-- ============================================================================
-- 1. HARDEN TIME_ENTRIES INTEGRITY CONSTRAINTS
-- ============================================================================

-- A. Prohibit manual time entries in release 1
ALTER TABLE public.time_entries
    DROP CONSTRAINT IF EXISTS chk_time_entry_source_timer_only;

ALTER TABLE public.time_entries
    ADD CONSTRAINT chk_time_entry_source_timer_only
    CHECK (source = 'timer');

-- B. Ensure duration_minutes strictly matches the interval between start_time and end_time
ALTER TABLE public.time_entries
    DROP CONSTRAINT IF EXISTS chk_time_entry_duration_matches_interval;

ALTER TABLE public.time_entries
    ADD CONSTRAINT chk_time_entry_duration_matches_interval
    CHECK (
        duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::integer)
    );

-- ============================================================================
-- 2. REVOKE DIRECT TABLE WRITE PERMISSIONS
-- ============================================================================
-- Authenticated clients cannot directly INSERT, UPDATE, or DELETE records in these tables.
-- All modifications must flow through trusted database procedures.
REVOKE INSERT, UPDATE, DELETE ON public.active_timer_sessions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.active_timer_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.active_timer_sessions FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.time_entries FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.time_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.time_entries FROM authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.timesheets FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.timesheets FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.timesheets FROM authenticated;

-- Ensure SELECT is granted for querying authorized records under RLS
GRANT SELECT ON public.active_timer_sessions TO authenticated;
GRANT SELECT ON public.time_entries TO authenticated;
GRANT SELECT ON public.timesheets TO authenticated;

-- ============================================================================
-- 3. TRUSTED DATABASE FUNCTION: START TIMER SESSION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.start_timer_session(
    p_contract_id uuid,
    p_memo text DEFAULT ''
)
RETURNS public.active_timer_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_contract RECORD;
    v_session public.active_timer_sessions;
BEGIN
    -- 1. Authentication check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to start a timer session'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Read Contract authoritatively
    SELECT id, contract_type, status, freelancer_id
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id
            USING ERRCODE = '23503';
    END IF;

    -- 3. Contract Ownership & Eligibility checks
    IF v_contract.freelancer_id <> v_actor_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can track time on this contract'
            USING ERRCODE = '42501';
    END IF;

    IF v_contract.contract_type <> 'hourly' THEN
        RAISE EXCEPTION 'Timer sessions are only permitted on hourly contracts (contract is %)', v_contract.contract_type
            USING ERRCODE = '22023';
    END IF;

    IF v_contract.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot start timer session on contract with status "%"', v_contract.status
            USING ERRCODE = '22023';
    END IF;

    -- 4. Single platform-wide timer check (concurrent race prevention)
    IF EXISTS (
        SELECT 1 FROM public.active_timer_sessions
         WHERE freelancer_id = v_actor_id
    ) THEN
        RAISE EXCEPTION 'Freelancer already has an active timer session running'
            USING ERRCODE = '23505';
    END IF;

    -- 5. Insert with Authoritative Server Timestamp (Caller cannot forge start_time)
    INSERT INTO public.active_timer_sessions (
        contract_id,
        freelancer_id,
        start_time,
        memo
    ) VALUES (
        p_contract_id,
        v_actor_id,
        clock_timestamp(),
        COALESCE(trim(p_memo), '')
    )
    RETURNING * INTO v_session;

    RETURN v_session;
END;
$$;

-- ============================================================================
-- 4. TRUSTED DATABASE FUNCTION: STOP TIMER SESSION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.stop_timer_session(
    p_memo text DEFAULT NULL
)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_session RECORD;
    v_contract RECORD;
    v_end_time timestamptz;
    v_duration_seconds numeric;
    v_duration_minutes integer;
    v_week_start date;
    v_timesheet_id uuid;
    v_final_memo text;
    v_entry public.time_entries;
BEGIN
    -- 1. Authentication check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to stop a timer session'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Lock and retrieve the caller's active session atomically (eliminates duplicate stops)
    SELECT id, contract_id, freelancer_id, start_time, memo
      INTO v_session
      FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active timer session found for current user'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Read parent contract authoritatively
    SELECT id, client_id, company_id, contract_type, status, hourly_rate
      INTO v_contract
      FROM public.contracts
     WHERE id = v_session.contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced contract % not found', v_session.contract_id
            USING ERRCODE = '23503';
    END IF;

    -- If contract was cancelled, discard session and fail
    IF v_contract.status = 'cancelled' THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RAISE EXCEPTION 'Contract was cancelled. Active timer session discarded.'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Calculate trusted server timestamps and duration
    v_end_time := clock_timestamp();
    v_duration_seconds := EXTRACT(EPOCH FROM (v_end_time - v_session.start_time));

    IF v_duration_seconds < 0 THEN
        v_duration_seconds := 0;
    END IF;

    -- If duration is less than 60 seconds (1 minute), discard session without billing
    IF v_duration_seconds < 60 THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RAISE EXCEPTION 'Timer session discarded: Elapsed time was less than 1 minute (% seconds)', ROUND(v_duration_seconds)
            USING ERRCODE = '22023';
    END IF;

    v_duration_minutes := GREATEST(1, ROUND(v_duration_seconds / 60)::integer);

    -- Prepare sanitized memo
    v_final_memo := COALESCE(
        NULLIF(trim(p_memo), ''),
        NULLIF(trim(v_session.memo), ''),
        'Working on hourly deliverables'
    );

    -- 5. Determine Monday of the week for UTC period
    v_week_start := date_trunc('week', v_session.start_time AT TIME ZONE 'UTC')::date;

    -- 6. Upsert Timesheet atomically for this contract week
    INSERT INTO public.timesheets (
        contract_id,
        client_id,
        freelancer_id,
        week_start_date,
        total_minutes,
        total_amount,
        status
    ) VALUES (
        v_contract.id,
        v_contract.client_id,
        v_actor_id,
        v_week_start,
        v_duration_minutes,
        ROUND((v_duration_minutes::numeric / 60.0) * v_contract.hourly_rate, 2),
        'open'
    )
    ON CONFLICT (contract_id, week_start_date) DO UPDATE
       SET total_minutes = timesheets.total_minutes + EXCLUDED.total_minutes,
           total_amount = timesheets.total_amount + EXCLUDED.total_amount,
           updated_at = clock_timestamp()
    RETURNING id INTO v_timesheet_id;

    -- 7. Insert completed Time Entry with trusted calculated duration
    INSERT INTO public.time_entries (
        contract_id,
        timesheet_id,
        freelancer_id,
        start_time,
        end_time,
        duration_minutes,
        memo,
        source
    ) VALUES (
        v_contract.id,
        v_timesheet_id,
        v_actor_id,
        v_session.start_time,
        v_end_time,
        v_duration_minutes,
        v_final_memo,
        'timer'
    )
    RETURNING * INTO v_entry;

    -- 8. Remove active timer session row
    DELETE FROM public.active_timer_sessions WHERE id = v_session.id;

    RETURN v_entry;
END;
$$;

-- ============================================================================
-- 5. TRUSTED DATABASE FUNCTION: DISCARD TIMER SESSION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.discard_timer_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id;

    RETURN true;
END;
$$;

-- ============================================================================
-- 6. FUNCTION EXECUTE GRANTS
-- ============================================================================
REVOKE ALL ON FUNCTION public.start_timer_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_timer_session(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.stop_timer_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer_session(text) TO authenticated;

REVOKE ALL ON FUNCTION public.discard_timer_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_timer_session() TO authenticated;
