-- ==============================================================================
-- Migration: 20261102000001_realtime_messaging_system.sql
-- Description: Complete Real-Time Messaging Architecture with Supabase Realtime,
--              PostgreSQL Row-Level Security, Storage Attachments, and Atomic
--              Conversation Linking.
-- ==============================================================================

-- 1. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    proposal_id UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    title TEXT,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversations IS 'Real-time messaging conversation threads anchored to proposals, jobs, and contracts.';

-- Unique constraint ensuring exactly one conversation exists per proposal
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_proposal_id
    ON public.conversations (proposal_id)
    WHERE proposal_id IS NOT NULL;

-- High-performance indexes for inbox sorting and entity lookups
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
    ON public.conversations (last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_job_id
    ON public.conversations (job_id)
    WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_contract_id
    ON public.conversations (contract_id)
    WHERE contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_created_by
    ON public.conversations (created_by);


-- 2. CONVERSATION PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_conversation_participant UNIQUE (conversation_id, user_id)
);

COMMENT ON TABLE public.conversation_participants IS 'Authorized users in a conversation with per-user read receipt tracking.';

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
    ON public.conversation_participants (user_id, last_read_at);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv
    ON public.conversation_participants (conversation_id);


-- 3. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
    attachment_path TEXT,
    attachment_name TEXT,
    attachment_size BIGINT,
    attachment_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_message_content_or_attachment CHECK (
        length(trim(content)) > 0 OR attachment_path IS NOT NULL
    ),
    CONSTRAINT chk_message_content_length CHECK (
        length(content) <= 10000
    )
);

COMMENT ON TABLE public.messages IS 'Individual text, image, and document messages within conversations.';

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON public.messages (sender_id);


-- 4. DATABASE INTEGRITY TRIGGERS

-- A. Automatically update conversation last_message_at and sender last_read_at
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Update conversation timestamp for inbox sorting
    UPDATE public.conversations
       SET last_message_at = NEW.created_at,
           updated_at = now()
     WHERE id = NEW.conversation_id;

    -- Automatically advance the sender's own read cursor to message creation time
    UPDATE public.conversation_participants
       SET last_read_at = NEW.created_at
     WHERE conversation_id = NEW.conversation_id
       AND user_id = NEW.sender_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_new_message ON public.messages;
CREATE TRIGGER trg_handle_new_message
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_message();

-- B. Strict message immutability of core fields
CREATE OR REPLACE FUNCTION public.check_message_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Field "id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.conversation_id IS DISTINCT FROM NEW.conversation_id THEN
        RAISE EXCEPTION 'Field "conversation_id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.sender_id IS DISTINCT FROM NEW.sender_id THEN
        RAISE EXCEPTION 'Field "sender_id" is immutable' USING ERRCODE = '42601';
    END IF;

    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Field "created_at" is immutable' USING ERRCODE = '42601';
    END IF;

    NEW.updated_at = now();

    -- Set edited_at if content changed and message is not deleted
    IF OLD.content IS DISTINCT FROM NEW.content AND NEW.deleted_at IS NULL THEN
        NEW.edited_at = now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_message_immutability ON public.messages;
CREATE TRIGGER trg_check_message_immutability
    BEFORE UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.check_message_immutability();

