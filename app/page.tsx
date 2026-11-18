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
    <div className="space-y-16 sm:space-y-20 lg:space-y-24 pb-20 sm:pb-24">
      {/* 1. Upwork Hero & Social Proof Section */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
          {/* Client Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl sm:rounded-3xl p-8 sm:p-10 text-white relative overflow-hidden flex flex-col justify-between shadow-xs">
            <div className="space-y-3 sm:space-y-4">
              <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-wider text-emerald-400 block">
                For Employers & Startups
              </span>
              <h3 className="text-2xl sm:text-3xl lg:text-[32px] font-semibold leading-tight">
                Hire world-class talent on your schedule
              </h3>
              <p className="text-slate-300 text-[15px] sm:text-[16px] leading-relaxed">
                Connect with the top 3% of developers, AI specialists, and UI/UX designers ready to start immediately.
              </p>
            </div>
            <div className="pt-8">
              <Link
                href="/client/jobs/new"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-[#14a800] hover:bg-[#108a00] font-medium text-[15px] text-white transition-all shadow-md cursor-pointer"
              >
                <span>Post a Job Free</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Freelancer Card */}
          <div className="bg-gradient-to-br from-emerald-900 via-emerald-850 to-teal-900 rounded-2xl sm:rounded-3xl p-8 sm:p-10 text-white relative overflow-hidden flex flex-col justify-between shadow-xs">
            <div className="space-y-3 sm:space-y-4">
              <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-wider text-emerald-200 block">
                For Independent Professionals
              </span>
              <h3 className="text-2xl sm:text-3xl lg:text-[32px] font-semibold leading-tight">
                Find rewarding projects with vetted clients
              </h3>
              <p className="text-emerald-100/90 text-[15px] sm:text-[16px] leading-relaxed">
                Work on cutting-edge products, set your own rates, and get paid with guaranteed milestone protection.
              </p>
            </div>
            <div className="pt-8">
              <Link
                href="/jobs"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-emerald-950 hover:bg-emerald-50 font-medium text-[15px] transition-all shadow-md cursor-pointer"
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
