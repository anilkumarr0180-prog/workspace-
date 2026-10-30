-- Migration: 20261030000002_marketplace_transfers_and_payouts.sql
-- Description: Marketplace payouts, simulated linked accounts, hourly timesheet billing,
--              idempotent transfer lifecycle, and delayed freelancer earnings settlement.

-- ============================================================================
-- 1. FREELANCER PAYOUT PROFILES (Marketplace Linked Account Onboarding)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.freelancer_payout_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'mock_route',
    provider_account_id text NOT NULL,
    account_status text NOT NULL DEFAULT 'activated' CONSTRAINT chk_payout_account_status CHECK (
        account_status IN ('created', 'under_review', 'needs_clarification', 'activated', 'suspended')
    ),
    legal_name text NOT NULL CHECK (length(trim(legal_name)) >= 2),
    business_type text NOT NULL DEFAULT 'individual' CONSTRAINT chk_payout_business_type CHECK (
        business_type IN ('individual', 'business')
    ),
    pan_last4 text,
    bank_account_last4 text,
    bank_ifsc text,
    bank_name text,
    payout_eligible boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_freelancer_payout_user UNIQUE (user_id),
    CONSTRAINT uq_freelancer_payout_account UNIQUE (provider, provider_account_id)
);

COMMENT ON TABLE public.freelancer_payout_profiles IS 'Freelancer linked-account onboarding records for marketplace disbursements.';

CREATE INDEX IF NOT EXISTS idx_payout_profiles_user_id ON public.freelancer_payout_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_payout_profiles_status ON public.freelancer_payout_profiles (account_status);

ALTER TABLE public.freelancer_payout_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_profiles_select_own
    ON public.freelancer_payout_profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY payout_profiles_insert_own
    ON public.freelancer_payout_profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY payout_profiles_update_own
    ON public.freelancer_payout_profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY payout_profiles_service_role
    ON public.freelancer_payout_profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.freelancer_payout_profiles TO authenticated;
GRANT ALL ON public.freelancer_payout_profiles TO service_role;

-- ============================================================================
-- 2. PAYOUT TRANSFERS TABLE (Idempotent Disbursement Lifecycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payout_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    milestone_id uuid REFERENCES public.contract_milestones(id) ON DELETE RESTRICT,
    timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE RESTRICT,
    recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'mock_route',
    provider_transfer_id text UNIQUE NOT NULL,
    provider_account_id text NOT NULL,
    gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
    fee_amount numeric(12,2) NOT NULL CHECK (fee_amount >= 0),
    net_amount numeric(12,2) NOT NULL CHECK (net_amount > 0),
    currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
    on_hold boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'processing' CONSTRAINT chk_payout_transfer_status CHECK (
        status IN ('pending', 'eligible', 'processing', 'completed', 'failed', 'reversed', 'on_hold')
    ),
    idempotency_key text UNIQUE NOT NULL,
    reversal_id text,
    failure_reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    settled_at timestamptz,
    CONSTRAINT chk_transfer_target CHECK (
        (milestone_id IS NOT NULL AND timesheet_id IS NULL) OR
        (milestone_id IS NULL AND timesheet_id IS NOT NULL)
    ),
    CONSTRAINT chk_transfer_math CHECK (
        gross_amount >= fee_amount + net_amount - 0.05 AND
        gross_amount <= fee_amount + net_amount + 0.05
    )
);

COMMENT ON TABLE public.payout_transfers IS 'Authoritative record of marketplace payouts and held transfers to linked accounts.';

