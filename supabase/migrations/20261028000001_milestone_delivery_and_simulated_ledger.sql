-- Migration: 20261028000001_milestone_delivery_and_simulated_ledger.sql
-- Description: Milestone lifecycle, delivery submissions, review workflows,
--              append-only simulated payment ledger, and Row Level Security (RLS).

-- ============================================================================
-- 1. CONTRACT MILESTONES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contract_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (length(trim(title)) >= 3),
    description text NOT NULL DEFAULT '',
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    sequence_order integer NOT NULL DEFAULT 1 CHECK (sequence_order >= 1),
    due_date date,
    status text NOT NULL DEFAULT 'planned' CONSTRAINT chk_milestone_status CHECK (
        status IN (
            'planned',
            'funded',
            'in_progress',
            'submitted',
            'revision_requested',
            'approved',
            'released',
            'cancelled'
        )
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contract_milestone_seq UNIQUE (contract_id, sequence_order)
);

COMMENT ON TABLE public.contract_milestones IS 'Sequential project phases for fixed-price contracts supporting escrow funding and release.';

-- ============================================================================
-- 2. MILESTONE DELIVERIES TABLE (Preserving Submission History)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.milestone_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id uuid NOT NULL REFERENCES public.contract_milestones(id) ON DELETE CASCADE,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    delivery_notes text NOT NULL CHECK (length(trim(delivery_notes)) >= 1),
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    review_status text NOT NULL DEFAULT 'pending' CONSTRAINT chk_delivery_review_status CHECK (
        review_status IN ('pending', 'approved', 'revision_requested', 'superseded')
    ),
    client_feedback text,
    reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.milestone_deliveries IS 'Granular delivery submissions and client review records with complete revision history.';

-- ============================================================================
-- 3. SIMULATED PAYMENT LEDGER TABLE (Append-Only Financial Events)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    milestone_id uuid REFERENCES public.contract_milestones(id) ON DELETE SET NULL,
    from_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    to_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    event_type text NOT NULL CONSTRAINT chk_ledger_event_type CHECK (
        event_type IN (
            'escrow_funded',        -- Client deposits milestone funds into simulated escrow
            'escrow_released',      -- Milestone approved; funds drawn from escrow
            'payout_disbursed',     -- Net earnings deposited to freelancer profile
            'service_fee_deducted', -- Platform service fee (e.g. 10%)
            'escrow_refund'         -- Refund from escrow back to client (upon milestone cancellation)
        )
    ),
    status text NOT NULL DEFAULT 'succeeded' CONSTRAINT chk_ledger_status CHECK (
        status IN ('succeeded', 'pending', 'reversed')
    ),
    description text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_ledger IS 'Append-only audit trail of simulated escrow deposits, releases, fees, and payouts.';

-- ============================================================================
-- 4. INTEGRITY CONSTRAINTS & APPEND-ONLY TRIGGERS
-- ============================================================================

-- A. Validate Contract Milestone Eligibility (Contract must be fixed-price and match participants)
CREATE OR REPLACE FUNCTION public.check_milestone_contract_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_contract RECORD;
BEGIN
    SELECT id, contract_type, status, client_id, freelancer_id
      INTO v_contract
      FROM public.contracts
     WHERE id = NEW.contract_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referenced contract % not found', NEW.contract_id
            USING ERRCODE = '23503';
    END IF;

    -- Strict Rule: Milestones are exclusively for fixed-price contracts
    IF v_contract.contract_type <> 'fixed' THEN
        RAISE EXCEPTION 'Milestones are only permitted on fixed-price contracts (contract % is %)', NEW.contract_id, v_contract.contract_type
            USING ERRCODE = '22023';
    END IF;

    -- Milestones cannot be added to cancelled contracts
    IF v_contract.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot configure milestones on cancelled contract %', NEW.contract_id
            USING ERRCODE = '22023';
    END IF;

    -- Authoritative participant verification
    IF NEW.client_id <> v_contract.client_id THEN
        RAISE EXCEPTION 'Milestone client_id (%) does not match contract client_id (%)', NEW.client_id, v_contract.client_id
            USING ERRCODE = '42501';
    END IF;

    IF NEW.freelancer_id <> v_contract.freelancer_id THEN
        RAISE EXCEPTION 'Milestone freelancer_id (%) does not match contract freelancer_id (%)', NEW.freelancer_id, v_contract.freelancer_id
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milestone_contract_eligibility ON public.contract_milestones;

