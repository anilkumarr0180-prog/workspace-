'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { ProposalRecord } from '@/lib/actions/proposals';
import {
  X,
  Briefcase,
  DollarSign,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  XCircle,
  ArrowRight
} from 'lucide-react';

interface ProposalDetailsModalProps {
  proposal: ProposalRecord | null;
  isOpen: boolean;
  onClose: () => void;
  mode: 'client' | 'freelancer';
  onUpdateStatus?: (proposalId: string, status: string) => Promise<void>;
  onWithdraw?: (proposalId: string) => Promise<void>;
  isUpdating?: boolean;
  onOpenContact?: (freelancer: {
    username: string;
    name?: string;
    fullName?: string;
    avatarUrl?: string | null;
    title?: string | null;
    hourlyRate?: number | null;
  }) => void;
}

export default function ProposalDetailsModal({
  proposal,
  isOpen,
  onClose,
  mode,
  onUpdateStatus,
  onWithdraw,
  isUpdating = false,
  onOpenContact,
}: ProposalDetailsModalProps) {
  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !proposal) return null;

  const isClient = mode === 'client';

  const getStatusBadge = (status: ProposalRecord['status']) => {
    switch (status) {
      case 'under_review':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Under Review
          </span>
        );
      case 'interviewing':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Interviewing
          </span>
        );
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Offer Accepted
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Declined
          </span>
        );
      case 'withdrawn':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300">
            Withdrawn
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            Submitted
          </span>
        );
    }
  };

  const formattedDate = proposal.createdAt
    ? new Date(proposal.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Recently';

  const initials = (proposal.freelancerName || 'Specialist')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4 bg-slate-50/80">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              {isClient ? 'Candidate Proposal Review' : 'Submitted Proposal Details'}
            </span>
            <h2 id="proposal-modal-title" className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
              <Link
                href={`/jobs/${proposal.jobId}`}
                className="hover:text-emerald-700 hover:underline flex items-center gap-1.5 transition-colors"
                title="View full project posting"
              >
                <span>{proposal.jobTitle || 'Project Listing'}</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </Link>
            </h2>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Candidate Profile Strip (Only in Client Review Mode) */}
          {isClient && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                {proposal.freelancerAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proposal.freelancerAvatar}
                    alt={proposal.freelancerName || 'Candidate'}
                    className="w-12 h-12 rounded-full object-cover border border-slate-300 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center text-sm shrink-0">
                    {initials}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    {proposal.freelancerName || 'Specialist Applicant'}
                  </h3>
                  {proposal.freelancerUsername ? (
                    <Link
                      href={`/freelancers/${proposal.freelancerUsername}`}
                      className="text-xs text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      <span>@{proposal.freelancerUsername}</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium">Verified Talent</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {proposal.freelancerUsername && (
                  <Link
                    href={`/freelancers/${proposal.freelancerUsername}`}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>View Profile</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </Link>
                )}
                {onOpenContact && proposal.freelancerUsername && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenContact({
                        username: proposal.freelancerUsername!,
                        fullName: proposal.freelancerName,
                        avatarUrl: proposal.freelancerAvatar,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>Message</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Key Proposal Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/70 text-xs">
            <div>
              <span className="text-slate-400 font-medium block">Proposed Bid</span>
              <div className="flex items-center gap-1 font-bold text-slate-900 text-sm sm:text-base mt-0.5">
                <DollarSign className="w-4 h-4 text-emerald-600 shrink-0 -mr-0.5" />
                <span>{proposal.bidAmount.toLocaleString()}</span>
                {proposal.rateType === 'hourly' && (
                  <span className="text-xs font-normal text-slate-500">/hr</span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 capitalize">{proposal.rateType} rate</span>
            </div>

            <div>
              <span className="text-slate-400 font-medium block">Turnaround</span>
              <div className="flex items-center gap-1 font-bold text-slate-900 text-sm sm:text-base mt-0.5">
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{proposal.deliveryDays ?? 'Flexible'}</span>
                <span className="text-xs font-normal text-slate-500">days</span>
              </div>
              <span className="text-[11px] text-slate-500">Estimated delivery</span>
            </div>

            <div>
              <span className="text-slate-400 font-medium block">Submitted Date</span>
              <div className="flex items-center gap-1 font-semibold text-slate-800 text-xs sm:text-sm mt-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{formattedDate}</span>
              </div>
              <span className="text-[11px] text-slate-400">Timestamp recorded</span>
            </div>

            <div>
              <span className="text-slate-400 font-medium block mb-1">Current Status</span>
              <div>{getStatusBadge(proposal.status)}</div>
            </div>
          </div>

          {/* Full Cover Letter */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
              Applicant Cover Letter &amp; Proposed Approach
            </span>
            <div className="p-4 sm:p-5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed whitespace-pre-line shadow-2xs font-normal">
              {proposal.coverLetter || 'No written cover letter was included with this proposal.'}
            </div>
          </div>

          {/* Terminal Status Explanations */}
          {['accepted', 'rejected', 'withdrawn'].includes(proposal.status) && (
            <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-800 block">
                  {proposal.status === 'accepted'
                    ? 'Offer Accepted & Deliverables In Progress'
                    : proposal.status === 'rejected'
                    ? 'Proposal Has Been Declined'
                    : 'Proposal Withdrawn by Candidate'}
                </strong>
                <p className="mt-0.5 text-slate-500">
                  {proposal.status === 'accepted'
                    ? 'The client accepted this offer. Contract milestone tracking and communication can proceed.'
                    : 'This proposal is in a terminal status and cannot be transitioned further under marketplace state rules.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer / Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>

          {/* Client Action Buttons (State Machine Compliant) */}
          {isClient && onUpdateStatus && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
              {proposal.status === 'submitted' && (
                <>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'under_review')}
                    className="px-3.5 py-2 rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isUpdating ? 'Updating...' : 'Mark as Under Review'}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'interviewing')}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    {isUpdating ? 'Updating...' : 'Start Interview'}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'rejected')}
                    className="px-3 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Decline
                  </button>
                </>
              )}

              {proposal.status === 'under_review' && (
                <>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'interviewing')}
                    className="px-3.5 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    {isUpdating ? 'Updating...' : 'Start Interview'}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'accepted')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    {isUpdating ? 'Updating...' : 'Accept Offer'}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'rejected')}
                    className="px-3 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Decline
                  </button>
                </>
              )}

              {proposal.status === 'interviewing' && (
                <>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'accepted')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs cursor-pointer"
                  >
                    {isUpdating ? 'Updating...' : 'Accept Offer'}
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(proposal.id, 'rejected')}
                    className="px-3 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Decline
                  </button>
                </>
              )}
            </div>
          )}

          {/* Freelancer Action Buttons */}
          {!isClient && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Link
                href={`/jobs/${proposal.jobId}`}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
              >
                <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                <span>View Job Posting</span>
              </Link>

              {onWithdraw && ['submitted', 'under_review', 'interviewing'].includes(proposal.status) && (
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => onWithdraw(proposal.id)}
                  className="px-3.5 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>{isUpdating ? 'Withdrawing...' : 'Withdraw Proposal'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
