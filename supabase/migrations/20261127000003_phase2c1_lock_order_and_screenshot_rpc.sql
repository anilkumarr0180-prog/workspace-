-- ==============================================================================
-- Migration: 20261127000003_phase2c1_lock_order_and_screenshot_rpc.sql
-- Description: Phase 2C.1 Concurrency & Atomicity Hardening:
--   1. Standardize canonical lock acquisition order across all timer & diary RPCs:
--      contracts (FOR UPDATE) -> active_timer_sessions (FOR UPDATE) ->
--      timesheets (FOR UPDATE) -> time_entries -> work_diary_slots
--   2. Update stop_timer_session_v2() to lock contracts BEFORE active_timer_sessions,
--      eliminating lock-order inversion with start_timer_session().
--   3. Create atomic record_work_diary_screenshot_slot() RPC that validates
--      auth.uid(), contract ownership/active/hourly status, and active timer
--      membership in one transaction with ON CONFLICT idempotency.
-- ==============================================================================

-- 1. Update stop_timer_session_v2() with canonical lock order
CREATE OR REPLACE FUNCTION public.stop_timer_session_v2(
    p_memo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_target_contract_id uuid;
    v_session RECORD;
    v_contract RECORD;
    v_end_time timestamptz;
    v_duration_seconds numeric;
    v_duration_minutes integer;
    v_week_start date;
    v_week_end timestamptz;
    v_existing_week_minutes integer := 0;
    v_remaining_minutes integer := NULL;
    v_existing_timesheet public.timesheets;
    v_timesheet_id uuid;
    v_final_memo text;
    v_entry public.time_entries;
    v_linked_slots integer := 0;
    v_num_slots integer;
    v_slot_idx integer;
    v_slot_time timestamptz;
    v_slot_mins integer;
    v_sim_score integer;
    v_sim_keys integer;
    v_sim_mouse integer;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to stop a timer session'
            USING ERRCODE = '42501';
    END IF;

    -- Step 1: Identify target contract without locking active_timer_sessions first
    SELECT contract_id
      INTO v_target_contract_id
      FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active timer session found for current user'
            USING ERRCODE = '22023';
    END IF;

    -- Step 2: Acquire locks in canonical order: contracts -> active_timer_sessions -> timesheets
    SELECT id, client_id, company_id, contract_type, status, hourly_rate, weekly_hour_limit
      INTO v_contract
      FROM public.contracts
     WHERE id = v_target_contract_id
       FOR UPDATE;

    SELECT id, contract_id, freelancer_id, start_time, memo
      INTO v_session
      FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id
       AND contract_id = v_target_contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active timer session found for current user'
            USING ERRCODE = '22023';
    END IF;

    IF v_contract.id IS NULL THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
            'outcome', 'discarded',
            'discard_reason', 'contract_ineligible'
        );
    END IF;

    -- Reject billing for any non-active or non-hourly contract
    IF v_contract.status <> 'active' OR v_contract.contract_type <> 'hourly' THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
            'outcome', 'discarded',
            'discard_reason', CASE
                WHEN v_contract.status = 'cancelled' THEN 'contract_cancelled'
                ELSE 'contract_ineligible'
            END,
            'contract_status', v_contract.status
        );
    END IF;

    v_end_time := clock_timestamp();
    v_duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_end_time - v_session.start_time)));

    -- Discard sessions under 60 seconds
    IF v_duration_seconds < 60 THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
            'outcome', 'discarded',
            'discard_reason', 'short_session'
        );
    END IF;

    -- Reject sessions exceeding 12-hour max duration constraint explicitly
    IF (v_end_time - v_session.start_time) > interval '12 hours' THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
            'outcome', 'discarded',
            'discard_reason', 'session_exceeded_max_duration'
        );
    END IF;

    v_duration_minutes := GREATEST(1, ROUND(v_duration_seconds / 60)::integer);

    v_final_memo := COALESCE(
        NULLIF(trim(p_memo), ''),
        NULLIF(trim(v_session.memo), ''),
        'Working on hourly deliverables'
    );

    v_week_start := date_trunc('week', v_session.start_time AT TIME ZONE 'UTC')::date;
    v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';

    -- Step 3: Lock weekly timesheet
    SELECT *
      INTO v_existing_timesheet
      FROM public.timesheets
     WHERE contract_id = v_contract.id
       AND week_start_date = v_week_start
       FOR UPDATE;

    IF v_contract.weekly_hour_limit IS NOT NULL AND v_contract.weekly_hour_limit > 0 THEN
        SELECT COALESCE(SUM(duration_minutes), 0)
          INTO v_existing_week_minutes
          FROM public.time_entries
         WHERE contract_id = v_contract.id
           AND start_time >= (v_week_start AT TIME ZONE 'UTC')
           AND start_time < v_week_end;

        v_remaining_minutes := (v_contract.weekly_hour_limit * 60) - v_existing_week_minutes;

        IF v_remaining_minutes <= 0 THEN
            DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
            RETURN jsonb_build_object(
                'outcome', 'discarded',
                'discard_reason', 'weekly_limit_reached',
                'remaining_week_minutes', 0
            );
        END IF;

        IF v_duration_minutes > v_remaining_minutes THEN
            v_duration_minutes := v_remaining_minutes;
            v_end_time := v_session.start_time + make_interval(mins => v_duration_minutes);
        END IF;
    END IF;

    -- Preserve paid, approved, submitted, and under_review timesheets as immutable
    IF FOUND AND v_existing_timesheet.status IN ('paid', 'approved', 'submitted', 'under_review') THEN
        v_timesheet_id := NULL;
    ELSE
        INSERT INTO public.timesheets (
            contract_id,
            client_id,
            freelancer_id,
            week_start_date,
            total_minutes,
            total_amount,
            status,
            updated_at
        ) VALUES (
            v_contract.id,
            v_contract.client_id,
            v_actor_id,
            v_week_start,
            v_duration_minutes,
            ROUND((v_duration_minutes::numeric / 60.0) * COALESCE(v_contract.hourly_rate, 0), 2),
            'open',
            now()
        )
        ON CONFLICT (contract_id, week_start_date)
        DO UPDATE SET
            total_minutes = public.timesheets.total_minutes + EXCLUDED.total_minutes,
            total_amount = ROUND(((public.timesheets.total_minutes + EXCLUDED.total_minutes)::numeric / 60.0) * COALESCE(v_contract.hourly_rate, 0), 2),
            updated_at = now()
        RETURNING id INTO v_timesheet_id;
    END IF;

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

    UPDATE public.work_diary_slots
       SET time_entry_id = v_entry.id
     WHERE contract_id = v_contract.id
       AND freelancer_id = v_actor_id
       AND time_entry_id IS NULL
       AND slot_time >= (v_session.start_time - interval '2 minutes')
       AND slot_time <= (v_end_time + interval '2 minutes');

    GET DIAGNOSTICS v_linked_slots = ROW_COUNT;

    IF v_linked_slots = 0 THEN
        v_num_slots := GREATEST(1, CEIL(v_duration_minutes::numeric / 10.0));
        FOR v_slot_idx IN 1..v_num_slots LOOP
            v_slot_time := v_session.start_time + ((v_slot_idx - 1) * interval '10 minutes');
            IF v_slot_idx = v_num_slots THEN
                v_slot_mins := v_duration_minutes - ((v_slot_idx - 1) * 10);
                IF v_slot_mins <= 0 THEN v_slot_mins := 10; END IF;
            ELSE
                v_slot_mins := 10;
            END IF;

            v_sim_score := 7 + ((EXTRACT(MINUTE FROM v_slot_time)::integer * 7 + v_slot_idx * 3) % 4);
            v_sim_keys := 280 + (v_sim_score * 35) + ((EXTRACT(SECOND FROM v_slot_time)::integer * 5) % 80);
            v_sim_mouse := 70 + (v_sim_score * 12) + ((EXTRACT(MINUTE FROM v_slot_time)::integer * 3) % 35);

            INSERT INTO public.work_diary_slots (
                contract_id,
                time_entry_id,
                freelancer_id,
                slot_time,
                duration_minutes,
                activity_score,
                keystrokes_count,
                mouse_clicks_count,
                memo,
                screenshot_url,
                is_manual
            ) VALUES (
                v_contract.id,
                v_entry.id,
                v_actor_id,
                v_slot_time,
                v_slot_mins,
                v_sim_score,
                v_sim_keys,
                v_sim_mouse,
                v_final_memo,
                NULL,
                false
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    DELETE FROM public.active_timer_sessions WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'outcome', 'saved',
        'entry', row_to_json(v_entry),
        'remaining_week_minutes', CASE
            WHEN v_remaining_minutes IS NULL THEN NULL
            ELSE GREATEST(0, v_remaining_minutes - v_duration_minutes)
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.stop_timer_session_v2(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer_session_v2(text) TO authenticated;

-- 2. Atomic RPC for recording screenshot work_diary_slots
--    Lock order: contracts (FOR UPDATE) -> active_timer_sessions (FOR UPDATE) -> work_diary_slots
CREATE OR REPLACE FUNCTION public.record_work_diary_screenshot_slot(
    p_contract_id uuid,
    p_slot_time timestamptz DEFAULT clock_timestamp(),
    p_duration_minutes integer DEFAULT 10,
    p_activity_score integer DEFAULT 8,
    p_keystrokes_count integer DEFAULT 0,
    p_mouse_clicks_count integer DEFAULT 0,
    p_memo text DEFAULT '',
    p_screenshot_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_contract RECORD;
    v_session_id uuid;
    v_effective_slot_time timestamptz := COALESCE(p_slot_time, clock_timestamp());
    v_clean_screenshot_url text := NULLIF(trim(COALESCE(p_screenshot_url, '')), '');
    v_slot public.work_diary_slots;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to record screenshot slot'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_screenshot_url IS NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'ineligible',
            'error', 'A valid screenshot_url is required to record a screenshot slot',
            'code', 'INVALID_SCREENSHOT'
        );
    END IF;

    -- Step 1: Lock contract row first (canonical lock order)
    SELECT id, freelancer_id, contract_type, status
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'outcome', 'ineligible',
            'error', 'Contract not found',
            'code', 'NOT_FOUND'
        );
    END IF;

    IF v_contract.freelancer_id <> v_actor_id THEN
        RETURN jsonb_build_object(
            'outcome', 'ineligible',
            'error', 'You are not the assigned freelancer for this contract',
            'code', 'FORBIDDEN'
        );
    END IF;

    IF v_contract.contract_type <> 'hourly' OR v_contract.status <> 'active' THEN
        RETURN jsonb_build_object(
            'outcome', 'ineligible',
            'error', format('Contract is %s (%s) and cannot record screenshot slots', v_contract.status, v_contract.contract_type),
            'code', 'INELIGIBLE_CONTRACT'
        );
    END IF;

    -- Step 2: Lock active_timer_sessions row for this freelancer & contract
    SELECT id
      INTO v_session_id
      FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id
       AND contract_id = p_contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'outcome', 'ineligible',
            'error', 'An active timer session on this contract is required to record screenshot slots',
            'code', 'NO_ACTIVE_SESSION'
        );
    END IF;

    -- Step 3: Idempotent insert into work_diary_slots (10-min UTC bucket partial unique index)
    INSERT INTO public.work_diary_slots (
        contract_id,
        freelancer_id,
        slot_time,
        duration_minutes,
        activity_score,
        keystrokes_count,
        mouse_clicks_count,
        memo,
        screenshot_url,
        is_manual
    ) VALUES (
        p_contract_id,
        v_actor_id,
        v_effective_slot_time,
        LEAST(60, GREATEST(1, COALESCE(p_duration_minutes, 10))),
        LEAST(10, GREATEST(0, COALESCE(p_activity_score, 0))),
        GREATEST(0, COALESCE(p_keystrokes_count, 0)),
        GREATEST(0, COALESCE(p_mouse_clicks_count, 0)),
        COALESCE(NULLIF(trim(p_memo), ''), 'Active work session'),
        v_clean_screenshot_url,
        false
    )
    ON CONFLICT (contract_id, freelancer_id, public.utc_ten_minute_bucket(slot_time))
    WHERE is_manual = false AND screenshot_url IS NOT NULL
    DO NOTHING
    RETURNING * INTO v_slot;

    IF NOT FOUND THEN
        SELECT *
          INTO v_slot
          FROM public.work_diary_slots
         WHERE contract_id = p_contract_id
           AND freelancer_id = v_actor_id
           AND is_manual = false
           AND screenshot_url IS NOT NULL
           AND public.utc_ten_minute_bucket(slot_time) = public.utc_ten_minute_bucket(v_effective_slot_time)
         LIMIT 1;

        RETURN jsonb_build_object(
            'outcome', 'duplicate',
            'slot', row_to_json(v_slot)
        );
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'inserted',
        'slot', row_to_json(v_slot)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_work_diary_screenshot_slot(uuid, timestamptz, integer, integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_work_diary_screenshot_slot(uuid, timestamptz, integer, integer, integer, integer, text, text) TO authenticated;
