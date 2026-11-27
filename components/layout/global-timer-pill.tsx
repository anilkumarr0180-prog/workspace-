'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import NextLink from 'next/link';
import { Square, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  getActiveTimerSession,
  stopTimerSession,
} from '@/lib/actions/time-tracking';
import {
  computeElapsedSeconds,
  classifyStopTimerResult,
} from '@/lib/time-tracking-feedback';
import {
  TRACKER_SYNC_CHANNEL,
  postTrackerSyncEvent,
  parseTrackerSyncEvent,
  createEventDeduplicator,
} from '@/lib/tracker-broadcast';
import type { ActiveTimerSession } from '@/lib/types';

type ActiveSessionWithTitle = ActiveTimerSession & { contractTitle?: string };

interface GlobalTimerPillProps {
  userId?: string | null;
  isFreelancer: boolean;
}

function formatHHMMSS(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function GlobalTimerPill({
  userId,
  isFreelancer,
}: GlobalTimerPillProps) {
  const [session, setSession] = useState<ActiveSessionWithTitle | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const fetchInFlightRef = useRef<boolean>(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((message: string, isError: boolean) => {
    setFeedback({ message, isError });
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, 4500);
  }, []);

  const refreshActiveSession = useCallback(async () => {
    if (!userId || !isFreelancer || fetchInFlightRef.current) {
      return;
    }

    fetchInFlightRef.current = true;
    try {
      const res = await getActiveTimerSession();
      if (res.success) {
        const nextSession = res.session ?? null;
        setSession(nextSession);
        if (nextSession?.startTime) {
          setElapsedSeconds(computeElapsedSeconds(nextSession.startTime));
        }
      }
    } catch {
      // Non-fatal: keep existing view until next recovery
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [userId, isFreelancer]);

  // 1. Initial load & cleanup on role/user change
  useEffect(() => {
    if (!userId || !isFreelancer) {
      return;
    }

    let isMounted = true;
    (async () => {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      try {
        const res = await getActiveTimerSession();
        if (isMounted && res.success) {
          const nextSession = res.session ?? null;
          setSession(nextSession);
          if (nextSession?.startTime) {
            setElapsedSeconds(computeElapsedSeconds(nextSession.startTime));
          }
        }
      } catch {
        // Non-fatal
      } finally {
        fetchInFlightRef.current = false;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userId, isFreelancer]);

  // 2. Local 1-second visual clock derived strictly from server startTime
  useEffect(() => {
    if (!userId || !isFreelancer || !session?.startTime) {
      return;
    }

    const startIso = session.startTime;
    const tick = () => {
      setElapsedSeconds(computeElapsedSeconds(startIso));
    };

    const initTimer = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [userId, isFreelancer, session?.startTime]);

  // 3. Cross-tab BroadcastChannel sync + visibility recovery
  useEffect(() => {
    if (!userId || !isFreelancer) {
      return;
    }

    let channel: BroadcastChannel | null = null;
    const isNewEvent = createEventDeduplicator();
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        channel = new BroadcastChannel(TRACKER_SYNC_CHANNEL);
        channel.onmessage = (rawEvent: MessageEvent<unknown>) => {
          const parsed = parseTrackerSyncEvent(rawEvent.data);
          if (!parsed || !isNewEvent(parsed.eventId)) return;

          if (
            parsed.type !== 'TIMER_STARTED' &&
            parsed.type !== 'TIMER_STOPPED' &&
            parsed.type !== 'TIMER_DISCARDED'
          ) {
            return;
          }

          refreshActiveSession();
        };
      }
    } catch {
      // Non-fatal
    }

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        refreshActiveSession();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      channel?.close();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [userId, isFreelancer, refreshActiveSession]);

  const broadcastStopped = useCallback(() => {
    postTrackerSyncEvent('TIMER_STOPPED', {
      freelancerId: userId || undefined,
      contractId: session?.contractId,
    });
  }, [session?.contractId, userId]);

  const handleStopClick = async () => {
    if (!session || isStopping) return;

    const currentElapsed = computeElapsedSeconds(session.startTime);
    setIsStopping(true);
    try {
      const res = await stopTimerSession(session.memo);
      const result = classifyStopTimerResult({
        res,
        elapsedSeconds: currentElapsed,
        weekMinutesLogged: 0,
        weeklyLimitHours: 0,
      });
      showFeedback(result.message, result.isError);

      if (res.success || res.code === 'NO_ACTIVE_SESSION') {
        setSession(null);
        broadcastStopped();
        await refreshActiveSession();
      }
    } catch {
      showFeedback('Network error stopping timer.', true);
      await refreshActiveSession();
    } finally {
      setIsStopping(false);
    }
  };

  if (!userId || !isFreelancer) {
    return null;
  }

  return (
    <>
      {session && (
        <div
          data-testid="global-active-timer"
          className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-full bg-emerald-50 border border-emerald-300/90 text-emerald-950 shadow-2xs shrink-0 max-w-[260px] xl:max-w-[320px]"
        >
          <NextLink
            href={`/freelancer/time-tracking?contractId=${encodeURIComponent(session.contractId)}`}
            className="flex items-center gap-1.5 min-w-0 hover:opacity-85 transition-opacity"
            title={`Active timer: ${session.contractTitle || 'Hourly Contract'} — Click to view tracker`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
            </span>
            <span className="font-mono text-xs font-extrabold text-emerald-800 tabular-nums shrink-0">
              {formatHHMMSS(elapsedSeconds)}
            </span>
            {session.contractTitle && (
              <span className="hidden lg:inline text-[11px] font-semibold text-slate-700 truncate">
                • {session.contractTitle}
              </span>
            )}
          </NextLink>

          <button
            type="button"
            onClick={handleStopClick}
            disabled={isStopping}
            data-testid="global-timer-stop-btn"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            title="Stop & save current billing session"
          >
            {isStopping ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Square className="w-2.5 h-2.5 fill-current" />
            )}
            <span className="hidden sm:inline">{isStopping ? 'Saving' : 'Stop'}</span>
          </button>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 ${
            feedback.isError
              ? 'bg-rose-900 text-white'
              : 'bg-slate-900 text-white'
          }`}
        >
          {feedback.isError ? (
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}
    </>
  );
}
