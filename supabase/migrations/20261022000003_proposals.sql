-- Migration: 20261022000003_proposals.sql
-- Description: Proposals table, partial uniqueness constraint, proposal lifecycle integrity trigger,
--              and atomic proposal counter synchronization.

-- 1. Proposals Table
CREATE TABLE IF NOT EXISTS public.proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bid_amount numeric(12,2) NOT NULL CHECK (bid_amount > 0),
    rate_type text NOT NULL CHECK (rate_type IN ('fixed', 'hourly')),
    delivery_days integer CHECK (delivery_days IS NULL OR delivery_days > 0),
    cover_letter text NOT NULL CHECK (length(trim(cover_letter)) >= 50),
    status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'interviewing', 'accepted', 'rejected', 'withdrawn')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.proposals IS 'Freelancer proposals and bids submitted to job postings.';

-- 2. Unique Partial Index: Exactly one active proposal per freelancer per job
-- Permits submitting a new proposal after withdrawing or being rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_proposal_per_job
    ON public.proposals (job_id, freelancer_id)
    WHERE status NOT IN ('withdrawn', 'rejected');

-- 3. Proposal Lifecycle Integrity & Immutability Trigger
CREATE OR REPLACE FUNCTION public.check_proposal_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_job_client_id uuid;
    v_job_company_id uuid;
    v_job_status text;
    v_is_client_manager boolean := false;
    v_is_freelancer boolean := false;
BEGIN
    -- 1. Strictly require an authenticated actor
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to update proposal'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Strict immutability using IS DISTINCT FROM (safe against NULLs)
    IF OLD.id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Field "id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.job_id IS DISTINCT FROM NEW.job_id THEN
        RAISE EXCEPTION 'Field "job_id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.freelancer_id IS DISTINCT FROM NEW.freelancer_id THEN
        RAISE EXCEPTION 'Field "freelancer_id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.bid_amount IS DISTINCT FROM NEW.bid_amount THEN
        RAISE EXCEPTION 'Field "bid_amount" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.rate_type IS DISTINCT FROM NEW.rate_type THEN
        RAISE EXCEPTION 'Field "rate_type" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.delivery_days IS DISTINCT FROM NEW.delivery_days THEN
        RAISE EXCEPTION 'Field "delivery_days" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.cover_letter IS DISTINCT FROM NEW.cover_letter THEN
        RAISE EXCEPTION 'Field "cover_letter" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Field "created_at" is immutable' USING ERRCODE = '42601';
    END IF;

    -- 3. Always overwrite updated_at with database time
    NEW.updated_at := clock_timestamp();

    -- 4. Terminal State Lockout (even no-ops are prohibited on terminal proposals)
    IF OLD.status IN ('accepted', 'rejected', 'withdrawn') THEN
        RAISE EXCEPTION 'Proposal is in terminal state "%" and cannot be modified', OLD.status
            USING ERRCODE = '22023';
    END IF;

    -- 5. Read Job Context authoritatively (SECURITY DEFINER bypasses RLS on jobs)
    SELECT j.client_id, j.company_id, j.status
      INTO v_job_client_id, v_job_company_id, v_job_status
      FROM public.jobs j
     WHERE j.id = OLD.job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced job % not found', OLD.job_id
            USING ERRCODE = '23503';
    END IF;

    -- 6. Evaluate Actor Permissions
    v_is_freelancer := (OLD.freelancer_id = v_actor_id);

    IF v_job_client_id = v_actor_id THEN
        v_is_client_manager := true;
    ELSIF v_job_company_id IS NOT NULL THEN
        -- Check company membership authoritatively
        v_is_client_manager := EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_job_company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        );
    END IF;

    IF NOT v_is_client_manager AND NOT v_is_freelancer THEN
        RAISE EXCEPTION 'Unauthorized to modify proposal'
            USING ERRCODE = '42501';
    END IF;

    -- 7. Validate No-Op Updates after verifying authorization
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- 8. Disallow Status Changes If Parent Job Is Not Published
    -- (Except withdrawal by the freelancer, which is always permitted while non-terminal)
    IF v_job_status <> 'published' AND NEW.status <> 'withdrawn' THEN
        RAISE EXCEPTION 'Cannot update proposal status while job is %', v_job_status
            USING ERRCODE = '22023';
    END IF;

    -- 9. Explicit State Transition Matrix
    CASE OLD.status
        WHEN 'submitted' THEN
            IF NEW.status = 'withdrawn' AND v_is_freelancer THEN
                RETURN NEW;
            ELSIF NEW.status = 'under_review' AND v_is_client_manager THEN
                RETURN NEW;
            ELSIF NEW.status = 'interviewing' AND v_is_client_manager THEN
                RETURN NEW;
            ELSIF NEW.status = 'rejected' AND v_is_client_manager THEN
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Unauthorized transition: submitted -> % by current actor', NEW.status
                    USING ERRCODE = '22023';
            END IF;

        WHEN 'under_review' THEN
            IF NEW.status = 'withdrawn' AND v_is_freelancer THEN
                RETURN NEW;
            ELSIF NEW.status = 'interviewing' AND v_is_client_manager THEN
                RETURN NEW;
            ELSIF NEW.status = 'accepted' AND v_is_client_manager THEN
                RETURN NEW;
            ELSIF NEW.status = 'rejected' AND v_is_client_manager THEN
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Unauthorized transition: under_review -> % by current actor', NEW.status
                    USING ERRCODE = '22023';
            END IF;

        WHEN 'interviewing' THEN
            IF NEW.status = 'withdrawn' AND v_is_freelancer THEN
                RETURN NEW;
            ELSIF NEW.status = 'accepted' AND v_is_client_manager THEN
                RETURN NEW;
            ELSIF NEW.status = 'rejected' AND v_is_client_manager THEN
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Unauthorized transition: interviewing -> % by current actor', NEW.status
                    USING ERRCODE = '22023';
            END IF;

        ELSE
            RAISE EXCEPTION 'Illegal status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '22023';
    END CASE;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_integrity ON public.proposals;

