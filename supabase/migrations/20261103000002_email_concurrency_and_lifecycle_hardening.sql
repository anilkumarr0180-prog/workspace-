-- ==============================================================================
-- Migration: 20261103000002_email_concurrency_and_lifecycle_hardening.sql
-- Description: Step 2D.3 Email Notification Concurrency & Lifecycle Hardening
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA HARDENING & DEDUPLICATION IDENTIFIERS
-- ------------------------------------------------------------------------------

-- Add unique window_id to message_notification_windows for UUID-based cycle idempotency
ALTER TABLE public.message_notification_windows
    ADD COLUMN IF NOT EXISTS window_id UUID NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.message_notification_windows.window_id IS 'Unique cycle identifier for the currently active or completed notification window.';

-- Add optional idempotency_key to public.notifications for atomic database-level deduplication
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DROP INDEX IF EXISTS public.uq_notifications_idempotency_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_notifications_idempotency_key'
    ) THEN
        ALTER TABLE public.notifications
            ADD CONSTRAINT uq_notifications_idempotency_key UNIQUE (idempotency_key);
    END IF;
END;
$$;

COMMENT ON COLUMN public.notifications.idempotency_key IS 'Unique idempotency key preventing duplicate in-app notifications on retries.';


-- ------------------------------------------------------------------------------
-- 2. CANCELLATION STORED PROCEDURE & COORDINATION OWNERSHIP
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_outbox_email_cancelled(
    p_id UUID,
    p_reason TEXT DEFAULT 'Delivery cancelled'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_outbox
       SET status = 'cancelled',
           last_error = SUBSTRING(COALESCE(NULLIF(trim(p_reason), ''), 'Delivery cancelled'), 1, 4000),
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE id = p_id;

    -- Synchronize corresponding message window ONLY if outbox_id matches p_id
    UPDATE public.message_notification_windows
       SET status = 'suppressed',
           updated_at = now()
     WHERE outbox_id = p_id;
END;
$$;

COMMENT ON FUNCTION public.mark_outbox_email_cancelled IS 'Marks outbox email record as cancelled and updates corresponding coordination window.';

REVOKE ALL ON FUNCTION public.mark_outbox_email_cancelled(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_cancelled(UUID, TEXT) TO service_role;


-- ------------------------------------------------------------------------------
-- 3. PERMISSION HARDENING FOR mark_conversation_read
-- ------------------------------------------------------------------------------

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

    -- Suppress pending email outbox notifications for this recipient and conversation
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

REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 4. HARDENED MESSAGING COORDINATION PROCEDURE (BUG-CONC-01 & BUG-CONC-02 FIX)
-- ------------------------------------------------------------------------------

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
    v_new_window_id UUID;
    v_idempotency_key TEXT;
    v_outbox_id UUID;
    v_outbox_status TEXT;
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

        -- 1. TRANSACTION-LEVEL ADVISORY LOCK (BUG-CONC-02 FIX)
        -- Serializes concurrent message insertions for the exact same conversation and recipient
        PERFORM pg_advisory_xact_lock(hashtext('msg_window:' || p_conversation_id::text || ':' || v_recipient_record.user_id::text));

        v_recipient_email := v_recipient_record.email;
        v_recipient_name := COALESCE(v_recipient_record.full_name, 'Participant');

        -- 2. Query current coordination window with row-level lock
        SELECT * INTO v_window
          FROM public.message_notification_windows
         WHERE conversation_id = p_conversation_id
           AND recipient_user_id = v_recipient_record.user_id
           FOR UPDATE;

        -- Check status of current outbox record if one is linked
        v_outbox_status := NULL;
        IF FOUND AND v_window.outbox_id IS NOT NULL THEN
            SELECT status INTO v_outbox_status
              FROM public.email_outbox
             WHERE id = v_window.outbox_id;
        END IF;

        -- 3. CYCLE TRANSITION CHECK (BUG-CONC-01 FIX)
        -- Must start a NEW notification cycle if:
        -- - No window exists yet
        -- - Window is marked dispatched or suppressed
        -- - Quiet period window has expired (v_now >= window_end_at)
        -- - Linked outbox record is already CLAIMED by worker (processing) or terminal (sent, dead_letter, suppressed, cancelled)
        -- - No outbox record is linked
        IF NOT FOUND 
           OR v_window.status IN ('dispatched', 'suppressed') 
           OR v_now >= v_window.window_end_at
           OR v_outbox_status IN ('processing', 'sent', 'dead_letter', 'suppressed', 'cancelled')
           OR v_outbox_status IS NULL 
        THEN
            -- Start a brand new 15-minute quiet cycle with a unique UUID window_id
            v_new_window_id := gen_random_uuid();
            v_window_start := v_now;
            v_window_end := v_now + (v_quiet_minutes || ' minutes')::interval;
            v_idempotency_key := 'email:unread_msg:' || p_conversation_id || ':' || v_recipient_record.user_id || ':' || v_new_window_id;

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
                    'windowId', v_new_window_id::text,
                    'accountState', 'existing_account'
                ),
                p_conversation_id::text,
                v_idempotency_key,
                v_window_end,
                'pending'
            ) RETURNING id INTO v_outbox_id;

            -- Upsert coordination window with the new cycle state
            INSERT INTO public.message_notification_windows (
                conversation_id,
                recipient_user_id,
                window_id,
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
                v_new_window_id,
                v_window_start,
                v_window_end,
                v_msg_created_at,
                1,
                v_outbox_id,
                'active',
                v_now
            )
            ON CONFLICT (conversation_id, recipient_user_id) DO UPDATE SET
                window_id = EXCLUDED.window_id,
                window_start_at = EXCLUDED.window_start_at,
                window_end_at = EXCLUDED.window_end_at,
                last_message_at = EXCLUDED.last_message_at,
                unread_count = 1,
                outbox_id = EXCLUDED.outbox_id,
                status = 'active',
                updated_at = v_now;

        ELSE
            -- Active window within quiet period with safe pending/failed outbox record:
            -- Increment counter and update message timestamp WITHOUT shifting next_attempt_at
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
                   AND status IN ('pending', 'failed');
            END IF;
        END IF;
    END LOOP;
