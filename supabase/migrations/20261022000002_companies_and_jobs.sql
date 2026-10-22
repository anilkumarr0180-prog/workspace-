-- Migration: 20261022000002_companies_and_jobs.sql
-- Description: Companies, company members, concurrency-safe owner protection,
--              jobs, publication validation, job skills, and saved jobs.

-- 1. Companies Table
CREATE TABLE IF NOT EXISTS public.companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) >= 2),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    website text,
    location text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.companies IS 'Client organizations that can employ team members and post company-linked jobs.';

-- 2. Cascade Deletion Marker on Companies
CREATE OR REPLACE FUNCTION public.mark_company_cascade_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Mark this specific company ID as being deleted within the current transaction
    PERFORM set_config('app.cascade_deleting_company_' || OLD.id::text, 'true', true);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_mark_cascade ON public.companies;

CREATE TRIGGER trg_companies_mark_cascade
    BEFORE DELETE ON public.companies
    FOR EACH ROW
    EXECUTE FUNCTION public.mark_company_cascade_deletion();

-- 3. Company Members Table
CREATE TABLE IF NOT EXISTS public.company_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'hiring_manager', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, user_id)
);

COMMENT ON TABLE public.company_members IS 'Role-based membership mapping between users and client companies.';

-- 4. Concurrency-Safe Last Owner Protection Trigger
CREATE OR REPLACE FUNCTION public.check_last_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_cascade text;
    v_company_locked boolean;
    v_remaining_owners integer;
BEGIN
    -- Only evaluate when an owner is being deleted or demoted to a non-owner role
    IF TG_OP = 'UPDATE' THEN
        IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.role <> 'owner' THEN
            RETURN OLD;
        END IF;
    END IF;

    -- Check if this operation is part of an active company cascade deletion
    v_is_cascade := current_setting('app.cascade_deleting_company_' || OLD.company_id::text, true);
    IF v_is_cascade = 'true' THEN
        -- Legitimate cascade proven by transaction marker: allow deletion
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    -- Standalone operation: lock parent company row to serialize concurrent transactions
    SELECT true INTO v_company_locked
      FROM public.companies
     WHERE id = OLD.company_id
       FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced company % not found or deleted by concurrent transaction', OLD.company_id
            USING ERRCODE = '23503';
    END IF;

    -- Count remaining owners excluding the tuple being mutated.
    -- Under READ COMMITTED, waiting on the lock forces a fresh snapshot evaluation.
    SELECT count(*)
      INTO v_remaining_owners
      FROM public.company_members
     WHERE company_id = OLD.company_id
       AND role = 'owner'
       AND id <> OLD.id;

    IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'Cannot remove or demote the last owner of an active company'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_members_prevent_last_owner ON public.company_members;

CREATE TRIGGER trg_company_members_prevent_last_owner
    BEFORE DELETE OR UPDATE OF role ON public.company_members
    FOR EACH ROW
    EXECUTE FUNCTION public.check_last_company_owner();

-- 5. Atomic Company Creation RPC
CREATE OR REPLACE FUNCTION public.create_company(
    p_name text,
    p_slug text,
    p_website text DEFAULT NULL,
    p_location text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_company_id uuid;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create a company'
            USING ERRCODE = '42501';
    END IF;

    -- Validate slug format
    IF p_slug !~ '^[a-z0-9-]+$' THEN
        RAISE EXCEPTION 'Invalid slug format. Must contain only lowercase alphanumeric characters and hyphens.'
            USING ERRCODE = '22023';
    END IF;

    -- Insert company
    INSERT INTO public.companies (name, slug, website, location)
    VALUES (trim(p_name), trim(p_slug), NULLIF(trim(p_website), ''), NULLIF(trim(p_location), ''))
    RETURNING id INTO v_company_id;

    -- Automatically attach creator as 'owner'
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, 'owner');

    RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company(text, text, text, text) TO authenticated;

-- 6. Jobs Table
CREATE TABLE IF NOT EXISTS public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    category_id uuid REFERENCES public.categories(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (length(trim(title)) >= 5),
    description text NOT NULL CHECK (length(trim(description)) >= 20),
    project_type text NOT NULL CHECK (project_type IN ('fixed', 'hourly')),
    budget_min numeric(12,2) CHECK (budget_min IS NULL OR budget_min >= 0),
    budget_max numeric(12,2) CHECK (budget_max IS NULL OR budget_max >= 0),
    experience_level text NOT NULL CHECK (experience_level IN ('entry', 'intermediate', 'expert')),
    duration text NOT NULL CHECK (duration IN ('less_than_1_month', '1_to_3_months', '3_to_6_months', 'more_than_6_months')),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
    proposals_count integer NOT NULL DEFAULT 0 CHECK (proposals_count >= 0),
    is_featured boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_job_budget_consistency CHECK (
        (project_type = 'fixed' AND budget_min IS NOT NULL AND budget_min > 0)
        OR
        (project_type = 'hourly' AND (budget_min IS NULL OR budget_min >= 0) AND (budget_max IS NULL OR budget_max >= 0) AND (budget_max IS NULL OR budget_min IS NULL OR budget_max >= budget_min))
    )
);

COMMENT ON TABLE public.jobs IS 'Client job postings supporting individual or company sponsorship.';

-- 7. Job Publication Validation Trigger
CREATE OR REPLACE FUNCTION public.validate_job_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If publishing or updating a published job, enforce required fields
    IF NEW.status = 'published' THEN
        IF length(trim(NEW.title)) < 10 THEN
            RAISE EXCEPTION 'Published jobs require a title of at least 10 characters' USING ERRCODE = '22023';
        END IF;

        IF length(trim(NEW.description)) < 50 THEN
            RAISE EXCEPTION 'Published jobs require a description of at least 50 characters' USING ERRCODE = '22023';
        END IF;

        IF NEW.category_id IS NULL THEN
            RAISE EXCEPTION 'Published jobs must belong to a category' USING ERRCODE = '22023';
        END IF;

        -- Verify company membership if job is linked to a company
        IF NEW.company_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.company_members
                 WHERE company_id = NEW.company_id
                   AND user_id = NEW.client_id
                   AND role IN ('owner', 'admin', 'hiring_manager')
            ) THEN
                RAISE EXCEPTION 'Poster does not have hiring authority for this company' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_validate_publication ON public.jobs;

CREATE TRIGGER trg_jobs_validate_publication
    BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_job_publication();

-- 8. Job Skills Join Table
CREATE TABLE IF NOT EXISTS public.job_skills (
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, skill_id)
);

COMMENT ON TABLE public.job_skills IS 'M:N association between job posts and required skills.';

-- 9. Saved Jobs Table
CREATE TABLE IF NOT EXISTS public.saved_jobs (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, job_id)
);

COMMENT ON TABLE public.saved_jobs IS 'Bookmarks of jobs saved by freelancers.';
