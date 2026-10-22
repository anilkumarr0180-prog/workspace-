import React from 'react';

export default function TrustedBrands() {
  return (
    <div className="pt-10 pb-6 text-center">
      <p className="text-[11px] font-bold tracking-[0.2em] text-slate-400 uppercase mb-8">
        Trusted by 800,000 clients
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-75 grayscale hover:grayscale-0 transition-all duration-300">
        {/* Airbnb */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-lg tracking-tight hover:text-[#FF5A5F] transition-colors">
          <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
            <path d="M12 2C9.24 2 7 4.24 7 7c0 2.22 1.34 4.54 3.03 6.94C11.16 15.53 12 16.5 12 16.5s.84-.97 1.97-2.56C15.66 11.54 17 9.22 17 7c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
          </svg>
          <span className="font-bold">airbnb</span>
        </div>

        {/* Databricks */}
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-base hover:text-[#FF3621] transition-colors">
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.4 6 12 2.2 19.6 6 12 9.5zm0 3L3.5 8.2v3.6L12 16l8.5-4.2V8.2L12 12.5z" />
          </svg>
          <span className="font-bold tracking-tight">databricks</span>
        </div>

        {/* Cloudflare */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-base hover:text-[#F38020] transition-colors">
          <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
            <path d="M18.6 13.5c-.2-1.8-1.7-3.1-3.6-3.1-.7 0-1.4.2-2 .6-.6-1.5-2.1-2.5-3.8-2.5-2.2 0-4 1.7-4.1 3.9C3.8 12.8 3 13.9 3 15.3c0 1.8 1.5 3.2 3.3 3.2h12.2c1.7 0 3-1.3 3-3 0-1.5-1.1-2.8-2.6-3-.1.1-.2 0-.3 0z" />
          </svg>
          <span className="font-bold tracking-tight">CLOUDFLARE</span>
        </div>

        {/* Scale */}
        <div className="flex items-center gap-1 text-slate-700 font-black text-lg tracking-wider hover:text-black transition-colors">
          <span className="font-serif italic font-extrabold text-xl">scale</span>
        </div>

        {/* Microsoft */}
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-base hover:text-[#00A4EF] transition-colors">
          <div className="grid grid-cols-2 gap-0.5 w-4 h-4">
            <div className="bg-[#F25022] w-2 h-2" />
            <div className="bg-[#7FBA00] w-2 h-2" />
            <div className="bg-[#00A4EF] w-2 h-2" />
            <div className="bg-[#FFB900] w-2 h-2" />
          </div>
          <span className="font-medium tracking-tight">Microsoft</span>
        </div>

        {/* Grammarly */}
        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-base hover:text-[#15C39A] transition-colors">
          <div className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center font-bold text-xs">
            G
          </div>
          <span className="font-bold tracking-tight">grammarly</span>
        </div>

        {/* BambooHR */}
        <div className="flex items-center gap-1 text-slate-700 font-bold text-base hover:text-[#84BD00] transition-colors">
          <span className="text-[#84BD00] text-xl font-black">bamboo</span>
          <span className="font-semibold text-slate-800">HR</span>
        </div>

        {/* Shutterstock */}
        <div className="flex items-center gap-1 text-slate-700 font-bold text-base hover:text-[#EE2B24] transition-colors">
          <div className="w-4 h-4 bg-[#EE2B24] rounded-xs flex items-center justify-center text-white text-[10px] font-black">
            S
          </div>
          <span className="tracking-tight text-sm font-extrabold uppercase">shutterstock</span>
        </div>
      </div>
    </div>
  );
}
