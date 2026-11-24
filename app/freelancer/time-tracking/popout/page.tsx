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
  ShieldCheck,
  Pencil,
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

  // 3. Start Timer (Slide to ON)
  const handleStartTimer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
        showToast('Tracking started!');
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

  // 4. Stop Timer (Slide to OFF)
  const handleStopTimer = async () => {
    setIsStopping(true);
    try {
      const res = await stopTimerSession(workMemo);
      if (res.success) {
        if (res.entry) {
          showToast(`Logged ${res.entry.durationMinutes}m to timesheet!`);
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

  const todayHours = Number(((data?.stats?.todayMinutes || 0) / 60).toFixed(1));
  const thisWeekHours = Number(((data?.stats?.thisWeekMinutes || 0) / 60).toFixed(1));
  const weeklyLimit = activeContract?.weeklyHourLimit || 40;
  const weeklyProgress = Math.min(100, (thisWeekHours / weeklyLimit) * 100);

  return (
    <div className="min-h-screen bg-slate-100/90 flex flex-col items-center justify-center p-0 sm:p-4 text-slate-800 font-sans selection:bg-[#14a800] selection:text-white">
      {/* Toast & Error Banners */}
      {toastMessage && (
        <div className="fixed top-2 z-50 max-w-sm bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="fixed top-2 z-50 max-w-sm bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Upwork Desktop App Window Card */}
      <div className="w-full max-w-[390px] bg-white sm:rounded-2xl shadow-xl border border-slate-200/90 overflow-hidden flex flex-col justify-between my-auto">
        {/* Top Window Titlebar (macOS Native Upwork Style) */}
        <div className="px-3.5 py-2.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 select-none">
          {/* macOS window dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            <div className="flex items-center gap-1.5 ml-2">
              <span className="w-4 h-4 rounded bg-[#14a800] text-white flex items-center justify-center text-[10px] font-black">
                W
              </span>
              <span className="text-xs font-bold tracking-tight text-white">
                Time Tracker
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                isTimerRunning
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isTimerRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span>{isTimerRunning ? 'ON' : 'OFF'}</span>
            </span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto">
          {/* 1. Contract Header Card */}
          <div className="p-3 bg-slate-50/90 border-b border-slate-200/70 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-500">Hourly Project</span>
              {activeContract && (
                <span className="font-bold text-slate-900 font-mono">
                  ${activeContract.hourlyRate}/hr
                </span>
              )}
            </div>

            {data && data.eligibleContracts.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-lg">
                No active hourly contracts found.
              </p>
            ) : (
              <select
                id="popout-contract"
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                disabled={isTimerRunning || isStarting || loading}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-900 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#14a800] truncate disabled:opacity-60 cursor-pointer shadow-2xs"
              >
                {data?.eligibleContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} (${c.hourlyRate}/hr)
                  </option>
                ))}
              </select>
            )}

            {contractError && (
              <p className="text-[11px] text-rose-500 font-medium">{contractError}</p>
            )}

            {activeContract && (
              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                <span className="truncate max-w-[190px]">Client: {activeContract.companyName || activeContract.clientName || 'Client'}</span>
                <span>Limit: {activeContract.weeklyHourLimit || 40} hrs/wk</span>
              </div>
            )}
          </div>

          {/* 2. THE ICONIC UPWORK BIG SLIDING SWITCH & TIMER SECTION */}
          <div className="p-4 bg-white border-b border-slate-100 space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              {/* Upwork Signature Sliding Switch Button */}
              <button
                type="button"
                onClick={isTimerRunning ? handleStopTimer : () => handleStartTimer()}
                disabled={isStarting || isStopping || loading || (data?.eligibleContracts.length ?? 0) === 0}
                className={`relative w-24 h-11 rounded-full transition-colors flex items-center px-1 shadow-inner cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#14a800]/50 ${
                  isTimerRunning ? 'bg-[#14a800]' : 'bg-slate-300 hover:bg-slate-400'
                } disabled:opacity-50`}
                title={isTimerRunning ? 'Click to Stop Tracking Time' : 'Click to Start Tracking Time'}
              >
                {/* Sliding knob */}
                <div
                  className={`w-9 h-9 rounded-full bg-white shadow-md transform transition-transform flex items-center justify-center font-black text-xs ${
                    isTimerRunning ? 'translate-x-13 text-[#14a800]' : 'translate-x-0 text-slate-500'
                  }`}
                >
                  {isStarting || isStopping ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-600" />
                  ) : isTimerRunning ? (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </div>

                {/* Text inside switch */}
                <span
                  className={`absolute font-black text-xs tracking-wider uppercase select-none transition-opacity ${
                    isTimerRunning ? 'left-3 text-white' : 'right-3 text-slate-600'
                  }`}
                >
                  {isTimerRunning ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Digital Clock & Earnings */}
              <div className="text-right flex-1 min-w-0">
                <div
                  className={`font-mono text-3xl font-black tracking-tight leading-none ${
                    isTimerRunning ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {formatTimeHHMMSS(displaySeconds)}
                </div>
                {isTimerRunning && activeContract ? (
                  <div className="flex items-center justify-end gap-1.5 mt-1">
                    <span className="text-xs font-black text-emerald-600 font-mono">
                      +${((elapsedSeconds / 3600) * (activeContract.hourlyRate || 0)).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">earned</span>
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Session duration
                  </span>
                )}
              </div>
            </div>

            {/* Upwork Hours Summary Card (Today & This Week) */}
            <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-200/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-500 font-medium">Today:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {todayHours.toFixed(1)} hrs
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-500 font-medium">This week:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {thisWeekHours.toFixed(1)} of {weeklyLimit} hrs
                </span>
              </div>
              {/* Weekly Cap Progress Bar */}
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full bg-[#14a800] rounded-full transition-all duration-300"
                  style={{ width: `${weeklyProgress}%` }}
                />
              </div>
            </div>
          </div>

          {/* 3. Task Memo Section ("What are you working on?") */}
          <div className="p-4 bg-white border-b border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="popout-memo"
                className="text-xs font-bold text-slate-700 flex items-center gap-1"
              >
                <Pencil className="w-3 h-3 text-slate-400" />
                <span>Memo</span>
                <span className="text-rose-500">*</span>
              </label>
              <span className="text-[10px] text-slate-400">Work Diary</span>
            </div>

            <div className="relative">
              <input
                id="popout-memo"
                type="text"
                placeholder="What are you working on?"
                value={workMemo}
                onChange={(e) => {
                  setWorkMemo(e.target.value);
                  if (memoError) setMemoError(null);
                }}
                disabled={isStarting || isStopping || loading}
                className="w-full px-3 py-2 bg-slate-50 focus:bg-white rounded-xl border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#14a800] transition-colors"
              />
            </div>
            {memoError && (
              <p className="text-[11px] text-rose-500 font-medium">{memoError}</p>
            )}

            {/* Quick Chips */}
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              {[
                'Feature coding',
                'Bug fixing',
                'Refactoring',
                'API endpoints',
                'Code review',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setWorkMemo(chip);
                    if (memoError) setMemoError(null);
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium transition cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Discard Session Action (if timer is active) */}
            {isTimerRunning && (
              <div className="pt-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleDiscardTimer}
                  disabled={isStopping || isDiscarding}
                  className="text-[11px] text-rose-600 hover:text-rose-800 hover:underline flex items-center gap-1 font-semibold cursor-pointer disabled:opacity-50"
                  title="Discard active timer session without billing"
                >
                  {isDiscarding ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  <span>Discard current session</span>
                </button>
              </div>
            )}
          </div>

          {/* 4. Upwork Automated Screen Tracker Widget (Compact Card) */}
          {selectedContractId && (
            <div className="p-3 bg-slate-50/60">
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
        <div className="px-3.5 py-2.5 bg-slate-50 border-t border-slate-200/80 text-[11px] text-slate-500 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-600 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-[#14a800]" />
            <span>Hourly Protection</span>
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
            className="text-[#14a800] hover:underline flex items-center gap-1 font-bold cursor-pointer"
          >
            <span>Full Diary</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PopoutTrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-slate-600 text-xs">
          <RefreshCw className="w-4 h-4 animate-spin text-[#14a800] mr-2" />
          <span>Loading Upwork Time Tracker...</span>
        </div>
      }
    >
      <PopoutTrackerContent />
    </Suspense>
  );
}
