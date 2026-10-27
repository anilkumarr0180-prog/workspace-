'use server';

import { createClient } from '@/lib/supabase/server';
import { ProjectType, ContractStatus, TimesheetStatus } from '@/lib/types';

export interface ClientReportContractSummary {
  id: string;
  title: string;
  contractType: ProjectType;
  status: ContractStatus;
  hourlyRate: number | null;
  fixedPrice: number | null;
  weeklyHourLimit: number | null;
  freelancer: {
    id: string;
    fullName: string;
    username: string;
    avatarUrl?: string | null;
  };
  jobTitle: string;
  createdAt: string;
  loggedMinutes: number;
  accruedAmount: number;
}

export interface ClientReportTimesheet {
  id: string;
  contractId: string;
  contractTitle: string;
  freelancerName: string;
  freelancerUsername: string;
  weekStartDate: string;
  totalMinutes: number;
  totalHours: number;
  totalAmount: number;
  status: TimesheetStatus;
  updatedAt: string;
}

export interface ClientReportTimeEntry {
  id: string;
  contractId: string;
  contractTitle: string;
  freelancerName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  memo: string;
  source: 'timer' | 'manual';
}

export interface ClientReportsData {
  success: boolean;
  client: {
    id: string;
    fullName: string;
  };
  stats: {
    totalLoggedMinutes: number;
    totalLoggedHours: number;
    totalAccruedAmount: number;
    activeHourlyContracts: number;
    activeFixedContracts: number;
    totalAgreedFixedValue: number;
    invoicedAmount: number;
    paidAmount: number;
    paymentsImplemented: false;
  };
  contracts: ClientReportContractSummary[];
  timesheets: ClientReportTimesheet[];
  recentEntries: ClientReportTimeEntry[];
  error?: string;
  code?: string;
}

interface RawProfile {
  id: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
}

interface RawJob {
  id: string;
  title: string;
}

interface RawContract {
  id: string;
  title: string;
  contract_type: string;
  status: string;
  hourly_rate?: number | null;
  fixed_price?: number | null;
  weekly_hour_limit?: number | null;
  freelancer_id: string;
  created_at: string;
  jobs?: RawJob | RawJob[] | null;
  profiles?: RawProfile | RawProfile[] | null;
}

interface RawTimesheet {
  id: string;
  contract_id: string;
  freelancer_id: string;
  week_start_date: string;
  total_minutes: number;
  total_amount: number;
  status: string;
  updated_at: string;
  contracts?: {
    id: string;
    title: string;
    hourly_rate?: number | null;
  } | Array<{ id: string; title: string; hourly_rate?: number | null }> | null;
  profiles?: RawProfile | RawProfile[] | null;
}

interface RawTimeEntry {
  id: string;
  contract_id: string;
  freelancer_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  memo: string;
  source: string;
  contracts?: { id: string; title: string } | Array<{ id: string; title: string }> | null;
  profiles?: RawProfile | RawProfile[] | null;
}

/**
 * Fetch authenticated client's verified reports, contracts, timesheets, and time entries.
 * Enforces client authorization on the server and relies strictly on Supabase RLS.
 */
