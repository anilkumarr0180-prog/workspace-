import React from 'react';

export default function UpworkLogo({ className = 'h-6', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div className={`flex items-center gap-1 select-none font-sans font-black tracking-tighter text-2xl leading-none ${className}`}>
      <span className="text-[#14a800] tracking-[-0.08em] font-extrabold text-[28px] mr-[-1px]">up</span>
      <span className={`${dark ? 'text-white' : 'text-slate-900'} tracking-[-0.04em] font-bold text-[26px]`}>work</span>
    </div>
  );
}
