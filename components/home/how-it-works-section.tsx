'use client';

import React, { useState } from 'react';

export default function HowItWorksSection() {
  const [howItWorksTab, setHowItWorksTab] = useState<'clients' | 'freelancers'>('clients');

  return (
    <section className="bg-white border-y border-slate-200/80 py-16">
      <div className="max-w-[1140px] mx-auto px-4 sm:px-6">
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
  );
}

