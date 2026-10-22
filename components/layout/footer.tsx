import React from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2, Globe, ArrowUpRight } from 'lucide-react';
import WorkspaceLogo from '@/components/layout/workspace-logo';

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-slate-800">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="inline-block">
              <WorkspaceLogo dark={true} />
            </Link>

            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              Workspace connects ambitious organizations with the world&apos;s most capable independent engineers, designers, and AI specialists. Built for trust, speed, and excellence.
            </p>

            <div className="flex items-center gap-4 pt-2 text-xs text-slate-400">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Verified Talent Pool</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>Escrow Protected</span>
              </div>
            </div>
          </div>

          {/* Column 1: For Clients */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">For Clients</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/freelancers" className="hover:text-white transition-colors">
                  Find Specialists
                </Link>
              </li>
              <li>
                <Link href="/client/jobs/new" className="hover:text-white transition-colors">
                  Post a Project
                </Link>
              </li>
              <li>
                <Link href="/client" className="hover:text-white transition-colors">
                  Client Dashboard
                </Link>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">Enterprise Solutions</span>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">Payroll & Contracts</span>
              </li>
            </ul>
          </div>

          {/* Column 2: For Talent */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">For Talent</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/jobs" className="hover:text-white transition-colors">
                  Browse Open Projects
                </Link>
              </li>
              <li>
                <Link href="/freelancer" className="hover:text-white transition-colors">
                  Freelancer Hub
                </Link>
              </li>
              <li>
                <Link href="/saved" className="hover:text-white transition-colors">
                  Saved Opportunities
                </Link>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">Top Rated Program</span>
              </li>
              <li>
                <span className="text-slate-500 cursor-not-allowed">Community Forum</span>
              </li>
            </ul>
          </div>

          {/* Column 3: Skill Categories */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Top Skills</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/jobs?category=Development+%26+IT" className="hover:text-white transition-colors flex items-center justify-between">
                  <span>Next.js & React</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=AI+%26+Machine+Learning" className="hover:text-white transition-colors flex items-center justify-between">
                  <span>Generative AI & LLMs</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=Design+%26+Creative" className="hover:text-white transition-colors flex items-center justify-between">
                  <span>UI/UX & Figma</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=Cloud+%26+DevOps" className="hover:text-white transition-colors flex items-center justify-between">
                  <span>DevOps & Cloud</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© 2026 Workspace Inc. All rights reserved. Original frontend implementation.</p>
          <div className="flex items-center gap-6">
            <span className="hover:text-slate-300">Privacy Policy</span>
            <span className="hover:text-slate-300">Terms of Service</span>
            <span className="hover:text-slate-300">Security</span>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Globe className="w-3.5 h-3.5" />
              <span>English (US)</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
