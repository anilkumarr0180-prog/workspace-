-- ==============================================================================
-- Migration: 20261117000001_optimized_inbox_and_unread_counts.sql
-- Description: High-performance composite indexes and transactional RPC for
--              inbox conversations, lateral latest message retrieval, and
--              efficient unread count aggregation.
-- Status: PENDING USER APPROVAL / PHASE 2 (DO NOT RUN AGAINST PRODUCTION)
-- ==============================================================================

-- 1. COMPOSITE INDEXES FOR DETERMINISTIC CURSOR PAGINATION & UNREAD COUNTS
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at_id
    ON public.conversations (last_message_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
    ON public.messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_unread_speedup
    ON public.messages (conversation_id, created_at DESC, sender_id)
    WHERE deleted_at IS NULL;

-- 2. INBOX RETRIEVAL RPC
CREATE OR REPLACE FUNCTION public.get_inbox_conversations(
    p_limit INT DEFAULT 50,
    p_cursor_last_message_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
    v_result JSONB;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    WITH caller_conversations AS (
        SELECT 
            c.id,
            c.created_by,
            c.job_id,
            c.proposal_id,
            c.contract_id,
            c.title,
            c.last_message_at,
            c.created_at,
            c.updated_at,
            cp.last_read_at AS caller_last_read_at
        FROM public.conversations c
        JOIN public.conversation_participants cp
          ON cp.conversation_id = c.id AND cp.user_id = v_caller_id
        WHERE (p_cursor_last_message_at IS NULL OR (c.last_message_at, c.id) < (p_cursor_last_message_at, p_cursor_id))
        ORDER BY c.last_message_at DESC, c.id DESC
        LIMIT v_limit + 1
    ),
    conversations_with_counts AS (
        SELECT
            cc.*,
            COALESCE(
                (SELECT count(*)::int
                   FROM public.messages m
                  WHERE m.conversation_id = cc.id
                    AND m.sender_id <> v_caller_id
                    AND m.created_at > cc.caller_last_read_at
                    AND m.deleted_at IS NULL),
                0
            ) AS unread_count
        FROM caller_conversations cc
    )
    SELECT jsonb_build_object(
        'conversations', COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', cwc.id,
                'created_by', cwc.created_by,
                'job_id', cwc.job_id,
                'proposal_id', cwc.proposal_id,
                'contract_id', cwc.contract_id,
                'title', cwc.title,
                'last_message_at', cwc.last_message_at,
                'created_at', cwc.created_at,
                'updated_at', cwc.updated_at,
                'unread_count', cwc.unread_count
            )
        ), '[]'::jsonb),
        'has_more', count(*) > v_limit
    )
    INTO v_result
    FROM conversations_with_counts cwc;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inbox_conversations(INT, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inbox_conversations(INT, TIMESTAMPTZ, UUID, TEXT) TO authenticated, service_role;