END;
$$;


-- ------------------------------------------------------------------------------
-- 5. RAZORPAY GATEWAY & WEBHOOK RECONCILIATION ORDERING (BUG-PAY-01 FIX)
-- ------------------------------------------------------------------------------

-- Update reconcile_webhook_payment to mark payment_attempts captured BEFORE milestone status transition
CREATE OR REPLACE FUNCTION public.reconcile_webhook_payment(
    p_milestone_id uuid,
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
    v_milestone public.contract_milestones;
    v_webhook_event public.webhook_events;
    v_desc text;
    v_event_type text;
    v_environment text;
BEGIN
    -- Strict least-privilege authorization check: caller must be service_role or superuser/postgres
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reconcile_webhook_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    -- Fail-closed parameter validation
    IF p_milestone_id IS NULL THEN
        RAISE EXCEPTION 'Milestone ID cannot be null' USING ERRCODE = '22023';
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

            -- If previous attempt failed or was received, mark as processing
            UPDATE public.webhook_events
               SET status = 'processing',
                   metadata = metadata || jsonb_build_object('retried_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        ELSE
            -- Record new incoming event in 'processing' status
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
                    'milestone_id', p_milestone_id
                )
            ) RETURNING * INTO v_webhook_event;
        END IF;
    END IF;

    -- Strict atomic row lock on payment_attempts to eliminate race conditions
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE milestone_id = p_milestone_id
       AND razorpay_order_id = trim(p_razorpay_order_id)
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Payment attempt not found for order')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Payment attempt not found for milestone % and order %', p_milestone_id, p_razorpay_order_id
            USING ERRCODE = '23503';
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

    -- Strict atomic row lock on contract_milestones
    SELECT * INTO v_milestone
      FROM public.contract_milestones
     WHERE id = p_milestone_id
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Milestone not found')
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Milestone % not found', p_milestone_id
            USING ERRCODE = '23503';
    END IF;

    -- Database-level idempotency: if milestone is already funded or attempt is already captured, exit cleanly
    IF v_milestone.status = 'funded' OR v_attempt.status = 'captured' THEN
        IF p_razorpay_payment_id IS NOT NULL AND v_attempt.razorpay_payment_id IS NULL THEN
            UPDATE public.payment_attempts
               SET razorpay_payment_id = p_razorpay_payment_id,
                   updated_at = clock_timestamp()
             WHERE id = v_attempt.id;
        END IF;

        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'processed',
                   processed_at = clock_timestamp()
             WHERE id = v_webhook_event.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', v_milestone.status,
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'razorpay_order_id', v_attempt.razorpay_order_id,
            'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id),
            'message', 'Milestone already funded or attempt already captured'
        );
    END IF;

    IF v_milestone.status <> 'planned' THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Unexpected milestone status ' || v_milestone.status)
             WHERE id = v_webhook_event.id;
        END IF;

        RAISE EXCEPTION 'Milestone % is in state "%" and cannot be funded via webhook', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    -- STEP 1: Update payment attempt to 'captured' FIRST (Enables email trigger to see captured status)
    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = COALESCE(p_razorpay_payment_id, razorpay_payment_id),
           metadata = metadata || COALESCE(p_payment_metadata, '{}'::jsonb),
           updated_at = clock_timestamp()
     WHERE id = v_attempt.id;

    -- STEP 2: Transition milestone status to 'funded' (Fires trigger trg_milestone_queue_funded_email)
    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    -- Dynamic environment description
    v_desc := 'Escrow Funded via Razorpay' || 
              CASE WHEN v_attempt.environment = 'test' THEN ' (Test Mode)' ELSE '' END || 
              ' (Webhook): Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';

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
        v_desc,
        jsonb_build_object(
            'provider', 'razorpay',
            'source', 'webhook',
            'environment', v_attempt.environment,
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'razorpay_order_id', v_attempt.razorpay_order_id,
            'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id),
            'captured_amount', v_attempt.amount_subunits,
            'captured_currency', v_attempt.currency,
            'event_id', p_event_id,
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    -- Mark webhook event as processed
    IF v_webhook_event.id IS NOT NULL THEN
        UPDATE public.webhook_events
           SET status = 'processed',
               processed_at = clock_timestamp()
         WHERE id = v_webhook_event.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'status', 'funded',
        'milestone_id', v_milestone.id,
        'contract_id', v_milestone.contract_id,
        'razorpay_order_id', v_attempt.razorpay_order_id,
        'razorpay_payment_id', COALESCE(p_razorpay_payment_id, v_attempt.razorpay_payment_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_webhook_payment FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_webhook_payment TO service_role;


-- Update fund_milestone_with_payment to mark payment_attempts captured BEFORE milestone status transition
CREATE OR REPLACE FUNCTION public.fund_milestone_with_payment(
    p_milestone_id uuid,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.contract_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid;
    v_milestone public.contract_milestones;
    v_contract RECORD;
    v_provider text;
    v_environment text;
    v_desc text;
    v_order_id text;
    v_payment_id text;
BEGIN
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: fund_milestone_with_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_milestone FROM public.contract_milestones WHERE id = p_milestone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Milestone % not found', p_milestone_id USING ERRCODE = '23503';
    END IF;

    SELECT * INTO v_contract FROM public.contracts WHERE id = v_milestone.contract_id;

    v_actor_id := COALESCE(
        NULLIF(p_payment_metadata->>'funded_by', '')::uuid,
        NULLIF(p_payment_metadata->>'client_id', '')::uuid,
        auth.uid(),
        v_milestone.client_id
    );

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

    v_order_id := p_payment_metadata->>'razorpay_order_id';

    IF v_milestone.status = 'funded' THEN
        IF v_order_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.payment_attempts
             WHERE razorpay_order_id = v_order_id
               AND milestone_id = p_milestone_id
               AND status = 'captured'
        ) THEN
            RETURN v_milestone;
        END IF;
        RAISE EXCEPTION 'Milestone % is already funded', p_milestone_id USING ERRCODE = '22023';
    END IF;

    IF v_milestone.status <> 'planned' THEN
        RAISE EXCEPTION 'Milestone % is in state "%" and cannot be funded', p_milestone_id, v_milestone.status
            USING ERRCODE = '22023';
    END IF;

    v_provider := COALESCE(p_payment_metadata->>'provider', 'simulated');
    v_environment := COALESCE(p_payment_metadata->>'environment', 'test');
    v_payment_id := p_payment_metadata->>'razorpay_payment_id';

    -- STEP 1: Update payment attempt to captured BEFORE milestone status transition
    IF v_order_id IS NOT NULL THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = v_payment_id,
               razorpay_signature = p_payment_metadata->>'razorpay_signature',
               metadata = metadata || COALESCE(p_payment_metadata, '{}'::jsonb),
               updated_at = clock_timestamp()
         WHERE razorpay_order_id = v_order_id
           AND milestone_id = p_milestone_id;
    END IF;

    -- STEP 2: Transition milestone status (Fires trigger trg_milestone_queue_funded_email)
    UPDATE public.contract_milestones
       SET status = 'funded',
           updated_at = clock_timestamp()
     WHERE id = p_milestone_id
 RETURNING * INTO v_milestone;

    IF v_provider = 'razorpay' THEN
        v_desc := 'Escrow Funded via Razorpay' || 
                  CASE WHEN v_environment = 'test' THEN ' (Test Mode)' ELSE '' END || 
                  ': Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
    ELSE
        v_desc := 'Escrow Funded: Milestone #' || v_milestone.sequence_order || ' (' || v_milestone.title || ')';
    END IF;

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
        v_desc,
        jsonb_build_object(
            'milestone_id', v_milestone.id,
            'contract_id', v_milestone.contract_id,
            'funded_by', v_actor_id,
            'environment', v_environment,
            'timestamp', clock_timestamp()
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    RETURN v_milestone;
END;
$$;

REVOKE ALL ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_milestone_with_payment(uuid, jsonb) TO service_role;


-- ------------------------------------------------------------------------------
-- 6. MILESTONE FUNDED TRIGGER: ATOMIC EMAIL AND IN-APP NOTIFICATION (BUG-NOTIF-01 FIX)
-- ------------------------------------------------------------------------------

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
    v_notif_message TEXT;
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

        -- Authoritative verification: Check if a captured live provider payment attempt exists
        SELECT EXISTS (
            SELECT 1 FROM public.payment_attempts pa
             WHERE pa.milestone_id = NEW.id
               AND pa.status = 'captured'
               AND pa.razorpay_payment_id IS NOT NULL
        ) INTO v_has_captured_payment;

        v_is_simulated := NOT v_has_captured_payment;

        -- 1. Atomically insert in-app notification idempotently (BUG-NOTIF-01 FIX)
        IF NEW.freelancer_id IS NOT NULL THEN
            IF v_is_simulated THEN
                v_notif_message := 'Milestone "' || NEW.title || '" ($' || NEW.amount || ') has been funded into escrow. You can begin work.';
            ELSE
                v_notif_message := 'Milestone "' || NEW.title || '" ($' || NEW.amount || ') has been funded into escrow via Razorpay. You can begin work.';
            END IF;

            INSERT INTO public.notifications (
                user_id,
                type,
                title,
                message,
                link,
                metadata,
                idempotency_key
            ) VALUES (
                NEW.freelancer_id,
                'milestone_funded',
                'Milestone Funded',
                v_notif_message,
                '/contracts/' || NEW.contract_id,
                jsonb_build_object(
                    'milestoneId', NEW.id,
                    'contractId', NEW.contract_id,
                    'amount', NEW.amount,
                    'isSimulated', v_is_simulated
                ),
                'notif:milestone_funded:' || NEW.id
            )
            ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;

        -- 2. Atomically insert email outbox record
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
    END IF;

    RETURN NEW;
END;
$$;
