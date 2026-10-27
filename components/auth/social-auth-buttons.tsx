'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AlertCircle, Loader2 } from 'lucide-react';

interface SocialAuthButtonsProps {
  labelPrefix?: 'Continue with' | 'Sign up with';
  role?: 'client' | 'freelancer';
  className?: string;
}

export default function SocialAuthButtons({
  labelPrefix = 'Continue with',
  role,
  className = '',
}: SocialAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setLoadingProvider(provider);
    setProviderError(null);

    try {
      const supabase = createClient();
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const redirectUrl = role
        ? `${origin}/api/auth/callback?role=${encodeURIComponent(role)}`
        : `${origin}/api/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        const providerName = provider === 'google' ? 'Google' : 'Apple';
        const msg = error.message.toLowerCase();
        if (
          msg.includes('not enabled') ||
          msg.includes('unsupported provider') ||
          msg.includes('provider is not enabled') ||
          msg.includes('validation_failed') ||
          msg.includes('invalid')
        ) {
          setProviderError(
            `${providerName} Sign-In is not currently enabled on this Supabase project. Please use your email and password.`
          );
        } else {
          setProviderError(error.message);
        }
      }
    } catch {
      const providerName = provider === 'google' ? 'Google' : 'Apple';
      setProviderError(
        `${providerName} Sign-In is currently unavailable. Please sign in with email and password.`
      );
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className={`space-y-3 w-full ${className}`}>
      {providerError && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs sm:text-sm flex items-start gap-2.5 animate-fadeIn"
        >
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-950">Provider Configuration Notice</p>
            <p className="mt-0.5 text-amber-800 leading-relaxed">{providerError}</p>
          </div>
          <button
            type="button"
            onClick={() => setProviderError(null)}
            className="text-amber-500 hover:text-amber-800 font-bold text-base leading-none p-0.5"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Google Button */}
      <button
        type="button"
        onClick={() => handleOAuth('google')}
        disabled={loadingProvider !== null}
        className="w-full h-11 px-4 rounded-full border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 font-medium text-sm flex items-center justify-center gap-3 transition-colors shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      >
        {loadingProvider === 'google' ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        ) : (
          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.92 0 12s.45 3.85 1.24 5.42l4.04-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
        )}
        <span>
          {labelPrefix} Google
        </span>
      </button>

      {/* Apple Button */}
      <button
        type="button"
        onClick={() => handleOAuth('apple')}
        disabled={loadingProvider !== null}
        className="w-full h-11 px-4 rounded-full border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 font-medium text-sm flex items-center justify-center gap-3 transition-colors shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      >
        {loadingProvider === 'apple' ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        ) : (
          <svg className="w-4.5 h-4.5 fill-black" viewBox="0 0 170 170">
            <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.59-7.7-11.72-13.98-6.19-9.35-11.05-20.2-14.59-32.55-3.53-12.35-5.3-23.77-5.3-34.26 0-14.76 3.73-26.68 11.19-35.76 7.46-9.08 16.9-13.72 28.32-13.92 5.09 0 10.42 1.3 16.01 3.9 5.58 2.61 9.4 3.96 11.45 4.07 2.05-.11 6.04-1.54 11.97-4.3 5.92-2.75 11.11-4.04 15.57-3.87 13.56.66 24.16 5.5 31.8 14.52-11.97 7.24-17.84 17.1-17.61 29.58.23 9.85 4.09 18.06 11.58 24.63 7.49 6.57 16.14 10.37 25.96 11.39-2.42 7.23-5.23 14.07-8.43 20.52zM119.22 33.52c0-7.24 2.67-14.19 8.01-20.85 5.34-6.66 11.92-10.88 19.74-12.67.22 1.22.33 2.33.33 3.33 0 7.35-2.78 14.43-8.34 21.24-5.56 6.81-12.24 10.97-20.04 12.48-.33-1.11-.7-2.28-.7-3.53z" />
          </svg>
        )}
        <span>
          {labelPrefix} Apple
        </span>
      </button>
    </div>
  );
}
