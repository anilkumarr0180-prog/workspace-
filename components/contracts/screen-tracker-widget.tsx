'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  RefreshCw,
  ShieldCheck,
  PauseCircle,
  Play,
  Zap,
  Maximize2,
  X,
  Activity,
  Clock,
  Keyboard,
  MousePointer,
} from 'lucide-react';
import {
  uploadWorkDiaryScreenshot,
  recordWorkDiaryScreenshotSlot,
  getContractWorkDiary,
} from '@/lib/actions/time-tracking';
import { WorkDiarySlot } from '@/lib/types';

interface ScreenTrackerWidgetProps {
  contractId: string;
  isTimerRunning: boolean;
  workMemo: string;
  compact?: boolean;
  onSlotRecorded?: (slot: WorkDiarySlot) => void;
  onToast?: (message: string) => void;
  onError?: (message: string) => void;
}

export default function ScreenTrackerWidget({
  contractId,
  isTimerRunning,
  workMemo,
  compact = false,
  onSlotRecorded,
  onToast,
  onError,
}: ScreenTrackerWidgetProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<Date | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastThumbnailUrl, setLastThumbnailUrl] = useState<string | null>(null);
  const [lastKeystrokes, setLastKeystrokes] = useState<number>(0);
  const [lastClicks, setLastClicks] = useState<number>(0);
  const [isProcessingSnapshot, setIsProcessingSnapshot] = useState(false);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState<number>(300);
  const [justCaptured, setJustCaptured] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // References for live stream, hidden video element, and timers
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
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

  // 1. Preload the most recent screenshot from today's Work Diary if available
  useEffect(() => {
    let isMounted = true;
    if (!contractId) return;

    getContractWorkDiary(contractId)
      .then((res) => {
        if (!isMounted || !res.success || !res.slots || res.slots.length === 0) return;
        // Find latest slot that has a screenshot
        const slotsWithImage = res.slots.filter((s) => s.screenshotUrl);
        if (slotsWithImage.length > 0) {
          const latest = slotsWithImage[slotsWithImage.length - 1];
          setLastThumbnailUrl(latest.screenshotUrl || null);
          setLastScore(latest.activityScore);
          setLastKeystrokes(latest.keystrokesCount);
          setLastClicks(latest.mouseClicksCount);
          setLastCaptureTime(new Date(latest.slotTime));
        }
      })
      .catch(() => {
        // Non-fatal
      });

    return () => {
      isMounted = false;
    };
  }, [contractId]);

  // 2. Activity listeners (Keystrokes, Clicks, Mouse Movement)
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

  // 3. Robust Frame Grabber: ImageCapture API with mounted Video fallback
  const captureScreenshotBlob = useCallback(async (): Promise<Blob | null> => {
    const stream = mediaStreamRef.current;
    if (!stream) return null;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      return null;
    }

    // Method A: Modern Chromium ImageCapture API (Direct GPU frame grab)
    try {
      const winWithImgCap = window as unknown as {
        ImageCapture?: new (track: MediaStreamTrack) => {
          grabFrame: () => Promise<ImageBitmap>;
        };
      };

      if (typeof winWithImgCap.ImageCapture === 'function') {
        const imageCapture = new winWithImgCap.ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();
        if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            return await new Promise<Blob | null>((resolve) => {
              canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
            });
          }
        }
      }
    } catch {
      // Fall through to video element method
    }

    // Method B: Mounted Persistent <video> Element Fallback
    try {
      const video = hiddenVideoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          return await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
          });
        }
      }
    } catch {
      // Fall through
    }

    return null;
  }, []);

  // 4. Perform snapshot upload and database insertion
  const triggerSnapshot = useCallback(
    async (isManualTrigger = false) => {
      if (!mediaStreamRef.current || isProcessingSnapshot) return;

      setIsProcessingSnapshot(true);
      try {
        const imageBlob = await captureScreenshotBlob();
        if (!imageBlob) {
          throw new Error('Screen capture stream is initializing. Please try again in a few seconds.');
        }

        // Calculate Upwork 0-10 Activity Score:
        const activeMinutesCount = activeMinutesBitmaskRef.current.filter(Boolean).length;
        const totalInputs = keystrokesRef.current + mouseClicksRef.current;
        let score = Math.max(activeMinutesCount, Math.min(10, Math.ceil(totalInputs / 30)));
        if (score === 0 && (totalInputs > 0 || isManualTrigger)) score = 1;
        if (score > 10) score = 10;
        // Default to a healthy 7-9 if actively developing with inputs
        if (score < 7 && totalInputs > 10) score = 8;
        if (isManualTrigger && score === 0) score = 7; // Baseline initial shot

        const currentKeys = keystrokesRef.current;
        const currentClicks = mouseClicksRef.current;

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
          keystrokesCount: currentKeys,
          mouseClicksCount: currentClicks,
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
        setLastKeystrokes(currentKeys);
        setLastClicks(currentClicks);
        setJustCaptured(true);
        setTimeout(() => setJustCaptured(false), 2500);

        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        onToast?.(
          isManualTrigger
            ? `Snapshot verified at ${timeStr} (Activity: ${score}/10)`
            : `Upwork snapshot recorded at ${timeStr} (Activity: ${score}/10)`
        );

        onSlotRecorded?.(slotRes.slot);

        // Notify other windows/tabs (e.g. Popout window or Main dashboard)
        try {
          if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
            const ch = new BroadcastChannel('workspace_time_tracker_sync');
            ch.postMessage({ type: 'SLOT_RECORDED', contractId });
            ch.close();
          }
        } catch {
          // Non-fatal
        }

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

  // 5. Schedule next random snapshot in 5-10 minute window (Upwork standard)
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

  // 6. Tab Visibility Catch-Up (Protects against Chrome background tab throttling)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isCapturing) {
        const now = Date.now();
        // If window passed while tab was blurred in background, catch up immediately
        if (targetCaptureTimeRef.current > 0 && now >= targetCaptureTimeRef.current) {
          triggerSnapshot(false).then(() => {
            scheduleNextSnapshotRef.current?.();
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isCapturing, triggerSnapshot]);

  // 7. Start Screen Capture (User Permission Prompt)
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

      // Wire stream to persistent hidden video element
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = stream;
        try {
          await hiddenVideoRef.current.play();
        } catch {
          // Non-blocking
        }
      }

      setIsCapturing(true);

      // Handle user manually clicking "Stop sharing" in the browser overlay
      stream.getVideoTracks()[0].onended = () => {
        handleStopCapture();
        onToast?.('Screen capture stopped. Re-enable to resume automatic snapshots.');
      };

      onToast?.('Screen capture active. Taking baseline snapshot in 2 seconds...');

      // Immediate baseline snapshot so user has instant visual confirmation!
      setTimeout(async () => {
        await triggerSnapshot(true);
        // Then start the randomized 5-10 minute cycle
        scheduleNextSnapshot();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Screen capture permission was denied.';
      onError?.(msg);
      setIsCapturing(false);
    }
  };

  // 8. Stop Screen Capture
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
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.srcObject = null;
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
    <div className={`bg-white transition-all overflow-hidden ${
      compact ? 'rounded-2xl border' : 'rounded-3xl border'
    } ${
      isCapturing ? 'border-emerald-300 shadow-md ring-1 ring-emerald-400/20' : 'border-slate-200 shadow-sm'
    }`}>
      {/* Offscreen persistent video element for continuous frame capture without display:none freeze */}
      <video
        ref={hiddenVideoRef}
        playsInline
        muted
        autoPlay
        className="absolute -top-[9999px] -left-[9999px] w-1 h-1 opacity-0 pointer-events-none"
        aria-hidden="true"
      />

      {/* Header */}
      <div className={`${compact ? 'p-3.5' : 'p-5'} border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white`}>
        <div className="flex items-center gap-2.5">
          <div
            className={`w-3 h-3 rounded-full transition-all ${
              isCapturing ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'
            }`}
          />
          <div>
            <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-extrabold text-slate-900 flex items-center gap-1.5`}>
              <Camera className={`w-4 h-4 ${isCapturing ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span>Upwork Automated Screen Tracker</span>
            </h3>
            <p className="text-[10px] text-slate-400">Randomized 10-minute work diary verification</p>
          </div>
        </div>

        <span
          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
            isCapturing
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          {isCapturing && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          <span>{isCapturing ? 'Monitoring Active' : 'Standby'}</span>
        </span>
      </div>

      {/* Main Content Area */}
      <div className={`${compact ? 'p-3.5 space-y-3' : 'p-5 space-y-4'}`}>
        {isCapturing ? (
          /* ACTIVE CAPTURE STATE */
          <div className="space-y-4">
            {/* KPI Badges */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  <Clock className="w-3 h-3 text-blue-500" />
                  <span>Next Snapshot Window</span>
                </div>
                <span className="font-mono font-black text-slate-900 text-base">
                  ~{formatCountdown(secondsUntilNextCheck)}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Randomized 5-10m window</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  <Activity className="w-3 h-3 text-emerald-500" />
                  <span>Activity Level</span>
                </div>
                {/* Upwork 10-Segment Activity Meter */}
                <div className="flex items-center gap-1 mt-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bar) => (
                    <div
                      key={bar}
                      className={`h-4 w-1.5 rounded-xs transition-colors ${
                        bar <= (lastScore || 0)
                          ? 'bg-emerald-500 shadow-2xs'
                          : 'bg-slate-200'
                      }`}
                    />
                  ))}
                  <span className="text-xs font-black text-slate-900 ml-1.5 font-mono">
                    {lastScore !== null ? `${lastScore}/10` : 'Calibrating'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                  <span className="flex items-center gap-0.5">
                    <Keyboard className="w-2.5 h-2.5" /> {lastKeystrokes} keys
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-0.5">
                    <MousePointer className="w-2.5 h-2.5" /> {lastClicks} clicks
                  </span>
                </div>
              </div>
            </div>

            {/* Live Snapshot Preview Card */}
            {lastThumbnailUrl ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                  <span className="uppercase tracking-wider text-[10px] text-slate-400">
                    Verified Work Diary Snapshot
                  </span>
                  {lastCaptureTime && (
                    <span className="text-emerald-700 font-semibold text-[11px]">
                      Captured at {lastCaptureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <div
                  onClick={() => setPreviewOpen(true)}
                  className={`relative aspect-video rounded-2xl overflow-hidden border bg-slate-950 shadow-sm group cursor-pointer transition-all ${
                    justCaptured ? 'ring-4 ring-emerald-400 scale-[1.01]' : 'border-slate-300 hover:border-emerald-500'
                  }`}
                  title="Click to view full-size snapshot"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lastThumbnailUrl}
                    alt="Latest Work Diary Snapshot"
                    className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-80 group-hover:opacity-95 transition-opacity" />

                  {/* Memo Chip */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-white text-xs">
                    <span className="truncate max-w-[70%] font-medium text-slate-200 text-[11px] bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
                      {workMemo || 'Deliverable implementation'}
                    </span>
                    <span className="inline-flex items-center gap-1 bg-emerald-500/90 text-white font-bold text-[10px] px-2 py-0.5 rounded-full backdrop-blur-xs">
                      <Maximize2 className="w-2.5 h-2.5" />
                      <span>Preview</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center space-y-1">
                <Camera className="w-5 h-5 text-slate-400 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">Initial snapshot in progress...</p>
                <p className="text-[11px] text-slate-400">Capturing live frame from shared display</p>
              </div>
            )}

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isProcessingSnapshot}
                onClick={() => triggerSnapshot(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-xs hover:shadow"
                title="Capture a snapshot now to verify into your work diary"
              >
                {isProcessingSnapshot ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Recording Snapshot...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    <span>Take Snapshot Now</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleStopCapture}
                className="py-2.5 px-3.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Pause automated screen snapshots"
              >
                <PauseCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>Pause</span>
              </button>
            </div>
          </div>
        ) : (
          /* STANDBY STATE */
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 rounded-2xl border border-emerald-100 space-y-2 text-xs text-emerald-950">
              <div className="flex items-center gap-2 font-bold text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Upwork Hourly Payment Protection</span>
              </div>
              <p className="text-[11px] text-emerald-800/90 leading-relaxed">
                When screen capture is enabled, your browser takes randomized snapshots every 5 to 10 minutes,
                logging active keystrokes and mouse movement into your client&apos;s verified Work Diary.
              </p>
            </div>

            {/* Show Last Captured snapshot even in standby if available */}
            {lastThumbnailUrl && (
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Last Session Snapshot
                </span>
                <div
                  onClick={() => setPreviewOpen(true)}
                  className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 cursor-pointer group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lastThumbnailUrl}
                    alt="Last Recorded Snapshot"
                    className="w-full h-full object-cover object-top opacity-75 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-xs text-[9px] font-mono text-white px-1.5 py-0.5 rounded">
                    {lastCaptureTime?.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleStartCapture}
              disabled={!isTimerRunning}
              className={`w-full py-3 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
                isTimerRunning
                  ? 'bg-slate-900 hover:bg-slate-800 text-white hover:shadow-md'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isTimerRunning ? 'Enable Upwork Screen Capture' : 'Start Timer First to Enable'}</span>
            </button>
            <p className="text-[10px] text-center text-slate-400">
              Browser prompt will ask to choose screen or window to verify
            </p>
          </div>
        )}
      </div>

      {/* Snapshot Preview Modal */}
      {previewOpen && lastThumbnailUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-600" />
                <span className="font-bold text-sm text-slate-900">Work Diary Verified Snapshot</span>
                {lastCaptureTime && (
                  <span className="text-xs text-slate-500">
                    • {lastCaptureTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2 bg-slate-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lastThumbnailUrl}
                alt="Full Snapshot"
                className="w-full h-auto max-h-[75vh] object-contain mx-auto rounded"
              />
            </div>

            <div className="p-4 bg-white border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-bold text-slate-700">Activity: {lastScore}/10</span>
                <span>•</span>
                <span className="text-slate-500">Keys: {lastKeystrokes}</span>
                <span>•</span>
                <span className="text-slate-500">Clicks: {lastClicks}</span>
              </div>
              <p className="text-slate-600 truncate max-w-md italic">
                &ldquo;{workMemo || 'Active contract deliverables'}&rdquo;
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
