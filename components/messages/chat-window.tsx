'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Message,
  Conversation,
} from '@/lib/types';
import {
  Send,
  Paperclip,
  Check,
  CheckCheck,
  MoreVertical,
  Edit2,
  Trash2,
  X,
  FileText,
  Download,
  AlertCircle,
  ArrowLeft,
  Briefcase,
  ShieldCheck,
  ExternalLink,
  Loader2,
} from 'lucide-react';

interface ChatWindowProps {
  conversation?: Conversation;
  messages: Message[];
  currentUserId?: string;
  isTyping?: boolean;
  typingUser?: string | null;
  isOnline?: boolean;
  otherParticipantLastRead?: string | null;
  onSendMessage: (content: string, attachment?: { path: string; name: string; size: number; type: string }) => Promise<void>;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onBackToInbox?: () => void;
  hasMore?: boolean;
  onLoadEarlier?: () => void;
  isLoadingEarlier?: boolean;
  isLoadingMessages?: boolean;
  relatedConversations?: Conversation[];
  onSelectConversation?: (conversationId: string) => void;
}

function formatMessageTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDateDivider(dateString: string): string {
  try {
    const d = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatWindow({
  conversation,
  messages,
  currentUserId,
  isTyping = false,
  typingUser,
  isOnline = false,
  otherParticipantLastRead,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onTyping,
  onBackToInbox,
  hasMore = false,
  onLoadEarlier,
  isLoadingEarlier = false,
  isLoadingMessages = false,
  relatedConversations = [],
  onSelectConversation,
}: ChatWindowProps) {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Attachment upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Edit message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [activeMenuMessageId, setActiveMenuMessageId] = useState<string | null>(null);

  // Image preview modal
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userScrolledUpRef = useRef<boolean>(false);

  // Auto-scroll logic
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Monitor user scroll position to avoid forcing auto-scroll when user is reading past messages
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // User is near bottom if within 120px
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
    userScrolledUpRef.current = !isNearBottom;
  };

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom(false);
    }
  }, [messages.length, scrollToBottom]);

  // Handle typing debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    setErrorMessage(null);

    onTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      onTyping(false);
    }, 2000);
  };

  // Handle key press (Enter sends, Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle attachment selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('Attachment size exceeds the 10MB limit.');
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle sending a message
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text && !selectedFile) return;
    if (isSubmitting || isUploadingAttachment) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    // Stop typing broadcast
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    onTyping(false);

    try {
      let uploadedAttachment:
        | { path: string; name: string; size: number; type: string }
        | undefined = undefined;

      if (selectedFile && conversation) {
        setIsUploadingAttachment(true);
        const formData = new FormData();
        formData.append('file', selectedFile);

        const uploadRes = await fetch(`/api/messages/${conversation.id}/attachments`, {
          method: 'POST',
          body: formData,
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.success) {
          throw new Error(uploadData.error || 'Failed to upload attachment');
        }

        uploadedAttachment = {
          path: uploadData.path,
          name: uploadData.name,
          size: uploadData.size,
          type: uploadData.type,
        };
      }

      await onSendMessage(text, uploadedAttachment);
      setInputText('');
      removeSelectedFile();
      userScrolledUpRef.current = false;
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
      setIsUploadingAttachment(false);
    }
  };

  // Handle message edit save
  const handleSaveEdit = async (messageId: string) => {
    if (!editContent.trim()) return;
    try {
      await onEditMessage(messageId, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error updating message');
    }
  };

  // Handle message delete
  const handleDelete = async (messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return;
    try {
      await onDeleteMessage(messageId);
      setActiveMenuMessageId(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error deleting message');
    }
  };

  // If no conversation is active
  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-[#14a800] flex items-center justify-center mb-4">
          <Send className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-slate-800">Your Messages</h2>
        <p className="text-xs text-slate-500 max-w-sm mt-1">
          Select a conversation from the list to view project discussions, proposal interviews, and contract deliverables.
        </p>
      </div>
    );
  }

  const other = conversation.otherParticipant;
  const initials =
    other?.fullName
      ?.split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'U';

  const otherReadTime = otherParticipantLastRead
    ? new Date(otherParticipantLastRead).getTime()
    : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
      {/* 1. Unified Master Workroom Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-slate-200/90 flex items-center justify-between bg-white shrink-0 z-10 shadow-2xs">
        <div className="flex items-center gap-3.5 min-w-0">
          {/* Mobile Back Button */}
          {onBackToInbox && (
            <Link
              href="/messages"
              id="back-to-inbox-button"
              onClick={onBackToInbox}
              className="md:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer flex items-center justify-center"
              title="Back to conversations"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
          )}

          {/* User Avatar with Status Ring */}
          <div className="relative shrink-0">
            {other?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={other.avatarUrl}
                alt={other.fullName}
                className="w-10 sm:w-11 h-10 sm:h-11 rounded-full object-cover border border-slate-200 ring-2 ring-slate-100"
              />
            ) : (
              <div className="w-10 sm:w-11 h-10 sm:h-11 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xs shadow-2xs">
                {initials}
              </div>
            )}
            {isOnline && (
              <span
                title="Online"
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-500/20"
              />
            )}
          </div>

          {/* User Details & Active Workroom Context */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="chat-participant-name" className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {other?.fullName || 'Participant'}
              </h2>
              {other?.activeMode && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {other.activeMode}
                </span>
              )}
              {isOnline ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active now
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">Offline</span>
              )}
            </div>

            {/* Current Active Room Subtitle */}
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              {conversation.contractId ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 truncate max-w-[280px]">
                  <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="truncate">{conversation.contractTitle || 'Active Contract'}</span>
                  <span className="text-[10px] text-emerald-600 font-mono">#{conversation.contractId.slice(0, 4)}</span>
                </span>
              ) : conversation.jobTitle ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60 truncate max-w-[280px]">
                  <Briefcase className="w-3 h-3 text-slate-500 shrink-0" />
                  <span className="truncate">{conversation.jobTitle}</span>
                </span>
              ) : (
                <span className="truncate">{other?.title || 'Marketplace Member'}</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons Cluster */}
        <div className="shrink-0 flex items-center gap-2">
          {conversation.contractId && (
            <Link
              href={`/contracts/${conversation.contractId}`}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50/50 shadow-2xs transition-all"
            >
              <span>Milestones & Escrow</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </Link>
          )}

          {conversation.contractId ? (
            <Link
              href={`/contracts/${conversation.contractId}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-[#14a800] hover:bg-[#108a00] text-white shadow-2xs hover:shadow-xs transition-all cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>View Contract</span>
            </Link>
          ) : conversation.jobId ? (
            <Link
              href={`/jobs/${conversation.jobId}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-2xs hover:shadow-xs transition-all cursor-pointer"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>View Job</span>
            </Link>
          ) : null}
        </div>
      </div>

      {/* 1.1 Multi-Project Workroom Switcher (when client and freelancer have multiple jobs/contracts) */}
      {relatedConversations && relatedConversations.length > 1 && (
        <div className="px-4 sm:px-6 py-2 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between gap-3 overflow-x-auto shrink-0 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
              Workrooms ({relatedConversations.length}):
            </span>
            <div className="flex items-center gap-1.5">
              {relatedConversations.map((rel) => {
                const isCurrent = rel.id === conversation.id;
                const label = rel.contractTitle || rel.jobTitle || 'Project';
                const suffix = rel.contractId ? ` #${rel.contractId.slice(0, 4)}` : '';
                return (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => onSelectConversation?.(rel.id)}
                    className={`px-3 py-1 rounded-lg text-xs shrink-0 transition-all cursor-pointer flex items-center gap-1.5 ${
                      isCurrent
                        ? 'bg-slate-900 text-white shadow-2xs font-semibold'
                        : 'bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 font-medium shadow-2xs'
                    }`}
                  >
                    {rel.contractId ? (
                      <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-emerald-400' : 'text-emerald-600'}`} />
                    ) : (
                      <Briefcase className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-slate-300' : 'text-slate-500'}`} />
                    )}
                    <span className="max-w-[160px] truncate">{label}</span>
                    {suffix && (
                      <span className={`text-[10px] font-mono ${isCurrent ? 'text-slate-300' : 'text-slate-400'}`}>
                        {suffix}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {conversation.contractId && (
            <span className="text-[11px] font-medium text-slate-500 hidden sm:inline-flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Escrow Protected
            </span>
          )}
        </div>
      )}

      {/* 2. Messages Scroll Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50"
      >
        {/* Project Workroom Anchor Card */}
        {(conversation.contractTitle || conversation.jobTitle) && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {conversation.contractTitle || conversation.jobTitle}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {conversation.contractId
                      ? `Contract #${conversation.contractId.slice(0, 8)} • Workspace Escrow Secured`
                      : 'Proposal Communication Room'}
                  </p>
                </div>
              </div>
              {conversation.contractId && (
                <Link
                  href={`/contracts/${conversation.contractId}`}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                >
                  <span>Milestones</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
              Welcome to your dedicated project workroom. Messages, files, and deliverables shared in this thread are securely tracked for contract milestones and dispute protection.
            </p>
          </div>
        )}
        {/* Load earlier messages trigger */}
        {hasMore && (
          <div className="text-center pt-1 pb-3">
            <button
              type="button"
              id="load-earlier-messages-btn"
              onClick={onLoadEarlier}
              disabled={isLoadingEarlier}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              {isLoadingEarlier ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  <span>Loading history...</span>
                </>
              ) : (
                <span>Load earlier messages</span>
              )}
            </button>
          </div>
        )}

        {isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <Loader2 className="w-7 h-7 text-[#14a800] animate-spin" />
            <p className="text-xs font-medium text-slate-500">Loading conversation messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <Send className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Start the conversation</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Send a greeting, ask clarifying questions about project milestones, or share relevant documents.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.senderId === currentUserId;
            const isDeleted = Boolean(msg.deletedAt);
            const isOptimistic = msg.id.startsWith('temp-');

            // Determine if date divider should be displayed
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showDateDivider =
              !prevMsg ||
              new Date(prevMsg.createdAt).toDateString() !==
                new Date(msg.createdAt).toDateString();

            // Read state: if message was sent by me and created before other participant's last read timestamp
            const isRead =
              isMe &&
              !isOptimistic &&
              otherReadTime >= new Date(msg.createdAt).getTime();

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center justify-center my-4">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-white/90 backdrop-blur-xs px-3 py-1 rounded-full border border-slate-200/60 shadow-2xs">
                      {formatDateDivider(msg.createdAt)}
                    </span>
                  </div>
                )}

                <div
                  id={`message-item-${msg.id}`}
                  className={`flex flex-col group relative ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`flex items-end gap-2 max-w-[85%] sm:max-w-[70%] ${
                      isMe ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Message Bubble Container */}
                    <div
                      className={`relative rounded-2xl px-4 py-2.5 shadow-2xs transition-all ${
                        isMe
                          ? 'bg-[#14a800] text-white rounded-br-xs'
                          : 'bg-white text-slate-900 border border-slate-200/80 rounded-bl-xs'
                      } ${isDeleted ? 'italic text-slate-400 bg-slate-100 border-slate-200' : ''}`}
                    >
                      {/* Deleted Message Notice */}
                      {isDeleted ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>This message was deleted</span>
                        </div>
                      ) : (
                        <>
                          {/* Image Attachment Rendering */}
                          {msg.messageType === 'image' && msg.attachmentUrl && (
                            <div className="mb-2 rounded-lg overflow-hidden border border-black/10">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.attachmentUrl}
                                alt={msg.attachmentName || 'Attachment image'}
                                onClick={() => setPreviewImageUrl(msg.attachmentUrl || null)}
                                className="max-h-60 max-w-full rounded-lg object-cover cursor-pointer hover:opacity-95 transition-opacity"
                              />
                            </div>
                          )}

                          {/* File Document Attachment Rendering */}
                          {msg.messageType === 'file' && (
                            <div
                              className={`flex items-center gap-3 p-2.5 rounded-lg mb-2 text-xs border ${
                                isMe
                                  ? 'bg-emerald-700/60 border-emerald-600/50 text-white'
                                  : 'bg-slate-50 border-slate-200 text-slate-900'
                              }`}
                            >
                              <div
                                className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${
                                  isMe ? 'bg-emerald-800 text-white' : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                <FileText className="w-5 h-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="font-semibold block truncate" title={msg.attachmentName || 'Document'}>
                                  {msg.attachmentName || 'Attachment'}
                                </span>
                                <span className="text-[10px] opacity-80 block">
                                  {formatFileSize(msg.attachmentSize)}
                                </span>
                              </div>
                              {msg.attachmentUrl && (
                                <a
                                  href={msg.attachmentUrl}
                                  download={msg.attachmentName || 'download'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`p-1.5 rounded-md hover:bg-black/10 transition-colors shrink-0`}
                                  title="Download File"
                                >
                                  <Download className="w-4 h-4" />
                                </a>
                              )}
                            </div>
                          )}

                          {/* Text Message Content */}
                          {editingMessageId === msg.id ? (
                            <div className="space-y-2 min-w-[240px]">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full text-xs text-slate-900 bg-white p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                rows={2}
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingMessageId(null)}
                                  className="px-2 py-1 text-[11px] rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(msg.id)}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.content}
                            </p>
                          )}
                        </>
                      )}

                      {/* Message Footer: Timestamp, Edited flag & Read receipts */}
                      <div
                        className={`flex items-center justify-end gap-1 text-[10px] mt-1 select-none ${
                          isMe ? 'text-emerald-100' : 'text-slate-400'
                        }`}
                      >
                        {msg.editedAt && !isDeleted && (
                          <span className="italic mr-0.5 opacity-80">edited</span>
                        )}
                        <span>{formatMessageTime(msg.createdAt)}</span>

                        {isMe && !isDeleted && (
                          <span className="ml-0.5" title={isOptimistic ? 'Sending...' : isRead ? 'Read' : 'Delivered'}>
                            {isOptimistic ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : isRead ? (
                              <CheckCheck className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                            ) : (
                              <Check className="w-3.5 h-3.5 opacity-80" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Own Message Action Menu (Edit / Delete) */}
                    {isMe && !isDeleted && !isOptimistic && editingMessageId !== msg.id && (
                      <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveMenuMessageId(
                              activeMenuMessageId === msg.id ? null : msg.id
                            )
                          }
                          className="p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 cursor-pointer"
                          title="Message options"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>

                        {activeMenuMessageId === msg.id && (
                          <div className="absolute right-0 bottom-full mb-1 w-28 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMessageId(msg.id);
                                setEditContent(msg.content);
                                setActiveMenuMessageId(null);
                              }}
                              className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                            >
                              <Edit2 className="w-3 h-3 text-slate-500" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(msg.id)}
                              className="w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3 text-rose-500" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}

        {/* Realtime Typing Indicator Bubble */}
        {isTyping && (
          <div className="flex items-center gap-2 text-slate-500 text-xs animate-in fade-in duration-200">
            <div className="px-3 py-2 bg-white border border-slate-200/80 rounded-2xl rounded-bl-xs shadow-2xs flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
              </span>
              <span className="text-[11px] text-slate-500 ml-1">
                {typingUser || 'Participant'} is typing...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Attachment Preview Bar (Prior to Sending) */}
      {selectedFile && (
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {filePreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={filePreviewUrl}
                alt="Upload preview"
                className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <span className="text-xs font-semibold text-slate-800 truncate block">
                {selectedFile.name}
              </span>
              <span className="text-[10px] text-slate-500">
                {formatFileSize(selectedFile.size)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={removeSelectedFile}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200"
            title="Remove attachment"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error alert notice */}
      {errorMessage && (
        <div className="px-4 py-1.5 bg-rose-50 border-t border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4. Professional Message Input Bar */}
      <div className="p-3 sm:p-4 border-t border-slate-200/80 bg-white shrink-0">
        <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-2.5 focus-within:bg-white focus-within:border-[#14a800] focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all shadow-2xs">
          {/* File Upload Hidden Input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden"
            id="chat-file-upload-input"
          />

          {/* Text Area */}
          <textarea
            id="chat-message-textarea"
            rows={2}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type your message here... (Enter to send, Shift+Enter for newline)"
            disabled={isSubmitting}
            className="w-full py-1 px-1.5 bg-transparent text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none resize-none max-h-36 min-h-[48px] leading-relaxed"
          />

          {/* Bottom Composer Toolbar */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/50 mt-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                id="chat-attach-file-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting || isUploadingAttachment}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                title="Attach document or screenshot"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Attach file</span>
              </button>

              <span className="text-[10px] text-slate-400 hidden md:inline ml-2 select-none">
                Enter to send • Shift + Enter for newline
              </span>
            </div>

            {/* Send Button */}
            <button
              type="button"
              id="chat-send-message-btn"
              onClick={handleSend}
              disabled={(!inputText.trim() && !selectedFile) || isSubmitting || isUploadingAttachment}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#14a800] hover:bg-[#108a00] text-white font-semibold text-xs transition-all cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              title="Send message"
            >
              {isSubmitting || isUploadingAttachment ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <span>Send</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 5. Fullscreen Image Preview Lightbox */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageUrl}
              alt="Fullscreen preview"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-3 -right-3 p-1.5 rounded-full bg-white text-slate-800 hover:bg-slate-100 shadow-md"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
