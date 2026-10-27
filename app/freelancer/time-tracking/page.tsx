'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  getFreelancerTimeTrackingData,
  startTimerSession,
  stopTimerSession,
  discardTimerSession,
  FreelancerTimeDashboardData,
} from '@/lib/actions/time-tracking';
import { Contract } from '@/lib/types';
import {
  Play,
  Square,
  Clock,
  Briefcase,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Building,
  Calendar,
  Layers,
  ArrowLeft,
  XCircle,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Info
} from 'lucide-react';

export default function FreelancerTimeTrackingPage() {
  const [data, setData] = useState<FreelancerTimeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form & Timer action states
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [workMemo, setWorkMemo] = useState<string>('');
  const [memoError, setMemoError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live timer state
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  // 1. Initial Data Fetch
  const loadDashboardData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const res = await getFreelancerTimeTrackingData();
      if (res.success) {
        setData(res);
        // Pre-select active session's contract or first available contract
        if (res.activeSession?.contractId) {
          setSelectedContractId(res.activeSession.contractId);
          if (res.activeSession.memo) {
            setWorkMemo(res.activeSession.memo);
          }
        } else if (res.eligibleContracts.length > 0) {
          setSelectedContractId((prev) => prev || res.eligibleContracts[0].id);
        }
      } else {
        showError(res.error || 'Failed to load time tracking data.');
      }
    } catch {
      showError('Unable to connect to database. Please check your network.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showError]);

  useEffect(() => {
    let isMounted = true;
    getFreelancerTimeTrackingData()
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setData(res);
          if (res.activeSession?.contractId) {
            setSelectedContractId(res.activeSession.contractId);
            if (res.activeSession.memo) {
              setWorkMemo(res.activeSession.memo);
            }
          } else if (res.eligibleContracts.length > 0) {
            setSelectedContractId(res.eligibleContracts[0].id);
          }
        } else {
          setErrorMessage(res.error || 'Failed to load time tracking data.');
        }
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) {
          setErrorMessage('Unable to connect to database.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Authoritative Live Elapsed-Time Clock
  // Calculates strictly from server-persisted startTime and current client time
  useEffect(() => {
    if (!data?.activeSession?.startTime) {
      return;
    }

    const startMs = new Date(data.activeSession.startTime).getTime();

    const updateElapsed = () => {
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      setElapsedSeconds(diffSec);
    };

    const timerId = setTimeout(updateElapsed, 0);
    const interval = setInterval(updateElapsed, 1000);

    // Recalculate accurately on tab resume / wake from sleep
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        updateElapsed();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timerId);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [data?.activeSession?.startTime]);

  const activeContract: Contract | undefined = useMemo(() => {
    if (data?.activeSession?.contract) return data.activeSession.contract;
    return data?.eligibleContracts.find((c) => c.id === selectedContractId);
  }, [data?.activeSession, data?.eligibleContracts, selectedContractId]);

  // Format seconds to HH:MM:SS
  const formatTimeHHMMSS = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // Format minutes into clean hours and minutes string
  const formatDurationMinutes = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  };

  // 3. Start Timer Handler
  const handleStartTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemoError(null);
    setContractError(null);

    if (!selectedContractId) {
      setContractError('Please select an active hourly contract to track time.');
      return;
    }

    const trimmedMemo = workMemo.trim();
    if (!trimmedMemo) {
      setMemoError('Work memo is required to document what you are working on.');
      return;
    }

    setIsStarting(true);
    try {
      const res = await startTimerSession(selectedContractId, trimmedMemo);
      if (res.success && res.session) {
        showToast('Timer started successfully. Elapsed time is being recorded.');
        await loadDashboardData(true);
      } else {
        showError(res.error || 'Failed to start timer session.');
      }
    } catch {
      showError('Network error while starting timer session.');
    } finally {
      setIsStarting(false);
    }
  };

  // 4. Stop Timer Handler
  const handleStopTimer = async () => {
    setIsStopping(true);
    try {
      const res = await stopTimerSession(workMemo);
      if (res.success) {
        if (res.entry) {
          showToast(`Logged ${res.entry.durationMinutes} minute${res.entry.durationMinutes === 1 ? '' : 's'} to your timesheet!`);
        } else {
          showToast('Timer session was under 1 minute and was discarded without billing.');
        }
        setWorkMemo('');
        await loadDashboardData(true);
      } else {
        // If error suggests session already ended, refresh state cleanly
        if (res.code === 'NO_ACTIVE_SESSION') {
          showToast('Session was already completed. Refreshed view.');
          await loadDashboardData(true);
        } else {
          showError(res.error || 'Failed to stop timer session.');
        }
      }
    } catch {
      showError('Network error while stopping timer. Re-synchronizing session...');
      await loadDashboardData(true);
    } finally {
      setIsStopping(false);
    }
  };

  // 5. Discard Timer Handler
  const handleDiscardTimer = async () => {
    if (!window.confirm('Discard this timer session? No billable time will be recorded.')) {
      return;
    }

    setIsDiscarding(true);
    try {
      const res = await discardTimerSession();
      if (res.success) {
        showToast('Active timer session cancelled and discarded.');
        setWorkMemo('');
        await loadDashboardData(true);
      } else {
        showError(res.error || 'Failed to discard session.');
      }
    } catch {
      showError('Network error while discarding session.');
    } finally {
      setIsDiscarding(false);
    }
  };

  const isTimerRunning = Boolean(data?.activeSession?.startTime);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast Notifications */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-rose-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1">
            <Link href="/freelancer" className="hover:text-emerald-700 transition-colors flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Freelancer Hub</span>
            </Link>
            <span>/</span>
            <span className="text-emerald-700 font-bold">Time Tracker</span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Hourly Work Diary & Timer
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Trusted Server Timing
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Track active billable work sessions on your verified hourly contracts with Upwork-style timesheet synchronization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadDashboardData(true)}
            disabled={loading || refreshing}
            className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh active session and entries from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-600' : 'text-slate-500'}`} />
            <span>{refreshing ? 'Syncing...' : 'Sync Data'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Today's Logged Hours */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Today
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {formatDurationMinutes(data?.stats.todayMinutes || 0)}
                </span>
                <p className="text-[11px] text-emerald-600 font-medium mt-0.5">
                  ${(data?.stats.todayEarnings || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} earned
                </p>
              </>
            )}
          </div>
        </div>

        {/* This Week's Hours */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              This Week
            </span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Calendar className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {formatDurationMinutes(data?.stats.thisWeekMinutes || 0)}
                </span>
                <p className="text-[11px] text-blue-600 font-medium mt-0.5">
                  ${(data?.stats.thisWeekEarnings || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} earned
                </p>
              </>
            )}
          </div>
        </div>

        {/* Active Hourly Contracts */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Active Contracts
            </span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            {loading ? (
              <div className="h-7 w-10 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {data?.eligibleContracts.length || 0}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">Hourly eligible</p>
              </>
            )}
          </div>
        </div>

        {/* All-Time Logged Hours */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Total Logged
            </span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            {loading ? (
              <div className="h-7 w-14 bg-slate-100 animate-pulse rounded" />
            ) : (
              <>
                <span className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {data?.stats.totalHoursAllTime || 0} hrs
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">Verified work diary</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Live Timer Console (Left/Center) + Active Contract Details (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left: Stopwatch & Timer Console (2 Cols) */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm overflow-hidden relative">
            {/* Active Status Banner */}
            <div className="flex items-center justify-between pb-6 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-3.5 h-3.5 rounded-full ${
                    isTimerRunning ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'
                  }`}
                />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {isTimerRunning ? 'Timer Active & Logging' : 'Timer Idle'}
                </span>
              </div>

              {isTimerRunning && data?.activeSession && (
                <div className="text-right">
                  <span className="text-xs text-slate-500">Started at: </span>
                  <span className="text-xs font-semibold text-slate-800">
                    {new Date(data.activeSession.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              )}
            </div>

            {/* Stopwatch Hero Display */}
            <div className="py-8 sm:py-10 text-center">
              <div className="font-mono text-5xl sm:text-7xl font-extrabold tracking-tight text-slate-900 select-all">
                {formatTimeHHMMSS(elapsedSeconds)}
              </div>
              <p className="text-xs text-slate-400 font-medium mt-2">
                {isTimerRunning
                  ? 'Elapsed time calculated from trusted database clock'
                  : 'Select an active hourly project below and describe your task'}
              </p>
            </div>

            {/* Controls Form */}
            <form onSubmit={handleStartTimer} className="space-y-5 pt-4 border-t border-slate-100">
              {/* Contract Selector */}
              <div>
                <label htmlFor="contract-selector" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Hourly Project
                </label>
                {data && data.eligibleContracts.length === 0 ? (
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">No active hourly contracts found</p>
                      <p className="text-amber-700 mt-0.5">
                        Time tracking is only available on accepted hourly projects. Fixed-price contracts do not use hourly timers.
                      </p>
                    </div>
                  </div>
                ) : (
                  <select
                    id="contract-selector"
                    value={selectedContractId}
                    onChange={(e) => setSelectedContractId(e.target.value)}
                    disabled={isTimerRunning || isStarting || loading}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-500 cursor-pointer"
                  >
                    {data?.eligibleContracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} — ${c.hourlyRate}/hr (Max {c.weeklyHourLimit || 40}h/wk)
                        {c.companyName ? ` • ${c.companyName}` : c.clientName ? ` • ${c.clientName}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {contractError && <p className="text-xs text-rose-600 font-medium mt-1">{contractError}</p>}
              </div>

              {/* Work Memo Input */}
              <div>
                <label htmlFor="work-memo" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Task Memo <span className="text-rose-500">*</span>
                </label>
                <input
                  id="work-memo"
                  type="text"
                  placeholder="e.g. Architecting real-time streaming charts and state machine"
                  value={workMemo}
                  onChange={(e) => {
                    setWorkMemo(e.target.value);
                    if (memoError) setMemoError(null);
                  }}
                  disabled={isStarting || isStopping || loading}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
                />
                {memoError && <p className="text-xs text-rose-600 font-medium mt-1">{memoError}</p>}
                <p className="text-[11px] text-slate-400 mt-1">
                  Required memo describing your work. Memos will appear in your client&apos;s weekly timesheet.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                {!isTimerRunning ? (
                  <button
                    type="submit"
                    disabled={isStarting || loading || (data?.eligibleContracts.length ?? 0) === 0}
                    className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 text-white font-bold text-sm sm:text-base hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isStarting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Starting Timer Session...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span>Start Tracking Time</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button
                      type="button"
                      onClick={handleStopTimer}
                      disabled={isStopping || isDiscarding}
                      className="w-full sm:flex-1 py-3.5 px-6 rounded-2xl bg-rose-600 text-white font-bold text-sm sm:text-base hover:bg-rose-700 transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
                    >
                      {isStopping ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Saving Time Entry...</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-4 h-4 fill-current" />
                          <span>Stop & Save Time</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDiscardTimer}
                      disabled={isStopping || isDiscarding}
                      className="w-full sm:w-auto py-3.5 px-4 rounded-2xl border border-slate-300 text-slate-600 hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Discard session without recording time"
                    >
                      {isDiscarding ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      <span>Discard</span>
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Recent Completed Work Sessions */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <h2 className="text-base font-bold text-slate-900">Recent Completed Time Entries</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  {data?.recentEntries.length || 0}
                </span>
              </div>
            </div>

            {loading ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Loading work sessions from database...</p>
              </div>
            ) : !data || data.recentEntries.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">No Time Logged Yet</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Select your hourly contract above and start the timer to log work sessions directly to your client timesheet.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.recentEntries.map((entry) => {
                  const startDate = new Date(entry.startTime);
                  const endDate = new Date(entry.endTime);

                  return (
                    <div key={entry.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                        <span className="font-bold text-sm text-slate-900">
                          {entry.contractTitle || 'Hourly Project'}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {formatDurationMinutes(entry.durationMinutes)}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">
                            {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                        {entry.memo}
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span>•</span>
                          <span className="text-emerald-700 font-semibold uppercase tracking-wider text-[10px]">
                            Automatic Timer Session
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Selected Contract Terms & Upwork Policy (1 Col) */}
        <div className="space-y-6">
          {/* Selected Contract Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Briefcase className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Contract Specifications</h3>
            </div>

            {activeContract ? (
              <div className="space-y-3.5">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Project Title</span>
                  <p className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">{activeContract.title}</p>
                </div>

                {activeContract.companyName ? (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Employer Company</span>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 mt-0.5">
                      <Building className="w-3.5 h-3.5 text-slate-400" />
                      <span>{activeContract.companyName}</span>
                    </p>
                  </div>
                ) : activeContract.clientName ? (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Client</span>
                    <p className="text-xs font-semibold text-slate-800 mt-0.5">{activeContract.clientName}</p>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Hourly Rate</span>
                    <p className="text-base font-extrabold text-slate-900 mt-0.5">
                      ${activeContract.hourlyRate}/hr
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Weekly Cap</span>
                    <p className="text-base font-extrabold text-slate-900 mt-0.5">
                      {activeContract.weeklyHourLimit || 40} hrs/wk
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href={`/jobs/${activeContract.jobId}`}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    <span>View Original Project Posting</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No contract selected. Choose an active project to view rate and weekly limits.
              </p>
            )}
          </div>

          {/* Time Tracking Guidelines Card */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Time Tracking Rules</h3>
            </div>
            <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>
                  <strong>Server Timestamps:</strong> Elapsed duration is calculated securely by PostgreSQL using trusted server clocks.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>
                  <strong>1-Minute Minimum:</strong> Sessions stopped under 60 seconds are discarded without billing.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>
                  <strong>Single Active Timer:</strong> Only one timer session can run at a time across your account.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                <span>
                  <strong>Weekly Timesheets:</strong> Billing cycles start on Monday 00:00 UTC and roll up automatically.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
