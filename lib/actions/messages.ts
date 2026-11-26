'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/actions/notifications';
import type {
  Message,
  MessageType,
  Conversation,
  ConversationParticipant,
} from '@/lib/types';
import { encodeCursor, parseCursor, UUID_REGEX } from '@/lib/messages-cursor';

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
  before?: string; // cursor (<ISO timestamp>_<UUID> or ISO timestamp)
  after?: string;  // cursor (<ISO timestamp>_<UUID> or ISO timestamp)
}

export interface GetMessagesResult {
  success: boolean;
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string | null;
  error?: string;
}

export interface GetConversationsOptions {
  search?: string;
  limit?: number;
  cursor?: string; // cursor (<ISO timestamp>_<UUID> or ISO timestamp)
}

export interface GetConversationsResult {
  success: boolean;
  conversations: Conversation[];
  hasMore?: boolean;
  nextCursor?: string | null;
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
  contracts?: {
    id: string;
    title: string;
    status: string;
    contract_type?: 'hourly' | 'fixed' | null;
    hourly_rate?: number | null;
    fixed_price?: number | null;
    weekly_hour_limit?: number | null;
  } | null;
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
 * Strictly verifies participant authorization using secured database RPCs.
 * Never allows service-role access to bypass participant authorization.
 */
export async function createOrGetConversation(params: {
  proposalId?: string;
  contractId?: string;
  recipientId?: string;
  title?: string;
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

      // Authoritative database RPC enforcing proposal participant authorization and atomicity
      const { data: convId, error: rpcError } = await supabase.rpc(
        'create_or_get_proposal_conversation',
        { p_proposal_id: params.proposalId }
      );

      if (!rpcError && convId) {
        return { success: true, conversationId: convId as string };
      }

      const errorMsg = rpcError?.message || 'Failed to initialize conversation for proposal';
      return { success: false, error: errorMsg };
    }

    if (params.contractId) {
      if (!UUID_REGEX.test(params.contractId)) {
        return { success: false, error: 'Invalid contract identifier format' };
      }

      // Authoritative database RPC enforcing contract participant authorization and atomicity
      const { data: convId, error: rpcError } = await supabase.rpc(
        'create_or_get_contract_conversation',
        { p_contract_id: params.contractId }
      );

      if (!rpcError && convId) {
        return { success: true, conversationId: convId as string };
      }

      const errorMsg = rpcError?.message || 'Failed to initialize conversation for contract';
      return { success: false, error: errorMsg };
    }

    if (params.recipientId) {
      if (!UUID_REGEX.test(params.recipientId)) {
        return { success: false, error: 'Invalid recipient identifier format' };
      }

      if (params.recipientId === user.id) {
        return { success: false, error: 'Cannot start a conversation with yourself' };
      }

      // Authoritative database RPC enforcing direct inquiry eligibility, deduplication, and atomicity
      const { data: convId, error: rpcError } = await supabase.rpc(
        'create_or_get_direct_conversation',
        {
          p_recipient_id: params.recipientId,
          p_title: params.title || 'Direct Inquiry',
        }
      );

      if (!rpcError && convId) {
        return { success: true, conversationId: convId as string };
      }

      const errorMsg = rpcError?.message || 'Failed to initialize direct conversation';
      return { success: false, error: errorMsg };
    }

    return {
      success: false,
      error: 'Either proposalId, contractId, or recipientId must be specified to initialize a conversation',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create or retrieve conversation';
    return { success: false, error: msg };
  }
}

/**
 * Fetch conversations for the authenticated user with stable cursor pagination,
 * fetching only the latest message per conversation and computing unread counts efficiently.
 */
export async function getConversations(
  options: GetConversationsOptions = {}
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

    const limit = Math.min(Math.max(1, options.limit ?? 50), 100);

    let parsedCursor: { createdAt: string; id?: string } | null = null;
    if (options.cursor) {
      parsedCursor = parseCursor(options.cursor);
      if (!parsedCursor) {
        return { success: false, conversations: [], error: 'Invalid cursor parameter' };
      }
    }

    // 1. Fetch conversations with deterministic ordering and stable pagination
    let convQuery = supabase
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
        contracts:contract_id ( id, title, status, contract_type, hourly_rate, fixed_price, weekly_hour_limit ),
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
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false });

    if (parsedCursor) {
      if (parsedCursor.id) {
        convQuery = convQuery.or(
          `last_message_at.lt.${parsedCursor.createdAt},and(last_message_at.eq.${parsedCursor.createdAt},id.lt.${parsedCursor.id})`
        );
      } else {
        convQuery = convQuery.lt('last_message_at', parsedCursor.createdAt);
      }
    }

    convQuery = convQuery.limit(limit + 1);

    const { data: rawConversations, error: convError } = await convQuery;

    if (convError) {
      return { success: false, conversations: [], error: convError.message };
    }

    if (!rawConversations || rawConversations.length === 0) {
      return { success: true, conversations: [], hasMore: false, nextCursor: null };
    }

    const hasMore = rawConversations.length > limit;
    const slicedConversations = hasMore ? rawConversations.slice(0, limit) : rawConversations;

    const nextCursor =
      hasMore && slicedConversations.length > 0
        ? encodeCursor(
            slicedConversations[slicedConversations.length - 1].last_message_at,
            slicedConversations[slicedConversations.length - 1].id
          )
        : null;

    const conversationIds = slicedConversations.map((c) => c.id);
    const lastMessageAtTimes = Array.from(new Set(slicedConversations.map((c) => c.last_message_at)));

    // 2. Fetch ONLY the latest message required for each conversation in a single bounded batch query
    // Utilizing the composite index on (conversation_id, created_at DESC)
    const { data: latestMessages, error: msgError } = await supabase
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
      .in('created_at', lastMessageAtTimes)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (msgError) {
      return { success: false, conversations: [], error: msgError.message };
    }

    // Map latest message by conversation_id
    const latestMessageMap = new Map<string, Message>();
    if (latestMessages) {
      for (const m of latestMessages) {
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

    // For any conversation whose latest message was not returned at last_message_at (e.g. edge cases where message was edited/deleted)
    const missingConvIds = conversationIds.filter((id) => !latestMessageMap.has(id));
    if (missingConvIds.length > 0) {
      const { data: fallbackLatest } = await supabase
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
        .in('conversation_id', missingConvIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fallbackLatest) {
        for (const m of fallbackLatest) {
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
    }

    // 3. Calculate unread counts efficiently:
    // Only query candidate conversations where last_message_at > myLastReadAt
    const unreadCountMap = new Map<string, number>();
    const unreadCandidateConvs: typeof slicedConversations = [];

    for (const raw of slicedConversations) {
      unreadCountMap.set(raw.id, 0);
      const myParticipant = raw.conversation_participants?.find((p) => p.user_id === user.id);
      const myLastReadAt = myParticipant ? new Date(myParticipant.last_read_at).getTime() : 0;
      const lastMessageTime = new Date(raw.last_message_at).getTime();

      if (lastMessageTime > myLastReadAt) {
        unreadCandidateConvs.push(raw);
      }
    }

    if (unreadCandidateConvs.length > 0) {
      const candidateIds = unreadCandidateConvs.map((c) => c.id);
      let earliestReadTime = Infinity;
      for (const c of unreadCandidateConvs) {
        const myPart = c.conversation_participants?.find((p) => p.user_id === user.id);
        const t = myPart ? new Date(myPart.last_read_at).getTime() : 0;
        if (t < earliestReadTime) earliestReadTime = t;
      }

      const { data: unreadRows, error: unreadError } = await supabase
        .from('messages')
        .select('conversation_id, created_at')
        .in('conversation_id', candidateIds)
        .neq('sender_id', user.id)
        .gt('created_at', new Date(earliestReadTime).toISOString())
        .is('deleted_at', null);

      if (!unreadError && unreadRows) {
        for (const raw of unreadCandidateConvs) {
          const myParticipant = raw.conversation_participants?.find((p) => p.user_id === user.id);
          const myLastReadAt = myParticipant ? new Date(myParticipant.last_read_at).getTime() : 0;
          const count = unreadRows.filter(
            (m) =>
              m.conversation_id === raw.id &&
              new Date(m.created_at).getTime() > myLastReadAt
          ).length;
          unreadCountMap.set(raw.id, count);
        }
      }
    }

    // 4. Map and format conversations
    const mapped: Conversation[] = (slicedConversations as unknown as DbConversationRow[]).map(
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
        const contractType = (raw.contracts?.contract_type as Conversation['contractType']) || null;
        const hourlyRate = raw.contracts?.hourly_rate !== undefined ? Number(raw.contracts.hourly_rate) : null;
        const fixedPrice = raw.contracts?.fixed_price !== undefined ? Number(raw.contracts.fixed_price) : null;
        const weeklyHourLimit = raw.contracts?.weekly_hour_limit !== undefined ? Number(raw.contracts.weekly_hour_limit) : null;

        return {
          id: raw.id,
          createdBy: raw.created_by,
          jobId: raw.job_id || null,
          jobTitle,
          proposalId: raw.proposal_id || null,
          contractId: raw.contract_id || null,
          contractTitle,
          contractStatus,
          contractType,
          hourlyRate,
          fixedPrice,
          weeklyHourLimit,
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

    // Deduplicate duplicate conversations between the same parties for the same job
    const deduplicatedMap = new Map<string, Conversation>();
    for (const c of mapped) {
      const otherId = c.otherParticipant?.userId || c.id;
      const jobKey = c.jobId || c.jobTitle || 'general';
      const key = `${otherId}::${jobKey}`;
      const existing = deduplicatedMap.get(key);
      if (!existing) {
        deduplicatedMap.set(key, c);
      } else {
        // Prefer the one with an active contract, or whichever has the newer message
        if (c.contractId && !existing.contractId) {
          deduplicatedMap.set(key, c);
        } else if (!c.contractId && existing.contractId) {
          // keep existing
        } else if (new Date(c.lastMessageAt).getTime() > new Date(existing.lastMessageAt).getTime()) {
          deduplicatedMap.set(key, c);
        }
      }
    }
    const finalConversations = Array.from(deduplicatedMap.values());

    // Filter by search query if provided
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      const filtered = finalConversations.filter(
        (c) =>
          c.otherParticipant?.fullName.toLowerCase().includes(q) ||
          c.otherParticipant?.username.toLowerCase().includes(q) ||
          c.title?.toLowerCase().includes(q) ||
          c.lastMessage?.content.toLowerCase().includes(q)
      );
      return { success: true, conversations: filtered, hasMore, nextCursor };
    }

    return { success: true, conversations: finalConversations, hasMore, nextCursor };
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
        contracts:contract_id ( id, title, status, contract_type, hourly_rate, fixed_price, weekly_hour_limit ),
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
        contractType: (typedRow.contracts?.contract_type as Conversation['contractType']) || null,
        hourlyRate: typedRow.contracts?.hourly_rate !== undefined ? Number(typedRow.contracts.hourly_rate) : null,
        fixedPrice: typedRow.contracts?.fixed_price !== undefined ? Number(typedRow.contracts.fixed_price) : null,
        weeklyHourLimit: typedRow.contracts?.weekly_hour_limit !== undefined ? Number(typedRow.contracts.weekly_hour_limit) : null,
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
 * Fetch messages for a conversation with deterministic cursor-based pagination.
 * Ensures consistent cursor semantics, handles identical timestamps without skipping,
 * enforces a maximum limit of 100, and generates temporary signed URLs for attachments safely.
 */
export async function getMessages(
  conversationId: string,
  options: GetMessagesOptions = {}
): Promise<GetMessagesResult> {
  const limit = Math.min(Math.max(1, options.limit ?? 40), 100);
  const { before, after } = options;

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
      .eq('conversation_id', conversationId);

    if (after) {
      const parsedAfter = parseCursor(after);
      if (!parsedAfter) {
        return { success: false, messages: [], hasMore: false, error: 'Invalid cursor parameter' };
      }

      if (parsedAfter.createdAt && parsedAfter.id) {
        query = query.or(
          `created_at.gt.${parsedAfter.createdAt},and(created_at.eq.${parsedAfter.createdAt},id.gt.${parsedAfter.id})`
        );
      } else if (parsedAfter.createdAt) {
        query = query.gt('created_at', parsedAfter.createdAt);
      } else if (parsedAfter.id) {
        query = query.gt('id', parsedAfter.id);
      }

      query = query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit + 1);
    } else {
      if (before) {
        const parsedBefore = parseCursor(before);
        if (!parsedBefore) {
          return { success: false, messages: [], hasMore: false, error: 'Invalid cursor parameter' };
        }

        if (parsedBefore.createdAt && parsedBefore.id) {
          query = query.or(
            `created_at.lt.${parsedBefore.createdAt},and(created_at.eq.${parsedBefore.createdAt},id.lt.${parsedBefore.id})`
          );
        } else if (parsedBefore.createdAt) {
          query = query.lt('created_at', parsedBefore.createdAt);
        } else if (parsedBefore.id) {
          query = query.lt('id', parsedBefore.id);
        }
      }

      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
    }

    const { data: rawMessages, error: msgError } = await query;

    if (msgError) {
      return { success: false, messages: [], hasMore: false, error: msgError.message };
    }

    const hasMore = (rawMessages || []).length > limit;
    const sliced = hasMore ? (rawMessages || []).slice(0, limit) : rawMessages || [];

    // Chronological order (oldest to newest)
    const chronological = after ? sliced : sliced.slice().reverse();

    // Collect non-deleted attachment paths for batch signing
    const attachmentPaths = Array.from(
      new Set(
        chronological
          .filter((row) => !row.deleted_at && Boolean(row.attachment_path))
          .map((row) => row.attachment_path as string)
      )
    );

    const signedUrlMap = new Map<string, string>();
    if (attachmentPaths.length > 0) {
      try {
        const admin = getAdminSupabaseClient();
        const { data: signedResults, error: signError } = await admin.storage
          .from('workspace-message-attachments')
          .createSignedUrls(attachmentPaths, 3600);

        if (!signError && Array.isArray(signedResults)) {
          for (const item of signedResults) {
            if (item.signedUrl && item.path) {
              signedUrlMap.set(item.path, item.signedUrl);
            }
          }
        } else if (signError) {
          console.warn('Batch attachment signing notice:', signError.message);
        }
      } catch (storageErr) {
        console.warn('Storage signing exception:', storageErr);
      }
    }

    const mapped: Message[] = (chronological as unknown as DbMessageRow[]).map((row) => {
      const isDeleted = Boolean(row.deleted_at);
      const attachmentUrl = isDeleted || !row.attachment_path ? null : (signedUrlMap.get(row.attachment_path) || null);

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
        attachmentUrl,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        editedAt: row.edited_at || null,
        deletedAt: row.deleted_at || null,
      };
    });

    const nextCursor =
      hasMore && sliced.length > 0
        ? encodeCursor(sliced[sliced.length - 1].created_at, sliced[sliced.length - 1].id)
        : null;

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
 * safely handles attachment signing errors without failing message delivery,
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
      try {
        const admin = getAdminSupabaseClient();
        const { data: signed, error: signError } = await admin.storage
          .from('workspace-message-attachments')
          .createSignedUrl(typedRow.attachment_path, 3600);
        if (!signError && signed?.signedUrl) {
          attachmentUrl = signed.signedUrl;
        } else if (signError) {
          console.warn('Signed URL warning on send:', signError.message);
        }
      } catch (signErr) {
        console.warn('Storage signing exception on send:', signErr);
      }
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
): Promise<{
  success: boolean;
  content?: string;
  editedAt?: string | null;
  updatedAt?: string;
  error?: string;
}> {
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

    const editedAtIso = new Date().toISOString();
    const admin = getAdminSupabaseClient();
    const { data: updated, error: updateError } = await admin
      .from('messages')
      .update({ content: trimmed, edited_at: editedAtIso })
      .eq('id', messageId)
      .eq('sender_id', user.id)
      .select('id, content, edited_at, updated_at')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (!updated) {
      return { success: false, error: 'Message not found or could not be updated' };
    }

    return {
      success: true,
      content: updated.content ?? trimmed,
      editedAt: updated.edited_at ?? editedAtIso,
      updatedAt: updated.updated_at ?? editedAtIso,
    };
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
): Promise<{
  success: boolean;
  deletedAt?: string;
  updatedAt?: string;
  error?: string;
}> {
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

    const deletedAtIso = new Date().toISOString();
    const admin = getAdminSupabaseClient();
    const { data: updated, error: updateError } = await admin
      .from('messages')
      .update({ deleted_at: deletedAtIso })
      .eq('id', messageId)
      .eq('sender_id', user.id)
      .select('id, deleted_at, updated_at')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (!updated) {
      return { success: false, error: 'Message not found or could not be deleted' };
    }

    return {
      success: true,
      deletedAt: updated.deleted_at ?? deletedAtIso,
      updatedAt: updated.updated_at ?? deletedAtIso,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete message';
    return { success: false, error: msg };
  }
}

/**
 * Mark a conversation as read for the authenticated caller.
 * Verifies membership, inspects RPC errors, checks fallback errors,
 * and returns success ONLY after a successful database update.
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

    // Explicitly verify conversation membership first
    const { data: participant, error: partError } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (partError || !participant) {
      return { success: false, error: 'User is not a participant in this conversation' };
    }

    // Call authoritative database RPC
    const { error: rpcError } = await supabase.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
    });

    if (!rpcError) {
      return { success: true };
    }

    // If RPC failed due to authentication/authorization, do not attempt fallback
    if (
      rpcError.code === '42501' ||
      rpcError.message.includes('not a participant') ||
      rpcError.message.includes('Authentication required')
    ) {
      return { success: false, error: rpcError.message };
    }

    // Direct fallback update with user authenticated client (strictly bounded to caller)
    const { data: updated, error: fallbackError } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .select('id');

    if (fallbackError) {
      return { success: false, error: fallbackError.message };
    }

    if (!updated || updated.length === 0) {
      return {
        success: false,
        error: 'Failed to update read receipt: participant record not updated',
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to mark conversation as read';
    return { success: false, error: msg };
  }
}

/**
 * Get total unread messages count across all conversations for navbar badge.
 * Evaluates unread status efficiently without retrieving complete message histories.
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
    let minLastRead = Infinity;
    const readMap = new Map<string, number>();

    for (const p of participations) {
      const t = new Date(p.last_read_at).getTime();
      readMap.set(p.conversation_id, t);
      if (t < minLastRead) minLastRead = t;
    }

    // Fetch only messages in user's conversations created after the earliest last_read_at
    const { data: recentMsgs, error: msgError } = await supabase
      .from('messages')
      .select('conversation_id, created_at')
      .in('conversation_id', convIds)
      .neq('sender_id', user.id)
      .gt('created_at', new Date(minLastRead).toISOString())
      .is('deleted_at', null);

    if (msgError || !recentMsgs) {
      return { success: true, count: 0 };
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
 * Strictly verifies caller is a participant in the associated conversation
 * and ensures that the message has not been deleted.
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

    // Avoid generating signed URLs for deleted messages
    const { data: messageRecord, error: msgErr } = await supabase
      .from('messages')
      .select('id, deleted_at')
      .eq('conversation_id', conversationId)
      .eq('attachment_path', attachmentPath)
      .is('deleted_at', null)
      .maybeSingle();

    if (msgErr || !messageRecord) {
      return { success: false, error: 'Attachment not found or message was deleted' };
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

/**
 * Sends an automated system activity update to the contract's workroom conversation.
 * If no conversation exists for the contract, it initializes one.
 */
export async function sendContractSystemMessage({
  contractId,
  content,
  senderId,
}: {
  contractId: string;
  content: string;
  senderId?: string;
}): Promise<void> {
  if (!contractId || !UUID_REGEX.test(contractId)) return;
  try {
    const admin = getAdminSupabaseClient();
    // 1. Get or create conversation for contract
    const { data: convId, error: rpcError } = await admin.rpc(
      'create_or_get_contract_conversation',
      { p_contract_id: contractId }
    );

    let targetConvId = convId as string | null;
    if (rpcError || !targetConvId) {
      // Fallback: search conversations table directly
      const { data: existingConv } = await admin
        .from('conversations')
        .select('id')
        .eq('contract_id', contractId)
        .maybeSingle();
      targetConvId = existingConv?.id || null;
    }

    if (!targetConvId) return;

    // 2. Resolve a sender_id (contract participant)
    let actualSender = senderId;
    if (!actualSender) {
      const { data: contract } = await admin
        .from('contracts')
        .select('client_id, freelancer_id')
        .eq('id', contractId)
        .maybeSingle();
      actualSender = contract?.client_id || contract?.freelancer_id;
    }

    if (!actualSender) return;

    // 3. Insert system message
    await admin.from('messages').insert({
      conversation_id: targetConvId,
      sender_id: actualSender,
      content,
      message_type: 'system',
    });
  } catch (err) {
    console.warn('sendContractSystemMessage notice:', err);
  }
}

