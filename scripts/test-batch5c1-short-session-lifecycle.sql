-- ============================================================================
-- BATCH 5C.1 REGRESSION TEST SUITE: SHORT-SESSION CLEANUP & TIMER LIFECYCLE
-- ============================================================================
-- Tests:
-- 1. Under-60-second stop clears the active session in a single transaction.
-- 2. No time entry or billable minutes are created for that short session.
-- 3. Freelancer can immediately start a new timer without constraint conflict.
-- 4. Normal stop (>= 60s) creates exactly one entry and updates timesheet totals.
-- 5. Duplicate stop requests are safely rejected without duplicate entries.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_freelancer_id uuid := '11111111-2222-3333-4444-555555555555'::uuid;
    v_client_id uuid := '66666666-7777-8888-9999-000000000000'::uuid;
    v_category_id uuid;
    v_job_id uuid;
    v_hourly_prop_id uuid;
    v_hourly_contract_id uuid;
    v_session RECORD;
    v_entry RECORD;
    v_entry_res public.time_entries;
    v_timesheet RECORD;
    v_passed_count integer := 0;
    v_failed_count integer := 0;
    v_initial_entries_count integer;
    v_initial_timesheets_count integer;
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'STARTING BATCH 5C.1 TIMER LIFECYCLE REGRESSION SUITE';
    RAISE NOTICE '====================================================';

    -- 0. Set up test environment fixtures
    SELECT id INTO v_category_id FROM public.categories LIMIT 1;
    IF v_category_id IS NULL THEN
        INSERT INTO public.categories (name, slug)
        VALUES ('Lifecycle Testing Cat', 'lifecycle-testing-cat')
        RETURNING id INTO v_category_id;
    END IF;

    -- Auth users
    INSERT INTO auth.users (id, email) VALUES
        (v_client_id, 'lifecycle_client@test.local'),
        (v_freelancer_id, 'lifecycle_free@test.local')
    ON CONFLICT (id) DO NOTHING;

    -- Profiles
    DELETE FROM public.profiles WHERE id IN (v_client_id, v_freelancer_id);
    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, is_suspended, active_mode) VALUES
        (v_client_id, 'lifecycle_client', 'Lifecycle Client', true, true, false, 'client'),
        (v_freelancer_id, 'lifecycle_free', 'Lifecycle Freelancer', true, true, false, 'freelancer');

    -- Job
    INSERT INTO public.jobs (
        client_id, category_id, title, description, project_type, budget_min, budget_max, duration, experience_level, status
    ) VALUES (
        v_client_id, v_category_id, 'Production Timer Lifecycle Audit',
        'Testing database short session discard, normal stop atomicity, and active session cleanup.',
        'hourly', 80, 110, '1_to_3_months', 'expert', 'published'
    ) RETURNING id INTO v_job_id;

    -- Proposal
    INSERT INTO public.proposals (
        job_id, freelancer_id, rate_type, bid_amount, cover_letter, status
    ) VALUES (
        v_job_id, v_freelancer_id, 'hourly', 95.00,
        'Senior platform engineer with comprehensive experience testing PostgreSQL PL/pgSQL atomic state transitions and security hardening.',
        'interviewing'
    ) RETURNING id INTO v_hourly_prop_id;

    -- Client accepts proposal as authenticated client
    PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    UPDATE public.proposals SET status = 'accepted' WHERE id = v_hourly_prop_id;

    PERFORM set_config('role', 'postgres', true);

    SELECT id INTO v_hourly_contract_id FROM public.contracts WHERE proposal_id = v_hourly_prop_id;
    IF v_hourly_contract_id IS NULL THEN
        RAISE EXCEPTION 'Fixture hourly contract not generated';
    END IF;

    SELECT count(*) INTO v_initial_entries_count FROM public.time_entries WHERE freelancer_id = v_freelancer_id;
    SELECT count(*) INTO v_initial_timesheets_count FROM public.timesheets WHERE freelancer_id = v_freelancer_id;

    RAISE NOTICE 'Base fixtures created successfully. Hourly contract: %', v_hourly_contract_id;

    -- ========================================================================
    -- TEST 1: Under-60-second stop clears active session atomically without exception
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Start timer
        SELECT * INTO v_session FROM public.start_timer_session(v_hourly_contract_id, 'Short test session under 60 seconds');

        IF v_session.id IS NULL THEN
            RAISE NOTICE '[FAIL] Test 1: Failed to start initial timer session';
            v_failed_count := v_failed_count + 1;
        ELSE
            -- Stop timer immediately (< 60 seconds elapsed)
            SELECT * INTO v_entry_res FROM public.stop_timer_session('Short test stop');

            -- Verify return is NULL (no billable entry)
            IF v_entry_res.id IS NULL THEN
                -- Verify active session is removed from active_timer_sessions
                IF (SELECT count(*) FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id) = 0 THEN
                    RAISE NOTICE '[PASS] Test 1: Under-60-second stop returned NULL and cleared active_timer_sessions';
                    v_passed_count := v_passed_count + 1;
                ELSE
                    RAISE NOTICE '[FAIL] Test 1: Active session row was not cleared from active_timer_sessions!';
                    v_failed_count := v_failed_count + 1;
                END IF;
            ELSE
                RAISE NOTICE '[FAIL] Test 1: Short session returned non-null time entry: %', v_entry_res;
                v_failed_count := v_failed_count + 1;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 1: Unexpected exception on short stop: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 2: No time entry or billable minutes created for short session
    -- ========================================================================
    BEGIN
        IF (SELECT count(*) FROM public.time_entries WHERE freelancer_id = v_freelancer_id) = v_initial_entries_count
           AND (SELECT count(*) FROM public.timesheets WHERE freelancer_id = v_freelancer_id) = v_initial_timesheets_count THEN
            RAISE NOTICE '[PASS] Test 2: Exactly 0 time entries and 0 timesheets created for short session';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 2: Time entries or timesheets were created unexpectedly for short session';
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 3: Freelancer can immediately start a new timer
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        SELECT * INTO v_session FROM public.start_timer_session(v_hourly_contract_id, 'New session immediately after short session');

        IF v_session.id IS NOT NULL AND (SELECT count(*) FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id) = 1 THEN
            RAISE NOTICE '[PASS] Test 3: Freelancer immediately started new timer without conflict';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 3: Failed to start new timer immediately after short session';
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 3: Starting new timer failed with error: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 4: Normal stop (>= 60s) creates exactly one entry and updates totals
    -- ========================================================================
    BEGIN
        -- Simulate 75 minutes of work as postgres superuser
        PERFORM set_config('role', 'postgres', true);
        UPDATE public.active_timer_sessions
           SET start_time = now() - interval '75 minutes'
         WHERE id = v_session.id;

        -- Stop timer as authenticated freelancer
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        SELECT * INTO v_entry FROM public.stop_timer_session('Finished normal 75 min deliverable');

        IF v_entry.id IS NOT NULL AND v_entry.duration_minutes = 75 THEN
            -- Verify active session deleted
            IF (SELECT count(*) FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id) = 0 THEN
                -- Verify timesheet updated accurately
                SELECT * INTO v_timesheet FROM public.timesheets WHERE id = v_entry.timesheet_id;
                IF v_timesheet.total_minutes = 75 AND v_timesheet.total_amount = ROUND((75.0 / 60.0) * 95, 2) THEN
                    RAISE NOTICE '[PASS] Test 4: Normal stop created entry (75m, $%), updated timesheet, and cleared active session', v_timesheet.total_amount;
                    v_passed_count := v_passed_count + 1;
                ELSE
                    RAISE NOTICE '[FAIL] Test 4: Timesheet total mismatch: %', v_timesheet;
                    v_failed_count := v_failed_count + 1;
                END IF;
            ELSE
                RAISE NOTICE '[FAIL] Test 4: Active session not removed after normal stop';
                v_failed_count := v_failed_count + 1;
            END IF;
        ELSE
            RAISE NOTICE '[FAIL] Test 4: Normal stop failed to produce entry with 75 minutes: %', v_entry;
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 4: Normal stop failed with error: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 5: Duplicate stop request safely rejected without duplicate entries
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Try stopping again when no session is active
        PERFORM public.stop_timer_session();

        RAISE NOTICE '[FAIL] Test 5: Duplicate stop was permitted when no active session existed!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%No active timer session found%' THEN
            -- Check entry count is still exactly initial + 1
            IF (SELECT count(*) FROM public.time_entries WHERE freelancer_id = v_freelancer_id) = (v_initial_entries_count + 1) THEN
                RAISE NOTICE '[PASS] Test 5: Duplicate stop safely rejected with "No active timer session found" and 0 duplicate entries';
                v_passed_count := v_passed_count + 1;
            ELSE
                RAISE NOTICE '[FAIL] Test 5: Duplicate entries were detected after failed duplicate stop';
                v_failed_count := v_failed_count + 1;
            END IF;
        ELSE
            RAISE NOTICE '[FAIL] Test 5: Unexpected error message: %', SQLERRM;
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    RAISE NOTICE '====================================================';
    RAISE NOTICE 'BATCH 5C.1 TEST RESULTS: % PASSED, % FAILED', v_passed_count, v_failed_count;
    RAISE NOTICE '====================================================';

    IF v_failed_count > 0 THEN
        RAISE EXCEPTION 'Batch 5C.1 regression tests failed: % failure(s)', v_failed_count;
    END IF;
END $$;

ROLLBACK;
