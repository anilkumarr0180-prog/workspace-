'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/actions/notifications';
import { queueAndDispatchEmail, triggerOutboxDrain } from '@/lib/email/queue';
import { Contract, ContractMilestone, ContractStatus, PaymentLedgerEntry, ProjectType } from '@/lib/types';
import { getContractMilestones, getContractPaymentLedger } from '@/lib/actions/milestones';
import { getContractTimesheets, TimesheetWithDetails } from '@/lib/actions/timesheet-billing';
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

export interface ContractDetailsBundleResult {
  success: boolean;
  contract?: Contract;
  milestones?: ContractMilestone[];
  ledgerEntries?: PaymentLedgerEntry[];
  timesheets?: TimesheetWithDetails[];
  error?: string;
  code?: string;
}

/**
 * High-performance, resilient bundle fetcher for contracts.
 * Consolidates contract details, milestones, ledger, and timesheets into
 * a single atomic Server Action round-trip with Promise.allSettled protection.
 */
export async function getContractDetailsBundle(contractId: string): Promise<ContractDetailsBundleResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return {
      success: false,
      error: 'Invalid contract ID format.',
      code: 'INVALID_ID',
    };
  }

  try {
    const [contractRes, milestonesRes, ledgerRes, timesheetsRes] = await Promise.allSettled([
      getContractById(contractId),
      getContractMilestones(contractId),
      getContractPaymentLedger(contractId),
      getContractTimesheets(contractId),
    ]);

    const contractData = contractRes.status === 'fulfilled' ? contractRes.value : null;
    if (!contractData?.success || !contractData.contract) {
      return {
        success: false,
        error: contractData?.error || 'Contract could not be retrieved or unauthorized.',
        code: contractData?.code || 'NOT_FOUND',
      };
    }

    const milestonesData = milestonesRes.status === 'fulfilled' ? milestonesRes.value : null;
    const ledgerData = ledgerRes.status === 'fulfilled' ? ledgerRes.value : null;
    const timesheetsData = timesheetsRes.status === 'fulfilled' ? timesheetsRes.value : null;

    return {
      success: true,
      contract: contractData.contract,
      milestones: milestonesData?.milestones || [],
      ledgerEntries: ledgerData?.entries || [],
      timesheets: timesheetsData?.timesheets || [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while fetching contract bundle.';
    return {
      success: false,
      error: message,
      code: 'SERVER_ERROR',
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
      if (fallbackResult.contractId) {
        dispatchContractOfferEmail(fallbackResult.contractId, input.offerMessage).catch(() => {});
      }
      return fallbackResult;
    }

    revalidatePath('/client');
    revalidatePath('/contracts');
    revalidatePath('/freelancer');

    const createdId = contractId as string;
    if (createdId) {
      dispatchContractOfferEmail(createdId, input.offerMessage).catch(() => {});
    }

    return {
      success: true,
      contractId: createdId,
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
    if (fallbackResult.contractId) {
      dispatchContractOfferEmail(fallbackResult.contractId, input.offerMessage).catch(() => {});
    }
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
    let admin: SupabaseClient;
    try {
      admin = getAdminSupabaseClient();
    } catch {
      admin = await createClient();
    }

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

    // 5. Insert contract with automatic schema resilience
    let contractId: string | null = null;
    const baseContractPayload = {
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
    };

    // Primary attempt: full offer schema
    const { data: primaryContract, error: contractErr } = await admin
      .from('contracts')
      .insert({
        ...baseContractPayload,
        offer_message: input.offerMessage?.trim() || null,
        offer_expires_at: expiresAt,
        status: 'pending_offer',
      })
      .select('id')
      .single();

    if (primaryContract?.id) {
      contractId = primaryContract.id;
    } else if (contractErr) {
      // Schema fallback: if offer_expires_at is missing from schema cache, try without offer tracking columns
      if (contractErr.message.includes('offer_expires_at') || contractErr.message.includes('schema cache')) {
        const retryRes = await admin
          .from('contracts')
          .insert({
            ...baseContractPayload,
            status: 'pending_offer',
          })
          .select('id')
          .single();

        if (retryRes.data?.id) {
          contractId = retryRes.data.id;
        } else if (retryRes.error?.message?.includes('chk_contract_status')) {
          // If status constraint rejects 'pending_offer', fall back to 'active'
          const activeRetry = await admin
            .from('contracts')
            .insert({
              ...baseContractPayload,
              status: 'active',
            })
            .select('id')
            .single();

          if (activeRetry.data?.id) {
            contractId = activeRetry.data.id;
          } else {
            return { success: false, error: activeRetry.error?.message || retryRes.error.message };
          }
        } else {
          return { success: false, error: retryRes.error?.message || contractErr.message };
        }
      } else {
        return { success: false, error: contractErr.message };
      }
    }

    if (!contractId) {
      return { success: false, error: 'Failed to create contract record.' };
    }

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
    } else {
      // If RPC succeeded, ensure the associated proposal status is also synchronized to 'accepted'
      try {
        const admin = getAdminSupabaseClient();
        const { data: cRow } = await admin
          .from('contracts')
          .select('proposal_id')
          .eq('id', contractId.trim())
          .maybeSingle();

        if (cRow?.proposal_id) {
          await admin
            .from('proposals')
            .update({ status: 'accepted', updated_at: new Date().toISOString() })
            .eq('id', cRow.proposal_id);
        }
      } catch (e) {
        console.warn('Syncing proposal status to accepted notice:', e);
      }
    }

    revalidatePath(`/contracts/${contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');

    dispatchContractStartedEmail(contractId.trim()).catch(() => {});

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

    dispatchContractStartedEmail(contractId.trim()).catch(() => {});

    return { success: true };
  }
}

async function dispatchContractOfferEmail(
  contractId: string,
  offerMessage?: string | null
): Promise<void> {
  try {
    const admin = getAdminSupabaseClient();
    const { data: contract } = await admin
      .from('contracts')
      .select('id, title, contract_type, hourly_rate, fixed_price, client_id, freelancer_id, offer_expires_at')
      .eq('id', contractId)
      .single();

    if (!contract || !contract.freelancer_id) return;

    const { data: freelancerAuth } = await admin.auth.admin.getUserById(contract.freelancer_id);
    const freelancerEmail = freelancerAuth?.user?.email;
    if (!freelancerEmail) return;

    const { data: freelancerProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', contract.freelancer_id)
      .maybeSingle();

    const { data: clientProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', contract.client_id)
      .maybeSingle();

    const freelancerName =
      freelancerProfile?.full_name ||
      freelancerAuth?.user?.user_metadata?.full_name ||
      'Specialist';

    const clientName = clientProfile?.full_name || 'Client';

    const rateOrAmount =
      contract.contract_type === 'hourly'
        ? `$${contract.hourly_rate || 0}/hr`
        : `$${contract.fixed_price || 0}`;

    await queueAndDispatchEmail({
      eventType: 'contract_offer',
      templateKey: 'contract_offer_v1',
      recipientEmail: freelancerEmail,
      recipientUserId: contract.freelancer_id,
      subject: `Offer Received: New contract proposed for "${contract.title}"`,
      payload: {
        freelancerName,
        clientName,
        jobTitle: contract.title,
        contractId: contract.id,
        contractType: contract.contract_type,
        rateOrAmount,
        offerMessage: offerMessage || undefined,
        expiresAt: contract.offer_expires_at ? new Date(contract.offer_expires_at).toLocaleDateString() : undefined,
        accountState: 'existing_account',
      },
      relatedEntityId: contract.id,
      idempotencyKey: `email:contract_offer:${contract.id}:${contract.freelancer_id}`,
      immediate: true,
    });
  } catch (err) {
    console.warn('[CONTRACT OFFER EMAIL NOTICE]:', err);
  }
}

async function dispatchContractStartedEmail(contractId: string): Promise<void> {
  try {
    const admin = getAdminSupabaseClient();
    const { data: contract } = await admin
      .from('contracts')
      .select('id, title, contract_type, hourly_rate, fixed_price, client_id, freelancer_id')
      .eq('id', contractId)
      .single();

    if (!contract) return;

    const { data: clientAuth } = await admin.auth.admin.getUserById(contract.client_id);
    const clientEmail = clientAuth?.user?.email;

    const { data: clientProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', contract.client_id)
      .maybeSingle();

    const { data: freelancerAuth } = await admin.auth.admin.getUserById(contract.freelancer_id);
    const { data: freelancerProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', contract.freelancer_id)
      .maybeSingle();

    const clientName = clientProfile?.full_name || 'Client';
    const freelancerName =
      freelancerProfile?.full_name ||
      freelancerAuth?.user?.user_metadata?.full_name ||
      'Specialist';

    const rateOrAmount =
      contract.contract_type === 'hourly'
        ? `$${contract.hourly_rate || 0}/hr`
        : `$${contract.fixed_price || 0}`;

    // Send to client
    if (clientEmail) {
      await queueAndDispatchEmail({
        eventType: 'contract_started',
        templateKey: 'contract_started_v1',
        recipientEmail: clientEmail,
        recipientUserId: contract.client_id,
        subject: `Contract Active: Collaboration begun for "${contract.title}"`,
        payload: {
          recipientName: clientName,
          counterpartName: freelancerName,
          jobTitle: contract.title,
          contractId: contract.id,
          contractType: contract.contract_type,
          rateOrAmount,
          role: 'client',
          accountState: 'existing_account',
        },
        relatedEntityId: contract.id,
        idempotencyKey: `email:contract_started:${contract.id}:client`,
        immediate: true,
      });
    }

    // Trigger outbox drain so all related trigger emails dispatch
    triggerOutboxDrain(5).catch(() => {});
  } catch (err) {
    console.warn('[CONTRACT STARTED EMAIL NOTICE]:', err);
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

    const isFreelancer = contract.freelancer_id === userId;
    const isClient = contract.client_id === userId;

    if (!isFreelancer && !isClient) {
      return { success: false, error: 'Only the invited freelancer or client can decline this offer.' };
    }

    if (contract.status !== 'pending_offer' && contract.status !== 'pending') {
      return { success: false, error: `This offer is in status "${contract.status}" and cannot be declined.` };
    }

    const nowIso = new Date().toISOString();
    const targetStatus = isFreelancer ? 'declined' : 'cancelled';

    // Attempt primary update with offer metadata
    let updateErr = null;
    try {
      const { error: fullUpdateErr } = await admin
        .from('contracts')
        .update({
          status: targetStatus,
          declined_reason: reason?.trim() || null,
          offer_declined_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', contractId);
      updateErr = fullUpdateErr;
    } catch (e: unknown) {
      updateErr = e instanceof Error ? e : new Error(String(e));
    }

    // Fallback if declined_reason or offer_declined_at column is missing from schema
    if (updateErr) {
      const { error: simpleUpdateErr } = await admin
        .from('contracts')
        .update({
          status: targetStatus,
          updated_at: nowIso,
        })
        .eq('id', contractId);

      if (simpleUpdateErr) {
        return { success: false, error: simpleUpdateErr.message };
      }
    }

    // Sync proposal if applicable
    if (contract.proposal_id) {
      try {
        await admin
          .from('proposals')
          .update({ status: 'rejected', updated_at: nowIso })
          .eq('id', contract.proposal_id);
      } catch {
        // non-blocking
      }
    }

    // Notify counterpart
    const notifyTargetUserId = isFreelancer ? contract.client_id : contract.freelancer_id;
    if (notifyTargetUserId) {
      await createNotification({
        userId: notifyTargetUserId,
        type: 'contract_offer_declined',
        title: isFreelancer ? 'Contract Offer Declined' : 'Contract Offer Revoked',
        message: isFreelancer
          ? `Your contract offer for "${contract.title}" was declined by the freelancer.`
          : `The contract offer for "${contract.title}" was withdrawn by the client.`,
        link: `/contracts/${contractId}`,
        metadata: { actor_id: userId, contract_id: contractId },
      }).catch(() => {});
    }

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

export interface UpdateContractOfferPriceInput {
  contractId: string;
  fixedPrice?: number | null;
  hourlyRate?: number | null;
  weeklyHourLimit?: number | null;
  offerMessage?: string | null;
}

export interface UpdateContractOfferPriceResult {
  success: boolean;
  error?: string;
  code?: string;
}

/**
 * Revise or update the price and terms of a pending contract offer.
 * Allows client and freelancer to adjust terms finalized during consultations or meetings.
 */
export async function updateContractOfferPrice(
  input: UpdateContractOfferPriceInput
): Promise<UpdateContractOfferPriceResult> {
  if (!input.contractId || !UUID_REGEX.test(input.contractId.trim())) {
    return { success: false, error: 'Invalid contract ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to revise offer terms.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    let admin: SupabaseClient;
    try {
      admin = getAdminSupabaseClient();
    } catch {
      admin = supabase;
    }

    // 1. Fetch existing contract to verify status and ownership
    const { data: contract, error: cErr } = await admin
      .from('contracts')
      .select('id, proposal_id, job_id, client_id, company_id, freelancer_id, contract_type, title, status, fixed_price, hourly_rate')
      .eq('id', input.contractId.trim())
      .single();

    if (cErr || !contract) {
      return { success: false, error: 'Contract not found.', code: 'NOT_FOUND' };
    }

    // 2. Authorization check
    let isClientAuthorized = contract.client_id === user.id;
    if (!isClientAuthorized && contract.company_id) {
      const { data: member } = await admin
        .from('company_members')
        .select('id, role')
        .eq('company_id', contract.company_id)
        .eq('user_id', user.id)
        .single();
      if (member && ['owner', 'admin', 'hiring_manager'].includes(member.role)) {
        isClientAuthorized = true;
      }
    }

    if (!isClientAuthorized) {
      return {
        success: false,
        error: 'Only the client who created this job offer can revise its terms.',
        code: 'UNAUTHORIZED',
      };
    }

    // 3. Status check: Only pending_offer can be revised
    if (contract.status !== 'pending_offer') {
      return {
        success: false,
        error: `Only pending offers can be revised. This contract is currently "${contract.status}".`,
        code: 'INVALID_STATUS',
      };
    }

    // 4. Validate revised pricing
    const isFixed = contract.contract_type === 'fixed';
    const fixedNum = isFixed ? Number(input.fixedPrice) : null;
    const hourlyNum = !isFixed ? Number(input.hourlyRate) : null;

    if (isFixed && (!fixedNum || fixedNum <= 0)) {
      return {
        success: false,
        error: 'Please specify a valid fixed price greater than $0.',
        code: 'INVALID_PRICE',
      };
    }

    if (!isFixed && (!hourlyNum || hourlyNum <= 0)) {
      return {
        success: false,
        error: 'Please specify a valid hourly rate greater than $0.',
        code: 'INVALID_RATE',
      };
    }

    // 5. Update contracts table
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (isFixed) {
      updatePayload.fixed_price = fixedNum;
    } else {
      updatePayload.hourly_rate = hourlyNum;
      if (input.weeklyHourLimit !== undefined) {
        updatePayload.weekly_hour_limit = input.weeklyHourLimit ? Number(input.weeklyHourLimit) : null;
      }
    }

    if (input.offerMessage !== undefined) {
      updatePayload.offer_message = input.offerMessage?.trim() || null;
    }

    const { error: updateErr } = await admin
      .from('contracts')
      .update(updatePayload)
      .eq('id', contract.id);

    if (updateErr) {
      return {
        success: false,
        error: `Failed to update contract offer: ${updateErr.message}`,
        code: updateErr.code,
      };
    }

    // 6. If fixed price, also synchronize planned milestone in contract_milestones
    if (isFixed && fixedNum) {
      const { error: msErr } = await admin
        .from('contract_milestones')
        .update({
          amount: fixedNum,
          updated_at: new Date().toISOString(),
        })
        .eq('contract_id', contract.id)
        .eq('status', 'planned');

      if (msErr) {
        console.warn('contract_milestones sync notice on price revision:', msErr.message);
      }
    }

    // 7. Deliver notification to freelancer
    try {
      const formattedPrice = isFixed ? `$${fixedNum}` : `$${hourlyNum}/hr`;
      await admin.from('notifications').insert({
        user_id: contract.freelancer_id,
        type: 'contract_offer',
        title: 'Contract Offer Revised',
        message: `The client revised the agreed offer price to ${formattedPrice} for "${contract.title}".`,
        data: {
          contractId: contract.id,
          proposalId: contract.proposal_id,
          amount: isFixed ? fixedNum : hourlyNum,
          contractType: contract.contract_type,
        },
      });
    } catch {
      // Non-blocking notification insert
    }

    // 8. Revalidate paths for real-time synchronization
    revalidatePath(`/contracts/${contract.id}`);
    revalidatePath('/contracts');
    revalidatePath('/freelancer');
    revalidatePath('/client');

    return {
      success: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error updating offer price.';
    return { success: false, error: message };
  }
}