-- C. Automatically link conversation when contract is created for an accepted proposal
CREATE OR REPLACE FUNCTION public.link_conversation_to_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.proposal_id IS NOT NULL THEN
        UPDATE public.conversations
           SET contract_id = NEW.id,
               updated_at = now()
         WHERE proposal_id = NEW.proposal_id
           AND (contract_id IS NULL OR contract_id IS DISTINCT FROM NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_conversation_to_contract ON public.contracts;
CREATE TRIGGER trg_link_conversation_to_contract
    AFTER INSERT ON public.contracts
    FOR EACH ROW
    EXECUTE FUNCTION public.link_conversation_to_contract();


-- 5. SECURE TRANSACTIONAL PROCEDURES

-- A. Create or retrieve conversation for a proposal
CREATE OR REPLACE FUNCTION public.create_or_get_proposal_conversation(p_proposal_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_job_id UUID;
    v_freelancer_id UUID;
    v_client_id UUID;
    v_job_title TEXT;
    v_contract_id UUID;
    v_conv_id UUID;
BEGIN
    -- Strict authentication check
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to access conversation'
            USING ERRCODE = '42501';
    END IF;

    -- Fetch proposal, freelancer, job, and client authoritatively
    SELECT p.id, p.job_id, p.freelancer_id, j.client_id, j.title
      INTO STRICT v_contract_id, v_job_id, v_freelancer_id, v_client_id, v_job_title
      FROM public.proposals p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.id = p_proposal_id;

    -- Strict authorization check: Only proposal freelancer or job client can communicate
    IF v_caller_id <> v_freelancer_id AND v_caller_id <> v_client_id THEN
        RAISE EXCEPTION 'Unauthorized to open conversation for this proposal'
            USING ERRCODE = '42501';
    END IF;

    -- Check if conversation already exists for this proposal
    SELECT id INTO v_conv_id
      FROM public.conversations
     WHERE proposal_id = p_proposal_id;

    IF v_conv_id IS NOT NULL THEN
        -- Check if contract was created subsequently and needs linking
        SELECT id INTO v_contract_id
          FROM public.contracts
         WHERE proposal_id = p_proposal_id
         LIMIT 1;

        IF v_contract_id IS NOT NULL THEN
            UPDATE public.conversations
               SET contract_id = v_contract_id
             WHERE id = v_conv_id
               AND contract_id IS NULL;
        END IF;

        -- Ensure both participants are present
        INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at, joined_at)
        VALUES
            (v_conv_id, v_freelancer_id, now(), now()),
            (v_conv_id, v_client_id, now(), now())
        ON CONFLICT (conversation_id, user_id) DO NOTHING;

        RETURN v_conv_id;
    END IF;

    -- Look up existing contract if proposal was already accepted
    SELECT id INTO v_contract_id
      FROM public.contracts
     WHERE proposal_id = p_proposal_id
     LIMIT 1;

    -- Create new conversation atomically
    INSERT INTO public.conversations (
        created_by,
        job_id,
        proposal_id,
        contract_id,
        title,
        last_message_at,
        created_at,
        updated_at
    ) VALUES (
        v_caller_id,
        v_job_id,
        p_proposal_id,
        v_contract_id,
        v_job_title,
        now(),
        now(),
        now()
    )
    RETURNING id INTO v_conv_id;

    -- Add both participants
    INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at, joined_at)
    VALUES
        (v_conv_id, v_freelancer_id, now(), now()),
        (v_conv_id, v_client_id, now(), now())
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN v_conv_id;
END;
$$;

-- B. Create or retrieve conversation for a contract
CREATE OR REPLACE FUNCTION public.create_or_get_contract_conversation(p_contract_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_proposal_id UUID;
    v_job_id UUID;
    v_client_id UUID;
    v_freelancer_id UUID;
    v_contract_title TEXT;
    v_conv_id UUID;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to access conversation'
            USING ERRCODE = '42501';
    END IF;

    SELECT c.id, c.proposal_id, c.job_id, c.client_id, c.freelancer_id, c.title
      INTO STRICT p_contract_id, v_proposal_id, v_job_id, v_client_id, v_freelancer_id, v_contract_title
      FROM public.contracts c
     WHERE c.id = p_contract_id;

    IF v_caller_id <> v_freelancer_id AND v_caller_id <> v_client_id THEN
        RAISE EXCEPTION 'Unauthorized to open conversation for this contract'
            USING ERRCODE = '42501';
    END IF;

    -- If a conversation already exists linked to proposal or contract
    SELECT id INTO v_conv_id
      FROM public.conversations
     WHERE (contract_id = p_contract_id)
        OR (v_proposal_id IS NOT NULL AND proposal_id = v_proposal_id)
     LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        UPDATE public.conversations
           SET contract_id = p_contract_id
         WHERE id = v_conv_id
           AND contract_id IS NULL;

        INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at, joined_at)
        VALUES
            (v_conv_id, v_freelancer_id, now(), now()),
            (v_conv_id, v_client_id, now(), now())
        ON CONFLICT (conversation_id, user_id) DO NOTHING;

        RETURN v_conv_id;
    END IF;

    INSERT INTO public.conversations (
        created_by,
        job_id,
        proposal_id,
        contract_id,
        title,
        last_message_at,
        created_at,
        updated_at
    ) VALUES (
        v_caller_id,
        v_job_id,
        v_proposal_id,
        p_contract_id,
        v_contract_title,
        now(),
        now(),
        now()
    )
    RETURNING id INTO v_conv_id;

    INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at, joined_at)
    VALUES
        (v_conv_id, v_freelancer_id, now(), now()),
        (v_conv_id, v_client_id, now(), now())
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN v_conv_id;
END;
$$;

