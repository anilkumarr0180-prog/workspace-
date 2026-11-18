import React from 'react';

export default function TrustedBrands() {
  return (
    <div className="w-full pt-10 sm:pt-14 pb-8 sm:pb-12 text-center border-b border-slate-200/80">
      <p className="text-[12px] sm:text-[13px] font-semibold tracking-[0.2em] text-slate-500 uppercase mb-8 sm:mb-10">
        TRUSTED BY 800,000 CLIENTS
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-8 sm:gap-x-11 lg:gap-x-13 gap-y-6 opacity-90 hover:opacity-100 transition-opacity duration-300">
        {/* Airbnb */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-lg tracking-tight hover:text-[#FF5A5F] transition-colors shrink-0">
          <svg className="w-6 h-6 text-[#FF5A5F] fill-current" viewBox="0 0 24 24">
            <path d="M12 2C9.24 2 7 4.24 7 7c0 2.22 1.34 4.54 3.03 6.94C11.16 15.53 12 16.5 12 16.5s.84-.97 1.97-2.56C15.66 11.54 17 9.22 17 7c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
          </svg>
          <span className="font-bold text-[19px] text-slate-700">airbnb</span>
        </div>

        {/* Databricks */}
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-base hover:text-[#FF3621] transition-colors shrink-0">
          <svg className="w-5 h-5 text-[#FF3621] fill-current" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.4 6 12 2.2 19.6 6 12 9.5zm0 3L3.5 8.2v3.6L12 16l8.5-4.2V8.2L12 12.5z" />
          </svg>
          <span className="font-bold text-[17px] tracking-tight text-slate-700">databricks</span>
        </div>

        {/* Cloudflare */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-base hover:text-[#F38020] transition-colors shrink-0">
          <svg className="w-6 h-6 text-[#F38020] fill-current" viewBox="0 0 24 24">
            <path d="M18.6 13.5c-.2-1.8-1.7-3.1-3.6-3.1-.7 0-1.4.2-2 .6-.6-1.5-2.1-2.5-3.8-2.5-2.2 0-4 1.7-4.1 3.9C3.8 12.8 3 13.9 3 15.3c0 1.8 1.5 3.2 3.3 3.2h12.2c1.7 0 3-1.3 3-3 0-1.5-1.1-2.8-2.6-3-.1.1-.2 0-.3 0z" />
          </svg>
          <span className="font-bold text-[16px] tracking-tight text-slate-700">CLOUDFLARE</span>
        </div>

        {/* Scale */}
        <div className="flex items-center gap-1 text-slate-800 font-black text-lg tracking-wider hover:text-black transition-colors shrink-0">
          <span className="font-serif italic font-extrabold text-[22px] text-slate-800">scale</span>
        </div>

        {/* Microsoft */}
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-base hover:text-[#00A4EF] transition-colors shrink-0">
          <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
            <div className="bg-[#F25022] w-2 h-2" />
            <div className="bg-[#7FBA00] w-2 h-2" />
            <div className="bg-[#00A4EF] w-2 h-2" />
            <div className="bg-[#FFB900] w-2 h-2" />
          </div>
          <span className="font-medium text-[17px] tracking-tight text-slate-700">Microsoft</span>
        </div>

        {/* Grammarly */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-base hover:text-[#15C39A] transition-colors shrink-0">
          <div className="w-5 h-5 rounded-full border-2 border-[#15C39A] text-[#15C39A] flex items-center justify-center font-bold text-xs">
            G
          </div>
          <span className="font-bold text-[17px] tracking-tight text-slate-700">grammarly</span>
        </div>

        {/* BambooHR */}
        <div className="flex items-center gap-1 text-slate-700 font-bold text-base hover:text-[#84BD00] transition-colors shrink-0">
          <span className="text-[#84BD00] text-[20px] font-black">bamboo</span>
          <span className="font-semibold text-[17px] text-slate-700">HR</span>
        </div>

        {/* Shutterstock */}
        <div className="flex items-center gap-1.5 text-slate-700 font-bold text-base hover:text-[#EE2B24] transition-colors shrink-0">
          <div className="w-4 h-4 bg-[#EE2B24] rounded-xs flex items-center justify-center text-white text-[10px] font-black">
            S
          </div>
          <span className="tracking-tight text-[15px] font-extrabold uppercase text-slate-700">shutterstock</span>
        </div>
      </div>
    </div>
  );
}
