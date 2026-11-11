-- Migration: 20261103000012_fix_milestones_table_reference.sql
-- Description: Fix table reference in create_contract_offer from 'milestones' to 'contract_milestones',
--              ensure backward-compatible view for 'public.milestones',
--              and fix notifications table actor_id column compatibility across offer RPCs.

-- ============================================================================
-- 1. NOTIFICATIONS TABLE SCHEMA DEFENSIVE PATCH
-- ============================================================================
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. CREATE BACKWARD-COMPATIBLE VIEW: public.milestones
-- ============================================================================
CREATE OR REPLACE VIEW public.milestones AS
    SELECT * FROM public.contract_milestones;

COMMENT ON VIEW public.milestones IS 'Backward-compatible view resolving public.milestones to public.contract_milestones.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO authenticated, service_role;

-- ============================================================================
-- 3. FUNCTION: create_contract_offer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_contract_offer(
    p_proposal_id uuid,
    p_contract_type text,
    p_title text,
    p_hourly_rate numeric DEFAULT NULL,
    p_fixed_price numeric DEFAULT NULL,
    p_weekly_hour_limit integer DEFAULT NULL,
    p_allow_manual_time boolean DEFAULT true,
    p_offer_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_proposal RECORD;
    v_job RECORD;
    v_contract_id uuid;
    v_is_client_manager boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create contract offer' USING ERRCODE = '42501';
    END IF;

    -- Fetch proposal
    SELECT id, job_id, freelancer_id, status, bid_amount, rate_type
      INTO v_proposal
      FROM public.proposals
     WHERE id = p_proposal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = '23503';
    END IF;

    IF v_proposal.status IN ('rejected', 'withdrawn') THEN
        RAISE EXCEPTION 'Cannot create an offer for a proposal that is %', v_proposal.status USING ERRCODE = '22023';
    END IF;

    -- Fetch parent job
    SELECT id, client_id, company_id, title, status
      INTO v_job
      FROM public.jobs
     WHERE id = v_proposal.job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent job not found' USING ERRCODE = '23503';
    END IF;

    -- Authorization check
    IF v_job.client_id = v_caller THEN
        v_is_client_manager := true;
    ELSIF v_job.company_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_job.company_id
               AND cm.user_id = v_caller
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) INTO v_is_client_manager;
    END IF;

    IF NOT v_is_client_manager THEN
        RAISE EXCEPTION 'Caller is not authorized to create an offer for this job' USING ERRCODE = '42501';
    END IF;

    -- Prevent duplicate pending or active contracts on the same proposal
    IF EXISTS (
        SELECT 1 FROM public.contracts c
         WHERE c.proposal_id = p_proposal_id
           AND c.status IN ('pending_offer', 'active')
    ) THEN
        RAISE EXCEPTION 'An offer or active contract already exists for this proposal' USING ERRCODE = '23505';
    END IF;

    -- Validate contract terms
    IF p_contract_type = 'hourly' THEN
        IF p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
            RAISE EXCEPTION 'Hourly contract requires a positive hourly rate' USING ERRCODE = '22023';
        END IF;
    ELSIF p_contract_type = 'fixed' THEN
        IF p_fixed_price IS NULL OR p_fixed_price <= 0 THEN
            RAISE EXCEPTION 'Fixed price contract requires a positive fixed price' USING ERRCODE = '22023';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid contract_type: %. Must be hourly or fixed', p_contract_type USING ERRCODE = '22023';
    END IF;

    -- Insert contract in pending_offer status
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
        allow_manual_time,
        offer_message,
        offer_expires_at,
        status
    ) VALUES (
        p_proposal_id,
        v_job.id,
        v_job.client_id,
        v_job.company_id,
        v_proposal.freelancer_id,
        p_contract_type,
        COALESCE(NULLIF(trim(p_title), ''), v_job.title),
        CASE WHEN p_contract_type = 'hourly' THEN p_hourly_rate ELSE NULL END,
        CASE WHEN p_contract_type = 'fixed' THEN p_fixed_price ELSE NULL END,
        CASE WHEN p_contract_type = 'hourly' THEN COALESCE(p_weekly_hour_limit, 40) ELSE NULL END,
        COALESCE(p_allow_manual_time, true),
        NULLIF(trim(p_offer_message), ''),
        now() + interval '7 days',
        'pending_offer'
    ) RETURNING id INTO v_contract_id;

    -- For fixed price contracts, create initial milestone in contract_milestones
    IF p_contract_type = 'fixed' THEN
        INSERT INTO public.contract_milestones (
            contract_id,
            client_id,
            freelancer_id,
            title,
            description,
            amount,
            currency,
            sequence_order,
            status
        ) VALUES (
            v_contract_id,
            v_job.client_id,
            v_proposal.freelancer_id,
            'Initial Project Milestone',
            'Full scope and agreed deliverables for contract: ' || COALESCE(NULLIF(trim(p_title), ''), v_job.title),
            p_fixed_price,
            'USD',
            1,
            'planned'
        ) ON CONFLICT (contract_id, sequence_order) DO NOTHING;
    END IF;

    -- Advance proposal status to interviewing if submitted or under_review
    IF v_proposal.status IN ('submitted', 'under_review') THEN
        UPDATE public.proposals
           SET status = 'interviewing',
               updated_at = now()
         WHERE id = p_proposal_id;
    END IF;

    -- Notify freelancer using standard notifications columns with actor info in metadata
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        link,
        metadata
    ) VALUES (
        v_proposal.freelancer_id,
        'contract_offer_received',
        'Contract Offer Received',
        'You received an offer for "' || v_job.title || '"',
        '/contracts/' || v_contract_id::text,
        jsonb_build_object('actor_id', v_caller, 'contract_id', v_contract_id)
    );

    RETURN v_contract_id;
