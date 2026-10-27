-- Migration: 20261027000001_proposals_prevent_self_application_rls.sql
-- Description: Disallow self-application by job owners or company hiring managers in the RLS policy,
--              and require that the applicant profile is unsuspended and permitted to work.
-- Status: PREPARED (UNAPPLIED - Pending Review & Approval)

-- 1. Drop existing permissive proposals_insert_freelancer policy
DROP POLICY IF EXISTS proposals_insert_freelancer ON public.proposals;

-- 2. Create strengthened policy verifying job ownership, company hiring authority, and freelancer eligibility
CREATE POLICY proposals_insert_freelancer
    ON public.proposals
    FOR INSERT
    TO authenticated
    WITH CHECK (
        -- The submitting user must match the freelancer_id on the proposal
        auth.uid() = freelancer_id

        -- The submitting user's profile must be unsuspended and authorized for freelance work
        AND EXISTS (
            SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid()
               AND p.can_work = true
               AND p.is_suspended = false
        )

        -- The target job must be published and cannot be owned by the applicant directly or via company
        AND EXISTS (
            SELECT 1 FROM public.jobs j
             WHERE j.id = proposals.job_id
               AND j.status = 'published'
               -- Self-application prohibition: job owner cannot submit proposal
               AND j.client_id IS DISTINCT FROM auth.uid()
               -- Company prohibition: company hiring team cannot bid on company-posted jobs
               AND (
                   j.company_id IS NULL
                   OR NOT EXISTS (
                       SELECT 1 FROM public.company_members cm
                        WHERE cm.company_id = j.company_id
                          AND cm.user_id = auth.uid()
                          AND cm.role IN ('owner', 'admin', 'hiring_manager')
                   )
               )
        )
    );
