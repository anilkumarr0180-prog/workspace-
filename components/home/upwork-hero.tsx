'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';

export default function UpworkHero() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'hire' | 'work'>('hire');
  const [quickSearch, setQuickSearch] = useState('');

  return (
    <div className="relative w-full rounded-3xl sm:rounded-[32px] overflow-hidden bg-slate-900 min-h-[520px] sm:min-h-[560px] lg:min-h-[600px] flex items-center shadow-xl">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-700 hover:scale-[1.01]"
        style={{ backgroundImage: `url('/images/upwork-hero.jpg')` }}
      />

      {/* High-Contrast Gradient Overlay for Legibility */}
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/80 to-slate-950/30 sm:to-slate-950/20 pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 w-full p-6 sm:p-12 lg:p-16 max-w-3xl">
        {/* Hire / Work Toggle Pill */}
        <div className="inline-flex items-center p-1 rounded-full bg-black/50 backdrop-blur-md border border-white/15 mb-6 sm:mb-8 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('hire')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'hire'
                ? 'bg-[#222325] text-white shadow-sm'
                : 'text-white/70 hover:text-white'
            }`}
          >
            Hire
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('work')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'work'
                ? 'bg-[#222325] text-white shadow-sm'
                : 'text-white/70 hover:text-white'
            }`}
          >
            Work
          </button>
        </div>

        {/* Dynamic Headline Based on Toggle */}
        <h1 className="text-3xl sm:text-5xl lg:text-[56px] font-bold tracking-tight text-white leading-[1.1] transition-all duration-300">
          {activeTab === 'hire' ? (
            <>
              Work at the speed of <br className="hidden sm:inline" />
              your ambition
            </>
          ) : (
            <>
              Find great work and <br className="hidden sm:inline" />
              scale your career
            </>
          )}
        </h1>

        {/* Dynamic Subtitle */}
        <p className="mt-4 sm:mt-5 text-base sm:text-lg text-white/90 leading-relaxed max-w-xl font-normal transition-all duration-300">
          {activeTab === 'hire'
            ? 'Hire experts who use AI to amplify their talent, turning complex work into high impact business outcomes'
            : 'Meet clients you’re excited to work with and take your career or business to new heights with transparent contracts and escrow.'}
        </p>

        {/* Primary CTA Button */}
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <Link
            href={activeTab === 'hire' ? '/client/jobs/new' : '/jobs'}
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-semibold text-base transition-all duration-150 shadow-lg shadow-emerald-950/30"
          >
            <span>{activeTab === 'hire' ? 'Get started' : 'Find opportunities'}</span>
            <ArrowRight className="w-5 h-5" />
          </Link>

          {/* Quick Search Trigger */}
          <div className="relative flex-1 max-w-sm hidden md:block">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (quickSearch.trim()) {
                  router.push(`/jobs?q=${encodeURIComponent(quickSearch.trim())}`);
                }
              }}
              className="relative flex items-center"
            >
              <Search className="w-4 h-4 text-white/50 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder={activeTab === 'hire' ? 'Search talent by skill...' : 'Search jobs by title, keyword...'}
                className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/20 text-white placeholder:text-white/50 text-xs sm:text-sm pl-9 pr-3 py-3 rounded-full border border-white/15 focus:outline-hidden focus:ring-1 focus:ring-white/40 transition-colors"
              />
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
