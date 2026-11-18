'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
  Calendar,
  FileText,
  Archive,
  RefreshCw,
  X,
  ExternalLink,
  Layers,
  MessageSquare,
  XCircle,
  FileEdit,
  Sparkles
} from 'lucide-react';
import ProposalDetailsModal from '@/components/jobs/proposal-details-modal';
import ContactModal from '@/components/freelancers/contact-modal';
import HireOfferModal from '@/components/jobs/hire-offer-modal';

const DASHBOARD_CACHE_KEY = 'workspace_client_dashboard_cache';

export default function ClientDashboardPage() {
  const router = useRouter();
  const [dashboardData, setDashboardData] = useState<ClientDashboardResult | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cached) return JSON.parse(cached);
      } catch {
        // Safe cache fallback
      }
    }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return !sessionStorage.getItem(DASHBOARD_CACHE_KEY);
      } catch {
        return true;
      }
    }
    return true;
  });
  const [isRevalidating, setIsRevalidating] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'published' | 'proposals' | 'drafts' | 'completed'>('published');
  const [toastMessage, setToastMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);

  // Upwork Candidate Pipeline state
  const [pipelineFilter, setPipelineFilter] = useState<'all' | 'under_review' | 'interviewing' | 'hired' | 'archived'>('all');

  // Hire offer modal state
  const [proposalForHire, setProposalForHire] = useState<ProposalRecord | null>(null);
  const [isHireModalOpen, setIsHireModalOpen] = useState(false);

  // Decline dialog state
  const [proposalToDecline, setProposalToDecline] = useState<ProposalRecord | null>(null);
  const [isDeclineDialogOpen, setIsDeclineDialogOpen] = useState(false);
  const [declineReasonOption, setDeclineReasonOption] = useState<string>('Candidate skills do not align with project requirements');
  const [customDeclineReason, setCustomDeclineReason] = useState<string>('');
  const [isDecliningCandidate, setIsDecliningCandidate] = useState(false);

  // Job-specific proposal review state with server ownership verification
  const [selectedJobFilter, setSelectedJobFilter] = useState<{ id: string; title: string } | null>(null);
  const [jobSpecificProposals, setJobSpecificProposals] = useState<ProposalRecord[] | null>(null);
  const [loadingJobProposals, setLoadingJobProposals] = useState<boolean>(false);
  const [jobProposalsError, setJobProposalsError] = useState<string | null>(null);

  // Proposal review modal & contact state
  const [selectedProposalForReview, setSelectedProposalForReview] = useState<ProposalRecord | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [contactFreelancer, setContactFreelancer] = useState<{
    id?: string;
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

    // Instantly show already-fetched proposals from dashboard data if available
    const existing = dashboardData?.proposals?.filter((p) => p.jobId === job.id);
    if (existing && existing.length > 0) {
      setJobSpecificProposals(existing);
      setJobProposalsError(null);
      return;
    }

    setLoadingJobProposals(true);
    setJobProposalsError(null);

    try {
      const res = await fetch(`/api/proposals?jobId=${job.id}&as=client`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.proposals)) {
        setJobSpecificProposals(data.proposals);
      } else {
        // Fallback to client proposals in memory if API call fails
        if (dashboardData?.proposals) {
          const matched = dashboardData.proposals.filter((p) => p.jobId === job.id);
          setJobSpecificProposals(matched);
        } else {
          setJobProposalsError(data.error || 'Failed to retrieve proposals for this project.');
        }
      }
    } catch {
      if (dashboardData?.proposals) {
        const matched = dashboardData.proposals.filter((p) => p.jobId === job.id);
        setJobSpecificProposals(matched);
      } else {
        setJobProposalsError('Network error while retrieving job proposals.');
      }
    } finally {
      setLoadingJobProposals(false);
    }
  }, [dashboardData]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(''), 4000);
  };

  const [refreshIndex, setRefreshIndex] = useState(0);

  const hasCachedData = useRef(!!dashboardData);
  useEffect(() => {
    if (dashboardData) {
      hasCachedData.current = true;
    }
  }, [dashboardData]);

  // Fetch real client dashboard data from Supabase
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 12000);

    async function fetchDashboard() {
      if (!hasCachedData.current) {
        setLoading(true);
      }
      setIsRevalidating(true);
      setFetchError(null);
      try {
        const res = await fetch('/api/client/dashboard', {
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (isCancelled) return;

        if (res.status === 401) {
          setFetchError('Please sign in to view your employer control center.');
          return;
        }

        const data: ClientDashboardResult = await res.json();
        if (isCancelled) return;

        if (res.ok && data.success) {
          setDashboardData(data);
          hasCachedData.current = true;
          try {
            sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data));
          } catch {
            // Safe fallback if sessionStorage is restricted or full
          }
        } else {
          if (!hasCachedData.current) {
            setFetchError(data.error || 'Failed to retrieve client dashboard records.');
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          if (err instanceof Error && err.name === 'AbortError') {
            console.warn('[CLIENT DASHBOARD] Request timed out, displaying cached records.');
          } else if (!hasCachedData.current) {
            setFetchError('Network error while connecting to Supabase database.');
          }
        }
      } finally {
        clearTimeout(timeoutId);
        if (!isCancelled) {
          setLoading(false);
          setIsRevalidating(false);
        }
      }
    }

    fetchDashboard();

    const onWindowFocus = () => {
      fetchDashboard();
    };
    window.addEventListener('focus', onWindowFocus);

    return () => {
      isCancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [refreshIndex]);

  const handleRefresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  // Real-time listener: Auto-update client dashboard when freelancer submits proposal or accepts contract offer
  useEffect(() => {
    // 1. Listen for cross-component notification events dispatched by NotificationPopover
    const onNotificationReceived = (e: Event) => {
      const customEvent = e as CustomEvent<{ type?: string; message?: string }>;
      const item = customEvent.detail;
      if (item?.type === 'proposal_received' || item?.type === 'contract_offer_accepted') {
        setRefreshIndex((prev) => prev + 1);
        try {
          sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
        } catch {
          // Safe fallback
        }
        setToastMessage(item.type === 'contract_offer_accepted' ? 'Contract offer accepted! Talent hired.' : 'New proposal received!');
        setTimeout(() => setToastMessage(''), 4000);
      }
    };

    window.addEventListener('workspace-notification-received', onNotificationReceived);

    // 2. Direct Supabase Realtime subscription on proposals & contracts tables
    const supabase = createClient();
    const channel = supabase
      .channel('client-dashboard-realtime-events')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proposals',
        },
        (payload: { eventType?: string }) => {
          setRefreshIndex((prev) => prev + 1);
          try {
            sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
          } catch {
            // Safe fallback
          }
          if (payload.eventType === 'INSERT') {
            setToastMessage('New proposal submitted by freelancer!');
            setTimeout(() => setToastMessage(''), 4000);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contracts',
        },
        (payload: { eventType?: string; new?: Record<string, unknown> }) => {
          setRefreshIndex((prev) => prev + 1);
          try {
            sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
          } catch {
            // Safe fallback
          }
          if (payload.new && (payload.new.status === 'active' || payload.new.status === 'completed')) {
            setToastMessage('Contract offer accepted! Talent hired.');
            setTimeout(() => setToastMessage(''), 4000);
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('workspace-notification-received', onNotificationReceived);
      supabase.removeChannel(channel);
    };
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
          const hiredCount = updatedProposals.filter(
            (p) => p.status === 'accepted' || p.contractStatus === 'active' || p.contractStatus === 'completed'
          ).length;

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

        try {
          sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
        } catch {
          // Safe fallback
        }

        showToast(`Proposal updated to "${newStatus.replace('_', ' ')}".`);
      } else {
        showError(data.error || 'Failed to update proposal status.');
      }
    } catch {
      showError('Network error while updating proposal status.');
    }
  };

  // Open Review modal and automatically transition newly submitted proposals to 'under_review'
  const handleOpenReviewModal = (prop: ProposalRecord) => {
    setSelectedProposalForReview(prop);
    setIsReviewModalOpen(true);

    if (prop.status === 'submitted') {
      handleUpdateProposalStatus(prop.id, 'under_review');
    }
  };

  // Candidate pipeline decline with reason handler
  const handleDeclineProposalWithReason = async (proposalId: string, reason?: string) => {
    setIsDecliningCandidate(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDashboardData((prev) => {
          if (!prev?.proposals) return prev;
          return {
            ...prev,
            proposals: prev.proposals.map((p) =>
              p.id === proposalId ? { ...p, status: 'rejected', declinedReason: reason } : p
            ),
          };
        });
        setJobSpecificProposals((prev) =>
          prev ? prev.map((p) => (p.id === proposalId ? { ...p, status: 'rejected', declinedReason: reason } : p)) : null
        );
        setSelectedProposalForReview((prev) =>
          prev && prev.id === proposalId ? { ...prev, status: 'rejected', declinedReason: reason } : prev
        );
        setIsDeclineDialogOpen(false);
        setProposalToDecline(null);
        showToast('Candidate proposal declined.');
      } else {
        showError(data.error || 'Failed to decline proposal.');
      }
    } catch {
      showError('Network error while declining candidate.');
    } finally {
      setIsDecliningCandidate(false);
    }
  };

  // Upwork interview start and messaging handler
  const handleStartInterviewAndChat = async (proposal: ProposalRecord) => {
    try {
      if (proposal.status === 'submitted' || proposal.status === 'under_review') {
        await handleUpdateProposalStatus(proposal.id, 'interviewing');
      }

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const data = await res.json();
      if (res.ok && data.conversationId) {
        router.push(`/messages/${data.conversationId}`);
        return;
      }
      if (proposal.freelancerUsername || proposal.freelancerId) {
        setContactFreelancer({
          id: proposal.freelancerId,
          username: proposal.freelancerUsername || 'specialist',
          fullName: proposal.freelancerName,
          avatarUrl: proposal.freelancerAvatar,
          title: proposal.freelancerTitle,
        });
      }
    } catch {
      if (proposal.freelancerUsername || proposal.freelancerId) {
        setContactFreelancer({
          id: proposal.freelancerId,
          username: proposal.freelancerUsername || 'specialist',
          fullName: proposal.freelancerName,
          avatarUrl: proposal.freelancerAvatar,
          title: proposal.freelancerTitle,
        });
      }
    }
  };

  const getProposalStatusBadge = (status: string, contractStatus?: string | null) => {
    if (contractStatus === 'pending_offer') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>Offer Sent</span>
        </span>
      );
    }
    if (contractStatus === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Hired</span>
        </span>
      );
    }
    switch (status) {
      case 'under_review':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>Under Review</span>
          </span>
        );
      case 'interviewing':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>In Discussions</span>
          </span>
        );
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Offer Accepted</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Declined</span>
          </span>
        );
      case 'withdrawn':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <span>Withdrawn</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <span>Submitted</span>
          </span>
        );
    }
  };

  const publishedJobs = dashboardData?.jobs?.published || [];
  const draftJobs = dashboardData?.jobs?.drafts || [];
  const completedJobs = dashboardData?.jobs?.completed || [];
  const proposals = dashboardData?.proposals || [];
  const rawDisplayedProposals = selectedJobFilter
    ? (jobSpecificProposals ?? proposals.filter((p) => p.jobId === selectedJobFilter.id))
    : proposals;

  const isCandidateHired = (p: ProposalRecord) =>
    p.status === 'accepted' || p.contractStatus === 'active' || p.contractStatus === 'completed';

  const countAll = rawDisplayedProposals.filter((p) => p.status !== 'rejected' && p.status !== 'withdrawn').length;
  const countUnderReview = rawDisplayedProposals.filter((p) => p.status === 'under_review' && !isCandidateHired(p)).length;
  const countInterviewing = rawDisplayedProposals.filter(
    (p) => p.status === 'interviewing' && !isCandidateHired(p)
  ).length;
  const countHired = rawDisplayedProposals.filter((p) => isCandidateHired(p)).length;
  const countArchived = rawDisplayedProposals.filter((p) => p.status === 'rejected' || p.status === 'withdrawn').length;

  const displayedProposals = rawDisplayedProposals.filter((p) => {
    if (pipelineFilter === 'under_review') {
      return p.status === 'under_review' && !isCandidateHired(p);
    }
    if (pipelineFilter === 'interviewing') {
      return p.status === 'interviewing' && !isCandidateHired(p);
    }
    if (pipelineFilter === 'hired') {
      return isCandidateHired(p);
    }
    if (pipelineFilter === 'archived') {
      return p.status === 'rejected' || p.status === 'withdrawn';
    }
    return p.status !== 'rejected' && p.status !== 'withdrawn';
  });

  const dynamicHiredCount = Math.max(dashboardData?.stats?.hiredTalent || 0, countHired);
  const stats = {
    activeJobs: dashboardData?.stats?.activeJobs || 0,
    proposalsReceived: dashboardData?.stats?.proposalsReceived || 0,
    hiredTalent: dynamicHiredCount,
    totalSpend: dashboardData?.stats?.totalSpend || 0,
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
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Employer Control Center</span>
              <span className="text-emerald-500">•</span>
              <span className="text-emerald-200/80">Live Marketplace</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white">
              {dashboardData?.client?.fullName
                ? `Welcome back, ${dashboardData.client.fullName}`
                : 'Client Dashboard'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Manage your open listings, evaluate proposals, hire elite independent talent, and collaborate seamlessly with your active team.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
            <button
              onClick={handleRefresh}
              type="button"
              disabled={loading && !dashboardData}
              className="p-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-all duration-200 disabled:opacity-50 cursor-pointer backdrop-blur-md hover:scale-105 active:scale-95"
              title="Refresh dashboard data"
            >
              <RefreshCw className={`w-4 h-4 ${isRevalidating || loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/client/jobs/new"
              className="inline-flex items-center gap-2.5 px-5 sm:px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all duration-200 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 stroke-[2.5]" />
              <span>Post a New Job</span>
            </Link>
          </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-6">
        {/* Card 1: Active Jobs */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Jobs
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-100 transition-all duration-300 shadow-2xs">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            {loading && !dashboardData ? (
              <div className="h-9 w-20 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  {stats.activeJobs}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Open for bids
                </span>
              </>
            )}
          </div>
        </div>

        {/* Card 2: Proposals Received (Interactive Button) */}
        <button
          type="button"
          onClick={() => {
            setSelectedJobFilter(null);
            setJobSpecificProposals(null);
            setJobProposalsError(null);
            setActiveTab('proposals');
          }}
          className="relative overflow-hidden rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 hover:border-blue-300/80 transition-all duration-300 group text-left w-full cursor-pointer"
          title="Click to view all proposals received"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Proposals
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-blue-100 transition-all duration-300 shadow-2xs">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            {loading && !dashboardData ? (
              <div className="h-9 w-20 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  {stats.proposalsReceived}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform">
                  <span>View bids</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </>
            )}
          </div>
        </button>

        {/* Card 3: Hired Talent */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-violet-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Hired Talent
            </span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-purple-100 transition-all duration-300 shadow-2xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            {loading && !dashboardData ? (
              <div className="h-9 w-20 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  {stats.hiredTalent}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200/60">
                  Accepted offers
                </span>
              </>
            )}
          </div>
        </div>

        {/* Card 4: Total Spend */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 sm:p-6 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Spend
            </span>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-100 transition-all duration-300 shadow-2xs">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            {loading && !dashboardData ? (
              <div className="h-9 w-24 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  ${stats.totalSpend.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-medium ml-2">Verified spend</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Section: Job Listings Table (Left) + Recent Activity Feed (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (8 cols): Job & Candidate Management */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.05)] overflow-hidden">
            {/* Tabs Header */}
            <div className="p-3 sm:p-4 border-b border-slate-200/80 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="bg-slate-200/70 p-1 rounded-2xl flex items-center gap-1 overflow-x-auto max-w-full">
                <button
                  onClick={() => setActiveTab('published')}
                  type="button"
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-2 ${
                    activeTab === 'published'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <span>Published Listings</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === 'published'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-300/80 text-slate-700'
                    }`}
                  >
                    {publishedJobs.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setSelectedJobFilter(null);
                    setJobSpecificProposals(null);
                    setJobProposalsError(null);
                    setActiveTab('proposals');
                  }}
                  type="button"
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-2 ${
                    activeTab === 'proposals' && !selectedJobFilter
                      ? 'bg-white text-slate-900 shadow-sm'
                      : activeTab === 'proposals'
                      ? 'bg-white/80 text-slate-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <span>Proposals Received</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === 'proposals'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-300/80 text-slate-700'
                    }`}
                  >
                    {proposals.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('drafts')}
                  type="button"
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-2 ${
                    activeTab === 'drafts'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <span>Drafts</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === 'drafts'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-300/80 text-slate-700'
                    }`}
                  >
                    {draftJobs.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('completed')}
                  type="button"
                  className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer flex items-center gap-2 ${
                    activeTab === 'completed'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <span>Archived</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === 'completed'
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-300/80 text-slate-700'
                    }`}
                  >
                    {completedJobs.length}
                  </span>
                </button>
              </div>

              <Link
                href="/client/jobs/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 text-xs font-bold transition-colors shrink-0 self-end sm:self-center"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ Create</span>
              </Link>
            </div>

            {/* Tab content */}
            {loading && !dashboardData ? (
              <div className="p-16 text-center space-y-4">
                <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-semibold text-slate-500">Loading client dashboard...</p>
              </div>
            ) : (
              <>
                {/* Published Listings Tab */}
                {activeTab === 'published' && (
                  <div>
                    {publishedJobs.length === 0 ? (
                      <div className="p-16 text-center space-y-4">
                        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
                          <Briefcase className="w-7 h-7" />
                        </div>
                        <div className="space-y-1.5">
                          <h3 className="text-base font-bold text-slate-900">No Published Job Listings</h3>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                            You have not published any job posts yet. Publish a new project to start receiving bids from qualified freelancers.
                          </p>
                        </div>
                        <div className="pt-2">
                          <Link
                            href="/client/jobs/new"
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
                          >
                            <PlusCircle className="w-4 h-4" />
                            <span>Post Your First Job</span>
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {publishedJobs.map((job) => {
                          const isPaused = job.status === 'cancelled';
                          const isUpdating = updatingJobId === job.id;
                          return (
                            <div
                              key={job.id}
                              className="p-5 sm:p-6 hover:bg-slate-50/80 transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-5 group"
                            >
                              <div className="space-y-2.5 min-w-0">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                                      isPaused
                                        ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        isPaused ? 'bg-slate-400' : 'bg-emerald-500 animate-pulse'
                                      }`}
                                    />
                                    <span>{isPaused ? 'Paused' : 'Active'}</span>
                                  </span>
                                  <span className="text-xs text-slate-400 font-medium">Posted {job.postedAt}</span>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                    {job.category}
                                  </span>
                                </div>

                                <h3 className="font-bold text-base sm:text-lg text-slate-900 group-hover:text-emerald-700 transition-colors">
                                  <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                                </h3>

                                <div className="flex items-center gap-3 sm:gap-5 text-xs text-slate-600 flex-wrap">
                                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100/90 text-slate-700 font-medium">
                                    <DollarSign className="w-3.5 h-3.5 text-slate-500" />
                                    <span>
                                      Budget:{' '}
                                      <strong className="text-slate-900">
                                        {job.budget.type === 'fixed'
                                          ? `$${job.budget.fixedAmount?.toLocaleString()}`
                                          : `$${job.budget.hourlyMin}-$${job.budget.hourlyMax}/hr`}
                                      </strong>
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleViewJobProposals({ id: job.id, title: job.title })}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/70 font-semibold cursor-pointer transition-all duration-150 group/prop"
                                    title={`View verified proposals received for "${job.title}"`}
                                  >
                                    <Users className="w-3.5 h-3.5 text-emerald-600 group-hover/prop:scale-110 transition-transform" />
                                    <span>
                                      {job.proposalCount} {job.proposalCount === 1 ? 'proposal' : 'proposals'}
                                    </span>
                                    <ChevronRight className="w-3 h-3 text-emerald-600 group-hover/prop:translate-x-0.5 transition-transform" />
                                  </button>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0">
                                <Link
                                  href={`/jobs/${job.id}`}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200/90 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 hover:border-slate-300 shadow-2xs transition-all duration-150"
                                  title={`View full job details for "${job.title}"`}
                                >
                                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                                  <span>View Job</span>
                                </Link>

                                <button
                                  onClick={() => handleToggleJobStatus(job.id, job.status)}
                                  disabled={isUpdating}
                                  type="button"
                                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 disabled:opacity-50 cursor-pointer ${
                                    isPaused
                                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80'
                                      : 'border border-slate-200/90 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                  }`}
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
                      <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50/90 via-emerald-50/60 to-teal-50/80 border-b border-emerald-100/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                          <span className="text-xs text-emerald-800 font-medium">Filtering candidates for:</span>
                          <span className="text-xs sm:text-sm font-bold text-slate-900 truncate max-w-sm">
                            {selectedJobFilter.title}
                          </span>
                          {!loadingJobProposals && (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
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
                          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0"
                        >
                          <span>Show All Jobs ({proposals.length})</span>
                          <X className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      </div>
                    )}

                    {/* Upwork Candidate Pipeline Filter Tabs */}
                    <div className="flex items-center gap-2 p-3 sm:p-3.5 bg-slate-50/90 border-b border-slate-200/80 overflow-x-auto text-xs">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 shrink-0">
                        Pipeline:
                      </span>
                      <button
                        type="button"
                        onClick={() => setPipelineFilter('all')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pipelineFilter === 'all'
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <span>All Active</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pipelineFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {countAll}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPipelineFilter('under_review')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pipelineFilter === 'under_review'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Under Review</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pipelineFilter === 'under_review' ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {countUnderReview}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPipelineFilter('interviewing')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pipelineFilter === 'interviewing'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>In Discussions</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pipelineFilter === 'interviewing' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {countInterviewing}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPipelineFilter('hired')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pipelineFilter === 'hired'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Hired</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pipelineFilter === 'hired' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {countHired}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPipelineFilter('archived')}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pipelineFilter === 'archived'
                            ? 'bg-rose-800 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archived / Declined</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pipelineFilter === 'archived' ? 'bg-rose-900 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {countArchived}
                        </span>
                      </button>
                    </div>

                    {/* Job Specific Loading State */}
                    {loadingJobProposals ? (
                      <div className="p-16 text-center space-y-3">
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
                      <div className="p-16 text-center space-y-3">
                        <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
                          <Users className="w-7 h-7" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900">
                          {pipelineFilter === 'under_review'
                            ? 'No Proposals Under Review'
                            : pipelineFilter === 'interviewing'
                            ? 'No Candidates In Discussions'
                            : pipelineFilter === 'hired'
                            ? 'No Hired Candidates Yet'
                            : pipelineFilter === 'archived'
                            ? 'No Archived or Declined Proposals'
                            : selectedJobFilter
                            ? `No Active Proposals for "${selectedJobFilter.title}"`
                            : 'No Proposals Found in This View'}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                          {pipelineFilter === 'under_review'
                            ? 'Proposals you open and review will automatically appear in this stage.'
                            : pipelineFilter === 'interviewing'
                            ? 'Candidates you message or schedule consultation meetings with will automatically appear here.'
                            : pipelineFilter === 'hired'
                            ? 'Candidates who have accepted contract offers and are working on your projects will appear here.'
                            : pipelineFilter === 'archived'
                            ? 'Proposals that you decline or candidates who withdraw will appear in this archive.'
                            : 'When talent applies to your active project listings, their bids and qualifications will appear here for review.'}
                        </p>
                        {pipelineFilter !== 'all' && (
                          <div className="pt-3">
                            <button
                              type="button"
                              onClick={() => setPipelineFilter('all')}
                              className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                            >
                              View All Active Proposals ({countAll})
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {displayedProposals.map((prop) => (
                          <div
                            key={prop.id}
                            className="p-5 sm:p-6 hover:bg-slate-50/80 transition-all duration-200 space-y-3.5 group"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div className="flex items-start gap-3.5 min-w-0">
                                {prop.freelancerAvatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={prop.freelancerAvatar}
                                    alt={prop.freelancerName || 'Candidate'}
                                    className="w-11 h-11 rounded-2xl object-cover border border-slate-200/90 shadow-2xs shrink-0 mt-0.5"
                                  />
                                ) : (
                                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 shadow-2xs">
                                    {(prop.freelancerName || 'Candidate')
                                      .split(' ')
                                      .map((n) => n[0])
                                      .slice(0, 2)
                                      .join('')
                                      .toUpperCase()}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {prop.freelancerUsername ? (
                                      <Link
                                        href={`/freelancers/${prop.freelancerUsername}`}
                                        className="font-bold text-sm sm:text-base text-slate-900 hover:text-emerald-700 hover:underline transition-colors flex items-center gap-1.5 truncate"
                                        title={`View public profile for ${prop.freelancerName}`}
                                      >
                                        <span>{prop.freelancerName || 'Candidate Specialist'}</span>
                                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                      </Link>
                                    ) : (
                                      <span className="font-bold text-sm sm:text-base text-slate-900 truncate">
                                        {prop.freelancerName || 'Candidate Specialist'}
                                      </span>
                                    )}
                                    {prop.freelancerTitle && (
                                      <span className="text-xs text-slate-500 font-medium truncate">
                                        • {prop.freelancerTitle}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5 flex-wrap">
                                    <span>applied for</span>
                                    <Link
                                      href={`/jobs/${prop.jobId}`}
                                      className="font-semibold text-emerald-700 hover:underline truncate max-w-xs"
                                    >
                                      {prop.jobTitle || 'Project Listing'}
                                    </Link>
                                    {prop.clientNotes && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                                        <FileEdit className="w-2.5 h-2.5" />
                                        Notes
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 self-start">
                                {getProposalStatusBadge(prop.status, prop.contractStatus)}
                              </div>
                            </div>

                            {/* Cover letter quote snippet */}
                            <div
                              onClick={() => handleOpenReviewModal(prop)}
                              className="cursor-pointer group/quote"
                              title="Click to open full proposal details and cover letter"
                            >
                              <div className="text-xs sm:text-[13px] text-slate-700 line-clamp-2 leading-relaxed italic bg-slate-50/90 group-hover/quote:bg-slate-100/90 p-3.5 rounded-xl border-l-3 border-emerald-500 border-t border-r border-b border-slate-200/60 transition-colors">
                                &ldquo;{prop.coverLetter}&rdquo;
                              </div>
                            </div>

                            {/* Decline reason notice if candidate was rejected with reason */}
                            {prop.status === 'rejected' && prop.declinedReason && (
                              <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                                <span className="font-bold text-rose-900 shrink-0">Decline reason:</span>
                                <span className="text-rose-700 italic">&ldquo;{prop.declinedReason}&rdquo;</span>
                              </div>
                            )}

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs">
                              <div className="flex items-center gap-3 sm:gap-4 text-slate-600 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 font-medium">
                                  <span>Bid:</span>
                                  <strong className="text-slate-900">
                                    ${prop.bidAmount} {prop.rateType === 'hourly' ? '/hr' : ''}
                                  </strong>
                                </span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 font-medium">
                                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                                  <span>
                                    Delivery: <strong className="text-slate-900">{prop.deliveryDays ?? 'Flexible'} days</strong>
                                  </span>
                                </span>
                              </div>

                              {/* Upwork Candidate Pipeline Actions */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenReviewModal(prop)}
                                  className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/90 text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                  title="View full proposal, cover letter, and candidate details"
                                >
                                  <Eye className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Review</span>
                                </button>

                                {/* Message / Interview Button */}
                                <button
                                  type="button"
                                  onClick={() => handleStartInterviewAndChat(prop)}
                                  className="px-3.5 py-1.5 rounded-xl bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200/90 text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                  title="Send a direct message or invite to interview"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                                  <span>Message</span>
                                </button>

                                {/* Non-terminal actions */}
                                {!['accepted', 'rejected', 'withdrawn'].includes(prop.status) && (
                                  <>
                                    {/* Upwork Hire / Make Formal Offer Button */}
                                    {prop.contractStatus === 'pending_offer' ? (
                                      <Link
                                        href={`/contracts/${prop.contractId || ''}`}
                                        className="px-3.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
                                        title="Contract offer dispatched. Awaiting freelancer review and acceptance."
                                      >
                                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                                        <span>Offer Pending</span>
                                      </Link>
                                    ) : prop.contractStatus === 'active' || prop.status === 'accepted' ? (
                                      <Link
                                        href={`/contracts/${prop.contractId || ''}`}
                                        className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 text-xs font-semibold transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Hired (Contract Active)</span>
                                      </Link>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setProposalForHire(prop);
                                          setIsHireModalOpen(true);
                                        }}
                                        className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold transition-all duration-150 shadow-sm shadow-emerald-600/25 flex items-center gap-1.5 cursor-pointer active:scale-95"
                                      >
                                        <Briefcase className="w-3.5 h-3.5" />
                                        <span>Hire / Offer</span>
                                      </button>
                                    )}

                                    {/* Upwork Decline with Reason Modal Trigger */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProposalToDecline(prop);
                                        setIsDeclineDialogOpen(true);
                                      }}
                                      className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200 text-xs font-semibold transition-all duration-150 cursor-pointer"
                                    >
                                      Decline
                                    </button>
                                  </>
                                )}

                                {prop.status === 'accepted' ? (
                                  <Link
                                    href="/contracts"
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/90 text-xs font-semibold transition-colors"
                                  >
                                    <Layers className="w-3.5 h-3.5" />
                                    <span>View Contract</span>
                                  </Link>
                                ) : ['rejected', 'withdrawn'].includes(prop.status) ? (
                                  <span className="text-[11px] text-slate-400 italic px-2 py-1">Archived</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Drafts Tab */}
                {activeTab === 'drafts' && (
                  <div>
                    {draftJobs.length === 0 ? (
                      <div className="p-16 text-center space-y-3">
                        <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
                          <FileText className="w-7 h-7" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900">No Saved Drafts</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                          You don&apos;t have any unpublished job drafts. Any saved draft projects will appear here for you to finalize and publish.
                        </p>
                        <div className="pt-2">
                          <Link
                            href="/client/jobs/new"
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
                          >
                            <PlusCircle className="w-4 h-4" />
                            <span>Start a New Job</span>
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {draftJobs.map((draft) => (
                          <div
                            key={draft.id}
                            className="p-5 sm:p-6 hover:bg-slate-50/80 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2.5">
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                                  Draft
                                </span>
                                <span className="text-xs text-slate-400">Created {draft.postedAt}</span>
                                <span className="text-slate-300">•</span>
                                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                  {draft.category}
                                </span>
                              </div>
                              <h3 className="font-bold text-base text-slate-900">{draft.title}</h3>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                href={`/client/jobs/new`}
                                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors shadow-2xs"
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
                      <div className="p-16 text-center space-y-3">
                        <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
                          <Archive className="w-7 h-7" />
                        </div>
                        <h3 className="text-base font-bold text-slate-900">No Completed Projects Yet</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                          Once your hired freelancers complete their contract deliverables and you finalize payment, the completed records will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {completedJobs.map((job) => (
                          <div
                            key={job.id}
                            className="p-5 sm:p-6 hover:bg-slate-50/80 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2.5">
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-800">
                                  Completed
                                </span>
                                <span className="text-xs text-slate-400">Archived {job.postedAt}</span>
                                <span className="text-slate-300">•</span>
                                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                  {job.category}
                                </span>
                              </div>
                              <h3 className="font-bold text-base text-slate-900">{job.title}</h3>
                            </div>
                            <Link
                              href={`/jobs/${job.id}`}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors shrink-0 shadow-2xs"
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

        {/* Right Column (4 cols): Activity Feed & Quick Actions */}
        <div className="lg:col-span-4 space-y-6">
          {/* Recent Activity Card */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 space-y-4 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Recent Activity</h3>
                  <p className="text-[11px] text-slate-400">Live employer event stream</p>
                </div>
              </div>
            </div>

            {loading && !dashboardData ? (
              <div className="space-y-4 py-2">
                <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-3/4" />
                <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-1/2" />
                <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-4/5 pt-2" />
                <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-1/3" />
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="py-8 text-center space-y-2.5">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6" />
                </div>
                <p className="text-xs font-bold text-slate-800">No Recent Activity</p>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                  Your recent job postings and proposal updates will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="relative pl-5 space-y-5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-100">
                {recentActivity.map((act) => (
                  <div key={act.id} className="relative text-xs space-y-1">
                    <span className="absolute -left-5 top-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-white" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 leading-snug">{act.title}</span>
                      <span className="text-[10px] text-slate-400 font-medium shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                        {act.timestamp}
                      </span>
                    </div>
                    {act.link ? (
                      <Link href={act.link} className="text-slate-600 hover:text-emerald-700 leading-relaxed block transition-colors">
                        {act.description}
                      </Link>
                    ) : (
                      <p className="text-slate-600 leading-relaxed">{act.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100">
              <Link
                href="/freelancers"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center justify-between group p-1.5 rounded-lg hover:bg-emerald-50/50 transition-colors"
              >
                <span>Find more talent for your team</span>
                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>

          {/* Quick Post CTA banner */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 sm:p-7 text-white space-y-4 border border-slate-800 shadow-xl group">
            <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none group-hover:scale-125 transition-transform duration-500" />
            <div className="relative z-10 space-y-3">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>Need specialized skills?</span>
              </div>
              <h4 className="font-extrabold text-lg sm:text-xl leading-snug text-white">
                Post another project in under 3 minutes
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Describe your requirements and start receiving tailored proposals from vetted experts today.
              </p>
              <div className="pt-2">
                <Link
                  href="/client/jobs/new"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-950 font-bold text-xs rounded-xl hover:bg-emerald-50 transition-all duration-150 shadow-md active:scale-95"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-600" />
                  <span>Post a Job Free</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Management Shortcuts Card */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-3 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.05)]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block px-1">
              Workspace Tools
            </span>
            <div className="grid grid-cols-1 gap-1.5">
              <Link
                href="/contracts"
                className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      All Contracts
                    </div>
                    <div className="text-[11px] text-slate-500">View milestones and work diaries</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-600 transition-all" />
              </Link>

              <Link
                href="/client/billing"
                className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      Invoices & Billing
                    </div>
                    <div className="text-[11px] text-slate-500">Track payouts and transactions</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-600 transition-all" />
              </Link>

              <Link
                href="/freelancers"
                className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      Browse Freelancers
                    </div>
                    <div className="text-[11px] text-slate-500">Discover top-rated talent</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-600 transition-all" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Proposal Details & Review Modal */}
      {selectedProposalForReview && (
        <ProposalDetailsModal
          key={selectedProposalForReview.id}
          proposal={selectedProposalForReview}
          isOpen={isReviewModalOpen}
          onClose={() => {
            setIsReviewModalOpen(false);
            setSelectedProposalForReview(null);
          }}
          mode="client"
          onUpdateStatus={handleUpdateProposalStatus}
          onDecline={async (propId, reason) => {
            await handleDeclineProposalWithReason(propId, reason);
          }}
          onOpenContact={(freelancer) => setContactFreelancer(freelancer)}
        />
      )}

      {/* Upwork Hire Offer Modal */}
      {proposalForHire && (
        <HireOfferModal
          proposal={proposalForHire}
          isOpen={isHireModalOpen}
          onClose={() => {
            setIsHireModalOpen(false);
            setProposalForHire(null);
          }}
          onOfferSent={(contractId) => {
            setIsHireModalOpen(false);
            if (proposalForHire) {
              const pId = proposalForHire.id;
              setDashboardData((prev) => {
                if (!prev || !prev.proposals) return prev;
                return {
                  ...prev,
                  proposals: prev.proposals.map((p) =>
                    p.id === pId ? { ...p, contractId, contractStatus: 'pending_offer' } : p
                  ),
                };
              });
            }
            setProposalForHire(null);
            try {
              sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
            } catch {
              // ignore
            }
            showToast('Formal contract offer sent to candidate!');
            handleRefresh();
          }}
        />
      )}

      {/* Upwork Decline Candidate Dialog Modal */}
      {isDeclineDialogOpen && proposalToDecline && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200/90 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                  <XCircle className="w-4 h-4" />
                </div>
                <span>Decline Candidate Proposal</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsDeclineDialogOpen(false);
                  setProposalToDecline(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Decline proposal from <strong className="text-slate-800">{proposalToDecline.freelancerName}</strong> for &ldquo;{proposalToDecline.jobTitle}&rdquo;. Providing feedback helps freelancers understand your decision.
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
                  className={`flex items-center gap-3 p-3 rounded-2xl border text-xs font-semibold cursor-pointer transition-all duration-150 ${
                    declineReasonOption === reason
                      ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950 shadow-2xs'
                      : 'border-slate-200/80 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="clientDeclineReason"
                    value={reason}
                    checked={declineReasonOption === reason}
                    onChange={() => setDeclineReasonOption(reason)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>
            {declineReasonOption === 'Other' && (
              <input
                type="text"
                value={customDeclineReason}
                onChange={(e) => setCustomDeclineReason(e.target.value)}
                placeholder="Specify decline reason..."
                className="w-full text-xs p-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
              />
            )}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsDeclineDialogOpen(false);
                  setProposalToDecline(null);
                }}
                className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDecliningCandidate}
                onClick={() => {
                  const finalReason =
                    declineReasonOption === 'Other' ? customDeclineReason.trim() : declineReasonOption;
                  handleDeclineProposalWithReason(proposalToDecline.id, finalReason);
                }}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shadow-md shadow-rose-600/20 cursor-pointer active:scale-95"
              >
                {isDecliningCandidate ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
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
