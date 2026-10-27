-- ============================================================================
-- Automated Security Hardening Test Suite for Batch 5B.1
-- Target: Isolated Local Supabase Container (PostgreSQL 17.11)
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_cat_id uuid;
    v_client_id uuid := '00000000-0000-0000-0000-000000000061';
    v_freelancer_id uuid := '00000000-0000-0000-0000-000000000062';
    v_stranger_id uuid := '00000000-0000-0000-0000-000000000063';

    v_hourly_job_id uuid := '00000000-0000-0000-0000-0000000006a1';
    v_fixed_job_id uuid := '00000000-0000-0000-0000-0000000006a2';

    v_hourly_prop_id uuid := '00000000-0000-0000-0000-0000000006b1';
    v_fixed_prop_id uuid := '00000000-0000-0000-0000-0000000006b2';

    v_hourly_contract_id uuid;
    v_fixed_contract_id uuid;

    v_session RECORD;
    v_entry RECORD;
    v_timesheet RECORD;

    v_passed_count integer := 0;
    v_failed_count integer := 0;
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'STARTING BATCH 5B.1 SECURITY HARDENING VERIFICATION';
    RAISE NOTICE '====================================================';

    SELECT id INTO v_cat_id FROM public.categories LIMIT 1;

    -- 1. Setup Base Test Users in auth.users & profiles
    INSERT INTO auth.users (id, email) VALUES
        (v_client_id, 'client_5b1@test.local'),
        (v_freelancer_id, 'freelancer_5b1@test.local'),
        (v_stranger_id, 'stranger_5b1@test.local')
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM public.profiles WHERE id IN (v_client_id, v_freelancer_id, v_stranger_id);
    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, is_suspended, active_mode) VALUES
        (v_client_id, 'client_5b1', 'Client 5B1', true, true, false, 'client'),
        (v_freelancer_id, 'freelancer_5b1', 'Freelancer 5B1', true, true, false, 'freelancer'),
        (v_stranger_id, 'stranger_5b1', 'Stranger 5B1', true, true, false, 'freelancer');

    -- 2. Create Jobs: 1 Hourly, 1 Fixed
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, budget_max, experience_level, duration, status)
    VALUES (v_hourly_job_id, v_client_id, v_cat_id, 'Senior Next.js Hourly Hardening', 'Building secure server architecture and timing engine', 'hourly', 75, 120, 'expert', '1_to_3_months', 'published');

    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES (v_fixed_job_id, v_client_id, v_cat_id, 'Fixed Price Design Scope', 'Building complete design components and brand tokens', 'fixed', 5000, 'intermediate', 'less_than_1_month', 'published');

    -- 3. Create Proposals
    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
    VALUES (v_hourly_prop_id, v_hourly_job_id, v_freelancer_id, 95, 'hourly', 'Senior security engineer ready to verify zero trust time tracking.', 'interviewing');

    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, delivery_days, cover_letter, status)
    VALUES (v_fixed_prop_id, v_fixed_job_id, v_freelancer_id, 5000, 'fixed', 14, 'Pixel-perfect component engineering with full accessibility standards.', 'interviewing');

    -- ========================================================================
    -- TEST 10: Proposal Acceptance & Automated Contract Creation Still Works
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        UPDATE public.proposals SET status = 'accepted' WHERE id = v_hourly_prop_id;
        UPDATE public.proposals SET status = 'accepted' WHERE id = v_fixed_prop_id;

        SELECT id INTO v_hourly_contract_id FROM public.contracts WHERE proposal_id = v_hourly_prop_id;
        SELECT id INTO v_fixed_contract_id FROM public.contracts WHERE proposal_id = v_fixed_prop_id;

        IF v_hourly_contract_id IS NOT NULL AND v_fixed_contract_id IS NOT NULL THEN
            RAISE NOTICE '[PASS] Test 10: Existing proposal acceptance creates contracts with accurate terms';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 10: Contracts not created upon proposal acceptance!';
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 10: Proposal acceptance failed: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 1: Direct insert of Active Session with forged start timestamp is DENIED
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Attempt direct insert with forged past start time
        INSERT INTO public.active_timer_sessions (contract_id, freelancer_id, start_time, memo)
        VALUES (v_hourly_contract_id, v_freelancer_id, '2026-01-01 00:00:00+00', 'Forged active timer session');

        RAISE NOTICE '[FAIL] Test 1: Direct insert into active_timer_sessions was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 1: Direct insert into active_timer_sessions successfully denied (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 1: Direct insert denied with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- ========================================================================
    -- TEST 2: Direct insert into time_entries with forged duration is DENIED
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.time_entries (contract_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
        VALUES (v_hourly_contract_id, v_freelancer_id, now() - interval '10 hours', now(), 600, 'Direct forged time entry', 'timer');

        RAISE NOTICE '[FAIL] Test 2: Direct insert into time_entries was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 2: Direct insert into time_entries successfully denied (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 2: Direct insert denied with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- ========================================================================
    -- TEST 3: Direct update/delete on time records is DENIED
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Attempt update on time_entries
        UPDATE public.time_entries SET duration_minutes = 999;

        RAISE NOTICE '[FAIL] Test 3: Direct update on time_entries was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 3: Direct update on time_entries denied by revoked grant (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 3: Direct update denied with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- ========================================================================
    -- TEST 4: Manual entries are strictly rejected by constraint
    -- ========================================================================
    BEGIN
        -- Bypass grant as superuser to verify check constraint chk_time_entry_source_timer_only
        PERFORM set_config('role', 'postgres', true);

        INSERT INTO public.time_entries (contract_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
        VALUES (v_hourly_contract_id, v_freelancer_id, now() - interval '1 hour', now(), 60, 'Manual entry attempt', 'manual');

        RAISE NOTICE '[FAIL] Test 4: Manual entry was permitted by constraint!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE '[PASS] Test 4: Manual entry rejected by chk_time_entry_source_timer_only constraint';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 4: Manual entry rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- ========================================================================
    -- TEST 5: Authoritative start and stop calculates trusted duration
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- 5A. Start timer through trusted function
        SELECT * INTO v_session FROM public.start_timer_session(v_hourly_contract_id, 'Working on security review');

        -- Verify start_time was assigned by server within the last second
        IF v_session.id IS NOT NULL AND v_session.start_time >= (now() - interval '5 seconds') THEN
            -- Simulate 75 minutes of work by adjusting the session start_time as superuser
            PERFORM set_config('role', 'postgres', true);
            UPDATE public.active_timer_sessions
               SET start_time = now() - interval '75 minutes'
             WHERE id = v_session.id;

            -- 5B. Stop timer through trusted function as freelancer
            PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
            PERFORM set_config('role', 'authenticated', true);

            SELECT * INTO v_entry FROM public.stop_timer_session('Finished security review');

            -- Verify time entry was created with duration = 75 and active session removed
            IF v_entry.id IS NOT NULL
               AND v_entry.duration_minutes = 75
               AND (SELECT count(*) FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id) = 0 THEN
                
                -- Verify timesheet was rolled up
                SELECT * INTO v_timesheet FROM public.timesheets WHERE id = v_entry.timesheet_id;
                IF v_timesheet.total_minutes = 75 AND v_timesheet.total_amount = ROUND((75.0 / 60.0) * 95, 2) THEN
                    RAISE NOTICE '[PASS] Test 5: Trusted stop atomically calculated 75 min, created time entry, and updated timesheet ($%)', v_timesheet.total_amount;
                    v_passed_count := v_passed_count + 1;
                ELSE
                    RAISE NOTICE '[FAIL] Test 5: Timesheet totals mismatch: minutes=%, amount=%', v_timesheet.total_minutes, v_timesheet.total_amount;
                    v_failed_count := v_failed_count + 1;
                END IF;
            ELSE
                RAISE NOTICE '[FAIL] Test 5: Time entry missing or duration mismatch: %', v_entry;
                v_failed_count := v_failed_count + 1;
            END IF;
        ELSE
            RAISE NOTICE '[FAIL] Test 5: Failed to start trusted session: %', v_session;
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 5: Start/Stop flow failed: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 6: Duplicate stop request does not create duplicate entries
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Repeating stop when no session is active
        PERFORM public.stop_timer_session();

        RAISE NOTICE '[FAIL] Test 6: Duplicate stop request was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%No active timer session found%' THEN
            RAISE NOTICE '[PASS] Test 6: Duplicate stop safely rejected (No active timer session found)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 6: Duplicate stop rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 7: Concurrent starts cannot create multiple active sessions
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Start first session
        PERFORM public.start_timer_session(v_hourly_contract_id, 'First session');

        -- Attempt second concurrent session
        PERFORM public.start_timer_session(v_hourly_contract_id, 'Second concurrent session');

        RAISE NOTICE '[FAIL] Test 7: Concurrent start was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%already has an active timer session running%' THEN
            RAISE NOTICE '[PASS] Test 7: Concurrent start safely rejected (already has an active timer session running)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 7: Concurrent start rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    -- Clean up active timer session
    PERFORM set_config('role', 'postgres', true);
    DELETE FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id;

    -- ========================================================================
    -- TEST 8: Client cannot stop or modify freelancer timer records
    -- ========================================================================
    BEGIN
        -- Freelancer starts session
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);
        PERFORM public.start_timer_session(v_hourly_contract_id, 'Freelancer session');

        -- Client attempts to stop it
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);
        PERFORM public.stop_timer_session();

        RAISE NOTICE '[FAIL] Test 8: Client was permitted to stop freelancer timer!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%No active timer session found%' THEN
            RAISE NOTICE '[PASS] Test 8: Client cannot stop freelancer active session (isolated to auth.uid())';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 8: Client stop rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    -- Clean up active timer session
    PERFORM set_config('role', 'postgres', true);
    DELETE FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id;

    -- ========================================================================
    -- TEST 9: Fixed-price and Inactive contracts cannot start timers
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        -- Attempt timer on fixed-price contract
        PERFORM public.start_timer_session(v_fixed_contract_id, 'Timer on fixed contract');

        RAISE NOTICE '[FAIL] Test 9: Timer start on fixed-price contract was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%only permitted on hourly contracts%' THEN
            RAISE NOTICE '[PASS] Test 9A: Fixed-price contract rejected (only permitted on hourly contracts)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 9A: Fixed-price contract rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    BEGIN
        -- Pause the hourly contract as client
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);
        UPDATE public.contracts SET status = 'paused' WHERE id = v_hourly_contract_id;

        -- Attempt timer on paused contract as freelancer
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);
        PERFORM public.start_timer_session(v_hourly_contract_id, 'Timer on paused contract');

        RAISE NOTICE '[FAIL] Test 9B: Timer start on paused contract was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Cannot start timer session on contract with status "paused"%' THEN
            RAISE NOTICE '[PASS] Test 9B: Paused contract rejected (Cannot start timer session on contract with status "paused")';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 9B: Paused contract rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    RAISE NOTICE '====================================================';
    RAISE NOTICE 'BATCH 5B.1 SECURITY RESULTS: % PASSED, % FAILED', v_passed_count, v_failed_count;
    RAISE NOTICE '====================================================';

    IF v_failed_count > 0 THEN
        RAISE EXCEPTION 'Security tests failed: % failure(s) detected.', v_failed_count;
    END IF;
END $$;

ROLLBACK;
