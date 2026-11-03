'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Conversation } from '@/lib/types';
import MessagesShell from '@/components/messages/messages-shell';

export default function MessagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('User');
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login?redirect=/messages');
        return;
      }

      if (isCancelled) return;
      setUserId(user.id);

      // Fetch user profile name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      if (!isCancelled) {
        setUserName(profile?.full_name || user.user_metadata?.full_name || 'User');
      }

      // Fetch conversations list
      try {
        const res = await fetch('/api/messages');
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (Array.isArray(data.conversations)) {
            setConversations(data.conversations);
          }
        }
      } catch (err) {
        console.warn('Failed to load conversations:', err);
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
  }, [router]);

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
      currentUserId={userId}
      currentUserName={userName}
    />
  );
}

