'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  RefreshCw,
  ShieldCheck,
  PauseCircle,
  Play,
  Zap,
} from 'lucide-react';
import {
  uploadWorkDiaryScreenshot,
  recordWorkDiaryScreenshotSlot,
} from '@/lib/actions/time-tracking';
import { WorkDiarySlot } from '@/lib/types';

interface ScreenTrackerWidgetProps {
  contractId: string;
  isTimerRunning: boolean;
  workMemo: string;
  onSlotRecorded?: (slot: WorkDiarySlot) => void;
  onToast?: (message: string) => void;
  onError?: (message: string) => void;
}

export default function ScreenTrackerWidget({
  contractId,
  isTimerRunning,
  workMemo,
  onSlotRecorded,
  onToast,
  onError,
}: ScreenTrackerWidgetProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<Date | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastThumbnailUrl, setLastThumbnailUrl] = useState<string | null>(null);
  const [isProcessingSnapshot, setIsProcessingSnapshot] = useState(false);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState<number>(300);

  // References for live stream, canvas, and activity counters
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scheduledTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const targetCaptureTimeRef = useRef<number>(0);
  const scheduleNextSnapshotRef = useRef<(() => void) | null>(null);

  // Activity tracking counters
  const keystrokesRef = useRef<number>(0);
  const mouseClicksRef = useRef<number>(0);
  const mouseMoveEventsRef = useRef<number>(0);
  const activeMinutesBitmaskRef = useRef<boolean[]>(new Array(10).fill(false));
  const currentMinuteSliceRef = useRef<number>(0);

  // 1. Activity listeners (Keystrokes, Clicks, Mouse Movement)
  useEffect(() => {
    if (!isCapturing || !isTimerRunning) return;

    const handleKeyDown = () => {
      keystrokesRef.current += 1;
      activeMinutesBitmaskRef.current[currentMinuteSliceRef.current] = true;
    };

    const handleMouseDown = () => {
      mouseClicksRef.current += 1;
      activeMinutesBitmaskRef.current[currentMinuteSliceRef.current] = true;
    };

    const handleMouseMove = () => {
      mouseMoveEventsRef.current += 1;
      activeMinutesBitmaskRef.current[currentMinuteSliceRef.current] = true;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);

    // Track active minutes across a 10-minute window
    const minuteTick = setInterval(() => {
      currentMinuteSliceRef.current = (currentMinuteSliceRef.current + 1) % 10;
    }, 60000);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      clearInterval(minuteTick);
    };
  }, [isCapturing, isTimerRunning]);

  // 2. Take Snapshot from Live Media Stream
  const captureScreenshotBlob = useCallback(async (): Promise<Blob | null> => {
    const stream = mediaStreamRef.current;
    if (!stream) return null;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      return null;
    }

    try {
      // Create offscreen video element to capture the frame
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve()).catch(reject);
        };
        setTimeout(() => reject(new Error('Video stream timeout')), 3000);
      });

      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;

      // Draw onto offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, width, height);

      // Clean up video stream attachment
      video.pause();
      video.srcObject = null;

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          0.82 // 82% quality yields ~120-250KB per screenshot
        );
      });
    } catch {
      return null;
    }
  }, []);

  // 3. Perform snapshot upload and database insertion
  const triggerSnapshot = useCallback(
    async (isManualTrigger = false) => {
      if (!mediaStreamRef.current || isProcessingSnapshot) return;

      setIsProcessingSnapshot(true);
      try {
        const imageBlob = await captureScreenshotBlob();
        if (!imageBlob) {
          throw new Error('Failed to capture frame from active screen sharing stream.');
        }

        // Calculate Upwork 0-10 Activity Score:
        // Active minutes in window (0-10) combined with input intensity
        const activeMinutesCount = activeMinutesBitmaskRef.current.filter(Boolean).length;
        const totalInputs = keystrokesRef.current + mouseClicksRef.current;
        let score = Math.max(activeMinutesCount, Math.min(10, Math.ceil(totalInputs / 40)));
        if (score === 0 && totalInputs > 0) score = 1;
        if (score > 10) score = 10;
        // Default to a healthy 7-9 if actively developing with inputs
        if (score < 6 && totalInputs > 15) score = 7;

        // Upload screenshot image to Supabase Storage
        const formData = new FormData();
        formData.append('file', imageBlob, `snapshot-${Date.now()}.jpg`);
        formData.append('contractId', contractId);

        const uploadRes = await uploadWorkDiaryScreenshot(formData);
        if (!uploadRes.success || !uploadRes.url) {
          throw new Error(uploadRes.error || 'Failed to upload screenshot to storage.');
        }

        // Record work diary slot in PostgreSQL
        const slotRes = await recordWorkDiaryScreenshotSlot({
          contractId,
          slotTime: new Date().toISOString(),
          durationMinutes: 10,
          activityScore: score,
          keystrokesCount: keystrokesRef.current,
          mouseClicksCount: mouseClicksRef.current,
          memo: workMemo || 'Working on hourly contract deliverables',
          screenshotUrl: uploadRes.url,
        });

        if (!slotRes.success || !slotRes.slot) {
          throw new Error(slotRes.error || 'Failed to save work diary activity segment.');
        }

        const now = new Date();
        setLastCaptureTime(now);
        setLastScore(score);
        setLastThumbnailUrl(uploadRes.url);

        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        onToast?.(
          isManualTrigger
            ? `Verified snapshot captured at ${timeStr} (Activity: ${score}/10)`
            : `Upwork snapshot captured at ${timeStr} (Activity: ${score}/10)`
        );

        onSlotRecorded?.(slotRes.slot);

        // Reset activity accumulators for next interval
        keystrokesRef.current = 0;
        mouseClicksRef.current = 0;
        mouseMoveEventsRef.current = 0;
        activeMinutesBitmaskRef.current = new Array(10).fill(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error taking work diary snapshot';
        onError?.(msg);
      } finally {
        setIsProcessingSnapshot(false);
      }
    },
    [
      captureScreenshotBlob,
      contractId,
      isProcessingSnapshot,
      onError,
      onSlotRecorded,
      onToast,
      workMemo,
    ]
  );

  // 4. Schedule next random snapshot in 5-10 minute window (Upwork standard)
  const scheduleNextSnapshot = useCallback(() => {
    if (scheduledTimerRef.current) clearTimeout(scheduledTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    // Upwork randomly takes a snapshot every 5 to 10 minutes (300 to 600 seconds)
    const minSeconds = 300; // 5 minutes
    const maxSeconds = 600; // 10 minutes
    const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

    targetCaptureTimeRef.current = Date.now() + randomSeconds * 1000;
    setSecondsUntilNextCheck(randomSeconds);

    countdownIntervalRef.current = setInterval(() => {
      const remainingMs = targetCaptureTimeRef.current - Date.now();
      const remSec = Math.max(0, Math.floor(remainingMs / 1000));
      setSecondsUntilNextCheck(remSec);
    }, 1000);

    scheduledTimerRef.current = setTimeout(async () => {
      await triggerSnapshot(false);
      scheduleNextSnapshotRef.current?.();
    }, randomSeconds * 1000);
  }, [triggerSnapshot]);

  useEffect(() => {
    scheduleNextSnapshotRef.current = scheduleNextSnapshot;
  }, [scheduleNextSnapshot]);

  // 5. Start Screen Capture (User Permission Prompt)
  const handleStartCapture = async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen capture is not supported by this browser. Use Chrome, Firefox, or Edge.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: false,
      });

      mediaStreamRef.current = stream;
      setIsCapturing(true);

      // Handle user manually clicking "Stop sharing" in the browser overlay
      stream.getVideoTracks()[0].onended = () => {
        handleStopCapture();
        onToast?.('Screen capture stopped. Re-enable to resume automatic snapshots.');
      };

      onToast?.('Screen capture active. Screenshots will be recorded every 5–10 minutes.');

      // Start the randomized capture cycle
      scheduleNextSnapshot();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Screen capture permission denied.';
      onError?.(msg);
      setIsCapturing(false);
    }
  };

  // 6. Stop Screen Capture
  const handleStopCapture = useCallback(() => {
    if (scheduledTimerRef.current) {
      clearTimeout(scheduledTimerRef.current);
      scheduledTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  // Stop capture when timer session stops
  useEffect(() => {
    if (!isTimerRunning && isCapturing) {
      handleStopCapture();
    }
  }, [isTimerRunning, isCapturing, handleStopCapture]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      handleStopCapture();
    };
  }, [handleStopCapture]);

  const formatCountdown = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isCapturing ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
            }`}
          />
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-emerald-600" />
            <span>Upwork Automated Screen Tracker</span>
          </h3>
        </div>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            isCapturing
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {isCapturing ? 'Monitoring Active' : 'Standby'}
        </span>
      </div>

      {/* Description & Status */}
      <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
        <p>
          Captures desktop snapshots every <strong>5 to 10 minutes</strong> at randomized intervals and logs
          keystrokes, mouse clicks, and activity levels into your client&apos;s verified Work Diary.
        </p>
      </div>

      {/* Active Capture Live Card */}
      {isCapturing ? (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 bg-white rounded-lg border border-slate-100 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Next Snapshot Window
              </span>
              <span className="font-extrabold text-slate-900 text-sm">
                ~{formatCountdown(secondsUntilNextCheck)}
              </span>
            </div>

            <div className="p-2.5 bg-white rounded-lg border border-slate-100 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Last Activity Score
              </span>
              <span className="font-extrabold text-emerald-600 text-sm">
                {lastScore !== null ? `${lastScore}/10` : 'Calibrating...'}
              </span>
            </div>
          </div>

          {/* Last Captured Thumbnail Preview */}
          {lastThumbnailUrl && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Latest Captured Snapshot
              </span>
              <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-300 shadow-2xs bg-slate-900 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lastThumbnailUrl}
                  alt="Last Captured Slot"
                  className="w-full h-full object-cover object-top"
                />
                <div className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-xs text-[9px] font-mono text-white px-1.5 py-0.5 rounded">
                  {lastCaptureTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}

          {/* Controls: Manual Test Shot & Stop Button */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isProcessingSnapshot}
              onClick={() => triggerSnapshot(true)}
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
              title="Test snapshot right now without waiting 5 minutes"
            >
              {isProcessingSnapshot ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Capturing Snapshot...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Take Snapshot Now</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleStopCapture}
              className="py-2 px-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <PauseCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>Pause</span>
            </button>
          </div>
        </div>
      ) : (
        /* Standby state card */
        <div className="space-y-3">
          <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-start gap-2.5 text-xs text-emerald-900">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              When enabled, your screen is shared in memory with the browser to capture snapshots every 5–10 min.
              Snapshots are stored in your secure contract work diary.
            </p>
          </div>

          <button
            type="button"
            onClick={handleStartCapture}
            disabled={!isTimerRunning}
            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
              isTimerRunning
                ? 'bg-slate-900 hover:bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isTimerRunning ? 'Enable Upwork Screen Capture' : 'Start Timer First to Enable'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
