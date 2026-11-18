'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PublicFreelancer } from '@/lib/types';
import {
  ArrowRight,
  Star,
  Users,
  AlertCircle,
  RefreshCw,
  Award
} from 'lucide-react';

interface FeaturedFreelancersProps {
  className?: string;
}

export default function FeaturedFreelancers({ className = '' }: FeaturedFreelancersProps) {
  const [freelancers, setFreelancers] = useState<PublicFreelancer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFreelancers = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/api/freelancers?limit=3')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load freelancers (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.error) {
          throw new Error(data.error);
        }
        setFreelancers(Array.isArray(data.freelancers) ? data.freelancers : []);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Error loading freelancers';
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    fetch('/api/freelancers?limit=3')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load freelancers (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!isCancelled) {
          if (data.error) {
            throw new Error(data.error);
          }
          setFreelancers(Array.isArray(data.freelancers) ? data.freelancers : []);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Error loading freelancers';
          setError(message);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const getInitials = (name: string, username: string) => {
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (username || 'FL').slice(0, 2).toUpperCase();
  };

  return (
    <section className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${className}`}>
      {/* Header matching Upwork visual hierarchy */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-wider text-emerald-700 block mb-1.5">
            Top Rated Talent
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-[34px] font-semibold text-slate-900 tracking-tight leading-tight">
            Hire Elite Independent Specialists
          </h2>
        </div>
        <Link
          href="/freelancers"
          className="inline-flex items-center gap-1.5 text-[14px] sm:text-[15px] font-semibold text-[#14a800] hover:text-[#108a00] group transition-colors shrink-0"
        >
          <span>Explore all freelancers</span>
          <ArrowRight className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between min-h-[250px]"
            >
              <div>
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="w-32 h-5 bg-slate-200 rounded" />
                    <div className="w-20 h-3.5 bg-slate-100 rounded" />
                    <div className="w-28 h-3.5 bg-slate-100 rounded" />
                  </div>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded mb-2" />
                <div className="w-4/5 h-3 bg-slate-100 rounded mb-4" />
                <div className="flex gap-1.5">
                  <div className="w-16 h-5 bg-slate-100 rounded" />
                  <div className="w-14 h-5 bg-slate-100 rounded" />
                  <div className="w-20 h-5 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 mt-5">
                <div className="w-full h-9 bg-slate-100 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-6 sm:p-8 text-center max-w-lg mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-rose-900 mb-1">Failed to load top talent</p>
          <p className="text-xs text-rose-700 mb-4">{error}</p>
          <button
            onClick={fetchFreelancers}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-rose-200 text-rose-800 hover:bg-rose-100 transition-colors shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && freelancers.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-8 sm:p-12 text-center max-w-md mx-auto">
          <Users className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800 mb-1">No Freelancers Available</h3>
          <p className="text-xs text-slate-500 mb-5">
            Freelancer profiles are currently being onboarded. Check back shortly or browse all available jobs.
          </p>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-xs"
          >
            <span>Browse Jobs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Real Supabase Database Freelancers */}
      {!loading && !error && freelancers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {freelancers.map((freelancer, fIdx) => {
            const hasHourlyRate = typeof freelancer.hourlyRate === 'number' && freelancer.hourlyRate > 0;
            const hasReviews = typeof freelancer.reviewCount === 'number' && freelancer.reviewCount > 0;
            const isTopRated = hasReviews && freelancer.rating >= 4.8;

            return (
              <div
                key={freelancer.id || `freelancer-card-${fIdx}`}
                className="bg-white rounded-2xl border border-slate-200 p-6 transition-all duration-200 hover:border-[#14a800]/70 shadow-xs hover:shadow-md hover:shadow-slate-200/50 flex flex-col justify-between"
              >
                <div>
                  {/* Top Row: Avatar, Name, Title, Rate */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3.5">
                      <div className="relative shrink-0">
                        {freelancer.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={freelancer.avatarUrl}
                            alt={freelancer.fullName}
                            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border-2 border-slate-100 shadow-2xs"
                          />
                        ) : (
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center text-lg sm:text-xl border-2 border-slate-100 shadow-2xs select-none">
                            {getInitials(freelancer.fullName, freelancer.username)}
                          </div>
                        )}
                        <span
                          className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full"
                          title="Available for projects"
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/freelancers/${freelancer.username}`}
                            className="font-semibold text-[18px] sm:text-[19px] text-slate-900 hover:text-[#14a800] transition-colors truncate block"
                          >
                            {freelancer.fullName}
                          </Link>
                          {isTopRated && (
                            <span
                              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shrink-0"
                              title="Top Rated Specialist"
                            >
                              <Award className="w-3 h-3 text-emerald-600" />
                              <span>Top Rated</span>
                            </span>
                          )}
                        </div>

                        <p className="text-[13px] font-normal text-slate-600 mt-0.5 line-clamp-1">
                          {freelancer.title || 'Independent Professional'}
                        </p>

                        <p className="text-[12px] text-slate-400 mt-0.5 font-mono">
                          @{freelancer.username}
                        </p>
                      </div>
                    </div>

                    {/* Hourly Rate (Only displayed if genuinely defined in database) */}
                    {hasHourlyRate && (
                      <div className="text-right shrink-0">
                        <span className="text-[17px] sm:text-[18px] font-bold text-slate-900">
                          ${freelancer.hourlyRate}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">/hr</span>
                      </div>
                    )}
                  </div>

                  {/* Rating & Reviews Bar */}
                  <div className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-slate-50 border border-slate-100 text-[12px] text-slate-600 mb-3.5">
                    {hasReviews ? (
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        <strong className="text-slate-900">{freelancer.rating.toFixed(2)}</strong>
                        <span className="text-slate-400">({freelancer.reviewCount} reviews)</span>
                      </div>
                    ) : (
                      <span className="text-slate-500 font-medium">New Talent</span>
                    )}

                    {freelancer.totalEarnings > 0 && (
                      <span className="inline-flex items-center gap-2 text-slate-600">
                        <span>•</span>
                        <span>
                          Earned: <strong className="text-slate-900">${freelancer.totalEarnings.toLocaleString()}</strong>
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Bio snippet (Only displayed if present in database) */}
                  {freelancer.bio && (
                    <p className="text-[13px] sm:text-[14px] text-slate-600 line-clamp-2 mb-3.5 leading-relaxed">
                      {freelancer.bio}
                    </p>
                  )}

                  {/* Skills Badges (Only genuine skills from database) */}
                  {freelancer.skills && freelancer.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {freelancer.skills.slice(0, 4).map((skill, sIdx) => (
                        <span
                          key={skill.id ? `${freelancer.id}-skill-${skill.id}` : `${freelancer.id}-skill-${sIdx}`}
                          className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-slate-100 text-slate-700"
                        >
                          {skill.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* View Profile Action Link */}
                <div className="pt-4 border-t border-slate-100 mt-4">
                  <Link
                    href={`/freelancers/${freelancer.username}`}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-full text-[13px] sm:text-[14px] font-medium text-slate-800 border border-slate-300 hover:border-[#14a800] hover:text-[#14a800] hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    <span>View Profile</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