-- C. Mark conversation as read for the authenticated caller
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
END;
$$;


-- 6. ROW LEVEL SECURITY POLICIES

-- Helper function to check conversation participation without RLS recursion
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.conversation_participants
         WHERE conversation_id = p_conversation_id
           AND user_id = p_user_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID, UUID) TO authenticated, service_role;

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "conversations_select_participants" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_authenticated" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_participants" ON public.conversations;
DROP POLICY IF EXISTS "participants_select_fellow_members" ON public.conversation_participants;
DROP POLICY IF EXISTS "participants_update_own_read_state" ON public.conversation_participants;
DROP POLICY IF EXISTS "participants_insert_creator_or_self" ON public.conversation_participants;
DROP POLICY IF EXISTS "messages_select_participants" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;
DROP POLICY IF EXISTS "messages_update_sender" ON public.messages;

-- Conversations RLS
CREATE POLICY "conversations_select_participants"
    ON public.conversations
    FOR SELECT
    USING (public.is_conversation_participant(conversations.id, auth.uid()));

CREATE POLICY "conversations_insert_authenticated"
    ON public.conversations
    FOR INSERT
    WITH CHECK (auth.uid() = created_by);

CREATE POLICY "conversations_update_participants"
    ON public.conversations
    FOR UPDATE
    USING (public.is_conversation_participant(conversations.id, auth.uid()));

-- Participants RLS
CREATE POLICY "participants_select_fellow_members"
    ON public.conversation_participants
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_conversation_participant(conversation_participants.conversation_id, auth.uid())
    );

CREATE POLICY "participants_update_own_read_state"
    ON public.conversation_participants
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "participants_insert_creator_or_self"
    ON public.conversation_participants
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.conversations c
             WHERE c.id = conversation_participants.conversation_id
               AND c.created_by = auth.uid()
        )
    );

-- Messages RLS
CREATE POLICY "messages_select_participants"
    ON public.messages
    FOR SELECT
    USING (public.is_conversation_participant(messages.conversation_id, auth.uid()));

CREATE POLICY "messages_insert_sender"
    ON public.messages
    FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND public.is_conversation_participant(messages.conversation_id, auth.uid())
    );

CREATE POLICY "messages_update_sender"
    ON public.messages
    FOR UPDATE
    USING (
        auth.uid() = sender_id
        AND public.is_conversation_participant(messages.conversation_id, auth.uid())
    )
    WITH CHECK (
        auth.uid() = sender_id
        AND public.is_conversation_participant(messages.conversation_id, auth.uid())
    );


-- 7. SUPABASE STORAGE BUCKET & STORAGE RLS POLICIES

-- Private storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'workspace-message-attachments',
    'workspace-message-attachments',
    false,
    10485760, -- 10MB limit
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage object policies for workspace-message-attachments
DROP POLICY IF EXISTS "msg_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "msg_attachments_insert" ON storage.objects;

CREATE POLICY "msg_attachments_select"
    ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'workspace-message-attachments'
        AND auth.role() = 'authenticated'
        AND public.is_conversation_participant((storage.foldername(name))[1]::uuid, auth.uid())
    );

CREATE POLICY "msg_attachments_insert"
    ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'workspace-message-attachments'
        AND auth.role() = 'authenticated'
        AND public.is_conversation_participant((storage.foldername(name))[1]::uuid, auth.uid())
    );


-- 8. SUPABASE REALTIME CONFIGURATION

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'conversation_participants'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;
END $$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;


-- 9. PERMISSION GRANTS (Essential because auto_expose_new_tables = false)

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_or_get_proposal_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_contract_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;

GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.conversation_participants TO service_role;
GRANT ALL ON public.messages TO service_role;
