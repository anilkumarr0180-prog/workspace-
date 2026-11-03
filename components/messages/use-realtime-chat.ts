'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Message, Conversation, UserPresence, TypingPayload } from '@/lib/types';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseRealtimeChatProps {
  conversationId: string;
  initialMessages?: Message[];
  conversation?: Conversation;
  currentUserId?: string;
  currentUserName?: string;
  onMessageReceived?: (message: Message) => void;
}

export function useRealtimeChat({
  conversationId,
  initialMessages = [],
  conversation,
  currentUserId,
  currentUserName = 'User',
  onMessageReceived,
}: UseRealtimeChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [otherParticipantLastRead, setOtherParticipantLastRead] = useState<string | null>(
    conversation?.otherParticipant?.lastReadAt || null
  );

  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestMessageTimestampRef = useRef<string | null>(null);

  // Adjust messages and read state during render when conversationId or initialMessages change
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages);
  const [prevLastRead, setPrevLastRead] = useState(conversation?.otherParticipant?.lastReadAt || null);

  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId);
    setPrevInitialMessages(initialMessages);
    setMessages(initialMessages);
    setPrevLastRead(conversation?.otherParticipant?.lastReadAt || null);
    setOtherParticipantLastRead(conversation?.otherParticipant?.lastReadAt || null);
  } else if (prevInitialMessages !== initialMessages) {
    setPrevInitialMessages(initialMessages);
    if (initialMessages.length > 0) {
      setMessages((prev) => {
        const initialIds = new Set(initialMessages.map((m) => m.id));
        const newlyAdded = prev.filter((m) => !initialIds.has(m.id));
        if (newlyAdded.length === 0) return initialMessages;
        return [...initialMessages, ...newlyAdded].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    }
  } else if (prevLastRead !== (conversation?.otherParticipant?.lastReadAt || null)) {
    setPrevLastRead(conversation?.otherParticipant?.lastReadAt || null);
    setOtherParticipantLastRead(conversation?.otherParticipant?.lastReadAt || null);
  }

  // Keep latest message timestamp ref updated outside of render
  useEffect(() => {
    if (messages.length > 0) {
      latestMessageTimestampRef.current = messages[messages.length - 1].createdAt;
    }
  }, [messages]);

  // Fetch missed messages after reconnect
  const fetchMissedMessages = useCallback(async (sinceTimestamp: string) => {
    try {
      const res = await fetch(
        `/api/messages/${conversationId}?limit=50&after=${encodeURIComponent(sinceTimestamp)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newOnes = data.messages.filter((m: Message) => !existingIds.has(m.id));
            if (newOnes.length === 0) return prev;
            return [...prev, ...newOnes].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        }
      }
    } catch (err) {
      console.warn('Failed to recover missed messages:', err);
    }
  }, [conversationId]);

  // Setup Supabase Realtime channel
  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    const supabase = createClient();
    const channelName = `conversation-${conversationId}`;

    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: currentUserId },
      },
    });

    // 1. Postgres Changes: New message inserted
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      async (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as Record<string, unknown>;
        const messageId = row.id as string;
        const senderId = row.sender_id as string;

        latestMessageTimestampRef.current = (row.created_at as string) || new Date().toISOString();

        // Resolve sender profile name
        let senderName = 'Participant';
        let senderAvatar: string | null = null;
        if (senderId === currentUserId) {
          senderName = currentUserName;
        } else if (conversation?.otherParticipant?.userId === senderId) {
          senderName = conversation.otherParticipant.fullName;
          senderAvatar = conversation.otherParticipant.avatarUrl || null;
        }

        // If attachment present, fetch signed URL
        let attachmentUrl: string | null = null;
        if (row.attachment_path) {
          try {
            const { data: signed } = await supabase.storage
              .from('workspace-message-attachments')
              .createSignedUrl(row.attachment_path as string, 3600);
            attachmentUrl = signed?.signedUrl || null;
          } catch {
            // fallback
          }
        }

        const newMsg: Message = {
          id: messageId,
          conversationId: row.conversation_id as string,
          senderId,
          senderName,
          senderAvatar,
          content: (row.content as string) || '',
          messageType: (row.message_type as Message['messageType']) || 'text',
          attachmentPath: (row.attachment_path as string) || null,
          attachmentName: (row.attachment_name as string) || null,
          attachmentSize: (row.attachment_size as number) || null,
          attachmentType: (row.attachment_type as string) || null,
          attachmentUrl,
          createdAt: (row.created_at as string) || new Date().toISOString(),
          updatedAt: (row.updated_at as string) || new Date().toISOString(),
          editedAt: (row.edited_at as string) || null,
          deletedAt: (row.deleted_at as string) || null,
        };

        setMessages((prev) => {
          // Reconcile optimistic message if id matches or temporary id
          const filtered = prev.filter(
            (m) =>
              m.id !== newMsg.id &&
              !(
                m.id.startsWith('temp-') &&
                m.senderId === newMsg.senderId &&
                m.content === newMsg.content
              )
          );
          return [...filtered, newMsg];
        });

        if (onMessageReceived) {
          onMessageReceived(newMsg);
        }
      }
    );

    // 2. Postgres Changes: Message updated (edited or deleted)
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as Record<string, unknown>;
        const updatedId = row.id as string;
        const isDeleted = Boolean(row.deleted_at);

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === updatedId) {
              return {
                ...msg,
                content: isDeleted ? 'This message was deleted' : (row.content as string),
                editedAt: (row.edited_at as string) || null,
                deletedAt: (row.deleted_at as string) || null,
                attachmentPath: isDeleted ? null : msg.attachmentPath,
                attachmentUrl: isDeleted ? null : msg.attachmentUrl,
              };
            }
            return msg;
          })
        );
      }
    );

    // 3. Postgres Changes: Conversation participants updated (Read receipt sync)
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_participants',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as Record<string, unknown>;
        const participantUserId = row.user_id as string;
        const lastReadAt = row.last_read_at as string;

        if (participantUserId !== currentUserId) {
          setOtherParticipantLastRead(lastReadAt);
        }
      }
    );

    // 4. Realtime Broadcast: Typing indicator
    channel.on('broadcast', { event: 'typing' }, (payload: { payload: TypingPayload }) => {
      const data = payload.payload as TypingPayload;
      if (data.userId !== currentUserId) {
        if (data.isTyping) {
          setIsTyping(true);
          setTypingUser(data.userName || 'Participant');

          // Auto-clear after 3 seconds of inactivity
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            setTypingUser(null);
          }, 3000);
        } else {
          setIsTyping(false);
          setTypingUser(null);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        }
      }
    });

    // 5. Realtime Presence: Track conversation channel presence and global window presence
    const updatePresenceFromState = (state: Record<string, UserPresence[]>) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        for (const key of Object.keys(state)) {
          const presenceList = state[key];
          if (presenceList && presenceList.length > 0) {
            for (const p of presenceList) {
              if (p.userId) next.add(p.userId);
            }
          }
        }
        return next;
      });
    };

    channel.on('presence', { event: 'sync' }, () => {
      updatePresenceFromState(channel.presenceState() as Record<string, UserPresence[]>);
    });

    channel.on('presence', { event: 'join' }, ({ newPresences }: { newPresences: unknown[] }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        for (const p of newPresences as UserPresence[]) {
          if (p.userId) next.add(p.userId);
        }
        return next;
      });
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: unknown[] }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        for (const p of leftPresences as UserPresence[]) {
          if (p.userId) next.delete(p.userId);
        }
        return next;
      });
    });

    // Listen to global presence events dispatched by the application navbar
    const handleGlobalPresenceSync = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (Array.isArray(customEvent.detail)) {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          for (const id of customEvent.detail) {
            if (id) next.add(id);
          }
          return next;
        });
      }
    };

    const handleGlobalPresenceJoin = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (Array.isArray(customEvent.detail)) {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          for (const id of customEvent.detail) {
            if (id) next.add(id);
          }
          return next;
        });
      }
    };

    const handleGlobalPresenceLeave = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (Array.isArray(customEvent.detail)) {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          for (const id of customEvent.detail) {
            if (id) next.delete(id);
          }
          return next;
        });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('workspace:presence-sync', handleGlobalPresenceSync);
      window.addEventListener('workspace:presence-join', handleGlobalPresenceJoin);
      window.addEventListener('workspace:presence-leave', handleGlobalPresenceLeave);
    }

    // Subscribe and track presence on conversation channel
    channel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        await channel.track({
          userId: currentUserId,
          userName: currentUserName,
          onlineAt: new Date().toISOString(),
        });

        // If reconnecting, recover any missed messages
        if (latestMessageTimestampRef.current) {
          fetchMissedMessages(latestMessageTimestampRef.current);
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsConnected(false);
      }
    });

    channelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (channelRef.current) {
        channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('workspace:presence-sync', handleGlobalPresenceSync);
        window.removeEventListener('workspace:presence-join', handleGlobalPresenceJoin);
        window.removeEventListener('workspace:presence-leave', handleGlobalPresenceLeave);
      }
      setIsConnected(false);
    };
  }, [conversationId, currentUserId, currentUserName, conversation, fetchMissedMessages, onMessageReceived]);

  // Send broadcast typing event with debounce
  const sendTypingStatus = useCallback(
    (typing: boolean) => {
      if (!channelRef.current || !currentUserId) return;

      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: currentUserId,
          userName: currentUserName,
          isTyping: typing,
        },
      });
    },
    [currentUserId, currentUserName]
  );

  // Optimistically add an outgoing message before server response
  const addOptimisticMessage = useCallback(
    (msg: Partial<Message>): string => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: currentUserId || 'me',
        senderName: currentUserName,
        senderAvatar: null,
        content: msg.content || '',
        messageType: msg.messageType || 'text',
        attachmentPath: msg.attachmentPath || null,
        attachmentName: msg.attachmentName || null,
        attachmentSize: msg.attachmentSize || null,
        attachmentType: msg.attachmentType || null,
        attachmentUrl: msg.attachmentUrl || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      return tempId;
    },
    [conversationId, currentUserId, currentUserName]
  );

  // Replace temporary optimistic message with confirmed server message
  const replaceOptimisticMessage = useCallback((tempId: string, confirmed: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? confirmed : m)));
    latestMessageTimestampRef.current = confirmed.createdAt;
  }, []);

  // Remove optimistic message on error
  const removeOptimisticMessage = useCallback((tempId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
  }, []);

  // Track users active recently (within last 30 minutes) without triggering cascading renders
  const recentActiveUsersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const active = new Set<string>();
    const nowMs = Date.now();
    for (const msg of messages) {
      if (nowMs - new Date(msg.createdAt).getTime() < 30 * 60 * 1000) {
        active.add(msg.senderId);
      }
    }
    if (conversation?.otherParticipant?.userId && conversation?.lastMessageAt) {
      if (nowMs - new Date(conversation.lastMessageAt).getTime() < 30 * 60 * 1000) {
        active.add(conversation.otherParticipant.userId);
      }
    }
    recentActiveUsersRef.current = active;
  }, [messages, conversation]);

  // Check if a specific user is currently online or recently active
  const isUserOnline = useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return onlineUsers.has(userId) || recentActiveUsersRef.current.has(userId);
    },
    [onlineUsers]
  );

  return {
    messages,
    setMessages,
    isTyping,
    typingUser,
    isConnected,
    isUserOnline,
    otherParticipantLastRead,
    sendTypingStatus,
    addOptimisticMessage,
    replaceOptimisticMessage,
    removeOptimisticMessage,
  };
}
