'use client';

import React, { useState } from 'react';

export default function HowItWorksSection() {
  const [howItWorksTab, setHowItWorksTab] = useState<'clients' | 'freelancers'>('clients');

  return (
    <section className="bg-white border-y border-slate-200/80 py-16 sm:py-20">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <span className="text-[12px] sm:text-[13px] font-semibold uppercase tracking-wider text-emerald-700">
            Transparent & Secure
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-[34px] font-semibold text-slate-900 tracking-tight mt-1.5">
            How Workspace Works
          </h2>
          <p className="text-[15px] sm:text-[16px] text-slate-600 mt-2.5 max-w-xl mx-auto leading-relaxed">
            A frictionless workflow designed for quality, accountability, and peace of mind.
          </p>

          {/* Toggle Tabs */}
          <div className="inline-flex p-1 bg-slate-100 rounded-full mt-6 sm:mt-7 border border-slate-200/60">
            <button
              onClick={() => setHowItWorksTab('clients')}
              type="button"
              className={`px-5 sm:px-6 py-2 text-[13px] sm:text-sm font-medium rounded-full transition-all cursor-pointer ${
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
              className={`px-5 sm:px-6 py-2 text-[13px] sm:text-sm font-medium rounded-full transition-all cursor-pointer ${
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 sm:gap-6">
            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                1
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Post Your Project</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Detail your scope, deliverables, timeline, and budget (fixed-price or hourly rate).
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                2
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Review Proposals</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Compare verified portfolios, ratings, and custom bids from top-tier specialists.
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                3
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Fund Milestones</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Deposit funds safely into escrow. Money is only released when you inspect and approve deliverables.
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                4
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Collaborate & Scale</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Track real-time progress, leave verified reviews, and rehire your favorite specialists with one click.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 sm:gap-6">
            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                1
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Build Your Profile</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Highlight your core tech stack, real portfolio case studies, and verifiable professional achievements.
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                2
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Submit High-Value Bids</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Browse matching client projects, define your exact milestones, and propose tailored solutions.
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                3
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Deliver Quality Work</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Work directly with decision makers with full payment protection funded upfront in escrow.
              </p>
            </div>

            <div className="bg-slate-50/80 rounded-2xl p-6 border border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all duration-200 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm">
                4
              </div>
              <h4 className="font-semibold text-slate-900 text-[17px] sm:text-[18px]">Get Paid On Time</h4>
              <p className="text-[14px] text-slate-600 leading-relaxed">
                Enjoy reliable payouts, build your Job Success Score, and unlock Top Rated Plus status perks.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

