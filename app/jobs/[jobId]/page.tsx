'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import ProposalModal from '@/components/jobs/proposal-modal';
import JobCard from '@/components/jobs/job-card';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import {
  Bookmark,
  CheckCircle2,
  MapPin,
  Star,
  Clock,
  DollarSign,
  Calendar,
  ShieldCheck,
  Send,
  ArrowLeft,
  Share2,
  Check,
  Building,
  HelpCircle
} from 'lucide-react';

function JobDetailContent() {
  const params = useParams();
  const jobId = params?.jobId as string;

  const { jobs, isJobSaved, toggleSaveJob, hasAppliedToJob } = useMarketplace();
  const [isProposalOpen, setIsProposalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Load current authenticated user to verify ownership
  useEffect(() => {
    let isMounted = true;
    try {
      const supabase = createClient();
      supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
        if (isMounted && res.data?.user) {
          setCurrentUser(res.data.user);
        }
      });
    } catch {
      // Ignore in offline/mock mode
    }
    return () => {
      isMounted = false;
    };
  }, []);

  // Local job lookup
  const localJob = jobs.find((j) => j.id === jobId);
  const [apiJob, setApiJob] = useState<typeof localJob | null>(null);
  const [loading, setLoading] = useState<boolean>(!localJob);

  // Fetch job details from the real API
  useEffect(() => {
    if (!jobId) return;
    let isCancelled = false;

    fetch(`/api/jobs/${jobId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data?.job) {
          setApiJob(data.job);
        }
      })
      .catch(() => {
        // Fallback to local
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [jobId]);

  const job = apiJob || localJob;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-500 font-medium">Loading project specifications...</p>
      </div>
    );
  }

  // Unknown Job ID: Not-Found State
  if (!job) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
          <HelpCircle className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Job Not Found</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            The project you are looking for (ID: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">{jobId}</code>) does not exist, has expired, or was removed by the client.
          </p>
        </div>
        <div>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Browse All Open Jobs</span>
          </Link>
        </div>
      </div>
    );
  }

  const saved = isJobSaved(job.id);
  const applied = hasAppliedToJob(job.id);
  const isJobOwner = Boolean(currentUser && job.client?.id && currentUser.id === job.client.id);

  // Related jobs in the same category
  const relatedJobs = jobs
    .filter((j) => j.id !== job.id && (j.category === job.category || j.skills.some((s) => job.skills.includes(s))))
    .slice(0, 2);

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const formatBudget = () => {
    if (job.budget.type === 'fixed') {
      return `$${job.budget.fixedAmount?.toLocaleString()}`;
    }
    return `$${job.budget.hourlyMin} - $${job.budget.hourlyMax}/hr`;
  };

  const formatExperience = (level: string) => {
    switch (level) {
      case 'entry':
        return 'Entry Level (Starting out or junior)';
      case 'intermediate':
        return 'Intermediate (Practical experience)';
      case 'expert':
        return 'Expert (Comprehensive mastery & leadership)';
      default:
        return level;
    }
  };

  const formatDuration = (d: string) => {
    switch (d) {
      case 'less_than_1_month':
        return 'Less than 1 month';
      case '1_to_3_months':
        return '1 to 3 months';
      case '3_to_6_months':
        return '3 to 6 months';
      case 'more_than_6_months':
        return 'More than 6 months';
      default:
        return d;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to all jobs</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied!' : 'Share'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Job Details (Left) + Client Sidebar (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            {/* Header info */}
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                <span className="font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200/60">
                  {job.category}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Posted {job.postedAt}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {job.title}
              </h1>
            </div>

            {/* Key Specs Card */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-100 text-xs">
              <div>
                <span className="text-slate-400 font-medium block">Budget</span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {formatBudget()}
                </span>
                <span className="text-[11px] text-slate-500">
                  {job.budget.type === 'fixed' ? 'Fixed Price Project' : 'Hourly Rate Range'}
                </span>
              </div>

              <div>
                <span className="text-slate-400 font-medium block">Experience Level</span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block capitalize">
                  {job.experienceLevel}
                </span>
                <span className="text-[11px] text-slate-500">
                  {formatExperience(job.experienceLevel)}
                </span>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <span className="text-slate-400 font-medium block">Estimated Project Duration</span>
                <span className="text-base font-bold text-slate-900 mt-0.5 block">
                  {formatDuration(job.duration)}
                </span>
                <span className="text-[11px] text-slate-500">Flexible milestones</span>
              </div>
            </div>

            {/* Full Description */}
            <div className="space-y-4 pt-2">
              <h2 className="text-base font-bold text-slate-900">Project Overview</h2>
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line space-y-3">
                {job.description}
              </div>
            </div>

            {/* Responsibilities */}
            {job.responsibilities && job.responsibilities.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="text-base font-bold text-slate-900">Key Responsibilities</h3>
                <ul className="space-y-2 text-sm text-slate-700">
                  {job.responsibilities.map((resp, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-2 shrink-0" />
                      <span>{resp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Deliverables */}
            {job.deliverables && job.deliverables.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="text-base font-bold text-slate-900">Expected Deliverables</h3>
                <ul className="space-y-2 text-sm text-slate-700">
                  {job.deliverables.map((deliv, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{deliv}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Required Skills */}
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Skills & Expertise</h3>
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/60"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Activity on this job */}
            <div className="pt-4 border-t border-slate-100 text-xs text-slate-600 space-y-2">
              <h4 className="font-bold text-slate-900 text-sm">Activity on this job</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2">
                <div>
                  <span className="text-slate-400">Proposals:</span>{' '}
                  <strong className="text-slate-800">{job.proposalCount} submitted</strong>
                </div>
                <div>
                  <span className="text-slate-400">Interviewing:</span>{' '}
                  <strong className="text-slate-800">1 candidate</strong>
                </div>
                <div>
                  <span className="text-slate-400">Invited:</span>{' '}
                  <strong className="text-slate-800">2 specialists</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Related Jobs Section */}
          {relatedJobs.length > 0 && (
            <div className="space-y-4 pt-4">
              <h3 className="text-lg font-bold text-slate-900">Similar Opportunities</h3>
              <div className="space-y-3">
                {relatedJobs.map((rJob) => (
                  <JobCard key={rJob.id} job={rJob} compact />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Client & Actions Sidebar */}
        <div className="space-y-6">
          {/* Action Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            {isJobOwner ? (
              <div className="p-4 bg-emerald-50/90 border border-emerald-200 rounded-xl space-y-2.5">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>You posted this job</span>
                </div>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  As the client and project creator, you cannot submit proposals to your own listing. Manage candidate submissions from your Client Dashboard.
                </p>
                <Link
                  href="/client"
                  className="inline-flex items-center justify-center w-full py-2.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors shadow-2xs"
                >
                  Manage in Client Dashboard
                </Link>
              </div>
            ) : (
              <button
                onClick={() => setIsProposalOpen(true)}
                type="button"
                className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
                  applied
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 cursor-pointer'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 hover:shadow-md'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>{applied ? 'Proposal Submitted (View)' : 'Apply Now'}</span>
              </button>
            )}

            <button
              onClick={() => toggleSaveJob(job.id)}
              type="button"
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition-colors ${
                saved
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${saved ? 'fill-emerald-600' : ''}`} />
              <span>{saved ? 'Saved in Your List' : 'Save Job'}</span>
            </button>

            <div className="pt-2 text-center text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Workspace Escrow Payment Protection
              </span>
            </div>
          </div>

          {/* Client Information Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-xs">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 pb-2 border-b border-slate-100">
              About the Client
            </h3>

            <div>
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold text-slate-900 text-sm">{job.client.name}</span>
              </div>
              {job.client.companyName && (
                <p className="text-xs text-slate-500 ml-6">{job.client.companyName}</p>
              )}
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              {job.client.paymentVerified && (
                <div className="flex items-center gap-2 text-emerald-700 font-semibold bg-emerald-50/80 p-2.5 rounded-lg border border-emerald-200/50">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Payment Method Verified</span>
                </div>
              )}

              <div className="flex items-start gap-2.5">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900">
                    {job.client.rating.toFixed(2)} of 5 stars
                  </span>
                  <span className="text-slate-400 ml-1">({job.client.reviewCount} reviews)</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">{job.client.location}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <DollarSign className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900">
                    ${job.client.totalSpent.toLocaleString()} total spent
                  </span>
                  <p className="text-[11px] text-slate-400">Consistent client history</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Calendar className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-slate-500">Member since: </span>
                  <span className="font-medium text-slate-900">{job.client.memberSince}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-slate-500">Hire rate:</span>
                <span className="font-bold text-slate-900">{job.client.hireRate}% hire rate</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Open jobs:</span>
                <span className="font-semibold text-slate-900">{job.client.openJobsCount} open</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Proposal Modal */}
      {!isJobOwner && (
        <ProposalModal
          job={job}
          isOpen={isProposalOpen}
          onClose={() => setIsProposalOpen(false)}
        />
      )}
    </div>
  );
}

export default function JobDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
          Loading project details...
        </div>
      }
    >
      <JobDetailContent />
    </Suspense>
  );
}
