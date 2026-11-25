'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function UpworkHero() {
  const [activeTab, setActiveTab] = useState<'hire' | 'work'>('hire');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Guarantee seamless video autoplay across all browsers (Chrome, Safari, iOS)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy fallback: video remains ready and renders poster gracefully
      });
    }
  }, [activeTab]);

  return (
    <div
      className="relative w-full rounded-2xl sm:rounded-3xl lg:rounded-[32px] overflow-hidden bg-[#111915] min-h-[460px] sm:min-h-[500px] md:h-[520px] lg:h-[550px] xl:h-[570px] flex items-center shadow-md group"
    >
      {/* Official Upwork Dynamic Background Video Loop */}
      <video
        key={activeTab}
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={activeTab === 'hire' ? '/images/upwork-hero-bg.jpg' : '/images/upwork-talent-designer.jpg'}
        className="absolute inset-0 w-full h-full object-cover object-[65%_center] sm:object-center pointer-events-none z-0 transition-opacity duration-500 filter brightness-[1.14] contrast-[1.05] saturate-[1.08]"
      >
        {activeTab === 'hire' ? (
          <>
            <source src="/videos/hero-video-sm.mp4" type="video/mp4" />
            <source src="/videos/upwork-hero.mp4" type="video/mp4" />
          </>
        ) : (
          <>
            <source src="/videos/hero-video-sm.mp4" type="video/mp4" />
            <source src="/videos/open-office-space.mp4" type="video/mp4" />
          </>
        )}
        {/* Graceful fallback img if video is unsupported or restricted */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeTab === 'hire' ? '/images/upwork-hero-bg.jpg' : '/images/upwork-talent-designer.jpg'}
          alt={activeTab === 'hire' ? 'Work at the speed of your ambition' : 'Scale your freelance career'}
          className="w-full h-full object-cover object-center"
        />
      </video>

      {/* Gentle, minimal contrast gradient: lets the natural light, warmth, and brightness of the video shine through without the dark, muddy overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/10 via-35% to-transparent pointer-events-none z-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent sm:hidden pointer-events-none z-10" />

      {/* Content Container - Positioned on left with ample breathing room */}
      <div className="relative z-20 w-full px-5 py-7 sm:px-10 sm:py-10 lg:px-14 xl:px-16 max-w-[580px]">
        {/* Hire / Work Toggle Pill */}
        <div className="inline-flex items-center p-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 mb-4 sm:mb-6 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('hire')}
            className={`px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
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
            className={`px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
              activeTab === 'work'
                ? 'bg-[#222222] text-white shadow-xs'
                : 'text-white/80 hover:text-white'
            }`}
          >
            Work
          </button>
        </div>

        {/* Dynamic Headline Based on Toggle - Exact Upwork editorial typography with crisp drop shadow */}
        <h1 className="font-serif text-[30px] sm:text-[44px] md:text-[50px] lg:text-[54px] font-normal tracking-tight text-white leading-[1.12] sm:leading-[1.1] transition-all duration-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
          {activeTab === 'hire' ? (
            <>
              <span className="break-words sm:whitespace-nowrap">Work at the speed</span> <br className="hidden sm:inline" />
              <span className="break-words sm:whitespace-nowrap">of your ambition</span>
            </>
          ) : (
            <>
              <span className="break-words sm:whitespace-nowrap">Find great work and</span> <br className="hidden sm:inline" />
              <span className="break-words sm:whitespace-nowrap">scale your career</span>
            </>
          )}
        </h1>

        {/* Dynamic Subtitle - 2 clean lines matching Upwork with subtle shadow for crisp readability */}
        <p className="mt-3.5 sm:mt-4 text-[15px] sm:text-[16px] lg:text-[17px] text-white/95 leading-[1.5] max-w-[480px] font-normal transition-all duration-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
          {activeTab === 'hire'
            ? 'Hire experts who use AI to amplify their talent, turning complex work into high impact business outcomes'
            : 'Meet clients you’re excited to work with and take your career or business to new heights with transparent contracts and escrow.'}
        </p>

        {/* Primary CTA Button - Exactly matching Upwork's signature green button with radiant emerald glow */}
        <div className="mt-6 sm:mt-8">
          <Link
            href={activeTab === 'hire' ? '/client/jobs/new' : '/jobs'}
            onClick={() => {
              if (activeTab === 'hire' && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('workspace:reset-post-job-form'));
              }
            }}
            className="group/btn relative inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-medium text-[15px] sm:text-[16px] transition-all duration-200 shadow-[0_0_28px_rgba(20,168,0,0.55),0_4px_16px_rgba(20,168,0,0.35)] hover:shadow-[0_0_38px_rgba(20,168,0,0.7),0_6px_22px_rgba(20,168,0,0.45)] cursor-pointer"
          >
            <span>{activeTab === 'hire' ? 'Get started' : 'Find opportunities'}</span>
            <ArrowRight className="w-4 h-4 stroke-[2.2] group-hover/btn:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}
