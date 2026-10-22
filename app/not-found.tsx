import React from 'react';
import Link from 'next/link';
import { Home, Briefcase } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-24 text-center space-y-6">
      <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto text-2xl font-black border border-emerald-200">
        404
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
          Page Not Found
        </h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          The page or resource you are looking for doesn&apos;t exist, was renamed, or is temporarily unavailable.
        </p>
      </div>

      <div className="pt-4 flex items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>Workspace Home</span>
        </Link>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 transition-colors"
        >
          <Briefcase className="w-4 h-4" />
          <span>Browse Jobs</span>
        </Link>
      </div>
    </div>
  );
}
