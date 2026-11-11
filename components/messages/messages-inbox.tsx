'use client';

import React, { useState } from 'react';
import { Conversation } from '@/lib/types';
import {
  Search,
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Briefcase,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';

interface MessagesInboxProps {
  conversations: Conversation[];
  activeConversationId?: string;
  onSelectConversation: (conversationId: string) => void;
  isLoading?: boolean;
  isUserOnline?: (userId?: string | null) => boolean;
}

interface ContactGroup {
  contactKey: string;
  userId?: string;
  fullName: string;
  avatarUrl?: string | null;
  activeMode?: 'client' | 'freelancer';
  online: boolean;
  conversations: Conversation[];
  totalUnreadCount: number;
  lastMessageAt: string;
  latestMessage: Conversation['lastMessage'];
  isCurrentlyActive: boolean;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function MessagesInbox({
  conversations,
  activeConversationId,
  onSelectConversation,
  isLoading = false,
  isUserOnline,
}: MessagesInboxProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'contracts' | 'proposals' | 'unread'>('all');

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    // 1. Tab filter
    if (filterTab === 'contracts' && !c.contractId) return false;
    if (filterTab === 'proposals' && (c.contractId || !c.jobTitle)) return false;
    if (filterTab === 'unread' && c.unreadCount === 0) return false;

    // 2. Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const participantName = c.otherParticipant?.fullName?.toLowerCase() || '';
    const title = c.title?.toLowerCase() || '';
    const jobTitle = c.jobTitle?.toLowerCase() || '';
    const contractTitle = c.contractTitle?.toLowerCase() || '';
    const lastMsg = c.lastMessage?.content?.toLowerCase() || '';
    return (
      participantName.includes(q) ||
      title.includes(q) ||
      jobTitle.includes(q) ||
      contractTitle.includes(q) ||
      lastMsg.includes(q)
    );
  });

  // Group conversations by contact (userId) so the same freelancer/client appears only ONCE
  const contactGroups = React.useMemo(() => {
    const groupMap = new Map<string, ContactGroup>();

    for (const conv of filteredConversations) {
      const other = conv.otherParticipant;
      const key = other?.userId || conv.id;
      const online = isUserOnline ? isUserOnline(other?.userId) : false;

      let group = groupMap.get(key);
      if (!group) {
        group = {
          contactKey: key,
          userId: other?.userId,
          fullName: other?.fullName || 'Participant',
          avatarUrl: other?.avatarUrl,
          activeMode: other?.activeMode,
          online,
          conversations: [],
          totalUnreadCount: 0,
          lastMessageAt: conv.lastMessageAt,
          latestMessage: conv.lastMessage,
          isCurrentlyActive: false,
        };
        groupMap.set(key, group);
      }

      group.conversations.push(conv);
      group.totalUnreadCount += conv.unreadCount || 0;

      if (conv.id === activeConversationId) {
        group.isCurrentlyActive = true;
      }

      // Track newest message timestamp across all conversations in this group
      if (new Date(conv.lastMessageAt).getTime() > new Date(group.lastMessageAt).getTime()) {
        group.lastMessageAt = conv.lastMessageAt;
        group.latestMessage = conv.lastMessage;
      }
    }

    // Sort conversations inside each group: active contract first, then newest message
    for (const group of groupMap.values()) {
      group.conversations.sort((a, b) => {
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });
    }

    // Sort groups by latest message timestamp descending
    return Array.from(groupMap.values()).sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  }, [filteredConversations, isUserOnline, activeConversationId]);

  // Counts for filter pills
  const totalCount = conversations.length;
  const contractsCount = conversations.filter((c) => Boolean(c.contractId)).length;
  const proposalsCount = conversations.filter((c) => !c.contractId && Boolean(c.jobTitle)).length;
  const unreadCount = conversations.filter((c) => c.unreadCount > 0).length;

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* 1. Header & Search */}
      <div className="p-4 border-b border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 id="messages-inbox-header" className="text-xl font-bold text-slate-900 tracking-tight">
              Messages
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {contactGroups.length}
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="inbox-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages or people..."
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 transition-all shadow-2xs"
          />
        </div>
      </div>

      {/* 2. Quick Filter Tabs */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 overflow-x-auto no-scrollbar bg-slate-50/50">
        {[
          { id: 'all', label: 'All', count: totalCount },
          { id: 'contracts', label: 'Contracts', count: contractsCount },
          { id: 'proposals', label: 'Proposals', count: proposalsCount },
          { id: 'unread', label: 'Unread', count: unreadCount },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterTab(tab.id as typeof filterTab)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
              filterTab === tab.id
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/70'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.1 rounded-full font-bold ${
                  filterTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 3. Grouped Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100" role="list">
        {isLoading ? (
          // Loading Skeletons
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-200 rounded-sm w-3/4" />
                  <div className="h-3 bg-slate-100 rounded-sm w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : contactGroups.length === 0 ? (
          // Empty State
          <div className="p-8 text-center space-y-3 my-auto">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {searchQuery || filterTab !== 'all' ? 'No matching conversations' : 'No messages yet'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {searchQuery || filterTab !== 'all'
                  ? 'Try selecting a different filter or search term.'
                  : 'Submit a proposal on a job posting or accept an offer to start communicating.'}
              </p>
            </div>
          </div>
        ) : (
          contactGroups.map((group) => {
            const hasMultiple = group.conversations.length > 1;
            const primaryConv = group.conversations[0];
            const isGroupActive = group.isCurrentlyActive;
            const lastMsg = group.latestMessage;
            const hasUnread = group.totalUnreadCount > 0;

            const initials =
              group.fullName
                ?.split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((n) => n[0].toUpperCase())
                .join('') || 'U';

            return (
              <div
                key={group.contactKey}
                className={`transition-colors ${
                  isGroupActive
                    ? 'bg-emerald-50/50 border-l-4 border-l-emerald-600'
                    : 'hover:bg-slate-50/80 border-l-4 border-l-transparent'
                }`}
              >
                {/* Main Card Header (Clickable) */}
                <button
                  type="button"
                  id={`conversation-item-${primaryConv.id}`}
                  onClick={() => {
                    // If one of the conversations in this group is already active, stay on it.
                    // Otherwise open the newest conversation in this group.
                    const activeInGroup = group.conversations.find((c) => c.id === activeConversationId);
                    onSelectConversation(activeInGroup ? activeInGroup.id : primaryConv.id);
                  }}
                  className="w-full text-left p-3.5 flex items-start gap-3 cursor-pointer"
                >
                  {/* Avatar with Online Ring */}
                  <div className="relative shrink-0">
                    {group.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={group.avatarUrl}
                        alt={group.fullName}
                        className="w-11 h-11 rounded-full object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xs shadow-2xs">
                        {initials}
                      </div>
                    )}
                    {group.online && (
                      <span
                        title="Online"
                        className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-500/20"
                      />
                    )}
                  </div>

                  {/* Contact Summary */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-sm truncate ${
                            hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'
                          }`}
                        >
                          {group.fullName}
                        </span>

                        {group.activeMode && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 shrink-0">
                            {group.activeMode}
                          </span>
                        )}

                        {/* Multi-Project Count Badge */}
                        {hasMultiple && (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/80 border border-emerald-300/60 px-1.5 py-0.2 rounded-full shrink-0">
                            {group.conversations.length} Projects
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-slate-400 shrink-0 font-normal">
                        {formatRelativeTime(group.lastMessageAt)}
                      </span>
                    </div>

                    {/* Single conversation project badge */}
                    {!hasMultiple && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {primaryConv.contractId ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60 truncate max-w-full">
                            <ShieldCheck className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{primaryConv.contractTitle || 'Contract'}</span>
                            <span className="text-[9px] text-emerald-600/90 font-mono shrink-0">
                              #{primaryConv.contractId.slice(0, 4)}
                            </span>
                          </span>
                        ) : primaryConv.jobTitle ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60 truncate max-w-full">
                            <Briefcase className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                            <span className="truncate">{primaryConv.jobTitle}</span>
                          </span>
                        ) : null}
                      </div>
                    )}

                    {/* Message Snippet */}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p
                        className={`text-xs truncate ${
                          hasUnread ? 'font-medium text-slate-900' : 'text-slate-500'
                        }`}
                      >
                        {lastMsg ? (
                          lastMsg.deletedAt ? (
                            <span className="italic text-slate-400">Message was deleted</span>
                          ) : lastMsg.messageType === 'image' ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon className="w-3 h-3 text-slate-400" />
                              <span>Photo</span>
                            </span>
                          ) : lastMsg.messageType === 'file' ? (
                            <span className="inline-flex items-center gap-1">
                              <FileText className="w-3 h-3 text-slate-400" />
                              <span>{lastMsg.attachmentName || 'Document'}</span>
                            </span>
                          ) : (
                            lastMsg.content
                          )
                        ) : (
                          <span className="italic text-slate-400">No messages yet</span>
                        )}
                      </p>

                      {/* Total Unread Badge */}
                      {hasUnread && (
                        <span
                          id={`unread-badge-${primaryConv.id}`}
                          className="min-w-4.5 h-4.5 px-1 bg-[#14a800] text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0 shadow-xs"
                        >
                          {group.totalUnreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Multi-Project Workroom Sub-List (Clean Upwork-Style Nested Rooms) */}
                {hasMultiple && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="p-2 rounded-xl bg-slate-50/80 border border-slate-200/70 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between px-1">
                        <span>Workrooms with {group.fullName.split(' ')[0]}</span>
                        <span className="text-[9px] text-slate-400 font-normal">Select active room</span>
                      </div>

                      <div className="space-y-1">
                        {group.conversations.map((c) => {
                          const isSelected = c.id === activeConversationId;
                          const label = c.contractTitle || c.jobTitle || 'General Discussion';
                          const shortTag = c.contractId ? `#${c.contractId.slice(0, 4)}` : `#${c.id.slice(0, 4)}`;

                          return (
                            <button
                              key={c.id}
                              type="button"
                              id={`conversation-item-${c.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectConversation(c.id);
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center justify-between gap-2 cursor-pointer ${
                                isSelected
                                  ? 'bg-[#14a800] text-white shadow-2xs font-semibold'
                                  : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/60 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {c.contractId ? (
                                  <ShieldCheck
                                    className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-emerald-600'}`}
                                  />
                                ) : (
                                  <Briefcase
                                    className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-slate-500'}`}
                                  />
                                )}
                                <span className="truncate">{label}</span>
                                <span
                                  className={`text-[10px] font-mono shrink-0 ${
                                    isSelected ? 'text-emerald-100' : 'text-slate-400'
                                  }`}
                                >
                                  {shortTag}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {c.unreadCount > 0 && (
                                  <span className="min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                    {c.unreadCount}
                                  </span>
                                )}
                                <ChevronRight
                                  className={`w-3 h-3 ${isSelected ? 'text-white' : 'text-slate-400'}`}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
