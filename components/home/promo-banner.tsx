import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export default function PromoBanner() {
  return (
    <div className="w-full mt-7 sm:mt-10 mb-6 sm:mb-8">
      <Link
        href="/freelancers"
        className="group flex flex-row items-center justify-between w-full bg-[#D5F7CA] hover:bg-[#c9f2bc] text-[#001E00] transition-colors duration-200 rounded-2xl px-6 sm:px-8 py-5 sm:py-[24px] min-h-[64px] sm:h-[76px] border border-[#c2ebb5]/60"
      >
        <p className="text-[14px] sm:text-[15px] font-medium tracking-normal text-[#001E00] truncate">
          Hire the top 1% of talent on Business Plus.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[14px] font-medium sm:font-semibold text-[#001E00] shrink-0">
          <span className="underline underline-offset-4 decoration-1 group-hover:text-emerald-950 transition-colors">
            Get started
          </span>
          <ChevronRight className="w-4 h-4 text-[#001E00] group-hover:translate-x-0.5 transition-transform" />
        </span>
      </Link>
    </div>
  );
}
