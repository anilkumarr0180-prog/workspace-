import React from 'react';

export default function TrustedBrands() {
  return (
    <div className="w-full pt-10 sm:pt-12 pb-6 sm:pb-8 text-center">
      <p className="text-[11px] sm:text-[12px] font-semibold tracking-[0.22em] text-[#5e6d55] uppercase mb-7 sm:mb-8">
        TRUSTED BY 800,000 CLIENTS
      </p>

      <div className="flex flex-wrap items-center justify-center sm:justify-between gap-x-6 sm:gap-x-8 lg:gap-x-10 gap-y-5 sm:gap-y-6 px-2">
        {/* Airbnb */}
        <div className="flex items-center gap-1.5 text-[#FF5A5F] font-semibold text-lg tracking-tight shrink-0">
          <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
            <path d="M12 2C9.24 2 7 4.24 7 7c0 2.22 1.34 4.54 3.03 6.94C11.16 15.53 12 16.5 12 16.5s.84-.97 1.97-2.56C15.66 11.54 17 9.22 17 7c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
          </svg>
          <span className="font-bold">airbnb</span>
        </div>

        {/* Databricks */}
        <div className="flex items-center gap-2 text-[#FF3621] font-semibold text-base shrink-0">
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.4 6 12 2.2 19.6 6 12 9.5zm0 3L3.5 8.2v3.6L12 16l8.5-4.2V8.2L12 12.5z" />
          </svg>
          <span className="font-bold tracking-tight">databricks</span>
        </div>

        {/* Cloudflare */}
        <div className="flex items-center gap-1.5 shrink-0">
          <svg className="w-6 h-6 fill-[#F38020]" viewBox="0 0 24 24">
            <path d="M18.6 13.5c-.2-1.8-1.7-3.1-3.6-3.1-.7 0-1.4.2-2 .6-.6-1.5-2.1-2.5-3.8-2.5-2.2 0-4 1.7-4.1 3.9C3.8 12.8 3 13.9 3 15.3c0 1.8 1.5 3.2 3.3 3.2h12.2c1.7 0 3-1.3 3-3 0-1.5-1.1-2.8-2.6-3-.1.1-.2 0-.3 0z" />
          </svg>
          <span className="font-bold tracking-tight text-slate-900 text-base">CLOUDFLARE</span>
        </div>

        {/* Scale */}
        <div className="flex items-center gap-1 text-black font-black text-lg tracking-wider shrink-0">
          <span className="font-serif italic font-extrabold text-xl">scale</span>
        </div>

        {/* Microsoft */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
            <div className="bg-[#F25022] w-2 h-2" />
            <div className="bg-[#7FBA00] w-2 h-2" />
            <div className="bg-[#00A4EF] w-2 h-2" />
            <div className="bg-[#FFB900] w-2 h-2" />
          </div>
          <span className="font-medium tracking-tight text-[#5E5E5E] text-base">Microsoft</span>
        </div>

        {/* Grammarly */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-5 h-5 rounded-full bg-[#15C39A] text-white flex items-center justify-center font-bold text-xs shadow-2xs">
            G
          </div>
          <span className="font-bold tracking-tight text-slate-900 text-base">grammarly</span>
        </div>

        {/* BambooHR */}
        <div className="flex items-center gap-1 font-bold text-base shrink-0">
          <span className="text-[#84BD00] text-xl font-black">bamboo</span>
          <span className="font-semibold text-slate-900">HR</span>
        </div>

        {/* Shutterstock */}
        <div className="flex items-center gap-1.5 font-bold text-base shrink-0">
          <div className="w-4 h-4 bg-[#EE2B24] rounded-xs flex items-center justify-center text-white text-[10px] font-black">
            S
          </div>
          <span className="tracking-tight text-sm font-extrabold uppercase text-slate-900">shutterstock</span>
        </div>
      </div>
    </div>
  );
}
