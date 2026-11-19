'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Message, Conversation, UserPresence, TypingPayload } from '@/lib/types';
import { encodeCursor } from '@/lib/messages-cursor';
import { RealtimeChannel } from '@supabase/supabase-js';

interface UseRealtimeChatProps {
  conversationId: string;
  initialMessages?: Message[];
  conversation?: Conversation;
  currentUserId?: string;
  currentUserName?: string;
  onMessageReceived?: (message: Message) => void;
}

const sortChronological = (a: Message, b: Message) => {
  const tDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (tDiff !== 0) return tDiff;
  return a.id.localeCompare(b.id);
};

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
  const isConnectedRef = useRef<boolean>(false);
  const isRecoveringRef = useRef<boolean>(false);
  const fallbackPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestMessageCursorRef = useRef<string | null>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  // Stable refs for callbacks and metadata to prevent tearing down the WebSocket channel on re-renders
  const onMessageReceivedRef = useRef(onMessageReceived);
  useEffect(() => {
    onMessageReceivedRef.current = onMessageReceived;
  }, [onMessageReceived]);

  const conversationRef = useRef(conversation);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const currentUserNameRef = useRef(currentUserName);
  useEffect(() => {
    currentUserNameRef.current = currentUserName;
  }, [currentUserName]);

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
    setIsTyping(false);
    setTypingUser(null);
  } else if (prevInitialMessages !== initialMessages) {
    setPrevInitialMessages(initialMessages);
    if (initialMessages.length > 0) {
      setMessages((prev) => {
        const initialIds = new Set(initialMessages.map((m) => m.id));
        const newlyAdded = prev.filter((m) => !initialIds.has(m.id));
        if (newlyAdded.length === 0) return initialMessages;
        const merged = [...initialMessages, ...newlyAdded].sort(sortChronological);
        return merged;
      });
    }
  } else if (prevLastRead !== (conversation?.otherParticipant?.lastReadAt || null)) {
    setPrevLastRead(conversation?.otherParticipant?.lastReadAt || null);
    setOtherParticipantLastRead(conversation?.otherParticipant?.lastReadAt || null);
  }

  // Keep latest message cursor ref and processed message IDs updated outside of render
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      latestMessageCursorRef.current = encodeCursor(last.createdAt, last.id);
    } else {
      latestMessageCursorRef.current = null;
    }
    const ids = new Set<string>();
    for (const m of messages) {
      ids.add(m.id);
    }
    processedMessageIdsRef.current = ids;
  }, [messages]);

  // Fetch missed messages using safe cursor pagination (prevents overlapping requests)
  const fetchMissedMessages = useCallback(async () => {
    if (!conversationId || isRecoveringRef.current) return;
    const cursor = latestMessageCursorRef.current;

    isRecoveringRef.current = true;
    try {
      const url = cursor
        ? `/api/messages/${conversationId}?limit=50&after=${encodeURIComponent(cursor)}`
        : `/api/messages/${conversationId}?limit=50`;
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          // Immediately extinguish typing indicator on recovered incoming message
          setIsTyping(false);
          setTypingUser(null);
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
          }

          setMessages((prev) => {
            const existingMap = new Map(prev.map((m) => [m.id, m]));
            let hasNewOrChanged = false;

            for (const m of data.messages as Message[]) {
              processedMessageIdsRef.current.add(m.id);
              const existing = existingMap.get(m.id);
              if (!existing) {
                // Drop any temporary optimistic message that matches this confirmed message
                for (const [key, val] of existingMap.entries()) {
                  if (
                    key.startsWith('temp-') &&
                    (val.senderId === m.senderId || val.senderId === 'me' || val.senderId === currentUserId) &&
                    val.content.trim() === m.content.trim()
                  ) {
                    existingMap.delete(key);
                  }
                }
                existingMap.set(m.id, m);
                hasNewOrChanged = true;
              } else if (existing.content !== m.content || existing.deletedAt !== m.deletedAt) {
                existingMap.set(m.id, m);
                hasNewOrChanged = true;
              }
            }

            if (!hasNewOrChanged) return prev;
            const updated = Array.from(existingMap.values()).sort(sortChronological);
            if (updated.length > 0) {
              const last = updated[updated.length - 1];
              latestMessageCursorRef.current = encodeCursor(last.createdAt, last.id);
            }
            return updated;
          });

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('workspace:unread-messages-refresh'));
          }
        }
      }
    } catch (err) {
      console.warn('Failed to recover missed messages:', err);
    } finally {
      isRecoveringRef.current = false;
    }
  }, [conversationId, currentUserId]);

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

    // Fallback polling helper: only active when disconnected
    const stopFallbackPolling = () => {
      if (fallbackPollTimerRef.current) {
        clearInterval(fallbackPollTimerRef.current);
        fallbackPollTimerRef.current = null;
      }
    };

    const startFallbackPolling = () => {
      if (fallbackPollTimerRef.current) return;
      fallbackPollTimerRef.current = setInterval(() => {
        if (!isConnectedRef.current) {
          fetchMissedMessages();
        }
      }, 6000);
    };

    // 0. Realtime Broadcast: Instant message receipt (<100ms)
    channel.on('broadcast', { event: 'new_message' }, (payload: { payload: Message }) => {
      const newMsg = payload?.payload;
      if (!newMsg || !newMsg.id) return;

      // Cancel typing immediately upon incoming message
      setIsTyping(false);
      setTypingUser(null);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      // Prevent duplicate processing if already processed
      if (processedMessageIdsRef.current.has(newMsg.id)) {
        return;
      }
      processedMessageIdsRef.current.add(newMsg.id);

      latestMessageCursorRef.current = encodeCursor(
        newMsg.createdAt || new Date().toISOString(),
        newMsg.id
      );

      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        const filtered = prev.filter(
          (m) =>
            m.id !== newMsg.id &&
            !(
              m.id.startsWith('temp-') &&
              (m.senderId === newMsg.senderId || m.senderId === 'me' || m.senderId === currentUserId) &&
              m.content.trim() === newMsg.content.trim()
            )
        );
        return [...filtered, newMsg].sort(sortChronological);
      });

      if (onMessageReceivedRef.current) {
        onMessageReceivedRef.current(newMsg);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('workspace:unread-messages-refresh'));
      }
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

        // Cancel typing immediately upon incoming message
        setIsTyping(false);
        setTypingUser(null);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }

        // Prevent duplicate processing
        if (processedMessageIdsRef.current.has(messageId)) {
          return;
        }
        processedMessageIdsRef.current.add(messageId);

        latestMessageCursorRef.current = encodeCursor(
          (row.created_at as string) || new Date().toISOString(),
          messageId
        );

        // Resolve sender profile name
        let senderName = 'Participant';
        let senderAvatar: string | null = null;
        const currentConv = conversationRef.current;
        if (senderId === currentUserId) {
          senderName = currentUserNameRef.current || 'User';
        } else if (currentConv?.otherParticipant?.userId === senderId) {
          senderName = currentConv.otherParticipant.fullName;
          senderAvatar = currentConv.otherParticipant.avatarUrl || null;
        }

        // If attachment present, fetch signed URL
        let attachmentUrl: string | null = null;
        if (row.attachment_path && !row.deleted_at) {
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
          if (prev.some((m) => m.id === newMsg.id)) {
            return prev;
          }

          const filtered = prev.filter(
            (m) =>
              m.id !== newMsg.id &&
              !(
                m.id.startsWith('temp-') &&
                (m.senderId === newMsg.senderId || m.senderId === 'me' || m.senderId === currentUserId) &&
                m.content.trim() === newMsg.content.trim()
              )
          );
          return [...filtered, newMsg].sort(sortChronological);
        });

        if (onMessageReceivedRef.current) {
          onMessageReceivedRef.current(newMsg);
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
      const data = payload?.payload;
      if (!data) return;
      if (
        data.userId === currentUserId ||
        (currentUserNameRef.current && data.userName === currentUserNameRef.current)
      ) {
        return;
      }
      if (data.isTyping) {
        setIsTyping(true);
        setTypingUser(data.userName || 'Participant');

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          setTypingUser(null);
          typingTimeoutRef.current = null;
        }, 2500);
      } else {
        setIsTyping(false);
        setTypingUser(null);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
    });

    // 5. Realtime Presence: Track conversation channel presence
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

    // Global presence event listeners
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

    let isCancelled = false;

    // Ensure Realtime WebSocket connection is authenticated before/during subscribe
    supabase.auth.getSession().then((res: { data: { session: { access_token: string } | null } }) => {
      const token = res?.data?.session?.access_token;
      if (token && !isCancelled) {
        supabase.realtime.setAuth(token);
      }
    });

    // Subscribe and handle all channel lifecycle states: SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED
    channel.subscribe(async (status: string) => {
      if (isCancelled) return;
      if (status === 'SUBSCRIBED') {
        isConnectedRef.current = true;
        setIsConnected(true);
        stopFallbackPolling(); // Connected: Realtime WebSocket is primary message delivery mechanism
        await channel.track({
          userId: currentUserId,
          userName: currentUserNameRef.current || 'User',
          onlineAt: new Date().toISOString(),
        });

        // Immediate recovery after connect or reconnect
        fetchMissedMessages();
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        isConnectedRef.current = false;
        setIsConnected(false);
        // Start fallback recovery polling only when disconnected or recovering
        startFallbackPolling();
      }
    });

    channelRef.current = channel;

    // Window focus and visibility recovery
    const onWindowFocusOrVisible = () => {
      fetchMissedMessages();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onWindowFocusOrVisible();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onWindowFocusOrVisible);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      isCancelled = true;
      stopFallbackPolling();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onWindowFocusOrVisible);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      setIsTyping(false);
      setTypingUser(null);
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
      isConnectedRef.current = false;
      setIsConnected(false);
    };
  }, [conversationId, currentUserId, fetchMissedMessages]);

  // Broadcast a confirmed message instantly over WebSocket to other participants
  const broadcastMessage = useCallback((msg: Message) => {
    if (!channelRef.current) return;
    processedMessageIdsRef.current.add(msg.id);
    channelRef.current.send({
      type: 'broadcast',
      event: 'new_message',
      payload: msg,
    });
  }, []);

  // Send broadcast typing event with debounce
  const sendTypingStatus = useCallback(
    (typing: boolean) => {
      if (!channelRef.current || !currentUserId) return;

      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: currentUserId,
          userName: currentUserNameRef.current || 'User',
          isTyping: typing,
        },
      });
    },
    [currentUserId]
  );

  // Optimistically add an outgoing message before server response
  const addOptimisticMessage = useCallback(
    (msg: Partial<Message>): string => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: currentUserId || 'me',
        senderName: currentUserNameRef.current || 'User',
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
    [conversationId, currentUserId]
  );

  // Replace temporary optimistic message with confirmed server message
  const replaceOptimisticMessage = useCallback((tempId: string, confirmed: Message) => {
    processedMessageIdsRef.current.add(confirmed.id);
    setMessages((prev) => {
      if (prev.some((m) => m.id === confirmed.id)) {
        return prev.filter((m) => m.id !== tempId);
      }
      return prev.map((m) => (m.id === tempId ? confirmed : m));
    });
    latestMessageCursorRef.current = encodeCursor(confirmed.createdAt, confirmed.id);
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
    broadcastMessage,
    addOptimisticMessage,
    replaceOptimisticMessage,
    removeOptimisticMessage,
  };
}
