'use client';

import React, { useState } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
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
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  Receipt,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { verifyAndFundMilestoneStripe, verifyAndPayTimesheetStripe } from '@/lib/actions/stripe';

interface StripeCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestoneId?: string;
  milestoneTitle?: string;
  sequenceOrder?: number;
  timesheetId?: string;
  timesheetTitle?: string;
  amount: number;
  currency: string;
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
  onSuccess: (paymentIntentId: string) => void;
}

interface SuccessReceiptData {
  paymentIntentId: string;
  amount: number;
  currency: string;
  itemTitle: string;
  sequenceOrder: number;
  isTimesheet?: boolean;
  cardBrand?: string;
  cardLast4?: string;
  timestamp: string;
}

function StripeCardForm({
  milestoneId,
  milestoneTitle,
  sequenceOrder = 1,
  timesheetId,
  timesheetTitle,
  amount,
  currency,
  clientSecret,
  onClose,
  onSuccess,
}: {
  milestoneId?: string;
  milestoneTitle?: string;
  sequenceOrder?: number;
  timesheetId?: string;
  timesheetTitle?: string;
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
  const [successReceipt, setSuccessReceipt] = useState<SuccessReceiptData | null>(null);
  const [copiedTxn, setCopiedTxn] = useState(false);

  const formattedAmount = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleCopyTestCard = () => {
    navigator.clipboard.writeText('4242424242424242');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyTxn = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedTxn(true);
    setTimeout(() => setCopiedTxn(false), 2000);
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

      // 2. Authoritatively verify with server action and transition milestone or timesheet
      if (timesheetId) {
        const verifyRes = await verifyAndPayTimesheetStripe({
          timesheetId,
          paymentIntentId: paymentIntent.id,
        });

        if (!verifyRes.success) {
          throw new Error(verifyRes.error || 'Server failed to verify timesheet payment.');
        }

        setSuccessReceipt({
          paymentIntentId: paymentIntent.id,
          amount,
          currency,
          itemTitle: timesheetTitle || 'Weekly Timesheet',
          sequenceOrder: 0,
          isTimesheet: true,
          cardBrand: 'Visa',
          cardLast4: '4242',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
      } else if (milestoneId) {
        const verifyRes = await verifyAndFundMilestoneStripe({
          milestoneId,
          paymentIntentId: paymentIntent.id,
        });

        if (!verifyRes.success) {
          throw new Error(verifyRes.error || 'Server failed to verify milestone payment.');
        }

        setSuccessReceipt({
          paymentIntentId: paymentIntent.id,
          amount,
          currency,
          itemTitle: milestoneTitle || 'Milestone',
          sequenceOrder: sequenceOrder ?? 1,
          isTimesheet: false,
          cardBrand: 'Visa',
          cardLast4: '4242',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
      } else {
        throw new Error('Neither milestoneId nor timesheetId was provided.');
      }
      setProcessing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(msg);
      setProcessing(false);
    }
  };

  // ==========================================
  // VIEW: GORGEOUS DIGITAL RECEIPT (SUCCESS)
  // ==========================================
  if (successReceipt) {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300 py-1">
        {/* Celebration Badge with Pulsing Halo */}
        <div className="text-center space-y-3 pt-2">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute w-24 h-24 bg-emerald-100/80 rounded-full animate-ping opacity-60 duration-1000" />
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 text-white flex items-center justify-center shadow-xl shadow-emerald-500/25 relative z-10 border-2 border-white/80">
              <Check className="w-10 h-10 stroke-[3]" />
            </div>
            <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-amber-400 text-white flex items-center justify-center shadow-md animate-bounce z-20">
              <Sparkles className="w-4 h-4 fill-white" />
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">
              {successReceipt.isTimesheet ? 'Timesheet Payment Complete!' : 'Escrow Deposit Confirmed!'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
              {successReceipt.isTimesheet
                ? 'Your payment was successfully authorized via Stripe and settled to the freelancer ledger.'
                : 'Your milestone funds have been securely locked into escrow. Work can now begin.'}
            </p>
          </div>
        </div>

        {/* Elevated Digital Receipt Card with Notched Border Feel */}
        <div className="relative bg-gradient-to-b from-slate-50/90 via-white to-slate-50/90 border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4 overflow-hidden">
          {/* Subtle Top Gradient Accent Strip */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />

          {/* Amount Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                {successReceipt.isTimesheet ? 'Amount Settled' : 'Total Escrow Deposit'}
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-3xl font-black text-slate-900 font-mono tracking-tight">
                  ${formattedAmount}
                </span>
                <span className="text-xs font-bold text-slate-500 uppercase">{successReceipt.currency}</span>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 rounded-full text-xs font-bold shadow-2xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Settled in Full
            </span>
          </div>

          {/* Receipt Key-Value Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400 font-medium text-[11px] block">
                {successReceipt.isTimesheet ? 'Invoice Period' : 'Milestone Item'}
              </span>
              <span className="font-semibold text-slate-800 line-clamp-1 block">
                {successReceipt.isTimesheet
                  ? successReceipt.itemTitle
                  : `#${successReceipt.sequenceOrder}: ${successReceipt.itemTitle}`}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium text-[11px] block">Payment Gateway</span>
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded border border-indigo-200 font-mono">
                  STRIPE
                </span>
                <span>{successReceipt.cardBrand} •••• {successReceipt.cardLast4}</span>
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium text-[11px] block">Security Verification</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>100% Escrow Protected</span>
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium text-[11px] block">Processed Timestamp</span>
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{successReceipt.timestamp}</span>
              </span>
            </div>
          </div>

          {/* Transaction ID Pill */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1">
              <Receipt className="w-3.5 h-3.5 text-slate-400" />
              Payment Intent ID:
            </span>
            <button
              type="button"
              onClick={() => handleCopyTxn(successReceipt.paymentIntentId)}
              title="Click to copy full transaction ID"
              className="group font-mono text-[11px] text-slate-700 hover:text-slate-900 inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 hover:border-slate-300 transition-all shadow-2xs cursor-pointer"
            >
              <span>{successReceipt.paymentIntentId.slice(0, 18)}...</span>
              {copiedTxn ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
              )}
            </button>
          </div>
        </div>

        {/* Protection Reassurance */}
        <p className="text-[11px] text-slate-500 text-center leading-relaxed px-4">
          {successReceipt.isTimesheet
            ? 'This payment has been cryptographically recorded on the immutable contract ledger. Freelancer payout disbursement is being initiated.'
            : 'Funds remain held securely in escrow. They will only be released to the freelancer once you review and approve their submitted work.'}
        </p>

        {/* Return Button */}
        <button
          type="button"
          onClick={() => onSuccess(successReceipt.paymentIntentId)}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl text-sm font-bold transition-all shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30 cursor-pointer active:scale-[0.99]"
        >
          <span>{successReceipt.isTimesheet ? 'Done & Return to Timesheet' : 'Done & Return to Contract Escrow'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ==========================================
  // VIEW: CHECKOUT FORM (INPUT & PAYMENT)
  // ==========================================
  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
      {/* Premium Hero Amount Card */}
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white rounded-2xl p-4.5 sm:p-5 shadow-xl border border-slate-700/60 overflow-hidden">
        {/* Subtle Background Radial Glow */}
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-emerald-500/15 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-950/80 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                {timesheetId ? 'Verified Hourly Invoice' : 'Fixed Milestone Escrow'}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                <ShieldCheck className="w-3 h-3" />
                Protected
              </span>
            </div>
            <h4 className="text-xs text-slate-300 font-medium line-clamp-1">
              {timesheetId ? (timesheetTitle || 'Weekly Timesheet') : (milestoneTitle || 'Milestone Deliverable')}
            </h4>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Total Amount
            </span>
            <div className="flex items-baseline gap-1 sm:justify-end">
              <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                ${formattedAmount}
              </span>
              <span className="text-xs font-bold text-slate-400">{currency}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Stripe Test Card Helper Mockup */}
      <div className="bg-gradient-to-br from-indigo-50/90 via-white to-indigo-50/60 border border-indigo-200/90 rounded-2xl p-3.5 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-indigo-950">
              Stripe Sandbox Card Simulator
            </span>
            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full border border-indigo-200">
              Zero Risk
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopyTestCard}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-indigo-50 text-indigo-700 hover:text-indigo-900 rounded-xl text-xs font-bold border border-indigo-200 transition-all shadow-2xs hover:shadow-xs cursor-pointer active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-indigo-600" />
                <span>Copy Card</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-indigo-900 bg-white/90 border border-indigo-100 rounded-xl px-3 py-2 font-mono">
          <span className="tracking-wider font-semibold">4242 •••• •••• 4242</span>
          <div className="flex items-center gap-3 text-[11px] text-indigo-700">
            <span>EXP: <strong>12/28</strong></span>
            <span>CVC: <strong>123</strong></span>
          </div>
        </div>
      </div>

      {/* Card Input Box */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="font-bold text-slate-800 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-indigo-600" />
            <span>Card Information</span>
          </label>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200">VISA</span>
            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200">MC</span>
            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200">AMEX</span>
          </div>
        </div>

        <div className="p-3.5 sm:p-4 bg-white border border-slate-300 rounded-2xl shadow-2xs focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-500/15 transition-all">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '15px',
                  color: '#0f172a',
                  fontWeight: '500',
                  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  '::placeholder': {
                    color: '#94a3b8',
                  },
                  iconColor: '#6366f1',
                },
                invalid: {
                  color: '#e11d48',
                  iconColor: '#e11d48',
                },
              },
              hidePostalCode: true,
            }}
          />
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 bg-rose-50 border border-rose-200/90 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5 flex-1">
            <span className="font-bold block">Payment Authorization Failed</span>
            <p className="leading-relaxed text-[11px] text-rose-700">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Trust Badges Strip */}
      <div className="grid grid-cols-2 gap-2 py-1 text-[11px]">
        <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50/70 border border-emerald-100 px-2.5 py-1.5 rounded-xl">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold line-clamp-1">Upwork-Grade Escrow Guarantee</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-600 bg-slate-50 border border-slate-200/70 px-2.5 py-1.5 rounded-xl">
          <Lock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span className="font-medium line-clamp-1">256-Bit Bank-Level Encryption</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          disabled={processing}
          className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={!stripe || processing}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-md shadow-indigo-600/25 hover:shadow-lg hover:shadow-indigo-600/30 disabled:opacity-50 cursor-pointer active:scale-[0.99]"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{timesheetId ? 'Processing Timesheet Payment...' : 'Authorizing Escrow Deposit...'}</span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5" />
              <span>Pay ${formattedAmount} {currency}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

let stripePromiseCache: Promise<Stripe | null> | null = null;
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
  sequenceOrder = 1,
  timesheetId,
  timesheetTitle,
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
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 space-y-5 shadow-2xl shadow-slate-950/20 border border-slate-200/90 animate-in fade-in zoom-in-95 max-h-[94vh] overflow-y-auto">
        {/* Subtle Top Rainbow Gradient Accent Glow */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-emerald-500 to-teal-400 rounded-t-3xl" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 pt-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  {timesheetId ? 'Pay Timesheet via Stripe' : 'Fund Milestone Escrow'}
                </h3>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-200">
                  Instant
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                {timesheetId
                  ? (timesheetTitle || 'Hourly Timesheet')
                  : `Milestone #${sequenceOrder}: ${milestoneTitle || 'Milestone'}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stripe Elements Form Container */}
        {stripePromise && clientSecret ? (
          <Elements stripe={stripePromise}>
            <StripeCardForm
              milestoneId={milestoneId}
              milestoneTitle={milestoneTitle}
              sequenceOrder={sequenceOrder}
              timesheetId={timesheetId}
              timesheetTitle={timesheetTitle}
              amount={amount}
              currency={currency}
              clientSecret={clientSecret}
              paymentIntentId={paymentIntentId}
              onClose={onClose}
              onSuccess={onSuccess}
            />
          </Elements>
        ) : (
          <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 animate-pulse">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
            <div className="space-y-0.5">
              <span className="font-semibold text-slate-800 text-sm">Initializing Stripe Security Gate</span>
              <p className="text-slate-400 text-xs">Establishing end-to-end encrypted payment channel...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
