-- ==============================================================================
-- Migration: 20261127000002_phase2c_billing_integrity.sql
-- Description: Phase 2C Time Tracking Billing Integrity:
--   1. P0: Reject billing in stop_timer_session() for any non-active contract
--      status (paused, completed, cancelled, pending_offer, declined, etc.).
--   2. P1: Validate weekly_hour_limit inside start_timer_session() with
--      contract row locking so exhausted allowances cannot start timers.
--   3. P1: Add stop_timer_session_v2() returning structured jsonb with explicit
--      outcome ('saved' | 'discarded') and discard_reason
--      ('short_session' | 'weekly_limit_reached' | 'contract_ineligible' |
--       'contract_cancelled' | 'session_exceeded_max_duration').
--   4. P2: Enforce 10-minute UTC bucket idempotency on non-manual
--      work_diary_slots via immutable bucket function + unique partial index.
--
-- READ-ONLY PRE-CHECK (Run before applying unique index on live data):
--   SELECT contract_id, freelancer_id,
--          public.utc_ten_minute_bucket(slot_time) AS bucket_utc,
--          COUNT(*) AS duplicate_count
--     FROM public.work_diary_slots
--    WHERE is_manual = false AND screenshot_url IS NOT NULL
--    GROUP BY 1, 2, 3
--   HAVING COUNT(*) > 1;
-- ==============================================================================

-- 1. Immutable 10-minute UTC bucket helper for screenshot slot idempotency
CREATE OR REPLACE FUNCTION public.utc_ten_minute_bucket(p_ts timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT (
        date_trunc('hour', p_ts AT TIME ZONE 'UTC')
        + (floor(EXTRACT(MINUTE FROM (p_ts AT TIME ZONE 'UTC')) / 10)::integer * interval '10 minutes')
    ) AT TIME ZONE 'UTC';
$$;

-- Unique partial index preventing duplicate live screenshot slots in the same 10-min UTC bucket.
-- Manual time slots (is_manual = true) and historical synthesized slots (screenshot_url IS NULL) are excluded and preserved.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_diary_slots_auto_10min_bucket
    ON public.work_diary_slots (
        contract_id,
        freelancer_id,
        public.utc_ten_minute_bucket(slot_time)
    )
    WHERE is_manual = false AND screenshot_url IS NOT NULL;

-- 2. Harden start_timer_session() with weekly_hour_limit validation
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
    v_week_start date;
    v_week_end timestamptz;
    v_existing_week_minutes integer := 0;
    v_session public.active_timer_sessions;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to start a timer session'
            USING ERRCODE = '42501';
    END IF;

    -- Lock contract row first (consistent lock order: contracts -> active_timer_sessions -> time_entries)
    SELECT id, contract_type, status, freelancer_id, weekly_hour_limit
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id
            USING ERRCODE = '23503';
    END IF;

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

    -- Single active timer per freelancer
    IF EXISTS (
        SELECT 1 FROM public.active_timer_sessions
         WHERE freelancer_id = v_actor_id
    ) THEN
        RAISE EXCEPTION 'Freelancer already has an active timer session running'
            USING ERRCODE = '23505';
    END IF;

    -- Enforce weekly_hour_limit before starting a new timer
    IF v_contract.weekly_hour_limit IS NOT NULL AND v_contract.weekly_hour_limit > 0 THEN
        v_week_start := date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')::date;
        v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';

        SELECT COALESCE(SUM(duration_minutes), 0)
          INTO v_existing_week_minutes
          FROM public.time_entries
         WHERE contract_id = v_contract.id
           AND start_time >= (v_week_start AT TIME ZONE 'UTC')
           AND start_time < v_week_end;

        IF v_existing_week_minutes >= (v_contract.weekly_hour_limit * 60) THEN
            RAISE EXCEPTION 'Weekly hour limit (% hours/week) has been reached for this contract', v_contract.weekly_hour_limit
                USING ERRCODE = '22023';
        END IF;
    END IF;

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

REVOKE ALL ON FUNCTION public.start_timer_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_timer_session(uuid, text) TO authenticated;

-- 3. Structured stop_timer_session_v2() returning explicit outcome & discard_reason
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

    SELECT id, contract_id, freelancer_id, start_time, memo
      INTO v_session
      FROM public.active_timer_sessions
     WHERE freelancer_id = v_actor_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active timer session found for current user'
            USING ERRCODE = '22023';
    END IF;

    SELECT id, client_id, company_id, contract_type, status, hourly_rate, weekly_hour_limit
      INTO v_contract
      FROM public.contracts
     WHERE id = v_session.contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
            'outcome', 'discarded',
            'discard_reason', 'contract_ineligible'
        );
    END IF;

    -- P0: Reject billing for any non-active contract status (paused, completed, cancelled, etc.)
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

    -- Enforce 12-hour max single session policy explicitly instead of throwing 23514
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
            -- Keep end_time consistent with chk_time_entry_duration_matches_interval
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
