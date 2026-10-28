'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ProposalRecord } from '@/lib/actions/proposals';
import { ClientDashboardResult, ClientJobSummary, ClientDashboardActivity } from '@/lib/actions/client';
import {
  Briefcase,
  Users,
  DollarSign,
  PlusCircle,
  CheckCircle2,
  Eye,
  Activity,
  ChevronRight,
  AlertCircle,
  Clock,
  FileText,
  Archive,
  RefreshCw,
  X,
  ExternalLink,
  Layers
} from 'lucide-react';
import ProposalDetailsModal from '@/components/jobs/proposal-details-modal';
import ContactModal from '@/components/freelancers/contact-modal';

export default function ClientDashboardPage() {
  const [dashboardData, setDashboardData] = useState<ClientDashboardResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'published' | 'proposals' | 'drafts' | 'completed'>('published');
  const [toastMessage, setToastMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [updatingProposalId, setUpdatingProposalId] = useState<string | null>(null);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);

  // Job-specific proposal review state with server ownership verification
  const [selectedJobFilter, setSelectedJobFilter] = useState<{ id: string; title: string } | null>(null);
  const [jobSpecificProposals, setJobSpecificProposals] = useState<ProposalRecord[] | null>(null);
  const [loadingJobProposals, setLoadingJobProposals] = useState<boolean>(false);
  const [jobProposalsError, setJobProposalsError] = useState<string | null>(null);

  // Proposal review modal & contact state
  const [selectedProposalForReview, setSelectedProposalForReview] = useState<ProposalRecord | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [contactFreelancer, setContactFreelancer] = useState<{
    username: string;
    name?: string;
    fullName?: string;
    avatarUrl?: string | null;
    title?: string | null;
    hourlyRate?: number | null;
  } | null>(null);

  // Server-verified job proposals fetcher
  const handleViewJobProposals = useCallback(async (job: { id: string; title: string }) => {
    setSelectedJobFilter(job);
    setActiveTab('proposals');
    setLoadingJobProposals(true);
    setJobProposalsError(null);

    try {
      const res = await fetch(`/api/proposals?jobId=${job.id}&as=client`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.proposals)) {
        setJobSpecificProposals(data.proposals);
      } else {
        setJobProposalsError(data.error || 'Failed to retrieve proposals for this project.');
      }
    } catch {
      setJobProposalsError('Network error while retrieving job proposals.');
    } finally {
      setLoadingJobProposals(false);
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(''), 4000);
  };

  const [refreshIndex, setRefreshIndex] = useState(0);

  // Fetch real client dashboard data from Supabase
  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboard() {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch('/api/client/dashboard');
        if (isCancelled) return;

        if (res.status === 401) {
          setFetchError('Please sign in to view your employer control center.');
          return;
        }

        const data: ClientDashboardResult = await res.json();
        if (isCancelled) return;

        if (res.ok && data.success) {
          setDashboardData(data);
        } else {
          setFetchError(data.error || 'Failed to retrieve client dashboard records.');
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


  // Toggle Job Status (Pause / Reopen) against real database
  const handleToggleJobStatus = async (jobId: string, currentStatus: string) => {
    setUpdatingJobId(jobId);
    const newStatus = currentStatus === 'published' ? 'cancelled' : 'published';

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setDashboardData((prev) => {
          if (!prev || !prev.jobs) return prev;
          const updatedJobs = prev.jobs.all.map((j) =>
            j.id === jobId ? { ...j, status: newStatus as ClientJobSummary['status'] } : j
          );
          const published = updatedJobs.filter((j) => j.status === 'published' || j.status === 'cancelled' || j.status === 'in_progress');
          const drafts = updatedJobs.filter((j) => j.status === 'draft');
          const completed = updatedJobs.filter((j) => j.status === 'completed');
          const activeJobsCount = updatedJobs.filter((j) => j.status === 'published').length;

          return {
            ...prev,
            stats: prev.stats ? { ...prev.stats, activeJobs: activeJobsCount } : undefined,
            jobs: {
              published,
              drafts,
              completed,
              all: updatedJobs,
            },
          };
        });

        showToast(
          newStatus === 'published'
            ? 'Job listing reopened and published successfully.'
            : 'Job listing paused from public directory.'
        );
      } else {
        showError(data.error || 'Failed to update job status.');
      }
    } catch {
      showError('Network error while updating job status.');
    } finally {
      setUpdatingJobId(null);
    }
  };

  // Update proposal status adhering to state machine
  const handleUpdateProposalStatus = async (proposalId: string, newStatus: string) => {
    setUpdatingProposalId(proposalId);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.proposal) {
        setDashboardData((prev) => {
          if (!prev || !prev.proposals) return prev;
          const updatedProposals = prev.proposals.map((p) =>
            p.id === proposalId ? { ...p, status: newStatus as ProposalRecord['status'] } : p
          );
          const hiredCount = updatedProposals.filter((p) => p.status === 'accepted').length;

          return {
            ...prev,
            stats: prev.stats ? { ...prev.stats, hiredTalent: hiredCount } : undefined,
            proposals: updatedProposals,
          };
        });

        // Sync job-specific proposal view if active
        setJobSpecificProposals((prev) =>
          prev ? prev.map((p) => (p.id === proposalId ? { ...p, status: newStatus as ProposalRecord['status'] } : p)) : null
        );

        // Sync currently opened review modal if matching
        setSelectedProposalForReview((prev) =>
          prev && prev.id === proposalId ? { ...prev, status: newStatus as ProposalRecord['status'] } : prev
        );

        showToast(`Proposal updated to "${newStatus.replace('_', ' ')}".`);
      } else {
        showError(data.error || 'Failed to update proposal status.');
      }
    } catch {
      showError('Network error while updating proposal status.');
    } finally {
      setUpdatingProposalId(null);
    }
  };

  const getProposalStatusBadge = (status: string) => {
    switch (status) {
      case 'under_review':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Under Review</span>;
      case 'interviewing':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">Interviewing</span>;
      case 'accepted':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Offer Accepted</span>;
      case 'rejected':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">Declined</span>;
      case 'withdrawn':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700">Withdrawn</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">Submitted</span>;
    }
  };

  const publishedJobs = dashboardData?.jobs?.published || [];
  const draftJobs = dashboardData?.jobs?.drafts || [];
  const completedJobs = dashboardData?.jobs?.completed || [];
  const proposals = dashboardData?.proposals || [];
  const displayedProposals = selectedJobFilter
    ? (jobSpecificProposals ?? proposals.filter((p) => p.jobId === selectedJobFilter.id))
    : proposals;
  const stats = dashboardData?.stats || {
    activeJobs: 0,
    proposalsReceived: 0,
    hiredTalent: 0,
    totalSpend: 0,
  };
  const recentActivity: ClientDashboardActivity[] = dashboardData?.recentActivity || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast banner */}
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
            Employer Control Center
          </span>
          <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Client Dashboard
            </h1>
            {dashboardData?.source === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL Verified
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {dashboardData?.client?.fullName ? `Welcome back, ${dashboardData.client.fullName}. ` : ''}
            Manage your open listings, evaluate proposals, and collaborate with your team.
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
            href="/client/jobs/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Post a New Job</span>
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

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Jobs
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.activeJobs}
                </span>
                <span className="text-xs text-emerald-600 font-semibold ml-2">Open for bids</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedJobFilter(null);
            setJobSpecificProposals(null);
            setJobProposalsError(null);
            setActiveTab('proposals');
          }}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-blue-300 transition-colors text-left w-full cursor-pointer"
          title="View all proposals received"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Proposals
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.proposalsReceived}
                </span>
                <span className="text-xs text-blue-600 font-semibold ml-2">Received</span>
              </>
            )}
          </div>
        </button>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Hired Talent
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {stats.hiredTalent}
                </span>
                <span className="text-xs text-slate-500 font-medium ml-2">Accepted offers</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Spend
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  ${stats.totalSpend.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-medium ml-2">Verified spend</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Section: Job Listings Table (Left) + Recent Activity Feed (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column (2 cols): Job Management */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Tabs */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveTab('published')}
                  type="button"
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'published'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Published Listings ({publishedJobs.length})
                </button>
                <button
                  onClick={() => {
                    setSelectedJobFilter(null);
                    setJobSpecificProposals(null);
                    setJobProposalsError(null);
                    setActiveTab('proposals');
                  }}
                  type="button"
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'proposals' && !selectedJobFilter
                      ? 'bg-slate-900 text-white'
                      : activeTab === 'proposals'
                      ? 'bg-slate-200 text-slate-800'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Proposals Received ({proposals.length})
                </button>
                <button
                  onClick={() => setActiveTab('drafts')}
                  type="button"
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'drafts'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Drafts ({draftJobs.length})
                </button>
                <button
                  onClick={() => setActiveTab('completed')}
                  type="button"
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'completed'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Archived / Completed ({completedJobs.length})
                </button>
              </div>

              <Link
                href="/client/jobs/new"
                className="text-xs font-bold text-emerald-600 hover:text-emerald-800 hidden sm:flex items-center gap-1"
              >
                <span>+ Create</span>
              </Link>
            </div>

            {/* Tab content */}
            {loading ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Loading client dashboard from Supabase...</p>
              </div>
            ) : (
              <>
                {/* Published Listings Tab */}
                {activeTab === 'published' && (
                  <div>
                    {publishedJobs.length === 0 ? (
                      <div className="p-12 text-center space-y-4">
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                          <Briefcase className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm font-bold text-slate-900">No Published Job Listings</h3>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            You have not published any job posts yet. Publish a new project to start receiving bids from qualified freelancers.
                          </p>
                        </div>
                        <Link
                          href="/client/jobs/new"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>Post Your First Job</span>
                        </Link>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {publishedJobs.map((job) => {
                          const isPaused = job.status === 'cancelled';
                          const isUpdating = updatingJobId === job.id;
                          return (
                            <div
                              key={job.id}
                              className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                      isPaused
                                        ? 'bg-slate-200 text-slate-700'
                                        : 'bg-emerald-100 text-emerald-800'
                                    }`}
                                  >
                                    {isPaused ? 'Paused' : 'Active'}
                                  </span>
                                  <span className="text-xs text-slate-400">Posted {job.postedAt}</span>
                                  <span className="text-xs text-slate-400">•</span>
                                  <span className="text-xs font-medium text-slate-600">{job.category}</span>
                                </div>

                                <h3 className="font-bold text-sm sm:text-base text-slate-900 hover:text-emerald-700 transition-colors">
                                  <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                                </h3>

                                <div className="flex items-center gap-4 text-xs text-slate-500">
                                  <span>
                                    Budget:{' '}
                                    <strong className="text-slate-800">
                                      {job.budget.type === 'fixed'
                                        ? `$${job.budget.fixedAmount?.toLocaleString()}`
                                        : `$${job.budget.hourlyMin}-$${job.budget.hourlyMax}/hr`}
                                    </strong>
                                  </span>
                                  <span>•</span>
                                  <button
                                    type="button"
                                    onClick={() => handleViewJobProposals({ id: job.id, title: job.title })}
                                    className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1.5 cursor-pointer text-left transition-colors group/prop py-0.5 rounded focus:outline-hidden"
                                    title={`View verified proposals received for "${job.title}"`}
                                  >
                                    <Users className="w-3.5 h-3.5 text-emerald-600 group-hover/prop:scale-110 transition-transform" />
                                    <span>
                                      {job.proposalCount} {job.proposalCount === 1 ? 'proposal' : 'proposals'} received
                                    </span>
                                    <ChevronRight className="w-3 h-3 text-emerald-600 group-hover/prop:translate-x-0.5 transition-transform" />
                                  </button>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 shrink-0">
                                <Link
                                  href={`/jobs/${job.id}`}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors flex items-center gap-1.5"
                                  title={`View full job details for "${job.title}"`}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View Job</span>
                                </Link>

                                <button
                                  onClick={() => handleToggleJobStatus(job.id, job.status)}
                                  disabled={isUpdating}
                                  type="button"
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                                >
                                  {isUpdating ? 'Updating...' : isPaused ? 'Reopen' : 'Pause'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Proposals Received Tab */}
                {activeTab === 'proposals' && (
                  <div>
                    {/* Active Job Filter Header Banner */}
                    {selectedJobFilter && (
                      <div className="p-4 bg-emerald-50/80 border-b border-emerald-100 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                          <span className="text-xs text-emerald-800 font-semibold">Proposals for:</span>
                          <span className="text-xs font-bold text-slate-900 truncate max-w-sm">
                            {selectedJobFilter.title}
                          </span>
                          {!loadingJobProposals && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                              {(jobSpecificProposals ?? proposals.filter((p) => p.jobId === selectedJobFilter.id)).length}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedJobFilter(null);
                            setJobSpecificProposals(null);
                            setJobProposalsError(null);
                          }}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <span>Show All Jobs ({proposals.length})</span>
                          <X className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      </div>
                    )}

                    {/* Job Specific Loading State */}
                    {loadingJobProposals ? (
                      <div className="p-12 text-center space-y-3">
                        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                        <p className="text-xs text-slate-500 font-medium">
                          Verifying ownership and retrieving proposals for &ldquo;{selectedJobFilter?.title}&rdquo;...
                        </p>
                      </div>
                    ) : jobProposalsError ? (
                      /* Job Specific Error State */
                      <div className="p-6 m-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-3">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <h4 className="font-bold text-sm">Failed to Load Job Proposals</h4>
                            <p className="text-xs text-rose-700">{jobProposalsError}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          {selectedJobFilter && (
                            <button
                              type="button"
                              onClick={() => handleViewJobProposals(selectedJobFilter)}
                              className="px-3.5 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition-colors cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedJobFilter(null);
                              setJobSpecificProposals(null);
                              setJobProposalsError(null);
                            }}
                            className="px-3.5 py-1.5 border border-rose-300 text-rose-800 rounded-lg text-xs font-semibold hover:bg-rose-100 transition-colors cursor-pointer"
                          >
                            View All Proposals
                          </button>
                        </div>
                      </div>
                    ) : displayedProposals.length === 0 ? (
                      <div className="p-12 text-center space-y-3">
                        <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                          <Users className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {selectedJobFilter
                            ? `No Proposals Received for "${selectedJobFilter.title}" Yet`
                            : 'No Proposals Received Yet'}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          {selectedJobFilter
                            ? 'When talent applies to this active project, their bids and qualifications will appear here for review.'
                            : 'When talent applies to your active project listings, their bids and qualifications will appear here for review.'}
                        </p>
                        {selectedJobFilter && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedJobFilter(null);
                                setJobSpecificProposals(null);
                              }}
                              className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                            >
                              View All Proposals ({proposals.length})
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {displayedProposals.map((prop) => {
                          const isUpdating = updatingProposalId === prop.id;
                          return (
                            <div key={prop.id} className="p-5 hover:bg-slate-50/70 transition-colors space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {prop.freelancerUsername ? (
                                      <Link
                                        href={`/freelancers/${prop.freelancerUsername}`}
                                        className="font-bold text-sm text-slate-900 hover:text-emerald-700 hover:underline transition-colors flex items-center gap-1"
                                        title={`View public profile for ${prop.freelancerName}`}
                                      >
                                        <span>{prop.freelancerName || 'Candidate Specialist'}</span>
                                        <ExternalLink className="w-3 h-3 text-slate-400" />
                                      </Link>
                                    ) : (
                                      <span className="font-bold text-sm text-slate-900">
                                        {prop.freelancerName || 'Candidate Specialist'}
                                      </span>
                                    )}
                                    <span className="text-xs text-slate-400">• applied for</span>
                                    <Link
                                      href={`/jobs/${prop.jobId}`}
                                      className="text-xs font-semibold text-emerald-700 hover:underline"
                                    >
                                      {prop.jobTitle || 'Project Listing'}
                                    </Link>
                                  </div>
                                </div>
                                <div className="shrink-0">{getProposalStatusBadge(prop.status)}</div>
                              </div>

                              <div
                                onClick={() => {
                                  setSelectedProposalForReview(prop);
                                  setIsReviewModalOpen(true);
                                }}
                                className="cursor-pointer group"
                                title="Click to open full proposal details and cover letter"
                              >
                                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed italic bg-slate-50 group-hover:bg-slate-100/80 p-2.5 rounded-lg border border-slate-100 group-hover:border-slate-200 transition-colors">
                                  &ldquo;{prop.coverLetter}&rdquo;
                                </p>
                              </div>

                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs">
                                <div className="flex items-center gap-4 text-slate-500">
                                  <span>
                                    Bid:{' '}
                                    <strong className="text-slate-800">
                                      ${prop.bidAmount} {prop.rateType === 'hourly' ? '/hr' : ''}
                                    </strong>
                                  </span>
                                  <span>•</span>
                                  <span>
                                    Delivery: <strong>{prop.deliveryDays ?? 'Flexible'} days</strong>
                                  </span>
                                </div>

                                {/* Review Proposal and Status transition controls */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedProposalForReview(prop);
                                      setIsReviewModalOpen(true);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                    title="View full proposal, cover letter, and candidate details"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Review Proposal</span>
                                  </button>

                                  {prop.status === 'submitted' && (
                                    <>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'under_review')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        {isUpdating ? 'Updating...' : 'Mark Under Review'}
                                      </button>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'interviewing')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        Interview
                                      </button>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        Decline
                                      </button>
                                    </>
                                  )}

                                  {prop.status === 'under_review' && (
                                    <>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'interviewing')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        {isUpdating ? 'Updating...' : 'Interview'}
                                      </button>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'accepted')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        Accept Offer
                                      </button>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        Decline
                                      </button>
                                    </>
                                  )}

                                  {prop.status === 'interviewing' && (
                                    <>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'accepted')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        {isUpdating ? 'Updating...' : 'Accept Offer'}
                                      </button>
                                      <button
                                        onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                        disabled={isUpdating}
                                        type="button"
                                        className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        Decline
                                      </button>
                                    </>
                                  )}

                                  {prop.status === 'accepted' ? (
                                    <Link
                                      href="/contracts"
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold transition-colors"
                                    >
                                      <Layers className="w-3.5 h-3.5" />
                                      <span>View Contract & Milestones</span>
                                    </Link>
                                  ) : ['rejected', 'withdrawn'].includes(prop.status) ? (
                                    <span className="text-[11px] text-slate-400 italic">Terminal Status</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Drafts Tab */}
                {activeTab === 'drafts' && (
                  <div>
                    {draftJobs.length === 0 ? (
                      <div className="p-12 text-center space-y-3">
                        <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                          <FileText className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">No Saved Drafts</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          You don&apos;t have any unpublished job drafts. Any saved draft projects will appear here for you to finalize and publish.
                        </p>
                        <Link
                          href="/client/jobs/new"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>Start a New Job</span>
                        </Link>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {draftJobs.map((draft) => (
                          <div
                            key={draft.id}
                            className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
                                  Draft
                                </span>
                                <span className="text-xs text-slate-400">Created {draft.postedAt}</span>
                                <span className="text-xs text-slate-400">•</span>
                                <span className="text-xs font-medium text-slate-600">{draft.category}</span>
                              </div>
                              <h3 className="font-bold text-sm sm:text-base text-slate-900">{draft.title}</h3>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                href={`/client/jobs/new`}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                              >
                                Continue Editing
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Archived / Completed Tab */}
                {activeTab === 'completed' && (
                  <div>
                    {completedJobs.length === 0 ? (
                      <div className="p-12 text-center space-y-3">
                        <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                          <Archive className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">No Completed Projects Yet</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          Once your hired freelancers complete their contract deliverables and you finalize payment, the completed records will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {completedJobs.map((job) => (
                          <div
                            key={job.id}
                            className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-800">
                                  Completed
                                </span>
                                <span className="text-xs text-slate-400">Archived {job.postedAt}</span>
                                <span className="text-xs text-slate-400">•</span>
                                <span className="text-xs font-medium text-slate-600">{job.category}</span>
                              </div>
                              <h3 className="font-bold text-sm sm:text-base text-slate-900">{job.title}</h3>
                            </div>
                            <Link
                              href={`/jobs/${job.id}`}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors flex items-center gap-1.5 shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View Archive</span>
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Activity Feed */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900 pb-2 border-b border-slate-100">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>Recent Activity</span>
            </div>

            {loading ? (
              <div className="space-y-3 py-2">
                <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                <div className="h-4 bg-slate-100 rounded animate-pulse w-4/5 pt-2" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-1/3" />
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">No Recent Activity</p>
                <p className="text-[11px] text-slate-400">
                  Your recent job postings and proposal updates will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((act) => (
                  <div key={act.id} className="text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{act.title}</span>
                      <span className="text-[11px] text-slate-400">{act.timestamp}</span>
                    </div>
                    {act.link ? (
                      <Link href={act.link} className="text-slate-600 hover:text-emerald-700 leading-relaxed block">
                        {act.description}
                      </Link>
                    ) : (
                      <p className="text-slate-600 leading-relaxed">{act.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              <Link
                href="/freelancers"
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 flex items-center justify-between"
              >
                <span>Find more talent for your team</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Quick Post CTA banner */}
          <div className="bg-gradient-to-br from-emerald-800 to-teal-900 rounded-2xl p-6 text-white space-y-3">
            <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">
              Need specialized skills?
            </span>
            <h4 className="font-extrabold text-lg leading-tight">
              Post another project in under 3 minutes
            </h4>
            <p className="text-xs text-emerald-100 leading-relaxed">
              Describe your requirements and start receiving tailored proposals from vetted experts today.
            </p>
            <div className="pt-2">
              <Link
                href="/client/jobs/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-white text-emerald-900 font-bold text-xs rounded-xl hover:bg-emerald-50 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Post a Job Free</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Proposal Details & Review Modal */}
      {selectedProposalForReview && (
        <ProposalDetailsModal
          proposal={selectedProposalForReview}
          isOpen={isReviewModalOpen}
          onClose={() => {
            setIsReviewModalOpen(false);
            setSelectedProposalForReview(null);
          }}
          mode="client"
          onUpdateStatus={handleUpdateProposalStatus}
          onOpenContact={(freelancer) => setContactFreelancer(freelancer)}
        />
      )}

      {/* Direct Freelancer Contact Modal */}
      {contactFreelancer && (
        <ContactModal
          freelancer={contactFreelancer}
          isOpen={Boolean(contactFreelancer)}
          onClose={() => setContactFreelancer(null)}
        />
      )}
    </div>
  );
}
