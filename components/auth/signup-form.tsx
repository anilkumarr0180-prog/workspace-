'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SocialAuthButtons from '@/components/auth/social-auth-buttons';
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface SignupFormProps {
  role: 'client' | 'freelancer';
}

export default function SignupForm({ role }: SignupFormProps) {
  const router = useRouter();

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
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const isClient = role === 'client';
  const headingText = isClient ? 'Sign up to hire talent' : 'Sign up to find work';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Basic Validation
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

      // 1. Attempt server-side signup via /api/auth/signup (provisions user with auto-confirmation to bypass GoTrue SMTP rate limits)
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
        } else if (apiRes.status === 409) {
          // Account already exists
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
          // Needs email verification confirmation
          setSuccessEmail(cleanEmail);
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
        // If signIn had an unexpected issue, redirect to login page pre-filled
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

  // If email confirmation is needed
  if (successEmail) {
    return (
      <div className="max-w-[520px] w-full mx-auto p-8 sm:p-10 bg-white rounded-2xl border border-slate-200/90 shadow-sm text-center">
        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Verify your email</h2>
        <p className="mt-3 text-sm text-slate-600 leading-relaxed">
          We&apos;ve sent a verification link to <strong className="text-slate-900">{successEmail}</strong>. Please check your inbox and confirm your email to activate your account.
        </p>

        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full py-3 rounded-full bg-[#14a800] hover:bg-[#108a00] text-white font-semibold text-sm transition-colors text-center shadow-xs"
          >
            Go to Login
          </Link>
          <button
            type="button"
            onClick={() => setSuccessEmail(null)}
            className="text-xs text-slate-500 hover:text-slate-800 underline"
          >
            Need to change your email or try again?
          </button>
        </div>
      </div>
    );
  }

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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
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

        {/* Checkbox 2: Terms */}
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

        {/* Submit Button */}
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
