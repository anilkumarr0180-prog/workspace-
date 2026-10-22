'use client';

import React, { useState } from 'react';
import NextLink from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import WorkspaceLogo from '@/components/layout/workspace-logo';
import {
  ChevronDown,
  Menu,
  X,
  Search,
  Bookmark,
  Briefcase,
  Users,
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';

export default function Navbar() {
  const { savedJobIds } = useMarketplace();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200/80 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          {/* Left: Brand & Main Navigation */}
          <div className="flex items-center gap-8">
            <NextLink href="/" className="flex items-center shrink-0">
              <WorkspaceLogo />
            </NextLink>

            {/* Desktop Navigation Links (Upwork Style) */}
            <nav className="hidden lg:flex items-center gap-1 text-[15px] font-medium text-slate-800">
              {/* Hire Talent Dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setActiveDropdown('hire')}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                >
                  <span>Hire talent</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {activeDropdown === 'hire' && (
                  <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                    <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                      <NextLink
                        href="/client/jobs/new"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                            Post a Job
                          </div>
                          <div className="text-xs text-slate-500">Find talent and hire fast</div>
                        </div>
                      </NextLink>

                      <NextLink
                        href="/freelancers"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                            Explore Freelancers
                          </div>
                          <div className="text-xs text-slate-500">Browse verified specialist profiles</div>
                        </div>
                      </NextLink>

                      <NextLink
                        href="/client"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                            Client Dashboard
                          </div>
                          <div className="text-xs text-slate-500">Manage posted jobs and hires</div>
                        </div>
                      </NextLink>
                    </div>
                  </div>
                )}
              </div>

              {/* Find Work Dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setActiveDropdown('work')}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                >
                  <span>Find work</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {activeDropdown === 'work' && (
                  <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                    <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                      <NextLink
                        href="/jobs"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                            Browse All Jobs
                          </div>
                          <div className="text-xs text-slate-500">Search high-budget contracts</div>
                        </div>
                      </NextLink>

                      <NextLink
                        href="/freelancer"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                            Freelancer Hub
                          </div>
                          <div className="text-xs text-slate-500">Track submitted proposals and bids</div>
                        </div>
                      </NextLink>

                      <NextLink
                        href="/saved"
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                          <Bookmark className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Saved Jobs
                            </span>
                            {savedJobIds.length > 0 && (
                              <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[11px] font-bold rounded-full">
                                {savedJobIds.length}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">Your bookmarked opportunities</div>
                        </div>
                      </NextLink>
                    </div>
                  </div>
                )}
              </div>

              {/* Why Upwork */}
              <NextLink
                href="/jobs?category=AI+%26+Machine+Learning"
                className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors"
              >
                Get outcomes
              </NextLink>

              <NextLink
                href="/freelancers"
                className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors"
              >
                Why Workspace
              </NextLink>

              <NextLink
                href="/client"
                className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors"
              >
                Enterprise
              </NextLink>
            </nav>
          </div>

          {/* Right: Search, Log in, Sign up button */}
          <div className="flex items-center gap-4">
            {/* Quick Search Link */}
            <NextLink
              href="/jobs"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors hidden sm:flex items-center gap-1.5 text-sm"
              title="Search jobs"
            >
              <Search className="w-4 h-4" />
              <span className="text-xs text-slate-500 hidden md:inline">Search</span>
            </NextLink>

            {/* Saved Jobs Icon */}
            <NextLink
              href="/saved"
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
              title="Saved jobs"
            >
              <Bookmark className="w-4 h-4" />
              {savedJobIds.length > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-[#14a800] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {savedJobIds.length}
                </span>
              )}
            </NextLink>

            {/* Log in link */}
            <NextLink
              href="/freelancer"
              className="text-sm font-semibold text-slate-800 hover:text-[#14a800] transition-colors hidden sm:inline-block"
            >
              Log in
            </NextLink>

            {/* Sign up / Post Job Pill Button (Upwork Style) */}
            <NextLink
              href="/client/jobs/new"
              className="inline-flex items-center justify-center px-5 py-2 rounded-full text-sm font-semibold text-white bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] transition-all shadow-xs"
            >
              <span>Sign up</span>
            </NextLink>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="p-2 lg:hidden text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3 shadow-lg">
          <div className="space-y-1">
            <NextLink
              href="/jobs"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Find work (Jobs)</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/freelancers"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Find talent (Freelancers)</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/client"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Client Hub</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/freelancer"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Freelancer Hub</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/saved"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span>Saved Jobs</span>
                {savedJobIds.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[11px] font-bold rounded-full">
                    {savedJobIds.length}
                  </span>
                )}
              </div>
              <Bookmark className="w-4 h-4 text-slate-400" />
            </NextLink>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            <NextLink
              href="/client/jobs/new"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white bg-[#14a800] hover:bg-[#108a00] shadow-sm"
            >
              <span>Post a Job Free</span>
              <ArrowRight className="w-4 h-4" />
            </NextLink>

            <NextLink
              href="/freelancer"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full flex items-center justify-center py-2.5 rounded-full text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Log in
            </NextLink>
          </div>
        </div>
      )}
    </header>
  );
}
