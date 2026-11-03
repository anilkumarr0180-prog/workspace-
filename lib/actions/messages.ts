'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/actions/notifications';
import {
  Message,
  MessageType,
  Conversation,
  ConversationParticipant,
} from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export interface SendMessageInput {
  conversationId: string;
  content: string;
  messageType?: MessageType;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentType?: string | null;
}

export interface SendMessageResult {
  success: boolean;
  message?: Message;
  error?: string;
  code?: string;
}

export interface GetMessagesOptions {
  limit?: number;
  before?: string; // cursor (ISO timestamp or message ID)
}

export interface GetMessagesResult {
  success: boolean;
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string | null;
  error?: string;
}

export interface GetConversationsResult {
  success: boolean;
  conversations: Conversation[];
  error?: string;
}

export interface ConversationDetailsResult {
  success: boolean;
  conversation?: Conversation;
  error?: string;
}

export interface AttachmentUploadResult {
  success: boolean;
  path?: string;
  name?: string;
  size?: number;
  type?: string;
  signedUrl?: string;
  error?: string;
}

interface DbConversationRow {
  id: string;
  created_by: string;
  job_id?: string | null;
  proposal_id?: string | null;
  contract_id?: string | null;
  title?: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  jobs?: { id: string; title: string } | null;
  contracts?: { id: string; title: string; status: string } | null;
  conversation_participants: Array<{
    id: string;
    conversation_id: string;
    user_id: string;
    last_read_at: string;
    joined_at: string;
    profiles: {
      id: string;
      full_name: string;
      avatar_url?: string | null;
      username: string;
      title?: string | null;
      active_mode: 'client' | 'freelancer';
    };
  }>;
}

interface DbMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_type?: string | null;
  created_at: string;
  updated_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  profiles?: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    username: string;
  } | null;
}

/**
 * Creates or retrieves an existing conversation anchored to a proposal or contract.
 * Strictly verifies participant authorization.
 */
export async function createOrGetConversation(params: {
  proposalId?: string;
  contractId?: string;
}): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (params.proposalId) {
      if (!UUID_REGEX.test(params.proposalId)) {
        return { success: false, error: 'Invalid proposal identifier format' };
      }

      const { data: convId, error: rpcError } = await supabase.rpc(
        'create_or_get_proposal_conversation',
        { p_proposal_id: params.proposalId }
      );

      if (rpcError) {
        return { success: false, error: rpcError.message };
      }

      return { success: true, conversationId: convId as string };
    }

    if (params.contractId) {
      if (!UUID_REGEX.test(params.contractId)) {
        return { success: false, error: 'Invalid contract identifier format' };
      }

      const { data: convId, error: rpcError } = await supabase.rpc(
        'create_or_get_contract_conversation',
        { p_contract_id: params.contractId }
      );

      if (rpcError) {
        return { success: false, error: rpcError.message };
      }

      return { success: true, conversationId: convId as string };
    }

    return {
      success: false,
      error: 'Either proposalId or contractId must be specified to initialize a conversation',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create or retrieve conversation';
    return { success: false, error: msg };
  }
}

/**
 * Fetch all conversations for the authenticated user, complete with participants,
 * last message preview, unread counts, and related job/contract context.
 */
