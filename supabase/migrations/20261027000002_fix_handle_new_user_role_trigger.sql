-- Migration: 20261027000002_fix_handle_new_user_role_trigger.sql
-- Description: Update public.handle_new_user() trigger function to respect raw_user_meta_data->>'role'
--              ('client' or 'freelancer') during initial profile creation, eliminating hardcoded 'freelancer' default.
-- Status: PREPARED (UNAPPLIED - Pending Review & Approval)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw_username text;
    v_clean_username text;
    v_base_25 text;
    v_candidate_username text;
    v_full_name text;
    v_avatar_url text;
    v_role text;
    v_active_mode text;
    v_diag_constraint text;
    v_attempt integer := 0;
    v_max_attempts CONSTANT integer := 8;
BEGIN
    v_raw_username := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
    v_full_name := NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), '');
    v_avatar_url := NULLIF(trim(NEW.raw_user_meta_data->>'avatar_url'), '');

    -- Read role from signup metadata; safely default to 'freelancer' if unspecified or invalid
    v_role := lower(COALESCE(trim(NEW.raw_user_meta_data->>'role'), 'freelancer'));
    IF v_role IN ('client', 'freelancer') THEN
        v_active_mode := v_role;
    ELSE
        v_active_mode := 'freelancer';
    END IF;

    IF v_raw_username IS NULL AND NEW.email IS NOT NULL THEN
        v_raw_username := split_part(NEW.email, '@', 1);
    END IF;

    -- Sanitize: allow only [a-zA-Z0-9_]
    v_clean_username := regexp_replace(COALESCE(v_raw_username, 'user'), '[^a-zA-Z0-9_]', '_', 'g');

    -- Ensure minimum length of 3 chars
    WHILE length(v_clean_username) < 3 LOOP
        v_clean_username := v_clean_username || '_';
    END LOOP;

    -- Prepare base truncated to 25 chars to guarantee <= 30 chars for all suffixes
    v_base_25 := lower(substring(v_clean_username FROM 1 FOR 25));
    v_candidate_username := lower(substring(v_clean_username FROM 1 FOR 30));

    LOOP
        BEGIN
            INSERT INTO public.profiles (
                id,
                username,
                full_name,
                avatar_url,
                can_hire,
                can_work,
                active_mode
            ) VALUES (
                NEW.id,
                v_candidate_username,
                COALESCE(v_full_name, v_candidate_username),
                v_avatar_url,
                true,
                true,
                v_active_mode
            );

            EXIT; -- Successfully inserted

        EXCEPTION
            WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;

                IF v_diag_constraint IS DISTINCT FROM 'profiles_username_key' THEN
                    RAISE;
                END IF;

                v_attempt := v_attempt + 1;

                IF v_attempt > v_max_attempts THEN
                    RAISE EXCEPTION 'Could not generate unique username for user % after % attempts due to persistent collision on profiles_username_key', NEW.id, v_attempt
                        USING ERRCODE = '23505';
                END IF;

                -- Candidate Generation Schedule (same as core taxonomy migration)
                IF v_attempt <= 5 THEN
                    v_candidate_username := v_base_25 || '_' || to_hex((floor(random() * 65535))::integer);
                ELSIF v_attempt = 6 THEN
                    v_candidate_username := 'u_' || substring(replace(NEW.id::text, '-', '') FROM 1 FOR 24);
                ELSIF v_attempt = 7 THEN
                    v_candidate_username := 'u_' || substring(replace(NEW.id::text, '-', '') FROM 1 FOR 28);
                ELSE
                    v_candidate_username := 'u_' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 28);
                END IF;
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

