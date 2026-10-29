'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/lib/actions/notifications';
import { NotificationItem, NotificationType } from '@/lib/types';
import {
  Bell,
  Check,
  CheckCheck,
  Loader2,
  FileText,
  DollarSign,
  Briefcase,
  ExternalLink,
} from 'lucide-react';

interface NotificationPopoverProps {
  userId?: string | null;
  className?: string;
}

function formatTimeAgo(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Recently';
  }
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'milestone_funded':
    case 'milestone_approved':
    case 'payment_processed':
      return <DollarSign className="w-4 h-4 text-emerald-600" />;
    case 'proposal_received':
    case 'proposal_status_updated':
      return <FileText className="w-4 h-4 text-blue-600" />;
    case 'contract_created':
      return <Briefcase className="w-4 h-4 text-purple-600" />;
    default:
      return <Bell className="w-4 h-4 text-[#14a800]" />;
  }
}

export default function NotificationPopover({ userId, className = '' }: NotificationPopoverProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);

  // 1. Fetch initial notifications asynchronously on mount/userId change
  useEffect(() => {
    let isCancelled = false;
    if (!userId) return;

    getNotifications({ limit: 30 })
      .then((res) => {
        if (!isCancelled && res.success) {
          setNotifications(res.notifications);
          setUnreadCount(res.totalUnread);
        }
      })
      .catch(() => {
        // Fallback gracefully
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  // 2. Setup Supabase Realtime Subscription
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const channelName = `realtime-notifications-${userId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const newRow = payload.new as unknown as {
            id: string;
            user_id: string;
            type: string;
            title: string;
            message: string;
            link?: string | null;
            read: boolean;
            read_at?: string | null;
            metadata?: Record<string, unknown> | null;
            created_at: string;
            updated_at: string;
          };

          const newItem: NotificationItem = {
            id: newRow.id,
            userId: newRow.user_id,
            type: newRow.type as NotificationType,
            title: newRow.title,
            message: newRow.message,
            link: newRow.link || null,
            read: newRow.read,
            readAt: newRow.read_at || null,
            metadata: newRow.metadata || {},
            createdAt: newRow.created_at,
            updatedAt: newRow.updated_at,
          };

          setNotifications((prev) => [newItem, ...prev.filter((n) => n.id !== newItem.id)]);
          if (!newItem.read) {
            setUnreadCount((c) => c + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const updatedRow = payload.new as unknown as { id: string; read: boolean };
          setNotifications((prev) =>
            prev.map((item) =>
              item.id === updatedRow.id ? { ...item, read: updatedRow.read } : item
            )
          );
          // Recalculate unread count
          setNotifications((latest) => {
            setUnreadCount(latest.filter((n) => !n.read).length);
            return latest;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // 3. Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 4. Action Handlers
  const handleItemClick = async (item: NotificationItem) => {
    if (!item.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationAsRead(item.id).catch(() => {});
    }

    setIsOpen(false);

    if (item.link && item.link.startsWith('/')) {
      router.push(item.link);
    }
  };

  const handleMarkOneAsRead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await markNotificationAsRead(id);
  };

  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      await markAllNotificationsAsRead();
    } finally {
      setMarkingAll(false);
    }
  };

  const displayedNotifications =
    activeTab === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className={`relative ${className}`} ref={popoverRef}>
      {/* Trigger Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`Notifications (${unreadCount} unread)`}
        title="Notifications"
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors cursor-pointer select-none"
      >
        <Bell className="w-4.5 h-4.5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-[#14a800] text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white shadow-xs animate-in zoom-in-50 duration-200">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          role="region"
          aria-label="Notifications Dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 bg-[#14a800]/10 text-[#14a800] font-semibold text-xs rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={markingAll}
                className="text-xs text-slate-500 hover:text-[#14a800] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
              >
                {markingAll ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5" />
                )}
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center border-b border-slate-100 px-3 text-xs bg-white">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`py-2 px-3 font-medium transition-colors border-b-2 -mb-px cursor-pointer ${
                activeTab === 'all'
                  ? 'border-[#14a800] text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`py-2 px-3 font-medium transition-colors border-b-2 -mb-px cursor-pointer ${
                activeTab === 'unread'
                  ? 'border-[#14a800] text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </button>
          </div>

          {/* List Container */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
            {loading && notifications.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-[#14a800]" />
                <p className="mt-2 text-xs">Loading notifications...</p>
              </div>
            ) : displayedNotifications.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 mb-2">
                  <Check className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-sm font-medium text-slate-800">
                  {activeTab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  We&apos;ll notify you here about proposals, contracts, milestones, and payments.
                </p>
              </div>
            ) : (
              displayedNotifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer group ${
                    item.read ? 'bg-white hover:bg-slate-50' : 'bg-emerald-50/30 hover:bg-emerald-50/60'
                  }`}
                >
                  {/* Icon */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      item.read ? 'bg-slate-100' : 'bg-emerald-100/70'
                    }`}
                  >
                    {getNotificationIcon(item.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`text-xs font-semibold truncate ${
                          item.read ? 'text-slate-800' : 'text-slate-950 font-bold'
                        }`}
                      >
                        {item.title}
                      </p>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatTimeAgo(item.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>

                    {item.link && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-[#14a800] font-medium group-hover:underline">
                        <span>View details</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>

                  {/* Actions (Unread Indicator or Mark Read button) */}
                  {!item.read && (
                    <div className="shrink-0 flex items-center gap-1 self-center">
                      <button
                        type="button"
                        onClick={(e) => handleMarkOneAsRead(e, item.id)}
                        title="Mark as read"
                        className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-white rounded-full transition-colors cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-2 h-2 rounded-full bg-[#14a800]" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
