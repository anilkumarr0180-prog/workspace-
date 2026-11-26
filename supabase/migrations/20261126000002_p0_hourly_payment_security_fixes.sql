-- ==============================================================================
-- Migration: 20261126000002_p0_hourly_payment_security_fixes.sql
-- Description: P0 Hourly Payment Security & Accounting Fixes:
--   1. Enforce weekly_hour_limit inside stop_timer_session() with row-level locking
--   2. Preserve settled ('paid') timesheets as immutable; log new work as unbilled (timesheet_id = NULL)
--   3. Prevent concurrent Stripe/Razorpay double payment attempts per timesheet
-- ==============================================================================

-- 1. Ensure payment_attempts & webhook_events support Stripe and timesheet_id locking
ALTER TABLE public.payment_attempts
    ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_provider_check'
    ) THEN
        ALTER TABLE public.payment_attempts DROP CONSTRAINT payment_attempts_provider_check;
    END IF;
    ALTER TABLE public.payment_attempts
        ADD CONSTRAINT payment_attempts_provider_check CHECK (provider IN ('razorpay', 'stripe', 'simulated'));
EXCEPTION WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_provider_check'
    ) THEN
        ALTER TABLE public.webhook_events DROP CONSTRAINT webhook_events_provider_check;
    END IF;
    ALTER TABLE public.webhook_events
        ADD CONSTRAINT webhook_events_provider_check CHECK (provider IN ('razorpay', 'stripe', 'simulated'));
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- Expire any pre-existing stale attempts older than 15 minutes before creating unique index
UPDATE public.payment_attempts
   SET status = 'failed',
       error_code = 'EXPIRED',
       error_description = 'Expired stale checkout attempt',
       updated_at = now()
 WHERE timesheet_id IS NOT NULL
   AND status IN ('created', 'authorized')
   AND created_at < (now() - interval '15 minutes');

-- Partial unique index: at most ONE active ('created' or 'authorized') attempt per timesheet
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_attempt_per_timesheet
    ON public.payment_attempts (timesheet_id)
    WHERE timesheet_id IS NOT NULL AND status IN ('created', 'authorized');

