-- Migration: 20261103000008_contract_reviews_and_end_contract.sql
-- Description: Two-sided double-blind contract feedback, contract ending lifecycle,
--              freelancer rating recalculation engine, and notification integration.

-- ============================================================================
-- 1. CONTRACT REVIEWS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contract_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewer_role text NOT NULL CONSTRAINT chk_reviewer_role CHECK (reviewer_role IN ('client', 'freelancer')),
    rating numeric(3,2) NOT NULL CONSTRAINT chk_rating_range CHECK (rating >= 1.00 AND rating <= 5.00),
    scores jsonb NOT NULL DEFAULT '{}'::jsonb,
    feedback_text text NOT NULL CONSTRAINT chk_feedback_length CHECK (length(trim(feedback_text)) >= 5),
    private_nps integer CONSTRAINT chk_private_nps CHECK (private_nps IS NULL OR (private_nps >= 1 AND private_nps <= 10)),
    private_feedback text,
    end_reason text NOT NULL,
    is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_contract_reviewer UNIQUE (contract_id, reviewer_id)
);

COMMENT ON TABLE public.contract_reviews IS 'Double-blind two-sided reviews submitted when a contract ends.';

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_contract_reviews_contract
    ON public.contract_reviews(contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_reviewee_public
    ON public.contract_reviews(reviewee_id, is_public);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_reviewer
    ON public.contract_reviews(reviewer_id);

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS) FOR CONTRACT REVIEWS
-- ============================================================================
ALTER TABLE public.contract_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_reviews_select" ON public.contract_reviews;
CREATE POLICY "contract_reviews_select"
    ON public.contract_reviews
    FOR SELECT
    USING (
        -- Reviewer can view their own review
        auth.uid() = reviewer_id
        OR
        -- Anyone can view if it has been published
        is_public = true
        OR
        -- Service role or admin
        current_user IN ('postgres', 'service_role')
    );

DROP POLICY IF EXISTS "contract_reviews_insert" ON public.contract_reviews;
CREATE POLICY "contract_reviews_insert"
    ON public.contract_reviews
    FOR INSERT
    WITH CHECK (
        auth.uid() = reviewer_id
        AND
        EXISTS (
            SELECT 1 FROM public.contracts c
            WHERE c.id = contract_id
              AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
        )
    );

