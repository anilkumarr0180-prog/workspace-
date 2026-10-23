'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import JobCard from '@/components/jobs/job-card';
import { ProposalRecord } from '@/lib/actions/proposals';
import { FreelancerDashboardResult } from '@/lib/actions/freelancer-dashboard';
import {
  Sparkles,
  Send,
  Bookmark,
  CheckCircle2,
  Clock,
  DollarSign,
  Briefcase,
  ChevronRight,
  AlertCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Award
} from 'lucide-react';

export default function FreelancerDashboardPage() {
  const [dashboardData, setDashboardData] = useState<FreelancerDashboardResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [refreshIndex, setRefreshIndex] = useState<number>(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4000);
  };

  // Fetch real freelancer dashboard data from Supabase
  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboard() {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch('/api/freelancer/dashboard');
        if (isCancelled) return;

        if (res.status === 401) {
          setFetchError('Please sign in to view your freelancer dashboard.');
          return;
        }

        const data: FreelancerDashboardResult = await res.json();
        if (isCancelled) return;

        if (res.ok && data.success) {
          setDashboardData(data);
        } else {
          setFetchError(data.error || 'Failed to retrieve freelancer dashboard data.');
        }
      } catch {
        if (!isCancelled) {
          setFetchError('Network error while connecting to Supabase database.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    fetchDashboard();

    return () => {
      isCancelled = true;
    };
  }, [refreshIndex]);

  const handleRefresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  // Withdraw proposal using genuine PATCH endpoint
  const handleWithdraw = async (proposalId: string) => {
    setUpdatingId(proposalId);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'withdrawn' }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.proposal) {
        setDashboardData((prev) => {
          if (!prev || !prev.proposals) return prev;
          const updated = prev.proposals.map((p) =>
            p.id === proposalId ? { ...p, status: 'withdrawn' as ProposalRecord['status'] } : p
          );
          const activeCount = updated.filter((p) => !['withdrawn', 'rejected'].includes(p.status)).length;
          return {
            ...prev,
            stats: prev.stats ? { ...prev.stats, activeProposals: activeCount } : undefined,
            proposals: updated,
          };
        });
        showToast('Proposal withdrawn successfully.');
      } else {
        showError(data.error || 'Failed to withdraw proposal.');
      }
    } catch {
      showError('Network error while withdrawing proposal.');
    } finally {
      setUpdatingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'interviewing':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
            Interviewing
          </span>
        );
      case 'accepted':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            Offer Accepted
          </span>
        );
      case 'under_review':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            Client Reviewing
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
            Declined
          </span>
        );
      case 'withdrawn':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700">
            Withdrawn
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            Submitted
          </span>
        );
    }
  };

  const proposals = dashboardData?.proposals || [];
  const savedJobs = dashboardData?.savedJobs || [];
  const recommendedJobs = dashboardData?.recommendedJobs || [];
  const recentActivity = dashboardData?.recentActivity || [];
  const stats = dashboardData?.stats || {
    submittedProposals: 0,
    activeProposals: 0,
    interviewingProposals: 0,
    acceptedProposals: 0,
    actualEarnings: 0,
    rating: 5.0,
    reviewCount: 0,
  };
  const profileCompletion = dashboardData?.profileCompletion ?? 0;
  const profileCompletionTips = dashboardData?.profileCompletionTips || [];
  const profile = dashboardData?.profile;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Talent Workspace
          </span>
          <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Freelancer Hub
            </h1>
            {dashboardData?.source === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL Verified
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {profile?.fullName ? `Welcome back, ${profile.fullName}. ` : ''}
            Track active proposals, monitor verified earnings, and discover recommended opportunities.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            type="button"
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all"
          >
            <Briefcase className="w-4 h-4" />
            <span>Search New Jobs</span>
          </Link>
        </div>
      </div>

      {/* Fetch Error Display */}
      {fetchError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-sm">Unable to Load Dashboard Data</h3>
              <p className="text-xs text-rose-700 mt-0.5">{fetchError}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition-colors"
            >
              Sign In
            </Link>
            <button
              onClick={handleRefresh}
              type="button"
              className="px-4 py-2 border border-rose-300 text-rose-800 rounded-xl text-xs font-semibold hover:bg-rose-100 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Overview Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Proposals
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.activeProposals}
                </span>
                <span className="text-xs text-emerald-600 font-semibold ml-2">Active pipeline</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Interviews
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.interviewingProposals}
                </span>
                <span className="text-xs text-blue-600 font-semibold ml-2">In progress</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Accepted Offers
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.acceptedProposals}
                </span>
                <span className="text-xs text-purple-600 font-semibold ml-2">Accepted bids</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Verified Earnings
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  ${stats.actualEarnings.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-medium ml-2">Platform total</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Proposals & Recommendations (Left) + Profile Meter & Activity (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Active Proposals Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <h2 className="text-base font-bold text-slate-900">Submitted Proposals</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  {proposals.length}
                </span>
              </div>
              <Link href="/jobs" className="text-xs font-semibold text-emerald-600 hover:underline">
                Find more jobs
              </Link>
            </div>

            {loading ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Retrieving active proposals...</p>
              </div>
            ) : proposals.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                  <Send className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">No Proposals Submitted Yet</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Submit customized bids to open projects matching your technical expertise.
                </p>
                <div className="pt-2">
                  <Link
                    href="/jobs"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors"
                  >
                    Browse Open Jobs
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {proposals.map((prop) => {
                  const canWithdraw = ['submitted', 'under_review', 'interviewing'].includes(prop.status);
                  const isUpdating = updatingId === prop.id;

                  return (
                    <div key={prop.id} className="p-5 hover:bg-slate-50/70 transition-colors space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h3 className="font-bold text-sm sm:text-base text-slate-900 hover:text-emerald-700 transition-colors">
                          <Link href={`/jobs/${prop.jobId}`}>{prop.jobTitle}</Link>
                        </h3>
                        <div className="shrink-0 flex items-center gap-2">
                          {getStatusBadge(prop.status)}
                          {canWithdraw && (
                            <button
                              onClick={() => handleWithdraw(prop.id)}
                              disabled={isUpdating}
                              type="button"
                              className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
                              title="Withdraw this proposal"
                            >
                              {isUpdating ? (
                                <div className="w-3 h-3 border border-slate-600 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5" />
                              )}
                              <span>Withdraw</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed italic bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        &ldquo;{prop.coverLetter}&rdquo;
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                        <div className="flex items-center gap-4">
                          <span>
                            Your Bid:{' '}
                            <strong className="text-slate-800">
                              ${prop.bidAmount} {prop.rateType === 'hourly' ? '/hr' : ''}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>Timeline: {prop.deliveryDays ?? 'Flexible'} days</span>
                          <span>•</span>
                          <span>Submitted: {prop.createdAt ? prop.createdAt.split('T')[0] : 'Recent'}</span>
                        </div>

                        <Link
                          href={`/jobs/${prop.jobId}`}
                          className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
                        >
                          <span>View Project Details</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recommended Opportunities */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">Recommended Opportunities</h2>
              </div>
              <Link href="/jobs" className="text-xs font-semibold text-emerald-600 hover:underline">
                Explore all jobs
              </Link>
            </div>

            {loading ? (
              <div className="p-8 text-center space-y-2">
                <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Finding recommended matches...</p>
              </div>
            ) : recommendedJobs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                <Briefcase className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">No Open Projects Available Right Now</p>
                <p className="text-[11px] text-slate-400">
                  Check back soon as employers post new requirements across specialized categories.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {recommendedJobs.map((recJob) => (
                  <JobCard key={recJob.id} job={recJob} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Profile Completion & Activity */}
        <div className="space-y-6">
          {/* Profile Completion Meter */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Profile Strength
              </span>
              <span className="text-xs font-extrabold text-emerald-600">
                {profileCompletion}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${profileCompletion}%` }}
              />
            </div>

            <div className="text-xs text-slate-600 space-y-2 pt-1">
              <span className="font-semibold text-slate-800 block">Checklist:</span>
              {profileCompletionTips.map((tip, idx) => (
                <div key={idx} className="flex items-start gap-2 text-slate-500">
                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>

            {profile?.username && (
              <div className="pt-2 border-t border-slate-100">
                <Link
                  href={`/freelancers/${profile.username}`}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 flex items-center justify-between"
                >
                  <span>View Your Public Profile</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>

          {/* Saved Jobs Quick Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                <Bookmark className="w-4 h-4 text-emerald-600" />
                <span>Saved Jobs ({savedJobs.length})</span>
              </div>
              <Link href="/saved" className="text-xs font-semibold text-emerald-600 hover:underline">
                View All
              </Link>
            </div>

            {loading ? (
              <div className="py-4 text-center">
                <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : savedJobs.length > 0 ? (
              <div className="space-y-3">
                {savedJobs.slice(0, 3).map((sJob) => (
                  <div key={sJob.id} className="text-xs space-y-1">
                    <Link
                      href={`/jobs/${sJob.id}`}
                      className="font-bold text-slate-900 hover:text-emerald-700 transition-colors line-clamp-1 block"
                    >
                      {sJob.title}
                    </Link>
                    <div className="text-slate-500 flex justify-between">
                      <span>{sJob.category}</span>
                      <span className="font-semibold text-slate-700">
                        {sJob.budget.type === 'fixed'
                          ? `$${sJob.budget.fixedAmount?.toLocaleString()}`
                          : `$${sJob.budget.hourlyMin}-$${sJob.budget.hourlyMax}/hr`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-3 space-y-1">
                <p className="text-xs text-slate-400">No jobs saved yet.</p>
                <Link href="/jobs" className="text-xs text-emerald-600 hover:underline inline-block font-medium">
                  Explore Open Jobs
                </Link>
              </div>
            )}
          </div>

          {/* Recent Activity Timeline */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900 pb-2 border-b border-slate-100">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>Recent Activity</span>
            </div>

            {loading ? (
              <div className="space-y-2 py-2">
                <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
              </div>
            ) : recentActivity.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">
                No recent activity yet. When you submit proposals or bookmark listings, your activity timeline will show up here.
              </p>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((item) => (
                  <div key={item.id} className="text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{item.title}</span>
                      <span className="text-[11px] text-slate-400">{item.timestamp}</span>
                    </div>
                    {item.link ? (
                      <Link href={item.link} className="text-slate-600 hover:text-emerald-700 leading-relaxed block">
                        {item.description}
                      </Link>
                    ) : (
                      <p className="text-slate-600 leading-relaxed">{item.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-2 text-xs">
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px] block">
              Quick Shortcuts
            </span>
            <div className="space-y-1.5 pt-1">
              <Link href="/jobs" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Browse All Contracts
              </Link>
              <Link href="/freelancers" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Explore Peers & Specialists
              </Link>
              <Link href="/saved" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Manage Bookmarked Listings
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
