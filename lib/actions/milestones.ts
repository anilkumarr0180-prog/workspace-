'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  ContractMilestone,
  DeliveryAttachment,
  MilestoneDelivery,
  MilestoneStatus,
  PaymentLedgerEntry,
} from '@/lib/types';
import { createNotification } from '@/lib/actions/notifications';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MilestoneResult {
  success: boolean;
  milestone?: ContractMilestone;
  error?: string;
  code?: string;
}

export interface MilestonesListResult {
  success: boolean;
  milestones: ContractMilestone[];
  error?: string;
  code?: string;
}

export interface DeliveryResult {
  success: boolean;
  delivery?: MilestoneDelivery;
  error?: string;
  code?: string;
}

export interface DeliveriesListResult {
  success: boolean;
  deliveries: MilestoneDelivery[];
  error?: string;
  code?: string;
}

export interface LedgerListResult {
  success: boolean;
  entries: PaymentLedgerEntry[];
  error?: string;
  code?: string;
}

interface RawDeliveryRow {
  id: string;
  milestone_id: string;
  freelancer_id: string;
  delivery_notes: string;
  attachments: unknown;
  submitted_at: string;
  review_status: string;
  client_feedback?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  version: number;
  created_at: string;
  profiles?: { full_name?: string | null; avatar_url?: string | null } | Array<{ full_name?: string | null; avatar_url?: string | null }> | null;
}

interface RawMilestoneRow {
  id: string;
  contract_id: string;
  client_id: string;
  freelancer_id: string;
  title: string;
  description: string;
  amount: number | string;
  currency: string;
  sequence_order: number;
  due_date?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  client?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  freelancer?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  milestone_deliveries?: RawDeliveryRow[] | null;
}

interface RawLedgerRow {
  id: string;
  contract_id: string;
  milestone_id?: string | null;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount: number | string;
  currency: string;
  event_type: string;
  status: string;
  description: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  from_profile?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  to_profile?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  milestones?: { title?: string | null } | Array<{ title?: string | null }> | null;
}

function parseAttachments(val: unknown): DeliveryAttachment[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.filter(
      (item) => typeof item === 'object' && item !== null && typeof item.url === 'string' && typeof item.title === 'string'
    ) as DeliveryAttachment[];
  }
  return [];
}

function mapDeliveryRow(row: RawDeliveryRow): MilestoneDelivery {
  const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    freelancerId: row.freelancer_id,
    freelancerName: profileObj?.full_name || undefined,
    freelancerAvatar: profileObj?.avatar_url || null,
    deliveryNotes: row.delivery_notes,
    attachments: parseAttachments(row.attachments),
    submittedAt: row.submitted_at,
    reviewStatus: row.review_status as MilestoneDelivery['reviewStatus'],
    clientFeedback: row.client_feedback || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    version: row.version,
    createdAt: row.created_at,
  };
}

function mapMilestoneRow(row: RawMilestoneRow): ContractMilestone {
  const clientObj = Array.isArray(row.client) ? row.client[0] : row.client;
  const freelancerObj = Array.isArray(row.freelancer) ? row.freelancer[0] : row.freelancer;
  const deliveries = (row.milestone_deliveries || []).map(mapDeliveryRow);

  return {
    id: row.id,
    contractId: row.contract_id,
    clientId: row.client_id,
    clientName: clientObj?.full_name || undefined,
    freelancerId: row.freelancer_id,
    freelancerName: freelancerObj?.full_name || undefined,
    title: row.title,
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    sequenceOrder: row.sequence_order,
    dueDate: row.due_date || null,
    status: row.status as MilestoneStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveries,
  };
}

/**
 * Fetch all milestones for a contract including their delivery histories.
 */
