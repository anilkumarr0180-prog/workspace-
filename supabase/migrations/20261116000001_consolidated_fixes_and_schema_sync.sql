-- ============================================================================
-- Migration: 20261116000001_consolidated_fixes_and_schema_sync.sql
-- Description: Consolidated DDL ensuring all missing tables, storage buckets,
--              RLS policies, and RPC procedures are 100% active and in sync.
-- ============================================================================

-- 1. WORK DIARY SLOTS TABLE
CREATE TABLE IF NOT EXISTS public.work_diary_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    time_entry_id uuid REFERENCES public.time_entries(id) ON DELETE CASCADE,
    freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    slot_time timestamptz NOT NULL,
    duration_minutes integer NOT NULL DEFAULT 10 CHECK (duration_minutes > 0 AND duration_minutes <= 60),
    activity_score integer NOT NULL DEFAULT 8 CHECK (activity_score BETWEEN 0 AND 10),
    keystrokes_count integer NOT NULL DEFAULT 350 CHECK (keystrokes_count >= 0),
    mouse_clicks_count integer NOT NULL DEFAULT 90 CHECK (mouse_clicks_count >= 0),
    memo text NOT NULL DEFAULT '',
    screenshot_url text,
    is_manual boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_diary_contract_slot 
    ON public.work_diary_slots (contract_id, slot_time DESC);

CREATE INDEX IF NOT EXISTS idx_work_diary_freelancer_slot 
    ON public.work_diary_slots (freelancer_id, slot_time DESC);

CREATE INDEX IF NOT EXISTS idx_work_diary_time_entry 
    ON public.work_diary_slots (time_entry_id);

CREATE INDEX IF NOT EXISTS idx_work_diary_slot_day 
    ON public.work_diary_slots (contract_id, ((slot_time AT TIME ZONE 'UTC')::date));

ALTER TABLE public.work_diary_slots ENABLE ROW LEVEL SECURITY;

-- Helper function check
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

GRANT EXECUTE ON FUNCTION public.get_my_company_ids() TO authenticated;

DROP POLICY IF EXISTS work_diary_select_involved ON public.work_diary_slots;
CREATE POLICY work_diary_select_involved
    ON public.work_diary_slots
    FOR SELECT
    TO authenticated
    USING (
        freelancer_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.contracts c
             WHERE c.id = work_diary_slots.contract_id
               AND (
                   c.client_id = auth.uid()
                   OR (
                       c.company_id IS NOT NULL
                       AND c.company_id IN (SELECT public.get_my_company_ids())
                   )
               )
        )
    );

DROP POLICY IF EXISTS work_diary_insert_freelancer ON public.work_diary_slots;
CREATE POLICY work_diary_insert_freelancer
    ON public.work_diary_slots
    FOR INSERT
    TO authenticated
    WITH CHECK (freelancer_id = auth.uid());

DROP POLICY IF EXISTS work_diary_delete_freelancer ON public.work_diary_slots;
CREATE POLICY work_diary_delete_freelancer
    ON public.work_diary_slots
    FOR DELETE
    TO authenticated
    USING (freelancer_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.work_diary_slots TO authenticated;
GRANT ALL ON public.work_diary_slots TO service_role;

-- 2. CONTRACT REVIEWS TABLE
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

CREATE INDEX IF NOT EXISTS idx_contract_reviews_contract
    ON public.contract_reviews(contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_reviewee_public
    ON public.contract_reviews(reviewee_id, is_public);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_reviewer
    ON public.contract_reviews(reviewer_id);

ALTER TABLE public.contract_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_reviews_select" ON public.contract_reviews;
CREATE POLICY "contract_reviews_select"
    ON public.contract_reviews
    FOR SELECT
    USING (
        auth.uid() = reviewer_id
        OR is_public = true
        OR current_user IN ('postgres', 'service_role')
    );

DROP POLICY IF EXISTS "contract_reviews_insert" ON public.contract_reviews;
CREATE POLICY "contract_reviews_insert"
    ON public.contract_reviews
    FOR INSERT
    WITH CHECK (
        auth.uid() = reviewer_id
        AND EXISTS (
            SELECT 1 FROM public.contracts c
            WHERE c.id = contract_id
              AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
        )
    );

GRANT SELECT, INSERT, UPDATE ON public.contract_reviews TO authenticated;
GRANT ALL ON public.contract_reviews TO service_role;

-- 3. STORAGE BUCKETS (Public buckets for avatars, work diary, deliveries)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('work-diary-screenshots', 'work-diary-screenshots', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('milestone-deliveries', 'milestone-deliveries', true, 26214400, NULL),
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE 
SET public = EXCLUDED.public;

-- 4. RELOAD SCHEMA CACHE
NOTIFY pgrst, 'reload schema';