CREATE TRIGGER trg_milestone_contract_eligibility
    BEFORE INSERT OR UPDATE OF contract_id, client_id, freelancer_id ON public.contract_milestones
    FOR EACH ROW
    EXECUTE FUNCTION public.check_milestone_contract_eligibility();

-- B. Validate Milestone State Transitions
CREATE OR REPLACE FUNCTION public.check_milestone_state_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (OLD.status = NEW.status) THEN
        RETURN NEW;
    END IF;

    -- Enforce legal milestone workflow
    IF OLD.status = 'planned' AND NEW.status NOT IN ('funded', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from "planned" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'funded' AND NEW.status NOT IN ('in_progress', 'submitted', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from "funded" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'in_progress' AND NEW.status NOT IN ('submitted', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from "in_progress" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'submitted' AND NEW.status NOT IN ('approved', 'revision_requested', 'released') THEN
        RAISE EXCEPTION 'Invalid transition from "submitted" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'revision_requested' AND NEW.status NOT IN ('submitted', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from "revision_requested" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'approved' AND NEW.status NOT IN ('released') THEN
        RAISE EXCEPTION 'Invalid transition from "approved" to "%"', NEW.status USING ERRCODE = '22023';
    ELSIF OLD.status = 'released' THEN
        RAISE EXCEPTION 'Milestone is already released and cannot transition further' USING ERRCODE = '22023';
    ELSIF OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'Milestone is cancelled and cannot transition further' USING ERRCODE = '22023';
    END IF;

    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milestone_state_transition ON public.contract_milestones;

CREATE TRIGGER trg_milestone_state_transition
    BEFORE UPDATE OF status ON public.contract_milestones
    FOR EACH ROW
    EXECUTE FUNCTION public.check_milestone_state_transition();

-- C. Strict Append-Only Enforcement for Payment Ledger
CREATE OR REPLACE FUNCTION public.prevent_payment_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'The payment ledger is strictly append-only. Updates and deletions are forbidden.'
        USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_payment_ledger_update ON public.payment_ledger;

CREATE TRIGGER trg_prevent_payment_ledger_update
    BEFORE UPDATE ON public.payment_ledger
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_payment_ledger_mutation();

DROP TRIGGER IF EXISTS trg_prevent_payment_ledger_delete ON public.payment_ledger;

CREATE TRIGGER trg_prevent_payment_ledger_delete
    BEFORE DELETE ON public.payment_ledger
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_payment_ledger_mutation();

-- D. Automated Initial Milestone Creation for Fixed-Price Contracts
CREATE OR REPLACE FUNCTION public.create_initial_milestone_for_fixed_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.contract_type = 'fixed' AND NEW.fixed_price IS NOT NULL AND NEW.fixed_price > 0 THEN
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
            NEW.id,
            NEW.client_id,
            NEW.freelancer_id,
            'Milestone 1: Project Deliverables',
            'Full scope and agreed deliverables for contract: ' || NEW.title,
            NEW.fixed_price,
            'USD',
            1,
            'planned'
        )
        ON CONFLICT (contract_id, sequence_order) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_initial_milestone ON public.contracts;

CREATE TRIGGER trg_contract_initial_milestone
    AFTER INSERT ON public.contracts
    FOR EACH ROW
    EXECUTE FUNCTION public.create_initial_milestone_for_fixed_contract();

-- ============================================================================
-- 5. TRUSTED STORED PROCEDURES (Atomic Milestone Operations)
-- ============================================================================

-- Procedure 1: Create Milestone
CREATE OR REPLACE FUNCTION public.create_milestone(
    p_contract_id uuid,
    p_title text,
    p_description text,
    p_amount numeric,
    p_due_date date DEFAULT NULL
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_contract RECORD;
    v_next_seq integer;
    v_milestone public.contract_milestones;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create a milestone' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = p_contract_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = '23503';
    END IF;

    -- Authorize client or authorized company manager
    IF v_contract.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can create milestones for this contract' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_contract.contract_type <> 'fixed' THEN
        RAISE EXCEPTION 'Milestones are only permitted on fixed-price contracts' USING ERRCODE = '22023';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Milestone amount must be positive' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(MAX(sequence_order), 0) + 1 INTO v_next_seq
      FROM public.contract_milestones
     WHERE contract_id = p_contract_id;

    INSERT INTO public.contract_milestones (
        contract_id,
        client_id,
        freelancer_id,
        title,
        description,
        amount,
        currency,
        sequence_order,
        due_date,
        status
    ) VALUES (
        p_contract_id,
        v_contract.client_id,
        v_contract.freelancer_id,
        trim(p_title),
        COALESCE(trim(p_description), ''),
        p_amount,
        'USD',
        v_next_seq,
        p_due_date,
        'planned'
    )
    RETURNING * INTO v_milestone;

    RETURN v_milestone;
END;
$$;

-- Procedure 2: Fund Milestone Escrow
CREATE OR REPLACE FUNCTION public.fund_milestone(
    p_milestone_id uuid
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Authorization check
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can fund this milestone' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_milestone.status <> 'planned' THEN
        RAISE EXCEPTION 'Milestone % is in state "%" and cannot be funded', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Update milestone status
    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    -- Record append-only escrow deposit ledger entry
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_milestone.client_id,
        NULL,
        v_milestone.amount,
        v_milestone.currency,
        'escrow_funded',
        'succeeded',
        'Escrow Funded: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')',
        jsonb_build_object(
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'funded_by', v_actor_id,
            'timestamp', clock_timestamp()
        )
    );

    RETURN v_milestone;
END;
$$;

-- Procedure 3: Start Milestone Work
CREATE OR REPLACE FUNCTION public.start_milestone_work(
    p_milestone_id uuid
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    -- Freelancer or client can transition funded milestone to in_progress
    IF v_milestone.freelancer_id <> v_actor_id AND v_milestone.client_id <> v_actor_id THEN
        RAISE EXCEPTION 'Not authorized to start work on this milestone' USING ERRCODE = '42501';
    END IF;

    IF v_milestone.status <> 'funded' THEN
        RAISE EXCEPTION 'Milestone must be funded before starting work (current status: %)', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.contract_milestones
       SET status = 'in_progress',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    RETURN v_milestone;
END;
$$;

-- Procedure 4: Submit Milestone Delivery (Preserves History)
CREATE OR REPLACE FUNCTION public.submit_milestone_delivery(
    p_milestone_id uuid,
    p_delivery_notes text,
    p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS public.milestone_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_next_version integer;
    v_delivery public.milestone_deliveries;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF trim(p_delivery_notes) = '' THEN
        RAISE EXCEPTION 'Delivery notes cannot be empty' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    -- Only assigned freelancer can submit work
    IF v_milestone.freelancer_id <> v_actor_id THEN
        RAISE EXCEPTION 'Only the contracted freelancer can submit milestone deliverables' USING ERRCODE = '42501';
    END IF;

    IF v_milestone.status NOT IN ('funded', 'in_progress', 'revision_requested') THEN
        RAISE EXCEPTION 'Cannot submit delivery for milestone in status "%"', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Calculate version
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
      FROM public.milestone_deliveries
     WHERE milestone_id = p_milestone_id;

    -- Mark previous pending deliveries as superseded
    UPDATE public.milestone_deliveries
       SET review_status = 'superseded'
     WHERE milestone_id = p_milestone_id
       AND review_status = 'pending';

    -- Insert new delivery record
    INSERT INTO public.milestone_deliveries (
        milestone_id,
        freelancer_id,
        delivery_notes,
        attachments,
        submitted_at,
        review_status,
        version
    ) VALUES (
        p_milestone_id,
        v_actor_id,
        trim(p_delivery_notes),
        COALESCE(p_attachments, '[]'::jsonb),
        clock_timestamp(),
        'pending',
        v_next_version
    )
    RETURNING * INTO v_delivery;

    -- Update milestone state to submitted
    UPDATE public.contract_milestones
       SET status = 'submitted',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id;

    RETURN v_delivery;
END;
$$;

-- Procedure 5: Request Milestone Revision
CREATE OR REPLACE FUNCTION public.request_milestone_revision(
    p_milestone_id uuid,
    p_feedback text,
    p_delivery_id uuid DEFAULT NULL
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_target_delivery_id uuid;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF trim(p_feedback) = '' THEN
        RAISE EXCEPTION 'Feedback instructions are required when requesting revisions' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Authorization check
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can review milestone submissions' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_milestone.status <> 'submitted' THEN
        RAISE EXCEPTION 'Milestone must be in "submitted" status to request revisions (current: %)', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Determine target delivery
    IF p_delivery_id IS NOT NULL THEN
        v_target_delivery_id := p_delivery_id;
    ELSE
        SELECT id INTO v_target_delivery_id
          FROM public.milestone_deliveries
         WHERE milestone_id = p_milestone_id
           AND review_status = 'pending'
         ORDER BY version DESC
         LIMIT 1;
    END IF;

    IF v_target_delivery_id IS NOT NULL THEN
        UPDATE public.milestone_deliveries
           SET review_status = 'revision_requested',
               client_feedback = trim(p_feedback),
               reviewed_by = v_actor_id,
               reviewed_at = clock_timestamp()
         WHERE id = v_target_delivery_id;
    END IF;

    UPDATE public.contract_milestones
       SET status = 'revision_requested',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    RETURN v_milestone;
END;
$$;

-- Procedure 6: Approve and Release Milestone
CREATE OR REPLACE FUNCTION public.approve_and_release_milestone(
    p_milestone_id uuid,
    p_feedback text DEFAULT '',
    p_delivery_id uuid DEFAULT NULL
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_target_delivery_id uuid;
    v_fee_amount numeric(12,2);
    v_net_payout numeric(12,2);
    v_remaining_count integer;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Authorization check
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can approve and release milestone funds' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Milestone must have been funded and can be submitted or approved
    IF v_milestone.status NOT IN ('submitted', 'funded', 'in_progress', 'revision_requested') THEN
        RAISE EXCEPTION 'Milestone status "%" is not eligible for approval and release', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- Update latest pending delivery if present
    IF p_delivery_id IS NOT NULL THEN
        v_target_delivery_id := p_delivery_id;
    ELSE
        SELECT id INTO v_target_delivery_id
          FROM public.milestone_deliveries
         WHERE milestone_id = p_milestone_id
           AND review_status = 'pending'
         ORDER BY version DESC
         LIMIT 1;
    END IF;

    IF v_target_delivery_id IS NOT NULL THEN
        UPDATE public.milestone_deliveries
           SET review_status = 'approved',
               client_feedback = COALESCE(NULLIF(trim(p_feedback), ''), 'Approved by client'),
               reviewed_by = v_actor_id,
               reviewed_at = clock_timestamp()
         WHERE id = v_target_delivery_id;
    END IF;

    -- Calculate standard platform fee (10%) and net payout (90%)
    v_fee_amount := ROUND(v_milestone.amount * 0.10, 2);
    v_net_payout := v_milestone.amount - v_fee_amount;

    -- Transition milestone to approved and then released
    UPDATE public.contract_milestones
       SET status = 'released',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    -- 1. Record Escrow Release
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_milestone.client_id,
        v_milestone.freelancer_id,
        v_milestone.amount,
        v_milestone.currency,
        'escrow_released',
        'succeeded',
        'Escrow Released: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')',
        jsonb_build_object(
            'approved_by', v_actor_id,
            'client_feedback', trim(p_feedback)
        )
    );

    -- 2. Record Service Fee Deduction
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        v_milestone.freelancer_id,
        NULL,
        v_fee_amount,
        v_milestone.currency,
        'service_fee_deducted',
        'succeeded',
        'Workspace Freelancer Service Fee (10%) for Milestone #' || v_milestone.sequence_order,
        jsonb_build_object(
            'rate', 0.10,
            'gross_amount', v_milestone.amount
        )
    );

    -- 3. Record Net Payout to Freelancer
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_milestone.contract_id,
        v_milestone.id,
        NULL,
        v_milestone.freelancer_id,
        v_net_payout,
        v_milestone.currency,
        'payout_disbursed',
        'succeeded',
        'Net Earnings Disbursed to Freelancer for Milestone #' || v_milestone.sequence_order,
        jsonb_build_object(
            'net_amount', v_net_payout,
            'gross_amount', v_milestone.amount,
            'fee_amount', v_fee_amount
        )
    );

    -- Authoritative Profile Aggregates Update
    UPDATE public.profiles
       SET total_earnings = total_earnings + v_net_payout,
           updated_at = clock_timestamp()
     WHERE id = v_milestone.freelancer_id;

    UPDATE public.profiles
       SET total_spent = total_spent + v_milestone.amount,
           updated_at = clock_timestamp()
     WHERE id = v_milestone.client_id;

    -- Check if all contract milestones have completed
    SELECT COUNT(*) INTO v_remaining_count
      FROM public.contract_milestones
     WHERE contract_id = v_milestone.contract_id
       AND status NOT IN ('released', 'cancelled');

    IF v_remaining_count = 0 THEN
        UPDATE public.contracts
           SET status = 'completed',
               updated_at = clock_timestamp()
         WHERE id = v_milestone.contract_id;
    END IF;

    RETURN v_milestone;
END;
$$;

-- Procedure 7: Cancel Milestone
CREATE OR REPLACE FUNCTION public.cancel_milestone(
    p_milestone_id uuid,
    p_reason text DEFAULT ''
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_was_funded boolean := false;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    -- Authorization check
    IF v_milestone.client_id <> v_actor_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can cancel this milestone' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_milestone.status NOT IN ('planned', 'funded') THEN
        RAISE EXCEPTION 'Cannot cancel milestone in state "%"', v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    IF v_milestone.status = 'funded' THEN
        v_was_funded := true;
    END IF;

    UPDATE public.contract_milestones
       SET status = 'cancelled',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    -- If milestone was funded, refund the client automatically
    IF v_was_funded THEN
        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_milestone.contract_id,
            v_milestone.id,
            NULL,
            v_milestone.client_id,
            v_milestone.amount,
            v_milestone.currency,
            'escrow_refund',
            'succeeded',
            'Simulated Escrow Refund to Client upon Milestone Cancellation: #' || v_milestone.sequence_order,
            jsonb_build_object(
                'cancelled_by', v_actor_id,
                'cancellation_reason', trim(p_reason),
                'refund_amount', v_milestone.amount
            )
        );
    END IF;

    RETURN v_milestone;
END;
$$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.contract_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Contract Milestones Policies
-- ----------------------------------------------------------------------------
CREATE POLICY milestones_select_involved
    ON public.contract_milestones
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR client_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = contract_milestones.contract_id
               AND c.company_id IS NOT NULL
               AND c.company_id IN (SELECT public.get_my_company_ids())
        )
    );

