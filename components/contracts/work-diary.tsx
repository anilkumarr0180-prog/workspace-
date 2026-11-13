'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { WorkDiarySlot } from '@/lib/types';
import {
  getContractWorkDiary,
  logManualTime,
  deleteWorkDiarySlot,
  WorkDiarySummary,
} from '@/lib/actions/time-tracking';
import {
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Trash2,
  Monitor,
  Activity,
  Keyboard,
  AlertCircle,
  CheckCircle2,
  X,
  ExternalLink,
} from 'lucide-react';

interface WorkDiaryProps {
  contractId: string;
  isFreelancer: boolean;
  hourlyRate?: number | null;
  weeklyHourLimit?: number | null;
  allowManualTime?: boolean;
}

export default function WorkDiary({
  contractId,
  isFreelancer,
  hourlyRate = 0,
  weeklyHourLimit,
  allowManualTime = true,
}: WorkDiaryProps) {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [slots, setSlots] = useState<WorkDiarySlot[]>([]);
  const [summary, setSummary] = useState<WorkDiarySummary>({
    totalMinutes: 0,
    totalHours: 0,
    avgActivityScore: 0,
    totalKeystrokes: 0,
    totalClicks: 0,
    manualMinutes: 0,
    timerMinutes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Manual Time Modal state
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualDate, setManualDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [manualStartTime, setManualStartTime] = useState('09:00');
  const [manualEndTime, setManualEndTime] = useState('10:00');
  const [manualMemo, setManualMemo] = useState('');
  const [isLoggingManual, setIsLoggingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Screenshot Preview Modal state
  const [previewSlot, setPreviewSlot] = useState<WorkDiarySlot | null>(null);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Determine current week dates (Mon to Sun) based on selectedDate
  const weekDays = useMemo(() => {
    const curr = new Date(selectedDate);
    const day = curr.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(curr);
    monday.setDate(curr.getDate() + diffToMonday);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      days.push({ iso, dayName, dayNum, fullDate: d });
    }
    return days;
  }, [selectedDate]);

  // Load Work Diary slots for selectedDate
  useEffect(() => {
    let isCancelled = false;

    async function fetchData() {
      try {
        const res = await getContractWorkDiary(contractId, { date: selectedDate });
        if (!isCancelled) {
          if (res.success) {
            setSlots(res.slots);
            setSummary(res.summary);
            setError(null);
          } else {
            // Gracefully handle missing table or schema cache notice as empty diary
            if (
              res.error?.toLowerCase().includes('schema cache') ||
              res.error?.toLowerCase().includes('does not exist')
            ) {
              setSlots([]);
              setError(null);
            } else {
              setError(res.error || 'Failed to retrieve work diary');
            }
          }
        }
      } catch {
        if (!isCancelled) {
          setError('Network error while connecting to work diary server');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [contractId, selectedDate, reloadTrigger]);

  // Navigate to previous or next day
  const handlePrevDay = () => {
    setLoading(true);
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    setLoading(true);
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Navigate week
  const handlePrevWeek = () => {
    setLoading(true);
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 7);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleNextWeek = () => {
    setLoading(true);
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 7);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Group slots by Hour of Day
  const slotsByHour = useMemo(() => {
    const map = new Map<number, WorkDiarySlot[]>();
    for (const slot of slots) {
      const slotD = new Date(slot.slotTime);
      const hour = slotD.getHours();
      if (!map.has(hour)) {
        map.set(hour, []);
      }
      map.get(hour)!.push(slot);
    }
    // Return sorted array of hours
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [slots]);

  // Submit Manual Time
  const handleManualTimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    setIsLoggingManual(true);
    try {
      const res = await logManualTime({
        contractId,
        date: manualDate,
        startTime: `${manualStartTime}:00`,
        endTime: `${manualEndTime}:00`,
        memo: manualMemo.trim(),
      });
      if (res.success) {
        setIsManualModalOpen(false);
        setManualMemo('');
        showToast('Manual time logged successfully!');
        setLoading(true);
        if (manualDate === selectedDate) {
          setReloadTrigger((prev) => prev + 1);
        } else {
          setSelectedDate(manualDate);
        }
      } else {
        setManualError(res.error || 'Failed to log manual time');
      }
    } catch {
      setManualError('Network error while recording manual time');
    } finally {
      setIsLoggingManual(false);
    }
  };

  // Delete single 10-minute slot
  const handleDeleteSlot = async (slotId: string) => {
    if (!window.confirm('Are you sure you want to delete this 10-minute work diary segment? This will deduct 10 minutes from your billed hours.')) {
      return;
    }
    setDeletingSlotId(slotId);
    try {
      const res = await deleteWorkDiarySlot(slotId);
      if (res.success) {
        showToast('Work diary segment removed.');
        setLoading(true);
        setReloadTrigger((prev) => prev + 1);
      } else {
        alert(res.error || 'Failed to delete slot');
      }
    } catch {
      alert('Network error while deleting slot');
    } finally {
      setDeletingSlotId(null);
    }
  };

  const totalEarnings = Math.round(((summary.totalMinutes / 60) * (hourlyRate || 0)) * 100) / 100;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Upwork Work Diary Top Header & Navigation Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                Hourly Time Tracking
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Upwork Work Diary
              </span>
              {weeklyHourLimit ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  Limit: {weeklyHourLimit} hrs/wk
                </span>
              ) : null}
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
              Work Diary &amp; Activity Log
            </h2>
            <p className="text-xs text-slate-500">
              Authoritative 10-minute snapshot records verifying work in progress, activity levels, and memos.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {isFreelancer && allowManualTime && (
              <button
                type="button"
                onClick={() => {
                  setManualDate(selectedDate);
                  setIsManualModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Add Manual Time</span>
              </button>
            )}

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white transition-colors"
                title="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextWeek}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white transition-colors"
                title="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Week Day Tabs (Mon to Sun) */}
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((d) => {
            const isSelected = d.iso === selectedDate;
            const isToday = d.iso === new Date().toISOString().split('T')[0];

            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => {
                  setLoading(true);
                  setSelectedDate(d.iso);
                }}
                className={`p-2.5 rounded-xl text-center transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200/80 text-slate-700'
                }`}
              >
                <span className={`block text-[11px] font-bold uppercase tracking-wider ${
                  isSelected ? 'text-slate-300' : 'text-slate-400'
                }`}>
                  {d.dayName}
                </span>
                <span className="block text-sm font-extrabold mt-0.5">
                  {d.dayNum}
                </span>
                {isToday && (
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1 ${
                    isSelected ? 'bg-emerald-400' : 'bg-emerald-600'
                  }`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Selected Day Summary Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Time Logged</span>
            <div className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>{Math.floor(summary.totalMinutes / 60)}h {summary.totalMinutes % 60}m</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Activity Level</span>
            <div className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>{summary.avgActivityScore > 0 ? `${summary.avgActivityScore}/10` : '—'}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Key &amp; Click Inputs</span>
            <div className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
              <Keyboard className="w-4 h-4 text-slate-400" />
              <span className="text-xs">{summary.totalKeystrokes.toLocaleString()} keys • {summary.totalClicks.toLocaleString()} clicks</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Earnings For Day</span>
            <div className="text-base font-extrabold text-emerald-700">
              ${totalEarnings.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Main Work Diary Slots Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <h3 className="font-bold text-sm text-slate-900">
              Timeline for {new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevDay}
              type="button"
              className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Previous Day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleNextDay}
              type="button"
              className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title="Next Day"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">Loading work diary activity segments...</p>
          </div>
        ) : error ? (
          <div className="p-6 m-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        ) : slots.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
              <Monitor className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-900">No Activity Recorded on This Day</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {isFreelancer
                ? 'Use the tracker timer or click "Add Manual Time" above to log work sessions on this contract.'
                : 'Your hired freelancer has not logged any time or desktop activity on this date.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {slotsByHour.map(([hour, hourSlots]) => {
              const hourLabel = new Date(2026, 0, 1, hour).toLocaleTimeString('en-US', {
                hour: 'numeric',
                hour12: true,
              });
              const hourEndLabel = new Date(2026, 0, 1, hour + 1).toLocaleTimeString('en-US', {
                hour: 'numeric',
                hour12: true,
              });

              return (
                <div key={hour} className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800">
                      {hourLabel} - {hourEndLabel}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {hourSlots.reduce((sum, s) => sum + s.durationMinutes, 0)} mins logged
                    </span>
                  </div>

                  {/* 10-Minute Activity Slot Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {hourSlots.map((slot) => {
                      const slotDate = new Date(slot.slotTime);
                      const timeStr = slotDate.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      });

                      return (
                        <div
                          key={slot.id}
                          className="group relative bg-slate-50 hover:bg-white rounded-xl border border-slate-200 p-2.5 transition-all shadow-2xs hover:shadow-md space-y-2 flex flex-col justify-between"
                        >
                          {/* Top: Slot Thumbnail / Preview */}
                          <div
                            onClick={() => setPreviewSlot(slot)}
                            className="relative aspect-video rounded-lg bg-slate-900 border border-slate-800 overflow-hidden cursor-pointer group-hover:ring-2 group-hover:ring-emerald-500 transition-all flex items-center justify-center"
                          >
                            {slot.screenshotUrl ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={slot.screenshotUrl}
                                  alt={`Snapshot at ${timeStr}`}
                                  className="w-full h-full object-cover object-top"
                                />
                                <div className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-xs text-[7px] font-mono text-emerald-300 px-1 py-0.5 rounded shadow-xs">
                                  {slot.activityScore}/10
                                </div>
                              </>
                            ) : (
                              /* Simulated desktop window preview */
                              <div className="w-full h-full p-1.5 flex flex-col justify-between text-slate-300">
                                <div className="flex items-center justify-between text-[8px] border-b border-slate-800 pb-0.5">
                                  <div className="flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  </div>
                                  <span className="truncate max-w-[80px] text-slate-400 font-mono text-[7px]">
                                    {slot.isManual ? 'Manual Time' : 'Workspace IDE'}
                                  </span>
                                </div>
                                <div className="text-[7px] font-mono text-emerald-400 line-clamp-2 leading-tight py-0.5">
                                  {slot.memo || 'Working on deliverables...'}
                                </div>
                                <div className="flex items-center justify-between text-[7px] text-slate-400 pt-0.5 border-t border-slate-800">
                                  <span>{slot.durationMinutes}m</span>
                                  <span>{slot.isManual ? 'Manual' : `${slot.activityScore}/10`}</span>
                                </div>
                              </div>
                            )}

                            {/* Hover expand overlay */}
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ExternalLink className="w-3.5 h-3.5 text-white" />
                            </div>
                          </div>

                          {/* Upwork Green 10-Segment Activity Bar */}
                          {!slot.isManual ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-slate-600">Activity</span>
                                <span className="font-bold text-emerald-700">{slot.activityScore}/10</span>
                              </div>
                              <div className="flex items-center gap-0.5 h-2">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bar) => {
                                  const isActive = bar <= slot.activityScore;
                                  return (
                                    <div
                                      key={bar}
                                      className={`flex-1 h-full rounded-xs transition-colors ${
                                        isActive ? 'bg-emerald-500' : 'bg-slate-200'
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="py-0.5 px-1.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold text-center">
                              Manual Entry
                            </div>
                          )}

                          {/* Time & Memo details */}
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-500 text-[11px]">
                              <span className="font-bold text-slate-800">{timeStr}</span>
                              <span>{slot.durationMinutes} mins</span>
                            </div>
                            <p className="text-[11px] text-slate-600 line-clamp-2 leading-tight italic">
                              &ldquo;{slot.memo || 'Deliverables'}&rdquo;
                            </p>
                          </div>

                          {/* Freelancer Slot Removal Action */}
                          {isFreelancer && (
                            <div className="pt-1 flex justify-end">
                              <button
                                type="button"
                                disabled={deletingSlotId === slot.id}
                                onClick={() => handleDeleteSlot(slot.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                                title="Delete this 10-minute segment"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Time Logging Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-600" />
                <span>Add Manual Time</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {manualError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{manualError}</span>
              </div>
            )}

            <form onSubmit={handleManualTimeSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Work Date</label>
                <input
                  type="date"
                  required
                  value={manualDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={manualStartTime}
                    onChange={(e) => setManualStartTime(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={manualEndTime}
                    onChange={(e) => setManualEndTime(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Work Memo</label>
                <textarea
                  required
                  rows={2}
                  value={manualMemo}
                  placeholder="Describe the tasks or project milestones completed during this session..."
                  onChange={(e) => setManualMemo(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoggingManual}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50 shadow-2xs"
                >
                  {isLoggingManual ? 'Recording...' : 'Log Time'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* High-Resolution Screenshot / Slot Detail Modal */}
      {previewSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                  Activity Slot Snapshot
                </span>
                <h3 className="font-bold text-base text-slate-900">
                  {new Date(previewSlot.slotTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })} ({previewSlot.durationMinutes} mins)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSlot(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* High-Resolution Screenshot or Simulated Desktop Window */}
            {previewSlot.screenshotUrl ? (
              <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner group flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewSlot.screenshotUrl}
                  alt={`Snapshot at ${previewSlot.slotTime}`}
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 bg-black/75 backdrop-blur-xs px-2.5 py-1 rounded-md text-[10px] text-white shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Verified Screen Snapshot</span>
                </div>
                <a
                  href={previewSlot.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2.5 right-2.5 p-1.5 bg-black/75 hover:bg-black/90 backdrop-blur-xs rounded-md text-white text-[10px] flex items-center gap-1 transition-colors shadow-xs"
                  title="Open full resolution snapshot in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <div className="aspect-video bg-slate-950 rounded-xl p-4 text-slate-300 font-mono text-xs flex flex-col justify-between border border-slate-800 shadow-inner">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-500 text-[10px] ml-2">workspace/src/app/page.tsx</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">
                    {previewSlot.isManual ? 'Manual Entry' : 'Active Work Session'}
                  </span>
                </div>
                <div className="space-y-1 text-slate-400 text-[11px] py-4">
                  <p className="text-emerald-300">{"// Verified Workspace Activity Segment"}</p>
                  <p className="text-slate-200">Task Memo: &quot;{previewSlot.memo}&quot;</p>
                  <p className="text-slate-500">Recorded At: {previewSlot.slotTime}</p>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800 pt-2">
                  <span>Keystrokes: {previewSlot.keystrokesCount}</span>
                  <span>Mouse Clicks: {previewSlot.mouseClicksCount}</span>
                  <span>Activity: {previewSlot.activityScore}/10</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl text-xs">
              <div>
                <span className="text-slate-400 font-semibold block text-[10px]">Session Memo</span>
                <span className="font-bold text-slate-800 block truncate">{previewSlot.memo || 'Work'}</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[10px]">Activity Level</span>
                <span className="font-bold text-emerald-700 block">{previewSlot.activityScore}/10</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[10px]">Input Totals</span>
                <span className="font-bold text-slate-800 block">{previewSlot.keystrokesCount} keys • {previewSlot.mouseClicksCount} clicks</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {isFreelancer ? (
                <button
                  type="button"
                  disabled={deletingSlotId === previewSlot.id}
                  onClick={async () => {
                    const idToDelete = previewSlot.id;
                    setPreviewSlot(null);
                    await handleDeleteSlot(idToDelete);
                  }}
                  className="px-3.5 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-rose-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Snapshot & Deduct Time</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setPreviewSlot(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
