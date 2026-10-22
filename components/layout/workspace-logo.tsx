import React from 'react';

export default function WorkspaceLogo({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center text-white shadow-xs">
        <svg
          className="w-4.5 h-4.5"
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
      <span className={`font-bold text-xl tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
        Work<span className={dark ? 'text-emerald-400' : 'text-emerald-600'}>space</span>
      </span>
    </div>
  );
}
