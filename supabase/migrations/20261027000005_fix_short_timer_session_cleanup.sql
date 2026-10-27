-- ============================================================================
-- Migration: 20261027000005_fix_short_timer_session_cleanup.sql
-- Description: Correct short-session cleanup in stop_timer_session by deleting
--              active session and returning NULL on under-60-second sessions
--              instead of raising an exception that rolls back the deletion.
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

    -- If contract was cancelled, discard session without billing and return NULL
    IF v_contract.status = 'cancelled' THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN NULL;
    END IF;

    -- 4. Calculate trusted server timestamps and duration
    v_end_time := clock_timestamp();
    v_duration_seconds := EXTRACT(EPOCH FROM (v_end_time - v_session.start_time));

    IF v_duration_seconds < 0 THEN
        v_duration_seconds := 0;
    END IF;

    -- If duration is less than 60 seconds (1 minute), discard session without billing
    -- Returning NULL allows the transaction to commit and the active session to be deleted.
    IF v_duration_seconds < 60 THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN NULL;
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

COMMENT ON FUNCTION public.stop_timer_session(text) IS 'Atomically stops active timer session, calculates authoritative duration, logs completed entry and timesheet rollup if >= 60 seconds, or discards the active session cleanly if < 60 seconds.';

REVOKE ALL ON FUNCTION public.stop_timer_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer_session(text) TO authenticated;