export async function getContractMilestones(contractId: string): Promise<MilestonesListResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, milestones: [], error: 'Invalid contract ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, milestones: [], error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  try {
    const { data, error } = await supabase
      .from('contract_milestones')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        title,
        description,
        amount,
        currency,
        sequence_order,
        due_date,
        status,
        created_at,
        updated_at,
        client:profiles!client_id (full_name),
        freelancer:profiles!freelancer_id (full_name),
        milestone_deliveries (
          id,
          milestone_id,
          freelancer_id,
          delivery_notes,
          attachments,
          submitted_at,
          review_status,
          client_feedback,
          reviewed_by,
          reviewed_at,
          version,
          created_at,
          profiles:profiles!freelancer_id (full_name, avatar_url)
        )
      `)
      .eq('contract_id', contractId.trim())
      .order('sequence_order', { ascending: true });

    if (error) {
      return { success: false, milestones: [], error: error.message, code: error.code };
    }

    const mapped = ((data as unknown as RawMilestoneRow[]) || []).map(mapMilestoneRow);

    // If no milestones exist on a fixed-price contract, idempotently initialize Milestone 1
    if (mapped.length === 0) {
      const { data: contract } = await supabase
        .from('contracts')
        .select('id, client_id, freelancer_id, title, contract_type, fixed_price, status')
        .eq('id', contractId.trim())
        .maybeSingle();

      if (
        contract &&
        contract.contract_type === 'fixed' &&
        contract.fixed_price &&
        Number(contract.fixed_price) > 0 &&
        contract.status !== 'cancelled'
      ) {
        await supabase.from('contract_milestones').insert({
          contract_id: contract.id,
          client_id: contract.client_id,
          freelancer_id: contract.freelancer_id,
          title: 'Milestone 1: Project Deliverables',
          description: `Full scope and agreed deliverables for contract: ${contract.title}`,
          amount: Number(contract.fixed_price),
          currency: 'USD',
          sequence_order: 1,
          status: 'planned',
        });

        const { data: refetched } = await supabase
          .from('contract_milestones')
          .select(`
            id,
            contract_id,
            client_id,
            freelancer_id,
            title,
            description,
            amount,
            currency,
            sequence_order,
            due_date,
            status,
            created_at,
            updated_at,
            client:profiles!client_id (full_name),
            freelancer:profiles!freelancer_id (full_name),
            milestone_deliveries (
              id,
              milestone_id,
              freelancer_id,
              delivery_notes,
              attachments,
              submitted_at,
              review_status,
              client_feedback,
              reviewed_by,
              reviewed_at,
              version,
              created_at,
              profiles:profiles!freelancer_id (full_name, avatar_url)
            )
          `)
          .eq('contract_id', contractId.trim())
          .order('sequence_order', { ascending: true });

        if (refetched && refetched.length > 0) {
          const remapped = ((refetched as unknown as RawMilestoneRow[]) || []).map(mapMilestoneRow);
          return { success: true, milestones: remapped };
        }
      }
    }

    // Sort deliveries within each milestone newest version first
    for (const m of mapped) {
      if (m.deliveries) {
        m.deliveries.sort((a, b) => b.version - a.version);
      }
    }

    return { success: true, milestones: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch contract milestones.';
    return { success: false, milestones: [], error: message };
  }
}

/**
 * Fetch delivery history for a single milestone.
 */
export async function getMilestoneDeliveries(milestoneId: string): Promise<DeliveriesListResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, deliveries: [], error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, deliveries: [], error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  try {
    const { data, error } = await supabase
      .from('milestone_deliveries')
      .select(`
        id,
        milestone_id,
        freelancer_id,
        delivery_notes,
        attachments,
        submitted_at,
        review_status,
        client_feedback,
        reviewed_by,
        reviewed_at,
        version,
        created_at,
        profiles:profiles!freelancer_id (full_name, avatar_url)
      `)
      .eq('milestone_id', milestoneId.trim())
      .order('version', { ascending: false });

    if (error) {
      return { success: false, deliveries: [], error: error.message, code: error.code };
    }

    const mapped = ((data as unknown as RawDeliveryRow[]) || []).map(mapDeliveryRow);
    return { success: true, deliveries: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch deliveries.';
    return { success: false, deliveries: [], error: message };
  }
}

/**
 * Create a new planned milestone for a fixed-price contract within remaining budget.
 */
export async function createMilestone(
  contractId: string,
  input: {
    title: string;
    description?: string;
    amount: number;
    dueDate?: string | null;
  }
): Promise<MilestoneResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, error: 'Invalid contract ID format.', code: 'INVALID_ID' };
  }

  if (!input.title || input.title.trim().length < 3) {
    return { success: false, error: 'Milestone title must be at least 3 characters.', code: 'INVALID_INPUT' };
  }

  const amount = Number(input.amount);
  if (isNaN(amount) || amount <= 0) {
    return { success: false, error: 'Milestone amount must be a positive number.', code: 'INVALID_INPUT' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to create milestones.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Authoritative contract check
    const { data: contract, error: contractErr } = await supabase
      .from('contracts')
      .select('id, contract_type, fixed_price, status')
      .eq('id', contractId.trim())
      .maybeSingle();

    if (contractErr || !contract) {
      return { success: false, error: 'Contract not found or inaccessible.', code: 'NOT_FOUND' };
    }

    if (contract.contract_type !== 'fixed') {
      return {
        success: false,
        error: 'Milestones can only be created on fixed-price contracts.',
        code: 'INELIGIBLE_CONTRACT',
      };
    }

    if (contract.status === 'cancelled') {
      return {
        success: false,
        error: 'Cannot add milestones to a cancelled contract.',
        code: 'INELIGIBLE_CONTRACT',
      };
    }

    // 2. Budget cap validation: prevent milestone totals from exceeding agreed fixed budget
    const { data: existingMilestones } = await supabase
      .from('contract_milestones')
      .select('amount, status')
      .eq('contract_id', contractId.trim())
      .neq('status', 'cancelled');

    const totalAllocated = (existingMilestones || []).reduce((acc, m) => acc + Number(m.amount), 0);
    const fixedBudget = Number(contract.fixed_price) || 0;
    const remainingBudget = Math.max(0, fixedBudget - totalAllocated);

    if (fixedBudget > 0 && totalAllocated + amount > fixedBudget + 0.009) {
      return {
        success: false,
        error: `Milestone amount ($${amount.toFixed(2)}) exceeds remaining contract budget ($${remainingBudget.toFixed(2)} remaining of $${fixedBudget.toFixed(2)}).`,
        code: 'BUDGET_EXCEEDED',
      };
    }

    const { data, error } = await supabase.rpc('create_milestone', {
      p_contract_id: contractId.trim(),
      p_title: input.title.trim(),
      p_description: input.description?.trim() || '',
      p_amount: amount,
      p_due_date: input.dueDate || null,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;
    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
        deliveries: [],
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create milestone.';
    return { success: false, error: message };
  }
}

/**
 * Deposit funds into simulated escrow for a milestone.
 */
export async function fundMilestone(milestoneId: string): Promise<MilestoneResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to fund milestones.', code: 'UNAUTHENTICATED' };
  }

  // Protect against simulated funding bypassing real payments in production
  const isProduction = process.env.NODE_ENV === 'production';
  const allowSimulated = process.env.ENABLE_SIMULATED_PAYMENTS === 'true' || process.env.NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS === 'true';

  if (isProduction && !allowSimulated) {
    return {
      success: false,
      error: 'Simulated escrow funding is disabled in production. Please use Razorpay to fund milestones.',
      code: 'SIMULATED_PAYMENTS_DISABLED',
    };
  }

  try {
    // Authorize caller against milestone and parent contract
    const { data: milestoneData, error: milestoneError } = await supabase
      .from('contract_milestones')
      .select('id, client_id, status, contracts:contract_id (id, client_id, company_id)')
      .eq('id', milestoneId.trim())
      .single();

    if (milestoneError || !milestoneData) {
      return { success: false, error: 'Milestone not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(milestoneData.contracts) ? milestoneData.contracts[0] : milestoneData.contracts;
    const isDirectClient = milestoneData.client_id === user.id || rawContract?.client_id === user.id;

    if (!isDirectClient) {
      if (rawContract?.company_id) {
        const { data: membership } = await supabase
          .from('company_members')
          .select('role')
          .eq('company_id', rawContract.company_id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!membership || !['owner', 'admin', 'hiring_manager'].includes(membership.role)) {
          return { success: false, error: 'You are not authorized to fund this milestone.', code: 'FORBIDDEN' };
        }
      } else {
        return { success: false, error: 'You are not authorized to fund this milestone.', code: 'FORBIDDEN' };
      }
    }

    const adminSupabase = getAdminSupabaseClient();
    const { data, error } = await adminSupabase.rpc('fund_milestone', {
      p_milestone_id: milestoneId.trim(),
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;

    if (raw.freelancer_id) {
      createNotification({
        userId: raw.freelancer_id,
        type: 'milestone_funded',
        title: 'Milestone Funded',
        message: `Milestone "${raw.title}" ($${raw.amount}) has been funded into escrow. You can begin work.`,
        link: `/contracts/${raw.contract_id}`,
        metadata: { milestoneId: raw.id, contractId: raw.contract_id, amount: raw.amount },
      }).catch(() => {});
    }

    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fund milestone.';
    return { success: false, error: message };
  }
}

/**
 * Freelancer/Client marks funded milestone as active in progress.
 */
export async function startMilestoneWork(milestoneId: string): Promise<MilestoneResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
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
    const { data, error } = await supabase.rpc('start_milestone_work', {
      p_milestone_id: milestoneId.trim(),
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;
    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start milestone work.';
    return { success: false, error: message };
  }
}

/**
 * Submit work delivery for a funded or in_progress milestone.
 */
export async function submitMilestoneDelivery(
  milestoneId: string,
  input: {
    deliveryNotes: string;
    attachments?: DeliveryAttachment[];
  }
): Promise<DeliveryResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  if (!input.deliveryNotes || input.deliveryNotes.trim().length < 5) {
    return {
      success: false,
      error: 'Please provide detailed delivery notes (minimum 5 characters).',
      code: 'INVALID_INPUT',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to submit work.', code: 'UNAUTHENTICATED' };
  }

  // Sanitize and validate attachments
  const attachments = (input.attachments || []).map((att) => ({
    title: att.title?.trim() || 'Deliverable Link',
    url: att.url?.trim(),
    type: att.type || 'link',
  })).filter((att) => Boolean(att.url));

  try {
    const { data, error } = await supabase.rpc('submit_milestone_delivery', {
      p_milestone_id: milestoneId.trim(),
      p_delivery_notes: input.deliveryNotes.trim(),
      p_attachments: attachments,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawDeliveryRow;

    // Fetch milestone details for client notification
    const { data: milestoneInfo } = await supabase
      .from('milestones')
      .select('id, contract_id, client_id, title')
      .eq('id', milestoneId.trim())
      .maybeSingle();

    if (milestoneInfo?.client_id) {
      createNotification({
        userId: milestoneInfo.client_id,
        type: 'milestone_work_submitted',
        title: 'Deliverables Submitted',
        message: `Work has been submitted for milestone "${milestoneInfo.title || 'Milestone'}". Please review deliverables.`,
        link: `/contracts/${milestoneInfo.contract_id}`,
        metadata: { milestoneId: milestoneInfo.id, contractId: milestoneInfo.contract_id, deliveryId: raw.id },
      }).catch(() => {});
    }

    return {
      success: true,
      delivery: {
        id: raw.id,
        milestoneId: raw.milestone_id,
        freelancerId: raw.freelancer_id,
        deliveryNotes: raw.delivery_notes,
        attachments: parseAttachments(raw.attachments),
        submittedAt: raw.submitted_at,
        reviewStatus: raw.review_status as MilestoneDelivery['reviewStatus'],
        version: raw.version,
        createdAt: raw.created_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to submit milestone delivery.';
    return { success: false, error: message };
  }
}

/**
 * Client requests revision/changes on submitted work.
 */
export async function requestMilestoneRevision(
  milestoneId: string,
  input: {
    feedback: string;
    deliveryId?: string;
  }
): Promise<MilestoneResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  if (!input.feedback || input.feedback.trim().length < 5) {
    return {
      success: false,
      error: 'Please describe the requested changes clearly (minimum 5 characters).',
      code: 'INVALID_INPUT',
    };
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
    const { data, error } = await supabase.rpc('request_milestone_revision', {
      p_milestone_id: milestoneId.trim(),
      p_feedback: input.feedback.trim(),
      p_delivery_id: input.deliveryId || null,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;

    if (raw.freelancer_id) {
      createNotification({
        userId: raw.freelancer_id,
        type: 'milestone_revision_requested',
        title: 'Revision Requested',
        message: `Client requested revisions for milestone "${raw.title}".`,
        link: `/contracts/${raw.contract_id}`,
        metadata: { milestoneId: raw.id, contractId: raw.contract_id },
      }).catch(() => {});
    }

    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to request milestone revision.';
    return { success: false, error: message };
  }
}

/**
 * Client approves work and releases escrow payout.
 */
export async function approveAndReleaseMilestone(
  milestoneId: string,
  input: {
    feedback?: string;
    deliveryId?: string;
  } = {}
): Promise<MilestoneResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
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
    const { data, error } = await supabase.rpc('approve_and_release_milestone', {
      p_milestone_id: milestoneId.trim(),
      p_feedback: input.feedback?.trim() || 'Approved by client',
      p_delivery_id: input.deliveryId || null,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;

    if (raw.freelancer_id) {
      createNotification({
        userId: raw.freelancer_id,
        type: 'milestone_approved',
        title: 'Milestone Approved & Released',
        message: `Milestone "${raw.title}" ($${raw.amount}) has been approved and funds released.`,
        link: `/contracts/${raw.contract_id}`,
        metadata: { milestoneId: raw.id, contractId: raw.contract_id, amount: raw.amount },
      }).catch(() => {});
    }

    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve and release milestone.';
    return { success: false, error: message };
  }
}

/**
 * Cancel a planned or funded milestone (with automatic escrow refund if funded).
 */
export async function cancelMilestone(milestoneId: string, reason: string = ''): Promise<MilestoneResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
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
    const { data, error } = await supabase.rpc('cancel_milestone', {
      p_milestone_id: milestoneId.trim(),
      p_reason: reason.trim(),
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = data as RawMilestoneRow;
    return {
      success: true,
      milestone: {
        id: raw.id,
        contractId: raw.contract_id,
        clientId: raw.client_id,
        freelancerId: raw.freelancer_id,
        title: raw.title,
        description: raw.description,
        amount: Number(raw.amount),
        currency: raw.currency,
        sequenceOrder: raw.sequence_order,
        dueDate: raw.due_date || null,
        status: raw.status as MilestoneStatus,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to cancel milestone.';
    return { success: false, error: message };
  }
}

/**
 * Fetch simulated payment ledger audit trail for a contract.
 */
export async function getContractPaymentLedger(contractId: string): Promise<LedgerListResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, entries: [], error: 'Invalid contract ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, entries: [], error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  try {
    const { data, error } = await supabase
      .from('payment_ledger')
      .select(`
        id,
        contract_id,
        milestone_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata,
        created_at,
        from_profile:profiles!from_user_id (full_name),
        to_profile:profiles!to_user_id (full_name),
        milestones:contract_milestones!milestone_id (title)
      `)
      .eq('contract_id', contractId.trim())
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, entries: [], error: error.message, code: error.code };
    }

    const mapped: PaymentLedgerEntry[] = ((data as unknown as RawLedgerRow[]) || []).map((row) => {
      const fromObj = Array.isArray(row.from_profile) ? row.from_profile[0] : row.from_profile;
      const toObj = Array.isArray(row.to_profile) ? row.to_profile[0] : row.to_profile;
      const mObj = Array.isArray(row.milestones) ? row.milestones[0] : row.milestones;

      return {
        id: row.id,
        contractId: row.contract_id,
        milestoneId: row.milestone_id || null,
        milestoneTitle: mObj?.title || null,
        fromUserId: row.from_user_id || null,
        fromUserName: fromObj?.full_name || (row.from_user_id ? 'Client' : 'Workspace Escrow Pool'),
        toUserId: row.to_user_id || null,
        toUserName: toObj?.full_name || (row.to_user_id ? 'Freelancer' : 'Workspace Platform Escrow'),
        amount: Number(row.amount),
        currency: row.currency,
        eventType: row.event_type as PaymentLedgerEntry['eventType'],
        status: row.status as PaymentLedgerEntry['status'],
        description: row.description,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      };
    });

    return { success: true, entries: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch ledger entries.';
    return { success: false, entries: [], error: message };
  }
}
