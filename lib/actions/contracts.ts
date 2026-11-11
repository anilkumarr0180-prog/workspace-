'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/actions/notifications';
import { Contract, ContractStatus, ProjectType } from '@/lib/types';
import { revalidatePath } from 'next/cache';

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

export interface CreateContractOfferInput {
  proposalId: string;
  contractType: ProjectType;
  title?: string;
  hourlyRate?: number | null;
  fixedPrice?: number | null;
  weeklyHourLimit?: number | null;
  allowManualTime?: boolean;
  offerMessage?: string;
}

export interface ContractOfferResult {
  success: boolean;
  contractId?: string;
  error?: string;
  code?: string;
}

interface ProfileJoin {
  id?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  title?: string | null;
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
  offer_message?: string | null;
  offer_expires_at?: string | null;
  offer_accepted_at?: string | null;
  offer_declined_at?: string | null;
  declined_reason?: string | null;
  created_at: string;
  updated_at: string;
  jobs?: { id?: string; title?: string } | Array<{ id?: string; title?: string }> | null;
  profiles?: ProfileJoin | ProfileJoin[] | null;
  client?: ProfileJoin | ProfileJoin[] | null;
  freelancer?: ProfileJoin | ProfileJoin[] | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

function mapContractRow(row: SupabaseContractRow): Contract {
  const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
  const clientObj = Array.isArray(row.client)
    ? row.client[0]
    : Array.isArray(row.profiles)
    ? row.profiles[0]
    : row.client || row.profiles;
  const freelancerObj = Array.isArray(row.freelancer) ? row.freelancer[0] : row.freelancer;
  const companyObj = Array.isArray(row.companies) ? row.companies[0] : row.companies;

  return {
    id: row.id,
    proposalId: row.proposal_id,
    jobId: row.job_id,
    jobTitle: jobObj?.title || row.title,
    clientId: row.client_id,
    clientName: clientObj?.full_name || undefined,
    clientAvatar: clientObj?.avatar_url || null,
    companyId: row.company_id || null,
    companyName: companyObj?.name || null,
    freelancerId: row.freelancer_id,
    freelancerName: freelancerObj?.full_name || undefined,
    freelancerAvatar: freelancerObj?.avatar_url || null,
    freelancerTitle: freelancerObj?.title || null,
    contractType: row.contract_type as ProjectType,
    title: row.title,
    hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
    fixedPrice: row.fixed_price ? Number(row.fixed_price) : null,
    weeklyHourLimit: row.weekly_hour_limit ? Number(row.weekly_hour_limit) : null,
    allowManualTime: Boolean(row.allow_manual_time),
    status: row.status as ContractStatus,
    offerMessage: row.offer_message || null,
    offerExpiresAt: row.offer_expires_at || null,
    offerAcceptedAt: row.offer_accepted_at || null,
    offerDeclinedAt: row.offer_declined_at || null,
    declinedReason: row.declined_reason || null,
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
      .select(
        `
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
        offer_message,
        offer_expires_at,
        offer_accepted_at,
        offer_declined_at,
        declined_reason,
        created_at,
        updated_at,
        jobs (id, title),
        client:profiles!client_id (id, full_name, avatar_url),
        freelancer:profiles!freelancer_id (id, full_name, avatar_url, title),
        companies (id, name)
      `,
        { count: 'exact' }
      );

    if (filters.as === 'freelancer') {
      query = query.eq('freelancer_id', user.id);
    } else if (filters.as === 'client') {
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
      .select(
        `
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
        offer_message,
        offer_expires_at,
        offer_accepted_at,
        offer_declined_at,
        declined_reason,
        created_at,
        updated_at,
        jobs (id, title),
        client:profiles!client_id (id, full_name, avatar_url),
        freelancer:profiles!freelancer_id (id, full_name, avatar_url, title),
        companies (id, name)
      `
      )
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

/**
 * Send a formal Upwork-style contract offer to a freelancer for a submitted proposal.
 */
export async function createContractOffer(
  input: CreateContractOfferInput
): Promise<ContractOfferResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to create a job offer.',
      code: 'UNAUTHENTICATED',
    };
  }

  if (!UUID_REGEX.test(input.proposalId?.trim())) {
    return {
      success: false,
      error: 'Valid proposal ID is required.',
      code: 'INVALID_ID',
    };
  }

  if (input.contractType !== 'hourly' && input.contractType !== 'fixed') {
    return {
      success: false,
      error: 'Contract type must be hourly or fixed.',
      code: 'INVALID_TYPE',
    };
  }

  const hourlyRateVal = input.contractType === 'hourly' ? Number(input.hourlyRate || 0) : null;
  const fixedPriceVal = input.contractType === 'fixed' ? Number(input.fixedPrice || 0) : null;

  if (input.contractType === 'hourly' && (!hourlyRateVal || hourlyRateVal <= 0)) {
    return {
      success: false,
      error: 'Please specify a valid hourly rate greater than $0.',
      code: 'INVALID_RATE',
    };
  }

  if (input.contractType === 'fixed' && (!fixedPriceVal || fixedPriceVal <= 0)) {
    return {
      success: false,
      error: 'Please specify a valid fixed price greater than $0.',
      code: 'INVALID_PRICE',
    };
  }

  try {
    const { data: contractId, error: rpcError } = await supabase.rpc('create_contract_offer', {
      p_proposal_id: input.proposalId.trim(),
      p_contract_type: input.contractType,
      p_title: input.title?.trim() || null,
      p_hourly_rate: hourlyRateVal,
      p_fixed_price: fixedPriceVal,
      p_weekly_hour_limit: input.contractType === 'hourly' ? (input.weeklyHourLimit ? Number(input.weeklyHourLimit) : 40) : null,
      p_allow_manual_time: input.allowManualTime ?? true,
      p_offer_message: input.offerMessage?.trim() || null,
    });

    if (rpcError) {
      console.warn('RPC create_contract_offer failed, falling back to direct server action:', rpcError.message);
      const fallbackResult = await executeCreateContractOfferFallback(
        user.id,
        input,
        hourlyRateVal,
        fixedPriceVal
      );
      if (!fallbackResult.success) {
        return {
          success: false,
          error: fallbackResult.error || rpcError.message,
          code: rpcError.code,
        };
      }
      revalidatePath('/client');
      revalidatePath('/contracts');
      revalidatePath('/freelancer');
      return fallbackResult;
    }

    revalidatePath('/client');
    revalidatePath('/contracts');
    revalidatePath('/freelancer');

    return {
      success: true,
      contractId: contractId as string,
    };
  } catch (err: unknown) {
    console.warn('RPC create_contract_offer exception, falling back to direct server action:', err);
    const fallbackResult = await executeCreateContractOfferFallback(
      user.id,
      input,
      hourlyRateVal,
      fixedPriceVal
    );
    if (!fallbackResult.success) {
      const message = err instanceof Error ? err.message : 'Unexpected error creating contract offer.';
      return {
        success: false,
        error: fallbackResult.error || message,
      };
    }
    revalidatePath('/client');
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    return fallbackResult;
  }
}

/**
 * Fallback execution for creating a contract offer in case database RPC is outdated or has schema discrepancies.
 */
async function executeCreateContractOfferFallback(
  userId: string,
  input: CreateContractOfferInput,
  hourlyRateVal: number | null,
  fixedPriceVal: number | null
): Promise<ContractOfferResult> {
  try {
    const admin = getAdminSupabaseClient();

    // 1. Fetch proposal
    const { data: proposal, error: propErr } = await admin
      .from('proposals')
      .select('id, job_id, freelancer_id, status, bid_amount, rate_type')
      .eq('id', input.proposalId.trim())
      .single();

    if (propErr || !proposal) {
      return { success: false, error: 'Proposal not found.' };
    }

    if (['rejected', 'withdrawn'].includes(proposal.status)) {
      return { success: false, error: `Cannot create an offer for a proposal that is ${proposal.status}.` };
    }

    // 2. Fetch parent job
    const { data: job, error: jobErr } = await admin
      .from('jobs')
      .select('id, client_id, company_id, title, status')
      .eq('id', proposal.job_id)
      .single();

    if (jobErr || !job) {
      return { success: false, error: 'Parent job not found.' };
    }

    // 3. Authorization check
    let isClientManager = job.client_id === userId;
    if (!isClientManager && job.company_id) {
      const { data: member } = await admin
        .from('company_members')
        .select('id, role')
        .eq('company_id', job.company_id)
        .eq('user_id', userId)
        .single();
      if (member && ['owner', 'admin', 'hiring_manager'].includes(member.role)) {
        isClientManager = true;
      }
    }

    if (!isClientManager) {
      return { success: false, error: 'Caller is not authorized to create an offer for this job.' };
    }

    // 4. Duplicate check
    const { data: existingContracts } = await admin
      .from('contracts')
      .select('id')
      .eq('proposal_id', proposal.id)
      .in('status', ['pending_offer', 'active']);

    if (existingContracts && existingContracts.length > 0) {
      return { success: false, error: 'An offer or active contract already exists for this proposal.' };
    }

    const contractTitle = input.title?.trim() || job.title;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 5. Insert contract
    const { data: contract, error: contractErr } = await admin
      .from('contracts')
      .insert({
        proposal_id: proposal.id,
        job_id: job.id,
        client_id: job.client_id,
        company_id: job.company_id,
        freelancer_id: proposal.freelancer_id,
        contract_type: input.contractType,
        title: contractTitle,
        hourly_rate: input.contractType === 'hourly' ? hourlyRateVal : null,
        fixed_price: input.contractType === 'fixed' ? fixedPriceVal : null,
        weekly_hour_limit: input.contractType === 'hourly' ? (input.weeklyHourLimit ? Number(input.weeklyHourLimit) : 40) : null,
        allow_manual_time: input.allowManualTime ?? true,
        offer_message: input.offerMessage?.trim() || null,
        offer_expires_at: expiresAt,
        status: 'pending_offer',
      })
      .select('id')
      .single();

    if (contractErr || !contract) {
      return { success: false, error: contractErr?.message || 'Failed to create contract.' };
    }

    const contractId = contract.id;

    // 6. Fixed price initial milestone in contract_milestones
    if (input.contractType === 'fixed' && fixedPriceVal) {
      const { error: msErr } = await admin
        .from('contract_milestones')
        .insert({
          contract_id: contractId,
          client_id: job.client_id,
          freelancer_id: proposal.freelancer_id,
          title: 'Initial Project Milestone',
          description: `Full scope and agreed deliverables for contract: ${contractTitle}`,
          amount: fixedPriceVal,
          currency: 'USD',
          sequence_order: 1,
          status: 'planned',
        });
      if (msErr) {
        console.warn('contract_milestones insert fallback notice:', msErr.message);
      }
    }

    // 7. Advance proposal status
    if (['submitted', 'under_review'].includes(proposal.status)) {
      await admin
        .from('proposals')
        .update({ status: 'interviewing', updated_at: new Date().toISOString() })
        .eq('id', proposal.id);
    }

    // 8. Send notification via createNotification helper
    await createNotification({
      userId: proposal.freelancer_id,
      type: 'contract_offer_received',
      title: 'Contract Offer Received',
      message: `You received an offer for "${job.title}"`,
      link: `/contracts/${contractId}`,
      metadata: { actor_id: userId, contract_id: contractId },
    });

    return { success: true, contractId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Fallback contract creation error';
    return { success: false, error: msg };
  }
}

/**
 * Freelancer action: Accept a pending contract offer.
 */
export async function acceptContractOffer(
  contractId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  if (!UUID_REGEX.test(contractId?.trim())) {
    return { success: false, error: 'Invalid contract ID format.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('accept_contract_offer', {
      p_contract_id: contractId.trim(),
    });

    if (rpcError) {
      console.warn('RPC accept_contract_offer failed, falling back to direct server action:', rpcError.message);
      const fallbackResult = await executeAcceptContractOfferFallback(user.id, contractId.trim());
      if (!fallbackResult.success) {
        return { success: false, error: fallbackResult.error || rpcError.message };
      }
    }

    revalidatePath(`/contracts/${contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');

    return { success: true };
  } catch (err: unknown) {
    console.warn('RPC accept_contract_offer error, using fallback:', err);
    const fallbackResult = await executeAcceptContractOfferFallback(user.id, contractId.trim());
    if (!fallbackResult.success) {
      const message = err instanceof Error ? err.message : 'Failed to accept offer.';
      return { success: false, error: fallbackResult.error || message };
    }
    revalidatePath(`/contracts/${contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    return { success: true };
  }
}

async function executeAcceptContractOfferFallback(
  userId: string,
  contractId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getAdminSupabaseClient();
    const { data: contract, error: cErr } = await admin
      .from('contracts')
      .select('id, proposal_id, job_id, client_id, freelancer_id, title, status')
      .eq('id', contractId)
      .single();

    if (cErr || !contract) {
      return { success: false, error: 'Contract not found.' };
    }

    if (contract.freelancer_id !== userId) {
      return { success: false, error: 'Only the invited freelancer can accept this offer.' };
    }

    if (contract.status !== 'pending_offer') {
      return { success: false, error: `This offer is in status "${contract.status}" and cannot be accepted.` };
    }

    const nowIso = new Date().toISOString();
    await admin
      .from('contracts')
      .update({ status: 'active', offer_accepted_at: nowIso, updated_at: nowIso })
      .eq('id', contractId);

    if (contract.proposal_id) {
      await admin
        .from('proposals')
        .update({ status: 'accepted', updated_at: nowIso })
        .eq('id', contract.proposal_id);
    }

    await createNotification({
      userId: contract.client_id,
      type: 'contract_offer_accepted',
      title: 'Offer Accepted',
      message: `Your contract offer for "${contract.title}" was accepted!`,
      link: `/contracts/${contractId}`,
      metadata: { actor_id: userId, contract_id: contractId },
    });

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Accept offer fallback error' };
  }
}

/**
 * Freelancer action: Decline a pending contract offer with an optional reason.
 */
export async function declineContractOffer(
  contractId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  if (!UUID_REGEX.test(contractId?.trim())) {
    return { success: false, error: 'Invalid contract ID format.' };
  }

  try {
    const { error: rpcError } = await supabase.rpc('decline_contract_offer', {
      p_contract_id: contractId.trim(),
      p_reason: reason?.trim() || null,
    });

    if (rpcError) {
      console.warn('RPC decline_contract_offer failed, falling back to direct server action:', rpcError.message);
      const fallbackResult = await executeDeclineContractOfferFallback(user.id, contractId.trim(), reason);
      if (!fallbackResult.success) {
        return { success: false, error: fallbackResult.error || rpcError.message };
      }
    }

    revalidatePath(`/contracts/${contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');

    return { success: true };
  } catch (err: unknown) {
    console.warn('RPC decline_contract_offer error, using fallback:', err);
    const fallbackResult = await executeDeclineContractOfferFallback(user.id, contractId.trim(), reason);
    if (!fallbackResult.success) {
      const message = err instanceof Error ? err.message : 'Failed to decline offer.';
      return { success: false, error: fallbackResult.error || message };
    }
    revalidatePath(`/contracts/${contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    return { success: true };
  }
}

async function executeDeclineContractOfferFallback(
  userId: string,
  contractId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getAdminSupabaseClient();
    const { data: contract, error: cErr } = await admin
      .from('contracts')
      .select('id, proposal_id, job_id, client_id, freelancer_id, title, status')
      .eq('id', contractId)
      .single();

    if (cErr || !contract) {
      return { success: false, error: 'Contract not found.' };
    }

    if (contract.freelancer_id !== userId) {
      return { success: false, error: 'Only the invited freelancer can decline this offer.' };
    }

    if (contract.status !== 'pending_offer') {
      return { success: false, error: `This offer is in status "${contract.status}" and cannot be declined.` };
    }

    const nowIso = new Date().toISOString();
    await admin
      .from('contracts')
      .update({
        status: 'declined',
        declined_reason: reason?.trim() || null,
        offer_declined_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', contractId);

    await createNotification({
      userId: contract.client_id,
      type: 'contract_offer_declined',
      title: 'Offer Declined',
      message: `Your contract offer for "${contract.title}" was declined.`,
      link: `/contracts/${contractId}`,
      metadata: { actor_id: userId, contract_id: contractId },
    });

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Decline offer fallback error' };
  }
}

/**
 * Look up existing contract (including pending offers) for a specific proposal.
 */
export async function getContractOfferForProposal(
  proposalId: string
): Promise<ContractDetailsResult> {
  if (!proposalId || !UUID_REGEX.test(proposalId.trim())) {
    return { success: false, error: 'Invalid proposal ID.' };
  }

  const supabase = await createClient();
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select(
        `
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
        offer_message,
        offer_expires_at,
        offer_accepted_at,
        offer_declined_at,
        declined_reason,
        created_at,
        updated_at,
        jobs (id, title),
        client:profiles!client_id (id, full_name, avatar_url),
        freelancer:profiles!freelancer_id (id, full_name, avatar_url, title),
        companies (id, name)
      `
      )
      .eq('proposal_id', proposalId.trim())
      .maybeSingle();

    if (error || !data) {
      return { success: false, error: error?.message || 'No contract found.' };
    }

    return {
      success: true,
      contract: mapContractRow(data as unknown as SupabaseContractRow),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching contract offer.';
    return { success: false, error: message };
  }
}
