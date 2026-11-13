-- Migration: 20261103000009_direct_messaging_and_profile_inquiry.sql
-- Description: Direct messaging RPC between marketplace participants from profile inquiries,
--              ensuring seamless Upwork-grade chat initiation.

CREATE OR REPLACE FUNCTION public.create_or_get_direct_conversation(
    p_recipient_id UUID,
    p_title TEXT DEFAULT 'Direct Inquiry'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_recipient_profile RECORD;
    v_caller_profile RECORD;
    v_conv_id UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Authentication required to start a conversation' USING ERRCODE = '42501';
    END IF;

    IF v_caller = p_recipient_id THEN
        RAISE EXCEPTION 'Cannot start a conversation with yourself' USING ERRCODE = '22023';
    END IF;

    -- Verify recipient profile exists
    SELECT id, full_name INTO v_recipient_profile
      FROM public.profiles
     WHERE id = p_recipient_id;

    IF v_recipient_profile.id IS NULL THEN
        RAISE EXCEPTION 'Recipient profile % not found', p_recipient_id USING ERRCODE = '02000';
    END IF;

    -- Fetch caller profile for context
    SELECT id, full_name INTO v_caller_profile
      FROM public.profiles
     WHERE id = v_caller;

    -- Check if a direct conversation already exists between these two users
    -- (where proposal_id IS NULL AND contract_id IS NULL)
    SELECT c.id INTO v_conv_id
      FROM public.conversations c
      JOIN public.conversation_participants cp1
        ON cp1.conversation_id = c.id AND cp1.user_id = v_caller
      JOIN public.conversation_participants cp2
        ON cp2.conversation_id = c.id AND cp2.user_id = p_recipient_id
     WHERE c.proposal_id IS NULL
       AND c.contract_id IS NULL
     LIMIT 1;

    -- If existing direct conversation found, return it
    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    -- Create new direct conversation
    INSERT INTO public.conversations (
        created_by,
        title,
        last_message_at,
        created_at,
        updated_at
    ) VALUES (
        v_caller,
        COALESCE(p_title, 'Direct Inquiry with ' || v_recipient_profile.full_name),
        now(),
        now(),
        now()
    )
    RETURNING id INTO v_conv_id;

    -- Add caller as participant
    INSERT INTO public.conversation_participants (
        conversation_id,
        user_id,
        last_read_at,
        joined_at
    ) VALUES (
        v_conv_id,
        v_caller,
        now(),
        now()
    );

    -- Add recipient as participant
    INSERT INTO public.conversation_participants (
        conversation_id,
        user_id,
        last_read_at,
        joined_at
    ) VALUES (
        v_conv_id,
        p_recipient_id,
        now(),
        now()
    );

    RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_or_get_direct_conversation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_direct_conversation(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