export async function getConversations(
  options: { search?: string } = {}
): Promise<GetConversationsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, conversations: [], error: 'Authentication required' };
    }

    // 1. Fetch conversations in which the user is an active participant
    const { data: rawConversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        created_by,
        job_id,
        proposal_id,
        contract_id,
        title,
        last_message_at,
        created_at,
        updated_at,
        jobs:job_id ( id, title ),
        contracts:contract_id ( id, title, status ),
        conversation_participants (
          id,
          conversation_id,
          user_id,
          last_read_at,
          joined_at,
          profiles:user_id (
            id,
            full_name,
            avatar_url,
            username,
            title,
            active_mode
          )
        )
      `)
      .order('last_message_at', { ascending: false });

    if (convError) {
      return { success: false, conversations: [], error: convError.message };
    }

    if (!rawConversations || rawConversations.length === 0) {
      return { success: true, conversations: [] };
    }

    const conversationIds = rawConversations.map((c) => c.id);

    // 2. Fetch the latest non-deleted message for each conversation in parallel
    const { data: recentMessages, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        message_type,
        attachment_path,
        attachment_name,
        created_at,
        updated_at,
        edited_at,
        deleted_at,
        profiles:sender_id ( id, full_name, avatar_url, username )
      `)
      .in('conversation_id', conversationIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (msgError) {
      return { success: false, conversations: [], error: msgError.message };
    }

    // Map latest message by conversation_id
    const latestMessageMap = new Map<string, Message>();
    const unreadCountMap = new Map<string, number>();

    // Initialize unread counts
    for (const c of rawConversations) {
      unreadCountMap.set(c.id, 0);
    }

    if (recentMessages) {
      for (const m of recentMessages) {
        if (!latestMessageMap.has(m.conversation_id)) {
          const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          latestMessageMap.set(m.conversation_id, {
            id: m.id,
            conversationId: m.conversation_id,
            senderId: m.sender_id,
            senderName: profile?.full_name || 'Participant',
            senderAvatar: profile?.avatar_url || null,
            content: m.content,
            messageType: m.message_type as MessageType,
            attachmentPath: m.attachment_path || null,
            attachmentName: m.attachment_name || null,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
            editedAt: m.edited_at || null,
            deletedAt: m.deleted_at || null,
          });
        }
      }
    }

    // 3. Calculate unread messages efficiently
    for (const raw of rawConversations) {
      const myParticipant = raw.conversation_participants?.find((p) => p.user_id === user.id);
      const myLastReadAt = myParticipant ? new Date(myParticipant.last_read_at).getTime() : 0;

      if (recentMessages) {
        const unread = recentMessages.filter(
          (m) =>
            m.conversation_id === raw.id &&
            m.sender_id !== user.id &&
            new Date(m.created_at).getTime() > myLastReadAt
        ).length;
        unreadCountMap.set(raw.id, unread);
      }
    }

    // 4. Map and format conversations
    const mapped: Conversation[] = (rawConversations as unknown as DbConversationRow[]).map(
      (raw) => {
        const myParticipant = raw.conversation_participants?.find((p) => p.user_id === user.id);
        const otherParticipantRow = raw.conversation_participants?.find(
          (p) => p.user_id !== user.id
        );

        const participants: ConversationParticipant[] = (
          raw.conversation_participants || []
        ).map((p) => ({
          id: p.id,
          conversationId: p.conversation_id,
          userId: p.user_id,
          fullName: p.profiles?.full_name || 'User',
          avatarUrl: p.profiles?.avatar_url || null,
          username: p.profiles?.username || 'user',
          title: p.profiles?.title || null,
          activeMode: p.profiles?.active_mode,
          lastReadAt: p.last_read_at,
          joinedAt: p.joined_at,
        }));

        const otherParticipant: ConversationParticipant | undefined = otherParticipantRow
          ? {
              id: otherParticipantRow.id,
              conversationId: otherParticipantRow.conversation_id,
              userId: otherParticipantRow.user_id,
              fullName: otherParticipantRow.profiles?.full_name || 'Participant',
              avatarUrl: otherParticipantRow.profiles?.avatar_url || null,
              username: otherParticipantRow.profiles?.username || 'participant',
              title: otherParticipantRow.profiles?.title || null,
              activeMode: otherParticipantRow.profiles?.active_mode,
              lastReadAt: otherParticipantRow.last_read_at,
              joinedAt: otherParticipantRow.joined_at,
            }
          : undefined;

        const jobTitle = raw.jobs?.title || null;
        const contractTitle = raw.contracts?.title || null;
        const contractStatus = (raw.contracts?.status as Conversation['contractStatus']) || null;

        return {
          id: raw.id,
          createdBy: raw.created_by,
          jobId: raw.job_id || null,
          jobTitle,
          proposalId: raw.proposal_id || null,
          contractId: raw.contract_id || null,
          contractTitle,
          contractStatus,
          title: raw.title || jobTitle || contractTitle || 'Conversation',
          lastMessageAt: raw.last_message_at,
          createdAt: raw.created_at,
          updatedAt: raw.updated_at,
          participants,
          otherParticipant,
          lastMessage: latestMessageMap.get(raw.id) || null,
          unreadCount: unreadCountMap.get(raw.id) || 0,
          myLastReadAt: myParticipant?.last_read_at || raw.created_at,
        };
      }
    );

    // Filter by search query if provided
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      const filtered = mapped.filter(
        (c) =>
          c.otherParticipant?.fullName.toLowerCase().includes(q) ||
          c.otherParticipant?.username.toLowerCase().includes(q) ||
          c.title?.toLowerCase().includes(q) ||
          c.lastMessage?.content.toLowerCase().includes(q)
      );
      return { success: true, conversations: filtered };
    }

    return { success: true, conversations: mapped };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch conversations';
    return { success: false, conversations: [], error: msg };
  }
}

