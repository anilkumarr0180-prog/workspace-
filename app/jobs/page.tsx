'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { CATEGORIES } from '@/lib/mock-data';
import JobCard from '@/components/jobs/job-card';
import {
  Search,
  Filter,
  X,
  SlidersHorizontal,
  Briefcase,
  ArrowUpDown,
  RotateCcw
} from 'lucide-react';

function JobsContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialCategory = searchParams.get('category') || '';

  const { jobs: contextJobs } = useMarketplace();

  // Filter states
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [selectedProjectType, setSelectedProjectType] = useState<string>('all');
  const [selectedExperience, setSelectedExperience] = useState<string>('all');
  const [minBudget, setMinBudget] = useState<string>('');
  const [sortBy, setSortBy] = useState<'newest' | 'budget_high' | 'proposals_low'>('newest');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Real API state
  const [apiJobs, setApiJobs] = useState<typeof contextJobs | null>(null);
  const [apiSource, setApiSource] = useState<'supabase' | 'fallback' | null>(null);

  // Fetch from the real API when filter criteria change
  React.useEffect(() => {
    let isCancelled = false;

    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedProjectType !== 'all') params.set('projectType', selectedProjectType);
    if (selectedExperience !== 'all') params.set('experienceLevel', selectedExperience);
    if (minBudget && Number(minBudget) > 0) params.set('minBudget', minBudget);
    if (sortBy) params.set('sortBy', sortBy);

    fetch(`/api/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data && Array.isArray(data.jobs)) {
          setApiJobs(data.jobs);
          setApiSource(data.source);
        }
      })
      .catch(() => {
        // Fallback to client state on network error
      });

    return () => {
      isCancelled = true;
    };
  }, [searchQuery, selectedCategory, selectedProjectType, selectedExperience, minBudget, sortBy]);

  // Merge any locally added custom jobs with the fetched list
  const baseJobs = useMemo(() => {
    if (!apiJobs) return contextJobs;
    // Prepend any custom demo jobs created in this browser session that aren't yet in the API response
    const apiIds = new Set(apiJobs.map((j) => j.id));
    const localCustomOnly = contextJobs.filter((j) => j.client.id === 'cli-user' && !apiIds.has(j.id));
    return [...localCustomOnly, ...apiJobs];
  }, [apiJobs, contextJobs]);

  // In-memory filter and sort computation over the resolved jobs
  const filteredJobs = useMemo(() => {
    return baseJobs.filter((job) => {
      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = job.title.toLowerCase().includes(q);
        const matchesDesc = job.description.toLowerCase().includes(q);
        const matchesSkills = job.skills.some((s) => s.toLowerCase().includes(q));
        if (!matchesTitle && !matchesDesc && !matchesSkills) return false;
      }

      // Category filter
      if (selectedCategory && job.category !== selectedCategory) {
        return false;
      }

      // Project type filter
      if (selectedProjectType !== 'all' && job.projectType !== selectedProjectType) {
        return false;
      }

      // Experience level filter
      if (selectedExperience !== 'all' && job.experienceLevel !== selectedExperience) {
        return false;
      }

      // Budget filter
      if (minBudget && Number(minBudget) > 0) {
        const threshold = Number(minBudget);
        if (job.budget.type === 'fixed') {
          if ((job.budget.fixedAmount || 0) < threshold) return false;
        } else {
          if ((job.budget.hourlyMax || 0) < threshold) return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'budget_high') {
        const getBudget = (job: typeof a) =>
          job.budget.type === 'fixed'
            ? job.budget.fixedAmount || 0
            : (job.budget.hourlyMax || 0) * 40;
        return getBudget(b) - getBudget(a);
      }
      if (sortBy === 'proposals_low') {
        return a.proposalCount - b.proposalCount;
      }
      return 0;
    });
  }, [baseJobs, searchQuery, selectedCategory, selectedProjectType, selectedExperience, minBudget, sortBy]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedProjectType('all');
    setSelectedExperience('all');
    setMinBudget('');
    setSortBy('newest');
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(selectedCategory) ||
    selectedProjectType !== 'all' ||
    selectedExperience !== 'all' ||
    Boolean(minBudget);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner / Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Browse Opportunities
            </h1>
            {apiSource === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL API
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Explore verified freelance contracts and projects posted by vetted clients.
          </p>
        </div>

        {/* Mobile filter toggle */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            type="button"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 shadow-2xs"
          >
            <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
            <span>Filters {hasActiveFilters && '(Active)'}</span>
          </button>
        </div>
      </div>

      {/* Search & Sort Controls Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by keywords, titles, or specific skills (e.g. Next.js, Figma, AI)..."
            className="w-full pl-10 pr-9 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              type="button"
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <ArrowUpDown className="w-4 h-4 text-slate-400 hidden sm:block" />
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'budget_high' | 'proposals_low')}
            className="w-full sm:w-auto text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-hidden cursor-pointer"
          >
            <option value="newest">Most Recent</option>
            <option value="budget_high">Highest Budget</option>
            <option value="proposals_low">Fewest Proposals</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Filters Sidebar + Job Results */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* Desktop Sidebar Filters */}
        <div className={`lg:block ${mobileFiltersOpen ? 'block' : 'hidden'} bg-white rounded-xl border border-slate-200/90 p-5 space-y-6 shadow-2xs`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
              <Filter className="w-4 h-4 text-emerald-600" />
              <span>Filter Results</span>
            </div>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                type="button"
                className="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Category Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.name}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project Type Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Project Type
            </label>
            <div className="space-y-1.5 text-xs text-slate-700">
              {[
                { id: 'all', label: 'All Project Types' },
                { id: 'fixed', label: 'Fixed Price' },
                { id: 'hourly', label: 'Hourly Rate' }
              ].map((opt) => (
                <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="radio"
                    name="projectType"
                    checked={selectedProjectType === opt.id}
                    onChange={() => setSelectedProjectType(opt.id)}
                    className="text-emerald-600 focus:ring-emerald-500 rounded-full"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Experience Level Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Experience Level
            </label>
            <div className="space-y-1.5 text-xs text-slate-700">
              {[
                { id: 'all', label: 'Any Experience' },
                { id: 'entry', label: 'Entry Level ($)' },
                { id: 'intermediate', label: 'Intermediate ($$)' },
                { id: 'expert', label: 'Expert ($$$)' }
              ].map((exp) => (
                <label key={exp.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="radio"
                    name="experienceLevel"
                    checked={selectedExperience === exp.id}
                    onChange={() => setSelectedExperience(exp.id)}
                    className="text-emerald-600 focus:ring-emerald-500 rounded-full"
                  />
                  <span>{exp.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Minimum Budget Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Min Budget / Rate ($)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 text-xs">$</span>
              <input
                type="number"
                min="0"
                step="50"
                value={minBudget}
                onChange={(e) => setMinBudget(e.target.value)}
                placeholder="e.g. 1000"
                className="w-full pl-7 pr-3 py-2 text-xs border border-slate-200 bg-slate-50 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Active Filter Badges summary */}
          {hasActiveFilters && (
            <div className="pt-2 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                Active Filters:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {searchQuery && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    &ldquo;{searchQuery}&rdquo;
                    <button onClick={() => setSearchQuery('')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {selectedCategory && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    {selectedCategory}
                    <button onClick={() => setSelectedCategory('')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {selectedProjectType !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    {selectedProjectType}
                    <button onClick={() => setSelectedProjectType('all')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {selectedExperience !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    {selectedExperience}
                    <button onClick={() => setSelectedExperience('all')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {minBudget && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    Min ${minBudget}
                    <button onClick={() => setMinBudget('')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              Showing <strong className="text-slate-900 font-semibold">{filteredJobs.length}</strong>{' '}
              {filteredJobs.length === 1 ? 'job' : 'jobs'}
            </span>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="text-emerald-600 hover:underline font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>

          {filteredJobs.length > 0 ? (
            <div className="space-y-4">
              {filteredJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-4 shadow-2xs">
              <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <Briefcase className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">No matching jobs found</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  We couldn&apos;t find any opportunities matching your active filters. Try broadening your search or resetting your filters.
                </p>
              </div>
              <div>
                <button
                  onClick={resetFilters}
                  type="button"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors shadow-2xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All Filters</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BrowseJobsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
          Loading jobs...
        </div>
      }
    >
      <JobsContent />
    </Suspense>
  );
}
