'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Clock,
  DollarSign,
  Briefcase,
  AlertCircle,
  RefreshCw,
  Calendar,
  FileText,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { getClientReportsData, ClientReportsData } from '@/lib/actions/client-reports';

export default function ClientReportsPage() {
  const [data, setData] = useState<ClientReportsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timesheets' | 'timelogs' | 'contracts'>('timesheets');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getClientReportsData();
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || 'Failed to load client reports.');
      }
    } catch {
      setError('Network error while connecting to reports service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    getClientReportsData()
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setData(res);
        } else {
          setError(res.error || 'Failed to load client reports.');
        }
      })
      .catch(() => {
        if (isMounted) setError('Network error while connecting to reports service.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const stats = data?.stats || {
    totalLoggedMinutes: 0,
    totalLoggedHours: 0,
    totalAccruedAmount: 0,
    activeHourlyContracts: 0,
    activeFixedContracts: 0,
    totalAgreedFixedValue: 0,
    simulatedMilestoneReleased: 0,
    simulatedEscrowHeld: 0,
    invoicedAmount: 0,
    paidAmount: 0,
    paymentsImplemented: false as const,
  };

  const formatMinutes = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs === 0) return `${mins}m`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h ${mins}m`;
  };

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
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Financial & Work Tracking</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white">
              Client Reports
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Review tracked hours, verified weekly timesheets, milestone escrow releases, and active contract allocations.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
            <button
              onClick={loadReports}
              type="button"
              disabled={loading}
              className="p-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-all duration-200 disabled:opacity-50 cursor-pointer backdrop-blur-md hover:scale-105 active:scale-95"
              title="Refresh reports data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/client/jobs/new"
              className="inline-flex items-center gap-2.5 px-5 sm:px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all duration-200 cursor-pointer"
            >
              <span>Post a Job</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <h3 className="font-bold text-sm">Unable to Load Reports</h3>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={loadReports}
            type="button"
            className="px-4 py-2 border border-rose-300 text-rose-800 rounded-xl text-xs font-semibold hover:bg-rose-100 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-5">
        {/* 1. Total Logged Time */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Hourly Tracked
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-100 transition-all duration-300 shadow-2xs">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            {loading ? (
              <div className="h-8 w-20 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  {stats.totalLoggedHours}h
                </span>
                <span className="text-xs text-slate-500 ml-2 font-medium">
                  ({stats.totalLoggedMinutes} mins)
                </span>
              </>
            )}
          </div>
        </div>

        {/* 2. Accrued Hourly Work Total */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Hourly Accrued
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-blue-100 transition-all duration-300 shadow-2xs">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            {loading ? (
              <div className="h-8 w-24 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  ${stats.totalAccruedAmount.toFixed(2)}
                </span>
                <span className="text-xs text-blue-600 font-semibold block mt-0.5">
                  Verified timesheet rate
                </span>
              </>
            )}
          </div>
        </div>

        {/* 3. Simulated Milestones Released */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Milestones Released
            </span>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-100 transition-all duration-300 shadow-2xs">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            {loading ? (
              <div className="h-8 w-24 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  ${stats.simulatedMilestoneReleased.toFixed(2)}
                </span>
                <span className="text-xs text-indigo-600 font-semibold block mt-0.5">
                  Escrow: ${stats.simulatedEscrowHeld.toFixed(2)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 4. Active Contracts */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-violet-400 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Contracts
            </span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-purple-100 transition-all duration-300 shadow-2xs">
              <Briefcase className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            {loading ? (
              <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums">
                  {stats.activeHourlyContracts + stats.activeFixedContracts}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5 font-medium">
                  {stats.activeHourlyContracts} hourly, {stats.activeFixedContracts} fixed
                </span>
              </>
            )}
          </div>
        </div>

        {/* 5. Total Disbursed */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5 border border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_24px_-4px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-400 to-slate-300 opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Total Disbursed
            </span>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center group-hover:scale-110 group-hover:bg-slate-200 transition-all duration-300 shadow-2xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            {loading ? (
              <div className="h-8 w-20 bg-slate-100 animate-pulse rounded-lg" />
            ) : (
              <>
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-400 tracking-tight tabular-nums">
                  $0.00
                </span>
                <span className="text-xs text-slate-500 font-semibold block mt-0.5">
                  Balance settled
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs and Data Tables */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.05)] overflow-hidden">
        {/* Navigation Tabs */}
        <div className="p-3 sm:p-4 border-b border-slate-200/80 bg-slate-50/70 flex items-center gap-2 overflow-x-auto">
          <div className="bg-slate-200/70 p-1 rounded-2xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('timesheets')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer shrink-0 ${
                activeTab === 'timesheets'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              Weekly Timesheets ({data?.timesheets?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('timelogs')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer shrink-0 ${
                activeTab === 'timelogs'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              Detailed Time Logs ({data?.recentEntries?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('contracts')}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all duration-150 cursor-pointer shrink-0 ${
                activeTab === 'contracts'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              Contract Terms ({data?.contracts?.length || 0})
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="space-y-3 py-8">
              <div className="h-6 w-48 bg-slate-100 animate-pulse rounded" />
              <div className="h-12 w-full bg-slate-100 animate-pulse rounded-xl" />
              <div className="h-12 w-full bg-slate-100 animate-pulse rounded-xl" />
              <div className="h-12 w-full bg-slate-100 animate-pulse rounded-xl" />
            </div>
          ) : activeTab === 'timesheets' ? (
            /* ================= TAB 1: WEEKLY TIMESHEETS ================= */
            <div>
              {(!data?.timesheets || data.timesheets.length === 0) ? (
                <div className="text-center py-12 px-4 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Weekly Timesheets Recorded</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    When contracted freelancers log time using the active timer tracker, weekly rollups will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 pr-4">Week Starting</th>
                        <th className="pb-3 pr-4">Contract Deliverable</th>
                        <th className="pb-3 pr-4">Freelancer</th>
                        <th className="pb-3 pr-4 text-right">Logged Time</th>
                        <th className="pb-3 pr-4 text-right">Accrued Amount</th>
                        <th className="pb-3 pr-4 text-right">Status</th>
                        <th className="pb-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.timesheets.map((ts) => (
                        <tr key={ts.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 pr-4 font-semibold text-slate-900 whitespace-nowrap">
                            {formatDate(ts.weekStartDate)}
                          </td>
                          <td className="py-3.5 pr-4 text-slate-800 font-medium">
                            <Link
                              href={`/contracts/${ts.contractId}`}
                              className="font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                            >
                              {ts.contractTitle}
                            </Link>
                          </td>
                          <td className="py-3.5 pr-4 text-slate-700 whitespace-nowrap">
                            <span className="font-semibold text-slate-900">{ts.freelancerName}</span>
                            {ts.freelancerUsername && (
                              <span className="text-slate-400 text-xs ml-1">@{ts.freelancerUsername}</span>
                            )}
                          </td>
                          <td className="py-3.5 pr-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {formatMinutes(ts.totalMinutes)}
                          </td>
                          <td className="py-3.5 pr-4 text-right font-semibold text-emerald-700 whitespace-nowrap">
                            ${ts.totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3.5 pr-4 text-right whitespace-nowrap">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              ts.status === 'approved'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : ts.status === 'submitted'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {ts.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3.5 text-right whitespace-nowrap">
                            <Link
                              href={`/contracts/${ts.contractId}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <span>Contract &amp; Pay</span>
                              <ArrowRight className="w-3 h-3 text-slate-300" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'timelogs' ? (
            /* ================= TAB 2: DETAILED TIME LOGS ================= */
            <div>
              {(!data?.recentEntries || data.recentEntries.length === 0) ? (
                <div className="text-center py-12 px-4 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Clock className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Time Entries Recorded</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Completed work sessions tracked by freelancers will be logged here with timestamps and activity memos.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 pr-4">Date & Time</th>
                        <th className="pb-3 pr-4">Work Memo</th>
                        <th className="pb-3 pr-4">Contract</th>
                        <th className="pb-3 pr-4">Freelancer</th>
                        <th className="pb-3 pr-4 text-right">Duration</th>
                        <th className="pb-3 text-right">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 pr-4 text-slate-600 whitespace-nowrap">
                            {formatDateTime(entry.startTime)}
                          </td>
                          <td className="py-3.5 pr-4 text-slate-800 font-medium max-w-md truncate">
                            {entry.memo}
                          </td>
                          <td className="py-3.5 pr-4 text-slate-700 whitespace-nowrap">
                            <Link
                              href={`/contracts/${entry.contractId}`}
                              className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline"
                            >
                              {entry.contractTitle}
                            </Link>
                          </td>
                          <td className="py-3.5 pr-4 text-slate-700 whitespace-nowrap font-medium">
                            {entry.freelancerName}
                          </td>
                          <td className="py-3.5 pr-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                            {formatMinutes(entry.durationMinutes)}
                          </td>
                          <td className="py-3.5 text-right whitespace-nowrap">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {entry.source.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* ================= TAB 3: CONTRACT FINANCIAL TERMS ================= */
            <div>
              {(!data?.contracts || data.contracts.length === 0) ? (
                <div className="text-center py-12 px-4 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">No Contracts Established</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    When you accept a freelancer proposal, an agreed contract with contractual rates will be listed here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                        <th className="pb-3 pr-4">Contract Deliverable</th>
                        <th className="pb-3 pr-4">Freelancer</th>
                        <th className="pb-3 pr-4">Type</th>
                        <th className="pb-3 pr-4 text-right">Agreed Rate / Value</th>
                        <th className="pb-3 pr-4 text-right">Weekly Limit</th>
                        <th className="pb-3 pr-4 text-right">Total Accrued</th>
                        <th className="pb-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.contracts.map((contract) => (
                        <tr key={contract.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 pr-4 font-semibold text-slate-900">
                            <Link href={`/contracts/${contract.id}`} className="hover:text-emerald-700 hover:underline">
                              {contract.title}
                            </Link>
                            <div className="text-xs text-slate-400 font-normal">{contract.jobTitle}</div>
                          </td>
                          <td className="py-3.5 pr-4 text-slate-700 whitespace-nowrap">
                            <span className="font-semibold text-slate-900">{contract.freelancer.fullName}</span>
                            {contract.freelancer.username && (
                              <span className="text-slate-400 text-xs ml-1">@{contract.freelancer.username}</span>
                            )}
                          </td>
                          <td className="py-3.5 pr-4 whitespace-nowrap">
                            <span className="capitalize text-slate-700 font-medium">
                              {contract.contractType}
                            </span>
                          </td>
                          <td className="py-3.5 pr-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {contract.contractType === 'hourly' && contract.hourlyRate
                              ? `$${contract.hourlyRate.toFixed(2)}/hr`
                              : contract.fixedPrice
                              ? `$${contract.fixedPrice.toFixed(2)} (Fixed)`
                              : '—'}
                          </td>
                          <td className="py-3.5 pr-4 text-right text-slate-600 whitespace-nowrap">
                            {contract.weeklyHourLimit ? `${contract.weeklyHourLimit} hrs/wk` : '—'}
                          </td>
                          <td className="py-3.5 pr-4 text-right font-semibold text-emerald-700 whitespace-nowrap">
                            ${contract.accruedAmount.toFixed(2)}
                            {contract.contractType === 'fixed' && (
                              <span className="block text-[10px] text-slate-400 font-normal">Escrow funded</span>
                            )}
                          </td>
                          <td className="py-3.5 text-right whitespace-nowrap">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              contract.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : contract.status === 'paused'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {contract.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
