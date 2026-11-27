/**
 * Pure helpers for in-page timer UX, server-authoritative elapsed calculation,
 * structured stop-result feedback classification, and IST (Asia/Kolkata) calendar grouping.
 */

export const DEFAULT_AUTO_POPOUT_ENABLED = false;
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

export type TimerStopDiscardReason =
  | 'short_session'
  | 'weekly_limit_reached'
  | 'contract_ineligible'
  | 'contract_cancelled'
  | 'session_exceeded_max_duration';

const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const istHourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: 'numeric',
  hour12: false,
});

export function toISTDateString(input: Date | string = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    return istDateFormatter.format(new Date());
  }
  return istDateFormatter.format(date);
}

export function getISTHour(input: Date | string): number {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return 0;
  const raw = Number(istHourFormatter.format(date));
  return raw === 24 ? 0 : raw;
}

export function getISTDayBoundsUtc(dateStr: string): {
  startUtc: string;
  endUtc: string;
} {
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);
  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}

export function addDaysToDateString(dateStr: string, deltaDays: number): string {
  const base = new Date(`${dateStr}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().split('T')[0];
}

export function computeElapsedSeconds(
  startTimeIso: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!startTimeIso) return 0;
  const startMs = new Date(startTimeIso).getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function formatStartTimerError(res: { error?: string; code?: string }): string {
  switch (res.code) {
    case 'CONCURRENT_SESSION_EXISTS':
      return 'An active timer is already running on your account. Stop or discard it before starting a new one.';
    case 'UNAUTHORIZED':
      return 'You are not authorized to track time on this contract.';
    case 'INELIGIBLE_CONTRACT':
      return res.error || 'This contract is no longer eligible for hourly time tracking.';
    case 'UNAUTHENTICATED':
      return 'Authentication required. Please sign in to start tracking time.';
    case 'INVALID_ID':
      return 'Invalid contract selected.';
    default:
      return res.error || 'Failed to start timer session.';
  }
}

export interface StopTimerFeedback {
  kind:
    | 'saved'
    | 'discarded_short'
    | 'weekly_limit_reached'
    | 'no_active_session'
    | 'session_exceeded_max_duration'
    | 'contract_cancelled'
    | 'ineligible'
    | 'error';
  message: string;
  isError: boolean;
}

export function classifyStopTimerResult(params: {
  res: {
    success: boolean;
    outcome?: 'saved' | 'discarded';
    discardReason?: TimerStopDiscardReason;
    entry?: { durationMinutes: number };
    error?: string;
    code?: string;
  };
  elapsedSeconds: number;
  weekMinutesLogged: number;
  weeklyLimitHours: number;
}): StopTimerFeedback {
  const { res, elapsedSeconds, weekMinutesLogged, weeklyLimitHours } = params;

  if (!res.success) {
    if (res.code === 'NO_ACTIVE_SESSION') {
      return {
        kind: 'no_active_session',
        message: 'Session was already completed. Refreshed view.',
        isError: false,
      };
    }
    return {
      kind: 'error',
      message: res.error || 'Failed to stop timer session.',
      isError: true,
    };
  }

  if (res.entry) {
    const mins = res.entry.durationMinutes;
    return {
      kind: 'saved',
      message: `Logged ${mins} minute${mins === 1 ? '' : 's'} to your timesheet!`,
      isError: false,
    };
  }

  // Prefer explicit server-returned discardReason when available
  switch (res.discardReason) {
    case 'short_session':
      return {
        kind: 'discarded_short',
        message: 'Timer session was under 60 seconds and was discarded without billing.',
        isError: false,
      };
    case 'weekly_limit_reached':
      return {
        kind: 'weekly_limit_reached',
        message:
          weeklyLimitHours > 0
            ? `Weekly hour limit reached (${weeklyLimitHours} hrs/wk). Session was not billed.`
            : 'Weekly hour limit has been reached for this contract. Session was not billed.',
        isError: true,
      };
    case 'session_exceeded_max_duration':
      return {
        kind: 'session_exceeded_max_duration',
        message:
          'Timer exceeded the 12-hour single-session limit and was discarded. Please add manual time if approved by the client.',
        isError: true,
      };
    case 'contract_cancelled':
      return {
        kind: 'contract_cancelled',
        message: 'Contract was cancelled. Active timer session was discarded without billing.',
        isError: true,
      };
    case 'contract_ineligible':
      return {
        kind: 'ineligible',
        message: 'Contract is no longer active or eligible for hourly billing. Session was discarded.',
        isError: true,
      };
  }

  // Fallback for pre-migration stop_timer_session() returning NULL without discard_reason
  if (elapsedSeconds < 60) {
    return {
      kind: 'discarded_short',
      message: 'Timer session was under 60 seconds and was discarded without billing.',
      isError: false,
    };
  }

  if (weeklyLimitHours > 0 && weekMinutesLogged >= weeklyLimitHours * 60) {
    return {
      kind: 'weekly_limit_reached',
      message: `Weekly hour limit reached (${weeklyLimitHours} hrs/wk). Session was not billed.`,
      isError: true,
    };
  }

  return {
    kind: 'ineligible',
    message: 'Session ended without a billable entry (weekly limit reached or contract is no longer eligible).',
    isError: true,
  };
}

export interface RawTimeEntryRow {
  id: string;
  contract_id: string;
  timesheet_id?: string | null;
  freelancer_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  memo: string;
  source: 'timer' | 'manual';
  created_at: string;
}

export interface MappedStopTimerResult {
  success: boolean;
  outcome?: 'saved' | 'discarded';
  discardReason?: TimerStopDiscardReason;
  remainingWeekMinutes?: number | null;
  entry?: {
    id: string;
    contractId: string;
    timesheetId?: string | null;
    freelancerId: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    memo: string;
    source: 'timer' | 'manual';
    createdAt: string;
  };
  error?: string;
  code?: string;
}

/**
 * Maps `stop_timer_session_v2` RPC output strictly, failing closed when the v2 RPC is missing (`PGRST202`).
 * Never falls back to the legacy `stop_timer_session` RPC.
 */
export function mapStopTimerV2RpcResponse(rpcResult: {
  data: unknown;
  error: { code?: string; message: string } | null;
}): MappedStopTimerResult {
  const { data, error } = rpcResult;

  if (error) {
    if (error.code === 'PGRST202') {
      return {
        success: false,
        error: 'Required database function stop_timer_session_v2 is missing. Apply Phase 2C migrations before stopping timers.',
        code: 'MIGRATION_REQUIRED',
      };
    }

    let code = 'DATABASE_ERROR';
    if (error.code === '22023') {
      code = 'NO_ACTIVE_SESSION';
    } else if (error.code === '42501') {
      code = 'UNAUTHORIZED';
    }

    return {
      success: false,
      error: error.message,
      code,
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      success: false,
      error: 'Unexpected empty response from stop_timer_session_v2.',
      code: 'DATABASE_ERROR',
    };
  }

  const payload = data as {
    outcome?: 'saved' | 'discarded';
    discard_reason?: TimerStopDiscardReason;
    remaining_week_minutes?: number | null;
    entry?: RawTimeEntryRow | null;
  };

  if (payload.outcome === 'discarded' || !payload.entry?.id) {
    return {
      success: true,
      outcome: 'discarded',
      discardReason: payload.discard_reason,
      remainingWeekMinutes: payload.remaining_week_minutes ?? null,
      entry: undefined,
    };
  }

  const entryRow = payload.entry;
  return {
    success: true,
    outcome: 'saved',
    remainingWeekMinutes: payload.remaining_week_minutes ?? null,
    entry: {
      id: entryRow.id,
      contractId: entryRow.contract_id,
      timesheetId: entryRow.timesheet_id,
      freelancerId: entryRow.freelancer_id,
      startTime: entryRow.start_time,
      endTime: entryRow.end_time,
      durationMinutes: entryRow.duration_minutes,
      memo: entryRow.memo,
      source: entryRow.source,
      createdAt: entryRow.created_at,
    },
  };
}

export interface RawWorkDiarySlotRow {
  id: string;
  contract_id: string;
  time_entry_id?: string | null;
  freelancer_id: string;
  slot_time: string;
  duration_minutes: number;
  activity_score: number;
  keystrokes_count: number;
  mouse_clicks_count: number;
  memo: string;
  screenshot_url?: string | null;
  is_manual: boolean;
  created_at: string;
}

export interface MappedScreenshotSlotResult {
  success: boolean;
  outcome?: 'inserted' | 'duplicate' | 'ineligible';
  duplicate?: boolean;
  slot?: {
    id: string;
    contractId: string;
    timeEntryId?: string | null;
    freelancerId: string;
    slotTime: string;
    durationMinutes: number;
    activityScore: number;
    keystrokesCount: number;
    mouseClicksCount: number;
    memo: string;
    screenshotUrl?: string | null;
    isManual: boolean;
    createdAt: string;
  };
  error?: string;
  code?: string;
}

export function mapRecordScreenshotSlotRpcResponse(rpcResult: {
  data: unknown;
  error: { code?: string; message: string } | null;
}): MappedScreenshotSlotResult {
  const { data, error } = rpcResult;

  if (error) {
    if (error.code === 'PGRST202') {
      return {
        success: false,
        error: 'Required database function record_work_diary_screenshot_slot is missing. Apply Phase 2C.1 migration.',
        code: 'MIGRATION_REQUIRED',
      };
    }
    return {
      success: false,
      error: error.message,
      code: error.code === '42501' ? 'UNAUTHORIZED' : 'DATABASE_ERROR',
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      success: false,
      error: 'Unexpected response from record_work_diary_screenshot_slot.',
      code: 'DATABASE_ERROR',
    };
  }

  const payload = data as {
    outcome?: 'inserted' | 'duplicate' | 'ineligible';
    slot?: RawWorkDiarySlotRow | null;
    error?: string;
    code?: string;
  };

  if (payload.outcome === 'ineligible') {
    return {
      success: false,
      outcome: 'ineligible',
      error: payload.error || 'Contract or timer session is not eligible for screenshot recording.',
      code: payload.code || 'INELIGIBLE_CONTRACT',
    };
  }

  const row = payload.slot;
  if (!row) {
    return {
      success: payload.outcome === 'duplicate',
      outcome: payload.outcome,
      duplicate: payload.outcome === 'duplicate',
    };
  }

  return {
    success: true,
    outcome: payload.outcome || 'inserted',
    duplicate: payload.outcome === 'duplicate',
    slot: {
      id: row.id,
      contractId: row.contract_id,
      timeEntryId: row.time_entry_id,
      freelancerId: row.freelancer_id,
      slotTime: row.slot_time,
      durationMinutes: Number(row.duration_minutes) || 10,
      activityScore: Number(row.activity_score) || 0,
      keystrokesCount: Number(row.keystrokes_count) || 0,
      mouseClicksCount: Number(row.mouse_clicks_count) || 0,
      memo: row.memo || '',
      screenshotUrl: row.screenshot_url,
      isManual: Boolean(row.is_manual),
      createdAt: row.created_at,
    },
  };
}
