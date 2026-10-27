'use client';

import React from 'react';
import Link from 'next/link';
import { Job } from '@/lib/types';
import { useMarketplace } from '@/lib/context/marketplace-context';
import {
  Bookmark,
  CheckCircle,
  MapPin,
  Star,
  Clock,
  DollarSign,
  Briefcase,
  ArrowRight
} from 'lucide-react';

interface JobCardProps {
  job: Job;
  compact?: boolean;
}

export default function JobCard({ job, compact = false }: JobCardProps) {
  const { isJobSaved, toggleSaveJob } = useMarketplace();
  const saved = isJobSaved(job.id);

  const formatBudget = () => {
    if (job.budget.type === 'fixed') {
      return `$${job.budget.fixedAmount?.toLocaleString()}`;
    }
    return `$${job.budget.hourlyMin} - $${job.budget.hourlyMax}/hr`;
  };

  const formatExperience = (level: string) => {
    switch (level) {
      case 'entry':
        return 'Entry Level';
      case 'intermediate':
        return 'Intermediate';
      case 'expert':
        return 'Expert';
      default:
        return level;
    }
  };

  return (
    <div className="group relative bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 transition-all duration-200 hover:border-[#14a800]/60 hover:shadow-lg hover:shadow-emerald-950/5 flex flex-col justify-between">
      <div>
        {/* Header row: Posted time & Save button */}
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-medium text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Posted {job.postedAt}
            </span>
            {job.isFeatured && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                Featured
              </span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleSaveJob(job.id);
            }}
            type="button"
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              saved
                ? 'bg-emerald-50 border-emerald-300 text-[#14a800]'
                : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
            title={saved ? 'Remove from saved jobs' : 'Save job'}
            aria-label={saved ? 'Remove from saved' : 'Save job'}
          >
            <Bookmark className={`w-4 h-4 ${saved ? 'fill-[#14a800] text-[#14a800]' : ''}`} />
          </button>
        </div>

        {/* Title */}
        <h3 className="text-lg sm:text-[19px] font-bold text-slate-900 group-hover:text-[#14a800] transition-colors leading-snug mb-2">
          <Link href={`/jobs/${job.id}`} className="focus:outline-hidden">
            {job.title}
          </Link>
        </h3>

        {/* Metadata pill row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 mb-3.5">
          <div className="flex items-center gap-1 font-semibold text-slate-900">
            <DollarSign className="w-3.5 h-3.5 text-[#14a800]" />
            <span>{formatBudget()}</span>
            <span className="text-slate-400 font-normal">
              ({job.budget.type === 'fixed' ? 'Fixed price' : 'Hourly'})
            </span>
          </div>

          <div className="flex items-center gap-1 text-slate-600">
            <Briefcase className="w-3.5 h-3.5 text-slate-400" />
            <span>{formatExperience(job.experienceLevel)}</span>
          </div>

          <span className="text-slate-300">•</span>

          <span className="text-slate-500 font-medium">
            Category: <strong className="text-slate-700 font-semibold">{job.category}</strong>
          </span>
        </div>

        {/* Description snippet */}
        <p className={`text-slate-600 text-sm leading-relaxed mb-4 ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}>
          {job.description}
        </p>

        {/* Skill tags */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {job.skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition-colors"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>

      {/* Footer: Client verification and proposals info */}
      <div className="pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-y-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          {job.client.paymentVerified && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 fill-emerald-100" />
              <span>Payment verified</span>
            </span>
          )}

          <div className="flex items-center gap-1 font-medium text-slate-700">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>{job.client.rating.toFixed(1)}</span>
            <span className="text-slate-400">({job.client.reviewCount})</span>
          </div>

          <span className="text-slate-400 font-medium">
            ${(job.client.totalSpent / 1000).toFixed(0)}k+ spent
          </span>

          <div className="hidden sm:flex items-center gap-1 text-slate-500">
            <MapPin className="w-3 h-3 text-slate-400" />
            <span className="truncate max-w-[130px]">{job.client.location.split(',')[0]}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="font-semibold text-slate-700">{job.proposalCount}</span>{' '}
            <span className="text-slate-500">{job.proposalCount === 1 ? 'proposal' : 'proposals'}</span>
          </div>

          <Link
            href={`/jobs/${job.id}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs transition-colors shrink-0"
            title={`View job details for "${job.title}"`}
          >
            <span>View Job</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
