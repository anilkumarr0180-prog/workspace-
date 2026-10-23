import React from 'react';
import Link from 'next/link';
import AuthHeader from '@/components/auth/auth-header';
import {
  ArrowRight,
  CheckCircle2,
  Star,
  ShieldCheck,
  Sparkles,
  Clock,
  Briefcase
} from 'lucide-react';

export const metadata = {
  title: 'Sign Up | Workspace — Hire Talent or Find Freelance Work',
  description:
    'Join Workspace as a client to hire top talent or as a freelancer to find high-paying jobs and projects.',
};

export default function SignupSelectionPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white overflow-x-hidden">
      {/* 1. Slim White Header */}
      <AuthHeader
        rightText="Already have an account?"
        actionText="Log in"
        actionHref="/login"
      />

      {/* 2. Full-Width Two-Panel Split Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 relative overflow-hidden min-h-[calc(100vh-68px)]">
        {/* ================= LEFT PANEL: Client ("I'm hiring") ================= */}
        <section
          aria-labelledby="client-signup-heading"
          className="relative bg-[#001e00] text-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 xl:p-16 overflow-hidden min-h-[560px] lg:min-h-full"
        >
          {/* Subtle Organic Background Textures & Flowing Waves */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Soft Ambient Radial Glow */}
            <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#14a800]/15 rounded-full blur-3xl pointer-events-none" />
            
            {/* Fine Dot Matrix Overlay */}
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage: 'radial-gradient(rgba(34, 197, 94, 0.9) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            {/* Flowing Organic Topographic Vector Curves */}
            <svg
              className="w-full h-full object-cover opacity-20"
              viewBox="0 0 800 900"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid slice"
            >
              <path
                d="M-100 200 C 150 150, 200 450, 450 350 C 700 250, 750 650, 950 550"
                stroke="#14a800"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <path
                d="M-50 400 C 200 350, 250 700, 550 550 C 750 450, 800 800, 950 750"
                stroke="#22c55e"
                strokeWidth="2"
              />
              <path
                d="M-150 600 C 100 550, 300 850, 600 750 C 800 680, 850 950, 1000 900"
                stroke="#15803d"
                strokeWidth="1.5"
              />
              <circle cx="680" cy="220" r="160" stroke="#16a34a" strokeWidth="1" opacity="0.2" />
              <circle cx="120" cy="780" r="200" stroke="#22c55e" strokeWidth="1" opacity="0.15" />
            </svg>
          </div>

          {/* Top: Header, Typography & CTA */}
          <div className="relative z-10 max-w-lg w-full mx-auto lg:mx-0 flex flex-col items-start text-left">
            <span className="text-xs uppercase font-bold tracking-widest text-emerald-400 mb-2 sm:mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>For Clients & Companies</span>
            </span>

            <h1
              id="client-signup-heading"
              className="text-4xl sm:text-5xl xl:text-[56px] font-semibold text-white tracking-tight leading-[1.08]"
            >
              I’m hiring
            </h1>

            <p className="mt-3.5 sm:mt-4 text-base sm:text-lg xl:text-xl text-emerald-100/85 font-normal leading-relaxed max-w-md">
              Post jobs and hire freelancers
            </p>

            <Link
              href="/signup/client"
              className="mt-6 sm:mt-8 inline-flex items-center justify-center gap-2 px-8 sm:px-9 py-3.5 sm:py-4 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] text-white font-semibold text-base sm:text-lg transition-all shadow-lg shadow-black/30 hover:shadow-black/50 group"
            >
              <span>Start hiring</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* Bottom: Illustrative Freelancer Talent Card Mockup */}
          <div className="relative z-10 mt-8 sm:mt-12 max-w-md w-full mx-auto lg:mx-0">
            <div className="p-4 sm:p-5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-2xl text-white transform hover:-translate-y-1 transition-transform duration-300">
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 font-bold text-white flex items-center justify-center text-sm shadow-md border border-white/20">
                      SJ
                    </div>
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#14a800] border-2 border-[#001e00] rounded-full" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-sm sm:text-base text-white">
                      <span>Sarah Jenkins</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    </div>
                    <div className="text-xs text-emerald-200/80">Senior Full-Stack & AI Engineer</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-emerald-300">$85/hr</div>
                  <div className="text-[10px] text-white/60">Hourly rate</div>
                </div>
              </div>

              {/* Stats Strip */}
              <div className="flex items-center gap-3 py-2.5 text-xs text-white/80">
                <div className="flex items-center gap-1 text-amber-400">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span className="font-semibold text-white">5.0</span>
                  <span className="text-white/60">(48 reviews)</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1 text-emerald-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>100% Job Success</span>
                </div>
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  Top Rated Plus
                </span>
              </div>

              {/* Skills Tags */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['React', 'Next.js 16', 'TypeScript', 'Tailwind', 'Supabase'].map((skill) => (
                  <span
                    key={skill}
                    className="px-2.5 py-0.5 rounded-full bg-white/10 text-[11px] font-medium text-emerald-100 border border-white/10"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================= RIGHT PANEL: Freelancer ("I'm a freelancer") ================= */}
        <section
          aria-labelledby="freelancer-signup-heading"
          className="relative bg-[#dcf5c8] text-[#001e00] flex flex-col justify-between p-6 sm:p-10 lg:p-14 xl:p-16 overflow-hidden min-h-[560px] lg:min-h-full"
        >
          {/* Subtle Organic Background Textures & Flowing Waves */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Soft Ambient Radial Glow */}
            <div className="absolute -top-32 -right-32 w-96 h-96 bg-white/40 rounded-full blur-3xl pointer-events-none" />

            {/* Fine Dot Matrix Overlay */}
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage: 'radial-gradient(rgba(0, 30, 0, 0.9) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            {/* Flowing Organic Topographic Vector Curves */}
            <svg
              className="w-full h-full object-cover opacity-25"
              viewBox="0 0 800 900"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid slice"
            >
              <path
                d="M-50 150 C 200 250, 350 100, 600 280 C 750 380, 850 200, 950 300"
                stroke="#108a00"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <path
                d="M-100 450 C 150 550, 300 350, 550 500 C 750 600, 850 450, 1000 550"
                stroke="#15803d"
                strokeWidth="2"
              />
              <path
                d="M0 750 C 250 800, 400 650, 650 780 C 800 850, 900 720, 1050 820"
                stroke="#16a34a"
                strokeWidth="1.5"
              />
              <circle cx="200" cy="300" r="150" stroke="#15803d" strokeWidth="1" opacity="0.15" />
              <circle cx="700" cy="700" r="230" stroke="#108a00" strokeWidth="1" opacity="0.1" />
            </svg>
          </div>

          {/* Top: Header, Typography & CTA */}
          <div className="relative z-10 max-w-lg w-full mx-auto lg:mx-0 flex flex-col items-start text-left">
            <span className="text-xs uppercase font-bold tracking-widest text-[#001e00]/75 mb-2 sm:mb-3 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5" />
              <span>For Talent & Specialists</span>
            </span>

            <h2
              id="freelancer-signup-heading"
              className="text-4xl sm:text-5xl xl:text-[56px] font-semibold text-[#001e00] tracking-tight leading-[1.08]"
            >
              I’m a freelancer
            </h2>

            <p className="mt-3.5 sm:mt-4 text-base sm:text-lg xl:text-xl text-[#001e00]/85 font-normal leading-relaxed max-w-md">
              Find jobs and get paid
            </p>

            <Link
              href="/signup/freelancer"
              className="mt-6 sm:mt-8 inline-flex items-center justify-center gap-2 px-8 sm:px-9 py-3.5 sm:py-4 rounded-full border-2 border-[#001e00] text-[#001e00] hover:bg-[#001e00] hover:text-white active:scale-[0.98] font-semibold text-base sm:text-lg transition-all shadow-sm group"
            >
              <span>Find work</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          {/* Bottom: Illustrative Job Posting Card Mockup */}
          <div className="relative z-10 mt-8 sm:mt-12 max-w-md w-full mx-auto lg:mx-0">
            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#001e00]/10 shadow-xl text-slate-900 transform hover:-translate-y-1 transition-transform duration-300">
              {/* Job Header */}
              <div className="flex items-start justify-between gap-3 pb-2.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Posted 2 hours ago</span>
                  <span>•</span>
                  <span>Worldwide Remote</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                  Verified Client
                </span>
              </div>

              {/* Job Title & Budget */}
              <div className="mt-1">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 leading-snug line-clamp-1">
                  Lead Next.js & React Frontend Architect
                </h3>
                <div className="mt-1 text-xs font-semibold text-emerald-700">
                  $6,500 Fixed Price <span className="font-normal text-slate-500">• Expert Level</span>
                </div>
              </div>

              {/* Snippet */}
              <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                Looking for an expert developer to build high-performance, pixel-accurate web applications with modern Tailwind design and Supabase auth...
              </p>

              {/* Tags & Client Rating */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {['Next.js', 'TypeScript', 'Tailwind'].map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  <span>4.98 ($140k+ spent)</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
