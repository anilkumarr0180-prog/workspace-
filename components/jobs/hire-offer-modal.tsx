'use client';

import React, { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ProposalRecord } from '@/lib/actions/proposals';
import { createContractOffer } from '@/lib/actions/contracts';
import { ProjectType } from '@/lib/types';
import {
  X,
  Briefcase,
  DollarSign,
  Clock,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Send,
} from 'lucide-react';

interface HireOfferModalProps {
  proposal: ProposalRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onOfferSent?: (contractId: string) => void;
}

export default function HireOfferModal({
  proposal,
  isOpen,
  onClose,
  onOfferSent,
}: HireOfferModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Offer fields
  const [contractType, setContractType] = useState<ProjectType>(
    proposal?.rateType || 'fixed'
  );
  const [title, setTitle] = useState(proposal?.jobTitle || 'Contract');
  const [hourlyRate, setHourlyRate] = useState<string>(
    proposal?.rateType === 'hourly' ? String(proposal.bidAmount) : '45'
  );
  const [fixedPrice, setFixedPrice] = useState<string>(
    proposal?.rateType === 'fixed' ? String(proposal.bidAmount) : '500'
  );
  const [weeklyLimit, setWeeklyLimit] = useState<number>(40);
  const [allowManualTime, setAllowManualTime] = useState(true);
  const [offerMessage, setOfferMessage] = useState('');

  if (!isOpen || !proposal) return null;

  const freelancerInitials = (proposal.freelancerName || 'F')
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'FL';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const isHourly = contractType === 'hourly';
    const rateNum = isHourly ? Number(hourlyRate) : null;
    const fixedNum = !isHourly ? Number(fixedPrice) : null;

    if (isHourly && (!rateNum || rateNum <= 0)) {
      setErrorMessage('Please specify a valid hourly rate greater than $0.');
      return;
    }

    if (!isHourly && (!fixedNum || fixedNum <= 0)) {
      setErrorMessage('Please specify a valid fixed price greater than $0.');
      return;
    }

    startTransition(async () => {
      try {
        const res = await createContractOffer({
          proposalId: proposal.id,
          contractType,
          title: title.trim(),
          hourlyRate: rateNum,
          fixedPrice: fixedNum,
          weeklyHourLimit: isHourly ? weeklyLimit : null,
          allowManualTime,
          offerMessage: offerMessage.trim() || undefined,
        });

        if (!res.success || !res.contractId) {
          setErrorMessage(res.error || 'Failed to send contract offer.');
          return;
        }

        setSuccessMessage('Contract offer sent successfully! Waiting for freelancer acceptance.');
        onOfferSent?.(res.contractId);

        setTimeout(() => {
          onClose();
          router.push(`/contracts/${res.contractId}`);
        }, 1200);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error sending offer.';
        setErrorMessage(msg);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs animate-fadeIn overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Send Contract Offer</h2>
              <p className="text-xs text-slate-500">Hire specialist with agreed terms &amp; escrow</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Error / Success Alerts */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs sm:text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs sm:text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Freelancer Profile Summary Card */}
          <div className="flex items-center gap-3.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
            <div className="relative shrink-0">
              {proposal.freelancerAvatar ? (
                <Image
                  src={proposal.freelancerAvatar}
                  alt={proposal.freelancerName || 'Freelancer'}
                  width={44}
                  height={44}
                  unoptimized
                  className="w-11 h-11 rounded-xl object-cover border border-slate-300"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-2xs">
                  {freelancerInitials}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 text-sm truncate">
                {proposal.freelancerName || `@${proposal.freelancerUsername}`}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {proposal.freelancerTitle || 'Specialized Talent'}
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs text-slate-400 block font-medium">Proposal Bid</span>
              <span className="text-sm font-extrabold text-slate-900">
                ${proposal.bidAmount}
                {proposal.rateType === 'hourly' ? '/hr' : ''}
              </span>
            </div>
          </div>

          {/* Contract Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Contract Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={5}
              maxLength={150}
              placeholder="e.g. Next.js Frontend Development"
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
            />
          </div>

          {/* Contract Type Tabs */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Contract Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setContractType('hourly')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  contractType === 'hourly'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>Hourly Rate</span>
              </button>

              <button
                type="button"
                onClick={() => setContractType('fixed')}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  contractType === 'fixed'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                }`}
              >
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <span>Fixed Price (Escrow)</span>
              </button>
            </div>
          </div>

          {/* Hourly Fields */}
          {contractType === 'hourly' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Hourly Rate ($ / hr) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-sm font-bold text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="1000"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    required
                    placeholder="45.00"
                    className="w-full pl-8 pr-12 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-semibold"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs text-slate-400 font-medium">
                    / hr
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Weekly Limit</label>
                <select
                  value={weeklyLimit}
                  onChange={(e) => setWeeklyLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 bg-white"
                >
                  <option value={10}>10 hrs / week (Minimal)</option>
                  <option value={20}>20 hrs / week (Part-time)</option>
                  <option value={30}>30 hrs / week</option>
                  <option value={40}>40 hrs / week (Full-time)</option>
                  <option value={50}>50 hrs / week</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allowManualTime}
                    onChange={(e) => setAllowManualTime(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Allow freelancer to log time manually if needed</span>
                </label>
              </div>
            </div>
          )}

          {/* Fixed Price Fields */}
          {contractType === 'fixed' && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Total Project Price ($) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-sm font-bold text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="5"
                    max="100000"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    required
                    placeholder="500"
                    className="w-full pl-8 pr-12 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-semibold"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs text-slate-400 font-medium">
                    USD
                  </span>
                </div>
              </div>

              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>
                  Workspace Escrow: An initial milestone of <strong>${fixedPrice || '0'}</strong> will be
                  prepared. You can fund this milestone securely via Razorpay once the freelancer accepts your offer.
                </span>
              </div>
            </div>
          )}

          {/* Offer Memo */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Message to Freelancer (Optional)
            </label>
            <textarea
              rows={3}
              value={offerMessage}
              onChange={(e) => setOfferMessage(e.target.value)}
              maxLength={1500}
              placeholder="Introduce your team, confirm milestone expectations, or provide onboarding repository links..."
              className="w-full p-3 rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 leading-relaxed"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-xs shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{isPending ? 'Sending Offer...' : 'Send Formal Offer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
