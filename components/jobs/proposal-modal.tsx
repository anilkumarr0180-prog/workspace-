'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Job } from '@/lib/types';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface ProposalModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProposalModal({ job, isOpen, onClose }: ProposalModalProps) {
  const { addProposal, hasAppliedToJob, proposals } = useMarketplace();
  const alreadyApplied = hasAppliedToJob(job.id);
  const existingProposal = proposals.find((p) => p.jobId === job.id);

  const defaultBid =
    job.budget.type === 'fixed'
      ? job.budget.fixedAmount || 1000
      : job.budget.hourlyMin || 50;

  const [bidAmount, setBidAmount] = useState<number>(defaultBid);
  const [deliveryDays, setDeliveryDays] = useState<number>(14);
  const [coverLetter, setCoverLetter] = useState<string>('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionSource, setSubmissionSource] = useState<'supabase' | 'local'>('local');
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    try {
      const supabase = createClient();
      supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
        if (isMounted && res.data?.user) {
          setCurrentUserId(res.data.user.id);
        }
      });
    } catch {
      // Ignore in mock/offline mode
    }
    return () => {
      isMounted = false;
    };
  }, []);

  const isJobOwner = Boolean(currentUserId && job.client?.id && currentUserId === job.client.id);

  if (!isOpen) return null;

  // Platform fee 10% demo calculation
  const platformFee = Math.round(bidAmount * 0.1);
  const freelancerReceives = Math.max(0, bidAmount - platformFee);

  const validate = () => {
    const errs: { [key: string]: string } = {};

    if (!bidAmount || bidAmount <= 0) {
      errs.bidAmount = 'Please enter a valid bid amount greater than 0.';
    }

    if (!deliveryDays || deliveryDays <= 0) {
      errs.deliveryDays = 'Please enter estimated turnaround days.';
    }

    if (!coverLetter.trim()) {
      errs.coverLetter = 'Cover letter is required to submit a proposal.';
    } else if (coverLetter.trim().length < 50) {
      errs.coverLetter = `Cover letter must be at least 50 characters (${coverLetter.trim().length}/50).`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isJobOwner) {
      setApiErrorMessage('You cannot submit a proposal to a job you posted.');
      return;
    }
    if (!validate()) return;

    setIsSubmitting(true);
    setApiErrorMessage(null);

    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          bidAmount: Number(bidAmount),
          rateType: job.budget.type,
          coverLetter: coverLetter.trim(),
          deliveryDays: Number(deliveryDays),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.proposal) {
        setSubmissionSource('supabase');
        addProposal({
          jobId: job.id,
          jobTitle: job.title,
          bidAmount: Number(data.proposal.bidAmount || bidAmount),
          rateType: data.proposal.rateType || job.budget.type,
          coverLetter: data.proposal.coverLetter || coverLetter.trim(),
          deliveryDays: Number(data.proposal.deliveryDays || deliveryDays),
        });
        setIsSubmitted(true);
      } else if (res.status === 409) {
        setApiErrorMessage(data.error || 'You already have an active proposal submitted for this job.');
      } else if (res.status === 401) {
        setApiErrorMessage(data.error || 'Authentication required. Please sign in to submit a proposal.');
      } else if (res.status === 403) {
        setApiErrorMessage(data.error || 'You do not have permission to submit a proposal to this job.');
      } else if (res.status === 422) {
        setApiErrorMessage(data.error || 'Proposals can only be submitted for published jobs.');
      } else if (data.fieldErrors) {
        setErrors(data.fieldErrors);
        setApiErrorMessage(data.error || 'Please correct the highlighted fields.');
      } else {
        setApiErrorMessage(data.error || 'Failed to submit proposal.');
      }
    } catch {
      setApiErrorMessage('Network error while submitting proposal. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <span className="text-xs uppercase font-bold tracking-wider text-emerald-600">
              Submit a Proposal
            </span>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 line-clamp-1 mt-0.5">
              {job.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {isJobOwner ? (
            <div className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-sm">Cannot Apply to Your Own Job</h4>
                  <p className="text-xs mt-1 text-amber-700 leading-relaxed">
                    You are the creator and owner of this job posting. Under marketplace policies, clients cannot submit proposals to their own listings.
                  </p>
                </div>
              </div>
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-amber-200/60">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-amber-100 transition-colors"
                >
                  Close
                </button>
                <Link
                  href="/client"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition-colors"
                >
                  Go to Client Dashboard
                </Link>
              </div>
            </div>
          ) : alreadyApplied && !isSubmitted ? (
            <div className="py-2 space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-semibold text-sm">Active Proposal On File</h4>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    You have already submitted a proposal for this job. You can review and manage your proposal status in your{' '}
                    <Link href="/freelancer#proposals" onClick={onClose} className="underline font-semibold text-amber-900 hover:text-emerald-800">
                      Freelancer Hub
                    </Link>
                    .
                  </p>
                </div>
              </div>

              {/* Proposal summary card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Your Submission</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wider">
                    {existingProposal?.status?.replace('_', ' ') || 'Submitted'}
                  </span>
                </div>
                {existingProposal && (
                  <div className="grid grid-cols-2 gap-3 py-1">
                    <div>
                      <span className="text-slate-500 block">Proposed Terms:</span>
                      <strong className="text-slate-900 text-sm">
                        ${existingProposal.bidAmount} {existingProposal.rateType === 'hourly' ? '/hr' : ''}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Delivery Timeline:</span>
                      <strong className="text-slate-900 text-sm">
                        {existingProposal.deliveryDays ? `${existingProposal.deliveryDays} days` : 'Flexible'}
                      </strong>
                    </div>
                  </div>
                )}
                {existingProposal?.coverLetter && (
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-slate-500 block mb-1">Your Cover Letter:</span>
                    <p className="text-slate-700 italic bg-white p-3 rounded-lg border border-slate-200 leading-relaxed text-xs">
                      &ldquo;{existingProposal.coverLetter}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Close
                </button>
                <Link
                  href="/freelancer#proposals"
                  onClick={onClose}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  <span>Manage in Freelancer Hub</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : !isJobOwner && isSubmitted ? (
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xl font-bold text-slate-900">Proposal Sent Successfully!</h4>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Your proposal for <strong className="text-slate-800">{job.title}</strong> has been recorded {submissionSource === 'supabase' ? 'in the live database' : 'in the local demo session'}.
                </p>
              </div>

              {/* Status Indicator */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-center gap-2 max-w-md mx-auto">
                {submissionSource === 'supabase' ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span><strong className="text-emerald-700">Live Database Connected:</strong> Proposal persisted to Supabase PostgreSQL.</span>
                  </>
                ) : (
                  <span><strong>Local Session Mode:</strong> Proposal recorded in client state. Sign in with Supabase to submit live database bids.</span>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 max-w-md mx-auto text-left text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Your Bid Amount:</span>
                  <span className="font-semibold text-slate-900">
                    ${bidAmount} {job.budget.type === 'hourly' ? '/hr' : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimated Delivery:</span>
                  <span className="font-semibold text-slate-900">{deliveryDays} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="font-semibold text-emerald-700">Submitted to Client</span>
                </div>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/freelancer"
                  onClick={onClose}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-xs"
                >
                  <span>View in Freelancer Hub</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  onClick={onClose}
                  type="button"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50"
                >
                  Close Window
                </button>
              </div>
            </div>
          ) : !isJobOwner ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Client budget reference banner */}
              <div className="bg-emerald-50/70 border border-emerald-200/70 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="text-emerald-800 font-semibold">Client&apos;s Stated Budget:</span>
                  <span className="text-emerald-900 font-bold ml-1.5">
                    {job.budget.type === 'fixed'
                      ? `$${job.budget.fixedAmount?.toLocaleString()} (Fixed)`
                      : `$${job.budget.hourlyMin} - $${job.budget.hourlyMax}/hr (Hourly)`}
                  </span>
                </div>
                <span className="text-emerald-700 font-medium">10% Platform fee applies</span>
              </div>

              {/* Bid inputs grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bidAmountInput" className="block text-xs font-semibold uppercase text-slate-700 mb-1.5">
                    Your {job.budget.type === 'hourly' ? 'Hourly Rate ($/hr)' : 'Total Bid ($ USD)'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-medium text-sm">$</span>
                    <input
                      id="bidAmountInput"
                      type="number"
                      min="5"
                      step="5"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium text-slate-900"
                      placeholder="e.g. 2500"
                      required
                    />
                  </div>
                  {errors.bidAmount && (
                    <p className="text-xs text-rose-600 mt-1">{errors.bidAmount}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">
                    You will receive approx: <strong className="text-emerald-700 font-semibold">${freelancerReceives}</strong> (after $
                    {platformFee} fee)
                  </p>
                </div>

                <div>
                  <label htmlFor="deliveryDaysInput" className="block text-xs font-semibold uppercase text-slate-700 mb-1.5">
                    Estimated Timeline (Days)
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      id="deliveryDaysInput"
                      type="number"
                      min="1"
                      value={deliveryDays}
                      onChange={(e) => setDeliveryDays(Number(e.target.value))}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium text-slate-900"
                      placeholder="e.g. 14"
                      required
                    />
                  </div>
                  {errors.deliveryDays && (
                    <p className="text-xs text-rose-600 mt-1">{errors.deliveryDays}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">Turnaround for initial milestone</p>
                </div>
              </div>

              {/* Cover Letter */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="coverLetterInput" className="block text-xs font-semibold uppercase text-slate-700">
                    Cover Letter
                  </label>
                  <span
                    className={`text-[11px] font-medium ${
                      coverLetter.length >= 50 ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  >
                    {coverLetter.length} / 50 characters min
                  </span>
                </div>
                <textarea
                  id="coverLetterInput"
                  rows={5}
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  placeholder="Introduce yourself, describe your relevant experience with these exact technologies, and outline your approach to solving the client's problem..."
                  className="w-full p-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900 placeholder:text-slate-400 resize-y"
                  required
                />
                {errors.coverLetter && (
                  <p className="text-xs text-rose-600 mt-1">{errors.coverLetter}</p>
                )}
              </div>

              {/* Tips banner */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/60 flex items-start gap-2.5 text-xs text-slate-600">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Tip for winning proposals:</strong> Mention past projects in your portfolio that solve similar challenges and outline an immediate step you would take.
                </span>
              </div>

              {apiErrorMessage && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">Submission Error</span>
                    <span>{apiErrorMessage}</span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-sm shadow-emerald-600/20 transition-all disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Proposal</span>
                  )}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