-- ============================================================================
-- 3. UPDATE PROFILE PRIVILEGED FIELDS TRIGGER (RATING ENGINE)
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

    -- Protect platform-managed rating and review count
    IF OLD.rating IS DISTINCT FROM NEW.rating THEN
        IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') AND
           COALESCE(auth.role(), '') NOT IN ('service_role', 'supabase_admin') AND
           COALESCE(current_setting('app.platform_rating', true), 'off') <> 'on' THEN
            RAISE EXCEPTION 'Field "rating" can only be updated by the platform rating engine' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF OLD.review_count IS DISTINCT FROM NEW.review_count THEN
        IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') AND
           COALESCE(auth.role(), '') NOT IN ('service_role', 'supabase_admin') AND
           COALESCE(current_setting('app.platform_rating', true), 'off') <> 'on' THEN
            RAISE EXCEPTION 'Field "review_count" can only be updated by the platform review engine' USING ERRCODE = '42501';
        END IF;
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
-- 4. ATOMIC RPC: end_contract_and_submit_review
-- ============================================================================
CREATE OR REPLACE FUNCTION public.end_contract_and_submit_review(
    p_contract_id uuid,
    p_end_reason text,
    p_rating numeric,
    p_feedback_text text,
    p_scores jsonb DEFAULT '{}'::jsonb,
    p_private_nps integer DEFAULT NULL,
    p_private_feedback text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_contract RECORD;
    v_reviewer_role text;
    v_reviewee_id uuid;
    v_existing_review_id uuid;
    v_other_review RECORD;
    v_new_contract_status text;
    v_review_id uuid;
    v_both_submitted boolean := false;
    v_avg_rating numeric(3,2);
    v_review_count integer;
    v_reviewer_name text;
    v_reviewee_name text;
    v_contract_title text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to submit feedback' USING ERRCODE = '42501';
    END IF;

    -- Validate rating bounds
    IF p_rating < 1.00 OR p_rating > 5.00 THEN
        RAISE EXCEPTION 'Rating must be between 1.0 and 5.0' USING ERRCODE = '22003';
    END IF;

    -- Validate feedback text
    IF length(trim(COALESCE(p_feedback_text, ''))) < 5 THEN
        RAISE EXCEPTION 'Feedback review text must be at least 5 characters long' USING ERRCODE = '22026';
    END IF;

    -- Fetch and lock contract
    SELECT * INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id
       FOR UPDATE;

    IF v_contract.id IS NULL THEN
        RAISE EXCEPTION 'Contract % not found', p_contract_id USING ERRCODE = '02000';
    END IF;

    -- Verify caller is party to contract
    IF v_caller = v_contract.client_id THEN
        v_reviewer_role := 'client';
        v_reviewee_id := v_contract.freelancer_id;
    ELSIF v_caller = v_contract.freelancer_id THEN
        v_reviewer_role := 'freelancer';
        v_reviewee_id := v_contract.client_id;
    ELSE
        RAISE EXCEPTION 'Caller is not a party to contract %', p_contract_id USING ERRCODE = '42501';
    END IF;

    -- Check contract status eligibility
    IF v_contract.status IN ('pending_offer', 'declined') THEN
        RAISE EXCEPTION 'Cannot end or review a contract that has not commenced' USING ERRCODE = '22023';
    END IF;

    -- Check if caller already reviewed
    SELECT id INTO v_existing_review_id
      FROM public.contract_reviews
     WHERE contract_id = p_contract_id
       AND reviewer_id = v_caller;

    IF v_existing_review_id IS NOT NULL THEN
        RAISE EXCEPTION 'You have already submitted feedback for this contract' USING ERRCODE = '23505';
    END IF;

    -- Stop any active timer sessions on this contract to prevent orphaned tracking
    DELETE FROM public.active_timer_sessions
     WHERE contract_id = p_contract_id;

    -- Transition contract status if active
    IF v_contract.status = 'active' THEN
        IF p_end_reason IN ('completed_successfully', 'milestones_completed', 'project_finished') THEN
            v_new_contract_status := 'completed';
        ELSE
            v_new_contract_status := 'completed'; -- In Upwork, all ended contracts transition to completed
        END IF;

        UPDATE public.contracts
           SET status = v_new_contract_status,
               updated_at = now()
         WHERE id = p_contract_id;
    END IF;

    -- Check if other party already submitted feedback
    SELECT * INTO v_other_review
      FROM public.contract_reviews
     WHERE contract_id = p_contract_id
       AND reviewer_id = v_reviewee_id;

    IF v_other_review.id IS NOT NULL THEN
        v_both_submitted := true;
    END IF;

    -- Insert new review (is_public is true if both have submitted)
    INSERT INTO public.contract_reviews (
        contract_id,
        reviewer_id,
        reviewee_id,
        reviewer_role,
        rating,
        scores,
        feedback_text,
        private_nps,
        private_feedback,
        end_reason,
        is_public,
        created_at,
        updated_at
    ) VALUES (
        p_contract_id,
        v_caller,
        v_reviewee_id,
        v_reviewer_role,
        ROUND(p_rating, 2),
        COALESCE(p_scores, '{}'::jsonb),
        trim(p_feedback_text),
        p_private_nps,
        trim(COALESCE(p_private_feedback, '')),
        p_end_reason,
        v_both_submitted,
        now(),
        now()
    )
    RETURNING id INTO v_review_id;

    -- Get profile names for notification
    SELECT full_name INTO v_reviewer_name FROM public.profiles WHERE id = v_caller;
    SELECT full_name INTO v_reviewee_name FROM public.profiles WHERE id = v_reviewee_id;
    v_contract_title := v_contract.title;

    -- If both parties submitted, reveal both reviews and recalculate freelancer rating
    IF v_both_submitted THEN
        UPDATE public.contract_reviews
           SET is_public = true,
               updated_at = now()
         WHERE id = v_other_review.id;

        -- Recalculate freelancer public rating & review count
        SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 5.00), COUNT(*)
          INTO v_avg_rating, v_review_count
          FROM public.contract_reviews
         WHERE reviewee_id = v_contract.freelancer_id
           AND is_public = true;

        PERFORM set_config('app.platform_rating', 'on', true);
        UPDATE public.profiles
           SET rating = v_avg_rating,
               review_count = v_review_count,
               updated_at = now()
         WHERE id = v_contract.freelancer_id;

        -- Create notification to reviewee: Feedback is now revealed
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            message,
            link,
            metadata
        ) VALUES (
            v_reviewee_id,
            'contract_feedback_revealed',
            'Contract Feedback Revealed',
            'Both you and ' || COALESCE(v_reviewer_name, 'the other party') || ' have submitted feedback for "' || v_contract_title || '". Reviews are now public!',
            '/contracts/' || p_contract_id,
            jsonb_build_object('contract_id', p_contract_id, 'is_public', true)
        );
    ELSE
        -- Notify other party that contract was ended and feedback is requested
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            message,
            link,
            metadata
        ) VALUES (
            v_reviewee_id,
            'contract_ended_feedback_required',
            'Contract Ended: Leave Feedback',
            COALESCE(v_reviewer_name, 'The other party') || ' has ended the contract "' || v_contract_title || '" and left feedback. Leave your feedback to view theirs.',
            '/contracts/' || p_contract_id,
            jsonb_build_object('contract_id', p_contract_id, 'is_public', false)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'review_id', v_review_id,
        'both_submitted', v_both_submitted,
        'contract_status', COALESCE(v_new_contract_status, v_contract.status)
    );
