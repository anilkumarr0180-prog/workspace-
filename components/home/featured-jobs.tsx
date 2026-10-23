'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { Job } from '@/lib/types';
import JobCard from '@/components/jobs/job-card';
import { ArrowRight, AlertCircle, RefreshCw, Briefcase } from 'lucide-react';

interface FeaturedJobsProps {
  className?: string;
}

export default function FeaturedJobs({ className = '' }: FeaturedJobsProps) {
  const { jobs: contextJobs } = useMarketplace();

  // Initial state derived from local context to ensure instant SSR/CSR paint
  const initialFeatured = contextJobs.filter((j) => j.isFeatured).slice(0, 3);
  const [jobs, setJobs] = useState<Job[]>(
    initialFeatured.length > 0 ? initialFeatured : contextJobs.slice(0, 3)
  );
  const [totalJobs, setTotalJobs] = useState<number>(contextJobs.length);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch real published jobs from database API on mount
  useEffect(() => {
    let isCancelled = false;

    fetch('/api/jobs?limit=6&sortBy=newest')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load jobs (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!isCancelled && data && Array.isArray(data.jobs)) {
          const featured = data.jobs.filter((j: Job) => j.isFeatured);
          const displayJobs =
            featured.length >= 3 ? featured.slice(0, 3) : data.jobs.slice(0, 3);

          setJobs(displayJobs);
          if (typeof data.total === 'number') {
            setTotalJobs(data.total);
          }
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          const msg = err instanceof Error ? err.message : 'Error loading jobs';
          setError(msg);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleRetry = () => {
    setLoading(true);
    setError(null);

    fetch('/api/jobs?limit=6&sortBy=newest')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load jobs (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.jobs)) {
          const featured = data.jobs.filter((j: Job) => j.isFeatured);
          const displayJobs =
            featured.length >= 3 ? featured.slice(0, 3) : data.jobs.slice(0, 3);

          setJobs(displayJobs);
          if (typeof data.total === 'number') {
            setTotalJobs(data.total);
          }
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Error loading jobs';
        setError(msg);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <section
      aria-labelledby="featured-jobs-heading"
      className={`max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 ${className}`}
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 block mb-1">
            Verified Opportunities
          </span>
          <h2
            id="featured-jobs-heading"
            className="text-2xl sm:text-3xl lg:text-[34px] font-bold text-slate-900 tracking-tight"
          >
            Featured Client Projects
          </h2>
        </div>

        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#14a800] hover:text-[#108a00] group transition-colors"
        >
          <span>
            {totalJobs > 0 ? `Browse all ${totalJobs} jobs` : 'Browse all jobs'}
          </span>
          <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>

      {/* Loading Skeleton State */}
      {loading && jobs.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 bg-slate-200 rounded w-24" />
                <div className="h-7 w-7 bg-slate-200 rounded-lg" />
              </div>
              <div className="h-6 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-200 rounded w-1/2" />
              <div className="space-y-2 py-2">
                <div className="h-3.5 bg-slate-200 rounded w-full" />
                <div className="h-3.5 bg-slate-200 rounded w-5/6" />
              </div>
              <div className="flex gap-2 pt-2">
                <div className="h-6 bg-slate-200 rounded-md w-16" />
                <div className="h-6 bg-slate-200 rounded-md w-16" />
                <div className="h-6 bg-slate-200 rounded-md w-16" />
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-between">
                <div className="h-4 bg-slate-200 rounded w-28" />
                <div className="h-4 bg-slate-200 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State Banner */}
      {error && jobs.length === 0 && (
        <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm font-medium">
              Unable to load live featured jobs. Please check your connection and try again.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && jobs.length === 0 && !error && (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/90 space-y-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-[#14a800] flex items-center justify-center mx-auto">
            <Briefcase className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">No Featured Jobs Right Now</h3>
          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            New client contracts are posted continuously. Browse the open marketplace or post a new job opportunity today.
          </p>
          <div className="pt-2">
            <Link
              href="/jobs"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#14a800] hover:bg-[#108a00] text-white text-sm font-semibold transition-colors"
            >
              <span>Explore Marketplace</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Active Jobs Grid */}
      {jobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} compact />
          ))}
        </div>
      )}
    </section>
  );
}
