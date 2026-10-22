-- Migration: 20261022000004_mvp_rls_and_security.sql
-- Description: Enable Row Level Security (RLS) across all MVP tables, define non-recursive
--              authorization policies, and establish least-privilege column grants.

-- ============================================================================
-- 1. ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancer_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. POLICIES: admin_users
-- ============================================================================
CREATE POLICY admin_users_select_self
    ON public.admin_users
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================================
-- 3. POLICIES: profiles
-- ============================================================================
CREATE POLICY profiles_select_public
    ON public.profiles
    FOR SELECT
    TO anon, authenticated
    USING (is_suspended = false OR auth.uid() = id);

CREATE POLICY profiles_update_owner
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 4. POLICIES: categories & skills (Public read, no client write)
-- ============================================================================
CREATE POLICY categories_select_all
    ON public.categories
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY skills_select_all
    ON public.skills
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- 5. POLICIES: freelancer_skills
-- ============================================================================
CREATE POLICY freelancer_skills_select
    ON public.freelancer_skills
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY freelancer_skills_insert_owner
    ON public.freelancer_skills
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = profile_id);

CREATE POLICY freelancer_skills_delete_owner
    ON public.freelancer_skills
    FOR DELETE
    TO authenticated
    USING (auth.uid() = profile_id);

-- ============================================================================
-- 6. POLICIES: companies
-- ============================================================================
CREATE POLICY companies_select_all
    ON public.companies
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY companies_update_admin
    ON public.companies
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = id
               AND cm.user_id = auth.uid()
               AND cm.role IN ('owner', 'admin')
        )
    );

CREATE POLICY companies_delete_owner
    ON public.companies
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = id
               AND cm.user_id = auth.uid()
               AND cm.role = 'owner'
        )
    );

-- ============================================================================
-- 7. POLICIES: company_members (Non-recursive)
-- ============================================================================
-- Internal helper function: strictly returns caller's company IDs with zero RPC enumeration risk
CREATE OR REPLACE FUNCTION public.get_my_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT company_id
      FROM public.company_members
     WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_company_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_company_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_company_ids() TO authenticated;

CREATE POLICY company_members_select
    ON public.company_members
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR
        company_id IN (SELECT public.get_my_company_ids())
    );

CREATE POLICY company_members_insert
    ON public.company_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.company_members m
             WHERE m.company_id = company_id
               AND m.user_id = auth.uid()
               AND m.role IN ('owner', 'admin')
        )
    );

CREATE POLICY company_members_update
    ON public.company_members
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.company_members m
             WHERE m.company_id = company_members.company_id
               AND m.user_id = auth.uid()
               AND m.role = 'owner'
        )
    );

CREATE POLICY company_members_delete
    ON public.company_members
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM public.company_members m
             WHERE m.company_id = company_members.company_id
               AND m.user_id = auth.uid()
               AND m.role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- 8. POLICIES: jobs
-- ============================================================================
-- Public guest policy: read-only access to published jobs with zero external table dependencies
CREATE POLICY jobs_select_anon
    ON public.jobs
    FOR SELECT
    TO anon
    USING (status = 'published');

-- Authenticated policy: published jobs, client's own jobs, or company-sponsored jobs
CREATE POLICY jobs_select_authenticated
    ON public.jobs
    FOR SELECT
    TO authenticated
    USING (
        status = 'published'
        OR
        client_id = auth.uid()
        OR
        (
            company_id IS NOT NULL
            AND company_id IN (SELECT public.get_my_company_ids())
        )
    );

CREATE POLICY jobs_insert
    ON public.jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = client_id
        AND (
            company_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = company_id
                   AND cm.user_id = auth.uid()
                   AND cm.role IN ('owner', 'admin', 'hiring_manager')
            )
        )
    );

CREATE POLICY jobs_update
    ON public.jobs
    FOR UPDATE
    TO authenticated
    USING (
        client_id = auth.uid()
        OR (
            company_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = jobs.company_id
                   AND cm.user_id = auth.uid()
                   AND cm.role IN ('owner', 'admin', 'hiring_manager')
            )
        )
    );

CREATE POLICY jobs_delete
    ON public.jobs
    FOR DELETE
    TO authenticated
    USING (
        client_id = auth.uid()
        OR (
            company_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = jobs.company_id
                   AND cm.user_id = auth.uid()
                   AND cm.role = 'owner'
            )
        )
    );