CREATE POLICY milestones_insert_client
    ON public.contract_milestones
    FOR INSERT
    TO authenticated
    WITH CHECK (
        client_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = contract_id
               AND c.company_id IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = c.company_id
                      AND cm.user_id = auth.uid()
                      AND cm.role IN ('owner', 'admin', 'hiring_manager')
               )
        )
    );

CREATE POLICY milestones_update_involved
    ON public.contract_milestones
    FOR UPDATE
    TO authenticated
    USING (
        client_id = auth.uid()
        OR freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = contract_milestones.contract_id
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
-- Milestone Deliveries Policies
-- ----------------------------------------------------------------------------
CREATE POLICY deliveries_select_involved
    ON public.milestone_deliveries
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contract_milestones m
             WHERE m.id = milestone_deliveries.milestone_id
               AND (
                   m.client_id = auth.uid()
                   OR EXISTS (
                       SELECT 1 FROM public.contracts c
                        WHERE c.id = m.contract_id
                          AND c.company_id IS NOT NULL
                          AND c.company_id IN (SELECT public.get_my_company_ids())
                   )
               )
        )
    );

CREATE POLICY deliveries_insert_freelancer
    ON public.milestone_deliveries
    FOR INSERT
    TO authenticated
    WITH CHECK (
        freelancer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.contract_milestones m
             WHERE m.id = milestone_id
               AND m.freelancer_id = auth.uid()
               AND m.status IN ('funded', 'in_progress', 'revision_requested')
        )
    );

