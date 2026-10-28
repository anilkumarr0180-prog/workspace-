import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export default function PromoBanner() {
  return (
    <div className="w-full mb-5 sm:mb-6">
      <Link
        href="/freelancers"
        className="group block w-full bg-[#D5F7CA] hover:bg-[#C8F2BC] text-[#001E00] transition-all duration-200 rounded-2xl sm:rounded-[20px] px-6 py-3.5 sm:px-8 sm:py-4 border border-[#C2EBB5] shadow-2xs"
      >
        <div className="flex flex-row items-center justify-between gap-4">
          <p className="text-[14px] sm:text-[15px] font-medium tracking-tight text-[#001E00] truncate">
            Hire the top 1% of talent on Business Plus.
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs sm:text-[14px] font-semibold text-[#001E00] shrink-0">
            <span className="underline underline-offset-4 decoration-1 group-hover:text-emerald-950 transition-colors">
              Get started
            </span>
            <ChevronRight className="w-4 h-4 text-[#001E00] group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </Link>
    </div>
  );
}
