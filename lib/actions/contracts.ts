'use server';

import { createClient } from '@/lib/supabase/server';
import { Contract, ContractStatus, ProjectType } from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GetContractsFilters {
  as?: 'freelancer' | 'client';
  status?: ContractStatus;
  jobId?: string;
  proposalId?: string;
}

export interface ContractDetailsResult {
  success: boolean;
  contract?: Contract;
  error?: string;
  code?: string;
}

export interface ContractsListResult {
  success: boolean;
  contracts: Contract[];
  total: number;
  error?: string;
  code?: string;
}

interface ProfileJoin {
  id?: string;
  full_name?: string | null;
}

interface CompanyJoin {
  id?: string;
  name?: string | null;
}

interface SupabaseContractRow {
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
  profiles?: ProfileJoin | ProfileJoin[] | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

function mapContractRow(row: SupabaseContractRow): Contract {
  const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
  const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const companyObj = Array.isArray(row.companies) ? row.companies[0] : row.companies;

  return {
    id: row.id,
    proposalId: row.proposal_id,
    jobId: row.job_id,
    jobTitle: jobObj?.title || row.title,
    clientId: row.client_id,
    clientName: profileObj?.full_name || undefined,
    companyId: row.company_id || null,
    companyName: companyObj?.name || null,
    freelancerId: row.freelancer_id,
    contractType: row.contract_type as ProjectType,
    title: row.title,
    hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
    fixedPrice: row.fixed_price ? Number(row.fixed_price) : null,
    weeklyHourLimit: row.weekly_hour_limit ? Number(row.weekly_hour_limit) : null,
    allowManualTime: Boolean(row.allow_manual_time),
    status: row.status as ContractStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch list of contracts for the authenticated user (freelancer or client perspective).
 * Respects RLS and queries only authorized contracts.
 */
export async function getContracts(filters: GetContractsFilters = {}): Promise<ContractsListResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      contracts: [],
      total: 0,
      error: 'Authentication required to view contracts.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    let query = supabase
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
      `, { count: 'exact' });

    if (filters.as === 'freelancer') {
      query = query.eq('freelancer_id', user.id);
    } else if (filters.as === 'client') {
      // Find company IDs for client
      const { data: userCompanies } = await supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'hiring_manager']);

      const companyIds = (userCompanies || []).map((c) => c.company_id);

      if (companyIds.length > 0) {
        query = query.or(`client_id.eq.${user.id},company_id.in.(${companyIds.join(',')})`);
      } else {
        query = query.eq('client_id', user.id);
      }
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.jobId) {
      if (!UUID_REGEX.test(filters.jobId.trim())) {
        return { success: true, contracts: [], total: 0 };
      }
      query = query.eq('job_id', filters.jobId.trim());
    }

    if (filters.proposalId) {
      if (!UUID_REGEX.test(filters.proposalId.trim())) {
        return { success: true, contracts: [], total: 0 };
      }
      query = query.eq('proposal_id', filters.proposalId.trim());
    }

    query = query.order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) {
      return {
        success: false,
        contracts: [],
        total: 0,
        error: `Database error: ${error.message}`,
        code: error.code,
      };
    }

    const mapped = ((data as unknown as SupabaseContractRow[]) || []).map(mapContractRow);

    return {
      success: true,
      contracts: mapped,
      total: count ?? mapped.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while fetching contracts.';
    return {
      success: false,
      contracts: [],
      total: 0,
      error: message,
    };
  }
}

/**
 * Fetch single contract details by ID.
 */
export async function getContractById(contractId: string): Promise<ContractDetailsResult> {
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
      error: 'Authentication required.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data, error } = await supabase
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
      .eq('id', contractId.trim())
      .maybeSingle();

    if (error) {
      return {
        success: false,
        error: `Database error: ${error.message}`,
        code: error.code,
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'Contract not found or unauthorized.',
        code: 'NOT_FOUND',
      };
    }

    return {
      success: true,
      contract: mapContractRow(data as unknown as SupabaseContractRow),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while fetching contract details.';
    return {
      success: false,
      error: message,
    };
  }
}
