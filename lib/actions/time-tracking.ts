'use server';

import { createClient } from '@/lib/supabase/server';
import { ActiveTimerSession, Contract, TimeEntry, Timesheet } from '@/lib/types';

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
