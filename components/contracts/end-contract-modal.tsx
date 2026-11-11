'use client';

import React, { useState } from 'react';
import {
  X,
  Star,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { endContractAndSubmitReview } from '@/lib/actions/reviews';
import { ReviewDimensionScores } from '@/lib/types';

interface EndContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  contractTitle: string;
  isClient: boolean;
  otherPartyName: string;
  onSuccess: () => void;
}

const CLIENT_REASONS = [
  { value: 'completed_successfully', label: 'Completed project successfully' },
  { value: 'milestones_completed', label: 'All milestones completed and approved' },
  { value: 'requirements_changed', label: 'Project scope / requirements changed' },
  { value: 'skills_mismatch', label: 'Skills did not match expectations' },
  { value: 'freelancer_unresponsive', label: 'Freelancer became unresponsive' },
  { value: 'other', label: 'Other / Mutual agreement' },
];

const FREELANCER_REASONS = [
  { value: 'completed_successfully', label: 'Completed work successfully' },
  { value: 'client_schedule_changed', label: 'Client schedule or priorities shifted' },
  { value: 'differing_expectations', label: 'Scope or requirements differed from initial agreement' },
  { value: 'client_unresponsive', label: 'Client became unresponsive' },
  { value: 'other', label: 'Other / Mutual agreement' },
];

const DIMENSIONS_CLIENT = [
  { key: 'skills', label: 'Skills & Technical Expertise' },
  { key: 'quality', label: 'Quality of Delivered Work' },
  { key: 'communication', label: 'Communication & Responsiveness' },
  { key: 'deadlines', label: 'Adherence to Deadlines' },
  { key: 'cooperation', label: 'Cooperation & Flexibility' },
];

const DIMENSIONS_FREELANCER = [
  { key: 'clarity', label: 'Clear Requirements & Project Guidance' },
  { key: 'communication', label: 'Communication & Prompt Answers' },
  { key: 'deadlines', label: 'Reasonable Deadlines & Timelines' },
  { key: 'cooperation', label: 'Fairness & Cooperation' },
];

