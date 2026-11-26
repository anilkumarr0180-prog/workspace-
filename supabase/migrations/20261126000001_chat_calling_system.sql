-- ==============================================================================
-- Migration: 20261126000001_chat_calling_system.sql
-- Description: Real-time 1-on-1 Audio & Video Calling Sessions with RLS,
--              concurrency guards, and system call-log integration.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    callee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
    status TEXT NOT NULL DEFAULT 'ringing' CHECK (
        status IN ('ringing', 'active', 'ended', 'declined', 'missed', 'failed')
    ),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    end_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_call_different_participants CHECK (caller_id <> callee_id)
);

COMMENT ON TABLE public.call_sessions IS '1-on-1 audio and video call sessions anchored to messaging conversations.';

CREATE INDEX IF NOT EXISTS idx_call_sessions_conversation_created
    ON public.call_sessions (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_sessions_participants_status
    ON public.call_sessions (caller_id, callee_id, status);

-- Ensure at most one ringing or active call per conversation at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_call_per_conversation
    ON public.call_sessions (conversation_id)
    WHERE status IN ('ringing', 'active');

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_sessions_select_participants" ON public.call_sessions;
DROP POLICY IF EXISTS "call_sessions_insert_caller" ON public.call_sessions;
DROP POLICY IF EXISTS "call_sessions_update_participants" ON public.call_sessions;

CREATE POLICY "call_sessions_select_participants"
    ON public.call_sessions
    FOR SELECT
    USING (
        (auth.uid() = caller_id OR auth.uid() = callee_id)
        AND public.is_conversation_participant(call_sessions.conversation_id, auth.uid())
    );

CREATE POLICY "call_sessions_insert_caller"
    ON public.call_sessions
    FOR INSERT
    WITH CHECK (
        auth.uid() = caller_id
        AND public.is_conversation_participant(call_sessions.conversation_id, auth.uid())
    );

CREATE POLICY "call_sessions_update_participants"
    ON public.call_sessions
    FOR UPDATE
    USING (
        (auth.uid() = caller_id OR auth.uid() = callee_id)
        AND public.is_conversation_participant(call_sessions.conversation_id, auth.uid())
    )
    WITH CHECK (
        (auth.uid() = caller_id OR auth.uid() = callee_id)
        AND public.is_conversation_participant(call_sessions.conversation_id, auth.uid())
    );

GRANT SELECT, INSERT, UPDATE ON public.call_sessions TO authenticated;
GRANT ALL ON public.call_sessions TO service_role;
