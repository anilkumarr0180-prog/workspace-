'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Conversation, Message } from '@/lib/types';
import MessagesInbox from './messages-inbox';
import ChatWindow from './chat-window';
import { useRealtimeChat } from './use-realtime-chat';

interface MessagesShellProps {
  initialConversations: Conversation[];
  selectedConversationId?: string;
  initialMessages?: Message[];
  currentUserId: string;
  currentUserName: string;
}

export default function MessagesShell({
  initialConversations,
  selectedConversationId,
  initialMessages: initialMessagesProp = [],
  currentUserId,
  currentUserName,
}: MessagesShellProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    selectedConversationId
  );
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>(
    initialConversations.find((c) => c.id === selectedConversationId)
  );

  const [initialMessages, setInitialMessages] = useState<Message[]>(initialMessagesProp);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(
    Boolean(selectedConversationId && initialMessagesProp.length === 0)
  );
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);

  // Sync active conversation during render when prop changes
  const [prevSelectedId, setPrevSelectedId] = useState(selectedConversationId);
  if (prevSelectedId !== selectedConversationId) {
    setPrevSelectedId(selectedConversationId);
    setActiveConversationId(selectedConversationId);
    if (selectedConversationId) {
      const found = conversations.find((c) => c.id === selectedConversationId);
      if (found) {
        setActiveConversation(found);
      }
      setIsLoadingMessages(initialMessagesProp.length === 0);
    } else {
      setActiveConversation(undefined);
      setInitialMessages([]);
      setIsLoadingMessages(false);
    }
  }

  // Find other conversations with the same participant (e.g. multiple jobs/contracts with Jimmy tenzin)
  const relatedConversations = React.useMemo(() => {
    if (!activeConversation?.otherParticipant?.userId) return [];
    const otherUserId = activeConversation.otherParticipant.userId;
    return conversations.filter(
      (c) => c.otherParticipant?.userId === otherUserId
    );
  }, [conversations, activeConversation]);

  // Fetch messages and mark as read when active conversation changes
  useEffect(() => {
    if (!activeConversationId) return;

    let isCancelled = false;

    async function loadConversationData() {
      try {
        const [messagesRes, readRes] = await Promise.all([
          fetch(`/api/messages/${activeConversationId}?limit=40`),
          fetch(`/api/messages/${activeConversationId}/read`, { method: 'POST' }),
        ]);

        if (messagesRes.ok && !isCancelled) {
          const data = await messagesRes.json();
          if (data.conversation) {
            setActiveConversation(data.conversation);
          }
          if (Array.isArray(data.messages)) {
            setInitialMessages(data.messages);
          }
          setHasMore(Boolean(data.hasMore));
          setNextCursor(data.nextCursor || null);
        }

        // Reset unread count locally for this conversation
        if (readRes.ok && !isCancelled) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConversationId ? { ...c, unreadCount: 0 } : c
            )
          );
        }
      } catch (err) {
        console.warn('Error loading conversation messages:', err);
      } finally {
        if (!isCancelled) {
          setIsLoadingMessages(false);
        }
      }
    }

    loadConversationData();

    return () => {
      isCancelled = true;
    };
  }, [activeConversationId]);

  // Hook for Supabase Realtime channel (Postgres changes, typing, presence)
  const {
    messages,
    isTyping,
    typingUser,
    isUserOnline,
    otherParticipantLastRead,
    sendTypingStatus,
    addOptimisticMessage,
    replaceOptimisticMessage,
    removeOptimisticMessage,
    setMessages,
  } = useRealtimeChat({
    conversationId: activeConversationId || '',
    initialMessages,
    conversation: activeConversation,
    currentUserId,
    currentUserName,
    onMessageReceived: (newMsg) => {
      // If we are currently actively viewing this conversation, mark as read
      if (activeConversationId === newMsg.conversationId) {
        fetch(`/api/messages/${newMsg.conversationId}/read`, { method: 'POST' });
      }

      // Update conversations inbox preview and ordering
      setConversations((prev) => {
        const convIndex = prev.findIndex((c) => c.id === newMsg.conversationId);
        if (convIndex === -1) return prev;

        const target = prev[convIndex];
        const isCurrentActive = activeConversationId === newMsg.conversationId;
        const isFromMe = newMsg.senderId === currentUserId;

        const updated: Conversation = {
          ...target,
          lastMessageAt: newMsg.createdAt,
          lastMessage: newMsg,
          unreadCount: isCurrentActive || isFromMe ? 0 : target.unreadCount + 1,
        };

        const others = prev.filter((_, idx) => idx !== convIndex);
        return [updated, ...others];
      });
    },
  });

  // Handle selecting a conversation
  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId);
      const found = conversations.find((c) => c.id === conversationId);
      if (found) {
        setActiveConversation(found);
      }
      router.push(`/messages/${conversationId}`);
    },
    [conversations, router]
  );

  // Handle returning to inbox list on mobile
  const handleBackToInbox = useCallback(() => {
    setActiveConversationId(undefined);
    setActiveConversation(undefined);
    router.push('/messages');
  }, [router]);

  // Load earlier messages with cursor
  const handleLoadEarlier = useCallback(async () => {
    if (!activeConversationId || !nextCursor || isLoadingEarlier) return;

    setIsLoadingEarlier(true);
    try {
      const res = await fetch(
        `/api/messages/${activeConversationId}?limit=40&before=${encodeURIComponent(nextCursor)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => [...data.messages, ...prev]);
        }
        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.warn('Error loading earlier messages:', err);
    } finally {
      setIsLoadingEarlier(false);
    }
  }, [activeConversationId, nextCursor, isLoadingEarlier, setMessages]);

  // Send message with optimistic update
  const handleSendMessage = useCallback(
    async (
      content: string,
      attachment?: { path: string; name: string; size: number; type: string }
    ) => {
      if (!activeConversationId) return;

      const messageType = attachment
        ? attachment.type.startsWith('image/')
          ? 'image'
          : 'file'
        : 'text';

      // 1. Optimistic Add
      const tempId = addOptimisticMessage({
        content,
        messageType,
        attachmentPath: attachment?.path || null,
        attachmentName: attachment?.name || null,
        attachmentSize: attachment?.size || null,
        attachmentType: attachment?.type || null,
      });

      try {
        const res = await fetch(`/api/messages/${activeConversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            messageType,
            attachmentPath: attachment?.path,
            attachmentName: attachment?.name,
            attachmentSize: attachment?.size,
            attachmentType: attachment?.type,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to send message');
        }

        // 2. Reconcile with server response
        replaceOptimisticMessage(tempId, data.message);

        // 3. Update conversation preview
        setConversations((prev) => {
          const convIndex = prev.findIndex((c) => c.id === activeConversationId);
          if (convIndex === -1) return prev;

          const target = prev[convIndex];
          const updated: Conversation = {
            ...target,
            lastMessageAt: data.message.createdAt,
            lastMessage: data.message,
            unreadCount: 0,
          };
          const others = prev.filter((_, idx) => idx !== convIndex);
          return [updated, ...others];
        });
      } catch (err: unknown) {
        removeOptimisticMessage(tempId);
        throw err;
      }
    },
    [activeConversationId, addOptimisticMessage, replaceOptimisticMessage, removeOptimisticMessage]
  );

  // Edit message
  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (!activeConversationId) return;

      const res = await fetch(`/api/messages/${activeConversationId}/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to edit message');
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: newContent, editedAt: new Date().toISOString() } : m
        )
      );
    },
    [activeConversationId, setMessages]
  );

  // Delete message
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!activeConversationId) return;

      const res = await fetch(`/api/messages/${activeConversationId}/${messageId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete message');
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: 'This message was deleted',
                deletedAt: new Date().toISOString(),
                attachmentPath: null,
                attachmentUrl: null,
              }
            : m
        )
      );
    },
    [activeConversationId, setMessages]
  );

  return (
    <div className="w-full h-[calc(100vh-65px)] bg-slate-100 flex overflow-hidden">
      {/* LEFT PANEL: Conversation Inbox
          On mobile (< md), hide inbox if activeConversationId is present.
          On desktop (>= md), inbox is always visible with fixed 360px-380px width. */}
      <div
        className={`w-full md:w-96 lg:w-[400px] shrink-0 h-full ${
          activeConversationId ? 'hidden md:block' : 'block'
        }`}
      >
        <MessagesInbox
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          isUserOnline={isUserOnline}
        />
      </div>

      {/* RIGHT PANEL: Chat Window
          On mobile (< md), show chat window only if activeConversationId is selected.
          On desktop (>= md), always show chat window (or empty state if none selected). */}
      <div
        className={`flex-1 h-full flex flex-col ${
          !activeConversationId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <ChatWindow
          conversation={activeConversation}
          messages={messages}
          currentUserId={currentUserId}
          isTyping={isTyping}
          typingUser={typingUser}
          isOnline={isUserOnline(activeConversation?.otherParticipant?.userId)}
          otherParticipantLastRead={otherParticipantLastRead}
          onSendMessage={handleSendMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onTyping={sendTypingStatus}
          onBackToInbox={handleBackToInbox}
          hasMore={hasMore}
          onLoadEarlier={handleLoadEarlier}
          isLoadingEarlier={isLoadingEarlier}
          isLoadingMessages={isLoadingMessages}
          relatedConversations={relatedConversations}
          onSelectConversation={handleSelectConversation}
        />
      </div>
    </div>
  );
}
