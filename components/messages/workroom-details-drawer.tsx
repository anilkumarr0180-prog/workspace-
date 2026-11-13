'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Conversation,
  Message,
} from '@/lib/types';
import {
  X,
  User,
  ShieldCheck,
  Briefcase,
  FileText,
  Image as ImageIcon,
  Download,
  ExternalLink,
  Clock,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface WorkroomDetailsDrawerProps {
  conversation: Conversation;
  messages: Message[];
  isOnline?: boolean;
  onClose: () => void;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLocalTime(): string {
  try {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function WorkroomDetailsDrawer({
  conversation,
  messages,
  isOnline = false,
  onClose,
}: WorkroomDetailsDrawerProps) {
  const [activeMediaTab, setActiveMediaTab] = useState<'all' | 'images' | 'documents'>('all');

  const other = conversation.otherParticipant;
  const initials =
    other?.fullName
      ?.split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'U';

  // Extract all attachment messages in this thread
  const attachments = React.useMemo(() => {
    return messages
      .filter((m) => !m.deletedAt && (m.attachmentUrl || m.attachmentPath))
      .map((m) => ({
        id: m.id,
        name: m.attachmentName || 'Attachment',
        url: m.attachmentUrl || `/api/messages/download?path=${encodeURIComponent(m.attachmentPath || '')}`,
        type: m.messageType,
        size: m.attachmentSize,
        createdAt: m.createdAt,
      }));
  }, [messages]);

  const imagesCount = attachments.filter((a) => a.type === 'image').length;
  const docsCount = attachments.filter((a) => a.type === 'file').length;

  const filteredAttachments = attachments.filter((a) => {
    if (activeMediaTab === 'images') return a.type === 'image';
    if (activeMediaTab === 'documents') return a.type === 'file';
    return true;
  });

  return (
    <aside className="w-full h-full bg-white border-l border-slate-200/90 flex flex-col overflow-hidden text-slate-800">
      {/* 1. Header */}
      <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between shrink-0 bg-white">
        <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <span>Workroom Details</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Close details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Scrollable Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-5 space-y-6">
        {/* Contact Profile Section */}
        <div className="space-y-4 pt-1">
          <div className="flex flex-col items-center text-center">
            {/* Avatar with Status Ring */}
            <div className="relative mb-3">
              {other?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={other.avatarUrl}
                  alt={other.fullName}
                  className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md ring-2 ring-slate-100"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xl shadow-md">
                  {initials}
                </div>
              )}
              {isOnline && (
                <span
                  title="Online"
                  className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white ring-1 ring-emerald-500/20"
                />
              )}
            </div>

            <h4 className="text-base font-bold text-slate-900 leading-tight">
              {other?.fullName || 'Participant'}
            </h4>

            {other?.title && (
              <p className="text-xs text-slate-500 mt-1 max-w-[240px] line-clamp-2">
                {other.title}
              </p>
            )}

            <div className="flex items-center gap-2 mt-2">
              {other?.activeMode && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/60">
                  {other.activeMode}
                </span>
              )}
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{formatLocalTime()} local</span>
              </span>
            </div> 

            {other?.userId && (
              <div className="w-full mt-4">
                <Link
                  href={
                    other.activeMode === 'freelancer'
                      ? `/freelancers/${other.username && other.username !== 'participant' ? other.username : other.userId}`
                      : `/client`
                  }
                  className="inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs"
                >
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span>View Public Profile</span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Contract & Project Terms Section */}
        <div className="pt-6 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Project Context
            </span>
            {conversation.contractStatus && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                {conversation.contractStatus}
              </span>
            )}
          </div>

          <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 text-emerald-700 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                {conversation.contractId ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Briefcase className="w-4 h-4 text-slate-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs font-bold text-slate-900 leading-snug line-clamp-3 break-words"
                  title={conversation.contractTitle || conversation.jobTitle || ''}
                >
                  {conversation.contractTitle || conversation.jobTitle || 'General Discussion'}
                </p>
                {conversation.contractId ? (
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Contract #{conversation.contractId.slice(0, 8)}
                  </p>
                ) : conversation.jobId ? (
                  <Link
                    href={`/jobs/${conversation.jobId}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline mt-1.5"
                  >
                    <span>View original job post</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                ) : null}
              </div>
            </div>

            {/* Financial Terms Overview */}
            {conversation.hourlyRate ? (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Rate</span>
                  <span className="font-bold text-slate-900">${conversation.hourlyRate.toFixed(2)}/hr</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Weekly Limit</span>
                  <span className="font-bold text-slate-900">
                    {conversation.weeklyHourLimit ? `${conversation.weeklyHourLimit} hrs` : 'No limit'}
                  </span>
                </div>
              </div>
            ) : conversation.fixedPrice ? (
              <div className="pt-2 border-t border-slate-200/60 text-xs">
                <span className="text-[10px] text-slate-500 block">Fixed Price Project</span>
                <span className="font-bold text-slate-900 text-sm">${conversation.fixedPrice.toFixed(2)}</span>
              </div>
            ) : null}

            {/* Contract Quick Action Links */}
            {conversation.contractId && (
              <div className="pt-2 space-y-1.5 border-t border-slate-200/60">
                <Link
                  href={`/contracts/${conversation.contractId}`}
                  className="flex items-center justify-between text-xs font-semibold text-emerald-700 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-white transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>View Contract & Milestones</span>
                  </span>
                  <ExternalLink className="w-3 h-3 text-emerald-600" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Files & Media Drawer */}
        <div className="pt-6 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Files & Attachments ({attachments.length})
            </span>
          </div>

          {/* Sub tabs */}
          {attachments.length > 0 && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setActiveMediaTab('all')}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                  activeMediaTab === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                All ({attachments.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveMediaTab('images')}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                  activeMediaTab === 'images'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Images ({imagesCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveMediaTab('documents')}
                className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                  activeMediaTab === 'documents'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Docs ({docsCount})
              </button>
            </div>
          )}

          {/* Attachment list */}
          {filteredAttachments.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 p-4">
              <FileText className="w-6 h-6 mx-auto mb-1.5 text-slate-300" />
              <p>No files shared in this thread yet.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredAttachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200/80 bg-white hover:bg-slate-50/80 transition-colors gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 text-slate-600">
                      {att.type === 'image' ? (
                        <ImageIcon className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate" title={att.name}>
                        {att.name}
                      </p>
                      <span className="text-[10px] text-slate-400">
                        {formatFileSize(att.size)}
                      </span>
                    </div>
                  </div>

                  <a
                    href={att.url}
                    download={att.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security & Escrow Trust Badge */}
        <div className="pt-6">
          <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/70 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-800 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Workspace Payment Protection</span>
            </div>
            <p className="text-[11px] text-emerald-900/80 leading-relaxed">
              All project deliverables and milestones are escrow-insured. To stay protected by dispute resolution, never communicate or transact outside of Workspace.
            </p>
            <div className="flex items-center gap-3 pt-1 text-[10px] font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Escrow Protected
              </span>
              <span className="inline-flex items-center gap-1">
                <Lock className="w-3 h-3" />
                End-to-end Tracked
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

