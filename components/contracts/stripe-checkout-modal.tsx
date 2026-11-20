'use client';

import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import {
  X,
  Lock,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import { verifyAndFundMilestoneStripe } from '@/lib/actions/stripe';

interface StripeCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestoneId: string;
  milestoneTitle: string;
  sequenceOrder: number;
  amount: number;
  currency: string;
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
  onSuccess: (paymentIntentId: string) => void;
}

function StripeCardForm({
  milestoneId,
  amount,
  currency,
  clientSecret,
  paymentIntentId,
  onClose,
  onSuccess,
}: {
  milestoneId: string;
  amount: number;
  currency: string;
  clientSecret: string;
  paymentIntentId: string;
  onClose: () => void;
  onSuccess: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyTestCard = () => {
    navigator.clipboard.writeText('4242424242424242');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setErrorMessage(null);
    setProcessing(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not loaded.');
      }

      // 1. Confirm payment on Stripe
      const { paymentIntent, error: stripeError } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
          },
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message || 'Payment confirmation failed on Stripe.');
      }

      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        throw new Error(`Payment incomplete. Status: ${paymentIntent?.status}`);
      }

      // 2. Authoritatively verify with server action and transition milestone
      const verifyRes = await verifyAndFundMilestoneStripe({
        milestoneId,
        paymentIntentId: paymentIntent.id,
      });

      if (!verifyRes.success) {
        throw new Error(verifyRes.error || 'Server failed to verify payment.');
      }

      // 3. Complete
      onSuccess(paymentIntent.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(msg);
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Test Card Quick Fill Helper */}
      <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-xl flex items-center justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          <span className="font-bold text-indigo-950 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Stripe Test Card
          </span>
          <p className="text-[11px] text-indigo-700 font-mono">
            4242 •••• •••• 4242 | Exp: 12/28 | CVC: 123
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopyTestCard}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-indigo-100 text-indigo-800 rounded-lg text-[11px] font-semibold border border-indigo-200 transition-colors shadow-2xs cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-indigo-600" />
              <span>Copy Card</span>
            </>
          )}
        </button>
      </div>

      {/* Card Input Box */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          Card Details
        </label>
        <div className="p-3.5 bg-white border border-slate-300 rounded-xl shadow-2xs focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '14px',
                  color: '#0f172a',
                  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                  '::placeholder': {
                    color: '#94a3b8',
                  },
                },
                invalid: {
                  color: '#e11d48',
                },
              },
              hidePostalCode: true,
            }}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-800 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed flex-1">{errorMessage}</p>
        </div>
      )}

      {/* Trust Badges */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
        <span className="flex items-center gap-1 text-emerald-700 font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          Escrow Protected
        </span>
        <span className="flex items-center gap-1 text-slate-400">
          <Lock className="w-3 h-3" />
          256-Bit Encrypted via Stripe
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          disabled={processing}
          className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={!stripe || processing}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
        >
          {processing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Authorizing Escrow Deposit...</span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5" />
              <span>Deposit ${amount.toFixed(2)} {currency}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

let stripePromiseCache: Promise<any> | null = null;
function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache && publishableKey) {
    stripePromiseCache = loadStripe(publishableKey);
  }
  return stripePromiseCache;
}

export default function StripeCheckoutModal({
  isOpen,
  onClose,
  milestoneId,
  milestoneTitle,
  sequenceOrder,
  amount,
  currency,
  clientSecret,
  paymentIntentId,
  publishableKey,
  onSuccess,
}: StripeCheckoutModalProps) {
  if (!isOpen) return null;

  const stripePromise = getStripePromise(publishableKey);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Fund via Stripe
              </h3>
              <p className="text-xs text-slate-500">
                Milestone #{sequenceOrder}: {milestoneTitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Deposit Summary Banner */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Total Escrow Deposit
            </span>
            <div className="font-mono text-lg font-extrabold text-slate-900">
              ${amount.toFixed(2)}{' '}
              <span className="text-xs font-semibold text-slate-500">{currency}</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Secure Escrow
          </span>
        </div>

        {/* Elements Form */}
        {stripePromise && clientSecret ? (
          <Elements stripe={stripePromise}>
            <StripeCardForm
              milestoneId={milestoneId}
              amount={amount}
              currency={currency}
              clientSecret={clientSecret}
              paymentIntentId={paymentIntentId}
              onClose={onClose}
              onSuccess={onSuccess}
            />
          </Elements>
        ) : (
          <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <span>Loading Stripe secure checkout...</span>
          </div>
        )}
      </div>
    </div>
  );
}

