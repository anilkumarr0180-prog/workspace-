-- ============================================================================
-- Migration: 20261118000001_allow_early_timesheet_approval.sql
-- Description: Updates public.approve_timesheet() stored procedure to allow
--              authorized clients to approve both 'submitted' timesheets and
--              'open'/'draft' weekly timesheets early when logged hours exist.
-- ============================================================================

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
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_contract RECORD;
    v_is_authorized boolean := false;
BEGIN
    -- Reject unauthenticated callers (anon role or null auth.uid)
    IF v_role <> 'service_role' AND v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Atomic row lock on timesheet
    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_timesheet.contract_id;

    -- Strict check: Freelancers cannot approve their own timesheets
    IF v_role <> 'service_role' AND v_actor_id = v_timesheet.freelancer_id THEN
        RAISE EXCEPTION 'Freelancers cannot approve their own timesheets' USING ERRCODE = '42501';
    END IF;

    -- Authorization validation: Client, Company hiring manager, or service_role
    IF v_role = 'service_role' THEN
        v_is_authorized := true;
    ELSIF v_actor_id = v_timesheet.client_id THEN
        v_is_authorized := true;
    ELSIF v_contract.company_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.company_id = v_contract.company_id
               AND cm.user_id = v_actor_id
               AND cm.role IN ('owner', 'admin', 'hiring_manager')
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Only the client can approve this timesheet' USING ERRCODE = '42501';
    END IF;

    -- Validate state: Allow submitted/under_review, as well as early approval for open/draft with logged time
    IF v_timesheet.status NOT IN ('submitted', 'under_review', 'open', 'draft') THEN
        RAISE EXCEPTION 'Timesheet in status "%" cannot be approved', v_timesheet.status USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.status IN ('open', 'draft') AND COALESCE(v_timesheet.total_minutes, 0) <= 0 THEN
        RAISE EXCEPTION 'Cannot approve an open timesheet with zero logged time' USING ERRCODE = '22023';
    END IF;

    -- Atomic status transition to approved
    UPDATE public.timesheets
       SET status = 'approved',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
 RETURNING * INTO v_timesheet;

    RETURN v_timesheet;
END;
$$;

-- Secure grant configuration
REVOKE ALL ON FUNCTION public.approve_timesheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_timesheet(uuid) TO authenticated, service_role;

