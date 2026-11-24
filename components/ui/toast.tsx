'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  X,
  ArrowRight
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
}

// Global emitter helper that works anywhere (client components, callbacks, utilities)
export const toast = {
  success: (title: string, message?: string, options?: ToastOptions) => {
    emitToast({ type: 'success', title, message, ...options });
  },
  error: (title: string, message?: string, options?: ToastOptions) => {
    emitToast({ type: 'error', title, message, ...options });
  },
  info: (title: string, message?: string, options?: ToastOptions) => {
    emitToast({ type: 'info', title, message, ...options });
  },
  warning: (title: string, message?: string, options?: ToastOptions) => {
    emitToast({ type: 'warning', title, message, ...options });
  },
};

function emitToast(data: Omit<ToastData, 'id'> & { id?: string }) {
  if (typeof window === 'undefined') return;
  const id = data.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  window.dispatchEvent(
    new CustomEvent('workspace:toast', {
      detail: { ...data, id },
    })
  );
}

// Single Toast Card with countdown progress bar and pause-on-hover
interface ToastCardProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

function ToastCard({ toast: item, onDismiss }: ToastCardProps) {
  const duration = item.duration ?? 5000;
  const [isPaused, setIsPaused] = useState(false);
  const remainingTimeRef = useRef(duration);
  const startTimeRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismissRef.current(item.id);
    }, remainingTimeRef.current);
  }, [item.id]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const elapsed = Date.now() - startTimeRef.current;
    remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
  }, []);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [startTimer]);

  const handleMouseEnter = () => {
    setIsPaused(true);
    pauseTimer();
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
    startTimer();
  };

  // Badge styles based on type
  const config = {
    success: {
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
      badgeBg: 'bg-emerald-50 border-emerald-200/80',
      progressBarBg: 'bg-[#14a800]',
    },
    error: {
      icon: <AlertCircle className="w-5 h-5 text-rose-600" />,
      badgeBg: 'bg-rose-50 border-rose-200/80',
      progressBarBg: 'bg-rose-600',
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
      badgeBg: 'bg-amber-50 border-amber-200/80',
      progressBarBg: 'bg-amber-500',
    },
    info: {
      icon: <Info className="w-5 h-5 text-sky-600" />,
      badgeBg: 'bg-sky-50 border-sky-200/80',
      progressBarBg: 'bg-sky-600',
    },
  }[item.type];

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="pointer-events-auto w-full bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-[0_12px_36px_-6px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.06)] overflow-hidden transition-all duration-300 animate-in slide-in-from-top-4 fade-in-95 group"
    >
      <div className="p-4 flex items-start gap-3.5">
        {/* Leading icon badge */}
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${config.badgeBg} shadow-2xs`}
        >
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <h4 className="text-sm font-bold text-slate-900 leading-snug">
            {item.title}
          </h4>
          {item.message && (
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {item.message}
            </p>
          )}

          {item.action && (
            <div className="mt-2.5">
              {item.action.href ? (
                <Link
                  href={item.action.href}
                  onClick={() => onDismiss(item.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
                >
                  <span>{item.action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick?.();
                    onDismiss(item.id);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors cursor-pointer"
                >
                  <span>{item.action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Dismiss Button */}
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 -mr-1 -mt-1"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Signature Toastify animated progress bar */}
      <div className="w-full bg-slate-100 h-1 overflow-hidden">
        <div
          className={`h-full ${config.progressBarBg}`}
          style={{
            animation: `toast-progress ${duration}ms linear forwards`,
            animationPlayState: isPaused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}

// Global Toast Container mounted in Root Layout
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ToastData>;
      if (!customEvent.detail) return;
      const newToast = customEvent.detail;
      setToasts((prev) => [newToast, ...prev.slice(0, 3)]); // Keep max 4 toasts
    };

    window.addEventListener('workspace:toast', handleToastEvent);

    // Also check for any cross-page queued toast in sessionStorage
    try {
      const pendingToastRaw = sessionStorage.getItem('workspace_pending_toast');
      if (pendingToastRaw) {
        sessionStorage.removeItem('workspace_pending_toast');
        const parsed = JSON.parse(pendingToastRaw) as Omit<ToastData, 'id'>;
        emitToast(parsed);
      }
    } catch {
      // Safe fallback
    }

    return () => {
      window.removeEventListener('workspace:toast', handleToastEvent);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 sm:top-5 sm:right-5 z-[9999] flex flex-col gap-2.5 max-w-sm sm:max-w-md w-full pointer-events-none"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} toast={item} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
