import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export default function PromoBanner() {
  return (
    <div className="w-full mt-6 sm:mt-8 mb-5 sm:mb-6">
      <Link
        href="/freelancers"
        className="group flex flex-row items-center justify-between w-full bg-[#D5F7CA] hover:bg-[#c9f2bc] text-[#001E00] transition-all duration-200 rounded-2xl sm:rounded-[20px] px-5 sm:px-7 py-3.5 sm:py-4 min-h-[56px] sm:h-[62px] border border-[#bfe7b1]/70 shadow-2xs"
      >
        <p className="text-[14px] sm:text-[15px] font-medium tracking-normal text-[#001E00] truncate">
          Hire the top 1% of talent on Business Plus.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[14px] sm:text-[15px] font-semibold text-[#001E00] shrink-0 ml-4">
          <span className="underline underline-offset-4 decoration-[1.5px] group-hover:decoration-2 transition-all">
            Get started
          </span>
          <ChevronRight className="w-4 h-4 text-[#001E00] group-hover:translate-x-0.5 transition-transform" />
        </span>
      </Link>
    </div>
  );
}
