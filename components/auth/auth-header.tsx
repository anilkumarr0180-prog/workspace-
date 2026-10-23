import React from 'react';
import Link from 'next/link';
import WorkspaceLogo from '@/components/layout/workspace-logo';

interface AuthHeaderProps {
  rightText?: string;
  actionText?: string;
  actionHref?: string;
}

export default function AuthHeader({
  rightText = 'Already have an account?',
  actionText = 'Log in',
  actionHref = '/login',
}: AuthHeaderProps) {
  return (
    <header className="w-full bg-white border-b border-slate-200/90 sticky top-0 z-30">
      <div className="w-full px-6 sm:px-10 lg:px-16 h-16 sm:h-[68px] flex items-center justify-between">
        <Link href="/" className="flex items-center select-none" aria-label="Workspace Home">
          <WorkspaceLogo />
        </Link>

        {actionText && (
          <div className="text-sm text-slate-700 font-normal flex items-center">
            <span className="hidden sm:inline">{rightText}</span>
            <Link
              href={actionHref}
              className="text-[#14a800] hover:text-[#108a00] font-semibold underline decoration-2 underline-offset-2 ml-1.5 transition-colors"
            >
              {actionText}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
