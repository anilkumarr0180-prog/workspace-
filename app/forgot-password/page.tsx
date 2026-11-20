'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import WorkspaceLogo from '@/components/layout/workspace-logo';
import AuthFooter from '@/components/auth/auth-footer';
import { Mail, ArrowLeft, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setErrorMessage(data.error || 'Too many requests. Please wait a few minutes before trying again.');
        setLoading(false);
        return;
      }

      // Always enter success state (Anti-enumeration guarantee)
      setIsSuccess(true);
      setCooldownSeconds(60);
    } catch {
      setErrorMessage('Network error while requesting password reset. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col justify-between selection:bg-[#14a800]/20 selection:text-slate-900">
      {/* Top Bar Header */}
      <header className="px-6 sm:px-10 py-6 flex items-center justify-between border-b border-slate-100">
        <WorkspaceLogo />
        <Link
          href="/login"
          className="text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to log in</span>
        </Link>
      </header>

      {/* Main Form Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-6">
        <div className="w-full max-w-[480px] bg-white sm:border sm:border-slate-200/90 sm:rounded-3xl sm:p-10 p-2 sm:shadow-xs">
          {!isSuccess ? (
            /* STEP 1: Email Input Form */
            <>
              <div className="text-center sm:text-left">
                <div className="w-12 h-12 rounded-2xl bg-[#14a800]/10 flex items-center justify-center text-[#14a800] mx-auto sm:mx-0 mb-4">
                  <Mail className="w-6 h-6" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-2">
                  Reset your password
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                  Enter the email address verified with your Workspace account and we&apos;ll send you a secure link to reset your password.
                </p>
              </div>

              {/* Error Notice */}
              {errorMessage && (
                <div className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700 flex items-start gap-2.5 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="flex-1 leading-snug">{errorMessage}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      id="reset-email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-11 sm:h-12 pl-10 pr-3.5 rounded-xl border border-slate-300 focus:border-[#14a800] focus:ring-2 focus:ring-[#14a800]/20 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 sm:h-12 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Send Reset Link</span>}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-100 text-center">
                <Link
                  href="/login"
                  className="text-xs sm:text-sm font-semibold text-[#14a800] hover:underline"
                >
                  Remember your password? Sign in
                </Link>
              </div>
            </>
          ) : (
            /* STEP 2: Instructions Sent State */
            <div className="text-center py-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-[#14a800] flex items-center justify-center mx-auto mb-4 ring-8 ring-emerald-50">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-2">
                Check your email
              </h2>

              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
                If an account exists for <strong className="text-slate-900 font-semibold">{email}</strong>, we have sent a password reset link. The link expires in 15 minutes.
              </p>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left text-xs text-slate-600 mb-6 space-y-1.5">
                <p className="font-semibold text-slate-800">Didn&apos;t receive the email?</p>
                <ul className="list-disc pl-4 space-y-1 text-slate-500">
                  <li>Check your spam or junk folder</li>
                  <li>Verify that <strong className="text-slate-700">{email}</strong> is spelled correctly</li>
                </ul>
              </div>

              {/* Resend Action */}
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={cooldownSeconds > 0 || loading}
                  onClick={handleSubmit}
                  className="w-full h-11 sm:h-12 rounded-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>{cooldownSeconds > 0 ? `Resend email in ${cooldownSeconds}s` : 'Resend email'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSuccess(false);
                    setEmail('');
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 underline font-medium block w-full py-1 cursor-pointer"
                >
                  Try a different email address
                </button>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-100">
                <Link
                  href="/login"
                  className="text-xs sm:text-sm font-semibold text-[#14a800] hover:underline"
                >
                  Return to sign in
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}

