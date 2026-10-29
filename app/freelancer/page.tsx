'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ProposalRecord } from '@/lib/actions/proposals';
import { FreelancerDashboardResult } from '@/lib/actions/freelancer-dashboard';
import {
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
  Award,
  Layers,
  ArrowRight,
  Star,
  UserCheck,
  FileCheck2,
  Building2,
  Sparkles,
  Eye
} from 'lucide-react';
import ProposalDetailsModal from '@/components/jobs/proposal-details-modal';

export default function FreelancerDashboardPage() {
  const [dashboardData, setDashboardData] = useState<FreelancerDashboardResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeProposalTab, setActiveProposalTab] = useState<'all' | 'pending' | 'interviewing' | 'accepted' | 'archived'>('all');
  const [refreshIndex, setRefreshIndex] = useState<number>(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Proposal details view state
  const [selectedProposalForDetails, setSelectedProposalForDetails] = useState<ProposalRecord | null>(null);
  const [isProposalDetailsOpen, setIsProposalDetailsOpen] = useState<boolean>(false);

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

  // Handle direct navigation to #proposals: smooth scroll and refresh proposal data
  useEffect(() => {
    const checkAndFocusProposals = () => {
      if (typeof window !== 'undefined' && window.location.hash === '#proposals') {
        const el = document.getElementById('proposals');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
        handleRefresh();
      }
    };

    // Run on initial page load if targeted at #proposals
    checkAndFocusProposals();

    const handleRefreshEvent = () => {
      const el = document.getElementById('proposals');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
      handleRefresh();
    };

    window.addEventListener('hashchange', checkAndFocusProposals);
    window.addEventListener('refresh-freelancer-proposals', handleRefreshEvent);

    return () => {
      window.removeEventListener('hashchange', checkAndFocusProposals);
      window.removeEventListener('refresh-freelancer-proposals', handleRefreshEvent);
    };
  }, [handleRefresh]);

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
          const pendingCount = updated.filter((p) => p.status === 'submitted' || p.status === 'under_review').length;
          const interviewingCount = updated.filter((p) => p.status === 'interviewing').length;

          return {
            ...prev,
            stats: prev.stats
              ? {
                  ...prev.stats,
                  activeProposals: activeCount,
                  pendingProposals: pendingCount,
                  interviewingProposals: interviewingCount,
                }
              : undefined,
            proposals: updated,
          };
        });

        // Sync proposal details modal if currently open for this proposal
        setSelectedProposalForDetails((prev) =>
          prev && prev.id === proposalId ? { ...prev, status: 'withdrawn' as ProposalRecord['status'] } : prev
        );

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

  const proposals = useMemo(() => dashboardData?.proposals || [], [dashboardData?.proposals]);
  const savedJobs = dashboardData?.savedJobs || [];
  const recommendedJobs = dashboardData?.recommendedJobs || [];
  const recentActivity = dashboardData?.recentActivity || [];
  const stats = dashboardData?.stats || {
    submittedProposals: 0,
    pendingProposals: 0,
    activeProposals: 0,
    interviewingProposals: 0,
    acceptedProposals: 0,
    activeContracts: 0,
    actualEarnings: 0,
    rating: 5.0,
    reviewCount: 0,
  };
  const profileCompletion = dashboardData?.profileCompletion ?? 0;
  const profileCompletionTips = dashboardData?.profileCompletionTips || [];
  const profile = dashboardData?.profile;

  // Filter proposals according to active tab
  const filteredProposals = useMemo(() => {
    switch (activeProposalTab) {
      case 'pending':
        return proposals.filter((p) => p.status === 'submitted' || p.status === 'under_review');
      case 'interviewing':
        return proposals.filter((p) => p.status === 'interviewing');
      case 'accepted':
        return proposals.filter((p) => p.status === 'accepted');
      case 'archived':
        return proposals.filter((p) => p.status === 'withdrawn' || p.status === 'rejected');
      default:
        return proposals;
    }
  }, [proposals, activeProposalTab]);

  const archivedProposalsCount = useMemo(
    () => proposals.filter((p) => p.status === 'withdrawn' || p.status === 'rejected').length,
    [proposals]
  );

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
            Track active proposals, monitor verified earnings, and discover genuine opportunities.
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
            href="/freelancer/time-tracking"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-semibold text-xs transition-colors shadow-2xs"
            title="Open Hourly Work Diary & Time Tracker"
          >
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Time Tracker</span>
          </Link>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all"
          >
            <Briefcase className="w-4 h-4" />
            <span>Search New Jobs</span>
          </Link>
          <Link
            href="/client"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs transition-colors"
            title="Switch to Client / Employer Control Center"
          >
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Employer Mode</span>
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

      {/* Genuine Statistics Cards (Never fabricated) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total Submitted */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Submitted
            </span>
            <div className="w-7 h-7 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
              <Send className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-12 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  {stats.submittedProposals}
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">Total bids submitted</p>
              </>
            )}
          </div>
        </div>

        {/* Pending & Under Review */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
              Pending
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-12 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  {stats.pendingProposals}
                </span>
                <p className="text-[11px] text-amber-600 mt-0.5">Awaiting review</p>
              </>
            )}
          </div>
        </div>

        {/* Interviews */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
              Interviews
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <FileCheck2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-12 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  {stats.interviewingProposals}
                </span>
                <p className="text-[11px] text-blue-600 mt-0.5">Active discussions</p>
              </>
            )}
          </div>
        </div>

        {/* Accepted Offers */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700">
              Accepted
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Award className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-12 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  {stats.acceptedProposals}
                </span>
                <p className="text-[11px] text-purple-600 mt-0.5">Client accepted</p>
              </>
            )}
          </div>
        </div>

        {/* Active Contracts */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Contracts
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-12 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  {stats.activeContracts}
                </span>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-[11px] text-emerald-600">Active projects</p>
                  <Link
                    href="/freelancer/time-tracking"
                    className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5"
                  >
                    <span>Track time</span>
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Verified Actual Earnings */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Earnings
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2.5">
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl font-extrabold text-slate-900">
                  ${stats.actualEarnings.toLocaleString()}
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">Verified payments</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Proposals & Recommendations (Left) + Profile Meter & Activity (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Submitted Proposals Section */}
          <div id="proposals" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-24">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <h2 className="text-base font-bold text-slate-900">Your Proposals</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  {proposals.length}
                </span>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActiveProposalTab('all')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    activeProposalTab === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  All ({proposals.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProposalTab('pending')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    activeProposalTab === 'pending'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Pending ({stats.pendingProposals})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProposalTab('interviewing')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    activeProposalTab === 'interviewing'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Interviews ({stats.interviewingProposals})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProposalTab('accepted')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    activeProposalTab === 'accepted'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Accepted ({stats.acceptedProposals})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveProposalTab('archived')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    activeProposalTab === 'archived'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Archived ({archivedProposalsCount})
                </button>
              </div>
            </div>

            {loading ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Retrieving proposal records from Supabase...</p>
              </div>
            ) : filteredProposals.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                  <Send className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {proposals.length === 0 ? 'No Proposals Submitted Yet' : 'No Proposals in This Status'}
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {proposals.length === 0
                    ? 'Search for active projects matching your technical stack and submit tailored bids.'
                    : 'Switch tabs above to view other proposals in your pipeline.'}
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
                {filteredProposals.map((prop) => {
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

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProposalForDetails(prop);
                          setIsProposalDetailsOpen(true);
                        }}
                        className="w-full text-left group cursor-pointer"
                        title="Click to view full proposal and cover letter"
                      >
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed italic bg-slate-50 p-2.5 rounded-lg border border-slate-100 group-hover:bg-emerald-50/50 group-hover:border-emerald-200 transition-colors">
                          &ldquo;{prop.coverLetter}&rdquo;
                        </p>
                      </button>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span>
                            Your Bid:{' '}
                            <strong className="text-slate-800">
                              ${prop.bidAmount} {prop.rateType === 'hourly' ? '/hr' : ''}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>Timeline: <strong>{prop.deliveryDays ?? 'Flexible'} days</strong></span>
                          <span>•</span>
                          <span>
                            Submitted:{' '}
                            <strong>{prop.createdAt ? new Date(prop.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {prop.status === 'accepted' && (
                            <Link
                              href={prop.rateType === 'hourly' ? '/freelancer/time-tracking' : '/contracts'}
                              className="text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors flex items-center gap-1"
                            >
                              {prop.rateType === 'hourly' ? (
                                <>
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>Track Hourly Time</span>
                                </>
                              ) : (
                                <>
                                  <Layers className="w-3.5 h-3.5" />
                                  <span>Manage Contract & Milestones</span>
                                </>
                              )}
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProposalForDetails(prop);
                              setIsProposalDetailsOpen(true);
                            }}
                            className="text-xs font-semibold text-slate-700 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-500" />
                            <span>View Proposal</span>
                          </button>
                          <Link
                            href={`/jobs/${prop.jobId}`}
                            className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
                          >
                            <span>View Job Details</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recommended Opportunities (Genuine Database Jobs Only) */}
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
                <p className="text-xs text-slate-500">Searching genuine published listings...</p>
              </div>
            ) : recommendedJobs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                <Briefcase className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">No Open Projects Available Right Now</p>
                <p className="text-[11px] text-slate-400">
                  Check back soon as clients post new verified contracts across your specialty areas.
                </p>
                <div className="pt-2">
                  <Link
                    href="/jobs"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors"
                  >
                    View All Marketplace Jobs
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {recommendedJobs.map((recJob) => (
                  <div
                    key={recJob.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-emerald-300 hover:shadow-sm transition-all space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <span className="font-semibold text-emerald-700">{recJob.category}</span>
                          <span>•</span>
                          <span>Posted {recJob.postedAt}</span>
                          {recJob.isFeatured && (
                            <>
                              <span>•</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                Featured
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="font-bold text-base text-slate-900 hover:text-emerald-700 transition-colors">
                          <Link href={`/jobs/${recJob.id}`}>{recJob.title}</Link>
                        </h3>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-base font-extrabold text-slate-900 block">
                          {recJob.budget.type === 'fixed'
                            ? `$${recJob.budget.fixedAmount?.toLocaleString()}`
                            : `$${recJob.budget.hourlyMin}-$${recJob.budget.hourlyMax}/hr`}
                        </span>
                        <span className="text-[11px] text-slate-500 capitalize">{recJob.projectType} price</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {recJob.description}
                    </p>

                    {recJob.skills && recJob.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {recJob.skills.map((skill) => (
                          <span
                            key={skill}
                            className="px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-2 text-slate-500">
                        <span>{recJob.client.name}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-slate-600">
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                          <span>{recJob.client.rating.toFixed(1)}</span>
                        </span>
                        <span>•</span>
                        <span>{recJob.client.location}</span>
                      </div>

                      <Link
                        href={`/jobs/${recJob.id}`}
                        className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:text-emerald-800 transition-colors"
                      >
                        <span>Apply Now</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Profile Completion, Saved Jobs, Activity */}
        <div className="space-y-6">
          {/* Profile Strength & Verification */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Profile Strength</span>
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

          {/* Genuine Recent Activity Timeline */}
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
              <p className="text-xs text-slate-400 py-2 leading-relaxed">
                No recent activity yet. When you submit proposals or bookmark listings, your genuine activity timeline will appear here.
              </p>
            ) : (
              <div className="space-y-3.5">
                {recentActivity.map((item) => (
                  <div key={item.id} className="text-xs space-y-0.5">
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
                • Browse All Project Listings
              </Link>
              <Link href="/saved" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Manage Bookmarked Listings
              </Link>
              {profile?.username && (
                <Link href={`/freelancers/${profile.username}`} className="block text-slate-700 hover:text-emerald-700 font-medium">
                  • View Public Freelancer Profile
                </Link>
              )}
              <Link href="/freelancers" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Explore Peers & Specialists Directory
              </Link>
              <Link href="/client" className="block text-slate-700 hover:text-emerald-700 font-medium">
                • Switch to Client / Employer Mode
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Freelancer Proposal Details Modal */}
      {selectedProposalForDetails && (
        <ProposalDetailsModal
          proposal={selectedProposalForDetails}
          isOpen={isProposalDetailsOpen}
          onClose={() => {
            setIsProposalDetailsOpen(false);
            setSelectedProposalForDetails(null);
          }}
          mode="freelancer"
          onWithdraw={handleWithdraw}
        />
      )}
    </div>
  );
}
