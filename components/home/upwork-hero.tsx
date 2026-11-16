'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function UpworkHero() {
  const [activeTab, setActiveTab] = useState<'hire' | 'work'>('hire');

  return (
    <div
      className="relative w-full rounded-2xl sm:rounded-3xl lg:rounded-[24px] overflow-hidden bg-[#111915] min-h-[440px] sm:h-[480px] md:h-[500px] lg:h-[520px] xl:h-[540px] flex items-center shadow-lg group"
    >
      {/* Official Upwork Background Video Loop - Wide perspective showing full room and window */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/images/upwork-hero-bg.jpg"
        className="absolute inset-0 w-full h-full object-cover object-[55%_center] sm:object-center pointer-events-none z-0"
      >
        <source src="/videos/hero-video-sm.mp4" type="video/mp4" />
        <source src="/videos/upwork-hero.mp4" type="video/mp4" />
        {/* Graceful fallback if video is not supported */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/upwork-hero-bg.jpg"
          alt="Work at the speed of your ambition"
          className="w-full h-full object-cover object-center"
        />
      </video>

      {/* Gentle left contrast gradient: provides crisp text legibility over the dark interior wall, leaving the sunlit window and room 100% natural, crisp, warm and bright */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/35 via-45% to-transparent pointer-events-none z-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent sm:hidden pointer-events-none z-10" />

      {/* Content Container - Positioned on left with ample breathing room */}
      <div className="relative z-20 w-full px-6 py-8 sm:px-10 sm:py-10 lg:px-12 xl:px-14 max-w-[560px]">
        {/* Hire / Work Toggle Pill */}
        <div className="inline-flex items-center p-1 rounded-full bg-black/45 backdrop-blur-md border border-white/15 mb-5 sm:mb-6 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('hire')}
            className={`px-5 py-1.5 sm:px-6 sm:py-2 rounded-full text-[13px] sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
              activeTab === 'hire'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-white/80 hover:text-white'
            }`}
          >
            Hire
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('work')}
            className={`px-5 py-1.5 sm:px-6 sm:py-2 rounded-full text-[13px] sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
              activeTab === 'work'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-white/80 hover:text-white'
            }`}
          >
            Work
          </button>
        </div>

        {/* Dynamic Headline Based on Toggle - Exact Upwork 2-line break & typography */}
        <h1 className="text-[32px] sm:text-[40px] md:text-[46px] lg:text-[50px] xl:text-[52px] font-medium tracking-tight text-white leading-[1.08] sm:leading-[1.1] transition-all duration-300">
          {activeTab === 'hire' ? (
            <>
              <span className="whitespace-nowrap">Work at the speed</span> <br />
              <span className="whitespace-nowrap">of your ambition</span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap">Find great work and</span> <br />
              <span className="whitespace-nowrap">scale your career</span>
            </>
          )}
        </h1>

        {/* Dynamic Subtitle - 2 clean lines matching Upwork */}
        <p className="mt-3.5 sm:mt-4 text-[15px] sm:text-[16px] lg:text-[17px] text-white/90 leading-[1.5] max-w-[460px] font-normal transition-all duration-300">
          {activeTab === 'hire'
            ? 'Hire experts who use AI to amplify their talent, turning complex work into high impact business outcomes'
            : 'Meet clients you’re excited to work with and take your career or business to new heights with transparent contracts and escrow.'}
        </p>

        {/* Primary CTA Button - Exactly matching Upwork's signature green button with radiant emerald glow */}
        <div className="mt-6 sm:mt-8">
          <Link
            href={activeTab === 'hire' ? '/client/jobs/new' : '/jobs'}
            className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-medium text-[15px] sm:text-[16px] transition-all duration-150 shadow-[0_4px_16px_rgba(20,168,0,0.4)] hover:shadow-[0_6px_22px_rgba(20,168,0,0.5)] cursor-pointer"
          >
            <span>{activeTab === 'hire' ? 'Get started' : 'Find opportunities'}</span>
            <ArrowRight className="w-4 h-4 stroke-[2.2]" />
          </Link>
        </div>
      </div>
    </div>
  );
}