-- 2. Atomic RPC to acquire a single active payment attempt lock for a timesheet
CREATE OR REPLACE FUNCTION public.acquire_timesheet_payment_attempt(
    p_timesheet_id uuid,
    p_client_id uuid,
    p_provider text,
    p_environment text,
    p_amount numeric,
    p_amount_subunits bigint,
    p_currency text,
    p_temp_order_id text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_attempt public.payment_attempts;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: acquire_timesheet_payment_attempt is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    -- Lock the timesheet row to serialize concurrent checkout attempts
    SELECT * INTO v_timesheet
      FROM public.timesheets
     WHERE id = p_timesheet_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        RAISE EXCEPTION 'Timesheet is already paid' USING ERRCODE = '22023';
    END IF;

    -- Expire stale attempts (> 15 minutes old) so legitimate retries are not permanently blocked
    UPDATE public.payment_attempts
       SET status = 'failed',
           error_code = 'EXPIRED',
           error_description = 'Checkout session expired after 15 minutes',
           updated_at = clock_timestamp()
     WHERE timesheet_id = p_timesheet_id
       AND status IN ('created', 'authorized')
       AND created_at < (clock_timestamp() - interval '15 minutes');

    -- Insert new active attempt; unique index uq_active_payment_attempt_per_timesheet blocks concurrent Stripe/Razorpay runs
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
        v_timesheet.contract_id,
        p_timesheet_id,
        'timesheet',
        p_client_id,
        p_provider,
        p_environment,
        p_temp_order_id,
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

REVOKE ALL ON FUNCTION public.acquire_timesheet_payment_attempt(uuid, uuid, text, text, numeric, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_timesheet_payment_attempt(uuid, uuid, text, text, numeric, bigint, text, text, jsonb) TO service_role;

-- 3. Harden stop_timer_session:
--    - Enforce contract.weekly_hour_limit (with row locking)
--    - Keep 'paid' timesheets immutable (log new entries with timesheet_id = NULL)
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
    v_week_end timestamptz;
    v_existing_week_minutes integer := 0;
    v_remaining_minutes integer;
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

    -- Lock the parent contract row to serialize concurrent timer stops & manual entries
    SELECT id, client_id, company_id, contract_type, status, hourly_rate, weekly_hour_limit
      INTO v_contract
      FROM public.contracts
     WHERE id = v_session.contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced contract % not found', v_session.contract_id
            USING ERRCODE = '23503';
    END IF;

    IF v_contract.status = 'cancelled' THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN NULL;
    END IF;

    v_end_time := clock_timestamp();
    v_duration_seconds := EXTRACT(EPOCH FROM (v_end_time - v_session.start_time));
    IF v_duration_seconds < 0 THEN
        v_duration_seconds := 0;
    END IF;

    -- Discard sessions under 60 seconds cleanly
    IF v_duration_seconds < 60 THEN
        DELETE FROM public.active_timer_sessions WHERE id = v_session.id;
        RETURN NULL;
    END IF;

    v_duration_minutes := GREATEST(1, ROUND(v_duration_seconds / 60)::integer);

    v_final_memo := COALESCE(
        NULLIF(trim(p_memo), ''),
        NULLIF(trim(v_session.memo), ''),
        'Working on hourly deliverables'
    );

    v_week_start := date_trunc('week', v_session.start_time AT TIME ZONE 'UTC')::date;
    v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';

    -- Lock existing weekly timesheet if present
    SELECT *
      INTO v_existing_timesheet
      FROM public.timesheets
     WHERE contract_id = v_contract.id
       AND week_start_date = v_week_start
       FOR UPDATE;

    -- Enforce weekly_hour_limit across ALL logged time_entries in this UTC week
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
            RETURN NULL;
        END IF;

        IF v_duration_minutes > v_remaining_minutes THEN
            v_duration_minutes := v_remaining_minutes;
        END IF;
    END IF;

    -- Settled ('paid') timesheets must remain immutable; log new work as unbilled (timesheet_id = NULL)
    IF FOUND AND v_existing_timesheet.status = 'paid' THEN
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
            'draft',
            now()
        )
        ON CONFLICT (contract_id, week_start_date)
        DO UPDATE SET
            total_minutes = public.timesheets.total_minutes + EXCLUDED.total_minutes,
            total_amount = ROUND(((public.timesheets.total_minutes + EXCLUDED.total_minutes)::numeric / 60.0) * COALESCE(v_contract.hourly_rate, 0), 2),
            status = CASE WHEN public.timesheets.status = 'approved' THEN 'draft' ELSE public.timesheets.status END,
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
            );
        END LOOP;
    END IF;

    DELETE FROM public.active_timer_sessions WHERE id = v_session.id;

    RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.stop_timer_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer_session(text) TO authenticated;

