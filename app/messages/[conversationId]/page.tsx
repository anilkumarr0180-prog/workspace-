'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Conversation, Message } from '@/lib/types';
import MessagesShell from '@/components/messages/messages-shell';

function ConversationContent() {
  const params = useParams();
  const conversationId = params?.conversationId as string;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('User');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [initialConversation, setInitialConversation] = useState<Conversation | undefined>(undefined);

  useEffect(() => {
    if (!conversationId) return;

    let isCancelled = false;
    const supabase = createClient();

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push(`/login?redirect=/messages/${conversationId}`);
        return;
      }

      if (!isCancelled) {
        setUserId(user.id);
        setUserName(user.user_metadata?.full_name || 'User');
      }

      try {
        const [convsRes, msgsRes, profileRes] = await Promise.all([
          fetch('/api/messages'),
          fetch(`/api/messages/${conversationId}?limit=40`),
          supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        ]);

        if (!isCancelled) {
          if (profileRes?.data?.full_name) {
            setUserName(profileRes.data.full_name);
          }

          let currentConv: Conversation | undefined = undefined;
          if (msgsRes.ok) {
            const msgData = await msgsRes.json();
            if (msgData.conversation) {
              currentConv = msgData.conversation;
              setInitialConversation(msgData.conversation);
            }
            if (Array.isArray(msgData.messages)) {
              setInitialMessages(msgData.messages);
            }
          }

          if (convsRes.ok) {
            const convData = await convsRes.json();
            let allConvs: Conversation[] = Array.isArray(convData.conversations) ? convData.conversations : [];
            if (currentConv && !allConvs.some((c) => c.id === currentConv?.id)) {
              allConvs = [currentConv, ...allConvs];
            }
            setConversations(allConvs);
          } else if (currentConv) {
            setConversations([currentConv]);
          }
        }
      } catch (err) {
        console.warn('Failed to load conversation details:', err);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      isCancelled = true;
    };
  }, [conversationId, router]);

  if (loading || !userId) {
    return (
      <div className="w-full h-[calc(100vh-65px)] bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#14a800] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <MessagesShell
      initialConversations={conversations}
      selectedConversationId={conversationId}
      initialMessages={initialMessages}
      initialConversation={initialConversation}
      currentUserId={userId}
      currentUserName={userName}
    />
  );
}

export default function ConversationPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full h-[calc(100vh-65px)] bg-slate-50 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#14a800] border-t-transparent animate-spin" />
        </div>
      }
    >
      <ConversationContent />
    </Suspense>
  );
}