CREATE POLICY deliveries_update_client
    ON public.milestone_deliveries
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.contract_milestones m
             WHERE m.id = milestone_deliveries.milestone_id
               AND (
                   m.client_id = auth.uid()
                   OR EXISTS (
                       SELECT 1 FROM public.contracts c
                        WHERE c.id = m.contract_id
                          AND c.company_id IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM public.company_members cm
                               WHERE cm.company_id = c.company_id
                                 AND cm.user_id = auth.uid()
                                 AND cm.role IN ('owner', 'admin', 'hiring_manager')
                          )
                   )
               )
        )
    );

-- ----------------------------------------------------------------------------
-- Payment Ledger Policies (Append-Only Audit)
-- ----------------------------------------------------------------------------
CREATE POLICY payment_ledger_select_involved
    ON public.payment_ledger
    FOR SELECT
    TO authenticated
    USING (
        from_user_id = auth.uid()
        OR to_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = payment_ledger.contract_id
               AND (
                   c.client_id = auth.uid()
                   OR c.freelancer_id = auth.uid()
                   OR (
                       c.company_id IS NOT NULL
                       AND c.company_id IN (SELECT public.get_my_company_ids())
                   )
               )
        )
    );

-- Prohibit client-side INSERT/UPDATE/DELETE on payment_ledger
REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM authenticated;

-- ============================================================================
-- 7. LEAST PRIVILEGE TABLE & COLUMN GRANTS
-- ============================================================================
GRANT SELECT ON public.contract_milestones TO authenticated;
GRANT SELECT ON public.milestone_deliveries TO authenticated;
GRANT SELECT ON public.payment_ledger TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_milestone_work TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_milestone_delivery TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_milestone_revision TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_release_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_milestone TO authenticated;
