-- Migration: 20261103000007_work_diary_and_manual_time_tracking.sql
-- Description: Upwork Work Diary: 10-minute activity blocks, activity score & input tracking,
--              desktop screenshot simulations, manual time logging, and slot deletion.

-- ============================================================================
-- 1. WORK DIARY SLOTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.work_diary_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    time_entry_id uuid REFERENCES public.time_entries(id) ON DELETE CASCADE,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    slot_time timestamptz NOT NULL,
    duration_minutes integer NOT NULL DEFAULT 10 CHECK (duration_minutes > 0 AND duration_minutes <= 60),
    activity_score integer NOT NULL DEFAULT 8 CHECK (activity_score BETWEEN 0 AND 10),
    keystrokes_count integer NOT NULL DEFAULT 350 CHECK (keystrokes_count >= 0),
    mouse_clicks_count integer NOT NULL DEFAULT 90 CHECK (mouse_clicks_count >= 0),
    memo text NOT NULL DEFAULT '',
    screenshot_url text,
    is_manual boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_diary_slots IS 'Upwork 10-minute work diary segments recording activity level, input counts, memo, and screenshot snapshots.';

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_work_diary_contract_slot 
    ON public.work_diary_slots (contract_id, slot_time DESC);

CREATE INDEX IF NOT EXISTS idx_work_diary_freelancer_slot 
    ON public.work_diary_slots (freelancer_id, slot_time DESC);

CREATE INDEX IF NOT EXISTS idx_work_diary_time_entry 
    ON public.work_diary_slots (time_entry_id);

CREATE INDEX IF NOT EXISTS idx_work_diary_slot_day 
    ON public.work_diary_slots (contract_id, ((slot_time AT TIME ZONE 'UTC')::date));

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE public.work_diary_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_diary_select_involved ON public.work_diary_slots;
CREATE POLICY work_diary_select_involved
    ON public.work_diary_slots
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = work_diary_slots.contract_id
               AND (
                   c.client_id = auth.uid()
                   OR (
                       c.company_id IS NOT NULL
                       AND c.company_id IN (SELECT get_my_company_ids())
                   )
               )
        )
    );

DROP POLICY IF EXISTS work_diary_insert_freelancer ON public.work_diary_slots;
CREATE POLICY work_diary_insert_freelancer
    ON public.work_diary_slots
    FOR INSERT
    TO authenticated
    WITH CHECK (freelancer_id = auth.uid());

DROP POLICY IF EXISTS work_diary_delete_freelancer ON public.work_diary_slots;
CREATE POLICY work_diary_delete_freelancer
    ON public.work_diary_slots
    FOR DELETE
    TO authenticated
    USING (freelancer_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.work_diary_slots TO authenticated;

-- ============================================================================
-- 4. ENHANCE STOP_TIMER_SESSION TO GENERATE WORK DIARY SLOTS
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
    -- Work diary generation variables
    v_num_slots integer;
    v_slot_idx integer;
    v_slot_time timestamptz;
    v_slot_mins integer;
    v_sim_score integer;
    v_sim_keys integer;
    v_sim_mouse integer;
BEGIN
    -- 1. Authentication check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to stop a timer session'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Lock and retrieve the caller's active session atomically
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

    -- If duration is less than 60 seconds (1 minute), discard session cleanly
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

    -- 8. Generate 10-Minute Upwork Work Diary Slots
    v_num_slots := GREATEST(1, CEIL(v_duration_minutes::numeric / 10.0));
    FOR v_slot_idx IN 1..v_num_slots LOOP
        v_slot_time := v_session.start_time + ((v_slot_idx - 1) * interval '10 minutes');
        IF v_slot_idx = v_num_slots THEN
            v_slot_mins := v_duration_minutes - ((v_slot_idx - 1) * 10);
            IF v_slot_mins <= 0 THEN v_slot_mins := 10; END IF;
        ELSE
            v_slot_mins := 10;
        END IF;

        -- Deterministic realistic activity level based on timestamps (7-10)
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

    -- 9. Remove active timer session row
    DELETE FROM public.active_timer_sessions WHERE id = v_session.id;

    RETURN v_entry;
END;
$$;

-- ============================================================================
-- 5. ATOMIC STORED PROCEDURE: LOG MANUAL TIME
-- ============================================================================
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
    v_timesheet_id uuid;
    v_existing_minutes integer := 0;
    v_entry public.time_entries;
    v_final_memo text;
    -- Slot generation variables
    v_num_slots integer;
    v_slot_idx integer;
    v_slot_time timestamptz;
    v_slot_mins integer;
BEGIN
    -- 1. Authentication check
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to log manual time' USING ERRCODE = '42501';
    END IF;

    -- 2. Validate input strings
    v_final_memo := trim(COALESCE(p_memo, ''));
    IF length(v_final_memo) < 3 THEN
        RAISE EXCEPTION 'A descriptive work memo is required (minimum 3 characters)' USING ERRCODE = '22023';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'End time (%) must be later than start time (%)', p_end_time, p_start_time
            USING ERRCODE = '22023';
    END IF;

    -- Construct exact timestamptz (UTC normalized)
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

    -- 3. Read parent contract authoritatively
    SELECT id, client_id, company_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit, allow_manual_time
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id;

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

    -- 4. Check for overlapping time entries on the same contract
    IF EXISTS (
        SELECT 1 FROM public.time_entries te
         WHERE te.contract_id = p_contract_id
           AND te.start_time < v_end_ts
           AND te.end_time > v_start_ts
    ) THEN
        RAISE EXCEPTION 'This time range overlaps with an existing logged session on this contract' USING ERRCODE = '23505';
    END IF;

    -- 5. Weekly Period and Limit Verification
    v_week_start := date_trunc('week', v_start_ts AT TIME ZONE 'UTC')::date;

    IF v_contract.weekly_hour_limit IS NOT NULL AND v_contract.weekly_hour_limit > 0 THEN
        SELECT COALESCE(total_minutes, 0)
          INTO v_existing_minutes
          FROM public.timesheets
         WHERE contract_id = p_contract_id
           AND week_start_date = v_week_start;

        IF (v_existing_minutes + v_duration_minutes) > (v_contract.weekly_hour_limit * 60) THEN
            RAISE EXCEPTION 'Logging % minutes would exceed the weekly contract limit of % hours (% minutes logged this week)',
                v_duration_minutes, v_contract.weekly_hour_limit, v_existing_minutes
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 6. Upsert Timesheet atomically for this week
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

    -- 7. Insert completed Time Entry with source = 'manual'
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

    -- 8. Generate 10-minute work diary segments marked as manual time
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
            0, -- Manual time has no desktop activity score
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
        'duration_minutes', v_duration_minutes,
        'timesheet_id', v_timesheet_id
    );
