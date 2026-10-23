'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import WorkspaceLogo from '@/components/layout/workspace-logo';
import AuthFooter from '@/components/auth/auth-footer';
import SocialAuthButtons from '@/components/auth/social-auth-buttons';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Edit2
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();

  // Step 1: 'identify' (Enter email/username) | Step 2: 'authenticate' (Enter password)
  const [step, setStep] = useState<'identify' | 'authenticate'>('identify');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Advance from Step 1 to Step 2
  const handleContinueWithEmail = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmed = emailOrUsername.trim();
    if (!trimmed) {
      setErrorMessage('Please enter your username or email address.');
      return;
    }

    setStep('authenticate');
  };

  // Step 2: Submit password
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const loginIdentifier = emailOrUsername.trim();

      // Sign in with Supabase auth (with 12s timeout protection)
      const loginPromise = supabase.auth.signInWithPassword({
        email: loginIdentifier,
        password,
      });

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((_, reject) =>
        setTimeout(
          () => reject(new Error('Connection timed out. Please check your Supabase connection and try again.')),
          12000
        )
      );

      const result = await Promise.race([loginPromise, timeoutPromise]);
      const { data, error } = result as {
        data: { user: { user_metadata?: { role?: string } } | null } | null;
        error: { message: string } | null;
      };

      if (error) {
        const msg = error.message.toLowerCase().includes('invalid login credentials')
          ? 'Invalid login credentials. If you haven\'t created this account yet, please sign up first.'
          : error.message;
        setErrorMessage(msg);
        setLoading(false);
        return;
      }

      if (data?.user) {
        const userRole = data.user.user_metadata?.role;
        const target = userRole === 'client' ? '/client' : '/freelancer';
        router.push(target);
        router.refresh();
      } else {
        router.push('/');
        router.refresh();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Authentication failed. Please verify your credentials and try again.';
      setErrorMessage(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-white text-slate-900">
      {/* 1. Minimal Header with Workspace Logo at upper left */}
      <header className="w-full px-6 sm:px-12 py-5 sm:py-6">
        <Link href="/" className="inline-block select-none" aria-label="Workspace Home">
          <WorkspaceLogo />
        </Link>
      </header>

      {/* 2. Main Login Card Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-[480px] mx-auto bg-white rounded-2xl border border-slate-200/90 shadow-2xs sm:shadow-sm p-6 sm:p-10 transition-all">
          {/* Card Heading */}
          <h1 className="text-2xl sm:text-[28px] font-semibold text-slate-900 text-center tracking-tight">
            Log in to Workspace
          </h1>

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mt-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-start gap-2.5 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="flex-1 leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {/* STEP 1: Enter Username or Email */}
          {step === 'identify' ? (
            <div className="mt-6">
              <form onSubmit={handleContinueWithEmail} className="space-y-4">
                <div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      id="login-identifier"
                      type="text"
                      required
                      autoFocus
                      value={emailOrUsername}
                      onChange={(e) => setEmailOrUsername(e.target.value)}
                      placeholder="Username or Email"
                      className="w-full h-11 sm:h-12 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full h-11 sm:h-12 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white font-semibold text-sm sm:text-base flex items-center justify-center transition-all shadow-2xs cursor-pointer"
                >
                  Continue with Email
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-6 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <span className="relative bg-white px-3 text-xs uppercase tracking-wider text-slate-400 font-medium">
                  or
                </span>
              </div>

              {/* Social Login Options */}
              <SocialAuthButtons labelPrefix="Continue with" />

              {/* Bottom Signup Prompt */}
              <div className="mt-8 pt-6 border-t border-slate-200 text-center">
                <p className="text-xs sm:text-sm text-slate-600 font-normal">
                  Don&apos;t have a Workspace account?
                </p>
                <Link
                  href="/signup"
                  className="mt-3 inline-block w-full py-2.5 px-6 rounded-full border border-[#14a800] text-[#14a800] hover:bg-[#14a800]/5 font-semibold text-sm transition-colors text-center"
                >
                  Sign Up
                </Link>
              </div>
            </div>
          ) : (
            /* STEP 2: Enter Password */
            <div className="mt-6">
              {/* Back to Email edit bar */}
              <div className="flex items-center justify-between p-2.5 mb-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <div className="flex items-center gap-2 truncate">
                  <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="font-medium truncate">{emailOrUsername}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep('identify');
                    setErrorMessage(null);
                  }}
                  className="text-[#14a800] hover:text-[#108a00] font-semibold flex items-center gap-1 shrink-0 ml-2"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Change</span>
                </button>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full h-11 sm:h-12 pl-10 pr-11 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <label className="flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-slate-300 text-[#14a800] focus:ring-[#14a800]"
                    />
                    <span>Keep me logged in</span>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      setErrorMessage(
                        'Password reset: please contact your administrator or check your email.'
                      )
                    }
                    className="text-[#14a800] hover:underline font-medium"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 sm:h-12 rounded-full bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Log In</span>}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep('identify');
                    setErrorMessage(null);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to username</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* 3. Minimal Footer */}
      <AuthFooter />
    </div>
  );
}