CREATE TRIGGER trg_proposals_integrity
    BEFORE UPDATE ON public.proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.check_proposal_integrity();

REVOKE ALL ON FUNCTION public.check_proposal_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_proposal_integrity() FROM anon;
REVOKE ALL ON FUNCTION public.check_proposal_integrity() FROM authenticated;

-- 4. Atomic Proposal Counter Synchronization Trigger
CREATE OR REPLACE FUNCTION public.sync_job_proposal_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('withdrawn', 'rejected') THEN
            UPDATE public.jobs
               SET proposals_count = proposals_count + 1
             WHERE id = NEW.job_id;
        END IF;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status NOT IN ('withdrawn', 'rejected') THEN
            UPDATE public.jobs
               SET proposals_count = GREATEST(0, proposals_count - 1)
             WHERE id = OLD.job_id;
        END IF;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle active status entry/exit
        IF (OLD.status NOT IN ('withdrawn', 'rejected')) AND (NEW.status IN ('withdrawn', 'rejected')) THEN
            UPDATE public.jobs
               SET proposals_count = GREATEST(0, proposals_count - 1)
             WHERE id = NEW.job_id;
        ELSIF (OLD.status IN ('withdrawn', 'rejected')) AND (NEW.status NOT IN ('withdrawn', 'rejected')) THEN
            UPDATE public.jobs
               SET proposals_count = proposals_count + 1
             WHERE id = NEW.job_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_sync_count ON public.proposals;

CREATE TRIGGER trg_proposals_sync_count
    AFTER INSERT OR DELETE OR UPDATE OF status ON public.proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_job_proposal_count();

REVOKE ALL ON FUNCTION public.sync_job_proposal_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_job_proposal_count() FROM anon;
REVOKE ALL ON FUNCTION public.sync_job_proposal_count() FROM authenticated;
