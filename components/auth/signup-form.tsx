'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SocialAuthButtons from '@/components/auth/social-auth-buttons';
import {
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';

interface SignupFormProps {
  role: 'client' | 'freelancer';
}

export default function SignupForm({ role }: SignupFormProps) {
  const router = useRouter();

  // Form inputs
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('United States');
  const [sendEmails, setSendEmails] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // OTP Verification state
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const [savedPassword, setSavedPassword] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);

  const isClient = role === 'client';
  const headingText = isClient ? 'Sign up to hire talent' : 'Sign up to find work';

  // Countdown timer for Resend Code
  useEffect(() => {
    if (!successEmail || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [successEmail, countdown]);

  const handleCodeChange = (val: string) => {
    const clean = val.replace(/[^0-9a-zA-Z]/g, '').slice(0, 10);
    setVerificationCode(clean);
    setVerifyError(null);
  };

  // Verify OTP submission
  const handleVerifyCode = async (codeToVerify?: string) => {
    const code = (codeToVerify || verificationCode).trim();
    if (code.length < 6 || code.length > 10) {
      setVerifyError('Please enter the verification code sent to your email.');
      return;
    }

    setVerifyLoading(true);
    setVerifyError(null);
    setResendNotice(null);

    try {
      const supabase = createClient();
      let verified = false;

      // 1. Try client-side verifyOtp with type 'signup'
      try {
        const { data: vData1, error: vErr1 } = await supabase.auth.verifyOtp({
          email: successEmail!,
          token: code,
          type: 'signup',
        });

        if (!vErr1 && (vData1.session || vData1.user)) {
          verified = true;
        }
      } catch (err1) {
        console.warn('Client verifyOtp signup attempt:', err1);
      }

      // 2. If first attempt failed, try type 'email'
      if (!verified) {
        try {
          const { data: vData2, error: vErr2 } = await supabase.auth.verifyOtp({
            email: successEmail!,
            token: code,
            type: 'email',
          });

          if (!vErr2 && (vData2.session || vData2.user)) {
            verified = true;
          }
        } catch (err2) {
          console.warn('Client verifyOtp email attempt:', err2);
        }
      }

      // 3. If still not verified, try type 'magiclink'
      if (!verified) {
        try {
          const { data: vData3, error: vErr3 } = await supabase.auth.verifyOtp({
            email: successEmail!,
            token: code,
            type: 'magiclink',
          });

          if (!vErr3 && (vData3.session || vData3.user)) {
            verified = true;
          }
        } catch (err3) {
          console.warn('Client verifyOtp magiclink attempt:', err3);
        }
      }

      // 4. Fallback to server route /api/auth/verify-otp
      if (!verified) {
        const verifyRes = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: successEmail, otp: code }),
        });
        const verifyResult = await verifyRes.json();

        if (verifyRes.ok && verifyResult.success) {
          verified = true;
        } else {
          setVerifyError(
            verifyResult.error ||
              'Invalid or expired verification code. Please check your email or request a new code.'
          );
          setVerifyLoading(false);
          return;
        }
      }

      // 5. Verification successful! Establish active session with password if saved
      if (savedPassword) {
        try {
          await supabase.auth.signInWithPassword({
            email: successEmail!,
            password: savedPassword,
          });
        } catch (signErr) {
          console.warn('Auto sign-in notice:', signErr);
        }
      }

      // Sync active_mode in profiles
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id) {
        try {
          await supabase
            .from('profiles')
            .update({ active_mode: role })
            .eq('id', sessionData.session.user.id);
        } catch {
          // non-blocking
        }
      }

      // Navigate to authenticated workspace dashboard
      router.push(isClient ? '/client' : '/freelancer');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify code. Please try again.';
      setVerifyError(msg);
      setVerifyLoading(false);
    }
  };

  // Resend OTP code
  const handleResendCode = async () => {
    if (countdown > 0 || resendLoading || !successEmail) return;

    setResendLoading(true);
    setVerifyError(null);
    setResendNotice(null);

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: successEmail }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setCountdown(30);
        setResendNotice('A new verification code has been dispatched to your email.');
      } else {
        setVerifyError(data.error || 'Failed to resend verification code. Please try again in a few moments.');
      }
    } catch {
      setVerifyError('Network error while requesting new code. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  // Submit main signup form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage('Please enter both your first and last name.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (!agreeTerms) {
      setErrorMessage('You must agree to the Workspace Terms of Service to continue.');
      return;
    }

    setLoading(true);

    try {
      const cleanEmail = email.trim();
      const cleanFirstName = firstName.trim();
      const cleanLastName = lastName.trim();
      const fullName = `${cleanFirstName} ${cleanLastName}`;

      // 1. Attempt server-side signup via /api/auth/signup (generates user and sends branded email + OTP without hitting GoTrue SMTP rate limiter)
      let signupSucceeded = false;
      let signupErrorMessage: string | null = null;

      try {
        const apiRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            firstName: cleanFirstName,
            lastName: cleanLastName,
            role,
            country,
            sendEmails,
          }),
        });

        const apiResult = await apiRes.json();

        if (apiRes.ok && apiResult.success) {
          signupSucceeded = true;
          if (apiResult.requiresVerification) {
            setSuccessEmail(apiResult.email || cleanEmail);
            setSavedPassword(password);
            setCountdown(30);
            setLoading(false);
            return;
          }
        } else if (apiRes.status === 409) {
          setErrorMessage(
            apiResult.error || 'An account with this email address already exists. Please log in.'
          );
          setLoading(false);
          return;
        } else if (!apiResult.fallback) {
          signupErrorMessage = apiResult.error;
        }
      } catch (apiErr) {
        console.warn('Server signup API unreachable, falling back to direct auth:', apiErr);
      }

      const supabase = createClient();

      // 2. If server-side signup was not able to handle it, fallback to client-side supabase.auth.signUp
      if (!signupSucceeded) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: fullName,
              role,
              country,
              marketing_opt_in: sendEmails,
            },
          },
        });

        if (error) {
          const errLower = error.message.toLowerCase();
          if (errLower.includes('rate limit')) {
            setErrorMessage(
              'Email confirmation rate limit exceeded by authentication provider. If your account was already created, please click "Log In" below, or try again in a few moments.'
            );
          } else {
            setErrorMessage(signupErrorMessage || error.message);
          }
          setLoading(false);
          return;
        }

        if (data.session) {
          await supabase
            .from('profiles')
            .update({ active_mode: role })
            .eq('id', data.session.user.id);

          router.push(isClient ? '/client' : '/freelancer');
          router.refresh();
          return;
        } else {
          setSuccessEmail(cleanEmail);
          setSavedPassword(password);
          setCountdown(30);
          setLoading(false);
          return;
        }
      }

      // 3. User created and confirmed! Immediately establish client session with signInWithPassword
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) {
        router.push(`/login?email=${encodeURIComponent(cleanEmail)}`);
        return;
      }

      if (signInData.session) {
        try {
          await supabase
            .from('profiles')
            .update({ active_mode: role })
            .eq('id', signInData.session.user.id);
        } catch {
          // Non-blocking profile check
        }

        router.push(isClient ? '/client' : '/freelancer');
        router.refresh();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during signup. Please try again.';
      setErrorMessage(message);
      setLoading(false);
    }
  };

  // =========================================================================
  // Screen: Interactive 6-Digit OTP Verification Screen
  // =========================================================================
  if (successEmail) {
    return (
      <div className="max-w-[520px] w-full mx-auto p-7 sm:p-10 bg-white rounded-2xl border border-slate-200/90 shadow-sm text-center">
        {/* Animated icon badge */}
        <div className="w-16 h-16 bg-emerald-50 text-[#14a800] rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-emerald-50/60">
          <Mail className="w-8 h-8" />
        </div>

        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Verify your email</h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-sm mx-auto">
          We&apos;ve sent a verification code and activation link to{' '}
          <strong className="text-slate-900 break-all">{successEmail}</strong>
        </p>

        {/* Success Notice */}
        {resendNotice && (
          <div
            role="status"
            className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{resendNotice}</span>
          </div>
        )}

        {/* Error Notice */}
        {verifyError && (
          <div
            role="alert"
            className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-start gap-2 text-left"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span className="flex-1 leading-snug">{verifyError}</span>
          </div>
        )}

        {/* Verification Code Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (verificationCode.trim().length >= 6) {
              handleVerifyCode();
            }
          }}
          className="my-6 space-y-4"
        >
          <div className="max-w-xs mx-auto text-left">
            <label
              htmlFor="verificationCode"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 text-center"
            >
              Enter Verification Code
            </label>
            <input
              id="verificationCode"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={10}
              placeholder="e.g. 62998023"
              value={verificationCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              autoFocus
              className="w-full h-14 sm:h-16 text-center text-2xl font-bold font-mono tracking-[0.25em] text-slate-900 border border-slate-300 rounded-xl bg-white shadow-xs focus:outline-none focus:border-[#14a800] focus:ring-2 focus:ring-[#14a800]/20 transition-all placeholder:tracking-normal placeholder:font-normal placeholder:text-base placeholder:text-slate-300"
            />
          </div>

          <button
            type="submit"
            disabled={verifyLoading || verificationCode.trim().length < 6}
            className={`w-full max-w-xs mx-auto h-12 rounded-full font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-xs ${
              verificationCode.trim().length < 6 || verifyLoading
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white cursor-pointer hover:shadow-sm'
            }`}
          >
            {verifyLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Verifying code...</span>
              </>
            ) : (
              <span>Verify & Continue</span>
            )}
          </button>
        </form>

        <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
          Please check your inbox (and spam folder) for the email. You can enter the code above or click the direct activation button in the email.
        </p>

        {/* Resend Code Section */}
        <div className="mt-5 text-center text-xs sm:text-sm text-slate-600">
          Didn&apos;t receive the email?{' '}
          {countdown > 0 ? (
            <span className="text-slate-400 font-medium">
              Resend in <span className="font-mono text-slate-600 font-semibold">{countdown}s</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendLoading}
              className="text-[#14a800] hover:text-[#108a00] font-semibold underline underline-offset-2 ml-1 inline-flex items-center gap-1 cursor-pointer"
            >
              {resendLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 inline" />
              )}
              Resend verification email
            </button>
          )}
        </div>

        {/* Back / Change Email Link / Direct Password Login */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setSuccessEmail(null);
              setVerifyError(null);
              setVerificationCode('');
            }}
            className="text-slate-500 hover:text-slate-800 underline inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Change email address
          </button>

          <Link
            href={`/login?email=${encodeURIComponent(successEmail)}`}
            className="text-[#14a800] hover:text-[#108a00] font-semibold underline underline-offset-2"
          >
            Sign in with password &rarr;
          </Link>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Screen: Main Signup Form
  // =========================================================================
  return (
    <div className="max-w-[560px] w-full mx-auto p-6 sm:p-10 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 text-center tracking-tight">
        {headingText}
      </h1>

      <p className="mt-2 text-center text-xs sm:text-sm text-slate-500">
        {isClient
          ? 'Post projects, access elite vetted talent, and scale your business'
          : 'Apply to top-tier contracts, work with global clients, and get paid securely'}
      </p>

      {/* Social Auth */}
      <div className="mt-6">
        <SocialAuthButtons labelPrefix="Sign up with" role={role} />
      </div>

      {/* Divider */}
      <div className="relative my-6 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <span className="relative bg-white px-3 text-xs uppercase tracking-wider text-slate-400 font-medium">
          or
        </span>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-start gap-2.5 animate-fadeIn"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="flex-1 leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="first_name" className="block text-xs font-semibold text-slate-700 mb-1">
              First name
            </label>
            <input
              id="first_name"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="last_name" className="block text-xs font-semibold text-slate-700 mb-1">
              Last name
            </label>
            <input
              id="last_name"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
            />
          </div>
        </div>

        {/* Work / Email */}
        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1">
            {isClient ? 'Work email address' : 'Email address'}
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] placeholder:text-slate-400 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Country */}
        <div>
          <label htmlFor="country" className="block text-xs font-semibold text-slate-700 mb-1">
            Country
          </label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:border-[#14a800] focus:ring-1 focus:ring-[#14a800] transition-colors"
          >
            <option value="United States">United States</option>
            <option value="United Kingdom">United Kingdom</option>
            <option value="Canada">Canada</option>
            <option value="Germany">Germany</option>
            <option value="France">France</option>
            <option value="India">India</option>
            <option value="Australia">Australia</option>
            <option value="Singapore">Singapore</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Checkbox 1: Marketing */}
        <label className="flex items-start gap-2.5 pt-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sendEmails}
            onChange={(e) => setSendEmails(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-[#14a800] focus:ring-[#14a800]"
          />
          <span>
            {isClient
              ? 'Send me emails with tips on how to find talent that fits my needs.'
              : 'Send me helpful emails about how to get the most out of Workspace.'}
          </span>
        </label>

        {/* Checkbox 2: Terms (MUST be ticked to enable Create Account button) */}
        <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            required
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-[#14a800] focus:ring-[#14a800]"
          />
          <span>
            Yes, I understand and agree to the{' '}
            <Link href="#" className="text-[#14a800] underline">
              Workspace Terms of Service
            </Link>
            , including the{' '}
            <Link href="#" className="text-[#14a800] underline">
              User Agreement
            </Link>{' '}
            and{' '}
            <Link href="#" className="text-[#14a800] underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {/* Submit Button - Disabled until Terms is ticked */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading || !agreeTerms}
            className={`w-full h-12 rounded-full font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-xs ${
              !agreeTerms || loading
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-[#14a800] hover:bg-[#108a00] active:scale-[0.99] text-white cursor-pointer hover:shadow-sm'
            }`}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Create my account</span>}
          </button>
        </div>
      </form>

      {/* Bottom Log in link */}
      <div className="mt-6 pt-6 border-t border-slate-100 text-center text-xs sm:text-sm text-slate-600">
        Already have an account?{' '}
        <Link
          href="/login"
          className="text-[#14a800] hover:text-[#108a00] font-semibold underline decoration-2 underline-offset-2 ml-1"
        >
          Log In
        </Link>
      </div>
    </div>
  );
}
