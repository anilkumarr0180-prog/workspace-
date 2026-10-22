'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { CATEGORIES } from '@/lib/mock-data';
import JobCard from '@/components/jobs/job-card';
import FreelancerCard from '@/components/freelancers/freelancer-card';
import {
  ArrowRight,
  Sparkles,
  Briefcase,
  ChevronRight,
  Code2,
  Palette,
  Smartphone,
  Cloud
} from 'lucide-react';

import PromoBanner from '@/components/home/promo-banner';
import UpworkHero from '@/components/home/upwork-hero';
import TrustedBrands from '@/components/home/trusted-brands';

export default function HomePage() {
  const { jobs, freelancers } = useMarketplace();
  const [howItWorksTab, setHowItWorksTab] = useState<'clients' | 'freelancers'>('clients');

  const featuredJobs = jobs.filter((j) => j.isFeatured).slice(0, 3);
  const featuredFreelancers = freelancers.slice(0, 3);

  const getCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'Code2':
        return <Code2 className="w-6 h-6 text-emerald-600" />;
      case 'Sparkles':
        return <Sparkles className="w-6 h-6 text-emerald-600" />;
      case 'Palette':
        return <Palette className="w-6 h-6 text-emerald-600" />;
      case 'Smartphone':
        return <Smartphone className="w-6 h-6 text-emerald-600" />;
      case 'Cloud':
        return <Cloud className="w-6 h-6 text-emerald-600" />;
      default:
        return <Briefcase className="w-6 h-6 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-16 pb-20">
      {/* 1. Upwork Hero & Social Proof Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
        <PromoBanner />
        <UpworkHero />
        <TrustedBrands />
      </section>

      {/* 2. Popular Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Explore by Specialization
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
              Browse Top Skill Categories
            </h2>
          </div>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <span>View all open projects</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              href={`/jobs?category=${encodeURIComponent(cat.name)}`}
              className="group bg-white rounded-xl border border-slate-200/80 p-6 hover:border-emerald-500/60 hover:shadow-md transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:scale-105 transition-transform">
                    {getCategoryIcon(cat.icon)}
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {cat.jobCount.toLocaleString()} open jobs
                  </span>
                </div>

                <h3 className="text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                  {cat.name}
                </h3>
                <p className="text-xs font-semibold text-emerald-700 mt-1">
                  Avg: {cat.avgHourlyRate}
                </p>

                <div className="flex flex-wrap gap-1.5 mt-4">
                  {cat.popularSkills.slice(0, 4).map((skill) => (
                    <span
                      key={skill}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-500 group-hover:text-emerald-700">
                <span>Browse category</span>
                <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 3. Featured Jobs */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Verified Opportunities
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
              Featured Client Projects
            </h2>
          </div>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <span>See all {jobs.length} jobs</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {featuredJobs.map((job) => (
            <JobCard key={job.id} job={job} compact />
          ))}
        </div>
      </section>

      {/* 4. Featured Freelancers */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Top Rated Talent
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
              Hire Elite Independent Specialists
            </h2>
          </div>
          <Link
            href="/freelancers"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <span>Explore all freelancers</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredFreelancers.map((freelancer) => (
            <FreelancerCard key={freelancer.id} freelancer={freelancer} />
          ))}
        </div>
      </section>

      {/* 5. How It Works Section */}
      <section className="bg-white border-y border-slate-200/80 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
