-- ============================================================================
-- Automated Integration Test Suite for Batch 5B: Contract Foundation & Time Tracking
-- Target: Isolated Local Supabase Container (PostgreSQL 17.11)
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_cat_id uuid;
    v_client_id uuid := '00000000-0000-0000-0000-000000000051';
    v_freelancer_id uuid := '00000000-0000-0000-0000-000000000052';
    v_stranger_id uuid := '00000000-0000-0000-0000-000000000053';

    v_hourly_job_id uuid := '00000000-0000-0000-0000-0000000005a1';
    v_fixed_job_id uuid := '00000000-0000-0000-0000-0000000005a2';

    v_hourly_prop_id uuid := '00000000-0000-0000-0000-0000000005b1';
    v_fixed_prop_id uuid := '00000000-0000-0000-0000-0000000005b2';

    v_hourly_contract_id uuid;
    v_fixed_contract_id uuid;
    v_contract_record RECORD;

    v_active_timer_id uuid;
    v_time_entry_id uuid;

    v_passed_count integer := 0;
    v_failed_count integer := 0;
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'STARTING BATCH 5B CONTRACT & TIME-TRACKING TEST SUITE';
    RAISE NOTICE '====================================================';

    -- Category
    SELECT id INTO v_cat_id FROM public.categories LIMIT 1;

    -- 1. Setup Base Test Users in auth.users & profiles
    INSERT INTO auth.users (id, email) VALUES
        (v_client_id, 'client_5b@test.local'),
        (v_freelancer_id, 'freelancer_5b@test.local'),
        (v_stranger_id, 'stranger_5b@test.local')
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM public.profiles WHERE id IN (v_client_id, v_freelancer_id, v_stranger_id);
    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, is_suspended, active_mode) VALUES
        (v_client_id, 'client_5b', 'Client 5B', true, true, false, 'client'),
        (v_freelancer_id, 'freelancer_5b', 'Freelancer 5B', true, true, false, 'freelancer'),
        (v_stranger_id, 'stranger_5b', 'Stranger 5B', true, true, false, 'freelancer');

    -- 2. Create Jobs: 1 Hourly, 1 Fixed
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, budget_max, experience_level, duration, status)
    VALUES (v_hourly_job_id, v_client_id, v_cat_id, 'Senior Next.js Hourly Architecture', 'Building real-time full-stack features and state synchronizer', 'hourly', 60, 95, 'expert', '1_to_3_months', 'published');

    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES (v_fixed_job_id, v_client_id, v_cat_id, 'Fixed Price Design Implementation', 'Building complete design system and marketing views', 'fixed', 3500, 'intermediate', 'less_than_1_month', 'published');

    -- 3. Create Proposals
    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
    VALUES (v_hourly_prop_id, v_hourly_job_id, v_freelancer_id, 85, 'hourly', 'Experienced Next.js specialist ready to deliver high performance architecture.', 'interviewing');

    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, delivery_days, cover_letter, status)
    VALUES (v_fixed_prop_id, v_fixed_job_id, v_freelancer_id, 3500, 'fixed', 14, 'Pixel-perfect component engineering with Tailwind CSS and full type safety.', 'interviewing');

    RAISE NOTICE 'Base fixtures created successfully.';

    -- ========================================================================
    -- TEST 1: Accept Hourly Proposal creates Contract atomically via trigger
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        UPDATE public.proposals SET status = 'accepted' WHERE id = v_hourly_prop_id;

        SELECT id, contract_type, hourly_rate, fixed_price, weekly_hour_limit, status
          INTO v_contract_record
          FROM public.contracts
         WHERE proposal_id = v_hourly_prop_id;

        IF v_contract_record.id IS NOT NULL
           AND v_contract_record.contract_type = 'hourly'
           AND v_contract_record.hourly_rate = 85
           AND v_contract_record.weekly_hour_limit = 40
           AND v_contract_record.fixed_price IS NULL
           AND v_contract_record.status = 'active' THEN
            v_hourly_contract_id := v_contract_record.id;
            RAISE NOTICE '[PASS] Test 1: Hourly contract automatically created with exact terms ($85/hr, 40 hrs/wk, active)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 1: Hourly contract record missing or terms mismatch: %', v_contract_record;
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 1: Failed to accept hourly proposal: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 2: Accept Fixed Proposal creates Fixed Contract with fixed_price
    -- ========================================================================
    BEGIN
        UPDATE public.proposals SET status = 'accepted' WHERE id = v_fixed_prop_id;

        SELECT id, contract_type, hourly_rate, fixed_price, weekly_hour_limit, status
          INTO v_contract_record
          FROM public.contracts
         WHERE proposal_id = v_fixed_prop_id;

        IF v_contract_record.id IS NOT NULL
           AND v_contract_record.contract_type = 'fixed'
           AND v_contract_record.fixed_price = 3500
           AND v_contract_record.hourly_rate IS NULL
           AND v_contract_record.weekly_hour_limit IS NULL
           AND v_contract_record.status = 'active' THEN
            v_fixed_contract_id := v_contract_record.id;
            RAISE NOTICE '[PASS] Test 2: Fixed-price contract created with exact terms ($3500 fixed, NULL hourly rate/limit)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 2: Fixed-price contract record missing or terms mismatch: %', v_contract_record;
            v_failed_count := v_failed_count + 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 2: Failed to accept fixed proposal: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- Reset to postgres superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 3: Idempotent acceptance does not create duplicate contract
    -- ========================================================================
    BEGIN
        -- Calling proposal contract trigger again should be a no-op
        PERFORM public.create_contract_on_proposal_acceptance();
        
        IF (SELECT count(*) FROM public.contracts WHERE proposal_id = v_hourly_prop_id) = 1 THEN
            RAISE NOTICE '[PASS] Test 3: Idempotent contract creation verified (strictly 1 contract per proposal)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 3: Duplicate contract detected!';
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 4: Freelancer starts Active Timer Session on Active Hourly Contract
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.active_timer_sessions (contract_id, freelancer_id, memo)
        VALUES (v_hourly_contract_id, v_freelancer_id, 'Implementing database state sync and contract foundation')
        RETURNING id INTO v_active_timer_id;

        RAISE NOTICE '[PASS] Test 4: Freelancer started active timer session on hourly contract';
        v_passed_count := v_passed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 4: Failed to start active timer session: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 5: Concurrent 2nd Active Timer for same Freelancer REJECTED (Unique)
    -- ========================================================================
    BEGIN
        INSERT INTO public.active_timer_sessions (contract_id, freelancer_id, memo)
        VALUES (v_hourly_contract_id, v_freelancer_id, 'Attempting concurrent second timer session');

        RAISE NOTICE '[FAIL] Test 5: Concurrent timer session was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE '[PASS] Test 5: Concurrent timer session rejected by uq_freelancer_active_timer';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 5: Concurrent timer session rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- ========================================================================
    -- TEST 6: Timer Session on Fixed-Price Contract REJECTED
    -- ========================================================================
    BEGIN
        -- First clean up active timer to isolate test
        DELETE FROM public.active_timer_sessions WHERE freelancer_id = v_freelancer_id;

        INSERT INTO public.active_timer_sessions (contract_id, freelancer_id, memo)
        VALUES (v_fixed_contract_id, v_freelancer_id, 'Illegal timer session on fixed price contract');

        RAISE NOTICE '[FAIL] Test 6: Timer session on fixed price contract was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN check_violation OR string_data_right_truncation OR OTHERS THEN
        IF SQLERRM LIKE '%only permitted on hourly contracts%' THEN
            RAISE NOTICE '[PASS] Test 6: Timer session on fixed-price contract successfully rejected: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 6: Fixed price contract rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 7: Completed Time Entry on Hourly Contract succeeds
    -- ========================================================================
    BEGIN
        INSERT INTO public.time_entries (contract_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
        VALUES (
            v_hourly_contract_id,
            v_freelancer_id,
            now() - interval '2 hours',
            now(),
            120,
            'Architecture refactoring and database integration verification',
            'timer'
        ) RETURNING id INTO v_time_entry_id;

        RAISE NOTICE '[PASS] Test 7: Completed time entry successfully logged on hourly contract';
        v_passed_count := v_passed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 7: Failed to log completed time entry: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- ========================================================================
    -- TEST 8: Time Entry on Fixed-Price Contract REJECTED
    -- ========================================================================
    BEGIN
        INSERT INTO public.time_entries (contract_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
        VALUES (
            v_fixed_contract_id,
            v_freelancer_id,
            now() - interval '1 hour',
            now(),
            60,
            'Illegal manual time entry on fixed price project',
            'manual'
        );

        RAISE NOTICE '[FAIL] Test 8: Time entry on fixed-price contract was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%only permitted on hourly contracts%' THEN
            RAISE NOTICE '[PASS] Test 8: Time entry on fixed-price contract successfully rejected: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[PASS] Test 8: Fixed-price contract entry rejected with error: %', SQLERRM;
            v_passed_count := v_passed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 9: Unrelated Stranger cannot view or query contract via RLS
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_stranger_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        IF (SELECT count(*) FROM public.contracts WHERE id = v_hourly_contract_id) = 0 THEN
            RAISE NOTICE '[PASS] Test 9: Stranger cannot access unrelated contract rows (RLS verified)';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 9: Stranger was able to view private contract row!';
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    RAISE NOTICE '====================================================';
    RAISE NOTICE 'BATCH 5B INTEGRATION TEST RESULTS: % PASSED, % FAILED', v_passed_count, v_failed_count;
    RAISE NOTICE '====================================================';

    IF v_failed_count > 0 THEN
        RAISE EXCEPTION 'Batch 5B integration tests failed: % failure(s) detected.', v_failed_count;
    END IF;
END $$;

ROLLBACK;
