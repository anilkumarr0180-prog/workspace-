-- Migration: 20261022000001_core_taxonomy_and_profiles.sql
-- Description: Core schema extensions, admin users, profiles, taxonomy (categories & skills),
--              freelancer skills, and user signup triggers.

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Admin Users Table (Isolated from profiles to eliminate privilege escalation)
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_users IS 'Identifies users with platform administrative privileges. Not writable by clients.';

-- 3. Profiles Table (1:1 with auth.users, supporting dual client/freelancer capabilities)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE CONSTRAINT chk_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
    full_name text NOT NULL,
    avatar_url text,
    bio text,
    title text,
    hourly_rate numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
    skills_overview text,
    can_hire boolean NOT NULL DEFAULT true,
    can_work boolean NOT NULL DEFAULT true,
    active_mode text NOT NULL DEFAULT 'freelancer' CONSTRAINT chk_active_mode CHECK (active_mode IN ('freelancer', 'client')),
    rating numeric(3,2) NOT NULL DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5.00),
    review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    total_earnings numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_earnings >= 0),
    total_spent numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    is_suspended boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Public profile data for marketplace participants supporting dual client and freelancer modes.';

-- 4. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    icon text,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.categories IS 'High-level marketplace industry categories.';

-- 5. Skills Table
CREATE TABLE IF NOT EXISTS public.skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.skills IS 'Normalized skills taxonomy linked optionally to categories.';

-- 6. Freelancer Skills Join Table
CREATE TABLE IF NOT EXISTS public.freelancer_skills (
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, skill_id)
);

COMMENT ON TABLE public.freelancer_skills IS 'M:N association between freelancer profiles and standardized skills.';

-- 7. Profile Privileged Fields Protection Trigger
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Protect ID and creation timestamp
    IF OLD.id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Field "id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Field "created_at" is immutable' USING ERRCODE = '42601';
    END IF;

    -- Protect platform-managed statistics and suspension flags
    IF OLD.rating IS DISTINCT FROM NEW.rating THEN
        RAISE EXCEPTION 'Field "rating" can only be updated by the platform rating engine' USING ERRCODE = '42501';
    END IF;

    IF OLD.review_count IS DISTINCT FROM NEW.review_count THEN
        RAISE EXCEPTION 'Field "review_count" can only be updated by the platform review engine' USING ERRCODE = '42501';
    END IF;

    IF OLD.total_earnings IS DISTINCT FROM NEW.total_earnings THEN
        RAISE EXCEPTION 'Field "total_earnings" can only be updated by the platform billing engine' USING ERRCODE = '42501';
    END IF;

    IF OLD.total_spent IS DISTINCT FROM NEW.total_spent THEN
        RAISE EXCEPTION 'Field "total_spent" can only be updated by the platform billing engine' USING ERRCODE = '42501';
    END IF;

    IF OLD.is_suspended IS DISTINCT FROM NEW.is_suspended THEN
        RAISE EXCEPTION 'Field "is_suspended" can only be updated by platform administrators' USING ERRCODE = '42501';
    END IF;

    -- Update timestamp automatically
    NEW.updated_at := clock_timestamp();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_fields ON public.profiles;

CREATE TRIGGER trg_profiles_protect_fields
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- 8. New User Registration Trigger (with bounded multi-tiered username collision handling)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw_username text;
    v_clean_username text;
    v_candidate_username text;
    v_full_name text;
    v_avatar_url text;
    v_diag_constraint text;
    v_attempt integer := 0;
    v_max_attempts CONSTANT integer := 8;