/**
 * Fetch a single conversation's details and metadata.
 */
export async function getConversationDetails(
  conversationId: string
): Promise<ConversationDetailsResult> {
  try {
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation identifier format' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const { data: raw, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        created_by,
        job_id,
        proposal_id,
        contract_id,
        title,
        last_message_at,
        created_at,
        updated_at,
        jobs:job_id ( id, title ),
        contracts:contract_id ( id, title, status ),
        conversation_participants (
          id,
          conversation_id,
          user_id,
          last_read_at,
          joined_at,
          profiles:user_id (
            id,
            full_name,
            avatar_url,
            username,
            title,
            active_mode
          )
        )
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !raw) {
      return { success: false, error: 'Conversation not found or access denied' };
    }

    const typedRow = raw as unknown as DbConversationRow;
    const isParticipant = typedRow.conversation_participants?.some((p) => p.user_id === user.id);

    if (!isParticipant) {
      return { success: false, error: 'Unauthorized to view this conversation' };
    }

    const myParticipant = typedRow.conversation_participants?.find((p) => p.user_id === user.id);
    const otherParticipantRow = typedRow.conversation_participants?.find(
      (p) => p.user_id !== user.id
    );

    const participants: ConversationParticipant[] = (
      typedRow.conversation_participants || []
    ).map((p) => ({
      id: p.id,
      conversationId: p.conversation_id,
      userId: p.user_id,
      fullName: p.profiles?.full_name || 'User',
      avatarUrl: p.profiles?.avatar_url || null,
      username: p.profiles?.username || 'user',
      title: p.profiles?.title || null,
      activeMode: p.profiles?.active_mode,
      lastReadAt: p.last_read_at,
      joinedAt: p.joined_at,
    }));

    const otherParticipant: ConversationParticipant | undefined = otherParticipantRow
      ? {
          id: otherParticipantRow.id,
          conversationId: otherParticipantRow.conversation_id,
          userId: otherParticipantRow.user_id,
          fullName: otherParticipantRow.profiles?.full_name || 'Participant',
          avatarUrl: otherParticipantRow.profiles?.avatar_url || null,
          username: otherParticipantRow.profiles?.username || 'participant',
          title: otherParticipantRow.profiles?.title || null,
          activeMode: otherParticipantRow.profiles?.active_mode,
          lastReadAt: otherParticipantRow.last_read_at,
          joinedAt: otherParticipantRow.joined_at,
        }
      : undefined;

    return {
      success: true,
      conversation: {
        id: typedRow.id,
        createdBy: typedRow.created_by,
        jobId: typedRow.job_id || null,
        jobTitle: typedRow.jobs?.title || null,
        proposalId: typedRow.proposal_id || null,
        contractId: typedRow.contract_id || null,
        contractTitle: typedRow.contracts?.title || null,
        contractStatus: (typedRow.contracts?.status as Conversation['contractStatus']) || null,
        title: typedRow.title || typedRow.jobs?.title || typedRow.contracts?.title || 'Conversation',
        lastMessageAt: typedRow.last_message_at,
        createdAt: typedRow.created_at,
        updatedAt: typedRow.updated_at,
        participants,
        otherParticipant,
        unreadCount: 0,
        myLastReadAt: myParticipant?.last_read_at || typedRow.created_at,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching conversation details';
    return { success: false, error: msg };
  }
}

/**
 * Fetch messages for a conversation with cursor-based pagination.
 * Generates temporary signed URLs for attachments.
 */
export async function getMessages(
  conversationId: string,
  options: GetMessagesOptions = {}
): Promise<GetMessagesResult> {
  const { limit = 40, before } = options;

  try {
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, messages: [], hasMore: false, error: 'Invalid conversation ID' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, messages: [], hasMore: false, error: 'Authentication required' };
    }

    // Check membership
    const { data: participant, error: partError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (partError || !participant) {
      return { success: false, messages: [], hasMore: false, error: 'Access denied' };
    }

    let query = supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        message_type,
        attachment_path,
        attachment_name,
        attachment_size,
        attachment_type,
        created_at,
        updated_at,
        edited_at,
        deleted_at,
        profiles:sender_id (
          id,
          full_name,
          avatar_url,
          username
        )
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: rawMessages, error: msgError } = await query;

    if (msgError) {
      return { success: false, messages: [], hasMore: false, error: msgError.message };
    }

    const hasMore = (rawMessages || []).length > limit;
    const sliced = hasMore ? (rawMessages || []).slice(0, limit) : rawMessages || [];

    // Reverse to chronological order (oldest to newest)
    const chronological = sliced.slice().reverse();

    // Generate signed URLs for attachments if present
    const admin = getAdminSupabaseClient();
    const mapped: Message[] = await Promise.all(
      (chronological as unknown as DbMessageRow[]).map(async (row) => {
        let attachmentUrl: string | null = null;
        if (row.attachment_path) {
          const { data: signed } = await admin.storage
            .from('workspace-message-attachments')
            .createSignedUrl(row.attachment_path, 3600);
          attachmentUrl = signed?.signedUrl || null;
        }

        const isDeleted = Boolean(row.deleted_at);

        return {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          senderName: row.profiles?.full_name || 'User',
          senderAvatar: row.profiles?.avatar_url || null,
          content: isDeleted ? 'This message was deleted' : row.content,
          messageType: (row.message_type as MessageType) || 'text',
          attachmentPath: isDeleted ? null : row.attachment_path || null,
          attachmentName: isDeleted ? null : row.attachment_name || null,
          attachmentSize: isDeleted ? null : row.attachment_size || null,
          attachmentType: isDeleted ? null : row.attachment_type || null,
          attachmentUrl: isDeleted ? null : attachmentUrl,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          editedAt: row.edited_at || null,
          deletedAt: row.deleted_at || null,
        };
      })
    );

    const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1].created_at : null;

    return {
      success: true,
      messages: mapped,
      hasMore,
      nextCursor,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to retrieve messages';
    return { success: false, messages: [], hasMore: false, error: msg };
  }
}

