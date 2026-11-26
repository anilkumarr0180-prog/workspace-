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
  Loader2,
  Copy,
  Phone,
  Video,
} from 'lucide-react';
import WorkroomDetailsDrawer from './workroom-details-drawer';
import { useCall } from '@/components/calls/call-provider';

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
  const { callState, startCall } = useCall();

  // Synchronous lock ref to prevent rapid double-sending
  const isSubmittingRef = useRef(false);

  // Attachment upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Edit & Delete message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [activeMenuMessageId, setActiveMenuMessageId] = useState<string | null>(null);

  // Image preview modal
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Copied indicator toast
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);
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
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
    userScrolledUpRef.current = !isNearBottom;
  };

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom(false);
    }
  }, [messages.length, scrollToBottom]);

  // Handle typing debounce and throttle broadcast transmissions
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    setErrorMessage(null);

    const now = Date.now();
    if (val.trim().length > 0) {
      // Throttle broadcast typing status to at most once per 1500ms to prevent socket flooding
      if (now - lastTypingSentRef.current > 1500) {
        lastTypingSentRef.current = now;
        onTyping(true);
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        lastTypingSentRef.current = 0;
        onTyping(false);
      }, 2000);
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      lastTypingSentRef.current = 0;
      onTyping(false);
    }
  };

  // Handle key press (Enter sends, Shift+Enter for newline, checking composition for IME)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

  // Handle sending a message with synchronous debounce lock to prevent duplicate sends
  const handleSend = async () => {
    if (isSubmittingRef.current || isSubmitting || isUploadingAttachment) {
      return;
    }

    const text = inputText.trim();
    if (!text && !selectedFile) return;

    // 1. Immediately activate synchronous lock & clear input to prevent double-firing
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    const fileToUpload = selectedFile;
    setInputText('');
    removeSelectedFile();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Stop typing broadcast
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    lastTypingSentRef.current = 0;
    onTyping(false);

    try {
      let uploadedAttachment:
        | { path: string; name: string; size: number; type: string }
        | undefined = undefined;

      if (fileToUpload && conversation) {
        setIsUploadingAttachment(true);
        const formData = new FormData();
        formData.append('file', fileToUpload);

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
      userScrolledUpRef.current = false;
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: unknown) {
      // Restore input text on error so message isn't lost
      setInputText(text);
      if (fileToUpload) setSelectedFile(fileToUpload);
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setErrorMessage(msg);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsUploadingAttachment(false);
    }
  };

  // Handle message edit save
  const handleSaveEdit = async (messageId: string) => {
    if (!editContent.trim() || isSavingEdit) return;
    setIsSavingEdit(true);
    setErrorMessage(null);
    try {
      await onEditMessage(messageId, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error updating message');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Open in-app delete confirmation modal
  const handleRequestDelete = (messageId: string) => {
    setActiveMenuMessageId(null);
    setConfirmDeleteMessageId(messageId);
  };

  // Confirm message delete
  const handleConfirmDelete = async () => {
    if (!confirmDeleteMessageId || deletingMessageId) return;
    const messageId = confirmDeleteMessageId;
    setDeletingMessageId(messageId);
    setErrorMessage(null);
    try {
      await onDeleteMessage(messageId);
      setConfirmDeleteMessageId(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error deleting message');
      setConfirmDeleteMessageId(null);
    } finally {
      setDeletingMessageId(null);
    }
  };

  // Copy message text
  const handleCopyMessage = (id: string, content: string) => {
    navigator.clipboard?.writeText(content);
    setCopiedMessageId(id);
    setActiveMenuMessageId(null);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // If no conversation is active
  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
        <div className="w-16 h-16 rounded-2xl bg-[#f2f7f2] text-[#108a00] border border-[#e4ebe4] flex items-center justify-center mb-4">
          <Send className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-[#001e00]">Your Workroom Messages</h2>
        <p className="text-xs text-[#5e6d55] max-w-sm mt-1 leading-relaxed">
          Select a project conversation to view proposals, milestone deliverables, and client discussions.
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
    <div className="flex-1 flex h-full bg-white relative overflow-hidden">
      {/* Main Chat Column */}
      <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden min-w-0">
        {/* 1. Unified Master Workroom Header */}
        <header className="px-4 sm:px-6 py-3.5 border-b border-[#e4ebe4] flex items-center justify-between gap-3 bg-white shrink-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile Back Button */}
            {onBackToInbox && (
              <Link
                href="/messages"
                id="back-to-inbox-button"
                onClick={onBackToInbox}
                className="md:hidden p-1.5 -ml-1 text-[#5e6d55] hover:text-[#001e00] hover:bg-[#f2f7f2] rounded-full cursor-pointer flex items-center justify-center"
                title="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
            )}

            {/* User Avatar with Online Dot */}
            <div className="relative shrink-0">
              {other?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={other.avatarUrl}
                  alt={other.fullName}
                  className="w-9 h-9 rounded-full object-cover border border-[#e4ebe4]"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#677d5c] text-white font-semibold flex items-center justify-center text-xs">
                  {initials}
                </div>
              )}
              {isOnline && (
                <span
                  title="Online now"
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#14a800] border-2 border-white"
                />
              )}
            </div>

            {/* User Details & Active Workroom Context */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="chat-participant-name" className="text-[17px] font-medium text-[#001e00] truncate">
                  {other?.fullName || 'Participant'}
                </h2>
                {other?.activeMode && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f2f7f2] text-[#5e6d55] border border-[#e4ebe4]">
                    {other.activeMode}
                  </span>
                )}
                {isOnline ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#108a00]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#14a800]" />
                    Active now
                  </span>
                ) : (
                  <span className="text-[11px] text-[#5e6d55] font-normal">Offline</span>
                )}
              </div>

              {/* Current Active Room Subtitle */}
              <div className="flex items-center gap-2 text-xs text-[#5e6d55] mt-0.5">
                {conversation.contractId ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#5e6d55] truncate max-w-[320px]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#108a00] shrink-0" />
                    <span className="truncate">{conversation.contractTitle || 'Active Contract'}</span>
                    <span className="text-[10px] text-[#108a00] font-semibold bg-[#e9f5e8] px-1.5 py-0.2 rounded">
                      #{conversation.contractId.slice(0, 4)}
                    </span>
                  </span>
                ) : conversation.jobTitle ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-[#5e6d55] truncate max-w-[320px]">
                    <Briefcase className="w-3.5 h-3.5 text-[#5e6d55] shrink-0" />
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
            <button
              type="button"
              id="chat-audio-call-btn"
              onClick={() => startCall(conversation.id, 'audio')}
              disabled={callState !== 'idle'}
              title={callState !== 'idle' ? 'Call in progress' : 'Start audio call'}
              className="p-2 rounded-full border border-[#d5e0d5] text-[#001e00] hover:bg-[#f2f7f2] hover:border-[#108a00] hover:text-[#108a00] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button
              type="button"
              id="chat-video-call-btn"
              onClick={() => startCall(conversation.id, 'video')}
              disabled={callState !== 'idle'}
              title={callState !== 'idle' ? 'Call in progress' : 'Start video call'}
              className="p-2 rounded-full border border-[#d5e0d5] text-[#001e00] hover:bg-[#f2f7f2] hover:border-[#108a00] hover:text-[#108a00] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Video className="w-4 h-4" />
            </button>

            {conversation.contractId ? (
              <Link
                href={`/contracts/${conversation.contractId}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-full bg-[#108a00] hover:bg-[#14a800] text-white transition-all cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">View Contract</span>
                <span className="sm:hidden">Contract</span>
              </Link>
            ) : conversation.jobId ? (
              <Link
                href={`/jobs/${conversation.jobId}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-full border border-[#108a00] text-[#108a00] hover:bg-[#f2f7f2] transition-all cursor-pointer"
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>View Job</span>
              </Link>
            ) : null}
          </div>
        </header>

        {/* 1.1 Multi-Project Workroom Switcher */}
        {relatedConversations && relatedConversations.length > 1 && (
          <div className="px-4 sm:px-6 py-2 bg-[#f9fbf9] border-b border-[#e4ebe4] flex items-center justify-between gap-3 overflow-x-auto shrink-0 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold text-[#5e6d55] uppercase tracking-wider shrink-0">
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
                      className={`px-3 py-1 rounded-full text-xs shrink-0 transition-all cursor-pointer flex items-center gap-1.5 ${
                        isCurrent
                          ? 'bg-[#108a00] text-white font-medium'
                          : 'bg-white text-[#001e00] hover:bg-[#f2f7f2] border border-[#d5e0d5] font-normal'
                      }`}
                    >
                      {rel.contractId ? (
                        <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-white' : 'text-[#108a00]'}`} />
                      ) : (
                        <Briefcase className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-white/90' : 'text-[#5e6d55]'}`} />
                      )}
                      <span className="max-w-[160px] truncate">{label}</span>
                      {suffix && (
                        <span className="text-[10px] opacity-80 font-mono">{suffix}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 2. Messages Scroll Container with Upwork Clean Feed Palette */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-1 bg-white"
        >
          {/* Streamlined Thread Origin Header */}
          <div className="flex flex-col items-center text-center pt-4 pb-5 px-4 space-y-2 mb-2 border-b border-[#e4ebe4]/70 select-none">
            <div className="relative">
              {other?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={other.avatarUrl}
                  alt={other.fullName}
                  className="w-14 h-14 rounded-full object-cover border border-[#e4ebe4]"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#677d5c] text-white font-semibold flex items-center justify-center text-base">
                  {initials}
                </div>
              )}
              {isOnline && (
                <span
                  title="Online now"
                  className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#14a800] border-2 border-white"
                />
              )}
            </div>

            <div className="space-y-0.5">
              <h3 className="text-sm sm:text-base font-semibold text-[#001e00] flex items-center justify-center gap-1.5 flex-wrap">
                <span>{other?.fullName || 'Direct Conversation'}</span>
                {other?.activeMode && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f2f7f2] text-[#5e6d55] border border-[#e4ebe4]">
                    {other.activeMode}
                  </span>
                )}
              </h3>
              {other?.title && (
                <p className="text-xs text-[#5e6d55] max-w-sm mx-auto line-clamp-1">
                  {other.title}
                </p>
              )}
            </div>

            <p className="text-[11px] text-[#5e6d55] max-w-sm">
              This is the beginning of your direct conversation history.
            </p>

            {(conversation.contractTitle || conversation.jobTitle) && (
              <div className="pt-0.5">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f9fbf9] border border-[#e4ebe4] text-xs text-[#001e00] max-w-lg">
                  {conversation.contractId ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-[#108a00] shrink-0" />
                  ) : (
                    <Briefcase className="w-3.5 h-3.5 text-[#5e6d55] shrink-0" />
                  )}
                  <span
                    className="font-medium text-[#001e00] truncate max-w-[240px] sm:max-w-[340px]"
                    title={conversation.contractTitle || conversation.jobTitle || ''}
                  >
                    {conversation.contractTitle || conversation.jobTitle}
                  </span>
                  {conversation.contractId ? (
                    <Link
                      href={`/contracts/${conversation.contractId}`}
                      className="text-[11px] font-semibold text-[#108a00] hover:underline shrink-0"
                    >
                      Contract #{conversation.contractId.slice(0, 4)}
                    </Link>
                  ) : conversation.jobId ? (
                    <Link
                      href={`/jobs/${conversation.jobId}`}
                      className="text-[11px] font-semibold text-[#108a00] hover:underline shrink-0"
                    >
                      View Job
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Load earlier messages trigger */}
          {hasMore && (
            <div className="text-center pt-1 pb-3">
              <button
                type="button"
                id="load-earlier-messages-btn"
                onClick={onLoadEarlier}
                disabled={isLoadingEarlier}
                className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-white border border-[#d5e0d5] text-[#108a00] hover:bg-[#f2f7f2] transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                {isLoadingEarlier ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#108a00]" />
                    <span>Loading history...</span>
                  </>
                ) : (
                  <span>Load earlier messages</span>
                )}
              </button>
            </div>
          )}

          {isLoadingMessages ? (
            <div className="space-y-5 py-4 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-3 max-w-xl">
                  <div className="w-8 h-8 rounded-full bg-[#e4ebe4] shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-32 bg-[#e4ebe4] rounded-sm" />
                    <div className="h-4 w-full bg-[#f2f7f2] rounded-sm" />
                    <div className="h-4 w-2/3 bg-[#f2f7f2] rounded-sm" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-[#f2f7f2] text-[#108a00] border border-[#e4ebe4] flex items-center justify-center mx-auto">
                <Send className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-[#001e00]">Start the conversation</h3>
              <p className="text-xs text-[#5e6d55] max-w-sm mx-auto">
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

              // System activity notification rendering
              if (msg.messageType === 'system') {
                return (
                  <React.Fragment key={msg.id}>
                    {showDateDivider && (
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-[#e4ebe4]" />
                        <span className="text-[11px] font-medium text-[#5e6d55] px-2">
                          {formatDateDivider(msg.createdAt)}
                        </span>
                        <div className="flex-1 h-px bg-[#e4ebe4]" />
                      </div>
                    )}
                    <div className="flex items-center justify-center my-3 px-4">
                      <div className="inline-flex items-center gap-2 max-w-lg px-3.5 py-2 rounded-lg bg-[#f9fbf9] border border-[#e4ebe4] text-xs text-[#5e6d55] font-medium text-center">
                        <span className="leading-relaxed">{msg.content}</span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              }

              return (
                <React.Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-[#e4ebe4]" />
                      <span className="text-[11px] font-medium text-[#5e6d55] px-2">
                        {formatDateDivider(msg.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-[#e4ebe4]" />
                    </div>
                  )}

                  <div
                    id={`message-item-${msg.id}`}
                    className={`flex flex-col group relative py-1 ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`flex items-end gap-2 max-w-[85%] sm:max-w-[72%] ${
                        isMe ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      {/* Sender Avatar for receiver's messages */}
                      {!isMe && (
                        <div className="shrink-0 mb-1">
                          {other?.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={other.avatarUrl}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover border border-[#e4ebe4]"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-[#677d5c] text-white font-semibold flex items-center justify-center text-[10px]">
                              {initials}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div
                        className={`relative rounded-2xl px-4 py-2.5 transition-all ${
                          isDeleted
                            ? 'bg-[#f2f7f2] text-[#5e6d55] border border-[#e4ebe4] italic'
                            : isMe
                            ? 'bg-[#108a00] text-white rounded-br-xs shadow-2xs'
                            : 'bg-[#f2f7f2] text-[#001e00] border border-[#e4ebe4] rounded-bl-xs'
                        }`}
                      >
                        {isDeleted ? (
                          <div className="flex items-center gap-1.5 text-xs italic text-[#5e6d55]">
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>This message was deleted</span>
                          </div>
                        ) : (
                          <>
                            {/* Image Attachment Rendering */}
                            {msg.messageType === 'image' && msg.attachmentUrl && (
                              <div className="mb-1.5 rounded-xl overflow-hidden border border-black/10 inline-block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={msg.attachmentUrl}
                                  alt={msg.attachmentName || 'Attachment image'}
                                  onClick={() => setPreviewImageUrl(msg.attachmentUrl || null)}
                                  className="max-h-60 max-w-full rounded-xl object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                />
                              </div>
                            )}

                            {/* File Document Attachment Rendering */}
                            {msg.messageType === 'file' && (
                              <div className="flex items-center gap-3 p-3 rounded-xl my-1 text-xs border border-[#d5e0d5] bg-white text-[#001e00] max-w-sm">
                                <div className="w-9 h-9 rounded-lg bg-[#f2f7f2] text-[#108a00] flex items-center justify-center shrink-0">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-semibold text-[#001e00] block truncate" title={msg.attachmentName || 'Document'}>
                                    {msg.attachmentName || 'Attachment'}
                                  </span>
                                  <span className="text-[11px] text-[#5e6d55] block">
                                    {formatFileSize(msg.attachmentSize)}
                                  </span>
                                </div>
                                {msg.attachmentUrl && (
                                  <a
                                    href={msg.attachmentUrl}
                                    download={msg.attachmentName || 'download'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded-full text-[#108a00] hover:bg-[#f2f7f2] transition-colors shrink-0"
                                    title="Download File"
                                  >
                                    <Download className="w-4 h-4" />
                                  </a>
                                )}
                              </div>
                            )}

                            {/* Text Message Content */}
                            {editingMessageId === msg.id ? (
                              <div className="space-y-2 min-w-[220px] sm:min-w-[280px] mt-0.5">
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                      e.preventDefault();
                                      handleSaveEdit(msg.id);
                                    } else if (e.key === 'Escape') {
                                      setEditingMessageId(null);
                                      setEditContent('');
                                    }
                                  }}
                                  disabled={isSavingEdit}
                                  className="w-full text-[13.5px] text-[#001e00] bg-white p-2.5 rounded-lg border border-[#d5e0d5] focus:outline-hidden focus:border-[#108a00]"
                                  rows={2}
                                  autoFocus
                                />
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId(null);
                                      setEditContent('');
                                    }}
                                    disabled={isSavingEdit}
                                    className="px-3 py-1 text-xs rounded-full bg-white border border-[#d5e0d5] text-[#001e00] hover:bg-[#f2f7f2] disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(msg.id)}
                                    disabled={!editContent.trim() || isSavingEdit}
                                    className="px-3 py-1 text-xs font-medium rounded-full bg-[#001e00] text-white hover:bg-[#183818] disabled:opacity-50"
                                  >
                                    {isSavingEdit ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              msg.content && (
                                <p
                                  className={`text-[13.5px] leading-[1.5] whitespace-pre-wrap break-words font-normal ${
                                    isMe ? 'text-white' : 'text-[#001e00]'
                                  }`}
                                >
                                  {msg.content}
                                </p>
                              )
                            )}
                          </>
                        )}

                        {/* Timestamp + Edited + Read Receipt */}
                        <div
                          className={`flex items-center justify-end gap-1.5 mt-1 text-[10.5px] ${
                            isDeleted
                              ? 'text-[#5e6d55]'
                              : isMe
                              ? 'text-white/80'
                              : 'text-[#5e6d55]'
                          }`}
                        >
                          {msg.editedAt && !isDeleted && (
                            <span className="italic">edited</span>
                          )}
                          <span>{formatMessageTime(msg.createdAt)}</span>
                          {isMe && !isDeleted && (
                            <span
                              className="inline-flex items-center"
                              title={isOptimistic ? 'Sending...' : isRead ? 'Read' : 'Delivered'}
                            >
                              {isOptimistic ? (
                                <Loader2 className="w-3 h-3 animate-spin text-white/80" />
                              ) : isRead ? (
                                <CheckCheck className="w-3.5 h-3.5 text-white stroke-[2.2]" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-white/80 stroke-[2]" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Message Action Options (Copy, Edit, Delete) */}
                      {!isDeleted && !isOptimistic && editingMessageId !== msg.id && (
                        <div
                          className={`relative self-center transition-opacity flex items-center shrink-0 ${
                            activeMenuMessageId === msg.id
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMenuMessageId(
                                activeMenuMessageId === msg.id ? null : msg.id
                              )
                            }
                            className="p-1.5 rounded-full text-[#5e6d55] hover:text-[#001e00] hover:bg-[#e4ebe4]/60 cursor-pointer"
                            title="Message options"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {activeMenuMessageId === msg.id && (
                            <div
                              className={`absolute bottom-full mb-1 w-28 bg-white border border-[#d5e0d5] rounded-xl shadow-lg py-1 z-20 text-xs ${
                                isMe ? 'right-0' : 'left-0'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleCopyMessage(msg.id, msg.content)}
                                className="w-full px-3 py-1.5 text-left text-[#001e00] hover:bg-[#f2f7f2] flex items-center gap-1.5 cursor-pointer"
                              >
                                <Copy className="w-3 h-3 text-[#5e6d55]" />
                                <span>Copy</span>
                              </button>

                              {isMe && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditContent(msg.content);
                                      setActiveMenuMessageId(null);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-[#001e00] hover:bg-[#f2f7f2] flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Edit2 className="w-3 h-3 text-[#5e6d55]" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRequestDelete(msg.id)}
                                    className="w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3 text-rose-500" />
                                    <span>Delete</span>
                                  </button>
                                </>
                              )}
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

          {/* Realtime Typing Indicator */}
          {isTyping && (
            <div className="flex items-center gap-2 px-2 py-2 text-[#5e6d55] text-xs animate-in fade-in duration-200">
              <div className="px-3 py-1.5 bg-[#f2f7f2] border border-[#e4ebe4] rounded-full flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#108a00] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#108a00] animate-bounce [animation-delay:0.2s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#108a00] animate-bounce [animation-delay:0.4s]" />
                </span>
                <span className="text-[11px] text-[#5e6d55] font-medium">
                  {typingUser || 'Participant'} is typing...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 3. Attachment Preview Bar (Prior to Sending) */}
        {selectedFile && (
          <div className="px-4 py-2 border-t border-[#e4ebe4] bg-[#f9fbf9] flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {filePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={filePreviewUrl}
                  alt="Upload preview"
                  className="w-10 h-10 rounded-lg object-cover border border-[#d5e0d5] shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-[#f2f7f2] text-[#108a00] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#001e00] truncate block">
                  {selectedFile.name}
                </span>
                <span className="text-[10px] text-[#5e6d55]">
                  {formatFileSize(selectedFile.size)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={removeSelectedFile}
              className="p-1 rounded-full text-[#5e6d55] hover:text-[#001e00] hover:bg-[#e4ebe4]"
              title="Remove attachment"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error Alert Bar */}
        {errorMessage && (
          <div className="px-4 py-2 bg-rose-50 border-t border-rose-200 text-rose-700 text-xs flex items-center justify-between">
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

        {/* Copied Feedback Toast */}
        {copiedMessageId && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-[#001e00] text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg animate-in fade-in duration-150">
            Copied to clipboard
          </div>
        )}

        {/* 4. Upwork-Style Message Composer */}
        <div className="px-4 sm:px-6 py-3.5 bg-white shrink-0">
          <div className="bg-white border border-[#d5e0d5] rounded-xl px-3.5 py-2.5 focus-within:border-[#108a00] focus-within:ring-1 focus-within:ring-[#108a00] transition-all">
            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/*,.pdf,.doc,.docx,.txt"
              className="hidden"
              id="chat-file-upload-input"
            />

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              id="chat-message-textarea"
              rows={2}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                lastTypingSentRef.current = 0;
                onTyping(false);
              }}
              placeholder={`Send a message to ${other?.fullName || 'participant'}... (Shift+Enter for newline)`}
              disabled={isSubmitting}
              className="w-full py-0.5 bg-transparent text-[13.5px] text-[#001e00] placeholder:text-[#5e6d55] focus:outline-hidden resize-none max-h-36 min-h-[44px] leading-relaxed"
            />

            {/* Bottom Composer Toolbar */}
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#e4ebe4]/70">
              {/* Left actions: Attach button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="chat-attach-file-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting || isUploadingAttachment}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[#5e6d55] hover:text-[#108a00] hover:bg-[#f2f7f2] rounded-full text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="Attach document or screenshot"
                >
                  <Paperclip className="w-4 h-4" />
                  <span className="hidden sm:inline">Attach file</span>
                </button>
              </div>

              {/* Right actions: Keyboard shortcut hint + Send button */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[#5e6d55] hidden sm:inline select-none">
                  Press <kbd className="px-1.5 py-0.5 text-[10px] bg-[#f2f7f2] border border-[#d5e0d5] rounded font-mono text-[#5e6d55]">↵</kbd> to send
                </span>

                <button
                  type="button"
                  id="chat-send-message-btn"
                  onClick={handleSend}
                  disabled={(!inputText.trim() && !selectedFile) || isSubmitting || isUploadingAttachment}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#108a00] hover:bg-[#14a800] text-white font-medium text-xs transition-all cursor-pointer disabled:bg-[#e4ebe4] disabled:text-[#9aaa97] disabled:cursor-not-allowed"
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
        </div>

        {/* 5. Fullscreen Image Lightbox */}
        {previewImageUrl && (
          <div
            onClick={() => setPreviewImageUrl(null)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-4xl max-h-[90vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewImageUrl}
                alt="Fullscreen preview"
                className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
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
        {/* 5b. In-App Delete Message Confirmation Modal */}
        {confirmDeleteMessageId && (
          <div
            onClick={() => {
              if (!deletingMessageId) setConfirmDeleteMessageId(null);
            }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white rounded-2xl border border-[#e4ebe4] shadow-xl p-5 space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-[#001e00]">
                    Delete message?
                  </h4>
                  <p className="text-xs text-[#5e6d55] leading-relaxed">
                    This message will be deleted for everyone in this conversation. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteMessageId(null)}
                  disabled={Boolean(deletingMessageId)}
                  className="px-4 py-1.5 text-xs font-medium rounded-full border border-[#d5e0d5] text-[#001e00] hover:bg-[#f2f7f2] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={Boolean(deletingMessageId)}
                  className="px-4 py-1.5 text-xs font-medium rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  {deletingMessageId ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Delete</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. Workroom Details Side Panel (Always visible on desktop when a chat is open) */}
      <div className="hidden lg:block w-80 xl:w-[340px] shrink-0 h-full border-l border-[#e4ebe4] bg-white z-20">
        <WorkroomDetailsDrawer
          conversation={conversation}
          messages={messages}
          isOnline={isOnline}
        />
      </div>
    </div>
  );
}
