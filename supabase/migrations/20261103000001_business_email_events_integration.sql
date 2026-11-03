-- ==============================================================================
-- Migration: 20261103000001_business_email_events_integration.sql
-- Description: Transactional Outbox Business Event Integration:
--              1. Support dedicated 'suppressed' / 'cancelled' outbox statuses
--              2. Stored procedure mark_outbox_email_suppressed()
--              3. Concurrency-safe message notification window coordination
--              4. Proposal received transactional trigger (AFTER INSERT ON proposals)
--              5. Proposal accepted transactional trigger (inside contract creation)
--              6. Milestone funded transactional trigger (simulated & Razorpay)
--              7. Milestone released transactional trigger (authorized payout release)
--              8. Unread direct messages throttled queueing & suppression
-- ==============================================================================

-- ==============================================================================
-- 1. UPDATE EMAIL OUTBOX STATUS CONSTRAINTS & SUPPRESSION FUNCTIONS
-- ==============================================================================

-- Add 'suppressed' and 'cancelled' to status domain
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS chk_email_outbox_status;
ALTER TABLE public.email_outbox ADD CONSTRAINT chk_email_outbox_status CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter', 'suppressed', 'cancelled')
);

-- Procedure to mark outbox record as suppressed
CREATE OR REPLACE FUNCTION public.mark_outbox_email_suppressed(
    p_id UUID,
    p_reason TEXT DEFAULT 'Delivery suppressed by policy'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_outbox
       SET status = 'suppressed',
           last_error = SUBSTRING(COALESCE(NULLIF(trim(p_reason), ''), 'Delivery suppressed'), 1, 4000),
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE id = p_id;

    -- Synchronize corresponding message window if present
    UPDATE public.message_notification_windows
       SET status = 'suppressed',
           updated_at = now()
     WHERE outbox_id = p_id;
END;
$$;

COMMENT ON FUNCTION public.mark_outbox_email_suppressed IS 'Marks outbox email record as suppressed (skipped without provider delivery).';

REVOKE ALL ON FUNCTION public.mark_outbox_email_suppressed(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_suppressed(UUID, TEXT) TO service_role;

-- Maintain mark_outbox_email_sent to update window state
CREATE OR REPLACE FUNCTION public.mark_outbox_email_sent(
    p_id UUID,
    p_provider TEXT,
    p_provider_message_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_outbox
       SET status = 'sent',
           sent_at = now(),
           provider = SUBSTRING(COALESCE(NULLIF(trim(p_provider), ''), 'unknown'), 1, 64),
           provider_message_id = SUBSTRING(NULLIF(trim(p_provider_message_id), ''), 1, 255),
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE id = p_id;

    UPDATE public.message_notification_windows
       SET status = 'dispatched',
           updated_at = now()
     WHERE outbox_id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) TO service_role;


-- ==============================================================================
-- 2. MESSAGE NOTIFICATION COORDINATION STATE TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.message_notification_windows (
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    window_start_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    window_end_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    unread_count INTEGER NOT NULL DEFAULT 1,
    outbox_id UUID REFERENCES public.email_outbox(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CONSTRAINT chk_msg_notif_window_status CHECK (status IN ('active', 'dispatched', 'suppressed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (conversation_id, recipient_user_id)
);

COMMENT ON TABLE public.message_notification_windows IS 'Coordinates unread direct message email notifications, quiet periods, and delivery throttling.';

ALTER TABLE public.message_notification_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_notification_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.message_notification_windows TO service_role;


-- ==============================================================================
-- 3. PROPOSAL RECEIVED TRANSACTIONAL TRIGGER (AFTER INSERT ON proposals)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.queue_proposal_received_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_job_id UUID;
    v_job_title TEXT;
    v_client_id UUID;
    v_client_email TEXT;
    v_client_name TEXT;
    v_freelancer_name TEXT;
    v_submission_date TEXT;
    v_short_message TEXT;
BEGIN
    -- 1. Authoritative lookup of target job and client
    SELECT j.id, j.title, j.client_id, u.email, p.full_name
      INTO v_job_id, v_job_title, v_client_id, v_client_email, v_client_name
      FROM public.jobs j
      JOIN auth.users u ON u.id = j.client_id
      LEFT JOIN public.profiles p ON p.id = j.client_id
     WHERE j.id = NEW.job_id;

    IF NOT FOUND OR v_client_email IS NULL THEN
        RETURN NEW;
    END IF;

    -- 2. Freelancer name lookup
    SELECT full_name
      INTO v_freelancer_name
      FROM public.profiles
     WHERE id = NEW.freelancer_id;

    v_submission_date := to_char(COALESCE(NEW.created_at, clock_timestamp()), 'Mon DD, YYYY');
    v_short_message := SUBSTRING(COALESCE(NEW.cover_letter, 'Review proposal details in your workspace.'), 1, 300);

    -- 3. Atomically persist outbox record
    INSERT INTO public.email_outbox (
        event_type,
        template_key,
        recipient_email,
        recipient_user_id,
        subject,
        payload,
        related_entity_id,
        idempotency_key
    ) VALUES (
        'proposal_received',
        'proposal_received_v1',
        v_client_email,
        v_client_id,
        'New proposal received for "' || v_job_title || '"',
        jsonb_build_object(
            'clientName', COALESCE(v_client_name, 'Client'),
            'freelancerName', COALESCE(v_freelancer_name, 'Freelancer Specialist'),
            'jobTitle', v_job_title,
            'jobId', NEW.job_id::text,
            'proposalId', NEW.id::text,
            'submissionDate', v_submission_date,
            'shortMessage', v_short_message,
            'accountState', 'existing_account'
        ),
        NEW.id::text,
        'email:proposal_received:' || NEW.id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposals_queue_email_on_insert ON public.proposals;
CREATE TRIGGER trg_proposals_queue_email_on_insert
    AFTER INSERT ON public.proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.queue_proposal_received_email();


-- ==============================================================================
-- 4. PROPOSAL ACCEPTED TRANSACTIONAL TRIGGER (Contract Creation Integration)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_contract_on_proposal_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_job RECORD;
    v_weekly_limit integer := NULL;
    v_hourly_rate numeric(10,2) := NULL;
    v_fixed_price numeric(12,2) := NULL;
    v_contract_id uuid;
    v_freelancer_email text;
    v_freelancer_name text;
    v_client_company_name text := NULL;
    v_rate_display text;
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
            v_weekly_limit := 40;
            v_rate_display := '$' || to_char(v_hourly_rate, 'FM999,999,990.00') || '/hr';
        ELSIF NEW.rate_type = 'fixed' THEN
            v_fixed_price := NEW.bid_amount;
            v_rate_display := '$' || to_char(v_fixed_price, 'FM999,999,990.00');
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
        ON CONFLICT (proposal_id) DO UPDATE SET updated_at = clock_timestamp()
        RETURNING id INTO v_contract_id;

        IF v_contract_id IS NULL THEN
            SELECT id INTO v_contract_id FROM public.contracts WHERE proposal_id = NEW.id;
        END IF;

        -- Queue proposal accepted transactional email outbox record
        IF v_contract_id IS NOT NULL THEN
            SELECT u.email, p.full_name
              INTO v_freelancer_email, v_freelancer_name
              FROM auth.users u
              LEFT JOIN public.profiles p ON p.id = u.id
             WHERE u.id = NEW.freelancer_id;

            IF v_job.company_id IS NOT NULL THEN
                SELECT name INTO v_client_company_name FROM public.companies WHERE id = v_job.company_id;
            END IF;

            IF v_client_company_name IS NULL THEN
                SELECT full_name INTO v_client_company_name FROM public.profiles WHERE id = v_job.client_id;
            END IF;

            IF v_freelancer_email IS NOT NULL THEN
                INSERT INTO public.email_outbox (
                    event_type,
                    template_key,
                    recipient_email,
                    recipient_user_id,
                    subject,
                    payload,
                    related_entity_id,
                    idempotency_key
                ) VALUES (
                    'proposal_accepted',
                    'proposal_accepted_v1',
                    v_freelancer_email,
                    NEW.freelancer_id,
                    'Congratulations! Your proposal for "' || v_job.title || '" was accepted',
                    jsonb_build_object(
                        'freelancerName', COALESCE(v_freelancer_name, 'Freelancer Specialist'),
                        'clientOrCompanyName', COALESCE(v_client_company_name, 'Client'),
                        'jobTitle', v_job.title,
                        'contractId', v_contract_id::text,
                        'contractType', NEW.rate_type,
                        'rateOrAmount', v_rate_display,
                        'establishedDate', to_char(clock_timestamp(), 'Mon DD, YYYY'),
                        'accountState', 'existing_account'
                    ),
                    v_contract_id::text,
                    'email:proposal_accepted:' || NEW.id
                )
                ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- ==============================================================================
-- 5. MILESTONE FUNDED TRANSACTIONAL TRIGGER (AFTER UPDATE OF status ON milestones)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.queue_milestone_funded_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_contract_title TEXT;
    v_freelancer_email TEXT;
    v_freelancer_name TEXT;
    v_has_captured_payment BOOLEAN;
    v_is_simulated BOOLEAN;
    v_formatted_amount TEXT;
BEGIN
    -- Only execute on transition to funded
    IF (OLD.status IS DISTINCT FROM 'funded') AND (NEW.status = 'funded') THEN
        -- Resolve contract title and freelancer contact
        SELECT c.title, u.email, p.full_name
          INTO v_contract_title, v_freelancer_email, v_freelancer_name
          FROM public.contracts c
          JOIN auth.users u ON u.id = NEW.freelancer_id
          LEFT JOIN public.profiles p ON p.id = NEW.freelancer_id
         WHERE c.id = NEW.contract_id;

        IF v_freelancer_email IS NULL THEN
            RETURN NEW;
        END IF;

        -- Authoritative verification: Check if a captured live provider payment attempt exists
        SELECT EXISTS (
            SELECT 1 FROM public.payment_attempts pa
             WHERE pa.milestone_id = NEW.id
               AND pa.status = 'captured'
               AND pa.razorpay_payment_id IS NOT NULL
        ) INTO v_has_captured_payment;

        v_is_simulated := NOT v_has_captured_payment;

        INSERT INTO public.email_outbox (
            event_type,
            template_key,
            recipient_email,
            recipient_user_id,
            subject,
            payload,
            related_entity_id,
            idempotency_key
        ) VALUES (
            'milestone_funded',
            'milestone_funded_v1',
            v_freelancer_email,
            NEW.freelancer_id,
            'Milestone Funded: "' || NEW.title || '" on "' || v_contract_title || '"',
            jsonb_build_object(
                'recipientName', COALESCE(v_freelancer_name, 'Freelancer'),
                'milestoneTitle', NEW.title,
                'contractTitle', v_contract_title,
                'contractId', NEW.contract_id::text,
                'amount', NEW.amount::numeric,
                'currency', NEW.currency,
                'isSimulated', v_is_simulated,
                'fundedDate', to_char(clock_timestamp(), 'Mon DD, YYYY'),
                'accountState', 'existing_account'
            ),
            NEW.id::text,
            'email:milestone_funded:' || NEW.id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milestone_queue_funded_email ON public.contract_milestones;
CREATE TRIGGER trg_milestone_queue_funded_email
    AFTER UPDATE OF status ON public.contract_milestones
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM 'funded' AND NEW.status = 'funded')
    EXECUTE FUNCTION public.queue_milestone_funded_email();


-- ==============================================================================
-- 6. MILESTONE RELEASED TRANSACTIONAL TRIGGER (AFTER UPDATE OF status ON milestones)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.queue_milestone_released_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_contract_title TEXT;
    v_freelancer_email TEXT;
    v_freelancer_name TEXT;
    v_is_simulated BOOLEAN := true;
BEGIN
    -- Only execute on transition to released (confirmed payout completion)
    IF (OLD.status IS DISTINCT FROM 'released') AND (NEW.status = 'released') THEN
        SELECT c.title, u.email, p.full_name
          INTO v_contract_title, v_freelancer_email, v_freelancer_name
          FROM public.contracts c
          JOIN auth.users u ON u.id = NEW.freelancer_id
          LEFT JOIN public.profiles p ON p.id = NEW.freelancer_id
         WHERE c.id = NEW.contract_id;

        IF v_freelancer_email IS NULL THEN
            RETURN NEW;
        END IF;

        -- Resolve is_simulated from payout_transfers record
        SELECT COALESCE((t.metadata->>'is_simulated')::boolean, true)
          INTO v_is_simulated
          FROM public.payout_transfers t
         WHERE t.milestone_id = NEW.id
           AND t.status = 'completed'
         ORDER BY t.created_at DESC
         LIMIT 1;

        IF v_is_simulated IS NULL THEN
            v_is_simulated := true;
        END IF;

        INSERT INTO public.email_outbox (
            event_type,
            template_key,
            recipient_email,
            recipient_user_id,
            subject,
            payload,
            related_entity_id,
            idempotency_key
        ) VALUES (
            'milestone_released',
            'milestone_released_v1',
            v_freelancer_email,
            NEW.freelancer_id,
            'Payment Released: "' || NEW.title || '" (' || UPPER(NEW.currency) || ' ' || NEW.amount || ')',
            jsonb_build_object(
                'recipientName', COALESCE(v_freelancer_name, 'Freelancer'),
                'milestoneTitle', NEW.title,
                'contractTitle', v_contract_title,
                'contractId', NEW.contract_id::text,
                'amount', NEW.amount::numeric,
                'currency', NEW.currency,
                'isSimulated', v_is_simulated,
                'releasedDate', to_char(clock_timestamp(), 'Mon DD, YYYY'),
                'accountState', 'existing_account'
            ),
            NEW.id::text,
            'email:milestone_released:' || NEW.id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_milestone_queue_released_email ON public.contract_milestones;
CREATE TRIGGER trg_milestone_queue_released_email
    AFTER UPDATE OF status ON public.contract_milestones
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM 'released' AND NEW.status = 'released')
    EXECUTE FUNCTION public.queue_milestone_released_email();


-- ==============================================================================
-- 7. UNREAD DIRECT MESSAGES THROTTLED QUEUE PROCEDURE & TRIGGERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.queue_unread_message_notification(
    p_message_id UUID,
    p_conversation_id UUID,
    p_sender_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_recipient_record RECORD;
    v_window RECORD;
    v_sender_name TEXT;
    v_context_title TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_quiet_minutes INTEGER := 15;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_epoch BIGINT;
    v_idempotency_key TEXT;
    v_outbox_id UUID;
    v_msg_created_at TIMESTAMPTZ;
    v_msg_iso_timestamp TEXT;
    v_recipient_email TEXT;
    v_recipient_name TEXT;
BEGIN
    SELECT created_at INTO v_msg_created_at
      FROM public.messages
     WHERE id = p_message_id;

    IF v_msg_created_at IS NULL THEN
        v_msg_created_at := v_now;
    END IF;

    v_msg_iso_timestamp := to_char(v_msg_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    SELECT COALESCE(full_name, 'Participant') INTO v_sender_name
      FROM public.profiles
     WHERE id = p_sender_id;

    SELECT COALESCE(c.title, j.title, con.title, 'Conversation')
      INTO v_context_title
      FROM public.conversations c
      LEFT JOIN public.jobs j ON j.id = c.job_id
      LEFT JOIN public.contracts con ON con.id = c.contract_id
     WHERE c.id = p_conversation_id;

    -- Coordinate notification for all counterpart participants
    FOR v_recipient_record IN
        SELECT cp.user_id, cp.last_read_at, u.email, p.full_name
          FROM public.conversation_participants cp
          JOIN auth.users u ON u.id = cp.user_id
          LEFT JOIN public.profiles p ON p.id = cp.user_id
         WHERE cp.conversation_id = p_conversation_id
           AND cp.user_id <> p_sender_id
    LOOP
        -- If recipient has already read this message, skip queueing
        IF v_recipient_record.last_read_at IS NOT NULL AND v_recipient_record.last_read_at >= v_msg_created_at THEN
            CONTINUE;
        END IF;

        v_recipient_email := v_recipient_record.email;
        v_recipient_name := COALESCE(v_recipient_record.full_name, 'Participant');

        -- Acquire row-level lock on coordination window
        SELECT * INTO v_window
          FROM public.message_notification_windows
         WHERE conversation_id = p_conversation_id
           AND recipient_user_id = v_recipient_record.user_id
           FOR UPDATE;

        IF NOT FOUND OR v_window.status IN ('dispatched', 'suppressed') OR v_now >= v_window.window_end_at THEN
            -- Start new bounded quiet window (15 minutes)
            v_window_start := v_now;
            v_window_end := v_now + (v_quiet_minutes || ' minutes')::interval;
            v_epoch := extract(epoch from v_window_start)::bigint;
            v_idempotency_key := 'email:unread_msg:' || p_conversation_id || ':' || v_recipient_record.user_id || ':' || v_epoch;

            INSERT INTO public.email_outbox (
                event_type,
                template_key,
                recipient_email,
                recipient_user_id,
                subject,
                payload,
                related_entity_id,
                idempotency_key,
                next_attempt_at,
                status
            ) VALUES (
                'unread_message',
                'unread_message_v1',
                v_recipient_email,
                v_recipient_record.user_id,
                'New message from ' || v_sender_name || ' on Workspace',
                jsonb_build_object(
                    'recipientName', v_recipient_name,
                    'senderName', v_sender_name,
                    'conversationId', p_conversation_id::text,
                    'jobOrContractTitle', v_context_title,
                    'unreadCount', 1,
                    'lastMessageTimestamp', v_msg_iso_timestamp,
                    'accountState', 'existing_account'
                ),
                p_conversation_id::text,
                v_idempotency_key,
                v_window_end,
                'pending'
            )
            ON CONFLICT (idempotency_key) DO UPDATE
               SET updated_at = now()
            RETURNING id INTO v_outbox_id;

            INSERT INTO public.message_notification_windows (
                conversation_id,
                recipient_user_id,
                window_start_at,
                window_end_at,
                last_message_at,
                unread_count,
                outbox_id,
                status,
                updated_at
            ) VALUES (
                p_conversation_id,
                v_recipient_record.user_id,
                v_window_start,
                v_window_end,
                v_msg_created_at,
                1,
                v_outbox_id,
                'active',
                v_now
            )
            ON CONFLICT (conversation_id, recipient_user_id) DO UPDATE SET
                window_start_at = EXCLUDED.window_start_at,
                window_end_at = EXCLUDED.window_end_at,
                last_message_at = EXCLUDED.last_message_at,
                unread_count = 1,
                outbox_id = EXCLUDED.outbox_id,
                status = 'active',
                updated_at = v_now;

        ELSE
            -- Active window already pending: increment counter and update timestamp without shifting next_attempt_at
            UPDATE public.message_notification_windows
               SET unread_count = unread_count + 1,
                   last_message_at = v_msg_created_at,
                   updated_at = v_now
             WHERE conversation_id = p_conversation_id
               AND recipient_user_id = v_recipient_record.user_id;

            IF v_window.outbox_id IS NOT NULL THEN
                UPDATE public.email_outbox
                   SET payload = jsonb_set(
                           jsonb_set(
                               payload,
                               '{unreadCount}',
                               to_jsonb(v_window.unread_count + 1)
                           ),
                           '{lastMessageTimestamp}',
                           to_jsonb(v_msg_iso_timestamp)
                       ),
                       updated_at = v_now
                 WHERE id = v_window.outbox_id
                   AND status = 'pending';
            END IF;
        END IF;
    END LOOP;
END;
$$;

-- Message insertion trigger
CREATE OR REPLACE FUNCTION public.handle_message_sent_email_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    PERFORM public.queue_unread_message_notification(NEW.id, NEW.conversation_id, NEW.sender_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_queue_unread_email ON public.messages;
CREATE TRIGGER trg_messages_queue_unread_email
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_message_sent_email_trigger();

-- Instant read-time suppression when caller opens and marks conversation as read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    UPDATE public.conversation_participants
       SET last_read_at = now()
     WHERE conversation_id = p_conversation_id
       AND user_id = v_caller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a participant in this conversation' USING ERRCODE = '42501';
    END IF;

    -- Suppress any pending email outbox notifications for this recipient and conversation
    UPDATE public.email_outbox
       SET status = 'suppressed',
           last_error = 'Recipient marked conversation as read before dispatch window',
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE recipient_user_id = v_caller_id
       AND related_entity_id = p_conversation_id::text
       AND status = 'pending';

    UPDATE public.message_notification_windows
       SET status = 'suppressed',
           updated_at = now()
     WHERE conversation_id = p_conversation_id
       AND recipient_user_id = v_caller_id;
END;
$$;