CREATE INDEX IF NOT EXISTS idx_payout_transfers_contract ON public.payout_transfers (contract_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_milestone ON public.payout_transfers (milestone_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_timesheet ON public.payout_transfers (timesheet_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_recipient ON public.payout_transfers (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_status ON public.payout_transfers (status);
CREATE INDEX IF NOT EXISTS idx_payout_transfers_idempotency ON public.payout_transfers (idempotency_key);

ALTER TABLE public.payout_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_transfers_select_involved
    ON public.payout_transfers
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = recipient_user_id OR
        EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = payout_transfers.contract_id
               AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
        )
    );

CREATE POLICY payout_transfers_service_role
    ON public.payout_transfers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT ON public.payout_transfers TO authenticated;
GRANT ALL ON public.payout_transfers TO service_role;

-- ============================================================================
-- 3. EXTEND PAYMENT ATTEMPTS (Support Timesheet Hourly Billing)
-- ============================================================================
ALTER TABLE public.payment_attempts
    ALTER COLUMN milestone_id DROP NOT NULL;

ALTER TABLE public.payment_attempts
    ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'milestone';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_attempt_target'
    ) THEN
        ALTER TABLE public.payment_attempts
            ADD CONSTRAINT chk_payment_attempt_target CHECK (
                (billing_type = 'milestone' AND milestone_id IS NOT NULL) OR
                (billing_type = 'timesheet' AND timesheet_id IS NOT NULL)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_timesheet_id ON public.payment_attempts (timesheet_id)
    WHERE timesheet_id IS NOT NULL;

-- ============================================================================
-- 4. EXTEND PAYMENT LEDGER (Add Timesheet, Transfer References & Event Types)
-- ============================================================================
ALTER TABLE public.payment_ledger
    ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payout_transfer_id uuid REFERENCES public.payout_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_ledger_timesheet_id ON public.payment_ledger (timesheet_id)
    WHERE timesheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_ledger_payout_transfer ON public.payment_ledger (payout_transfer_id)
    WHERE payout_transfer_id IS NOT NULL;

-- Drop and replace check constraints on payment_ledger to accommodate new event types
ALTER TABLE public.payment_ledger
    DROP CONSTRAINT IF EXISTS chk_ledger_event_type,
    DROP CONSTRAINT IF EXISTS chk_ledger_status;

ALTER TABLE public.payment_ledger
    ADD CONSTRAINT chk_ledger_event_type CHECK (
        event_type IN (
            'escrow_funded',
            'escrow_released',
            'payout_disbursed',
            'service_fee_deducted',
            'escrow_refund',
            'hourly_funded',
            'hourly_billed',
            'payout_initiated',
            'transfer_held',
            'transfer_released',
            'transfer_reversed',
            'transfer_failed'
        )
    ),
    ADD CONSTRAINT chk_ledger_status CHECK (
        status IN ('succeeded', 'pending', 'reversed', 'failed')
    );

-- ============================================================================
-- 5. STORED PROCEDURES FOR MARKETPLACE ONBOARDING & PAYOUTS
-- ============================================================================

-- A. Onboard / Update Freelancer Payout Profile
CREATE OR REPLACE FUNCTION public.setup_freelancer_payout_profile(
    p_user_id uuid,
    p_legal_name text,
    p_bank_name text,
    p_bank_ifsc text,
    p_account_number_masked text,
    p_pan_masked text,
    p_business_type text DEFAULT 'individual',
    p_provider_account_id text DEFAULT NULL
)
RETURNS public.freelancer_payout_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_profile public.freelancer_payout_profiles;
    v_account_id text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF v_actor_id <> p_user_id THEN
        RAISE EXCEPTION 'You may only configure your own payout profile' USING ERRCODE = '42501';
    END IF;

    IF length(trim(p_legal_name)) < 2 THEN
        RAISE EXCEPTION 'Legal name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;

    v_account_id := COALESCE(p_provider_account_id, 'acc_sim_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14));

    INSERT INTO public.freelancer_payout_profiles (
        user_id,
        provider,
        provider_account_id,
        account_status,
        legal_name,
        business_type,
        pan_last4,
        bank_account_last4,
        bank_ifsc,
        bank_name,
        payout_eligible,
        updated_at
    ) VALUES (
        p_user_id,
        'mock_route',
        v_account_id,
        'activated',
        trim(p_legal_name),
        p_business_type,
        right(trim(p_pan_masked), 4),
        right(trim(p_account_number_masked), 4),
        upper(trim(p_bank_ifsc)),
        trim(p_bank_name),
        true,
        clock_timestamp()
    )
    ON CONFLICT (user_id) DO UPDATE
       SET legal_name = EXCLUDED.legal_name,
           business_type = EXCLUDED.business_type,
           pan_last4 = EXCLUDED.pan_last4,
           bank_account_last4 = EXCLUDED.bank_account_last4,
           bank_ifsc = EXCLUDED.bank_ifsc,
           bank_name = EXCLUDED.bank_name,
           account_status = 'activated',
           payout_eligible = true,
           updated_at = clock_timestamp()
    RETURNING * INTO v_profile;

    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_freelancer_payout_profile TO authenticated;

-- B. Record Timesheet Payment Attempt
CREATE OR REPLACE FUNCTION public.record_timesheet_payment_attempt(
    p_contract_id uuid,
    p_timesheet_id uuid,
    p_client_id uuid,
    p_amount numeric,
    p_amount_subunits bigint,
    p_currency text,
    p_razorpay_order_id text,
    p_environment text DEFAULT 'test',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payment_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.payment_attempts;
BEGIN
    INSERT INTO public.payment_attempts (
        contract_id,
        timesheet_id,
        billing_type,
        client_id,
        provider,
        environment,
        razorpay_order_id,
        amount,
        amount_subunits,
        currency,
        status,
        metadata
    ) VALUES (
        p_contract_id,
        p_timesheet_id,
        'timesheet',
        p_client_id,
        'razorpay',
        p_environment,
        p_razorpay_order_id,
        p_amount,
        p_amount_subunits,
        p_currency,
        'created',
        p_metadata
    )
    RETURNING * INTO v_attempt;

    RETURN v_attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_timesheet_payment_attempt TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_timesheet_payment_attempt TO service_role;

-- C. Fund Timesheet with Payment
CREATE OR REPLACE FUNCTION public.fund_timesheet_with_payment(
    p_timesheet_id uuid,
    p_razorpay_payment_id text,
    p_razorpay_order_id text,
    p_razorpay_signature text,
    p_amount_subunits bigint,
    p_currency text,
    p_environment text DEFAULT 'test',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_timesheet public.timesheets;
    v_contract public.contracts;
    v_attempt public.payment_attempts;
    v_amount numeric(12,2);
BEGIN
    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        RETURN v_timesheet; -- Idempotent return
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;
    v_amount := v_timesheet.total_amount;

    -- Update payment attempt
    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = p_razorpay_payment_id,
           razorpay_signature = p_razorpay_signature,
           updated_at = clock_timestamp()
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = p_razorpay_order_id
 RETURNING * INTO v_attempt;

    -- Transition timesheet to paid
    UPDATE public.timesheets
       SET status = 'paid',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    -- Record hourly payment funding in ledger
    INSERT INTO public.payment_ledger (
        contract_id,
        timesheet_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_timesheet.contract_id,
        v_timesheet.id,
        v_timesheet.client_id,
        NULL,
        v_amount,
        p_currency,
        'hourly_funded',
        'succeeded',
        'Hourly Invoice Payment for Week of ' || v_timesheet.week_start_date::text || ' (' || v_timesheet.total_minutes || ' mins)',
        jsonb_build_object(
            'provider', 'razorpay',
            'environment', p_environment,
            'razorpay_payment_id', p_razorpay_payment_id,
            'razorpay_order_id', p_razorpay_order_id
        ) || p_metadata
    );

    RETURN v_timesheet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fund_timesheet_with_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_timesheet_with_payment TO service_role;

-- D. Create Payout Transfer Record (Triggered by Payout Engine)
CREATE OR REPLACE FUNCTION public.create_payout_transfer_record(
    p_contract_id uuid,
    p_recipient_user_id uuid,
    p_gross_amount numeric,
    p_fee_amount numeric,
    p_net_amount numeric,
    p_currency text,
    p_idempotency_key text,
    p_provider_transfer_id text,
    p_provider_account_id text,
    p_milestone_id uuid DEFAULT NULL,
    p_timesheet_id uuid DEFAULT NULL,
    p_on_hold boolean DEFAULT false,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing public.payout_transfers;
    v_transfer public.payout_transfers;
BEGIN
    -- Idempotency check: return existing if idempotency key already matches
    SELECT * INTO v_existing FROM public.payout_transfers WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN v_existing;
    END IF;

    INSERT INTO public.payout_transfers (
        contract_id,
        milestone_id,
        timesheet_id,
        recipient_user_id,
        provider,
        provider_transfer_id,
        provider_account_id,
        gross_amount,
        fee_amount,
        net_amount,
        currency,
        on_hold,
        status,
        idempotency_key,
        metadata
    ) VALUES (
        p_contract_id,
        p_milestone_id,
        p_timesheet_id,
        p_recipient_user_id,
        'mock_route',
        p_provider_transfer_id,
        p_provider_account_id,
        p_gross_amount,
        p_fee_amount,
        p_net_amount,
        p_currency,
        p_on_hold,
        'processing',
        p_idempotency_key,
        p_metadata
    )
    RETURNING * INTO v_transfer;

    RETURN v_transfer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payout_transfer_record TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_transfer_record TO service_role;

-- E. Confirm Payout Transfer Completion (Authoritative Freelancer Earnings Settlement)
CREATE OR REPLACE FUNCTION public.confirm_payout_transfer_completion(
    p_transfer_id uuid,
    p_settled_at timestamptz DEFAULT clock_timestamp()
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_transfer public.payout_transfers;
    v_contract public.contracts;
    v_milestone public.contract_milestones;
    v_timesheet public.timesheets;
    v_remaining_count integer;
BEGIN
    PERFORM set_config('app.platform_billing', 'on', true);

    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    IF v_transfer.status = 'completed' THEN
        RETURN v_transfer; -- Idempotent return
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_transfer.contract_id;

    -- Update transfer record
    UPDATE public.payout_transfers
       SET status = 'completed',
           on_hold = false,
           settled_at = p_settled_at,
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
 RETURNING * INTO v_transfer;

    -- If this transfer is for a fixed milestone
    IF v_transfer.milestone_id IS NOT NULL THEN
        SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = v_transfer.milestone_id FOR UPDATE;
        
        -- Transition milestone to released
        UPDATE public.contract_milestones
           SET status = 'released',
               updated_at = clock_timestamp()
         WHERE id = v_transfer.milestone_id;

        -- Record Escrow Release
        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            v_contract.client_id,
            v_transfer.recipient_user_id,
            v_transfer.gross_amount,
            v_transfer.currency,
            'escrow_released',
            'succeeded',
            'Escrow Released: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')',
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        -- Record Service Fee Deduction
        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            v_transfer.recipient_user_id,
            NULL,
            v_transfer.fee_amount,
            v_transfer.currency,
            'service_fee_deducted',
            'succeeded',
            'Workspace Platform Fee for Milestone #' || v_milestone.sequence_order,
            jsonb_build_object('rate', 0.10, 'gross_amount', v_transfer.gross_amount)
        );

        -- Record Net Payout
        INSERT INTO public.payment_ledger (
            contract_id,
            milestone_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.milestone_id,
            v_transfer.id,
            NULL,
            v_transfer.recipient_user_id,
            v_transfer.net_amount,
            v_transfer.currency,
            'payout_disbursed',
            'succeeded',
            'Net Payout Settled to Freelancer for Milestone #' || v_milestone.sequence_order,
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );

        -- Check if all contract milestones have finished
        SELECT COUNT(*) INTO v_remaining_count
          FROM public.contract_milestones
         WHERE contract_id = v_transfer.contract_id
           AND status NOT IN ('released', 'cancelled');

        IF v_remaining_count = 0 THEN
            UPDATE public.contracts
               SET status = 'completed',
                   updated_at = clock_timestamp()
             WHERE id = v_transfer.contract_id;
        END IF;

    -- If this transfer is for an hourly timesheet
    ELSIF v_transfer.timesheet_id IS NOT NULL THEN
        SELECT * INTO v_timesheet FROM public.timesheets WHERE id = v_transfer.timesheet_id;

        -- Record Service Fee Deduction
        INSERT INTO public.payment_ledger (
            contract_id,
            timesheet_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.timesheet_id,
            v_transfer.id,
            v_transfer.recipient_user_id,
            NULL,
            v_transfer.fee_amount,
            v_transfer.currency,
            'service_fee_deducted',
            'succeeded',
            'Workspace Platform Fee for Hourly Timesheet (' || v_timesheet.week_start_date || ')',
            jsonb_build_object('rate', 0.10, 'gross_amount', v_transfer.gross_amount)
        );

        -- Record Net Payout
        INSERT INTO public.payment_ledger (
            contract_id,
            timesheet_id,
            payout_transfer_id,
            from_user_id,
            to_user_id,
            amount,
            currency,
            event_type,
            status,
            description,
            metadata
        ) VALUES (
            v_transfer.contract_id,
            v_transfer.timesheet_id,
            v_transfer.id,
            NULL,
            v_transfer.recipient_user_id,
            v_transfer.net_amount,
            v_transfer.currency,
            'payout_disbursed',
            'succeeded',
            'Net Payout Settled to Freelancer for Hourly Timesheet (' || v_timesheet.week_start_date || ')',
            jsonb_build_object('provider_transfer_id', v_transfer.provider_transfer_id)
        );
    END IF;

    -- AUTHORITATIVE PROFILE AGGREGATES UPDATE:
    -- Freelancer earnings ONLY update after confirmed transfer completion!
    UPDATE public.profiles
       SET total_earnings = total_earnings + v_transfer.net_amount,
           updated_at = clock_timestamp()
     WHERE id = v_transfer.recipient_user_id;

    UPDATE public.profiles
       SET total_spent = total_spent + v_transfer.gross_amount,
           updated_at = clock_timestamp()
     WHERE id = v_contract.client_id;

    RETURN v_transfer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_payout_transfer_completion TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payout_transfer_completion TO service_role;

-- F. Reverse Payout Transfer (Dispute / Cancellation)
CREATE OR REPLACE FUNCTION public.reverse_payout_transfer(
    p_transfer_id uuid,
    p_reversal_id text,
    p_reason text DEFAULT 'Transfer reversed by operator or dispute'
)
RETURNS public.payout_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_transfer public.payout_transfers;
BEGIN
    SELECT * INTO v_transfer FROM public.payout_transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer % not found', p_transfer_id USING ERRCODE = '23503';
    END IF;

    UPDATE public.payout_transfers
       SET status = 'reversed',
           reversal_id = p_reversal_id,
           metadata = metadata || jsonb_build_object('reversal_reason', p_reason, 'reversed_at', clock_timestamp()),
           updated_at = clock_timestamp()
     WHERE id = p_transfer_id
 RETURNING * INTO v_transfer;

    -- Record transfer reversal in ledger
    INSERT INTO public.payment_ledger (
        contract_id,
        milestone_id,
        timesheet_id,
        payout_transfer_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_transfer.contract_id,
        v_transfer.milestone_id,
        v_transfer.timesheet_id,
        v_transfer.id,
        v_transfer.recipient_user_id,
        NULL,
        v_transfer.net_amount,
        v_transfer.currency,
        'transfer_reversed',
        'succeeded',
        'Marketplace Transfer Reversal: ' || p_reason,
        jsonb_build_object('reversal_id', p_reversal_id)
    );

    RETURN v_transfer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_payout_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payout_transfer TO service_role;

-- ============================================================================
-- 6. PRIVILEGED PROFILE UPDATE PERMISSIONS (Billing Engine Bypass)
-- ============================================================================

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
        IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') AND
           COALESCE(auth.role(), '') NOT IN ('service_role', 'supabase_admin') AND
           COALESCE(current_setting('app.platform_billing', true), 'off') <> 'on' THEN
            RAISE EXCEPTION 'Field "total_earnings" can only be updated by the platform billing engine' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF OLD.total_spent IS DISTINCT FROM NEW.total_spent THEN
        IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') AND
           COALESCE(auth.role(), '') NOT IN ('service_role', 'supabase_admin') AND
           COALESCE(current_setting('app.platform_billing', true), 'off') <> 'on' THEN
            RAISE EXCEPTION 'Field "total_spent" can only be updated by the platform billing engine' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF OLD.is_suspended IS DISTINCT FROM NEW.is_suspended THEN
        RAISE EXCEPTION 'Field "is_suspended" can only be updated by platform administrators' USING ERRCODE = '42501';
    END IF;

    -- Update timestamp automatically
    NEW.updated_at := clock_timestamp();

    RETURN NEW;
END;
$$;

-- ============================================================================
-- 7. REVISE APPROVE AND RELEASE MILESTONE (Delayed Payout Architecture)
-- ============================================================================

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

    -- Milestone must have been funded and can be submitted, in_progress, or revision_requested
    IF v_milestone.status = 'released' THEN
        RETURN v_milestone; -- Idempotent return on user refresh or duplicate approval
    END IF;

    IF v_milestone.status NOT IN ('submitted', 'funded', 'in_progress', 'revision_requested', 'approved') THEN
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

    -- Transition milestone to approved (ready for automatic payout transfer)
    UPDATE public.contract_milestones
       SET status = 'approved',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    RETURN v_milestone;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_and_release_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_release_milestone TO service_role;

-- ============================================================================
-- 8. HOURLY TIMESHEET WEBHOOK RECONCILIATION & WORKFLOW PROCEDURES
-- ============================================================================

-- A. Reconcile Timesheet Webhook Payment (Hardened with Deduplication & Service-Role Restriction)
CREATE OR REPLACE FUNCTION public.reconcile_timesheet_webhook_payment(
    p_timesheet_id uuid,
    p_razorpay_order_id text,
    p_razorpay_payment_id text DEFAULT NULL,
    p_amount_subunits bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb,
    p_event_id text DEFAULT NULL,
    p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.payment_attempts;
    v_timesheet public.timesheets;
    v_webhook_event public.webhook_events;
    v_event_type text;
    v_environment text;
    v_amount numeric(12,2);
BEGIN
    -- Strict least-privilege authorization check: caller must be service_role or superuser/postgres
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reconcile_timesheet_webhook_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    -- Fail-closed parameter validation
    IF p_timesheet_id IS NULL THEN
        RAISE EXCEPTION 'Timesheet ID cannot be null' USING ERRCODE = '22023';
    END IF;

    IF p_razorpay_order_id IS NULL OR trim(p_razorpay_order_id) = '' THEN
        RAISE EXCEPTION 'Razorpay order ID cannot be null or empty' USING ERRCODE = '22023';
    END IF;

    v_event_type := COALESCE(p_payment_metadata->>'event', 'payment.captured');
    v_environment := COALESCE(p_payment_metadata->>'environment', 'test');

    -- Webhook Event Deduplication Check
    IF p_event_id IS NOT NULL AND trim(p_event_id) <> '' THEN
        SELECT * INTO v_webhook_event
          FROM public.webhook_events
         WHERE event_id = trim(p_event_id)
           FOR UPDATE;

        IF FOUND THEN
            -- Event already fully processed previously: return idempotent success immediately
            IF v_webhook_event.status = 'processed' THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'idempotent', true,
                    'event_id', p_event_id,
                    'status', 'already_processed',
                    'message', 'Webhook event already processed previously'
                );
            END IF;

            UPDATE public.webhook_events
               SET status = 'processing',
                   metadata = metadata || jsonb_build_object('retried_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        ELSE
            INSERT INTO public.webhook_events (
                event_id,
                event_type,
                provider,
                environment,
                payload_hash,
                status,
                metadata
            ) VALUES (
                trim(p_event_id),
                v_event_type,
                'razorpay',
                v_environment,
                COALESCE(p_payload_hash, 'none'),
                'processing',
                jsonb_build_object(
                    'order_id', trim(p_razorpay_order_id),
                    'payment_id', p_razorpay_payment_id,
                    'timesheet_id', p_timesheet_id
                )
            ) RETURNING * INTO v_webhook_event;
        END IF;
    END IF;

    -- Strict atomic row lock on payment_attempts to eliminate race conditions
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = trim(p_razorpay_order_id)
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Payment attempt not found for timesheet order')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Payment attempt not found for timesheet % and order %', p_timesheet_id, p_razorpay_order_id
            USING ERRCODE = '23503';
    END IF;

    -- Ensure billing_type is timesheet and milestone_id is null (cross-funding conflict prevention)
    IF v_attempt.billing_type <> 'timesheet' OR v_attempt.milestone_id IS NOT NULL THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Conflicting payment billing type')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment attempt is not configured for timesheet billing' USING ERRCODE = '22023';
    END IF;

    -- Strict fail-closed validation of payment amount against persisted attempt
    IF p_amount_subunits IS NOT NULL AND v_attempt.amount_subunits <> p_amount_subunits THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Amount mismatch')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Webhook amount (% subunits) does not match persisted attempt (% subunits)', p_amount_subunits, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    -- Strict fail-closed validation of payment currency against persisted attempt
    IF p_currency IS NOT NULL AND upper(trim(v_attempt.currency)) <> upper(trim(p_currency)) THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Currency mismatch')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Webhook currency (%) does not match persisted attempt (%)', p_currency, v_attempt.currency
            USING ERRCODE = '22023';
    END IF;

    -- Strict atomic row lock on timesheets
    SELECT * INTO v_timesheet
      FROM public.timesheets
     WHERE id = p_timesheet_id
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Timesheet not found')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id
            USING ERRCODE = '23503';
    END IF;

    -- Database-level idempotency
    IF v_timesheet.status = 'paid' OR v_attempt.status = 'captured' THEN
        IF p_razorpay_payment_id IS NOT NULL AND v_attempt.razorpay_payment_id IS NULL THEN
            UPDATE public.payment_attempts
               SET razorpay_payment_id = trim(p_razorpay_payment_id),
                   updated_at = clock_timestamp()
             WHERE id = v_attempt.id;
        END IF;

        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'processed',
                   metadata = metadata || jsonb_build_object('idempotent', true, 'reconciled_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'timesheet_id', p_timesheet_id,
            'status', 'paid',
            'message', 'Timesheet payment was already reconciled'
        );
    END IF;

    -- Authoritative state transitions in single atomic transaction
    v_amount := v_timesheet.total_amount;

    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = COALESCE(trim(p_razorpay_payment_id), razorpay_payment_id),
           updated_at = clock_timestamp()
     WHERE id = v_attempt.id;

    UPDATE public.timesheets
       SET status = 'paid',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    -- Record hourly payment funding in ledger
    INSERT INTO public.payment_ledger (
        contract_id,
        timesheet_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_timesheet.contract_id,
        v_timesheet.id,
        v_timesheet.client_id,
        NULL,
        v_amount,
        v_attempt.currency,
        'hourly_funded',
        'succeeded',
        'Hourly Invoice Payment (Webhook): Week of ' || v_timesheet.week_start_date::text || ' (' || v_timesheet.total_minutes || ' mins)',
        jsonb_build_object(
            'provider', 'razorpay',
            'environment', v_environment,
            'event', v_event_type,
            'razorpay_order_id', trim(p_razorpay_order_id),
            'razorpay_payment_id', trim(p_razorpay_payment_id),
            'webhook_event_id', p_event_id
        ) || p_payment_metadata
    );

    IF v_webhook_event.id IS NOT NULL THEN
        UPDATE public.webhook_events
           SET status = 'processed',
               metadata = metadata || jsonb_build_object('reconciled_at', clock_timestamp(), 'timesheet_id', p_timesheet_id)
         WHERE id = v_webhook_event.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'timesheet_id', p_timesheet_id,
        'status', 'paid'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_timesheet_webhook_payment FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_timesheet_webhook_payment TO service_role;

-- B. Submit Weekly Timesheet Procedure
CREATE OR REPLACE FUNCTION public.submit_timesheet(
    p_timesheet_id uuid
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_timesheet public.timesheets;
BEGIN
    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_actor_id IS NOT NULL AND v_actor_id <> v_timesheet.freelancer_id THEN
        RAISE EXCEPTION 'Only the assigned freelancer can submit this timesheet' USING ERRCODE = '42501';
    END IF;

    IF v_timesheet.status NOT IN ('open', 'disputed') THEN
        RAISE EXCEPTION 'Timesheet is already "%"', v_timesheet.status USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.total_minutes <= 0 THEN
        RAISE EXCEPTION 'Cannot submit a timesheet with zero logged time' USING ERRCODE = '22023';
    END IF;

    UPDATE public.timesheets
       SET status = 'submitted',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_timesheet TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_timesheet TO service_role;

-- C. Approve Weekly Timesheet Procedure
CREATE OR REPLACE FUNCTION public.approve_timesheet(
    p_timesheet_id uuid
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_timesheet public.timesheets;
    v_contract RECORD;
BEGIN
    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;

    IF v_actor_id IS NOT NULL AND v_actor_id <> v_timesheet.client_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can approve this timesheet' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_timesheet.status NOT IN ('submitted', 'under_review') THEN
        RAISE EXCEPTION 'Timesheet in status "%" cannot be approved', v_timesheet.status USING ERRCODE = '22023';
    END IF;

    UPDATE public.timesheets
       SET status = 'approved',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_timesheet TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_timesheet TO service_role;

-- D. Dispute Weekly Timesheet Procedure
CREATE OR REPLACE FUNCTION public.dispute_timesheet(
    p_timesheet_id uuid,
    p_reason text
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_timesheet public.timesheets;
    v_contract RECORD;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Dispute reason must be at least 5 characters' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;

    IF v_actor_id IS NOT NULL AND v_actor_id <> v_timesheet.client_id THEN
        IF v_contract.company_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) THEN
            RAISE EXCEPTION 'Only the client can dispute this timesheet' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.timesheets
       SET status = 'disputed',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispute_timesheet TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_timesheet TO service_role;