export default function EndContractModal({
  isOpen,
  onClose,
  contractId,
  contractTitle,
  isClient,
  otherPartyName,
  onSuccess,
}: EndContractModalProps) {
  const [reason, setReason] = useState('completed_successfully');
  const [overallRating, setOverallRating] = useState(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  // Dimension scores (default 5)
  const [dimScores, setDimScores] = useState<Record<string, number>>(() => {
    const list = isClient ? DIMENSIONS_CLIENT : DIMENSIONS_FREELANCER;
    const initial: Record<string, number> = {};
    for (const d of list) {
      initial[d.key] = 5;
    }
    return initial;
  });

  const [npsScore, setNpsScore] = useState<number>(10);
  const [feedbackText, setFeedbackText] = useState('');
  const [privateFeedback, setPrivateFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const reasonsList = isClient ? CLIENT_REASONS : FREELANCER_REASONS;
  const dimensionsList = isClient ? DIMENSIONS_CLIENT : DIMENSIONS_FREELANCER;

  const handleScoreChange = (dimKey: string, score: number) => {
    setDimScores((prev) => ({ ...prev, [dimKey]: score }));
  };

  const getStarRatingLabel = (val: number) => {
    switch (val) {
      case 5:
        return '5.0 - Exceptional Quality';
      case 4:
        return '4.0 - Great Collaboration';
      case 3:
        return '3.0 - Met Basic Expectations';
      case 2:
        return '2.0 - Below Expectations';
      case 1:
        return '1.0 - Unacceptable Quality';
      default:
        return `${val}.0`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (feedbackText.trim().length < 5) {
      setError('Please provide at least a short review comment (minimum 5 characters).');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await endContractAndSubmitReview({
        contractId,
        endReason: reason,
        rating: overallRating,
        feedbackText: feedbackText.trim(),
        scores: dimScores as ReviewDimensionScores,
        privateNps: npsScore,
        privateFeedback: privateFeedback.trim() || undefined,
      });

      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.error || 'Failed to submit review and end contract.');
      }
    } catch {
      setError('Network error while submitting feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                End Contract
              </span>
              <span className="text-[10px] font-semibold text-slate-500">
                Upwork Two-Sided Feedback
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              End Contract with {otherPartyName}
            </h2>
            <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">
              {contractTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Double-Blind Callout */}
        <div className="mx-6 mt-6 p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 space-y-1">
            <span className="font-bold text-emerald-950 block">
              Double-Blind Honest Feedback Policy
            </span>
            <p className="text-slate-600 leading-relaxed">
              To guarantee objective, unpressured reviews, feedback is kept blind. Neither you nor {otherPartyName} will see each other’s rating until both have submitted, or 14 days pass.
            </p>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Reason Section */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-900">
              Reason for ending contract <span className="text-rose-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            >
              {reasonsList.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Section: Private Feedback (NPS) */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 block flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  Private Platform Feedback
                </span>
                <span className="text-[11px] text-slate-500">
                  This score is never revealed to {otherPartyName}. It factors into the platform&apos;s Job Success calculations.
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <label className="text-[11px] font-semibold text-slate-700 block">
                How likely are you to recommend {otherPartyName} to a colleague? (1 = Not likely, 10 = Extremely likely)
              </label>
              <div className="flex items-center gap-1 sm:gap-1.5 justify-between">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => {
                  const isSelected = npsScore === score;
                  let colorClass = 'bg-white text-slate-700 border-slate-200 hover:border-slate-300';
                  if (isSelected) {
                    if (score >= 9) colorClass = 'bg-emerald-600 text-white border-emerald-600 shadow-xs';
                    else if (score >= 7) colorClass = 'bg-amber-500 text-white border-amber-500 shadow-xs';
                    else colorClass = 'bg-rose-500 text-white border-rose-500 shadow-xs';
                  }

                  return (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setNpsScore(score)}
                      className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${colorClass}`}
                    >
                      {score}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold px-0.5">
                <span>Not likely</span>
                <span>Neutral</span>
                <span>Extremely likely</span>
              </div>
            </div>

            <div className="pt-2">
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Private notes for Workspace (Optional)
              </label>
              <textarea
                value={privateFeedback}
                onChange={(e) => setPrivateFeedback(e.target.value)}
                placeholder="Any confidential feedback or context you want our team to know..."
                rows={2}
                className="w-full text-xs bg-white border border-slate-200 rounded-xl p-2.5 text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Section: Public Feedback */}
          <div className="space-y-4 pt-1">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Public Feedback
              </h3>
              <p className="text-[11px] text-slate-500">
                This review will be published on {otherPartyName}&apos;s public profile once both parties have submitted feedback.
              </p>
            </div>

            {/* Overall Star Rating */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-slate-900 block">
                  Overall Star Rating <span className="text-rose-500">*</span>
                </span>
                <span className="text-xs font-semibold text-emerald-700">
                  {getStarRatingLabel(hoverRating || overallRating)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => {
                  const activeVal = hoverRating || overallRating;
                  const isFilled = star <= activeVal;

                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      onClick={() => setOverallRating(star)}
                      className="p-1 cursor-pointer transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-7 h-7 transition-colors ${
                          isFilled
                            ? 'text-amber-400 fill-amber-400 drop-shadow-xs'
                            : 'text-slate-200 hover:text-amber-200'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dimension Breakdown */}
            <div className="space-y-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Detailed Dimension Ratings
              </span>
              <div className="space-y-2">
                {dimensionsList.map((dim) => {
                  const currentScore = dimScores[dim.key] || 5;

                  return (
                    <div
                      key={dim.key}
                      className="flex items-center justify-between p-2.5 bg-slate-50/60 rounded-xl border border-slate-100"
                    >
                      <span className="text-xs font-medium text-slate-700">
                        {dim.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => handleScoreChange(dim.key, s)}
                            className="p-0.5 cursor-pointer"
                          >
                            <Star
                              className={`w-4 h-4 transition-colors ${
                                s <= currentScore
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-slate-200'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Public Review Written Comments */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-900">
                  Public Review Comments <span className="text-rose-500">*</span>
                </label>
                <span className="text-[10px] text-slate-400">
                  {feedbackText.length} characters (min 5)
                </span>
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder={`Share your experience working with ${otherPartyName}. Highlight communication, deliverables, technical capability, and cooperation...`}
                rows={4}
                required
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Submitting Feedback...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>End Contract &amp; Submit Review</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
