'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { TaxonomyCategory } from '@/lib/types';
import {
  Code2,
  Sparkles,
  Palette,
  Smartphone,
  Cloud,
  Briefcase,
  ChevronRight,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  FolderSearch
} from 'lucide-react';

interface SpecializationCategoriesProps {
  className?: string;
}

export default function SpecializationCategories({
  className = '',
}: SpecializationCategoriesProps) {
  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/api/categories')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch categories (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.error) {
          throw new Error(data.error);
        }
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Error loading specializations';
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    fetch('/api/categories')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch categories (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!isCancelled) {
          if (data.error) {
            throw new Error(data.error);
          }
          setCategories(Array.isArray(data.categories) ? data.categories : []);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Error loading specializations';
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

  const getCategoryIcon = (iconName?: string | null) => {
    switch (iconName) {
      case 'Code2':
        return <Code2 className="w-5 h-5 text-[#14a800]" />;
      case 'Sparkles':
        return <Sparkles className="w-5 h-5 text-[#14a800]" />;
      case 'Palette':
        return <Palette className="w-5 h-5 text-[#14a800]" />;
      case 'Smartphone':
        return <Smartphone className="w-5 h-5 text-[#14a800]" />;
      case 'Cloud':
        return <Cloud className="w-5 h-5 text-[#14a800]" />;
      default:
        return <Briefcase className="w-5 h-5 text-[#14a800]" />;
    }
  };

  return (
    <section className={`max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 ${className}`}>
      {/* Header with Visual Hierarchy Matching Upwork Reference */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 block mb-1">
            Explore by Specialization
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-[34px] font-bold text-slate-900 tracking-tight">
            Browse talent by category
          </h2>
        </div>

        <div className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
          <span>Looking for work?</span>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1 text-[#14a800] hover:text-[#108a00] font-semibold underline decoration-1 underline-offset-2 transition-colors"
          >
            <span>Browse jobs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 flex flex-col justify-between min-h-[210px]"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-slate-100" />
                  <div className="w-16 h-6 rounded-full bg-slate-100" />
                </div>
                <div className="w-40 h-5 bg-slate-200 rounded mb-2.5" />
                <div className="w-24 h-3 bg-slate-100 rounded mb-4" />
                <div className="flex flex-wrap gap-1.5">
                  <div className="w-16 h-5 bg-slate-100 rounded" />
                  <div className="w-14 h-5 bg-slate-100 rounded" />
                  <div className="w-20 h-5 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="pt-4 mt-5 border-t border-slate-100 flex justify-between items-center">
                <div className="w-28 h-3.5 bg-slate-100 rounded" />
                <div className="w-4 h-4 bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-6 sm:p-8 text-center max-w-lg mx-auto">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-rose-900 mb-1">
            Failed to load specializations
          </p>
          <p className="text-xs text-rose-700 mb-4">{error}</p>
          <button
            onClick={fetchCategories}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-rose-200 text-rose-800 hover:bg-rose-100 transition-colors shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && categories.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-8 sm:p-12 text-center max-w-md mx-auto">
          <FolderSearch className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800 mb-1">No Specializations Found</h3>
          <p className="text-xs text-slate-500 mb-5">
            Categories are currently being configured in the database. Explore all available jobs directly.
          </p>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-xs"
          >
            <span>Browse All Jobs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Real Supabase Database Categories Grid */}
      {!loading && !error && categories.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {categories.map((cat) => {
            const hasJobCount = typeof cat.jobCount === 'number' && cat.jobCount > 0;

            return (
              <Link
                key={cat.id}
                href={`/jobs?category=${encodeURIComponent(cat.name)}`}
                className="group bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 hover:border-[#14a800]/60 hover:shadow-lg hover:shadow-emerald-950/5 transition-all duration-200 flex flex-col justify-between"
              >
                <div>
                  {/* Top Row: Icon Container and Real Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
                      {getCategoryIcon(cat.icon)}
                    </div>

                    {hasJobCount ? (
                      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                        <span>
                          {cat.jobCount} {cat.jobCount === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-full">
                        <span>{cat.skills.length} skills</span>
                      </div>
                    )}
                  </div>

                  {/* Category Title */}
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900 group-hover:text-[#14a800] transition-colors leading-snug">
                    {cat.name}
                  </h3>

                  {/* Subtitle / Real Statistics */}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 font-medium">
                    {hasJobCount ? (
                      <span className="text-emerald-700 font-semibold">
                        {cat.jobCount} open project{cat.jobCount === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span>{cat.skills.length} specialized skills</span>
                    )}
                  </div>

                  {/* Real Database Skills */}
                  {cat.skills && cat.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {cat.skills.slice(0, 4).map((skill) => (
                        <span
                          key={skill.id}
                          className="px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-slate-100/90 text-slate-700 group-hover:bg-emerald-50 group-hover:text-emerald-900 transition-colors"
                        >
                          {skill.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom Row: Direct Link Action */}
                <div className="pt-4 mt-5 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600 group-hover:text-[#14a800] transition-colors">
                  <span>Browse {cat.name}</span>
                  <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
