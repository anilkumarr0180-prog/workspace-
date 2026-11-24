import React from 'react';

export default function WorkspaceLogo({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 select-none shrink-0 ${className}`}>
      <div className="w-9 h-9 min-w-9 min-h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center text-white shadow-xs shrink-0">
        <svg
          width="20"
          height="20"
          className="w-5 h-5 text-white shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19c4-6 12-6 16 0" />
          <path d="M4 12c4-3 12-3 16 0" />
          <path d="M12 4v16" />
        </svg>
      </div>
      <span className={`font-bold text-[21px] tracking-tight whitespace-nowrap ${dark ? 'text-white' : 'text-slate-900'}`}>
        Work<span className={dark ? 'text-emerald-400' : 'text-emerald-600'}>space</span>
      </span>
    </div>
  );
}
