import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PromoBanner from '@/components/home/promo-banner';
import UpworkHero from '@/components/home/upwork-hero';
import TrustedBrands from '@/components/home/trusted-brands';
import SpecializationCategories from '@/components/home/specialization-categories';
import FeaturedJobs from '@/components/home/featured-jobs';
import FeaturedFreelancers from '@/components/home/featured-freelancers';
import HowItWorksSection from '@/components/home/how-it-works-section';

export default function HomePage() {
  return (
    <div className="space-y-16 pb-20">
      {/* 1. Upwork Hero & Social Proof Section */}
      <section className="w-full max-w-[1140px] mx-auto px-4 sm:px-6">
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
      <HowItWorksSection />

      {/* 6. Dual CTA Section */}
      <section className="max-w-[1140px] mx-auto px-4 sm:px-6">
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
