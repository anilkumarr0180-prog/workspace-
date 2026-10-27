'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import JobCard from '@/components/jobs/job-card';
import { Bookmark, ArrowRight, Briefcase } from 'lucide-react';

export default function SavedJobsPage() {
  const { savedJobs: contextSavedJobs, isJobSaved } = useMarketplace();
  const [apiSavedJobs, setApiSavedJobs] = useState<typeof contextSavedJobs | null>(null);
  const [source, setSource] = useState<'supabase' | 'fallback' | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  React.useEffect(() => {
    let isCancelled = false;

    fetch('/api/saved-jobs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data && Array.isArray(data.savedJobs)) {
          setApiSavedJobs(data.savedJobs);
          setSource(data.source);
        }
      })
      .catch(() => {
        // Fallback to client state
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const baseJobs = apiSavedJobs !== null ? apiSavedJobs : contextSavedJobs;
  const displayJobs = baseJobs.filter((job) => isJobSaved(job.id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Saved Opportunities
          </span>
          <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Bookmarked Projects
            </h1>
            {source === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL Verified
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Keep track of projects you are interested in and prepare your proposals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Explore More Jobs</span>
          </Link>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Retrieving saved projects...</p>
        </div>
      ) : displayJobs.length > 0 ? (
        <div className="space-y-4">
          <div className="text-xs text-slate-500">
            You have <strong className="text-slate-900 font-semibold">{displayJobs.length}</strong>{' '}
            {displayJobs.length === 1 ? 'saved project' : 'saved projects'}
          </div>

          <div className="space-y-4">
            {displayJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-slate-200 p-12 sm:p-16 text-center space-y-5 shadow-xs max-w-xl mx-auto">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Bookmark className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-900">No saved jobs yet</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              When browsing opportunities, click the bookmark icon on any job card to save it here for quick access later.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/jobs"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all"
            >
              <span>Browse Open Jobs</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
