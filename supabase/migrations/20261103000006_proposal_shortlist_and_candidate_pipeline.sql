-- Migration: 20261103000006_proposal_shortlist_and_candidate_pipeline.sql
-- Description: Client candidate pipeline management: shortlisted candidates,
--              rejection reasons, internal notes, and pipeline management RPCs.

-- 1. Add Candidate Pipeline Columns to public.proposals
ALTER TABLE public.proposals 
    ADD COLUMN IF NOT EXISTS is_shortlisted boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS shortlisted_at timestamptz,
    ADD COLUMN IF NOT EXISTS declined_reason text,
    ADD COLUMN IF NOT EXISTS client_notes text;

COMMENT ON COLUMN public.proposals.is_shortlisted IS 'Flag indicating client has shortlisted this applicant (thumbs up).';
COMMENT ON COLUMN public.proposals.shortlisted_at IS 'Timestamp when the proposal was marked as shortlisted.';
COMMENT ON COLUMN public.proposals.declined_reason IS 'Reason or note provided by the client when declining/rejecting a proposal.';
COMMENT ON COLUMN public.proposals.client_notes IS 'Private internal evaluation notes left by the hiring client.';

-- 2. Indexes for fast pipeline filtering
CREATE INDEX IF NOT EXISTS idx_proposals_job_shortlisted 
    ON public.proposals (job_id, is_shortlisted);

CREATE INDEX IF NOT EXISTS idx_proposals_job_status 
    ON public.proposals (job_id, status);

CREATE INDEX IF NOT EXISTS idx_proposals_client_pipeline 
    ON public.proposals (job_id, status, is_shortlisted);

-- 3. Update Column-Specific UPDATE Privileges
GRANT UPDATE (status, is_shortlisted, shortlisted_at, declined_reason, client_notes) 
    ON public.proposals TO authenticated;

-- 4. Update Proposal Lifecycle & Integrity Trigger
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

    -- 3. Read Job Context authoritatively
    SELECT j.client_id, j.company_id, j.status
      INTO v_job_client_id, v_job_company_id, v_job_status
      FROM public.jobs j
     WHERE j.id = OLD.job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced job % not found', OLD.job_id
            USING ERRCODE = '23503';
    END IF;

    -- 4. Evaluate Actor Permissions
    v_is_freelancer := (OLD.freelancer_id = v_actor_id);

    IF v_job_client_id = v_actor_id THEN
        v_is_client_manager := true;
    ELSIF v_job_company_id IS NOT NULL THEN
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

    -- 5. Guard client-only evaluation fields against freelancer tampering
    IF (OLD.is_shortlisted IS DISTINCT FROM NEW.is_shortlisted OR
        OLD.shortlisted_at IS DISTINCT FROM NEW.shortlisted_at OR
        OLD.declined_reason IS DISTINCT FROM NEW.declined_reason OR
        OLD.client_notes IS DISTINCT FROM NEW.client_notes) AND NOT v_is_client_manager THEN
        RAISE EXCEPTION 'Only client managers can modify candidate evaluation fields'
            USING ERRCODE = '42501';
    END IF;

    -- 6. Maintain shortlisted_at timestamp automatically
    IF NEW.is_shortlisted IS TRUE AND OLD.is_shortlisted IS NOT TRUE THEN
        NEW.shortlisted_at := clock_timestamp();
    ELSIF NEW.is_shortlisted IS FALSE AND OLD.is_shortlisted IS TRUE THEN
        NEW.shortlisted_at := NULL;
    END IF;

    -- Always overwrite updated_at with database clock time
    NEW.updated_at := clock_timestamp();

    -- 7. Terminal State Lockout
    -- Accepted and Withdrawn states are fully locked
    IF OLD.status IN ('accepted', 'withdrawn') THEN
        RAISE EXCEPTION 'Proposal is in terminal state "%" and cannot be modified', OLD.status
            USING ERRCODE = '22023';
    END IF;

    -- For Rejected proposals: cannot change status out of rejected, but client manager
    -- may toggle shortlist or notes for candidate records
    IF OLD.status = 'rejected' THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            RAISE EXCEPTION 'Proposal is in terminal state "rejected" and cannot be reactivated'
                USING ERRCODE = '22023';
        END IF;
        RETURN NEW;
    END IF;

    -- 8. Validate No-Op Updates (e.g. toggling shortlist or saving notes without changing status)
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- 9. Disallow Status Changes If Parent Job Is Not Published
    IF v_job_status <> 'published' AND NEW.status <> 'withdrawn' THEN
        RAISE EXCEPTION 'Cannot update proposal status while job is %', v_job_status
            USING ERRCODE = '22023';
    END IF;

    -- 10. Explicit State Transition Matrix
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


