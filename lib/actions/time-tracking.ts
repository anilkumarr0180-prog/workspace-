'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { ActiveTimerSession, Contract, TimeEntry, Timesheet, WorkDiarySlot } from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TimerSessionResult {
  success: boolean;
  session?: ActiveTimerSession;
  entry?: TimeEntry;
  error?: string;
  code?: string;
}

export interface TimeEntriesResult {
  success: boolean;
  entries: TimeEntry[];
  total: number;
  error?: string;
  code?: string;
}

export interface TimesheetsResult {
  success: boolean;
  timesheets: Timesheet[];
  error?: string;
  code?: string;
}

/**
 * Start an active timer session via trusted server-side stored procedure.
 * Authoritative start_time is assigned by the database (clock_timestamp()).
 */
export async function startTimerSession(contractId: string, memo: string = ''): Promise<TimerSessionResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return {
      success: false,
      error: 'Invalid contract ID format.',
      code: 'INVALID_ID',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to start timer session.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data, error } = await supabase.rpc('start_timer_session', {
      p_contract_id: contractId.trim(),
      p_memo: memo?.trim() || '',
    });

    if (error) {
      let code = 'DATABASE_ERROR';
      if (error.code === '23505') code = 'CONCURRENT_SESSION_EXISTS';
      else if (error.code === '42501') code = 'UNAUTHORIZED';
      else if (error.code === '22023') code = 'INELIGIBLE_CONTRACT';

      return {
        success: false,
        error: error.message,
        code,
      };
    }

    const sessionRow = data as {
      id: string;
      contract_id: string;
      freelancer_id: string;
      start_time: string;
      memo: string;
      created_at: string;
    };

    return {
      success: true,
      session: {
        id: sessionRow.id,
        contractId: sessionRow.contract_id,
        freelancerId: sessionRow.freelancer_id,
        startTime: sessionRow.start_time,
        memo: sessionRow.memo,
        createdAt: sessionRow.created_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start timer session.';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Stop active timer session, calculate authoritative duration, and log completed time entry.
 */
export async function stopTimerSession(memo?: string): Promise<TimerSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to stop timer session.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data, error } = await supabase.rpc('stop_timer_session', {
      p_memo: memo ? memo.trim() : null,
    });

    if (error) {
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

    // When session was under 60 seconds (or cancelled), stop_timer_session returns NULL.
    // PostgREST serializes a NULL composite row as an object with null properties ({ id: null, ... }).
    // The active session is safely deleted in the database without logging billable time.
    const rawData = data as { id?: string | null } | null;
    if (!rawData || !rawData.id) {
      return {
        success: true,
        entry: undefined,
      };
    }

    const entryRow = data as {
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
    };

    return {
      success: true,
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to stop timer session.';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Cancel and discard an active timer session without recording billable time.
 */
export async function discardTimerSession(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const { error } = await supabase.rpc('discard_timer_session');
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to discard session.';
    return { success: false, error: message };
  }
}

/**
 * Fetch the authenticated user's current active timer session, if one exists.
 */
export async function getActiveTimerSession(): Promise<{
  success: boolean;
  session?: ActiveTimerSession | null;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const { data, error } = await supabase
      .from('active_timer_sessions')
      .select('id, contract_id, freelancer_id, start_time, memo, created_at')
      .eq('freelancer_id', user.id)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: true, session: null };
    }

    return {
      success: true,
      session: {
        id: data.id,
        contractId: data.contract_id,
        freelancerId: data.freelancer_id,
        startTime: data.start_time,
        memo: data.memo,
        createdAt: data.created_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to check active timer.';
    return { success: false, error: message };
  }
}

/**
 * Fetch verified time entries for an authorized contract.
 */
export async function getTimeEntries(contractId: string): Promise<TimeEntriesResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, entries: [], total: 0, error: 'Invalid contract ID format.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, entries: [], total: 0, error: 'Authentication required.' };
  }

  try {
    const { data, count, error } = await supabase
      .from('time_entries')
      .select('id, contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source, created_at', {
        count: 'exact',
      })
      .eq('contract_id', contractId.trim())
      .order('start_time', { ascending: false });

    if (error) {
      return { success: false, entries: [], total: 0, error: error.message };
    }

    interface SupabaseEntryRow {
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

    const entries: TimeEntry[] = ((data as unknown as SupabaseEntryRow[]) || []).map((row) => ({
      id: row.id,
      contractId: row.contract_id,
      timesheetId: row.timesheet_id,
      freelancerId: row.freelancer_id,
      startTime: row.start_time,
      endTime: row.end_time,
      durationMinutes: row.duration_minutes,
      memo: row.memo,
      source: row.source,
      createdAt: row.created_at,
    }));

    return {
      success: true,
      entries,
      total: count ?? entries.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch time entries.';
    return { success: false, entries: [], total: 0, error: message };
  }
}

export interface FreelancerTimeDashboardData {
  success: boolean;
  activeSession?: (ActiveTimerSession & { contract?: Contract }) | null;
  eligibleContracts: Contract[];
  recentEntries: TimeEntry[];
  stats: {
    todayMinutes: number;
    todayEarnings: number;
    thisWeekMinutes: number;
    thisWeekEarnings: number;
    totalHoursAllTime: number;
  };
  error?: string;
  code?: string;
}

/**
 * Fetch comprehensive time tracking dashboard state for the authenticated freelancer.
 * Retrieves active session, eligible hourly contracts, recent entries, and calculated totals.
 */
export async function getFreelancerTimeTrackingData(): Promise<FreelancerTimeDashboardData> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      eligibleContracts: [],
      recentEntries: [],
      stats: {
        todayMinutes: 0,
        todayEarnings: 0,
        thisWeekMinutes: 0,
        thisWeekEarnings: 0,
        totalHoursAllTime: 0,
      },
      error: 'Authentication required to access time tracker.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 1. Fetch eligible active hourly contracts
    const { data: rawContracts, error: contractsError } = await supabase
      .from('contracts')
      .select(`
        id,
        proposal_id,
        job_id,
        client_id,
        company_id,
        freelancer_id,
        contract_type,
        title,
        hourly_rate,
        fixed_price,
        weekly_hour_limit,
        allow_manual_time,
        status,
        created_at,
        updated_at,
        jobs (id, title),
        profiles!client_id (id, full_name),
        companies (id, name)
      `)
      .eq('freelancer_id', user.id)
      .eq('contract_type', 'hourly')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (contractsError) {
      return {
        success: false,
        eligibleContracts: [],
        recentEntries: [],
        stats: { todayMinutes: 0, todayEarnings: 0, thisWeekMinutes: 0, thisWeekEarnings: 0, totalHoursAllTime: 0 },
        error: `Failed to load eligible contracts: ${contractsError.message}`,
        code: contractsError.code,
      };
    }

    interface ContractRow {
      id: string;
      proposal_id: string;
      job_id: string;
      client_id: string;
      company_id?: string | null;
      freelancer_id: string;
      contract_type: string;
      title: string;
      hourly_rate?: number | null;
      fixed_price?: number | null;
      weekly_hour_limit?: number | null;
      allow_manual_time: boolean;
      status: string;
      created_at: string;
      updated_at: string;
      jobs?: { id?: string; title?: string } | Array<{ id?: string; title?: string }> | null;
      profiles?: { id?: string; full_name?: string | null } | Array<{ id?: string; full_name?: string | null }> | null;
      companies?: { id?: string; name?: string | null } | Array<{ id?: string; name?: string | null }> | null;
    }

    const contractsMap = new Map<string, Contract>();
    const eligibleContracts: Contract[] = ((rawContracts as unknown as ContractRow[]) || []).map((row) => {
      const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
      const profObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const compObj = Array.isArray(row.companies) ? row.companies[0] : row.companies;

      const c: Contract = {
        id: row.id,
        proposalId: row.proposal_id,
        jobId: row.job_id,
        jobTitle: jobObj?.title || row.title,
        clientId: row.client_id,
        clientName: profObj?.full_name || undefined,
        companyId: row.company_id || null,
        companyName: compObj?.name || null,
        freelancerId: row.freelancer_id,
        contractType: 'hourly',
        title: row.title,
        hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
        fixedPrice: null,
        weeklyHourLimit: row.weekly_hour_limit ? Number(row.weekly_hour_limit) : 40,
        allowManualTime: Boolean(row.allow_manual_time),
        status: 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      contractsMap.set(c.id, c);
      return c;
    });

    // 2. Fetch Active Timer Session
    const { data: rawSession } = await supabase
      .from('active_timer_sessions')
      .select('id, contract_id, freelancer_id, start_time, memo, created_at')
      .eq('freelancer_id', user.id)
      .maybeSingle();

    let activeSession: (ActiveTimerSession & { contract?: Contract }) | null = null;
    if (rawSession) {
      let contractObj = contractsMap.get(rawSession.contract_id);
      if (!contractObj) {
        // Fallback fetch if contract wasn't active or in list
        const { data: cRow } = await supabase
          .from('contracts')
          .select('id, proposal_id, job_id, client_id, company_id, freelancer_id, contract_type, title, hourly_rate, weekly_hour_limit, status, created_at, updated_at')
          .eq('id', rawSession.contract_id)
          .maybeSingle();
        if (cRow) {
          contractObj = {
            id: cRow.id,
            proposalId: cRow.proposal_id,
            jobId: cRow.job_id,
            jobTitle: cRow.title,
            clientId: cRow.client_id,
            freelancerId: cRow.freelancer_id,
            contractType: 'hourly',
            title: cRow.title,
            hourlyRate: cRow.hourly_rate ? Number(cRow.hourly_rate) : null,
            weeklyHourLimit: cRow.weekly_hour_limit ? Number(cRow.weekly_hour_limit) : 40,
            allowManualTime: true,
            status: cRow.status,
            createdAt: cRow.created_at,
            updatedAt: cRow.updated_at,
          };
        }
      }

      activeSession = {
        id: rawSession.id,
        contractId: rawSession.contract_id,
        freelancerId: rawSession.freelancer_id,
        startTime: rawSession.start_time,
        memo: rawSession.memo,
        createdAt: rawSession.created_at,
        contract: contractObj,
      };
    }

    // 3. Fetch Recent Completed Time Entries (latest 25)
    const { data: rawEntries } = await supabase
      .from('time_entries')
      .select(`
        id,
        contract_id,
        timesheet_id,
        freelancer_id,
        start_time,
        end_time,
        duration_minutes,
        memo,
        source,
        created_at,
        contracts (id, title, hourly_rate)
      `)
      .eq('freelancer_id', user.id)
      .order('start_time', { ascending: false })
      .limit(25);

    interface EntryContractJoin {
      id?: string;
      title?: string;
      hourly_rate?: number | null;
    }

    interface EntryRowWithContract {
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
      contracts?: EntryContractJoin | EntryContractJoin[] | null;
    }

    const recentEntries: TimeEntry[] = ((rawEntries as unknown as EntryRowWithContract[]) || []).map((row) => {
      const cJoin = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      return {
        id: row.id,
        contractId: row.contract_id,
        contractTitle: cJoin?.title || contractsMap.get(row.contract_id)?.title || 'Hourly Contract',
        timesheetId: row.timesheet_id,
        freelancerId: row.freelancer_id,
        startTime: row.start_time,
        endTime: row.end_time,
        durationMinutes: row.duration_minutes,
        memo: row.memo,
        source: row.source,
        createdAt: row.created_at,
      };
    });

    // 4. Calculate Real Totals: Today and This Week (UTC aligned)
    const now = new Date();
    // Start of Today (00:00:00 UTC)
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    
    // Start of This Week (Monday 00:00:00 UTC)
    const dayOfWeek = now.getUTCDay(); // 0 is Sunday, 1 is Monday
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const startOfWeek = new Date(startOfToday.getTime() - daysSinceMonday * 86400000);

    // Fetch entries for this week calculation
    const { data: weekEntries } = await supabase
      .from('time_entries')
      .select('duration_minutes, start_time, contract_id, contracts (hourly_rate)')
      .eq('freelancer_id', user.id)
      .gte('start_time', startOfWeek.toISOString());

    interface StatEntryRow {
      duration_minutes: number;
      start_time: string;
      contract_id: string;
      contracts?: { hourly_rate?: number | null } | Array<{ hourly_rate?: number | null }> | null;
    }

    let todayMinutes = 0;
    let todayEarnings = 0;
    let thisWeekMinutes = 0;
    let thisWeekEarnings = 0;

    for (const entry of (weekEntries as unknown as StatEntryRow[]) || []) {
      const entryDate = new Date(entry.start_time);
      const minutes = Number(entry.duration_minutes) || 0;
      const cObj = Array.isArray(entry.contracts) ? entry.contracts[0] : entry.contracts;
      const rate = Number(cObj?.hourly_rate) || Number(contractsMap.get(entry.contract_id)?.hourlyRate) || 0;
      const earnings = (minutes / 60) * rate;

      thisWeekMinutes += minutes;
      thisWeekEarnings += earnings;

      if (entryDate >= startOfToday) {
        todayMinutes += minutes;
        todayEarnings += earnings;
      }
    }

    // All-time total minutes
    const { data: allTimeSum } = await supabase
      .from('time_entries')
      .select('duration_minutes')
      .eq('freelancer_id', user.id);

    const totalMinutesAllTime = (allTimeSum || []).reduce((acc, row) => acc + (Number(row.duration_minutes) || 0), 0);
    const totalHoursAllTime = Math.round((totalMinutesAllTime / 60) * 10) / 10;

    return {
      success: true,
      activeSession,
      eligibleContracts,
      recentEntries,
      stats: {
        todayMinutes,
        todayEarnings: Math.round(todayEarnings * 100) / 100,
        thisWeekMinutes,
        thisWeekEarnings: Math.round(thisWeekEarnings * 100) / 100,
        totalHoursAllTime,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while loading time tracking data.';
    return {
      success: false,
      eligibleContracts: [],
      recentEntries: [],
      stats: { todayMinutes: 0, todayEarnings: 0, thisWeekMinutes: 0, thisWeekEarnings: 0, totalHoursAllTime: 0 },
      error: message,
    };
  }
}

export interface WorkDiarySummary {
  totalMinutes: number;
  totalHours: number;
  avgActivityScore: number;
  totalKeystrokes: number;
  totalClicks: number;
  manualMinutes: number;
  timerMinutes: number;
}

export interface WorkDiaryResult {
  success: boolean;
  slots: WorkDiarySlot[];
  summary: WorkDiarySummary;
  contract?: Contract;
  error?: string;
}

/**
 * Fetch authoritative Upwork Work Diary 10-minute activity segments for a contract.
 * Supports date filtering (e.g. specific week or day).
 */
export async function getContractWorkDiary(
  contractId: string,
  options?: { date?: string; startDate?: string; endDate?: string }
): Promise<WorkDiaryResult> {
  const emptySummary: WorkDiarySummary = {
    totalMinutes: 0,
    totalHours: 0,
    avgActivityScore: 0,
    totalKeystrokes: 0,
    totalClicks: 0,
    manualMinutes: 0,
    timerMinutes: 0,
  };

  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, slots: [], summary: emptySummary, error: 'Invalid contract ID' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, slots: [], summary: emptySummary, error: 'Authentication required' };
    }

    // Verify contract access
    const { data: contract, error: contractErr } = await supabase
      .from('contracts')
      .select('id, title, contract_type, hourly_rate, weekly_hour_limit, allow_manual_time, status, client_id, freelancer_id')
      .eq('id', contractId.trim())
      .single();

    if (contractErr || !contract) {
      return { success: false, slots: [], summary: emptySummary, error: 'Contract not found' };
    }

    let query = supabase
      .from('work_diary_slots')
      .select('*')
      .eq('contract_id', contractId.trim());

    if (options?.date) {
      const dayStart = `${options.date}T00:00:00.000Z`;
      const dayEnd = `${options.date}T23:59:59.999Z`;
      query = query.gte('slot_time', dayStart).lte('slot_time', dayEnd);
    } else if (options?.startDate && options?.endDate) {
      query = query.gte('slot_time', `${options.startDate}T00:00:00.000Z`).lte('slot_time', `${options.endDate}T23:59:59.999Z`);
    }

    query = query.order('slot_time', { ascending: true });

    const { data: rawSlots, error: slotsErr } = await query;

    if (slotsErr) {
      return { success: false, slots: [], summary: emptySummary, error: slotsErr.message };
    }

    interface DbSlotRow {
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

    let totalMinutes = 0;
    let totalScoreSum = 0;
    let scoreCount = 0;
    let totalKeys = 0;
    let totalClicks = 0;
    let manualMinutes = 0;
    let timerMinutes = 0;

    const slots: WorkDiarySlot[] = ((rawSlots as unknown as DbSlotRow[]) || []).map((row) => {
      const mins = Number(row.duration_minutes) || 10;
      totalMinutes += mins;
      totalKeys += Number(row.keystrokes_count) || 0;
      totalClicks += Number(row.mouse_clicks_count) || 0;

      if (row.is_manual) {
        manualMinutes += mins;
      } else {
        timerMinutes += mins;
        totalScoreSum += Number(row.activity_score) || 0;
        scoreCount += 1;
      }

      return {
        id: row.id,
        contractId: row.contract_id,
        timeEntryId: row.time_entry_id,
        freelancerId: row.freelancer_id,
        slotTime: row.slot_time,
        durationMinutes: mins,
        activityScore: Number(row.activity_score) || 0,
        keystrokesCount: Number(row.keystrokes_count) || 0,
        mouseClicksCount: Number(row.mouse_clicks_count) || 0,
        memo: row.memo || '',
        screenshotUrl: row.screenshot_url,
        isManual: Boolean(row.is_manual),
        createdAt: row.created_at,
      };
    });

    const summary: WorkDiarySummary = {
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      avgActivityScore: scoreCount > 0 ? Math.round((totalScoreSum / scoreCount) * 10) / 10 : 0,
      totalKeystrokes: totalKeys,
      totalClicks: totalClicks,
      manualMinutes,
      timerMinutes,
    };

    return {
      success: true,
      slots,
      summary,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load work diary';
    return { success: false, slots: [], summary: emptySummary, error: msg };
  }
}

/**
 * Log manual hourly time on a contract via stored procedure.
 */
export async function logManualTime(params: {
  contractId: string;
  date: string;
  startTime: string;
  endTime: string;
  memo: string;
}): Promise<{ success: boolean; entryId?: string; durationMinutes?: number; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (!params.contractId || !UUID_REGEX.test(params.contractId.trim())) {
      return { success: false, error: 'Invalid contract ID' };
    }

    if (!params.date || !params.startTime || !params.endTime) {
      return { success: false, error: 'Date, start time, and end time are required' };
    }

    if (!params.memo || params.memo.trim().length < 3) {
      return { success: false, error: 'A work memo of at least 3 characters is required' };
    }

    const { data, error } = await supabase.rpc('log_manual_time', {
      p_contract_id: params.contractId.trim(),
      p_date: params.date,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
      p_memo: params.memo.trim(),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const resObj = data as { success?: boolean; entry_id?: string; duration_minutes?: number };
    return {
      success: true,
      entryId: resObj?.entry_id,
      durationMinutes: resObj?.duration_minutes,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to log manual time';
    return { success: false, error: msg };
  }
}

/**
 * Delete a single 10-minute work diary segment (and adjust time entry & timesheet totals).
 */
export async function deleteWorkDiarySlot(
  slotId: string
): Promise<{ success: boolean; deductedMinutes?: number; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (!slotId || !UUID_REGEX.test(slotId.trim())) {
      return { success: false, error: 'Invalid slot ID' };
    }

    const { data, error } = await supabase.rpc('delete_work_diary_slot', {
      p_slot_id: slotId.trim(),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const resObj = data as { success?: boolean; deducted_minutes?: number };
    return {
      success: true,
      deductedMinutes: resObj?.deducted_minutes,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete work diary slot';
    return { success: false, error: msg };
  }
}

export interface RecordScreenshotSlotInput {
  contractId: string;
  slotTime: string;
  durationMinutes?: number;
  activityScore: number;
  keystrokesCount: number;
  mouseClicksCount: number;
  memo: string;
  screenshotUrl: string;
}

export interface RecordScreenshotSlotResult {
  success: boolean;
  slot?: WorkDiarySlot;
  error?: string;
  code?: string;
}

/**
 * Record a verified Upwork-style screenshot work diary segment (5-10 minute window).
 */
export async function recordWorkDiaryScreenshotSlot(
  input: RecordScreenshotSlotInput
): Promise<RecordScreenshotSlotResult> {
  const {
    contractId,
    slotTime,
    durationMinutes = 10,
    activityScore,
    keystrokesCount,
    mouseClicksCount,
    memo,
    screenshotUrl,
  } = input;

  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, error: 'Invalid contract ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Verify caller is the active freelancer on this contract
    const { data: contract, error: contractErr } = await supabase
      .from('contracts')
      .select('id, freelancer_id, status, contract_type')
      .eq('id', contractId.trim())
      .single();

    if (contractErr || !contract) {
      return { success: false, error: 'Contract not found.', code: 'NOT_FOUND' };
    }

    if (contract.freelancer_id !== user.id) {
      return {
        success: false,
        error: 'You are not the assigned freelancer for this contract.',
        code: 'FORBIDDEN',
      };
    }

    // 2. Insert slot into work_diary_slots
    const { data: slotRow, error: insertErr } = await supabase
      .from('work_diary_slots')
      .insert({
        contract_id: contractId.trim(),
        freelancer_id: user.id,
        slot_time: slotTime || new Date().toISOString(),
        duration_minutes: Math.min(60, Math.max(1, durationMinutes)),
        activity_score: Math.min(10, Math.max(0, Math.round(activityScore))),
        keystrokes_count: Math.max(0, Math.round(keystrokesCount)),
        mouse_clicks_count: Math.max(0, Math.round(mouseClicksCount)),
        memo: (memo || '').trim() || 'Active work session',
        screenshot_url: screenshotUrl?.trim() || null,
        is_manual: false,
      })
      .select()
      .single();

    if (insertErr) {
      return { success: false, error: insertErr.message, code: 'INSERT_FAILED' };
    }

    interface RawDbSlot {
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

    const row = slotRow as unknown as RawDbSlot;
    const formattedSlot: WorkDiarySlot = {
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
    };

    return { success: true, slot: formattedSlot };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to record screenshot slot.';
    return { success: false, error: message, code: 'SERVER_ERROR' };
  }
}

/**
 * Upload a live captured desktop screenshot to the work-diary-screenshots storage bucket.
 */
export async function uploadWorkDiaryScreenshot(
  formData: FormData
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const file = formData.get('file') as File | Blob | null;
    const contractId = formData.get('contractId') as string | null;

    if (!file) {
      return { success: false, error: 'No image file provided' };
    }

    if (!contractId || !UUID_REGEX.test(contractId.trim())) {
      return { success: false, error: 'Valid contract ID is required' };
    }

    // Auto-provision bucket via admin client if not already created
    try {
      const adminClient = getAdminSupabaseClient();
      const { data: buckets } = await adminClient.storage.listBuckets();
      if (!buckets?.some((b) => b.name === 'work-diary-screenshots')) {
        await adminClient.storage.createBucket('work-diary-screenshots', {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
      }
    } catch {
      // Non-fatal if already configured or constrained
    }

    const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${contractId.trim()}/${user.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;

    const admin = getAdminSupabaseClient();
    const { error: uploadErr } = await admin.storage
      .from('work-diary-screenshots')
      .upload(fileName, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (uploadErr) {
      return { success: false, error: uploadErr.message };
    }

    const { data: publicUrlData } = admin.storage
      .from('work-diary-screenshots')
      .getPublicUrl(fileName);

    return {
      success: true,
      url: publicUrlData.publicUrl,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to upload screenshot.';
    return { success: false, error: message };
  }
}

