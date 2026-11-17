'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProposalRecord } from '@/lib/actions/proposals';
import {
  X,
  Calendar,
  Clock,
  Video,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  UserCheck,
} from 'lucide-react';

interface ScheduleMeetingModalProps {
  proposal: ProposalRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onMeetingScheduled?: (conversationId: string) => void;
  onUpdateStatus?: (proposalId: string, status: string) => Promise<void>;
}

export default function ScheduleMeetingModal({
  proposal,
  isOpen,
  onClose,
  onMeetingScheduled,
  onUpdateStatus,
}: ScheduleMeetingModalProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const [topic, setTopic] = useState(
    proposal?.jobTitle ? `Consultation: ${proposal.jobTitle}` : 'Project Scope Consultation'
  );
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('14:00');
  const [duration, setDuration] = useState<'15' | '30' | '45' | '60'>('30');
  const [platform, setPlatform] = useState<'google_meet' | 'zoom' | 'workspace'>('google_meet');
  const [meetingLink, setMeetingLink] = useState('https://meet.google.com/new');
  const [notes, setNotes] = useState('');

  if (!isOpen || !proposal) return null;

  const todayStr = new Date().toISOString().split('T')[0];

  const handlePlatformChange = (type: 'google_meet' | 'zoom' | 'workspace') => {
    setPlatform(type);
    if (type === 'google_meet') {
      setMeetingLink('https://meet.google.com/new');
    } else if (type === 'zoom') {
      setMeetingLink('https://zoom.us/join');
    } else {
      setMeetingLink(`https://workspace.app/call/${proposal.id.slice(0, 8)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposal.id) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Update proposal status to 'interviewing' (In Discussions)
      if (onUpdateStatus) {
        await onUpdateStatus(proposal.id, 'interviewing');
      } else {
        const patchRes = await fetch(`/api/proposals/${proposal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'interviewing' }),
        });

        if (!patchRes.ok) {
          console.warn('[MEETING SCHEDULE] Proposal status patch notice, proceeding with message dispatch.');
        }
      }

      // 2. Format a structured meeting invitation message
      const formattedDate = new Date(`${date}T${time}:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      const formattedTime = new Date(`${date}T${time}:00`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      const meetingInvitationContent = [
        `📅 **Project Consultation Meeting Scheduled**`,
        `• **Topic:** ${topic.trim()}`,
        `• **Date & Time:** ${formattedDate} at ${formattedTime}`,
        `• **Duration:** ${duration} minutes`,
        `• **Meeting Link:** ${meetingLink.trim() || 'Link to be provided prior to call'}`,
        notes.trim() ? `• **Agenda / Notes:** ${notes.trim()}` : null,
        `\n*Looking forward to discussing the project deliverables and milestones.*`,
      ]
        .filter(Boolean)
        .join('\n');

      // 3. Dispatch conversation and first message via /api/messages
      const msgRes = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          initialMessage: meetingInvitationContent,
        }),
      });

      const msgData = await msgRes.json();

      if (!msgRes.ok || !msgData.conversationId) {
        throw new Error(msgData.error || 'Failed to dispatch meeting invitation to candidate.');
      }

      setSuccessMessage('Meeting invitation dispatched successfully! Redirecting to conversation...');

      setTimeout(() => {
        if (onMeetingScheduled) {
          onMeetingScheduled(msgData.conversationId);
        } else {
          router.push(`/messages/${msgData.conversationId}`);
        }
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error while scheduling meeting.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Schedule a Meeting</h2>
              <p className="text-xs text-slate-500">
                Align with <strong className="text-slate-700">{proposal.freelancerName || 'Candidate'}</strong> on project deliverables
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Meeting Topic */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Meeting Topic / Purpose</label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Initial Scope Discussion & Architecture Alignment"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Date & Time Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Meeting Date</label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="date"
                  required
                  min={todayStr}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Time</label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Duration Selector */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Estimated Duration</label>
            <div className="grid grid-cols-4 gap-2">
              {(['15', '30', '45', '60'] as const).map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDuration(mins)}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer ${
                    duration === mins
                      ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/10'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {mins} mins
                </button>
              ))}
            </div>
          </div>

          {/* Platform Selector */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Meeting Platform</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                type="button"
                onClick={() => handlePlatformChange('google_meet')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  platform === 'google_meet'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/10'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Google Meet</span>
              </button>
              <button
                type="button"
                onClick={() => handlePlatformChange('zoom')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  platform === 'zoom'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/10'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Zoom</span>
              </button>
              <button
                type="button"
                onClick={() => handlePlatformChange('workspace')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  platform === 'workspace'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/10'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Workspace</span>
              </button>
            </div>

            <div className="relative">
              <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="url"
                required
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              You can paste an existing meeting room link or generate one on the fly.
            </p>
          </div>

          {/* Agenda / Notes */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Call Agenda / Topics to Discuss <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. We will review repository architecture, verify timeline milestones, and align on weekly sprint deliverables."
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
            />
          </div>

          {/* Footer Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Scheduling...</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Confirm & Send Invitation</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