-- 5. Atomic Client Action RPC: Toggle Proposal Shortlist
CREATE OR REPLACE FUNCTION public.toggle_proposal_shortlist(
    p_proposal_id uuid,
    p_shortlist boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_job_id uuid;
    v_job_client_id uuid;
    v_job_company_id uuid;
    v_is_client_manager boolean := false;
    v_curr_status text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT p.job_id, p.status, j.client_id, j.company_id
      INTO v_job_id, v_curr_status, v_job_client_id, v_job_company_id
      FROM public.proposals p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
    END IF;

    IF v_curr_status = 'withdrawn' THEN
        RAISE EXCEPTION 'Cannot shortlist a withdrawn proposal' USING ERRCODE = '22023';
    END IF;

    IF v_job_client_id = v_actor_id THEN
        v_is_client_manager := true;
    ELSIF v_job_company_id IS NOT NULL THEN
        v_is_client_manager := EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_job_company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        );
    END IF;

    IF NOT v_is_client_manager THEN
        RAISE EXCEPTION 'Unauthorized: Only client managers can shortlist candidates' USING ERRCODE = '42501';
    END IF;

    UPDATE public.proposals
       SET is_shortlisted = p_shortlist,
           shortlisted_at = CASE WHEN p_shortlist THEN clock_timestamp() ELSE NULL END,
           updated_at = clock_timestamp()
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
        'success', true,
        'proposal_id', p_proposal_id,
        'is_shortlisted', p_shortlist
    );
END;
$$;

-- 6. Atomic Client Action RPC: Decline / Reject Proposal With Reason
CREATE OR REPLACE FUNCTION public.decline_proposal(
    p_proposal_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_job_id uuid;
    v_freelancer_id uuid;
    v_job_title text;
    v_job_client_id uuid;
    v_job_company_id uuid;
    v_is_client_manager boolean := false;
    v_curr_status text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT p.job_id, p.freelancer_id, p.status, j.title, j.client_id, j.company_id
      INTO v_job_id, v_freelancer_id, v_curr_status, v_job_title, v_job_client_id, v_job_company_id
      FROM public.proposals p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
    END IF;

    IF v_curr_status IN ('accepted', 'rejected', 'withdrawn') THEN
        RAISE EXCEPTION 'Proposal is already in terminal state "%"', v_curr_status USING ERRCODE = '22023';
    END IF;

    IF v_job_client_id = v_actor_id THEN
        v_is_client_manager := true;
    ELSIF v_job_company_id IS NOT NULL THEN
        v_is_client_manager := EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_job_company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        );
    END IF;

    IF NOT v_is_client_manager THEN
        RAISE EXCEPTION 'Unauthorized: Only client managers can decline proposals' USING ERRCODE = '42501';
    END IF;

    UPDATE public.proposals
       SET status = 'rejected',
           declined_reason = NULLIF(trim(p_reason), ''),
           updated_at = clock_timestamp()
     WHERE id = p_proposal_id;

    -- Notify the freelancer politely
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        link,
        metadata
    ) VALUES (
        v_freelancer_id,
        'proposal_status_updated',
        'Proposal Update',
        format('Your proposal for "%s" was declined by the client.', v_job_title),
        '/freelancer',
        jsonb_build_object('proposalId', p_proposal_id, 'jobId', v_job_id, 'status', 'rejected')
    );

    RETURN jsonb_build_object(
        'success', true,
        'proposal_id', p_proposal_id,
        'status', 'rejected',
        'declined_reason', p_reason
    );
END;
$$;

-- 7. Atomic Client Action RPC: Save Client Notes
CREATE OR REPLACE FUNCTION public.set_proposal_notes(
    p_proposal_id uuid,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_job_client_id uuid;
    v_job_company_id uuid;
    v_is_client_manager boolean := false;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT j.client_id, j.company_id
      INTO v_job_client_id, v_job_company_id
      FROM public.proposals p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
    END IF;

    IF v_job_client_id = v_actor_id THEN
        v_is_client_manager := true;
    ELSIF v_job_company_id IS NOT NULL THEN
        v_is_client_manager := EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_job_company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        );
    END IF;

    IF NOT v_is_client_manager THEN
        RAISE EXCEPTION 'Unauthorized: Only client managers can write candidate notes' USING ERRCODE = '42501';
    END IF;

    UPDATE public.proposals
       SET client_notes = p_notes,
           updated_at = clock_timestamp()
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object(
        'success', true,
        'proposal_id', p_proposal_id,
        'client_notes', p_notes
    );
END;
$$;

-- 8. Execution Grants on Procedures
REVOKE ALL ON FUNCTION public.toggle_proposal_shortlist(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_proposal_shortlist(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_proposal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_proposal(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_proposal_notes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_proposal_notes(uuid, text) TO authenticated;
