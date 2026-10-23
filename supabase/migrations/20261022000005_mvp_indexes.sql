-- Migration: 20261022000005_mvp_indexes.sql
-- Description: Performance optimization indexes: covering foreign keys, composite filters,
--              partial indexes for active entities, and GIN trigram indexes for marketplace search.

-- ============================================================================
-- 1. PROFILES INDEXES
-- ============================================================================
-- Trigram search for talent search by name or username
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm
    ON public.profiles USING gin (full_name extensions.gin_trgm_ops);

-- Primary marketplace talent catalog filter
CREATE INDEX IF NOT EXISTS idx_profiles_talent_rating
    ON public.profiles (rating DESC, review_count DESC)
    WHERE can_work = true AND is_suspended = false;

-- ============================================================================
-- 2. COMPANIES & MEMBERS INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
    ON public.companies USING gin (name extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_company_members_user_id
    ON public.company_members (user_id);

CREATE INDEX IF NOT EXISTS idx_company_members_company_id
    ON public.company_members (company_id);

-- ============================================================================
-- 3. JOBS INDEXES
-- ============================================================================
-- Foreign key lookups
CREATE INDEX IF NOT EXISTS idx_jobs_client_id
    ON public.jobs (client_id);

CREATE INDEX IF NOT EXISTS idx_jobs_company_id
    ON public.jobs (company_id)
    WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_category_id
    ON public.jobs (category_id);

-- Primary marketplace search feed query
CREATE INDEX IF NOT EXISTS idx_jobs_feed_published
    ON public.jobs (created_at DESC)
    WHERE status = 'published';

-- Trigram text search for job titles and descriptions
CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
    ON public.jobs USING gin (title extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_description_trgm
    ON public.jobs USING gin (description extensions.gin_trgm_ops);

-- ============================================================================
-- 4. PROPOSALS INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_proposals_job_id
    ON public.proposals (job_id);

CREATE INDEX IF NOT EXISTS idx_proposals_freelancer_id
    ON public.proposals (freelancer_id);

CREATE INDEX IF NOT EXISTS idx_proposals_status
    ON public.proposals (status);

-- ============================================================================
-- 5. SKILLS & TAXONOMY INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_skills_category_id
    ON public.skills (category_id);

CREATE INDEX IF NOT EXISTS idx_freelancer_skills_skill_id
    ON public.freelancer_skills (skill_id);

CREATE INDEX IF NOT EXISTS idx_job_skills_skill_id
    ON public.job_skills (skill_id);

CREATE INDEX IF NOT EXISTS idx_saved_jobs_job_id
    ON public.saved_jobs (job_id);
