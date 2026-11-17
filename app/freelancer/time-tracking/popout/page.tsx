'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  XCircle,
  ExternalLink,
  Shield,
} from 'lucide-react';
import ScreenTrackerWidget from '@/components/contracts/screen-tracker-widget';

function PopoutTrackerContent() {
  const searchParams = useSearchParams();
  const urlContractId = searchParams.get('contractId') || '';

  const [data, setData] = useState<FreelancerTimeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState<string>(urlContractId);
  const [workMemo, setWorkMemo] = useState<string>('');
  const [memoError, setMemoError] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live timer elapsed seconds
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 4500);
  }, []);

  // Broadcast sync to other tabs/windows
  const broadcastSync = (type: string) => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const ch = new BroadcastChannel('workspace_time_tracker_sync');
        ch.postMessage({ type });
        ch.close();
      }
    } catch {
      // Non-fatal
    }
  };

  // 1. Initial Data Fetch
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await getFreelancerTimeTrackingData();
        if (!isMounted) return;
        if (res.success) {
          setData(res);
          if (res.activeSession?.contractId) {
            setSelectedContractId(res.activeSession.contractId);
            if (res.activeSession.memo) {
              setWorkMemo(res.activeSession.memo);
            }
          } else if (urlContractId) {
            setSelectedContractId(urlContractId);
          } else if (res.eligibleContracts.length > 0) {
            setSelectedContractId((prev) => prev || res.eligibleContracts[0].id);
          }
        } else {
          showError(res.error || 'Failed to load tracker.');
        }
      } catch {
        if (isMounted) showError('Unable to connect to database.');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [showError, urlContractId]);

  const refreshTrackerData = useCallback(async () => {
    try {
      const res = await getFreelancerTimeTrackingData();
      if (res.success) {
        setData(res);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Listen to cross-window sync
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('workspace_time_tracker_sync');
    ch.onmessage = (event) => {
      if (
        event.data?.type === 'SYNC_STATE' ||
        event.data?.type === 'TIMER_STARTED' ||
        event.data?.type === 'TIMER_STOPPED' ||
        event.data?.type === 'SLOT_RECORDED'
      ) {
        refreshTrackerData();
      }
    };
    return () => ch.close();
  }, [refreshTrackerData]);

  // 2. Live Stopwatch Engine
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

    return () => {
      clearTimeout(timerId);
      clearInterval(interval);
    };
  }, [data?.activeSession?.startTime]);

  const isTimerRunning = Boolean(data?.activeSession?.startTime);
  const displaySeconds = isTimerRunning ? elapsedSeconds : 0;

  const activeContract: Contract | undefined = useMemo(() => {
    if (data?.activeSession?.contract) return data.activeSession.contract;
    return data?.eligibleContracts.find((c) => c.id === selectedContractId);
  }, [data?.activeSession, data?.eligibleContracts, selectedContractId]);

  const formatTimeHHMMSS = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // 3. Start Timer
  const handleStartTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemoError(null);
    setContractError(null);

    if (!selectedContractId) {
      setContractError('Please select an active contract.');
      return;
    }

    const trimmedMemo = workMemo.trim();
    if (!trimmedMemo) {
      setMemoError('Task memo is required.');
      return;
    }

    setIsStarting(true);
    try {
      const res = await startTimerSession(selectedContractId, trimmedMemo);
      if (res.success && res.session) {
        showToast('Timer started.');
        broadcastSync('TIMER_STARTED');
        await refreshTrackerData();
      } else {
        showError(res.error || 'Failed to start timer.');
      }
    } catch {
      showError('Network error starting timer.');
    } finally {
      setIsStarting(false);
    }
  };

  // 4. Stop Timer
  const handleStopTimer = async () => {
    setIsStopping(true);
    try {
      const res = await stopTimerSession(workMemo);
      if (res.success) {
        if (res.entry) {
          showToast(`Saved ${res.entry.durationMinutes}m to timesheet!`);
        } else {
          showToast('Session under 1m discarded.');
        }
        setWorkMemo('');
        broadcastSync('TIMER_STOPPED');
        await refreshTrackerData();
      } else {
        showError(res.error || 'Failed to stop timer.');
      }
    } catch {
      showError('Network error stopping timer.');
      await refreshTrackerData();
    } finally {
      setIsStopping(false);
    }
  };

  // 5. Discard Timer
  const handleDiscardTimer = async () => {
    if (!window.confirm('Discard active session without logging billable time?')) {
      return;
    }

    setIsDiscarding(true);
    try {
      const res = await discardTimerSession();
      if (res.success) {
        showToast('Session discarded.');
        setWorkMemo('');
        broadcastSync('TIMER_STOPPED');
        await refreshTrackerData();
      } else {
        showError(res.error || 'Failed to discard session.');
      }
    } catch {
      showError('Network error discarding session.');
    } finally {
      setIsDiscarding(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans flex flex-col justify-between selection:bg-emerald-500 selection:text-white">
      {/* Toast & Error Banners */}
      {toastMessage && (
        <div className="bg-emerald-600 text-white px-3 py-2 text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-md animate-in slide-in-from-top duration-150">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{toastMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="bg-rose-600 text-white px-3 py-2 text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-md animate-in slide-in-from-top duration-150">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-xs">
              W
            </div>
            <div>
              <span className="text-xs font-black tracking-wide text-white block">
                Upwork Time Tracker
              </span>
              <span className="text-[10px] text-slate-400 block -mt-0.5">
                Floating Desktop Window
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isTimerRunning ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
              }`}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              {isTimerRunning ? 'Active' : 'Standby'}
            </span>
          </div>
        </div>

        {/* Hero Digital Clock */}
        <div className="py-4 px-3 rounded-2xl bg-slate-950 border border-slate-800 text-center relative overflow-hidden">
          <div
            className={`font-mono text-4xl sm:text-5xl font-black tracking-tight select-all transition-colors ${
              isTimerRunning
                ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                : 'text-slate-400'
            }`}
          >
            {formatTimeHHMMSS(displaySeconds)}
          </div>

          {isTimerRunning && activeContract ? (
            <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                +${((elapsedSeconds / 3600) * (activeContract.hourlyRate || 0)).toFixed(2)}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                (${activeContract.hourlyRate}/hr)
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 mt-1">
              Select project and enter task memo to start
            </p>
          )}
        </div>

        {/* Timer Control Form */}
        <form onSubmit={handleStartTimer} className="space-y-3">
          {/* Project Dropdown */}
          <div>
            <label
              htmlFor="popout-contract"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1"
            >
              Hourly Project
            </label>
            {data && data.eligibleContracts.length === 0 ? (
              <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900/50 p-2 rounded-xl">
                No active hourly contracts found.
              </p>
            ) : (
              <select
                id="popout-contract"
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                disabled={isTimerRunning || isStarting || loading}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 text-xs font-semibold text-slate-100 bg-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 cursor-pointer"
              >
                {data?.eligibleContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} (${c.hourlyRate}/hr)
                  </option>
                ))}
              </select>
            )}
            {contractError && (
              <p className="text-[11px] text-rose-400 font-medium mt-1">{contractError}</p>
            )}
          </div>

          {/* Task Memo Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="popout-memo"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Task Memo <span className="text-rose-400">*</span>
              </label>
              <span className="text-[9px] text-slate-500">Upwork Work Diary</span>
            </div>
            <input
              id="popout-memo"
              type="text"
              placeholder="e.g. Developing authentication & API hooks"
              value={workMemo}
              onChange={(e) => {
                setWorkMemo(e.target.value);
                if (memoError) setMemoError(null);
              }}
              disabled={isStarting || isStopping || loading}
              className="w-full px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-100 bg-slate-800 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            />
            {memoError && (
              <p className="text-[11px] text-rose-400 font-medium mt-1">{memoError}</p>
            )}

            {/* Quick Chips */}
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {[
                'Feature coding',
                'Bug fixing',
                'Refactoring',
                'Database work',
                'Code review',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setWorkMemo(chip);
                    if (memoError) setMemoError(null);
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] font-medium transition cursor-pointer border border-slate-700/60"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-1">
            {!isTimerRunning ? (
              <button
                type="submit"
                disabled={isStarting || loading || (data?.eligibleContracts.length ?? 0) === 0}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isStarting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Tracking Time</span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStopTimer}
                  disabled={isStopping || isDiscarding}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {isStopping ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Time...</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop & Save Time</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDiscardTimer}
                  disabled={isStopping || isDiscarding}
                  className="py-2.5 px-3 rounded-xl border border-slate-700 hover:bg-rose-950/40 hover:border-rose-800 text-slate-300 hover:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
                  title="Discard session without recording billable time"
                >
                  {isDiscarding ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        </form>

        {/* Upwork Automated Screen Tracker Widget */}
        {selectedContractId && (
          <div className="pt-2">
            <ScreenTrackerWidget
              contractId={selectedContractId}
              isTimerRunning={isTimerRunning}
              workMemo={workMemo}
              compact={true}
              onSlotRecorded={() => {
                broadcastSync('SLOT_RECORDED');
                refreshTrackerData();
              }}
              onToast={showToast}
              onError={showError}
            />
          </div>
        )}
      </div>

      {/* Footer Info Strip */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-emerald-400" />
          <span>Continuous tracking active</span>
        </span>
        <button
          type="button"
          onClick={() => {
            if (window.opener) {
              window.opener.focus();
            } else {
              window.open('/freelancer/time-tracking', '_blank');
            }
          }}
          className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
        >
          <span>Dashboard</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

export default function PopoutTrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white text-xs">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400 mr-2" />
          <span>Loading Upwork Tracker Widget...</span>
        </div>
      }
    >
      <PopoutTrackerContent />
    </Suspense>
  );
}
