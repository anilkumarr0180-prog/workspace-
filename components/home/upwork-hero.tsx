'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function UpworkHero() {
  const [activeTab, setActiveTab] = useState<'hire' | 'work'>('hire');

  return (
    <div
      className="relative w-full rounded-2xl sm:rounded-3xl lg:rounded-[28px] overflow-hidden bg-[#0d1519] min-h-[500px] sm:min-h-[560px] lg:h-[600px] lg:min-h-[600px] xl:h-[620px] xl:min-h-[620px] flex items-center shadow-xl group"
    >
      {/* Official Upwork Background Video Loop */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/images/upwork-hero-bg.jpg"
        className="absolute inset-0 w-full h-full object-cover object-[75%_center] sm:object-center pointer-events-none z-0"
      >
        <source src="/videos/hero-video-sm.mp4" type="video/mp4" />
        <source src="/videos/upwork-hero.mp4" type="video/mp4" />
        {/* Graceful fallback if video is not supported */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/upwork-hero-bg.jpg"
          alt="Work at the speed of your ambition"
          className="w-full h-full object-cover object-[70%_center] sm:object-center"
        />
      </video>

      {/* Balanced Vignette & Overlay for high text contrast without darkening the subject */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 via-50% to-transparent pointer-events-none z-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none z-10" />

      {/* Content Container - Positioned on left with plenty of breathing room */}
      <div className="relative z-20 w-full p-8 sm:p-12 lg:p-16 xl:px-20 xl:py-16 max-w-xl lg:max-w-[620px] xl:max-w-[660px]">
        {/* Hire / Work Toggle Pill */}
        <div className="inline-flex items-center p-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 mb-6 sm:mb-8 shadow-inner">
          <button
            type="button"
            onClick={() => setActiveTab('hire')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'hire'
                ? 'bg-[#141414] text-white shadow-xs'
                : 'text-white/75 hover:text-white font-medium'
            }`}
          >
            Hire
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('work')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === 'work'
                ? 'bg-[#141414] text-white shadow-xs'
                : 'text-white/75 hover:text-white font-medium'
            }`}
          >
            Work
          </button>
        </div>

        {/* Dynamic Headline Based on Toggle - Authentic Upwork Bold Neo-Grotesque Sans */}
        <h1 className="text-4xl sm:text-5xl md:text-[56px] lg:text-[62px] xl:text-[66px] font-semibold tracking-[-0.03em] text-white leading-[1.08] transition-all duration-300">
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
        <p className="mt-4 sm:mt-5 text-base sm:text-lg lg:text-[19px] text-white/90 leading-[1.45] max-w-[500px] font-normal transition-all duration-300">
          {activeTab === 'hire'
            ? 'Hire experts who use AI to amplify their talent, turning complex work into high impact business outcomes'
            : 'Meet clients you’re excited to work with and take your career or business to new heights with transparent contracts and escrow.'}
        </p>

        {/* Primary CTA Button - Exactly matching Upwork's signature green button */}
        <div className="mt-8 sm:mt-10">
          <Link
            href={activeTab === 'hire' ? '/client/jobs/new' : '/jobs'}
            className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-semibold text-[15px] sm:text-base transition-all duration-150 shadow-md shadow-black/25"
          >
            <span>{activeTab === 'hire' ? 'Get started' : 'Find opportunities'}</span>
            <ArrowRight className="w-4.5 h-4.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
