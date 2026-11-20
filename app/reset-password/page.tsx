'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import WorkspaceLogo from '@/components/layout/workspace-logo';
import AuthFooter from '@/components/auth/auth-footer';
import {
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowLeft,
  XCircle,
} from 'lucide-react';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get('token_hash');
  const typeParam = searchParams.get('type');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialChecking, setInitialChecking] = useState(true);
  const [sessionValid, setSessionValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Pre-flight verification: Check if user has an active recovery session or valid token_hash
  useEffect(() => {
    async function verifyRecoveryEligibility() {
      try {
        const supabase = createClient();

        // If direct token_hash in URL, exchange it via client verifyOtp
        if (tokenHash && typeParam === 'recovery') {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });

          if (!error && data?.user) {
            setSessionValid(true);
            setInitialChecking(false);
            return;
          }
        }

        // Check if session was already established by /auth/callback
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          setSessionValid(true);
        } else {
          setSessionValid(false);
        }
      } catch (err) {
        console.warn('Recovery session check notice:', err);
        setSessionValid(false);
      } finally {
        setInitialChecking(false);
      }
    }

    verifyRecoveryEligibility();
  }, [tokenHash, typeParam]);

  // Live password complexity metrics
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const isMatch = Boolean(password && confirmPassword && password === confirmPassword);

  const criteriaCount = [hasMinLength, hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
  const strengthPercent = (criteriaCount / 5) * 100;

  const strengthColor =
    criteriaCount <= 2 ? 'bg-red-500' : criteriaCount <= 4 ? 'bg-amber-500' : 'bg-emerald-500';

  const strengthLabel =
    criteriaCount <= 2 ? 'Weak' : criteriaCount <= 4 ? 'Moderate' : 'Strong';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (criteriaCount < 5) {
      setErrorMessage('Please satisfy all password complexity requirements before continuing.');
      return;
    }

    if (!isMatch) {
      setErrorMessage('Passwords do not match. Please ensure both passwords are identical.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          tokenHash: tokenHash || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || 'Failed to update password. Your reset link may have expired.');
        setLoading(false);
        return;
      }

      // Successful password change: Redirect to login with green success banner
      router.push('/login?reset=success');
    } catch {
      setErrorMessage('Network error while resetting password. Please check your internet connection.');
      setLoading(false);
    }
  };

  if (initialChecking) {
    return (
      <div className="w-full max-w-[480px] bg-white sm:border sm:border-slate-200/90 sm:rounded-3xl sm:p-10 p-6 sm:shadow-xs text-center py-16">
        <Loader2 className="w-8 h-8 text-[#14a800] animate-spin mx-auto mb-3" />
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Verifying security token...
        </p>
      </div>
    );
  }

  // If token is missing, expired, or invalid
  if (!sessionValid) {
    return (
      <div className="w-full max-w-[480px] bg-white sm:border sm:border-slate-200/90 sm:rounded-3xl sm:p-10 p-6 sm:shadow-xs text-center animate-in fade-in duration-200">
        <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 ring-8 ring-red-50">
          <XCircle className="w-8 h-8" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-2">
          Reset Link Expired or Invalid
        </h1>

        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
          For your security, password reset links expire after 15 minutes and can only be used once. Please request a fresh reset link to update your password.
        </p>

        <div className="space-y-3">
          <Link
            href="/forgot-password"
            className="inline-block w-full py-3 px-6 rounded-full bg-[#14a800] hover:bg-[#108a00] text-white font-semibold text-sm transition-all shadow-2xs"
          >
            Request New Reset Link
          </Link>

          <Link
            href="/login"
            className="inline-block w-full py-2.5 px-6 rounded-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm transition-colors"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  // Active Valid Recovery State: Show New Password Form
  return (
    <div className="w-full max-w-[480px] bg-white sm:border sm:border-slate-200/90 sm:rounded-3xl sm:p-10 p-2 sm:shadow-xs animate-in fade-in duration-200">
      <div className="text-center sm:text-left">
        <div className="w-12 h-12 rounded-2xl bg-[#14a800]/10 flex items-center justify-center text-[#14a800] mx-auto sm:mx-0 mb-4">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-2">
          Choose a new password
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
          Create a strong password that you don&apos;t use for other accounts.
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
        {/* New Password */}
        <div>
          <label htmlFor="reset-new-password" className="block text-xs font-medium text-slate-700 mb-1.5">
            New password
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="reset-new-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoFocus
              autoComplete="new-password"
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 sm:h-12 pl-10 pr-10 rounded-xl border border-slate-300 focus:border-[#14a800] focus:ring-2 focus:ring-[#14a800]/20 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Strength Meter Bar */}
          {password && (
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Strength: <strong className="text-slate-800">{strengthLabel}</strong></span>
                <span>{criteriaCount} of 5 criteria</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${strengthColor}`}
                  style={{ width: `${strengthPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="reset-confirm-password" className="block text-xs font-medium text-slate-700 mb-1.5">
            Confirm new password
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="reset-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full h-11 sm:h-12 pl-10 pr-10 rounded-xl border ${
                confirmPassword && !isMatch
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-[#14a800] focus:ring-[#14a800]/20'
              } focus:ring-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {confirmPassword && !isMatch && (
            <p className="mt-1 text-xs text-red-600">Passwords do not match</p>
          )}
        </div>

        {/* Password Requirements Checklist */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
          <p className="font-semibold text-slate-700 mb-1">Must include:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasMinLength ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>At least 8 characters</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasUpper ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>1 uppercase letter</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasLower ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>1 lowercase letter</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasNumber ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>1 number (0-9)</span>
            </div>
            <div className={`flex items-center gap-1.5 ${hasSymbol ? 'text-emerald-700 font-medium' : 'text-slate-500'} sm:col-span-2`}>
              <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${hasSymbol ? 'text-emerald-600' : 'text-slate-300'}`} />
              <span>1 special symbol (!@#$%^&*)</span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || criteriaCount < 5 || !isMatch}
          className="w-full h-11 sm:h-12 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-4"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Update Password</span>}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
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

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-6">
        <Suspense
          fallback={
            <div className="w-full max-w-[480px] bg-white sm:border sm:border-slate-200/90 sm:rounded-3xl sm:p-10 p-6 text-center">
              <Loader2 className="w-8 h-8 text-[#14a800] animate-spin mx-auto mb-3" />
              <p className="text-xs sm:text-sm text-slate-500 font-medium">Loading...</p>
            </div>
          }
        >
          <ResetPasswordContent />
        </Suspense>
      </main>

      <AuthFooter />
    </div>
  );
}