-- 4. Harden log_manual_time:
--    - Lock contract row FOR UPDATE to serialize concurrent submissions
--    - Enforce weekly_hour_limit using SUM(time_entries.duration_minutes)
--    - Keep 'paid' timesheets immutable; log new manual work with timesheet_id = NULL
CREATE OR REPLACE FUNCTION public.log_manual_time(
    p_contract_id uuid,
    p_date date,
    p_start_time time,
    p_end_time time,
    p_memo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_contract RECORD;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_duration_minutes integer;
    v_week_start date;
    v_week_end timestamptz;
    v_existing_minutes integer := 0;
    v_existing_timesheet public.timesheets;
    v_timesheet_id uuid;
    v_entry public.time_entries;
    v_final_memo text;
    v_num_slots integer;
    v_slot_idx integer;
    v_slot_time timestamptz;
    v_slot_mins integer;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to log manual time' USING ERRCODE = '42501';
    END IF;

    v_final_memo := trim(COALESCE(p_memo, ''));
    IF length(v_final_memo) < 3 THEN
        RAISE EXCEPTION 'A descriptive work memo is required (minimum 3 characters)' USING ERRCODE = '22023';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'End time (%) must be later than start time (%)', p_end_time, p_start_time
            USING ERRCODE = '22023';
    END IF;

    v_start_ts := (p_date + p_start_time) AT TIME ZONE 'UTC';
    v_end_ts := (p_date + p_end_time) AT TIME ZONE 'UTC';

    IF v_end_ts > clock_timestamp() THEN
        RAISE EXCEPTION 'Cannot log manual time in the future' USING ERRCODE = '22023';
    END IF;

    v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (v_end_ts - v_start_ts)) / 60)::integer;
    IF v_duration_minutes < 10 THEN
        RAISE EXCEPTION 'Minimum manual time duration is 10 minutes' USING ERRCODE = '22023';
    END IF;

    IF v_duration_minutes > 720 THEN
        RAISE EXCEPTION 'Single manual time entry cannot exceed 12 hours' USING ERRCODE = '22023';
    END IF;

    -- Lock contract row FOR UPDATE to serialize concurrent manual submissions & timer stops
    SELECT id, client_id, company_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit, allow_manual_time
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = 'P0002';
    END IF;

    IF v_contract.freelancer_id <> v_actor_id THEN
        RAISE EXCEPTION 'Unauthorized: Only the assigned freelancer can log time on this contract' USING ERRCODE = '42501';
    END IF;

    IF v_contract.contract_type <> 'hourly' THEN
        RAISE EXCEPTION 'Manual time tracking is only supported on hourly contracts' USING ERRCODE = '22023';
    END IF;

    IF v_contract.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot log time on a contract with status "%"', v_contract.status USING ERRCODE = '22023';
    END IF;

    IF v_contract.allow_manual_time IS FALSE THEN
        RAISE EXCEPTION 'Manual time is not allowed on this contract. Please use the automatic desktop timer.' USING ERRCODE = '22023';
    END IF;

    -- Prevent duplicate or overlapping manual entries on the same contract
    IF EXISTS (
        SELECT 1 FROM public.time_entries te
         WHERE te.contract_id = p_contract_id
           AND te.start_time < v_end_ts
           AND te.end_time > v_start_ts
    ) THEN
        RAISE EXCEPTION 'This time range overlaps with an existing logged session on this contract' USING ERRCODE = '23505';
    END IF;

    v_week_start := date_trunc('week', v_start_ts AT TIME ZONE 'UTC')::date;
    v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';

    -- Enforce weekly_hour_limit across ALL time_entries in this UTC week (billed + unbilled)
    IF v_contract.weekly_hour_limit IS NOT NULL AND v_contract.weekly_hour_limit > 0 THEN
        SELECT COALESCE(SUM(duration_minutes), 0)
          INTO v_existing_minutes
          FROM public.time_entries
         WHERE contract_id = p_contract_id
           AND start_time >= (v_week_start AT TIME ZONE 'UTC')
           AND start_time < v_week_end;

        IF (v_existing_minutes + v_duration_minutes) > (v_contract.weekly_hour_limit * 60) THEN
            RAISE EXCEPTION 'Logging % minutes would exceed the weekly contract limit of % hours (% minutes logged this week)',
                v_duration_minutes, v_contract.weekly_hour_limit, v_existing_minutes
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Lock existing timesheet if present; preserve 'paid' timesheets as immutable
    SELECT *
      INTO v_existing_timesheet
      FROM public.timesheets
     WHERE contract_id = v_contract.id
       AND week_start_date = v_week_start
       FOR UPDATE;

    IF FOUND AND v_existing_timesheet.status = 'paid' THEN
        v_timesheet_id := NULL;
    ELSE
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
            ROUND((v_duration_minutes::numeric / 60.0) * COALESCE(v_contract.hourly_rate, 0), 2),
            'open'
        )
        ON CONFLICT (contract_id, week_start_date) DO UPDATE
           SET total_minutes = public.timesheets.total_minutes + EXCLUDED.total_minutes,
               total_amount = ROUND(((public.timesheets.total_minutes + EXCLUDED.total_minutes)::numeric / 60.0) * COALESCE(v_contract.hourly_rate, 0), 2),
               updated_at = clock_timestamp()
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
        v_start_ts,
        v_end_ts,
        v_duration_minutes,
        v_final_memo,
        'manual'
    )
    RETURNING * INTO v_entry;

    -- Generate 10-minute work diary slots (marked manual)
    v_num_slots := GREATEST(1, CEIL(v_duration_minutes::numeric / 10.0));
    FOR v_slot_idx IN 1..v_num_slots LOOP
        v_slot_time := v_start_ts + ((v_slot_idx - 1) * interval '10 minutes');
        IF v_slot_idx = v_num_slots THEN
            v_slot_mins := v_duration_minutes - ((v_slot_idx - 1) * 10);
            IF v_slot_mins <= 0 THEN v_slot_mins := 10; END IF;
        ELSE
            v_slot_mins := 10;
        END IF;

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
            0,
            0,
            0,
            v_final_memo,
            NULL,
            true
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', v_entry.id,
        'duration_minutes', v_entry.duration_minutes,
        'timesheet_id', v_timesheet_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.log_manual_time(uuid, date, time, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_manual_time(uuid, date, time, time, text) TO authenticated;
