'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { Freelancer } from '@/lib/types';
import { CATEGORIES } from '@/lib/mock-data';
import FreelancerCard from '@/components/freelancers/freelancer-card';
import {
  Search,
  Filter,
  X,
  RotateCcw,
  SlidersHorizontal,
  Users,
  ArrowUpDown
} from 'lucide-react';

export default function FindFreelancersPage() {
  const { freelancers: contextFreelancers } = useMarketplace();

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBadge, setSelectedBadge] = useState<string>('all');
  const [minRate, setMinRate] = useState<string>('');
  const [maxRate, setMaxRate] = useState<string>('');
  const [availability, setAvailability] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'rating' | 'rate_low' | 'rate_high' | 'success_score'>('rating');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Dynamic API state
  const [apiFreelancers, setApiFreelancers] = useState<Freelancer[] | null>(null);
  const [apiSource, setApiSource] = useState<'supabase' | 'fallback' | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch real talent dynamically from Supabase API
  useEffect(() => {
    let isCancelled = false;

    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    if (selectedBadge !== 'all') params.set('badge', selectedBadge);
    if (minRate && Number(minRate) > 0) params.set('minRate', minRate);
    if (maxRate && Number(maxRate) > 0) params.set('maxRate', maxRate);
    if (availability !== 'all') params.set('availability', availability);
    if (sortBy) params.set('sortBy', sortBy);

    fetch(`/api/freelancers?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data && Array.isArray(data.freelancers)) {
          setApiFreelancers(data.freelancers);
          setApiSource(data.source);
        }
      })
      .catch(() => {
        // Fallback to context
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [searchQuery, selectedCategory, selectedBadge, minRate, maxRate, availability, sortBy]);

  const baseFreelancers = apiFreelancers !== null ? apiFreelancers : contextFreelancers;

  // Filter computation over resolved talent
  const filteredFreelancers = useMemo(() => {
    return baseFreelancers.filter((f) => {
      // Query search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.name.toLowerCase().includes(q);
        const matchesTitle = f.title.toLowerCase().includes(q);
        const matchesBio = f.bio.toLowerCase().includes(q);
        const matchesSkills = f.skills.some((s) => s.toLowerCase().includes(q));
        if (!matchesName && !matchesTitle && !matchesBio && !matchesSkills) {
          return false;
        }
      }

      // Category
      if (selectedCategory && f.primaryCategory !== selectedCategory && !f.skills.some((s) => s.toLowerCase().includes(selectedCategory.toLowerCase()))) {
        return false;
      }

      // Badge
      if (selectedBadge !== 'all' && f.badge !== selectedBadge) {
        return false;
      }

      // Hourly rate range
      if (minRate && f.hourlyRate < Number(minRate)) {
        return false;
      }
      if (maxRate && f.hourlyRate > Number(maxRate)) {
        return false;
      }

      // Availability
      if (availability !== 'all' && f.availability !== availability) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'rate_high') {
        return b.hourlyRate - a.hourlyRate;
      }
      if (sortBy === 'rate_low') {
        return a.hourlyRate - b.hourlyRate;
      }
      if (sortBy === 'success_score') {
        return b.jobSuccessScore - a.jobSuccessScore;
      }
      return b.rating - a.rating;
    });
  }, [baseFreelancers, searchQuery, selectedCategory, selectedBadge, minRate, maxRate, availability, sortBy]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedBadge('all');
    setMinRate('');
    setMaxRate('');
    setAvailability('all');
    setSortBy('rating');
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(selectedCategory) ||
    selectedBadge !== 'all' ||
    Boolean(minRate) ||
    Boolean(maxRate) ||
    availability !== 'all';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Find Top Independent Talent
            </h1>
            {apiSource === 'supabase' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live PostgreSQL Talent
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Hire pre-vetted senior software engineers, AI architects, and UI/UX designers ready to start.
          </p>
        </div>

        {/* Mobile filter toggle */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 shadow-2xs"
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
            placeholder="Search freelancers by skill, name, or role (e.g. Next.js, AI, Product Designer)..."
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
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'rating' | 'rate_low' | 'rate_high' | 'success_score')}
            className="w-full sm:w-auto text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-hidden cursor-pointer"
          >
            <option value="rating">Top Rated (Default)</option>
            <option value="success_score">Job Success Score</option>
            <option value="rate_low">Hourly Rate: Low to High</option>
            <option value="rate_high">Hourly Rate: High to Low</option>
          </select>
        </div>
      </div>

      {/* Main Grid: Filters Sidebar + Freelancer Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* Desktop Sidebar Filters */}
        <div className={`lg:block ${mobileFiltersOpen ? 'block' : 'hidden'} bg-white rounded-xl border border-slate-200/90 p-5 space-y-6 shadow-2xs`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
              <Filter className="w-4 h-4 text-emerald-600" />
              <span>Filter Talent</span>
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
              Specialization
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

          {/* Badge Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Workspace Badge
            </label>
            <div className="space-y-1.5 text-xs text-slate-700">
              {[
                { id: 'all', label: 'All Badges' },
                { id: 'top_rated_plus', label: 'Top Rated Plus (Top 1%)' },
                { id: 'top_rated', label: 'Top Rated (Top 5%)' },
                { id: 'rising_talent', label: 'Rising Talent' }
              ].map((b) => (
                <label key={b.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="radio"
                    name="badgeFilter"
                    checked={selectedBadge === b.id}
                    onChange={() => setSelectedBadge(b.id)}
                    className="text-emerald-600 focus:ring-emerald-500 rounded-full"
                  />
                  <span>{b.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Hourly Rate Range Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Hourly Rate ($/hr)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={minRate}
                  onChange={(e) => setMinRate(e.target.value)}
                  placeholder="Min ($)"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 bg-slate-50 rounded-lg"
                />
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                  placeholder="Max ($)"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 bg-slate-50 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Availability Filter */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
              Availability
            </label>
            <div className="space-y-1.5 text-xs text-slate-700">
              {[
                { id: 'all', label: 'Any Availability' },
                { id: 'Available now', label: 'Available now' },
                { id: 'Part-time', label: 'Part-time (< 30 hrs/wk)' }
              ].map((av) => (
                <label key={av.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="radio"
                    name="availabilityFilter"
                    checked={availability === av.id}
                    onChange={() => setAvailability(av.id)}
                    className="text-emerald-600 focus:ring-emerald-500 rounded-full"
                  />
                  <span>{av.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Active Filters list */}
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
                {selectedBadge !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    {selectedBadge.replace('_', ' ')}
                    <button onClick={() => setSelectedBadge('all')} className="hover:text-rose-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {(minRate || maxRate) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700">
                    ${minRate || 0} - ${maxRate || '∞'}/hr
                    <button onClick={() => { setMinRate(''); setMaxRate(''); }} className="hover:text-rose-600">
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
              Showing <strong className="text-slate-900 font-semibold">{filteredFreelancers.length}</strong>{' '}
              {filteredFreelancers.length === 1 ? 'specialist' : 'specialists'}
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

          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Loading verified specialists from database...</p>
            </div>
          ) : filteredFreelancers.length > 0 ? (
            <div className="space-y-4">
              {filteredFreelancers.map((freelancer) => (
                <FreelancerCard key={freelancer.id} freelancer={freelancer} />
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-4 shadow-2xs">
              <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <Users className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">No freelancers found</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Try adjusting your filters or search keywords to explore more talented professionals.
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