END;
$$;

-- ============================================================================
-- 4. FUNCTION: accept_contract_offer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_contract_offer(
    p_contract_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_contract RECORD;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT id, proposal_id, job_id, client_id, freelancer_id, title, status
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = '23503';
    END IF;

    IF v_contract.freelancer_id <> v_caller THEN
        RAISE EXCEPTION 'Only the invited freelancer can accept this offer' USING ERRCODE = '42501';
    END IF;

    IF v_contract.status <> 'pending_offer' THEN
        RAISE EXCEPTION 'This offer is in status "%" and cannot be accepted', v_contract.status USING ERRCODE = '22023';
    END IF;

    -- Activate contract
    UPDATE public.contracts
       SET status = 'active',
           offer_accepted_at = now(),
           updated_at = now()
     WHERE id = p_contract_id;

    -- Mark proposal accepted
    UPDATE public.proposals
       SET status = 'accepted',
           updated_at = now()
     WHERE id = v_contract.proposal_id;

    -- Notify client using standard notifications columns with actor info in metadata
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        link,
        metadata
    ) VALUES (
        v_contract.client_id,
        'contract_offer_accepted',
        'Offer Accepted',
        'Your contract offer for "' || v_contract.title || '" was accepted!',
        '/contracts/' || p_contract_id::text,
        jsonb_build_object('actor_id', v_caller, 'contract_id', p_contract_id)
    );

    RETURN true;
END;
$$;

-- ============================================================================
-- 5. FUNCTION: decline_contract_offer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.decline_contract_offer(
    p_contract_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_contract RECORD;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT id, proposal_id, job_id, client_id, freelancer_id, title, status
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = '23503';
    END IF;

    IF v_contract.freelancer_id <> v_caller THEN
        RAISE EXCEPTION 'Only the invited freelancer can decline this offer' USING ERRCODE = '42501';
    END IF;

    IF v_contract.status <> 'pending_offer' THEN
        RAISE EXCEPTION 'This offer is in status "%" and cannot be declined', v_contract.status USING ERRCODE = '22023';
    END IF;

    -- Decline contract
    UPDATE public.contracts
       SET status = 'declined',
           declined_reason = NULLIF(trim(p_reason), ''),
           offer_declined_at = now(),
           updated_at = now()
     WHERE id = p_contract_id;

    -- Notify client using standard notifications columns with actor info in metadata
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        link,
        metadata
    ) VALUES (
        v_contract.client_id,
        'contract_offer_declined',
        'Offer Declined',
        'Your contract offer for "' || v_contract.title || '" was declined.',
        '/contracts/' || p_contract_id::text,
        jsonb_build_object('actor_id', v_caller, 'contract_id', p_contract_id)
    );

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_contract_offer TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_contract_offer TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_contract_offer TO authenticated;