/**
 * Send a message in a conversation.
 * Server validates sender identity, conversation membership, content length,
 * and asynchronously notifies other participants.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  try {
    const {
      conversationId,
      content,
      messageType = 'text',
      attachmentPath,
      attachmentName,
      attachmentSize,
      attachmentType,
    } = input;

    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation identifier' };
    }

    const trimmedContent = (content || '').trim();
    if (!trimmedContent && !attachmentPath) {
      return { success: false, error: 'Message cannot be empty' };
    }

    if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
      return {
        success: false,
        error: `Message content exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters`,
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    // Verify membership in conversation
    const { data: myParticipant, error: partError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (partError || !myParticipant) {
      return { success: false, error: 'Unauthorized: you are not a participant in this conversation' };
    }

    // Insert message record into PostgreSQL
    const { data: newRow, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmedContent || (attachmentName ? `Sent ${attachmentName}` : 'Sent an attachment'),
        message_type: messageType,
        attachment_path: attachmentPath || null,
        attachment_name: attachmentName || null,
        attachment_size: attachmentSize || null,
        attachment_type: attachmentType || null,
      })
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        message_type,
        attachment_path,
        attachment_name,
        attachment_size,
        attachment_type,
        created_at,
        updated_at,
        edited_at,
        deleted_at,
        profiles:sender_id ( id, full_name, avatar_url, username )
      `)
      .single();

    if (insertError || !newRow) {
      return { success: false, error: insertError?.message || 'Failed to send message' };
    }

    // Fetch sender profile details
    const typedRow = newRow as unknown as DbMessageRow;
    const senderName = typedRow.profiles?.full_name || 'Participant';

    let attachmentUrl: string | null = null;
    if (typedRow.attachment_path) {
      const admin = getAdminSupabaseClient();
      const { data: signed } = await admin.storage
        .from('workspace-message-attachments')
        .createSignedUrl(typedRow.attachment_path, 3600);
      attachmentUrl = signed?.signedUrl || null;
    }

    const formattedMessage: Message = {
      id: typedRow.id,
      conversationId: typedRow.conversation_id,
      senderId: typedRow.sender_id,
      senderName,
      senderAvatar: typedRow.profiles?.avatar_url || null,
      content: typedRow.content,
      messageType: typedRow.message_type as MessageType,
      attachmentPath: typedRow.attachment_path || null,
      attachmentName: typedRow.attachment_name || null,
      attachmentSize: typedRow.attachment_size || null,
      attachmentType: typedRow.attachment_type || null,
      attachmentUrl,
      createdAt: typedRow.created_at,
      updatedAt: typedRow.updated_at,
      editedAt: typedRow.edited_at || null,
      deletedAt: typedRow.deleted_at || null,
    };

    // Asynchronously notify other conversation participants
    try {
      const { data: recipients } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id);

      if (recipients && recipients.length > 0) {
        const previewText =
          messageType === 'file' || messageType === 'image'
            ? `Sent an attachment: ${attachmentName || 'file'}`
            : trimmedContent.length > 70
            ? trimmedContent.slice(0, 67) + '...'
            : trimmedContent;

        for (const recipient of recipients) {
          await createNotification({
            userId: recipient.user_id,
            type: 'new_message',
            title: `New message from ${senderName}`,
            message: previewText,
            link: `/messages/${conversationId}`,
            metadata: {
              conversationId,
              messageId: formattedMessage.id,
              senderId: user.id,
            },
          });
        }
      }
    } catch (notifErr) {
      // Notification dispatch failure should not block message success
      console.warn('Could not dispatch message notification:', notifErr);
    }

    return {
      success: true,
      message: formattedMessage,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error sending message';
    return { success: false, error: msg };
  }
}

/**
 * Edit an existing message owned by the caller.
 */