BEGIN
    v_raw_username := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
    v_full_name := NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), '');
    v_avatar_url := NULLIF(trim(NEW.raw_user_meta_data->>'avatar_url'), '');

    IF v_raw_username IS NULL AND NEW.email IS NOT NULL THEN
        v_raw_username := split_part(NEW.email, '@', 1);
    END IF;

    -- Sanitize: allow only [a-zA-Z0-9_]
    v_clean_username := regexp_replace(COALESCE(v_raw_username, 'user'), '[^a-zA-Z0-9_]', '_', 'g');

    -- Ensure minimum length of 3 chars
    WHILE length(v_clean_username) < 3 LOOP
        v_clean_username := v_clean_username || '_';
    END LOOP;

    -- Truncate base to 20 chars to guarantee room for up to 10-char suffixes (<= 30 chars total)
    v_clean_username := lower(substring(v_clean_username FROM 1 FOR 20));
    v_candidate_username := v_clean_username;

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
                'freelancer'
            );

            EXIT; -- Successfully inserted

        EXCEPTION
            WHEN unique_violation THEN
                -- Inspect the exact violated constraint name
                GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;

                -- If the violation was on profiles_pkey or another index, re-raise immediately
                IF v_diag_constraint <> 'profiles_username_key' THEN
                    RAISE;
                END IF;

                v_attempt := v_attempt + 1;

                IF v_attempt > v_max_attempts THEN
                    RAISE EXCEPTION 'Could not generate unique username for user % after % attempts due to persistent collision on profiles_username_key', NEW.id, v_attempt
                        USING ERRCODE = '23505';
                END IF;

                -- Candidate Generation Schedule:
                IF v_attempt <= 5 THEN
                    -- Pseudo-random 4 hex chars: length <= 25 chars (strictly <= 30)
                    v_candidate_username := v_clean_username || '_' || to_hex((floor(random() * 65535))::integer);
                ELSIF v_attempt = 6 THEN
                    -- Deterministic 24-char slice of user UUID: length 26 chars
                    v_candidate_username := 'u_' || substring(replace(NEW.id::text, '-', '') FROM 1 FOR 24);
                ELSIF v_attempt = 7 THEN
                    -- Deterministic 28-char slice of user UUID: length 30 chars (maximum constraint boundary)
                    v_candidate_username := 'u_' || substring(replace(NEW.id::text, '-', '') FROM 1 FOR 28);
                ELSE
                    -- Cryptographically random 28-char UUID: length 30 chars ($2^{112}$ entropy)
                    v_candidate_username := 'u_' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 28);
                END IF;
            -- Unrelated errors (foreign keys, table dropped, disk full) bubble up immediately
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

-- ============================================================================
-- 9. Idempotent Pre-Existing Auth User Backfill (Consistent with handle_new_user)
-- ============================================================================
DO $$
DECLARE
    r RECORD;
    v_raw_username text;
    v_clean_username text;
    v_base_25 text;
    v_candidate_username text;
    v_full_name text;
    v_avatar_url text;
    v_diag_constraint text;
    v_attempt integer;
    v_max_attempts CONSTANT integer := 8;
BEGIN
    FOR r IN 
        SELECT u.id, u.email, u.raw_user_meta_data 
        FROM auth.users u
        WHERE NOT EXISTS (
            SELECT 1 FROM public.profiles p WHERE p.id = u.id
        )
        ORDER BY u.created_at ASC
    LOOP
        v_raw_username := NULLIF(trim(r.raw_user_meta_data->>'username'), '');
        v_full_name := NULLIF(trim(r.raw_user_meta_data->>'full_name'), '');
        v_avatar_url := NULLIF(trim(r.raw_user_meta_data->>'avatar_url'), '');

        IF v_raw_username IS NULL AND r.email IS NOT NULL THEN
            v_raw_username := split_part(r.email, '@', 1);
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
        v_attempt := 0;

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
                    r.id,
                    v_candidate_username,
                    COALESCE(v_full_name, v_candidate_username),
                    v_avatar_url,
                    true,
                    true,
                    'freelancer'
                );

                EXIT; -- User successfully backfilled, proceed to next user

            EXCEPTION
                WHEN unique_violation THEN
                    -- Inspect the exact violated constraint name
                    GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;

                    -- If violation was NOT on profiles_username_key (including NULL), re-raise immediately
                    IF v_diag_constraint IS DISTINCT FROM 'profiles_username_key' THEN
                        RAISE;
                    END IF;

                    v_attempt := v_attempt + 1;

                    IF v_attempt > v_max_attempts THEN
                        RAISE EXCEPTION 'Backfill failed: cannot generate unique username for user % after % attempts due to persistent collision on profiles_username_key', r.id, v_attempt
                            USING ERRCODE = '23505';
                    END IF;

                    -- Candidate Generation Schedule (strictly 3 to 30 characters)
                    IF v_attempt <= 5 THEN
                        -- Pseudo-random 4 hex chars: length <= 25 + 1 + 4 = 30 chars
                        v_candidate_username := v_base_25 || '_' || to_hex((floor(random() * 65535))::integer);
                    ELSIF v_attempt = 6 THEN
                        -- Deterministic 24-char slice of user UUID: length 2 + 24 = 26 chars
                        v_candidate_username := 'u_' || substring(replace(r.id::text, '-', '') FROM 1 FOR 24);
                    ELSIF v_attempt = 7 THEN
                        -- Deterministic 28-char slice of user UUID: length 2 + 28 = 30 chars
                        v_candidate_username := 'u_' || substring(replace(r.id::text, '-', '') FROM 1 FOR 28);
                    ELSE
                        -- Cryptographically random 28-char UUID: length 2 + 28 = 30 chars ($2^{112}$ entropy)
                        v_candidate_username := 'u_' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 28);
                    END IF;
            END;
        END LOOP;
    END LOOP;
END $$;