END;
$$;

-- ============================================================================
-- 6. ATOMIC STORED PROCEDURE: DELETE WORK DIARY SLOT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_work_diary_slot(
    p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_slot RECORD;
    v_contract RECORD;
    v_time_entry RECORD;
    v_mins integer;
    v_hourly_rate numeric(10,2);
    v_amount_deduction numeric(12,2);
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Retrieve slot and verify ownership
    SELECT id, contract_id, time_entry_id, freelancer_id, duration_minutes, slot_time
      INTO v_slot
      FROM public.work_diary_slots
     WHERE id = p_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work diary slot % not found', p_slot_id USING ERRCODE = 'P0002';
    END IF;

    IF v_slot.freelancer_id <> v_actor_id THEN
        RAISE EXCEPTION 'Unauthorized: You can only remove your own work diary slots' USING ERRCODE = '42501';
    END IF;

    v_mins := v_slot.duration_minutes;

    -- Read contract hourly rate
    SELECT hourly_rate INTO v_hourly_rate
      FROM public.contracts
     WHERE id = v_slot.contract_id;

    v_amount_deduction := ROUND((v_mins::numeric / 60.0) * COALESCE(v_hourly_rate, 0), 2);

    -- Update or delete the linked time entry
    IF v_slot.time_entry_id IS NOT NULL THEN
        SELECT id, timesheet_id, duration_minutes
          INTO v_time_entry
          FROM public.time_entries
         WHERE id = v_slot.time_entry_id;

        IF FOUND THEN
            IF (v_time_entry.duration_minutes - v_mins) <= 0 THEN
                DELETE FROM public.time_entries WHERE id = v_time_entry.id;
            ELSE
                UPDATE public.time_entries
                   SET duration_minutes = duration_minutes - v_mins
                 WHERE id = v_time_entry.id;
            END IF;

            -- Deduct from timesheet
            IF v_time_entry.timesheet_id IS NOT NULL THEN
                UPDATE public.timesheets
                   SET total_minutes = GREATEST(0, total_minutes - v_mins),
                       total_amount = GREATEST(0, total_amount - v_amount_deduction),
                       updated_at = clock_timestamp()
                 WHERE id = v_time_entry.timesheet_id;
            END IF;
        END IF;
    END IF;

    -- Delete the slot
    DELETE FROM public.work_diary_slots WHERE id = p_slot_id;

    RETURN jsonb_build_object(
        'success', true,
        'slot_id', p_slot_id,
        'deducted_minutes', v_mins
    );
END;
$$;

-- ============================================================================
-- 7. EXECUTION PERMISSIONS
-- ============================================================================
REVOKE ALL ON FUNCTION public.stop_timer_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer_session(text) TO authenticated;

REVOKE ALL ON FUNCTION public.log_manual_time(uuid, date, time, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_manual_time(uuid, date, time, time, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_work_diary_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_work_diary_slot(uuid) TO authenticated;