export async function editMessage(
  messageId: string,
  newContent: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!UUID_REGEX.test(messageId)) {
      return { success: false, error: 'Invalid message ID' };
    }

    const trimmed = (newContent || '').trim();
    if (!trimmed) {
      return { success: false, error: 'Message content cannot be empty' };
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: `Content exceeds max length of ${MAX_MESSAGE_LENGTH}` };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    // Verify ownership and not deleted
    const { data: existing, error: findError } = await supabase
      .from('messages')
      .select('id, sender_id, deleted_at')
      .eq('id', messageId)
      .single();

    if (findError || !existing) {
      return { success: false, error: 'Message not found' };
    }

    if (existing.sender_id !== user.id) {
      return { success: false, error: 'Unauthorized to edit this message' };
    }

    if (existing.deleted_at) {
      return { success: false, error: 'Cannot edit a deleted message' };
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update({ content: trimmed })
      .eq('id', messageId)
      .eq('sender_id', user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to edit message';
    return { success: false, error: msg };
  }
}

/**
 * Soft delete an existing message owned by the caller.
 */
export async function deleteMessage(
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!UUID_REGEX.test(messageId)) {
      return { success: false, error: 'Invalid message ID' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const { data: existing, error: findError } = await supabase
      .from('messages')
      .select('id, sender_id, deleted_at')
      .eq('id', messageId)
      .single();

    if (findError || !existing) {
      return { success: false, error: 'Message not found' };
    }

    if (existing.sender_id !== user.id) {
      return { success: false, error: 'Unauthorized to delete this message' };
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('sender_id', user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete message';
    return { success: false, error: msg };
  }
}

/**
 * Mark a conversation as read for the authenticated caller.
 */
export async function markConversationAsRead(
  conversationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation ID' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const { error: rpcError } = await supabase.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to mark conversation as read';
    return { success: false, error: msg };
  }
}

/**
 * Get total unread messages count across all conversations for navbar badge.
 */
export async function getUnreadMessageCount(): Promise<{ success: boolean; count: number }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: true, count: 0 };
    }

    // Fetch user's conversation participant records with last_read_at
    const { data: participations, error: partError } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (partError || !participations || participations.length === 0) {
      return { success: true, count: 0 };
    }

    const convIds = participations.map((p) => p.conversation_id);

    // Fetch messages in user's conversations where sender is not user and message is not deleted
    const { data: recentMsgs, error: msgError } = await supabase
      .from('messages')
      .select('conversation_id, created_at')
      .in('conversation_id', convIds)
      .neq('sender_id', user.id)
      .is('deleted_at', null);

    if (msgError || !recentMsgs) {
      return { success: true, count: 0 };
    }

    const readMap = new Map<string, number>();
    for (const p of participations) {
      readMap.set(p.conversation_id, new Date(p.last_read_at).getTime());
    }

    let totalUnread = 0;
    for (const msg of recentMsgs) {
      const lastRead = readMap.get(msg.conversation_id) || 0;
      if (new Date(msg.created_at).getTime() > lastRead) {
        totalUnread++;
      }
    }

    return { success: true, count: totalUnread };
  } catch {
    return { success: true, count: 0 };
  }
}

