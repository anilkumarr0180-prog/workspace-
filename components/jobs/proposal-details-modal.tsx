'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProposalRecord } from '@/lib/actions/proposals';
import { getContractOfferForProposal } from '@/lib/actions/contracts';
import { Contract } from '@/lib/types';
import HireOfferModal from '@/components/jobs/hire-offer-modal';
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
  ArrowRight,
  ThumbsUp,
  FileEdit,
  Save
} from 'lucide-react';

interface ProposalDetailsModalProps {
  proposal: ProposalRecord | null;
  isOpen: boolean;
  onClose: () => void;
  mode: 'client' | 'freelancer';
  onUpdateStatus?: (proposalId: string, status: string) => Promise<void>;
  onToggleShortlist?: (proposalId: string, isShortlisted: boolean) => Promise<void>;
  onDecline?: (proposalId: string, reason?: string) => Promise<void>;
  onWithdraw?: (proposalId: string) => Promise<void>;
  isUpdating?: boolean;
  onOpenContact?: (freelancer: {
    id?: string;
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
  onToggleShortlist,
  onDecline,
  onWithdraw,
  isUpdating = false,
  onOpenContact,
}: ProposalDetailsModalProps) {
  const router = useRouter();
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [isHireModalOpen, setIsHireModalOpen] = useState(false);
  const [existingContract, setExistingContract] = useState<Contract | null>(null);

  // Shortlist and evaluation state
  const [isShortlisted, setIsShortlisted] = useState<boolean>(proposal?.isShortlisted ?? false);
  const [isShortlisting, setIsShortlisting] = useState(false);
  const [notesText, setNotesText] = useState<string>(proposal?.clientNotes ?? '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // Decline dialog state
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>('Candidate skills do not align with project requirements');
  const [customReason, setCustomReason] = useState<string>('');
  const [isDeclining, setIsDeclining] = useState(false);

  const [prevProposalId, setPrevProposalId] = useState<string | null>(proposal?.id ?? null);
  if (proposal && proposal.id !== prevProposalId) {
    setPrevProposalId(proposal.id);
    setIsShortlisted(proposal.isShortlisted ?? false);
    setNotesText(proposal.clientNotes ?? '');
  }

  useEffect(() => {
    if (!isOpen || !proposal?.id) return;
    let isMounted = true;
    getContractOfferForProposal(proposal.id).then((res) => {
      if (isMounted && res.success && res.contract) {
        setExistingContract(res.contract);
      } else if (isMounted) {
        setExistingContract(null);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [isOpen, proposal?.id]);

  const handleToggleShortlist = async () => {
    if (!proposal?.id || isShortlisting) return;
    setIsShortlisting(true);
    const nextState = !isShortlisted;
    try {
      if (onToggleShortlist) {
        await onToggleShortlist(proposal.id, nextState);
      } else {
        await fetch(`/api/proposals/${proposal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'toggle_shortlist', isShortlisted: nextState }),
        });
      }
      setIsShortlisted(nextState);
    } finally {
      setIsShortlisting(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!proposal?.id || isSavingNotes) return;
    setIsSavingNotes(true);
    try {
      await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_notes', notes: notesText }),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleConfirmDecline = async () => {
    if (!proposal?.id || isDeclining) return;
    setIsDeclining(true);
    const finalReason = selectedReason === 'Other' ? customReason.trim() : selectedReason;
    try {
      if (onDecline) {
        await onDecline(proposal.id, finalReason);
      } else {
        await fetch(`/api/proposals/${proposal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'decline', reason: finalReason }),
        });
      }
      setIsDeclineModalOpen(false);
      onClose();
    } finally {
      setIsDeclining(false);
    }
  };

  const handleOpenConversation = async () => {
    if (!proposal?.id) return;
    setIsOpeningChat(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const data = await res.json();
      if (res.ok && data.conversationId) {
        onClose();
        router.push(`/messages/${data.conversationId}`);
        return;
      }
      if (onOpenContact && (proposal.freelancerUsername || proposal.freelancerId)) {
        onOpenContact({
          id: proposal.freelancerId,
          username: proposal.freelancerUsername || 'specialist',
          fullName: proposal.freelancerName,
          avatarUrl: proposal.freelancerAvatar,
        });
      }
    } catch {
      if (onOpenContact && (proposal.freelancerUsername || proposal.freelancerId)) {
        onOpenContact({
          id: proposal.freelancerId,
          username: proposal.freelancerUsername || 'specialist',
          fullName: proposal.freelancerName,
          avatarUrl: proposal.freelancerAvatar,
        });
      }
    } finally {
      setIsOpeningChat(false);
    }
  };
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

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleToggleShortlist}
                  disabled={isShortlisting}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isShortlisted
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                  title={isShortlisted ? 'Candidate is shortlisted. Click to remove from shortlist.' : 'Shortlist candidate (Thumbs Up)'}
                >
                  <ThumbsUp className={`w-3.5 h-3.5 ${isShortlisted ? 'fill-amber-500 text-amber-600' : 'text-slate-400'}`} />
                  <span>{isShortlisted ? 'Shortlisted' : 'Shortlist'}</span>
                </button>
                {proposal.freelancerUsername && (
                  <Link
                    href={`/freelancers/${proposal.freelancerUsername}`}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>View Profile</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </Link>
                )}
                {proposal.id && (
                  <button
                    type="button"
                    id="proposal-message-btn"
                    onClick={handleOpenConversation}
                    disabled={isOpeningChat}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>{isOpeningChat ? 'Opening...' : 'Message'}</span>
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

          {/* Decline Feedback (if rejected) */}
          {proposal.status === 'rejected' && proposal.declinedReason && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
              <span className="font-bold flex items-center gap-1.5 text-rose-900">
                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>Decline Feedback</span>
              </span>
              <p className="text-rose-700 leading-relaxed italic">&ldquo;{proposal.declinedReason}&rdquo;</p>
            </div>
          )}

          {/* Private Client Notes Section */}
          {isClient && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <FileEdit className="w-3.5 h-3.5 text-slate-500" />
                  <span>Private Candidate Notes (Internal Only)</span>
                </span>
                {notesSaved && (
                  <span className="text-[11px] text-emerald-600 font-semibold animate-in fade-in flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Saved</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Record private evaluation notes for this applicant (not visible to freelancer)..."
                  rows={2}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={isSavingNotes}
                  className="px-3.5 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors shrink-0 self-end flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingNotes ? 'Saving...' : 'Save'}</span>
                </button>
              </div>
            </div>
          )}

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
          {isClient && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
              {existingContract?.status === 'pending_offer' ? (
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 text-xs font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Offer Extended (Pending Acceptance)</span>
                  </span>
                  <Link
                    href={`/contracts/${existingContract.id}`}
                    onClick={onClose}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold transition-colors shadow-2xs"
                  >
                    View Offer
                  </Link>
                </div>
              ) : existingContract?.status === 'active' ? (
                <Link
                  href={`/contracts/${existingContract.id}`}
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors shadow-2xs"
                >
                  View Active Contract
                </Link>
              ) : onUpdateStatus ? (
                <>
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
                        onClick={() => setIsHireModalOpen(true)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Briefcase className="w-3.5 h-3.5" />
                        <span>Hire / Make Offer</span>
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => setIsDeclineModalOpen(true)}
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
                        onClick={() => setIsHireModalOpen(true)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Briefcase className="w-3.5 h-3.5" />
                        <span>Hire / Make Offer</span>
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => setIsDeclineModalOpen(true)}
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
                        onClick={() => setIsHireModalOpen(true)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Briefcase className="w-3.5 h-3.5" />
                        <span>Hire / Make Offer</span>
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => setIsDeclineModalOpen(true)}
                        className="px-3 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </>
              ) : null}
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

      {/* Decline Candidate Dialog Modal */}
      {isDeclineModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-600" />
                <span>Decline Candidate Proposal</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsDeclineModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Select a reason for declining this proposal. Providing transparent feedback helps freelancers understand your decision.
            </p>
            <div className="space-y-2">
              {[
                'Candidate skills do not align with project requirements',
                'Bid amount / rate is outside project budget',
                'Selected another applicant / position already filled',
                'Proposal lacked required portfolio samples or details',
                'Other',
              ].map((reason) => (
                <label
                  key={reason}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-colors ${
                    selectedReason === reason
                      ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="declineReason"
                    value={reason}
                    checked={selectedReason === reason}
                    onChange={() => setSelectedReason(reason)}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>
            {selectedReason === 'Other' && (
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Specify decline reason..."
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsDeclineModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeclining}
                onClick={handleConfirmDecline}
                className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-2xs"
              >
                {isDeclining ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upwork-Style Formal Contract Offer Modal */}
      <HireOfferModal
        proposal={proposal}
        isOpen={isHireModalOpen}
        onClose={() => setIsHireModalOpen(false)}
        onOfferSent={(contractId) => {
          setIsHireModalOpen(false);
          onClose();
          router.push(`/contracts/${contractId}`);
        }}
      />
    </div>
  );
}
