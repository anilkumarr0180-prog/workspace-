'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight } from 'lucide-react';
import PromoBanner from '@/components/home/promo-banner';
import UpworkHero from '@/components/home/upwork-hero';
import TrustedBrands from '@/components/home/trusted-brands';
import SpecializationCategories from '@/components/home/specialization-categories';
import FeaturedJobs from '@/components/home/featured-jobs';
import FeaturedFreelancers from '@/components/home/featured-freelancers';

export default function HomePage() {
  const router = useRouter();
  const [howItWorksTab, setHowItWorksTab] = useState<'clients' | 'freelancers'>('clients');

  useEffect(() => {
    let isMounted = true;
    async function checkUserSession() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data?.user && isMounted) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('active_mode')
            .eq('id', data.user.id)
            .maybeSingle();

          if (!isMounted) return;
          const role = profile?.active_mode || (data.user.user_metadata?.role as string) || 'freelancer';
          router.replace(role === 'client' ? '/client' : '/freelancer');
        }
      } catch {
        // Guest user or network failure - continue rendering public homepage
      }
    }
    checkUserSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div className="space-y-16 pb-20">
      {/* 1. Upwork Hero & Social Proof Section */}
      <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-4 sm:pt-6">
        <PromoBanner />
        <UpworkHero />
        <TrustedBrands />
      </section>

      {/* 2. Explore by Specialization */}
      <SpecializationCategories />

      {/* 3. Featured Jobs */}
      <FeaturedJobs />

      {/* 4. Featured Freelancers / Top Rated Talent */}
      <FeaturedFreelancers />

      {/* 5. How It Works Section */}
      <section className="bg-white border-y border-slate-200/80 py-16">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Transparent & Secure
            </span>
            <h2 className="text-3xl font-bold text-slate-900 mt-1">
              How Workspace Works
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              A frictionless workflow designed for quality, accountability, and peace of mind.
            </p>

            {/* Toggle Tabs */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl mt-6">
              <button
                onClick={() => setHowItWorksTab('clients')}
                type="button"
                className={`px-5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  howItWorksTab === 'clients'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                For Organizations & Clients
              </button>
              <button
                onClick={() => setHowItWorksTab('freelancers')}
                type="button"
                className={`px-5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  howItWorksTab === 'freelancers'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                For Independent Talent
              </button>
            </div>
          </div>

          {howItWorksTab === 'clients' ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <h4 className="font-bold text-slate-900 text-base">Post Your Project</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Detail your scope, deliverables, timeline, and budget (fixed-price or hourly rate).
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <h4 className="font-bold text-slate-900 text-base">Review Proposals</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Compare verified portfolios, ratings, and custom bids from top-tier specialists.
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <h4 className="font-bold text-slate-900 text-base">Fund Milestones</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Deposit funds safely into escrow. Money is only released when you inspect and approve deliverables.
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  4
                </div>
                <h4 className="font-bold text-slate-900 text-base">Collaborate & Scale</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Track real-time progress, leave verified reviews, and rehire your favorite specialists with one click.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <h4 className="font-bold text-slate-900 text-base">Build Your Profile</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Highlight your core tech stack, real portfolio case studies, and verifiable professional achievements.
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <h4 className="font-bold text-slate-900 text-base">Submit High-Value Bids</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Browse matching client projects, define your exact milestones, and propose tailored solutions.
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <h4 className="font-bold text-slate-900 text-base">Deliver Quality Work</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Work directly with decision makers with full payment protection funded upfront in escrow.
                </p>
              </div>

              <div className="bg-slate-50/70 rounded-xl p-6 border border-slate-200/70 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  4
                </div>
                <h4 className="font-bold text-slate-900 text-base">Get Paid On Time</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enjoy reliable payouts, build your Job Success Score, and unlock Top Rated Plus status perks.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 6. Dual CTA Section */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Client Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-8 sm:p-10 text-white relative overflow-hidden flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                For Employers & Startups
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                Hire world-class talent on your schedule
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Connect with the top 3% of developers, AI specialists, and UI/UX designers ready to start immediately.
              </p>
            </div>
            <div className="pt-8">
              <Link
                href="/client/jobs/new"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm text-white transition-all shadow-md"
              >
                <span>Post a Job Free</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Freelancer Card */}
          <div className="bg-gradient-to-br from-emerald-800 to-teal-900 rounded-2xl p-8 sm:p-10 text-white relative overflow-hidden flex flex-col justify-between">
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">
                For Independent Professionals
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                Find rewarding projects with vetted clients
              </h3>
              <p className="text-emerald-100 text-sm leading-relaxed">
                Work on cutting-edge products, set your own rates, and get paid with guaranteed milestone protection.
              </p>
            </div>
            <div className="pt-8">
              <Link
                href="/jobs"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-semibold text-sm transition-all shadow-md"
              >
                <span>Browse Open Jobs</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