END;
$$;

-- ============================================================================
-- 5. RPC: get_contract_reviews_status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_contract_reviews_status(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_contract RECORD;
    v_caller_review RECORD;
    v_other_review RECORD;
    v_both_submitted boolean := false;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT id, client_id, freelancer_id, status, title
      INTO v_contract
      FROM public.contracts
     WHERE id = p_contract_id;

    IF v_contract.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Contract not found');
    END IF;

    IF v_caller <> v_contract.client_id AND v_caller <> v_contract.freelancer_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;

    -- Fetch caller review
    SELECT * INTO v_caller_review
      FROM public.contract_reviews
     WHERE contract_id = p_contract_id
       AND reviewer_id = v_caller;

    -- Fetch other party review
    SELECT * INTO v_other_review
      FROM public.contract_reviews
     WHERE contract_id = p_contract_id
       AND reviewer_id <> v_caller;

    IF v_caller_review.id IS NOT NULL AND v_other_review.id IS NOT NULL THEN
        v_both_submitted := true;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'contract_status', v_contract.status,
        'both_submitted', v_both_submitted,
        'my_review', CASE WHEN v_caller_review.id IS NOT NULL THEN
            jsonb_build_object(
                'id', v_caller_review.id,
                'rating', v_caller_review.rating,
                'scores', v_caller_review.scores,
                'feedback_text', v_caller_review.feedback_text,
                'end_reason', v_caller_review.end_reason,
                'is_public', v_caller_review.is_public,
                'created_at', v_caller_review.created_at
            ) ELSE NULL END,
        'other_review', CASE
            WHEN v_other_review.id IS NULL THEN NULL
            WHEN v_other_review.is_public = true OR v_both_submitted = true THEN
                jsonb_build_object(
                    'id', v_other_review.id,
                    'rating', v_other_review.rating,
                    'scores', v_other_review.scores,
                    'feedback_text', v_other_review.feedback_text,
                    'end_reason', v_other_review.end_reason,
                    'is_public', true,
                    'created_at', v_other_review.created_at
                )
            ELSE
                -- Double blind: other party submitted, but content is obscured until caller submits
                jsonb_build_object(
                    'id', v_other_review.id,
                    'is_submitted', true,
                    'is_public', false
                )
            END
    );
END;
$$;

