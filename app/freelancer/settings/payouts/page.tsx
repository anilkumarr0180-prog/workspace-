'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  getFreelancerPayoutProfile,
  setupFreelancerPayoutProfile,
  getFreelancerPayoutHistory,
  FreelancerPayoutProfileData,
  PayoutTransferRecord,
} from '@/lib/actions/payout-profile';
import {
  ShieldCheck,
  CreditCard,
  Building2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  DollarSign,
  Lock,
  Sparkles,
  Info,
  Clock,
  ArrowUpRight,
  FileText,
} from 'lucide-react';

export default function FreelancerPayoutSettingsPage() {
  const [profile, setProfile] = useState<FreelancerPayoutProfileData | null>(null);
  const [transfers, setTransfers] = useState<PayoutTransferRecord[]>([]);
  const [summary, setSummary] = useState({ totalPaid: 0, pendingPayout: 0, totalTransfers: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form states
  const [legalName, setLegalName] = useState('');
  const [bankName, setBankName] = useState('HDFC Bank');
  const [bankIfsc, setBankIfsc] = useState('HDFC0001234');
  const [accountNumber, setAccountNumber] = useState('987654321099');
  const [panNumber, setPanNumber] = useState('ABCDE1234F');
  const [businessType, setBusinessType] = useState<'individual' | 'business'>('individual');
  const [isSaving, setIsSaving] = useState(false);

  // Notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  const loadProfileAndHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [profileRes, historyRes] = await Promise.all([
        getFreelancerPayoutProfile(),
        getFreelancerPayoutHistory(),
      ]);

      if (profileRes.success && profileRes.profile) {
        setProfile(profileRes.profile);
        setLegalName(profileRes.profile.legalName || '');
        setBankName(profileRes.profile.bankName || 'HDFC Bank');
        setBankIfsc(profileRes.profile.bankIfsc || 'HDFC0001234');
      }

      if (historyRes.success) {
        setTransfers(historyRes.transfers);
        setSummary(historyRes.summary);
      }
    } catch {
      showError('Unable to load payout information. Please check network connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showError]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [profileRes, historyRes] = await Promise.all([
          getFreelancerPayoutProfile(),
          getFreelancerPayoutHistory(),
        ]);

        if (!isMounted) return;

        if (profileRes.success && profileRes.profile) {
          setProfile(profileRes.profile);
          setLegalName(profileRes.profile.legalName || '');
          setBankName(profileRes.profile.bankName || 'HDFC Bank');
          setBankIfsc(profileRes.profile.bankIfsc || 'HDFC0001234');
        }

        if (historyRes.success) {
          setTransfers(historyRes.transfers);
          setSummary(historyRes.summary);
        }
      } catch {
        if (isMounted) showError('Unable to load payout information. Please check network connection.');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [showError]);

  const handleAutofillTestData = () => {
    setLegalName('Aditi Sharma');
    setBankName('HDFC Bank');
    setBankIfsc('HDFC0001234');
    setAccountNumber('987654321099');
    setPanNumber('ABCDE1234F');
    setBusinessType('individual');
    showToast('Fictional test credentials filled in.');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalName.trim() || legalName.trim().length < 2) {
      showError('Please enter a valid legal name (at least 2 characters).');
      return;
    }
    if (!bankName.trim() || !bankIfsc.trim() || !accountNumber.trim()) {
      showError('Please complete all banking details.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await setupFreelancerPayoutProfile({
        legalName: legalName.trim(),
        bankName: bankName.trim(),
        bankIfsc: bankIfsc.trim().toUpperCase(),
        accountNumber: accountNumber.trim(),
        panNumber: panNumber.trim().toUpperCase(),
        businessType,
      });

      if (res.success && res.profile) {
        setProfile(res.profile);
        showToast('Simulated payout profile successfully configured!');
        loadProfileAndHistory();
      } else {
        showError(res.error || 'Failed to update payout profile.');
      }
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Error setting up payout profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-emerald-900 text-white px-5 py-3 rounded-xl shadow-lg border border-emerald-700 animate-in fade-in slide-in-from-bottom-2 text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-rose-900 text-white px-5 py-3 rounded-xl shadow-lg border border-rose-700 animate-in fade-in slide-in-from-bottom-2 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <Link href="/freelancer" className="hover:text-slate-900 transition-colors">
                Freelancer Console
              </Link>
              <span>/</span>
              <span className="text-slate-900">Payout Settings</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span>Freelancer Payout & Linked Account</span>
              <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                MockRoute Sandbox
              </span>
            </h1>
            <p className="text-xs text-slate-600">
              Manage your simulated linked account for automatic fixed-price milestone and weekly timesheet payouts.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/freelancer/time-tracking"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-medium transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Time Tracker</span>
            </Link>
            <button
              onClick={() => loadProfileAndHistory(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Educational Sandbox Warning Banner */}
        <div className="bg-amber-50/90 border border-amber-200/80 rounded-2xl p-4 sm:p-5 text-amber-900 flex items-start gap-3.5 shadow-xs">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-amber-950">
              Educational Freelance Marketplace Simulation
            </p>
            <p className="text-amber-800 leading-relaxed">
              This platform uses an Upwork-inspired financial engine with simulated routing via <code className="bg-amber-100 px-1 py-0.5 rounded text-2xs font-mono font-semibold">MockRouteProvider</code>.
              <strong> Never enter real bank account numbers, PAN credentials, or live financial data.</strong>
              All transfers, fee deductions (10% platform fee), and earnings settlements are safely simulated in isolated test mode.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
            <p className="text-xs text-slate-500 font-medium">Loading payout profile and financial history...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Profile Status & Account Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Linked Account Card */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-slate-600" />
                    <h2 className="text-sm font-bold text-slate-900">Linked Payout Account</h2>
                  </div>
                  {profile?.payoutEligible ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Payout Eligible</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      <AlertCircle className="w-3 h-3 text-amber-600" />
                      <span>Setup Required</span>
                    </span>
                  )}
                </div>

                <div className="p-6 space-y-6">
                  {profile ? (
                    <div className="space-y-4">
                      {/* Active Account Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                          <span className="text-2xs text-slate-500 font-medium uppercase tracking-wider">Simulated Account ID</span>
                          <p className="font-mono text-xs font-semibold text-slate-900 truncate">
                            {profile.providerAccountId}
                          </p>
                          <span className="text-3xs text-indigo-600 font-medium">Routed via {profile.provider}</span>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                          <span className="text-2xs text-slate-500 font-medium uppercase tracking-wider">Beneficiary Legal Name</span>
                          <p className="text-xs font-semibold text-slate-900">
                            {profile.legalName}
                          </p>
                          <span className="text-3xs text-slate-500 capitalize">{profile.businessType} Account</span>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                          <span className="text-2xs text-slate-500 font-medium uppercase tracking-wider">Bank & Account Number</span>
                          <p className="text-xs font-semibold text-slate-900">
                            {profile.bankName} ({profile.bankAccountMasked || '••••••1234'})
                          </p>
                          <span className="text-3xs text-slate-500 font-mono">IFSC: {profile.bankIfsc}</span>
                        </div>

                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                          <span className="text-2xs text-slate-500 font-medium uppercase tracking-wider">Masked PAN</span>
                          <p className="font-mono text-xs font-semibold text-slate-900">
                            {profile.panMasked || '•••••1234F'}
                          </p>
                          <span className="text-3xs text-emerald-600 font-medium">Simulated KYC Verified</span>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/60 flex items-start gap-3">
                        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-1">
                          <p className="font-semibold text-emerald-950">Automatic Transfers Enabled</p>
                          <p className="text-emerald-800 leading-relaxed text-2xs">
                            When client approvals take place for your fixed-price milestones or weekly timesheets, net earnings (90% after the 10% marketplace fee) disburse automatically to this simulated account.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 space-y-3">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-500">
                        <CreditCard className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">No Payout Profile Onboarded</p>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          Set up your simulated linked account below to be eligible for automatic milestone escrow disbursements and hourly invoice payments.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Form: Setup / Update Payout Profile */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-600" />
                    <h2 className="text-sm font-bold text-slate-900">
                      {profile ? 'Update Simulated Payout Profile' : 'Onboard Simulated Payout Account'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutofillTestData}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-2xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Autofill Test Data</span>
                  </button>
                </div>

                <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Legal Name / Beneficiary Name</label>
                      <input
                        type="text"
                        required
                        value={legalName}
                        onChange={(e) => setLegalName(e.target.value)}
                        placeholder="e.g. Aditi Sharma"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Account Type</label>
                      <select
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value as 'individual' | 'business')}
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white transition"
                      >
                        <option value="individual">Individual / Freelancer</option>
                        <option value="business">Business / Agency</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Bank Name</label>
                      <input
                        type="text"
                        required
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="e.g. HDFC Bank, ICICI Bank, SBI"
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Bank IFSC Code</label>
                      <input
                        type="text"
                        required
                        value={bankIfsc}
                        onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                        placeholder="e.g. HDFC0001234"
                        className="w-full px-3.5 py-2.5 text-xs font-mono uppercase rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Fictional Account Number</label>
                      <input
                        type="text"
                        required
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="e.g. 987654321099"
                        className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      />
                      <span className="text-3xs text-slate-500">Only the last 4 digits are permanently retained for masking.</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">Fictional PAN Number</label>
                      <input
                        type="text"
                        required
                        value={panNumber}
                        onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                        placeholder="e.g. ABCDE1234F"
                        className="w-full px-3.5 py-2.5 text-xs font-mono uppercase rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      />
                      <span className="text-3xs text-slate-500">Simulated test PAN for MockRoute KYC validation.</span>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Registering with MockRoute...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Save Simulated Payout Profile</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Payout Transfer History */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-600" />
                    <h2 className="text-sm font-bold text-slate-900">Recent Payout Transfers</h2>
                  </div>
                  <span className="text-2xs text-slate-500 font-medium">
                    {transfers.length} {transfers.length === 1 ? 'record' : 'records'}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  {transfers.length === 0 ? (
                    <div className="text-center py-10 space-y-2">
                      <Clock className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-xs text-slate-500 font-medium">No payout transfers recorded yet.</p>
                      <p className="text-3xs text-slate-400 max-w-xs mx-auto">
                        Transfers disburse automatically once fixed-price milestones are approved or timesheet payments are captured.
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/75 border-b border-slate-100 text-2xs text-slate-500 font-semibold uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-4">Transfer / Reference</th>
                          <th className="py-3 px-4">Contract Engagement</th>
                          <th className="py-3 px-4">Gross</th>
                          <th className="py-3 px-4">Platform Fee (10%)</th>
                          <th className="py-3 px-4">Net Payout</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Settled At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {transfers.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3.5 px-4 font-mono text-2xs text-slate-900">
                              <div className="font-semibold">{t.providerTransferId}</div>
                              <span className="text-3xs text-slate-400">ID: {t.id.slice(0, 8)}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-medium text-slate-900 truncate max-w-[180px]">{t.contractTitle}</div>
                              <span className="text-3xs text-slate-500">
                                {t.milestoneId ? 'Fixed Milestone' : 'Hourly Timesheet'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-700">
                              ${t.grossAmount.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4 text-rose-600 font-medium">
                              -${t.feeAmount.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4 font-bold text-emerald-600">
                              ${t.netAmount.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-3xs font-semibold ${
                                  t.status === 'completed'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : t.status === 'processing'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {t.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 text-3xs">
                              {t.settledAt ? new Date(t.settledAt).toLocaleDateString() : 'Pending'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Right 1 Col: Payout Summary Cards & Information */}
            <div className="space-y-6">
              {/* Earnings & Transfers Summary */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  <span>Disbursement Summary</span>
                </h3>

                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-100 flex items-center justify-between">
                    <div>
                      <span className="text-3xs text-emerald-700 font-semibold uppercase tracking-wider">Total Disbursed</span>
                      <p className="text-lg font-extrabold text-emerald-900">${summary.totalPaid.toFixed(2)}</p>
                    </div>
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 opacity-80" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-3xs text-slate-500 font-semibold uppercase tracking-wider">In Process / Held</span>
                      <p className="text-lg font-bold text-slate-800">${summary.pendingPayout.toFixed(2)}</p>
                    </div>
                    <Clock className="w-6 h-6 text-slate-400" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-3xs text-slate-500 font-semibold uppercase tracking-wider">Total Payout Events</span>
                      <p className="text-lg font-bold text-slate-800">{summary.totalTransfers}</p>
                    </div>
                    <ArrowUpRight className="w-6 h-6 text-indigo-500 opacity-80" />
                  </div>
                </div>
              </div>

              {/* How Payouts Work */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>How Workspace Payouts Work</span>
                </h3>

                <ul className="space-y-3 text-xs text-slate-600 leading-relaxed">
                  <li className="flex items-start gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-700 text-2xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <span><strong>Fixed-Price Milestones:</strong> When the client approves your submitted delivery, the payout engine triggers an automatic transfer.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-700 text-2xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <span><strong>Hourly Timesheets:</strong> Once your weekly timesheet is approved and paid by the client via Razorpay, net funds are immediately disbursed.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-700 text-2xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                    <span><strong>Centralized 10% Fee:</strong> The platform deducts a 10% fee transparently in ledger entries, with deterministic idempotency keys preventing double payouts.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-700 text-2xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                    <span><strong>Delayed Settlement:</strong> Freelancer profile earnings update only after provider transfer confirmation, eliminating ledger drift.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
