'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { CLIENT_DASHBOARD_DATA } from '@/lib/mock-data';
import { ProposalRecord } from '@/lib/actions/proposals';
import {
  Briefcase,
  Users,
  DollarSign,
  PlusCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Activity,
  ChevronRight,
  AlertCircle
} from 'lucide-react';

export default function ClientDashboardPage() {
  const { jobs, proposals: contextProposals } = useMarketplace();
  const [activeTab, setActiveTab] = useState<'published' | 'proposals' | 'drafts' | 'completed'>('published');
  const [closedJobs, setClosedJobs] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [apiProposals, setApiProposals] = useState<ProposalRecord[] | null>(null);
  const [proposalsLoading, setProposalsLoading] = useState<boolean>(true);
  const [proposalsSource, setProposalsSource] = useState<'supabase' | 'fallback' | null>(null);
  const [updatingProposalId, setUpdatingProposalId] = useState<string | null>(null);

  // Fetch client proposals from API
  useEffect(() => {
    let isCancelled = false;

    fetch('/api/proposals?as=client')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data && Array.isArray(data.proposals)) {
          setApiProposals(data.proposals);
          setProposalsSource(data.source);
        }
      })
      .catch(() => {
        // Fallback
      })
      .finally(() => {
        if (!isCancelled) setProposalsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(''), 4000);
  };

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
        setApiProposals((prev) =>
          prev
            ? prev.map((p) =>
                p.id === proposalId
                  ? { ...p, status: newStatus as ProposalRecord['status'] }
                  : p
              )
            : null
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

  const toggleJobStatus = (id: string) => {
    if (closedJobs.includes(id)) {
      setClosedJobs(closedJobs.filter((item) => item !== id));
      showToast('Job listing reopened successfully.');
    } else {
      setClosedJobs([...closedJobs, id]);
      showToast('Job listing marked as paused/closed.');
    }
  };

  // Client jobs (either user created or demo client jobs)
  const clientJobs = jobs.slice(0, 4);

  const displayProposals = apiProposals && apiProposals.length > 0
    ? apiProposals
    : contextProposals.map((cp) => ({
        id: cp.id,
        jobId: cp.jobId,
        jobTitle: cp.jobTitle,
        freelancerId: 'free-user',
        freelancerName: 'Specialist Candidate',
        bidAmount: cp.bidAmount,
        rateType: cp.rateType,
        deliveryDays: cp.deliveryDays,
        coverLetter: cp.coverLetter,
        status: cp.status as ProposalRecord['status'],
        createdAt: '2026-10-22T00:00:00.000Z',
        updatedAt: '2026-10-22T00:00:00.000Z',
      }));

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <AlertCircle className="w-4 h-4 text-rose-300" />
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
            {proposalsSource === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL Verified
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage your open listings, evaluate proposals, and collaborate with your team.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/client/jobs/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Post a New Job</span>
          </Link>
        </div>
      </div>

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
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {clientJobs.length - closedJobs.length}
            </span>
            <span className="text-xs text-emerald-600 font-semibold ml-2">Open for bids</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Proposals
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {displayProposals.length}
            </span>
            <span className="text-xs text-blue-600 font-semibold ml-2">Received</span>
          </div>
        </div>

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
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {CLIENT_DASHBOARD_DATA.stats.hiredFreelancers}
            </span>
            <span className="text-xs text-slate-500 font-medium ml-2">Active contracts</span>
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
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              {CLIENT_DASHBOARD_DATA.stats.totalSpend}
            </span>
            <span className="text-xs text-slate-400 font-medium ml-2">Escrow protected</span>
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
                  Published Listings ({clientJobs.length})
                </button>
                <button
                  onClick={() => setActiveTab('proposals')}
                  type="button"
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === 'proposals'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Proposals Received ({displayProposals.length})
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
                  Drafts (1)
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
                  Archived / Completed (2)
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
            {activeTab === 'published' && (
              <div className="divide-y divide-slate-100">
                {clientJobs.map((job) => {
                  const isClosed = closedJobs.includes(job.id);
                  return (
                    <div
                      key={job.id}
                      className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              isClosed
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isClosed ? 'Paused' : 'Active'}
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
                          <span className="font-semibold text-emerald-700">
                            {job.proposalCount} proposals received
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-white hover:text-slate-900 transition-colors flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </Link>

                        <button
                          onClick={() => toggleJobStatus(job.id)}
                          type="button"
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          {isClosed ? 'Reopen' : 'Pause'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'proposals' && (
              <div>
                {proposalsLoading ? (
                  <div className="p-12 text-center space-y-3">
                    <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-slate-500">Retrieving candidate proposals...</p>
                  </div>
                ) : displayProposals.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                      <Users className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">No Proposals Received Yet</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      When talent applies to your active project listings, their bids and qualifications will appear here for review.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {displayProposals.map((prop) => {
                      const isUpdating = updatingProposalId === prop.id;
                      return (
                        <div key={prop.id} className="p-5 hover:bg-slate-50/70 transition-colors space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-slate-900">
                                  {prop.freelancerName || 'Candidate Specialist'}
                                </span>
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

                          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed italic bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                            &ldquo;{prop.coverLetter}&rdquo;
                          </p>

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

                            {/* Status transition controls */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {prop.status === 'submitted' && (
                                <>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'under_review')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isUpdating ? 'Updating...' : 'Review'}
                                  </button>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'interviewing')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    Interview
                                  </button>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50"
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
                                    className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isUpdating ? 'Updating...' : 'Interview'}
                                  </button>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'accepted')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    Accept Offer
                                  </button>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50"
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
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isUpdating ? 'Updating...' : 'Accept Offer'}
                                  </button>
                                  <button
                                    onClick={() => handleUpdateProposalStatus(prop.id, 'rejected')}
                                    disabled={isUpdating}
                                    type="button"
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    Decline
                                  </button>
                                </>
                              )}

                              {['accepted', 'rejected', 'withdrawn'].includes(prop.status) && (
                                <span className="text-[11px] text-slate-400 italic">Terminal Status</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'drafts' && (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">
                  You have 1 unpublished draft: <strong>AI Prompt Evaluation Engineer</strong> (Saved 3 days ago)
                </p>
                <Link
                  href="/client/jobs/new"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  <span>Resume Draft</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}

            {activeTab === 'completed' && (
              <div className="divide-y divide-slate-100 p-4 space-y-3">
                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <h4 className="font-bold text-slate-900">PostgreSQL Performance Tuning</h4>
                    <p className="text-slate-500">Completed with Alex Chen • $3,200 paid • 5.0 Rating given</p>
                  </div>
                  <span className="px-2 py-1 rounded bg-slate-200 text-slate-700 font-semibold">Completed</span>
                </div>
              </div>
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

            <div className="space-y-4">
              {CLIENT_DASHBOARD_DATA.recentActivity.map((act) => (
                <div key={act.id} className="text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{act.title}</span>
                    <span className="text-[11px] text-slate-400">{act.timestamp}</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">{act.description}</p>
                </div>
              ))}
            </div>

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
    </div>
  );
}
