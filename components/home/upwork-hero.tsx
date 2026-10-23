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
    <div className="relative w-full rounded-2xl sm:rounded-3xl lg:rounded-[28px] overflow-hidden bg-slate-900 min-h-[480px] sm:min-h-[520px] lg:h-[560px] lg:min-h-[560px] xl:h-[570px] xl:min-h-[570px] flex items-center shadow-xl">
      {/* Background Video - Workplace / Team collaboration */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/videos/open-office-poster.jpg"
        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none motion-reduce:hidden"
      >
        <source src="/videos/open-office-space.mp4" type="video/mp4" />
        {/* Graceful fallback img if video cannot be rendered */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/videos/open-office-poster.jpg"
          alt="Workspace team collaboration"
          className="w-full h-full object-cover object-center"
        />
      </video>

      {/* Fallback Static Poster for Reduced Motion Preferences */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center pointer-events-none hidden motion-reduce:block"
        style={{ backgroundImage: `url('/videos/open-office-poster.jpg')` }}
      />

      {/* High-Contrast Gradient Overlay for Crisp Legibility */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 via-45% to-black/35 sm:to-black/20 pointer-events-none" />

      {/* Content Container - Constrained to left to leave hero subject visible */}
      <div className="relative z-10 w-full p-6 sm:p-10 lg:p-14 xl:px-16 xl:py-14 max-w-xl lg:max-w-[560px] xl:max-w-[600px]">
        {/* Hire / Work Toggle Pill */}
        <div className="inline-flex items-center p-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 mb-5 sm:mb-6 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('hire')}
            className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'hire'
                ? 'bg-white/25 text-white shadow-xs backdrop-blur-xs'
                : 'text-white/70 hover:text-white font-medium'
            }`}
          >
            Hire
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('work')}
            className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'work'
                ? 'bg-white/25 text-white shadow-xs backdrop-blur-xs'
                : 'text-white/70 hover:text-white font-medium'
            }`}
          >
            Work
          </button>
        </div>

        {/* Dynamic Headline Based on Toggle - Serif Upwork Editorial Sizing */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[52px] xl:text-[54px] font-serif font-medium tracking-tight text-white leading-[1.08] sm:leading-[1.1] transition-all duration-300">
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
        <p className="mt-3.5 sm:mt-4 text-sm sm:text-base lg:text-[17px] text-white/85 leading-relaxed max-w-[460px] font-normal transition-all duration-300">
          {activeTab === 'hire'
            ? 'Hire experts who use AI to amplify their talent, turning complex work into high impact business outcomes'
            : 'Meet clients you’re excited to work with and take your career or business to new heights with transparent contracts and escrow.'}
        </p>

        {/* Primary CTA Button & Quick Search */}
        <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 sm:gap-4">
          <Link
            href={activeTab === 'hire' ? '/client/jobs/new' : '/jobs'}
            className="inline-flex items-center justify-center gap-2 px-6 sm:px-7 py-3 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-semibold text-[15px] sm:text-base transition-all duration-150 shadow-md shadow-black/20 shrink-0"
          >
            <span>{activeTab === 'hire' ? 'Get started' : 'Find opportunities'}</span>
            <ArrowRight className="w-4.5 h-4.5" />
          </Link>

          {/* Quick Search Trigger */}
          <div className="relative flex-1 max-w-sm hidden sm:block">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (quickSearch.trim()) {
                  router.push(`/jobs?q=${encodeURIComponent(quickSearch.trim())}`);
                }
              }}
              className="relative flex items-center"
            >
              <Search className="w-4 h-4 text-white/60 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder={activeTab === 'hire' ? 'Search talent by skill...' : 'Search jobs by title, keyword...'}
                className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/20 text-white placeholder:text-white/60 text-xs sm:text-sm pl-9 pr-3 py-3 rounded-full border border-white/20 focus:outline-hidden focus:ring-1 focus:ring-white/40 transition-colors"
              />
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
