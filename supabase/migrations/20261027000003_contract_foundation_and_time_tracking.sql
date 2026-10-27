-- Migration: 20261027000003_contract_foundation_and_time_tracking.sql
-- Description: Contract foundation, active timer sessions, completed time entries,
--              weekly timesheets, automated transactional contract creation on proposal acceptance,
--              and Row Level Security (RLS) policies.

-- ============================================================================
-- 1. CONTRACTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id uuid NOT NULL UNIQUE REFERENCES public.proposals(id) ON DELETE RESTRICT,
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    contract_type text NOT NULL CONSTRAINT chk_contract_type CHECK (contract_type IN ('hourly', 'fixed')),
    title text NOT NULL CHECK (length(trim(title)) >= 5),
    hourly_rate numeric(10,2) CONSTRAINT chk_contract_hourly_rate CHECK (
        (contract_type = 'hourly' AND hourly_rate IS NOT NULL AND hourly_rate > 0)
        OR
        (contract_type = 'fixed' AND hourly_rate IS NULL)
    ),
    fixed_price numeric(12,2) CONSTRAINT chk_contract_fixed_price CHECK (
        (contract_type = 'fixed' AND fixed_price IS NOT NULL AND fixed_price > 0)
        OR
        (contract_type = 'hourly' AND fixed_price IS NULL)
    ),
    weekly_hour_limit integer CONSTRAINT chk_contract_weekly_limit CHECK (
        (contract_type = 'hourly' AND weekly_hour_limit IS NOT NULL AND weekly_hour_limit >= 0 AND weekly_hour_limit <= 168)
        OR
        (contract_type = 'fixed' AND weekly_hour_limit IS NULL)
    ),
    allow_manual_time boolean NOT NULL DEFAULT true,
    status text NOT NULL DEFAULT 'active' CONSTRAINT chk_contract_status CHECK (
        status IN ('active', 'paused', 'completed', 'cancelled')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contracts IS 'Binding contracts established between client and freelancer upon accepted proposals.';

-- ============================================================================
-- 2. TIMESHEETS TABLE (Weekly Summary Periods)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.timesheets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    week_start_date date NOT NULL CONSTRAINT chk_timesheet_monday CHECK (
        EXTRACT(ISODOW FROM week_start_date) = 1
    ),
    total_minutes integer NOT NULL DEFAULT 0 CHECK (total_minutes >= 0),
    total_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status text NOT NULL DEFAULT 'open' CONSTRAINT chk_timesheet_status CHECK (
        status IN ('open', 'submitted', 'under_review', 'approved', 'disputed', 'paid')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contract_timesheet_week UNIQUE (contract_id, week_start_date)
);

COMMENT ON TABLE public.timesheets IS 'Weekly timesheet cycles starting on Monday 00:00:00 UTC for hourly contract review.';

-- ============================================================================
-- 3. TIME ENTRIES TABLE (Completed Logged Intervals)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.time_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE SET NULL,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    memo text NOT NULL CHECK (length(trim(memo)) >= 1),
    source text NOT NULL DEFAULT 'timer' CHECK (source IN ('timer', 'manual')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_time_entry_range CHECK (end_time > start_time),
    CONSTRAINT chk_time_entry_max_duration CHECK (end_time - start_time <= interval '12 hours')
);

COMMENT ON TABLE public.time_entries IS 'Granular completed time sessions for hourly contracts.';

-- ============================================================================
-- 4. ACTIVE TIMER SESSIONS TABLE (Persistent Real-Time Tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.active_timer_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    start_time timestamptz NOT NULL DEFAULT now(),
    memo text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_freelancer_active_timer UNIQUE (freelancer_id)
);

COMMENT ON TABLE public.active_timer_sessions IS 'Active real-time stopwatch session. Exactly one active timer per freelancer platform-wide.';

-- ============================================================================
-- 5. CONTRACT & TIMER INTEGRITY TRIGGERS
-- ============================================================================

-- A. Validate Active Timer Session Eligibility
CREATE OR REPLACE FUNCTION public.check_timer_session_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_contract RECORD;
BEGIN
    SELECT contract_type, status, freelancer_id
      INTO v_contract
      FROM public.contracts
     WHERE id = NEW.contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced contract % not found', NEW.contract_id
            USING ERRCODE = '23503';
    END IF;

    -- Strict Rule: Fixed-price contracts must NOT become eligible for billable timer sessions
    IF v_contract.contract_type <> 'hourly' THEN
        RAISE EXCEPTION 'Timer sessions are only permitted on hourly contracts (contract % is %)', NEW.contract_id, v_contract.contract_type
            USING ERRCODE = '22023';
    END IF;

    IF v_contract.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot start timer session on contract with status "%"', v_contract.status
            USING ERRCODE = '22023';
    END IF;

    IF v_contract.freelancer_id <> NEW.freelancer_id THEN
        RAISE EXCEPTION 'Only the contracted freelancer can record time on this contract'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_active_timer_session_eligibility ON public.active_timer_sessions;

CREATE TRIGGER trg_active_timer_session_eligibility
    BEFORE INSERT OR UPDATE ON public.active_timer_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.check_timer_session_eligibility();

-- B. Validate Completed Time Entry Eligibility
CREATE OR REPLACE FUNCTION public.check_time_entry_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_contract RECORD;
BEGIN
    SELECT contract_type, status, freelancer_id
      INTO v_contract
      FROM public.contracts
     WHERE id = NEW.contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced contract % not found', NEW.contract_id
            USING ERRCODE = '23503';
    END IF;

    -- Strict Rule: Fixed-price contracts must NOT receive hourly time entries
    IF v_contract.contract_type <> 'hourly' THEN
        RAISE EXCEPTION 'Time entries are only permitted on hourly contracts (contract % is %)', NEW.contract_id, v_contract.contract_type
            USING ERRCODE = '22023';
    END IF;

    IF v_contract.freelancer_id <> NEW.freelancer_id THEN
        RAISE EXCEPTION 'Only the contracted freelancer can log time on this contract'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entries_eligibility ON public.time_entries;

CREATE TRIGGER trg_time_entries_eligibility
    BEFORE INSERT OR UPDATE ON public.time_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.check_time_entry_eligibility();

-- C. Transactional Automated Contract Creation on Proposal Acceptance
CREATE OR REPLACE FUNCTION public.create_contract_on_proposal_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job RECORD;
    v_weekly_limit integer := NULL;
    v_hourly_rate numeric(10,2) := NULL;
    v_fixed_price numeric(12,2) := NULL;
BEGIN
    -- Only execute when status transitions to 'accepted'
    IF (OLD.status IS DISTINCT FROM 'accepted') AND (NEW.status = 'accepted') THEN
        -- Fetch job details authoritatively
        SELECT id, client_id, company_id, title, project_type, status
          INTO v_job
          FROM public.jobs
         WHERE id = NEW.job_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parent job % not found for accepted proposal %', NEW.job_id, NEW.id
                USING ERRCODE = '23503';
        END IF;

        IF NEW.rate_type = 'hourly' THEN
            v_hourly_rate := NEW.bid_amount;
            v_weekly_limit := 40; -- Upwork-inspired standard default limit
        ELSIF NEW.rate_type = 'fixed' THEN
            v_fixed_price := NEW.bid_amount;
        ELSE
            RAISE EXCEPTION 'Unsupported proposal rate_type: %', NEW.rate_type
                USING ERRCODE = '22023';
        END IF;

        -- Insert contract record idempotently within the same atomic transaction
        INSERT INTO public.contracts (
            proposal_id,
            job_id,
            client_id,
            company_id,
            freelancer_id,
            contract_type,
            title,
            hourly_rate,
            fixed_price,
            weekly_hour_limit,
            status
        ) VALUES (
            NEW.id,
            NEW.job_id,
            v_job.client_id,
            v_job.company_id,
            NEW.freelancer_id,
            NEW.rate_type,
            v_job.title,
            v_hourly_rate,
            v_fixed_price,
            v_weekly_limit,
            'active'
        )
        ON CONFLICT (proposal_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_create_contract ON public.proposals;

CREATE TRIGGER trg_proposals_create_contract
    AFTER UPDATE OF status ON public.proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.create_contract_on_proposal_acceptance();

REVOKE ALL ON FUNCTION public.create_contract_on_proposal_acceptance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_contract_on_proposal_acceptance() FROM anon;
REVOKE ALL ON FUNCTION public.create_contract_on_proposal_acceptance() FROM authenticated;

-- ============================================================================
-- 6. SAFE IDEMPOTENT BACKFILL STRATEGY
-- ============================================================================
-- Safely populate contracts for any existing accepted proposals using their verified proposal terms.
-- Uses ON CONFLICT (proposal_id) DO NOTHING so it is completely safe and non-destructive.
INSERT INTO public.contracts (
    proposal_id,
    job_id,
    client_id,
    company_id,
    freelancer_id,
    contract_type,
    title,
    hourly_rate,
    fixed_price,
    weekly_hour_limit,
    status
)
SELECT
    p.id,
    p.job_id,
    j.client_id,
    j.company_id,
    p.freelancer_id,
    p.rate_type,
    j.title,
    CASE WHEN p.rate_type = 'hourly' THEN p.bid_amount ELSE NULL END,
    CASE WHEN p.rate_type = 'fixed' THEN p.bid_amount ELSE NULL END,
    CASE WHEN p.rate_type = 'hourly' THEN 40 ELSE NULL END,
    'active'
FROM public.proposals p
JOIN public.jobs j ON j.id = p.job_id
WHERE p.status = 'accepted'
ON CONFLICT (proposal_id) DO NOTHING;

-- ============================================================================
-- 7. PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON public.contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_id ON public.contracts (freelancer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_job_id ON public.contracts (job_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company_id ON public.contracts (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts (status);

CREATE INDEX IF NOT EXISTS idx_timesheets_contract_id ON public.timesheets (contract_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_freelancer_id ON public.timesheets (freelancer_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_client_id ON public.timesheets (client_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_week_start ON public.timesheets (week_start_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_contract_id ON public.time_entries (contract_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_timesheet_id ON public.time_entries (timesheet_id) WHERE timesheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_freelancer_id ON public.time_entries (freelancer_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON public.time_entries (start_time);

CREATE INDEX IF NOT EXISTS idx_active_timer_contract_id ON public.active_timer_sessions (contract_id);

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_timer_sessions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Contracts Policies
-- ----------------------------------------------------------------------------
CREATE POLICY contracts_select_involved
    ON public.contracts
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR client_id = auth.uid()
        OR (
            company_id IS NOT NULL
            AND company_id IN (SELECT public.get_my_company_ids())
        )
    );

CREATE POLICY contracts_update_client
    ON public.contracts
    FOR UPDATE
    TO authenticated
    USING (
        client_id = auth.uid()
        OR (
            company_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = contracts.company_id
                   AND cm.user_id = auth.uid()
                   AND cm.role IN ('owner', 'admin', 'hiring_manager')
            )
        )
    );

-- ----------------------------------------------------------------------------
-- Timesheets Policies
-- ----------------------------------------------------------------------------
CREATE POLICY timesheets_select_involved
    ON public.timesheets
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR client_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = timesheets.contract_id
               AND c.company_id IS NOT NULL
               AND c.company_id IN (SELECT public.get_my_company_ids())
        )
    );

CREATE POLICY timesheets_insert_involved
    ON public.timesheets
    FOR INSERT
    TO authenticated
    WITH CHECK (
        freelancer_id = auth.uid()
        OR client_id = auth.uid()
    );

CREATE POLICY timesheets_update_involved
    ON public.timesheets
    FOR UPDATE
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR client_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = timesheets.contract_id
               AND c.company_id IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = c.company_id
                      AND cm.user_id = auth.uid()
                      AND cm.role IN ('owner', 'admin', 'hiring_manager')
               )
        )
    );

-- ----------------------------------------------------------------------------
-- Time Entries Policies
-- ----------------------------------------------------------------------------
CREATE POLICY time_entries_select_involved
    ON public.time_entries
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = time_entries.contract_id
               AND (
                   c.client_id = auth.uid()
                   OR (
                       c.company_id IS NOT NULL
                       AND c.company_id IN (SELECT public.get_my_company_ids())
                   )
               )
        )
    );

CREATE POLICY time_entries_insert_freelancer
    ON public.time_entries
    FOR INSERT
    TO authenticated
    WITH CHECK (
        freelancer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = contract_id
               AND c.freelancer_id = auth.uid()
               AND c.status = 'active'
               AND c.contract_type = 'hourly'
        )
    );

CREATE POLICY time_entries_update_freelancer
    ON public.time_entries
    FOR UPDATE
    TO authenticated
    USING (freelancer_id = auth.uid())
    WITH CHECK (freelancer_id = auth.uid());

CREATE POLICY time_entries_delete_freelancer
    ON public.time_entries
    FOR DELETE
    TO authenticated
    USING (freelancer_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Active Timer Sessions Policies
-- ----------------------------------------------------------------------------
CREATE POLICY active_timer_select_involved
    ON public.active_timer_sessions
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = active_timer_sessions.contract_id
               AND (
                   c.client_id = auth.uid()
                   OR (
                       c.company_id IS NOT NULL
                       AND c.company_id IN (SELECT public.get_my_company_ids())
                   )
               )
        )
    );

CREATE POLICY active_timer_insert_freelancer
    ON public.active_timer_sessions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        freelancer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = contract_id
               AND c.freelancer_id = auth.uid()
               AND c.status = 'active'
               AND c.contract_type = 'hourly'
        )
    );

CREATE POLICY active_timer_update_freelancer
    ON public.active_timer_sessions
    FOR UPDATE
    TO authenticated
    USING (freelancer_id = auth.uid())
    WITH CHECK (freelancer_id = auth.uid());

CREATE POLICY active_timer_delete_freelancer
    ON public.active_timer_sessions
    FOR DELETE
    TO authenticated
    USING (freelancer_id = auth.uid());

-- ============================================================================
-- 9. LEAST PRIVILEGE TABLE & COLUMN GRANTS
-- ============================================================================
GRANT SELECT ON public.contracts TO authenticated;
GRANT UPDATE (status, weekly_hour_limit) ON public.contracts TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.timesheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_timer_sessions TO authenticated;