-- ============================================================================
-- 9. POLICIES: job_skills
-- ============================================================================
CREATE POLICY job_skills_select
    ON public.job_skills
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY job_skills_insert
    ON public.job_skills
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = job_id
               AND (
                   j.client_id = auth.uid()
                   OR (
                       j.company_id IS NOT NULL
                       AND EXISTS (
                           SELECT 1 FROM public.company_members cm
                            WHERE cm.company_id = j.company_id
                              AND cm.user_id = auth.uid()
                              AND cm.role IN ('owner', 'admin', 'hiring_manager')
                       )
                   )
               )
        )
    );

CREATE POLICY job_skills_delete
    ON public.job_skills
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = job_id
               AND (
                   j.client_id = auth.uid()
                   OR (
                       j.company_id IS NOT NULL
                       AND EXISTS (
                           SELECT 1 FROM public.company_members cm
                            WHERE cm.company_id = j.company_id
                              AND cm.user_id = auth.uid()
                              AND cm.role IN ('owner', 'admin', 'hiring_manager')
                       )
                   )
               )
        )
    );

-- ============================================================================
-- 10. POLICIES: saved_jobs
-- ============================================================================
CREATE POLICY saved_jobs_select_owner
    ON public.saved_jobs
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY saved_jobs_insert_owner
    ON public.saved_jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY saved_jobs_delete_owner
    ON public.saved_jobs
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================================
-- 11. POLICIES: proposals
-- ============================================================================
CREATE POLICY proposals_select_involved
    ON public.proposals
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = proposals.job_id
               AND (
                   j.client_id = auth.uid()
                   OR (
                       j.company_id IS NOT NULL
                       AND EXISTS (
                           SELECT 1 FROM public.company_members cm
                            WHERE cm.company_id = j.company_id
                              AND cm.user_id = auth.uid()
                              AND cm.role IN ('owner', 'admin', 'hiring_manager')
                       )
                   )
               )
        )
    );

CREATE POLICY proposals_insert_freelancer
    ON public.proposals
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = freelancer_id
        AND EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = job_id
               AND j.status = 'published'
        )
    );

CREATE POLICY proposals_update_involved
    ON public.proposals
    FOR UPDATE
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = proposals.job_id
               AND (
                   j.client_id = auth.uid()
                   OR (
                       j.company_id IS NOT NULL
                       AND EXISTS (
                           SELECT 1 FROM public.company_members cm
                            WHERE cm.company_id = j.company_id
                              AND cm.user_id = auth.uid()
                              AND cm.role IN ('owner', 'admin', 'hiring_manager')
                       )
                   )
               )
        )
    );

-- ============================================================================
-- 12. LEAST-PRIVILEGE COLUMN & TABLE GRANTS
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Default SELECT on public readable tables
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT SELECT ON public.skills TO anon, authenticated;
GRANT SELECT ON public.freelancer_skills TO anon, authenticated;
GRANT SELECT ON public.companies TO anon, authenticated;
GRANT SELECT ON public.company_members TO authenticated;
GRANT SELECT ON public.jobs TO anon, authenticated;
GRANT SELECT ON public.job_skills TO anon, authenticated;
GRANT SELECT ON public.saved_jobs TO authenticated;
GRANT SELECT ON public.proposals TO authenticated;
GRANT SELECT ON public.admin_users TO authenticated;

-- Write Grants
GRANT INSERT, DELETE ON public.saved_jobs TO authenticated;
GRANT INSERT, DELETE ON public.freelancer_skills TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT INSERT, DELETE ON public.job_skills TO authenticated;
GRANT INSERT ON public.proposals TO authenticated;
GRANT UPDATE, DELETE ON public.companies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.company_members TO authenticated;

-- Column-Specific UPDATE on profiles
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT UPDATE (
    username,
    full_name,
    avatar_url,
    bio,
    title,
    hourly_rate,
    skills_overview,
    active_mode
) ON public.profiles TO authenticated;

-- Column-Specific UPDATE on proposals (Clients and freelancers can only update status)
REVOKE UPDATE ON public.proposals FROM authenticated;
REVOKE UPDATE ON public.proposals FROM anon;
GRANT UPDATE (status) ON public.proposals TO authenticated;
