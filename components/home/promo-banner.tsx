import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export default function PromoBanner() {
  return (
    <div className="w-full mb-4 sm:mb-5">
      <Link
        href="/freelancers"
        className="group block w-full bg-[#E4F8D5] hover:bg-[#DCF4CC] text-[#0A2540] transition-all duration-200 rounded-2xl px-5 py-3 sm:px-7 sm:py-3.5 border border-[#CEEBBF] shadow-2xs"
      >
        <div className="flex flex-row items-center justify-between gap-3">
          <p className="text-sm sm:text-base font-semibold tracking-tight text-slate-900 truncate">
            Hire the top 1% of talent on Business Plus.
          </p>
          <span className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-slate-900 group-hover:text-emerald-800 transition-colors shrink-0">
            <span>Get started</span>
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </Link>
    </div>
  );
}
