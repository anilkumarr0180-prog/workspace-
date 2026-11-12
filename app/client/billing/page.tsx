'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  CreditCard,
  Lock,
  Clock,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Send,
  AlertTriangle,
  History,
  DollarSign,
  Layers,
  FileText,
  User,
  Search,
  Filter,
  Sparkles,
  X,
  Zap,
  Briefcase,
} from 'lucide-react';
import {
  getClientBillingData,
  ClientBillingDataResult,
  ClientPendingMilestoneItem,
} from '@/lib/actions/client-billing';
import {
  createMilestoneRazorpayOrder,
  verifyAndFundMilestoneRazorpay,
} from '@/lib/actions/payments';
import { fundMilestone } from '@/lib/actions/milestones';
import { MilestoneStatus, LedgerEventType } from '@/lib/types';

const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as unknown as { Razorpay?: unknown }).Razorpay) {
      return resolve(true);
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export default function ClientBillingPage() {
  const [data, setData] = useState<ClientBillingDataResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Active Tab: 'pending' | 'active' | 'transactions' | 'gateway'
  const [activeTab, setActiveTab] = useState<'pending' | 'active' | 'transactions' | 'gateway'>('pending');

  // Filters
  const [transactionSearch, setTransactionSearch] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | LedgerEventType>('all');

  // Razorpay Checkout Modal States
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [selectedMilestoneForFund, setSelectedMilestoneForFund] = useState<ClientPendingMilestoneItem | null>(null);
  const [isFundingWithRazorpay, setIsFundingWithRazorpay] = useState(false);
  const [isFundingSimulated, setIsFundingSimulated] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const refreshBillingData = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await getClientBillingData();
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || 'Failed to load client billing details.');
      }
    } catch {
      setError('Network error while retrieving client billing records.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openFundModal = (milestone: ClientPendingMilestoneItem) => {
    setSelectedMilestoneForFund(milestone);
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundModalOpen(true);
  };

  const handleSimulatedFunding = async (milestoneId: string) => {
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundingSimulated(true);

    const res = await fundMilestone(milestoneId);
    setIsFundingSimulated(false);

    if (res.success) {
      setActionSuccessMessage('Milestone funded successfully! Funds are held safely in escrow.');
      setIsFundModalOpen(false);
      refreshBillingData();
    } else {
      setActionErrorMessage(res.error || 'Failed to fund milestone.');
    }
  };

  const handleRazorpayCheckout = async (milestone: ClientPendingMilestoneItem) => {
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundingWithRazorpay(true);

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Could not load Razorpay Checkout SDK. Please check your internet connection.');
      }

      const orderRes = await createMilestoneRazorpayOrder(milestone.id);
      if (!orderRes.success || !orderRes.orderId || !orderRes.keyId) {
        throw new Error(orderRes.error || 'Failed to initialize Razorpay payment order.');
      }

      const isTestMode = typeof orderRes.keyId === 'string' && orderRes.keyId.startsWith('rzp_test_');
      const testContact = isTestMode ? process.env.NEXT_PUBLIC_RAZORPAY_TEST_CONTACT?.trim() : undefined;

      const options = {
        key: orderRes.keyId,
        amount: orderRes.amount,
        currency: orderRes.currency || 'USD',
        name: 'Workspace Escrow',
        description: `Escrow Funding: Milestone #${milestone.sequenceOrder} (${milestone.title})`,
        order_id: orderRes.orderId,
        prefill: {
          name: orderRes.clientName || 'Client',
          email: orderRes.clientEmail || '',
          ...(testContact ? { contact: testContact } : {}),
        },
        theme: {
          color: '#059669', // Emerald 600
        },
        notes: {
          milestone_id: milestone.id,
          contract_id: milestone.contractId,
          environment: 'test',
        },
        handler: async function (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) {
          setIsFundingWithRazorpay(true);
          try {
            const verifyRes = await verifyAndFundMilestoneRazorpay({
              milestoneId: milestone.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });

            if (verifyRes.success) {
              setActionSuccessMessage(
                `Milestone funded successfully via Razorpay Test Mode! Payment ID: ${response.razorpay_payment_id}. Funds are locked in escrow.`
              );
              setIsFundModalOpen(false);
              refreshBillingData();
            } else {
              setActionErrorMessage(verifyRes.error || 'Payment signature verification failed.');
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to finalize payment.';
            setActionErrorMessage(msg);
          } finally {
            setIsFundingWithRazorpay(false);
          }
        },
        modal: {
          ondismiss: function () {
            setIsFundingWithRazorpay(false);
          },
        },
      };

      const RazorpayConstructor = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;
      const rzpInstance = new RazorpayConstructor(options);
      rzpInstance.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error launching Razorpay Checkout.';
      setActionErrorMessage(msg);
      setIsFundingWithRazorpay(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    getClientBillingData()
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setData(res);
        } else {
          setError(res.error || 'Failed to load client billing details.');
        }
      })
      .catch(() => {
        if (isMounted) setError('Network error while retrieving client billing records.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const stats = useMemo(
    () =>
      data?.stats || {
        totalEscrowFunded: 0,
        totalReleased: 0,
        totalPendingFunding: 0,
        totalSpent: 0,
        totalContractsCount: 0,
        unfundedMilestonesCount: 0,
        activeEscrowMilestonesCount: 0,
        awaitingReviewCount: 0,
        ledgerDepositedTotal: 0,
        ledgerReleasedTotal: 0,
      },
    [data?.stats]
  );

  const pendingMilestones = useMemo(() => data?.pendingMilestones || [], [data?.pendingMilestones]);
  const activeMilestones = useMemo(() => data?.activeMilestones || [], [data?.activeMilestones]);
  const transactions = useMemo(() => data?.transactions || [], [data?.transactions]);
  const paymentAttempts = useMemo(() => data?.paymentAttempts || [], [data?.paymentAttempts]);

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (eventTypeFilter !== 'all' && tx.eventType !== eventTypeFilter) {
        return false;
      }
      if (transactionSearch.trim()) {
        const q = transactionSearch.toLowerCase();
        return (
          tx.description.toLowerCase().includes(q) ||
          tx.contractTitle.toLowerCase().includes(q) ||
          (tx.milestoneTitle && tx.milestoneTitle.toLowerCase().includes(q)) ||
          (tx.toUserName && tx.toUserName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [transactions, eventTypeFilter, transactionSearch]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getMilestoneStatusBadge = (status: MilestoneStatus) => {
    switch (status) {
      case 'planned':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            Unfunded (Action Required)
          </span>
        );
      case 'funded':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Lock className="w-3 h-3 text-emerald-600" />
            Funded in Escrow
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <RefreshCw className="w-3 h-3 text-blue-600 animate-spin" />
            Work In Progress
          </span>
        );
      case 'submitted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <Send className="w-3 h-3 text-purple-600" />
            Deliverable Submitted (Review & Release)
          </span>
        );
      case 'revision_requested':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            Changes Requested
          </span>
        );
      case 'approved':
      case 'released':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-600 text-white shadow-2xs">
            <CheckCircle2 className="w-3 h-3 text-white" />
            Released & Paid
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            Cancelled
          </span>
        );
    }
  };

  const getLedgerEventBadge = (type: LedgerEventType) => {
    switch (type) {
      case 'escrow_funded':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Lock className="w-3 h-3 text-emerald-600" />
            Escrow Deposit
          </span>
        );
      case 'escrow_released':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <CheckCircle2 className="w-3 h-3 text-blue-600" />
            Escrow Released
          </span>
        );
      case 'payout_disbursed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
            <DollarSign className="w-3 h-3 text-indigo-600" />
            Payout Disbursed
          </span>
        );
      case 'service_fee_deducted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            Platform Fee (10%)
          </span>
        );
      case 'escrow_refund':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            Escrow Refund
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      {/* Top Header Bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Workspace Secure Escrow & Client Billing</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Billing & Payments
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Razorpay & Escrow Ready
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
                Fund milestones safely into escrow, review deliverables, release payments upon approval, and inspect your full financial transaction history.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              <button
                onClick={() => refreshBillingData()}
                disabled={loading || refreshing}
                type="button"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                title="Refresh billing data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>

              <Link
                href="/contracts"
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>All Contracts</span>
              </Link>

              <Link
                href="/client/jobs/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Post a Job</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {/* Action Success / Error Notifications */}
        {actionSuccessMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-emerald-900 flex items-center justify-between gap-4 animate-in fade-in">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <h3 className="font-bold text-sm">Escrow Payment Successful</h3>
                <p className="text-xs text-emerald-700 mt-0.5">{actionSuccessMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setActionSuccessMessage(null)}
              type="button"
              className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionErrorMessage && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-rose-900 flex items-center justify-between gap-4 animate-in fade-in">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <h3 className="font-bold text-sm">Payment Gateway Error</h3>
                <p className="text-xs text-rose-700 mt-0.5">{actionErrorMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setActionErrorMessage(null)}
              type="button"
              className="text-rose-700 hover:text-rose-900 text-xs font-semibold cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <h3 className="font-bold text-sm">Unable to Load Billing Data</h3>
                <p className="text-xs text-rose-700 mt-0.5">{error}</p>
              </div>
            </div>
            <button
              onClick={() => refreshBillingData()}
              type="button"
              className="px-4 py-2 border border-rose-300 text-rose-800 rounded-xl text-xs font-semibold hover:bg-rose-100 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Escrow Protection Educational Banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 rounded-2xl p-6 text-white shadow-sm border border-emerald-900/40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Workspace Payment Protection
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                How Milestone Escrow Protects Your Investment
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                When you fund a milestone, your funds are safely locked in escrow. Your freelancer starts work knowing funds are reserved, and payouts are only released after you review and approve the submitted deliverables.
              </p>
            </div>

            <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-xs shrink-0">
              <div className="text-center px-2">
                <span className="text-xs text-slate-400 block font-medium">In Escrow</span>
                <span className="text-xl sm:text-2xl font-black text-emerald-400">
                  ${stats.totalEscrowFunded.toFixed(2)}
                </span>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-center px-2">
                <span className="text-xs text-slate-400 block font-medium">Released</span>
                <span className="text-xl sm:text-2xl font-black text-white">
                  ${stats.totalReleased.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Financial KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* 1. Funded in Escrow */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Funded in Escrow
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              {loading ? (
                <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-black text-emerald-700 tracking-tight">
                  ${stats.totalEscrowFunded.toFixed(2)}
                </div>
              )}
              <span className="text-[11px] text-slate-500 mt-1 block">
                Held across {stats.activeEscrowMilestonesCount} active milestone(s)
              </span>
            </div>
          </div>

          {/* 2. Pending Funding */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Pending Funding
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              {loading ? (
                <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-black text-amber-600 tracking-tight">
                  ${stats.totalPendingFunding.toFixed(2)}
                </div>
              )}
              <span className="text-[11px] text-slate-500 mt-1 block">
                {stats.unfundedMilestonesCount} planned milestone(s) need funding
              </span>
            </div>
          </div>

          {/* 3. Released to Freelancers */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Released Payouts
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              {loading ? (
                <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-black text-slate-900 tracking-tight">
                  ${stats.totalReleased.toFixed(2)}
                </div>
              )}
              <span className="text-[11px] text-slate-500 mt-1 block">
                Paid out upon deliverable approval
              </span>
            </div>
          </div>

          {/* 4. Awaiting Review / Release */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Awaiting Review
              </span>
              <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              {loading ? (
                <div className="h-8 w-24 bg-slate-100 animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-black text-purple-700 tracking-tight">
                  {stats.awaitingReviewCount}
                </div>
              )}
              <span className="text-[11px] text-slate-500 mt-1 block">
                Deliverables submitted for release
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-slate-200">
          <div className="flex gap-4 sm:gap-8 overflow-x-auto">
            <button
              onClick={() => setActiveTab('pending')}
              className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeTab === 'pending'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Pending Funding ({pendingMilestones.length})</span>
              {pendingMilestones.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                  Action
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('active')}
              className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeTab === 'active'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>Escrow & Active Milestones ({activeMilestones.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('transactions')}
              className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeTab === 'transactions'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Payment Ledger & Receipts ({transactions.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('gateway')}
              className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer shrink-0 ${
                activeTab === 'gateway'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Razorpay Checkouts ({paymentAttempts.length})</span>
            </button>
          </div>
        </div>

        {/* TAB 1: PENDING FUNDING */}
        {activeTab === 'pending' && (
          <div className="space-y-4">
            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Loading pending milestones...</p>
              </div>
            ) : pendingMilestones.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900">All Project Milestones Are Funded</h3>
                  <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                    You have no planned milestones requiring funding at this time. When you create new fixed-price project milestones, they will appear here.
                  </p>
                </div>
                <div className="pt-2">
                  <Link
                    href="/contracts"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span>View Active Contracts</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4 text-xs text-amber-900">
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      <strong>{pendingMilestones.length} milestone(s)</strong> awaiting escrow deposit totaling{' '}
                      <strong>${stats.totalPendingFunding.toFixed(2)}</strong>. Freelancers are notified once funding is locked.
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {pendingMilestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="bg-white rounded-2xl border border-amber-200 shadow-xs hover:border-emerald-300 transition-all p-5 sm:p-6"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-md">
                              Milestone #{milestone.sequenceOrder}
                            </span>
                            {getMilestoneStatusBadge('planned')}
                            {milestone.dueDate && (
                              <span className="text-xs text-slate-500 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Target: {formatDate(milestone.dueDate)}
                              </span>
                            )}
                          </div>

                          <h3 className="text-base font-bold text-slate-900">{milestone.title}</h3>
                          {milestone.description && (
                            <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                              {milestone.description}
                            </p>
                          )}

                          <div className="flex items-center gap-4 pt-1 text-xs text-slate-500 flex-wrap">
                            <Link
                              href={`/contracts/${milestone.contractId}`}
                              className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>{milestone.contractTitle}</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>

                            <div className="flex items-center gap-1.5 text-slate-600">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span>Freelancer: <strong>{milestone.freelancerName}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div className="text-left sm:text-right shrink-0 flex flex-col justify-between sm:items-end gap-3">
                          <div>
                            <span className="text-xs text-slate-400 font-semibold block">Funding Amount</span>
                            <span className="text-2xl font-black text-slate-900">
                              ${milestone.amount.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-400 block">{milestone.currency}</span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
                            <button
                              type="button"
                              onClick={() => openFundModal(milestone)}
                              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer w-full sm:w-auto"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              <span>Pay with Razorpay</span>
                            </button>

                            <Link
                              href={`/contracts/${milestone.contractId}`}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer w-full sm:w-auto"
                            >
                              <span>Contract Room</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ACTIVE ESCROW & WORK MILESTONES */}
        {activeTab === 'active' && (
          <div className="space-y-4">
            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Loading active escrow milestones...</p>
              </div>
            ) : activeMilestones.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4 shadow-xs">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900">No Funded Milestones</h3>
                  <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                    Once you fund a planned milestone, it will move into active escrow tracking here until work is delivered and released.
                  </p>
                </div>
                {pendingMilestones.length > 0 && (
                  <button
                    onClick={() => setActiveTab('pending')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors"
                  >
                    <span>View {pendingMilestones.length} Pending Milestone(s)</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {activeMilestones.map((m) => (
                  <div
                    key={m.id}
                    className={`bg-white rounded-2xl border transition-all p-5 sm:p-6 ${
                      m.status === 'submitted'
                        ? 'border-purple-300 ring-2 ring-purple-100 shadow-sm'
                        : 'border-slate-200 shadow-xs'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-md">
                            Milestone #{m.sequenceOrder}
                          </span>
                          {getMilestoneStatusBadge(m.status)}
                          {m.hasActiveDelivery && (
                            <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-purple-100 text-purple-800">
                              Work Delivered
                            </span>
                          )}
                        </div>

                        <h3 className="text-base font-bold text-slate-900">{m.title}</h3>
                        {m.description && (
                          <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">{m.description}</p>
                        )}

                        <div className="flex items-center gap-4 pt-1 text-xs text-slate-500 flex-wrap">
                          <Link
                            href={`/contracts/${m.contractId}`}
                            className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{m.contractTitle}</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>

                          <div className="flex items-center gap-1.5 text-slate-600">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>Freelancer: <strong>{m.freelancerName}</strong></span>
                          </div>

                          <span className="text-slate-400">
                            Updated {formatDate(m.updatedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="text-left sm:text-right shrink-0 flex flex-col justify-between sm:items-end gap-3">
                        <div>
                          <span className="text-xs text-slate-400 font-semibold block">Escrow Amount</span>
                          <span className="text-2xl font-black text-slate-900">
                            ${m.amount.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-400 block">{m.currency}</span>
                        </div>

                        <Link
                          href={`/contracts/${m.contractId}`}
                          className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            m.status === 'submitted'
                              ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-xs'
                              : 'border border-slate-300 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {m.status === 'submitted' ? (
                            <>
                              <Send className="w-3.5 h-3.5" />
                              <span>Review & Release Escrow</span>
                            </>
                          ) : (
                            <>
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Manage on Contract</span>
                            </>
                          )}
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TRANSACTION HISTORY & LEDGER RECEIPTS */}
        {activeTab === 'transactions' && (
          <div className="space-y-4">
            {/* Search & Event Type Filter */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by description, contract, or milestone..."
                  value={transactionSearch}
                  onChange={(e) => setTransactionSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value as 'all' | LedgerEventType)}
                  className="text-xs rounded-xl border border-slate-200 py-2 px-3 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-700 bg-white"
                >
                  <option value="all">All Event Types</option>
                  <option value="escrow_funded">Escrow Deposits</option>
                  <option value="escrow_released">Escrow Releases</option>
                  <option value="service_fee_deducted">Platform Fees</option>
                  <option value="escrow_refund">Refunds</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Loading ledger transaction records...</p>
              </div>
            ) : filteredTransactions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3 shadow-xs">
                <History className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-bold text-slate-900">No Transactions Found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {transactions.length === 0
                    ? 'No billing transactions recorded yet. Escrow deposits and payouts will automatically appear in this audit log.'
                    : 'No transactions match your current search and filter criteria.'}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-3 px-4">Date & Time</th>
                        <th className="py-3 px-4">Event Type</th>
                        <th className="py-3 px-4">Description & Project</th>
                        <th className="py-3 px-4">Method</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4 text-right">Contract Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredTransactions.map((tx) => {
                        const isCredit = tx.eventType === 'escrow_refund';
                        const isDeposit = tx.eventType === 'escrow_funded';
                        const isRelease = tx.eventType === 'escrow_released';

                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                              {formatDateTime(tx.createdAt)}
                            </td>

                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {getLedgerEventBadge(tx.eventType)}
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900">{tx.description}</div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                                <Link
                                  href={`/contracts/${tx.contractId}`}
                                  className="text-emerald-700 hover:underline font-medium"
                                >
                                  {tx.contractTitle}
                                </Link>
                                {tx.milestoneTitle && (
                                  <>
                                    <span>•</span>
                                    <span>{tx.milestoneTitle}</span>
                                  </>
                                )}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                                {tx.paymentMethod === 'razorpay'
                                  ? 'Razorpay Test'
                                  : tx.paymentMethod === 'simulated'
                                  ? 'Test Escrow Deposit'
                                  : 'Escrow Ledger'}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold">
                              <span
                                className={
                                  isDeposit
                                    ? 'text-slate-900'
                                    : isRelease
                                    ? 'text-blue-700'
                                    : isCredit
                                    ? 'text-emerald-700'
                                    : 'text-slate-700'
                                }
                              >
                                {isDeposit ? '-' : isRelease ? '✓ ' : ''}${tx.amount.toFixed(2)}
                              </span>
                              <span className="text-[10px] text-slate-400 block font-normal">
                                {tx.currency}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <Link
                                href={`/contracts/${tx.contractId}?tab=ledger`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                              >
                                <span>Inspect</span>
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: RAZORPAY GATEWAY CHECKOUT ATTEMPTS */}
        {activeTab === 'gateway' && (
          <div className="space-y-4">
            <div className="bg-slate-900 rounded-2xl p-5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <CreditCard className="w-4 h-4" />
                  <span>Razorpay Checkout Integration</span>
                </div>
                <h3 className="text-base font-bold text-white">Payment Gateway Order Audit</h3>
                <p className="text-xs text-slate-300">
                  Direct records of Razorpay orders generated for milestone escrow funding.
                </p>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                Environment: Test Mode
              </div>
            </div>

            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Loading gateway records...</p>
              </div>
            ) : paymentAttempts.length === 0 ? (
              <div className="space-y-4">
                {/* Visual Guide on How to Pay with Razorpay */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 text-white border border-slate-700 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <Sparkles className="w-4 h-4" />
                    <span>How to Test Razorpay Payments</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                    In Workspace, escrow payments are tied directly to agreed contract milestones (for Fixed-Price contracts) or approved timesheets (for Hourly contracts). Once a milestone or timesheet is ready, you can pay using Razorpay Test Mode.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
                    <div className="p-3.5 bg-white/5 rounded-xl border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">1</span>
                        <span className="font-bold text-white">Hire Candidate</span>
                      </div>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        Go to your Candidates tab on the Client dashboard and click <strong>Hire / Offer</strong> with <strong>Fixed Price</strong>.
                      </p>
                    </div>

                    <div className="p-3.5 bg-white/5 rounded-xl border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">2</span>
                        <span className="font-bold text-white">Open Pending Milestone</span>
                      </div>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        The contract offer creates an initial milestone in <strong>Pending Funding</strong> ready to deposit into escrow.
                      </p>
                    </div>

                    <div className="p-3.5 bg-white/5 rounded-xl border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold flex items-center justify-center">3</span>
                        <span className="font-bold text-white">Pay with Razorpay</span>
                      </div>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        Click <strong>Pay with Razorpay</strong> to open the test checkout modal and pay using test card <code className="text-emerald-400 font-mono">4111 1111 1111 1111</code>.
                      </p>
                    </div>
                  </div>

                  {/* Test Credentials Box */}
                  <div className="p-3 bg-emerald-950/60 rounded-xl border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <span className="font-bold text-emerald-300">Razorpay Test Card Credentials:</span>
                      <p className="text-slate-300 text-[11px]">
                        Card: <code className="bg-slate-900 px-1 py-0.5 rounded text-white font-mono">4111 1111 1111 1111</code> | Expiry: <code className="bg-slate-900 px-1 py-0.5 rounded text-white font-mono">12/28</code> | CVV: <code className="bg-slate-900 px-1 py-0.5 rounded text-white font-mono">123</code> | OTP: Any 6 digits
                      </p>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30 shrink-0">
                      Zero Cost Simulation
                    </span>
                  </div>
                </div>

                {/* If There Are Pending Milestones Waiting, Render Them Right Here */}
                {pendingMilestones.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-amber-200 p-6 space-y-4 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="space-y-0.5">
                        <h4 className="text-sm font-bold text-slate-900">Pending Milestones Ready to Fund</h4>
                        <p className="text-xs text-slate-500">You have {pendingMilestones.length} milestone(s) awaiting Razorpay escrow deposit.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {pendingMilestones.map((m) => (
                        <div key={m.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <span className="text-xs font-bold text-slate-900 block">{m.title}</span>
                            <span className="text-xs text-slate-500">Contract: {m.contractTitle}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-lg font-black text-slate-900">${m.amount.toFixed(2)}</span>
                            <button
                              type="button"
                              onClick={() => openFundModal(m)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              <span>Pay with Razorpay</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4 shadow-xs">
                    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-slate-900">No Pending Payments or Completed Orders</h4>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        To initiate your first Razorpay checkout, hire a candidate on a Fixed-Price contract from your Client dashboard.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
                      <Link
                        href="/client"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                      >
                        <Briefcase className="w-3.5 h-3.5" />
                        <span>Go to Candidates &amp; Hire</span>
                      </Link>
                      <Link
                        href="/contracts"
                        className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>View Contracts</span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Razorpay Order ID</th>
                        <th className="py-3 px-4">Payment ID</th>
                        <th className="py-3 px-4">Milestone & Contract</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {paymentAttempts.map((att) => (
                        <tr key={att.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                            {formatDateTime(att.createdAt)}
                          </td>

                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-800 whitespace-nowrap">
                            {att.razorpayOrderId}
                          </td>

                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {att.razorpayPaymentId || (
                              <span className="text-slate-400 italic">Not captured</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900">{att.milestoneTitle}</div>
                            <Link
                              href={`/contracts/${att.contractId}`}
                              className="text-[11px] text-emerald-700 hover:underline"
                            >
                              {att.contractTitle}
                            </Link>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                att.status === 'captured'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : att.status === 'created'
                                  ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                  : 'bg-rose-50 text-rose-800 border border-rose-200'
                              }`}
                            >
                              {att.status === 'captured' ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              ) : att.status === 'created' ? (
                                <Clock className="w-3 h-3 text-blue-600" />
                              ) : (
                                <AlertCircle className="w-3 h-3 text-rose-600" />
                              )}
                              <span className="capitalize">{att.status}</span>
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-slate-900">
                            ${att.amount.toFixed(2)} {att.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Razorpay Escrow Funding Modal */}
      {isFundModalOpen && selectedMilestoneForFund && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Fund Milestone Escrow</h3>
                  <p className="text-xs text-slate-500">
                    Milestone #{selectedMilestoneForFund.sequenceOrder}: {selectedMilestoneForFund.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isFundingWithRazorpay && !isFundingSimulated) {
                    setIsFundModalOpen(false);
                  }
                }}
                disabled={isFundingWithRazorpay || isFundingSimulated}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-xs font-semibold text-slate-500">Escrow Deposit Amount</span>
                <div className="text-3xl font-black text-slate-900 tracking-tight">
                  ${selectedMilestoneForFund.amount.toFixed(2)} {selectedMilestoneForFund.currency}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
                  <span>Contract:</span>
                  <span className="font-semibold text-slate-800">{selectedMilestoneForFund.contractTitle}</span>
                </div>
              </div>

              {/* Protection Details */}
              <div className="space-y-1 text-xs text-slate-600 border border-emerald-100 bg-emerald-50/40 rounded-xl p-3.5">
                <div className="flex items-center justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-emerald-800 font-bold">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Platform Escrow Protection
                  </span>
                  <span className="font-bold text-emerald-700">100% Protected</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                  Your deposit is locked safely in escrow. Funds are not disbursed to the freelancer until you review and approve their deliverables.
                </p>
              </div>

              {/* Payment Method 1: Razorpay Test Checkout */}
              <div className="p-4 rounded-xl border-2 border-emerald-500/30 bg-emerald-50/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">Pay with Razorpay</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                      <Zap className="w-2.5 h-2.5 text-amber-600" />
                      TEST MODE
                    </span>
                  </div>
                </div>

                <div className="p-2.5 bg-white/90 rounded-lg border border-slate-200/60 text-[11px] text-slate-600 space-y-1">
                  <span className="font-semibold text-slate-800 block">Test Payment Tip:</span>
                  <p>
                    In the Razorpay modal, select <strong>Card</strong> and enter test number <code className="bg-slate-100 px-1 py-0.5 rounded text-emerald-700 font-mono font-bold">4111 1111 1111 1111</code> with any future expiry &amp; CVV <code className="bg-slate-100 px-1 py-0.5 rounded text-emerald-700 font-mono font-bold">123</code>, or click <strong>Success</strong> for instant simulation.
                  </p>
                </div>

                {actionErrorMessage && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-bold text-rose-950 block">Gateway Error</span>
                      <p>{actionErrorMessage}</p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleRazorpayCheckout(selectedMilestoneForFund)}
                  disabled={isFundingWithRazorpay || isFundingSimulated}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isFundingWithRazorpay ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Opening Razorpay Gateway...</span>
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Launch Razorpay Test Checkout</span>
                    </>
                  )}
                </button>
              </div>

              {/* Payment Method 2: Instant Simulated Funding */}
              {(process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS === 'true') && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <span className="text-xs font-bold text-slate-800 block">Alternative: Direct Test Escrow Deposit</span>
                  <button
                    type="button"
                    onClick={() => handleSimulatedFunding(selectedMilestoneForFund.id)}
                    disabled={isFundingWithRazorpay || isFundingSimulated}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isFundingSimulated ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Simulating Deposit...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-slate-500" />
                        <span>Simulate Escrow Deposit (Instant)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