/**
 * Upload an attachment to private storage bucket `workspace-message-attachments`.
 * Validates file size, file MIME type, and caller's participation in the conversation.
 */
export async function uploadMessageAttachment(
  conversationId: string,
  formData: FormData
): Promise<AttachmentUploadResult> {
  try {
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation identifier' };
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: 'No file was provided in the upload request' };
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      return {
        success: false,
        error: `File size exceeds the 10MB limit (uploaded: ${(file.size / (1024 * 1024)).toFixed(1)}MB)`,
      };
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return {
        success: false,
        error: `File type "${file.type || 'unknown'}" is not supported. Allowed formats: JPG, PNG, WebP, GIF, PDF, DOC, DOCX, TXT`,
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    // Verify user is in conversation
    const { data: myParticipant, error: partError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (partError || !myParticipant) {
      return { success: false, error: 'Unauthorized to upload attachments to this conversation' };
    }

    // Clean filename and construct safe path: <conversationId>/<timestamp>_<sanitizedName>
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${conversationId}/${Date.now()}_${sanitizedName}`;

    const admin = getAdminSupabaseClient();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await admin.storage
      .from('workspace-message-attachments')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Generate signed URL for immediate preview
    const { data: signed } = await admin.storage
      .from('workspace-message-attachments')
      .createSignedUrl(storagePath, 3600);

    return {
      success: true,
      path: storagePath,
      name: file.name,
      size: file.size,
      type: file.type,
      signedUrl: signed?.signedUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error uploading attachment';
    return { success: false, error: msg };
  }
}

/**
 * Generate a short-lived authorized download/preview URL for an attachment.
 * Strictly verifies caller is a participant in the associated conversation.
 */
export async function getAuthorizedAttachmentUrl(
  attachmentPath: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    if (!attachmentPath || !attachmentPath.includes('/')) {
      return { success: false, error: 'Invalid attachment path' };
    }

    const conversationId = attachmentPath.split('/')[0];
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation reference' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    // Verify membership
    const { data: participant } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!participant) {
      return { success: false, error: 'Unauthorized to access this attachment' };
    }

    const admin = getAdminSupabaseClient();
    const { data: signed, error: signError } = await admin.storage
      .from('workspace-message-attachments')
      .createSignedUrl(attachmentPath, 3600);

    if (signError || !signed?.signedUrl) {
      return { success: false, error: signError?.message || 'Failed to generate signed download URL' };
    }

    return { success: true, url: signed.signedUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to retrieve attachment URL';
    return { success: false, error: msg };
  }
}
