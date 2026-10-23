import React from 'react';
import Link from 'next/link';

export default function AuthFooter() {
  return (
    <footer className="w-full py-6 sm:py-8 px-4 text-center text-xs text-slate-500 bg-transparent">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
        <span>© 2015 - 2026 Workspace® Global Inc.</span>
        <span className="hidden sm:inline text-slate-300">•</span>
        <div className="flex items-center gap-4">
          <Link href="#" className="hover:text-slate-800 hover:underline transition-colors">
            Privacy Policy
          </Link>
          <span className="text-slate-300">•</span>
          <Link href="#" className="hover:text-slate-800 hover:underline transition-colors">
            Terms of Service
          </Link>
          <span className="text-slate-300">•</span>
          <Link href="#" className="hover:text-slate-800 hover:underline transition-colors">
            Accessibility
          </Link>
        </div>
      </div>
    </footer>
  );
}
