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
      <div className="w-full h-[calc(100vh-65px)] bg-white flex overflow-hidden">
        {/* Sidebar Skeleton */}
        <div className="w-full md:w-80 lg:w-96 border-r border-slate-200 flex flex-col shrink-0 bg-white">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-5 w-24 bg-slate-200 rounded-md animate-pulse" />
              <div className="h-6 w-12 bg-slate-100 rounded-full animate-pulse" />
            </div>
            <div className="h-9 bg-slate-100 rounded-xl animate-pulse" />
          </div>
          <div className="p-3 space-y-3 flex-1 overflow-hidden">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl animate-pulse">
                <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="h-3.5 bg-slate-200 rounded-sm w-3/5" />
                  <div className="h-3 bg-slate-100 rounded-sm w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Chat Area Skeleton */}
        <div className="hidden md:flex flex-1 flex-col bg-slate-50/50">
          <div className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-slate-200 rounded-sm animate-pulse" />
                <div className="h-3 w-20 bg-slate-100 rounded-sm animate-pulse" />
              </div>
            </div>
          </div>
          <div className="flex-1 p-6 space-y-4 overflow-hidden">
            <div className="flex items-start gap-3 max-w-md animate-pulse">
              <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0" />
              <div className="h-14 bg-white rounded-2xl rounded-tl-sm w-64 border border-slate-200/60" />
            </div>
            <div className="flex justify-end animate-pulse">
              <div className="h-12 bg-emerald-100/70 rounded-2xl rounded-tr-sm w-56 border border-emerald-200/50" />
            </div>
            <div className="flex items-start gap-3 max-w-md animate-pulse">
              <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0" />
              <div className="h-16 bg-white rounded-2xl rounded-tl-sm w-80 border border-slate-200/60" />
            </div>
          </div>
        </div>
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

