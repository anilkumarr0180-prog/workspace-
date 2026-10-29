-- ==============================================================================
-- Migration: 20261029000001_realtime_notifications.sql
-- Description: Production-ready Real-time Notification System with strict RLS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
    ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
    ON public.notifications(user_id) WHERE read = false;

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 1. SELECT Policy: Users can only view their own notifications
CREATE POLICY "notifications_select_own"
    ON public.notifications
    FOR SELECT
    USING (auth.uid() = user_id);

-- 2. UPDATE Policy: Users can only update their own notifications (e.g. marking read)
CREATE POLICY "notifications_update_own"
    ON public.notifications
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. DELETE Policy: Users can only delete their own notifications
CREATE POLICY "notifications_delete_own"
    ON public.notifications
    FOR DELETE
    USING (auth.uid() = user_id);

-- 4. INSERT Security:
-- Clients CANNOT insert arbitrary notifications directly into this table.
-- Inserts must originate from trusted server actions / service_role or the secure function below.
CREATE OR REPLACE FUNCTION public.send_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_link TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Verify target user exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        link,
        metadata
    ) VALUES (
        p_user_id,
        p_type,
        p_title,
        p_message,
        p_link,
        p_metadata
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Enable Supabase Realtime for notifications table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