export async function getClientReportsData(): Promise<ClientReportsData> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      client: { id: '', fullName: '' },
      stats: {
        totalLoggedMinutes: 0,
        totalLoggedHours: 0,
        totalAccruedAmount: 0,
        activeHourlyContracts: 0,
        activeFixedContracts: 0,
        totalAgreedFixedValue: 0,
        invoicedAmount: 0,
        paidAmount: 0,
        paymentsImplemented: false,
      },
      contracts: [],
      timesheets: [],
      recentEntries: [],
      error: 'Authentication required to view reports.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 1. Fetch Client Profile
    const { data: clientProfile } = await supabase
      .from('profiles')
      .select('id, full_name, active_mode')
      .eq('id', user.id)
      .maybeSingle();

    const clientName = clientProfile?.full_name || user.user_metadata?.full_name || 'Client';

    // 2. Fetch Client's Contracts with Freelancer Details and Job Titles
    const { data: rawContracts, error: contractsError } = await supabase
      .from('contracts')
      .select(`
        id,
        title,
        contract_type,
        status,
        hourly_rate,
        fixed_price,
        weekly_hour_limit,
        freelancer_id,
        created_at,
        jobs (id, title),
        profiles!freelancer_id (id, full_name, username, avatar_url)
      `)
      .eq('client_id', user.id)
      .order('created_at', { ascending: false });

    if (contractsError) {
      throw new Error(`Failed to fetch contracts: ${contractsError.message}`);
    }

    // 3. Fetch Client's Timesheets (Weekly Rollups)
    const { data: rawTimesheets, error: timesheetsError } = await supabase
      .from('timesheets')
      .select(`
        id,
        contract_id,
        freelancer_id,
        week_start_date,
        total_minutes,
        total_amount,
        status,
        updated_at,
        contracts (id, title, hourly_rate),
        profiles!freelancer_id (id, full_name, username)
      `)
      .eq('client_id', user.id)
      .order('week_start_date', { ascending: false });

    if (timesheetsError) {
      throw new Error(`Failed to fetch timesheets: ${timesheetsError.message}`);
    }

    // 4. Fetch Client's Recent Time Entries (Individual work sessions)
    // Protected by RLS: c.client_id = auth.uid()
    const { data: rawEntries, error: entriesError } = await supabase
      .from('time_entries')
      .select(`
        id,
        contract_id,
        freelancer_id,
        start_time,
        end_time,
        duration_minutes,
        memo,
        source,
        contracts!contract_id (id, title),
        profiles!freelancer_id (id, full_name, username)
      `)
      .order('start_time', { ascending: false })
      .limit(50);

    if (entriesError) {
      throw new Error(`Failed to fetch time entries: ${entriesError.message}`);
    }

    // Map Timesheets
    const timesheets: ClientReportTimesheet[] = ((rawTimesheets as unknown as RawTimesheet[]) || []).map((row) => {
      const contractObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const totalMinutes = row.total_minutes || 0;

      return {
        id: row.id,
        contractId: row.contract_id,
        contractTitle: contractObj?.title || 'Contract Deliverable',
        freelancerName: profileObj?.full_name || 'Freelancer',
        freelancerUsername: profileObj?.username || '',
        weekStartDate: row.week_start_date,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        totalAmount: Number(row.total_amount) || 0,
        status: (row.status || 'open') as TimesheetStatus,
        updatedAt: row.updated_at,
      };
    });

    // Map Time Entries
    const recentEntries: ClientReportTimeEntry[] = ((rawEntries as unknown as RawTimeEntry[]) || []).map((row) => {
      const contractObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

      return {
        id: row.id,
        contractId: row.contract_id,
        contractTitle: contractObj?.title || 'Contract Deliverable',
        freelancerName: profileObj?.full_name || 'Freelancer',
        startTime: row.start_time,
        endTime: row.end_time,
        durationMinutes: row.duration_minutes || 0,
        memo: row.memo || 'Work deliverable',
        source: (row.source === 'manual' ? 'manual' : 'timer') as 'timer' | 'manual',
      };
    });

    // Compute aggregations per contract
    const contractTimesheetTotals = new Map<string, { minutes: number; amount: number }>();
    timesheets.forEach((ts) => {
      const current = contractTimesheetTotals.get(ts.contractId) || { minutes: 0, amount: 0 };
      current.minutes += ts.totalMinutes;
      current.amount += ts.totalAmount;
      contractTimesheetTotals.set(ts.contractId, current);
    });

    let totalLoggedMinutes = 0;
    let totalAccruedAmount = 0;
    let activeHourlyContracts = 0;
    let activeFixedContracts = 0;
    let totalAgreedFixedValue = 0;

    const contracts: ClientReportContractSummary[] = ((rawContracts as unknown as RawContract[]) || []).map((row) => {
      const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
      const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const totals = contractTimesheetTotals.get(row.id) || { minutes: 0, amount: 0 };

      totalLoggedMinutes += totals.minutes;
      totalAccruedAmount += totals.amount;

      const isHourly = row.contract_type === 'hourly';
      const isActive = row.status === 'active';

      if (isHourly && isActive) {
        activeHourlyContracts++;
      } else if (!isHourly && isActive) {
        activeFixedContracts++;
      }

      if (!isHourly && row.fixed_price) {
        totalAgreedFixedValue += Number(row.fixed_price);
      }

      return {
        id: row.id,
        title: row.title,
        contractType: (row.contract_type === 'hourly' ? 'hourly' : 'fixed') as ProjectType,
        status: (row.status || 'active') as ContractStatus,
        hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
        fixedPrice: row.fixed_price ? Number(row.fixed_price) : null,
        weeklyHourLimit: row.weekly_hour_limit ? Number(row.weekly_hour_limit) : null,
        freelancer: {
          id: row.freelancer_id,
          fullName: profileObj?.full_name || 'Freelancer',
          username: profileObj?.username || '',
          avatarUrl: profileObj?.avatar_url || null,
        },
        jobTitle: jobObj?.title || row.title,
        createdAt: row.created_at,
        loggedMinutes: totals.minutes,
        accruedAmount: Math.round(totals.amount * 100) / 100,
      };
    });

    return {
      success: true,
      client: {
        id: user.id,
        fullName: clientName,
      },
      stats: {
        totalLoggedMinutes,
        totalLoggedHours: Math.round((totalLoggedMinutes / 60) * 10) / 10,
        totalAccruedAmount: Math.round(totalAccruedAmount * 100) / 100,
        activeHourlyContracts,
        activeFixedContracts,
        totalAgreedFixedValue: Math.round(totalAgreedFixedValue * 100) / 100,
        invoicedAmount: 0,
        paidAmount: 0,
        paymentsImplemented: false,
      },
      contracts,
      timesheets,
      recentEntries,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve client reports.';
    return {
      success: false,
      client: { id: '', fullName: '' },
      stats: {
        totalLoggedMinutes: 0,
        totalLoggedHours: 0,
        totalAccruedAmount: 0,
        activeHourlyContracts: 0,
        activeFixedContracts: 0,
        totalAgreedFixedValue: 0,
        invoicedAmount: 0,
        paidAmount: 0,
        paymentsImplemented: false,
      },
      contracts: [],
      timesheets: [],
      recentEntries: [],
      error: message,
    };
  }
}
