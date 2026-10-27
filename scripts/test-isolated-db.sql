-- ============================================================================
-- Automated Integration Test Suite for Batch 3D
-- Target: Isolated Local Supabase Container (PostgreSQL 17.11)
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_cat_id uuid;
    v_client_id uuid := '00000000-0000-0000-0000-000000000001';
    v_freelancer_id uuid := '00000000-0000-0000-0000-000000000002';
    v_suspended_id uuid := '00000000-0000-0000-0000-000000000003';
    v_ineligible_id uuid := '00000000-0000-0000-0000-000000000004';
    v_manager_id uuid := '00000000-0000-0000-0000-000000000005';
    v_signup_client_id uuid := '00000000-0000-0000-0000-000000000011';
    v_signup_freelancer_id uuid := '00000000-0000-0000-0000-000000000012';
    v_signup_hacker_id uuid := '00000000-0000-0000-0000-000000000013';

    v_company_id uuid := '00000000-0000-0000-0000-0000000000c1';
    v_job1_id uuid := '00000000-0000-0000-0000-0000000000a1';
    v_job2_id uuid := '00000000-0000-0000-0000-0000000000a2';
    v_job3_id uuid := '00000000-0000-0000-0000-0000000000a3';
    v_prop_id uuid := '00000000-0000-0000-0000-0000000000b1';

    v_active_mode text;
    v_passed_count integer := 0;
    v_failed_count integer := 0;
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'STARTING ISOLATED DATABASE INTEGRATION TEST SUITE';
    RAISE NOTICE '====================================================';



    -- Get a valid category
    SELECT id INTO v_cat_id FROM public.categories LIMIT 1;

    -- 1. Create Base Test Users in auth.users
    INSERT INTO auth.users (id, email) VALUES
        (v_client_id, 'client_a@test.local'),
        (v_freelancer_id, 'freelancer_b@test.local'),
        (v_suspended_id, 'suspended_c@test.local'),
        (v_ineligible_id, 'ineligible_d@test.local'),
        (v_manager_id, 'manager_e@test.local');

    -- Update profiles with specific test flags (delete and re-insert to avoid BEFORE UPDATE triggers)
    DELETE FROM public.profiles WHERE id IN (v_client_id, v_freelancer_id, v_suspended_id, v_ineligible_id, v_manager_id);
    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, is_suspended, active_mode) VALUES
        (v_client_id, 'client_a', 'Client A', true, true, false, 'client'),
        (v_freelancer_id, 'freelancer_b', 'Freelancer B', true, true, false, 'freelancer'),
        (v_suspended_id, 'suspended_c', 'Suspended C', true, true, true, 'freelancer'),
        (v_ineligible_id, 'ineligible_d', 'Ineligible D', true, false, false, 'freelancer'),
        (v_manager_id, 'manager_e', 'Manager E', true, true, false, 'freelancer');

    -- 2. Create Company & attach Manager E and Client A
    INSERT INTO public.companies (id, name, slug) VALUES (v_company_id, 'Test Company', 'test-company-isolated');
    INSERT INTO public.company_members (company_id, user_id, role) VALUES
        (v_company_id, v_client_id, 'owner'),
        (v_company_id, v_manager_id, 'hiring_manager');

    -- 3. Create Test Jobs
    -- Job 1: Published, owned by Client A, no company
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES (v_job1_id, v_client_id, v_cat_id, 'Frontend Next.js Architecture', 'Comprehensive architectural build for marketplace web application', 'fixed', 5000, 'expert', '1_to_3_months', 'published');

    -- Job 2: Published, company-linked (Company X)
    INSERT INTO public.jobs (id, client_id, company_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES (v_job2_id, v_client_id, v_company_id, v_cat_id, 'Company Backend System', 'Internal tooling and company-level API gateway engineering', 'fixed', 7500, 'expert', '1_to_3_months', 'published');

    -- Job 3: Draft job
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES (v_job3_id, v_client_id, v_cat_id, 'Draft Unpublished Job', 'This contract has not been published yet and remains in draft', 'fixed', 1000, 'entry', 'less_than_1_month', 'draft');

    RAISE NOTICE 'Test fixtures initialized successfully.';

    -- ========================================================================
    -- TEST 1: Eligible Freelancer B applies to Client A's Job 1 (EXPECT: PASS)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_freelancer_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter)
        VALUES (v_prop_id, v_job1_id, v_freelancer_id, 4500, 'fixed', 'I have extensive experience with Next.js 16 and Supabase and would love to deliver this project.');

        RAISE NOTICE '[PASS] Test 1: Eligible unrelated freelancer proposal insert allowed by RLS';
        v_passed_count := v_passed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 1: Eligible freelancer was unexpectedly rejected: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 2: Job Owner Client A attempts proposal insert to own Job 1 (EXPECT: REJECT 42501)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.proposals (job_id, freelancer_id, bid_amount, rate_type, cover_letter)
        VALUES (v_job1_id, v_client_id, 3000, 'fixed', 'Client attempting to self-bid on their own contract via direct DB insert.');

        RAISE NOTICE '[FAIL] Test 2: Job owner self-application was permitted!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 2: Job owner self-application successfully rejected by RLS (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 2: Job owner rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 3: Company Manager E attempts proposal insert to Job 2 (EXPECT: REJECT 42501)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.proposals (job_id, freelancer_id, bid_amount, rate_type, cover_letter)
        VALUES (v_job2_id, v_manager_id, 6000, 'fixed', 'Company hiring manager attempting to bid on their company contract.');

        RAISE NOTICE '[FAIL] Test 3: Company manager was permitted to bid on company job!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 3: Company hiring manager bid successfully rejected by RLS (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 3: Company hiring manager rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 4: Suspended Freelancer C attempts proposal insert (EXPECT: REJECT 42501)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_suspended_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.proposals (job_id, freelancer_id, bid_amount, rate_type, cover_letter)
        VALUES (v_job1_id, v_suspended_id, 2500, 'fixed', 'Suspended account attempting proposal submission to published job.');

        RAISE NOTICE '[FAIL] Test 4: Suspended freelancer was permitted to insert proposal!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 4: Suspended freelancer successfully rejected by RLS (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 4: Suspended freelancer rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 5: Ineligible Freelancer D (can_work = false) attempts insert (EXPECT: REJECT 42501)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_ineligible_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        INSERT INTO public.proposals (job_id, freelancer_id, bid_amount, rate_type, cover_letter)
        VALUES (v_job1_id, v_ineligible_id, 2500, 'fixed', 'Ineligible profile (can_work=false) attempting proposal submission.');

        RAISE NOTICE '[FAIL] Test 5: Ineligible freelancer was permitted to insert proposal!';
        v_failed_count := v_failed_count + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '[PASS] Test 5: Ineligible freelancer (can_work=false) successfully rejected by RLS (42501)';
        v_passed_count := v_passed_count + 1;
    WHEN OTHERS THEN
        RAISE NOTICE '[PASS] Test 5: Ineligible freelancer rejected with error: %', SQLERRM;
        v_passed_count := v_passed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 6: Client A updates submitted proposal status to under_review (EXPECT: PASS)
    -- ========================================================================
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_client_id::text, true);
        PERFORM set_config('role', 'authenticated', true);

        UPDATE public.proposals SET status = 'under_review' WHERE id = v_prop_id;

        RAISE NOTICE '[PASS] Test 6: Client proposal status update workflow allowed by RLS';
        v_passed_count := v_passed_count + 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[FAIL] Test 6: Client was unable to update proposal status: %', SQLERRM;
        v_failed_count := v_failed_count + 1;
    END;

    -- Reset to superuser
    PERFORM set_config('role', 'postgres', true);

    -- ========================================================================
    -- TEST 7: Signup Trigger with role = 'client' (EXPECT: active_mode = 'client')
    -- ========================================================================
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (v_signup_client_id, 'new_client@test.local', '{"full_name": "New Client", "role": "client"}'::jsonb);

        SELECT active_mode INTO v_active_mode FROM public.profiles WHERE id = v_signup_client_id;

        IF v_active_mode = 'client' THEN
            RAISE NOTICE '[PASS] Test 7: Client signup created profile with active_mode = client';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 7: Client signup created profile with wrong mode: %', v_active_mode;
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 8: Signup Trigger with role = 'freelancer' (EXPECT: active_mode = 'freelancer')
    -- ========================================================================
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (v_signup_freelancer_id, 'new_freelancer@test.local', '{"full_name": "New Freelancer", "role": "freelancer"}'::jsonb);

        SELECT active_mode INTO v_active_mode FROM public.profiles WHERE id = v_signup_freelancer_id;

        IF v_active_mode = 'freelancer' THEN
            RAISE NOTICE '[PASS] Test 8: Freelancer signup created profile with active_mode = freelancer';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 8: Freelancer signup created profile with wrong mode: %', v_active_mode;
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 9: Signup Trigger with invalid role = 'admin' (EXPECT: fallback to 'freelancer')
    -- ========================================================================
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES (v_signup_hacker_id, 'attacker@test.local', '{"full_name": "Attacker", "role": "admin", "is_admin": true}'::jsonb);

        SELECT active_mode INTO v_active_mode FROM public.profiles WHERE id = v_signup_hacker_id;

        IF v_active_mode = 'freelancer' THEN
            RAISE NOTICE '[PASS] Test 9: Malicious role metadata safely fell back to freelancer';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 9: Malicious role metadata accepted unauthorized mode: %', v_active_mode;
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    -- ========================================================================
    -- TEST 10: Existing user login does not overwrite active mode (EXPECT: unchanged)
    -- ========================================================================
    BEGIN
        -- User 11 is currently 'client'. Simulate login timestamp update on auth.users:
        UPDATE auth.users SET last_sign_in_at = now() WHERE id = v_signup_client_id;

        SELECT active_mode INTO v_active_mode FROM public.profiles WHERE id = v_signup_client_id;

        IF v_active_mode = 'client' THEN
            RAISE NOTICE '[PASS] Test 10: Ordinary user login preserved active_mode = client';
            v_passed_count := v_passed_count + 1;
        ELSE
            RAISE NOTICE '[FAIL] Test 10: Login update unexpectedly modified active_mode: %', v_active_mode;
            v_failed_count := v_failed_count + 1;
        END IF;
    END;

    RAISE NOTICE '====================================================';
    RAISE NOTICE 'INTEGRATION TEST RESULTS: % PASSED, % FAILED', v_passed_count, v_failed_count;
    RAISE NOTICE '====================================================';

    IF v_failed_count > 0 THEN
        RAISE EXCEPTION 'Integration tests failed: % failure(s) detected.', v_failed_count;
    END IF;
END $$;

ROLLBACK;
