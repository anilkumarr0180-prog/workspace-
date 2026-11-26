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

      // If a conversation for the same job already exists in this group, coalesce it
      const existingConvIndex = group.conversations.findIndex(
        (existing) =>
          (conv.jobId && existing.jobId === conv.jobId) ||
          (conv.jobTitle && existing.jobTitle === conv.jobTitle)
      );

      if (existingConvIndex !== -1) {
        const existing = group.conversations[existingConvIndex];
        if (conv.contractId && !existing.contractId) {
          group.conversations[existingConvIndex] = conv;
        } else if (new Date(conv.lastMessageAt).getTime() > new Date(existing.lastMessageAt).getTime()) {
          group.conversations[existingConvIndex] = conv;
        }
      } else {
        group.conversations.push(conv);
      }
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
    <div className="flex flex-col h-full bg-white border-r border-[#e4ebe4]">
      {/* 1. Header & Search */}
      <div className="px-4 pt-5 pb-3 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 id="messages-inbox-header" className="text-[22px] font-medium text-[#001e00] tracking-tight">
              Messages
            </h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#f2f7f2] text-[#5e6d55]">
              {contactGroups.length}
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#5e6d55] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="inbox-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full h-9 pl-9 pr-3 rounded-full border border-[#d5e0d5] bg-white text-[13px] text-[#001e00] placeholder:text-[#5e6d55] focus:outline-hidden focus:border-[#108a00] focus:ring-1 focus:ring-[#108a00] transition-all"
          />
        </div>
      </div>

      {/* 2. Quick Filter Tabs */}
      <div className="flex items-center gap-1.5 px-4 pb-2.5 border-b border-[#e4ebe4] overflow-x-auto no-scrollbar">
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
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
              filterTab === tab.id
                ? 'bg-[#108a00] text-white'
                : 'bg-[#f2f7f2] text-[#001e00] hover:bg-[#e4ebe4]'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.1 rounded-full font-semibold ${
                  filterTab === tab.id ? 'bg-white/20 text-white' : 'bg-white text-[#5e6d55]'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 3. Grouped Conversation List */}
      <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5" role="list">
        {isLoading ? (
          // Loading Skeletons
          <div className="p-3 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[#e4ebe4] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-[#e4ebe4] rounded-sm w-3/4" />
                  <div className="h-3 bg-[#f2f7f2] rounded-sm w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : contactGroups.length === 0 ? (
          // Empty State
          <div className="p-8 text-center space-y-3 my-auto">
            <div className="w-12 h-12 rounded-full bg-[#f2f7f2] text-[#5e6d55] flex items-center justify-center mx-auto">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#001e00]">
                {searchQuery || filterTab !== 'all' ? 'No matching conversations' : 'No messages yet'}
              </h2>
              <p className="text-xs text-[#5e6d55] mt-1 max-w-xs mx-auto">
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
                className={`rounded-lg transition-colors ${
                  isGroupActive
                    ? 'bg-[#108a00] text-white'
                    : 'hover:bg-[#f2f7f2] text-[#001e00]'
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
                  className="w-full text-left px-3 py-2.5 flex items-start gap-3 cursor-pointer"
                >
                  {/* Avatar with Online Ring */}
                  <div className="relative shrink-0 mt-0.5">
                    {group.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={group.avatarUrl}
                        alt={group.fullName}
                        className={`w-10 h-10 rounded-full object-cover border ${
                          isGroupActive ? 'border-white/30' : 'border-[#e4ebe4]'
                        }`}
                      />
                    ) : (
                      <div
                        className={`w-10 h-10 rounded-full font-semibold flex items-center justify-center text-xs ${
                          isGroupActive
                            ? 'bg-white/20 text-white'
                            : 'bg-[#677d5c] text-white'
                        }`}
                      >
                        {initials}
                      </div>
                    )}
                    {group.online && (
                      <span
                        title="Online"
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#14a800] border-2 ${
                          isGroupActive ? 'border-[#108a00]' : 'border-white'
                        }`}
                      />
                    )}
                  </div>

                  {/* Contact Summary */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-[13.5px] truncate ${
                            isGroupActive
                              ? 'font-semibold text-white'
                              : hasUnread
                              ? 'font-bold text-[#001e00]'
                              : 'font-semibold text-[#001e00]'
                          }`}
                        >
                          {group.fullName}
                        </span>

                        {group.activeMode && (
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded shrink-0 ${
                              isGroupActive
                                ? 'bg-white/20 text-white'
                                : 'bg-[#f2f7f2] text-[#5e6d55]'
                            }`}
                          >
                            {group.activeMode}
                          </span>
                        )}

                        {/* Multi-Project Count Badge */}
                        {hasMultiple && (
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded-full shrink-0 ${
                              isGroupActive
                                ? 'bg-white/20 text-white'
                                : 'text-[#108a00] bg-[#e9f5e8]'
                            }`}
                          >
                            {group.conversations.length} Projects
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[11px] shrink-0 font-normal ${
                          isGroupActive ? 'text-white/90' : 'text-[#5e6d55]'
                        }`}
                      >
                        {formatRelativeTime(group.lastMessageAt)}
                      </span>
                    </div>

                    {/* Workroom Project Badge */}
                    {(primaryConv.contractId || primaryConv.jobTitle) && (
                      <div className="flex items-center gap-1 mt-0.5 min-w-0">
                        {primaryConv.contractId ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[11.5px] font-medium truncate max-w-full ${
                              isGroupActive ? 'text-white/95' : 'text-[#5e6d55]'
                            }`}
                          >
                            <ShieldCheck
                              className={`w-3 h-3 shrink-0 ${
                                isGroupActive ? 'text-white' : 'text-[#108a00]'
                              }`}
                            />
                            <span className="truncate">
                              {primaryConv.contractTitle || primaryConv.jobTitle || 'Active Contract'}
                            </span>
                          </span>
                        ) : primaryConv.jobTitle ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[11.5px] font-normal truncate max-w-full ${
                              isGroupActive ? 'text-white/95' : 'text-[#5e6d55]'
                            }`}
                          >
                            <Briefcase
                              className={`w-3 h-3 shrink-0 ${
                                isGroupActive ? 'text-white/85' : 'text-[#5e6d55]'
                              }`}
                            />
                            <span className="truncate">{primaryConv.jobTitle}</span>
                          </span>
                        ) : null}
                      </div>
                    )}

                    {/* Message Snippet */}
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-[12px] truncate ${
                          isGroupActive
                            ? 'text-white/90'
                            : hasUnread
                            ? 'font-semibold text-[#001e00]'
                            : 'text-[#5e6d55]'
                        }`}
                      >
                        {lastMsg ? (
                          lastMsg.deletedAt ? (
                            <span className={`italic ${isGroupActive ? 'text-white/75' : 'text-[#9aaa97]'}`}>
                              Message was deleted
                            </span>
                          ) : lastMsg.messageType === 'image' ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon className={`w-3 h-3 ${isGroupActive ? 'text-white/80' : 'text-[#5e6d55]'}`} />
                              <span>Photo</span>
                            </span>
                          ) : lastMsg.messageType === 'file' ? (
                            <span className="inline-flex items-center gap-1">
                              <FileText className={`w-3 h-3 ${isGroupActive ? 'text-white/80' : 'text-[#5e6d55]'}`} />
                              <span>{lastMsg.attachmentName || 'Document'}</span>
                            </span>
                          ) : (
                            lastMsg.content
                          )
                        ) : (
                          <span className={`italic ${isGroupActive ? 'text-white/75' : 'text-[#9aaa97]'}`}>
                            No messages yet
                          </span>
                        )}
                      </p>

                      {/* Total Unread Badge */}
                      {hasUnread && (
                        <span
                          id={`unread-badge-${primaryConv.id}`}
                          className={`min-w-4.5 h-4.5 px-1 text-[10px] font-bold rounded-full flex items-center justify-center shrink-0 ${
                            isGroupActive
                              ? 'bg-white text-[#108a00]'
                              : 'bg-[#108a00] text-white'
                          }`}
                        >
                          {group.totalUnreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
