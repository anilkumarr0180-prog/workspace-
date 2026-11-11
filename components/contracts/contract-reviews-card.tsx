'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Star,
  Lock,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';
import { getContractReviewsStatus } from '@/lib/actions/reviews';
import { ContractReviewsStatusResult } from '@/lib/types';
import EndContractModal from '@/components/contracts/end-contract-modal';

interface ContractReviewsCardProps {
  contractId: string;
  contractTitle: string;
  contractStatus: string;
  isClient: boolean;
  otherPartyName: string;
  otherPartyAvatar?: string | null;
  currentUserName: string;
}

export default function ContractReviewsCard({
  contractId,
  contractTitle,
  contractStatus,
  isClient,
  otherPartyName,
  otherPartyAvatar,
  currentUserName,
}: ContractReviewsCardProps) {
  const [data, setData] = useState<ContractReviewsStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function fetchReviews() {
      try {
        const res = await getContractReviewsStatus(contractId);
        if (!isCancelled) {
          if (res.success) {
            setData(res);
          }
        }
      } catch {
        // Silently catch network errors
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    fetchReviews();

    return () => {
      isCancelled = true;
    };
  }, [contractId, reloadKey]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse space-y-4">
        <div className="w-48 h-5 bg-slate-200 rounded" />
        <div className="w-full h-20 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  const myReview = data?.myReview;
  const otherReview = data?.otherReview;
  const bothSubmitted = data?.bothSubmitted || (Boolean(myReview) && Boolean(otherReview?.isPublic));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              Upwork Double-Blind Feedback
            </span>
            {bothSubmitted ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Published
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Blind Review Period
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
              Contract {contractStatus}
            </span>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mt-0.5">
            Contract Feedback &amp; Ratings
          </h3>
        </div>

        {!myReview && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer self-start sm:self-auto"
          >
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Leave Feedback</span>
          </button>
        )}
      </div>

      {/* STATE 1: User has NOT submitted feedback */}
      {!myReview && (
        <div className="p-5 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-3">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-950 space-y-1">
              <span className="font-bold text-sm block">
                Feedback Required to View Ratings
              </span>
              <p className="text-amber-800 leading-relaxed">
                This contract has ended. Workspace uses a double-blind system to keep reviews authentic. Leave your feedback for {otherPartyName} to complete the contract and view feedback given to you.
              </p>
            </div>
          </div>
          <div className="pt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors shadow-xs cursor-pointer"
            >
              <Star className="w-3.5 h-3.5 fill-white" />
              <span>Leave Feedback for {otherPartyName}</span>
            </button>
          </div>
        </div>
      )}

      {/* STATE 2: User submitted, but other party has not yet submitted */}
      {myReview && !bothSubmitted && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 space-y-1">
              <span className="font-bold text-emerald-950 block">
                Your Feedback Has Been Submitted
              </span>
              <p className="text-slate-600 leading-relaxed">
                Thank you! Your feedback is securely locked. To keep ratings impartial, neither score will be revealed until {otherPartyName} submits their feedback, or after 14 days have passed.
              </p>
            </div>
          </div>

          {/* User's Submitted Review Preview */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">
                  Your Review of {otherPartyName}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                  Pending Reveal
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span className="text-xs font-extrabold text-slate-900">
                  {myReview.rating?.toFixed(1)}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-600 italic">
              &quot;{myReview.feedbackText}&quot;
            </p>
          </div>
        </div>
      )}

      {/* STATE 3: Both parties submitted & feedback is published */}
      {bothSubmitted && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: My Review */}
          {myReview && (
            <div className="p-5 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Given by {currentUserName || 'You'}
                  </span>
                  <span className="text-xs font-bold text-slate-900">
                    Review for {otherPartyName}
                  </span>
                </div>
                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span className="text-xs font-extrabold text-slate-900">
                    {myReview.rating?.toFixed(1)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                &quot;{myReview.feedbackText}&quot;
              </p>

              {myReview.scores && Object.keys(myReview.scores).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Object.entries(myReview.scores).map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white text-[10px] font-medium text-slate-600 border border-slate-200/60"
                    >
                      <span className="capitalize">{k}:</span>
                      <span className="font-bold text-slate-900">{v}/5</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Card 2: Other Party's Review */}
          {otherReview && otherReview.isPublic && (
            <div className="p-5 bg-emerald-50/40 rounded-2xl border border-emerald-200/60 space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-emerald-200/40">
                <div className="flex items-center gap-2.5">
                  {otherPartyAvatar ? (
                    <Image
                      src={otherPartyAvatar}
                      alt={otherPartyName}
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded-full object-cover border border-emerald-200"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                      {otherPartyName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block">
                      Received Feedback
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      {otherPartyName}&apos;s Review of You
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-emerald-200">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span className="text-xs font-extrabold text-slate-900">
                    {otherReview.rating?.toFixed(1)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                &quot;{otherReview.feedbackText}&quot;
              </p>

              {otherReview.scores && Object.keys(otherReview.scores).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Object.entries(otherReview.scores).map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white text-[10px] font-medium text-slate-600 border border-emerald-200/60"
                    >
                      <span className="capitalize">{k}:</span>
                      <span className="font-bold text-slate-900">{v}/5</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal for leaving feedback */}
      <EndContractModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        contractId={contractId}
        contractTitle={contractTitle}
        isClient={isClient}
        otherPartyName={otherPartyName}
        onSuccess={() => {
          setLoading(true);
          setReloadKey((prev) => prev + 1);
        }}
      />
    </div>
  );
}
