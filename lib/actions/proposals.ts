'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { ProjectType } from '@/lib/types';
import { createNotification } from '@/lib/actions/notifications';

export interface SubmitProposalInput {
  jobId: string;
  bidAmount: number;
  rateType: ProjectType;
  deliveryDays?: number;
  coverLetter: string;
}

export interface ProposalRecord {
  id: string;
  jobId: string;
  jobTitle?: string;
  freelancerId: string;
  freelancerName?: string;
  freelancerUsername?: string;
  freelancerAvatar?: string;
  freelancerTitle?: string;
  bidAmount: number;
  rateType: ProjectType;
  deliveryDays: number | null;
  coverLetter: string;
  status: 'submitted' | 'under_review' | 'interviewing' | 'accepted' | 'rejected' | 'withdrawn';
  isShortlisted?: boolean;
  shortlistedAt?: string | null;
  declinedReason?: string | null;
  clientNotes?: string | null;
  jobStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetProposalsFilters {
  jobId?: string;
  as?: 'freelancer' | 'client';
  status?: string;
  isShortlisted?: boolean;
  pipelineTab?: 'all' | 'shortlisted' | 'interviewing' | 'archived';
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valid proposal status transitions defined by the database state machine.
 */
const VALID_TRANSITIONS: Record<string, { freelancer: string[]; client: string[] }> = {
  submitted: {
    freelancer: ['withdrawn'],
    client: ['under_review', 'interviewing', 'rejected'],
  },
  under_review: {
    freelancer: ['withdrawn'],
    client: ['interviewing', 'accepted', 'rejected'],
  },
  interviewing: {
    freelancer: ['withdrawn'],
    client: ['accepted', 'rejected'],
  },
  accepted: {
    freelancer: [],
    client: [],
  },
  rejected: {
    freelancer: [],
    client: [],
  },
  withdrawn: {
    freelancer: [],
    client: [],
  },
};

/**
 * Submit a proposal for an existing published job.
 * Strictly verifies authentication, validates input bounds, checks for duplicate active proposals,
 * and records the proposal in Supabase.
 */
export async function submitProposal(input: SubmitProposalInput): Promise<{
  success: boolean;
  proposal?: ProposalRecord;
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
}> {
  const fieldErrors: Record<string, string> = {};

  // 1. Input Validation
  if (!input.jobId || !input.jobId.trim()) {
    fieldErrors.jobId = 'Target job ID is required.';
  } else if (!UUID_REGEX.test(input.jobId.trim())) {
    fieldErrors.jobId = 'Target job ID must be a valid project UUID.';
  }

  const bid = Number(input.bidAmount);
  if (!bid || isNaN(bid) || bid <= 0) {
    fieldErrors.bidAmount = 'Bid amount must be a positive number greater than 0.';
  }

  if (input.rateType !== 'fixed' && input.rateType !== 'hourly') {
    fieldErrors.rateType = 'Rate type must be "fixed" or "hourly".';
  }

  const deliveryDays = input.deliveryDays !== undefined && input.deliveryDays !== null ? Number(input.deliveryDays) : null;
  if (deliveryDays !== null && (isNaN(deliveryDays) || deliveryDays <= 0 || !Number.isInteger(deliveryDays))) {
    fieldErrors.deliveryDays = 'Delivery days must be a positive integer.';
  }

  const trimmedLetter = input.coverLetter?.trim() || '';
  if (!trimmedLetter) {
    fieldErrors.coverLetter = 'Cover letter is required.';
  } else if (trimmedLetter.length < 50) {
    fieldErrors.coverLetter = `Cover letter must be at least 50 characters (currently ${trimmedLetter.length}/50).`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  // 2. Authentication Check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to submit a proposal.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 3. Verify Target Job Exists and is Published
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, title, client_id, company_id, status')
      .eq('id', input.jobId.trim())
      .maybeSingle();

    if (jobError || !job) {
      return {
        success: false,
        error: 'The requested job was not found.',
        code: 'JOB_NOT_FOUND',
      };
    }

    if (job.status !== 'published') {
      return {
        success: false,
        error: `Cannot submit proposal: Job is currently "${job.status}". Proposals can only be submitted for published jobs.`,
        code: 'JOB_NOT_PUBLISHED',
      };
    }

    // Client cannot submit a proposal to their own job
    if (job.client_id === user.id) {
      return {
        success: false,
        error: 'You cannot submit a proposal to a job you posted.',
        code: 'SELF_APPLICATION_FORBIDDEN',
      };
    }

    // Company managers cannot bid on their company's job
    if (job.company_id) {
      const { data: member } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', job.company_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'hiring_manager'])
        .maybeSingle();

      if (member) {
        return {
          success: false,
          error: 'You cannot submit a proposal to a job posted by your company.',
          code: 'SELF_APPLICATION_FORBIDDEN',
        };
      }
    }

    // 4. Verify Freelancer Eligibility (can_work flag on profiles)
    const { data: profile } = await supabase
      .from('profiles')
      .select('can_work, is_suspended')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      if (profile.is_suspended) {
        return {
          success: false,
          error: 'Your account is suspended. You cannot submit proposals.',
          code: 'ACCOUNT_SUSPENDED',
        };
      }
      if (profile.can_work === false) {
        return {
          success: false,
          error: 'Your account profile is not configured for freelancer work.',
          code: 'FREELANCER_MODE_REQUIRED',
        };
      }
    }

    // 5. Check For Duplicate Active Proposal
    const { data: existingActiveProposal } = await supabase
      .from('proposals')
      .select('id, status')
      .eq('job_id', input.jobId.trim())
      .eq('freelancer_id', user.id)
      .not('status', 'in', '("withdrawn","rejected")')
      .maybeSingle();

    if (existingActiveProposal) {
      return {
        success: false,
        error: `You already have an active proposal (${existingActiveProposal.status}) for this job. You must withdraw it before resubmitting.`,
        code: 'DUPLICATE_PROPOSAL',
      };
    }

    // 6. Insert Proposal Record
    const insertPayload = {
      job_id: input.jobId.trim(),
      freelancer_id: user.id,
      bid_amount: bid,
      rate_type: input.rateType,
      delivery_days: deliveryDays,
      cover_letter: trimmedLetter,
      status: 'submitted',
    };

    const { data: newProposal, error: insertError } = await supabase
      .from('proposals')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return {
          success: false,
          error: 'You already have an active proposal submitted for this job.',
          code: 'DUPLICATE_PROPOSAL',
        };
      }
      return {
        success: false,
        error: `Database error: ${insertError.message}`,
        code: insertError.code,
      };
    }

    if (job.client_id) {
      createNotification({
        userId: job.client_id,
        type: 'proposal_received',
        title: 'New Proposal Received',
        message: `A freelancer submitted a proposal for "${job.title}".`,
        link: `/client`,
        metadata: { jobId: job.id, proposalId: newProposal.id },
      }).catch(() => {});
    }

    return {
      success: true,
      proposal: {
        id: newProposal.id,
        jobId: newProposal.job_id,
        jobTitle: job.title,
        freelancerId: newProposal.freelancer_id,
        bidAmount: Number(newProposal.bid_amount),
        rateType: newProposal.rate_type as ProjectType,
        deliveryDays: newProposal.delivery_days ? Number(newProposal.delivery_days) : null,
        coverLetter: newProposal.cover_letter,
        status: newProposal.status,
        createdAt: newProposal.created_at,
        updatedAt: newProposal.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while submitting the proposal.';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * List proposals for an authorized job or for the authenticated freelancer / authorized client.
 */
export async function getProposals(filters: GetProposalsFilters = {}): Promise<{
  proposals: ProposalRecord[];
  total: number;
  source: 'supabase' | 'fallback';
  error?: string;
  code?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      proposals: [],
      total: 0,
      source: 'fallback',
      error: 'Authentication required to view proposals.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    let db = supabase;
    try {
      const admin = getAdminSupabaseClient();
      if (admin) db = admin;
    } catch {
      // Safe fallback to session client if service role key is unconfigured
    }

    let targetJobIds: string[] = [];
    let freelancerFilterId: string | null = null;

    if (filters.jobId) {
      if (!UUID_REGEX.test(filters.jobId.trim())) {
        return { proposals: [], total: 0, source: 'supabase', error: 'Job not found', code: 'NOT_FOUND' };
      }

      // Verify job ownership
      const { data: targetJob } = await db
        .from('jobs')
        .select('id, client_id, company_id, status')
        .eq('id', filters.jobId.trim())
        .maybeSingle();

      if (!targetJob) {
        return { proposals: [], total: 0, source: 'supabase', error: 'Job not found', code: 'NOT_FOUND' };
      }

      let isClientManager = targetJob.client_id === user.id;

      if (!isClientManager && targetJob.company_id) {
        const { data: member } = await db
          .from('company_members')
          .select('role')
          .eq('company_id', targetJob.company_id)
          .eq('user_id', user.id)
          .in('role', ['owner', 'admin', 'hiring_manager'])
          .maybeSingle();

        if (member) isClientManager = true;
      }

      if (filters.as === 'client') {
        if (!isClientManager) {
          return {
            proposals: [],
            total: 0,
            source: 'supabase',
            error: 'Unauthorized: You do not have permission to view proposals for this job.',
            code: 'FORBIDDEN',
          };
        }
        targetJobIds = [filters.jobId.trim()];
      } else if (filters.as === 'freelancer') {
        targetJobIds = [filters.jobId.trim()];
        freelancerFilterId = user.id;
      } else {
        targetJobIds = [filters.jobId.trim()];
        if (!isClientManager) {
          freelancerFilterId = user.id;
        }
      }
    } else {
      // No specific jobId provided
      if (filters.as === 'client') {
        const { data: userCompanies } = await db
          .from('company_members')
          .select('company_id')
          .eq('user_id', user.id)
          .in('role', ['owner', 'admin', 'hiring_manager']);

        const companyIds = (userCompanies || []).map((c) => c.company_id);

        let jobQuery = db.from('jobs').select('id');
        if (companyIds.length > 0) {
          jobQuery = jobQuery.or(`client_id.eq.${user.id},company_id.in.(${companyIds.join(',')})`);
        } else {
          jobQuery = jobQuery.eq('client_id', user.id);
        }

        const { data: clientJobs } = await jobQuery;
        targetJobIds = (clientJobs || []).map((j) => j.id);

        if (targetJobIds.length === 0) {
          return { proposals: [], total: 0, source: 'supabase' };
        }
      } else {
        freelancerFilterId = user.id;
      }
    }

    let propQuery = db.from('proposals').select('*');

    if (targetJobIds.length === 1) {
      propQuery = propQuery.eq('job_id', targetJobIds[0]);
    } else if (targetJobIds.length > 1) {
      propQuery = propQuery.in('job_id', targetJobIds);
    }

    if (freelancerFilterId) {
      propQuery = propQuery.eq('freelancer_id', freelancerFilterId);
    }

    if (filters.status) {
      propQuery = propQuery.eq('status', filters.status);
    }

    if (filters.isShortlisted !== undefined) {
      propQuery = propQuery.eq('is_shortlisted', filters.isShortlisted);
    }

    if (filters.pipelineTab === 'shortlisted') {
      propQuery = propQuery.eq('is_shortlisted', true).neq('status', 'withdrawn');
    } else if (filters.pipelineTab === 'interviewing') {
      propQuery = propQuery.eq('status', 'interviewing');
    } else if (filters.pipelineTab === 'archived') {
      propQuery = propQuery.in('status', ['rejected', 'withdrawn']);
    }

    propQuery = propQuery.order('created_at', { ascending: false });

    let { data: rawProposals, error: propError } = await propQuery;

    // Graceful recovery if pipelineTab filter failed due to unapplied is_shortlisted column
    if (propError && (filters.isShortlisted !== undefined || filters.pipelineTab === 'shortlisted')) {
      let retryQuery = db.from('proposals').select('*');
      if (targetJobIds.length === 1) {
        retryQuery = retryQuery.eq('job_id', targetJobIds[0]);
      } else if (targetJobIds.length > 1) {
        retryQuery = retryQuery.in('job_id', targetJobIds);
      }
      if (freelancerFilterId) {
        retryQuery = retryQuery.eq('freelancer_id', freelancerFilterId);
      }
      if (filters.status) {
        retryQuery = retryQuery.eq('status', filters.status);
      }
      retryQuery = retryQuery.order('created_at', { ascending: false });
      const retryRes = await retryQuery;
      if (!retryRes.error) {
        rawProposals = retryRes.data;
        propError = null;
      }
    }

    if (propError) {
      console.error('[PROPOSALS] Direct proposals query error:', propError.message);
      return { proposals: [], total: 0, source: 'supabase', error: propError.message };
    }

    const rows = rawProposals || [];
    const freelancerIds = [...new Set(rows.map((p) => p.freelancer_id).filter(Boolean))];
    const profMap = new Map<
      string,
      {
        id: string;
        full_name?: string | null;
        avatar_url?: string | null;
        username?: string | null;
        title?: string | null;
        hourly_rate?: number | null;
      }
    >();

    if (freelancerIds.length > 0) {
      const { data: profs } = await db
        .from('profiles')
        .select('id, full_name, avatar_url, username, title, hourly_rate')
        .in('id', freelancerIds);
      (profs || []).forEach((p) => profMap.set(p.id, p));
    }

    const targetIdsForJobs = [...new Set(rows.map((p) => p.job_id).filter(Boolean))];
    const jobMap = new Map<string, { id: string; title?: string; client_id?: string; company_id?: string | null; status?: string }>();

    if (targetIdsForJobs.length > 0) {
      const { data: jbs } = await db
        .from('jobs')
        .select('id, title, client_id, company_id, status')
        .in('id', targetIdsForJobs);
      (jbs || []).forEach((j) => jobMap.set(j.id, j));
    }

    const mapped: ProposalRecord[] = rows.map((row) => {
      const jobObj = jobMap.get(row.job_id);
      const profileObj = profMap.get(row.freelancer_id);

      return {
        id: row.id,
        jobId: row.job_id,
        jobTitle: jobObj?.title || 'Project Application',
        jobStatus: jobObj?.status || 'published',
        freelancerId: row.freelancer_id,
        freelancerName: profileObj?.full_name || 'Freelancer Specialist',
        freelancerUsername: profileObj?.username || undefined,
        freelancerAvatar: profileObj?.avatar_url || undefined,
        freelancerTitle: profileObj?.title || undefined,
        bidAmount: Number(row.bid_amount),
        rateType: row.rate_type as ProjectType,
        deliveryDays: row.delivery_days ? Number(row.delivery_days) : null,
        coverLetter: row.cover_letter,
        status: row.status,
        isShortlisted: Boolean(row.is_shortlisted),
        shortlistedAt: row.shortlisted_at || null,
        declinedReason: row.declined_reason || null,
        clientNotes: row.client_notes || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return {
      proposals: mapped,
      total: mapped.length,
      source: 'supabase',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve proposals';
    console.error('[PROPOSALS] getProposals exception:', message);
    return { proposals: [], total: 0, source: 'fallback', error: message };
  }
}

/**
 * Update proposal status adhering strictly to the database lifecycle rules.
 */
export async function updateProposalStatus(
  proposalId: string,
  newStatus: string
): Promise<{
  success: boolean;
  proposal?: ProposalRecord;
  error?: string;
  code?: string;
}> {
  const allowedStatuses = ['submitted', 'under_review', 'interviewing', 'accepted', 'rejected', 'withdrawn'];
  if (!allowedStatuses.includes(newStatus)) {
    return {
      success: false,
      error: `Invalid status "${newStatus}". Must be one of: ${allowedStatuses.join(', ')}`,
      code: 'INVALID_STATUS',
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
      error: 'Authentication required to update proposal status.',
      code: 'UNAUTHENTICATED',
    };
  }

  if (!UUID_REGEX.test(proposalId.trim())) {
    return {
      success: false,
      error: 'Proposal not found.',
      code: 'NOT_FOUND',
    };
  }

  try {
    // 1. Fetch current proposal and job relationship
    const { data: proposal, error: fetchError } = await supabase
      .from('proposals')
      .select(
        `
        id,
        job_id,
        freelancer_id,
        bid_amount,
        rate_type,
        delivery_days,
        cover_letter,
        status,
        created_at,
        updated_at,
        jobs (id, title, client_id, company_id, status)
      `
      )
      .eq('id', proposalId.trim())
      .maybeSingle();

    if (fetchError || !proposal) {
      return {
        success: false,
        error: 'Proposal not found.',
        code: 'NOT_FOUND',
      };
    }

    const currentStatus = proposal.status;
    const isFreelancer = proposal.freelancer_id === user.id;

    const job = Array.isArray(proposal.jobs) ? proposal.jobs[0] : proposal.jobs;
    let isClientManager = job?.client_id === user.id;

    if (!isClientManager && job?.company_id) {
      const { data: member } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', job.company_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'hiring_manager'])
        .maybeSingle();

      if (member) isClientManager = true;
    }

    if (!isFreelancer && !isClientManager) {
      return {
        success: false,
        error: 'Unauthorized: You do not have permission to update this proposal.',
        code: 'FORBIDDEN',
      };
    }

    // Terminal states cannot be changed
    if (['accepted', 'rejected', 'withdrawn'].includes(currentStatus)) {
      return {
        success: false,
        error: `Cannot update proposal: It is in terminal state "${currentStatus}".`,
        code: 'TERMINAL_STATE_LOCKED',
      };
    }

    // Disallow Status Changes If Parent Job Is Not Published (except withdrawal by freelancer)
    if (job?.status !== 'published' && newStatus !== 'withdrawn') {
      return {
        success: false,
        error: `Cannot update proposal status while job is ${job?.status || 'unpublished'}.`,
        code: 'JOB_NOT_PUBLISHED',
      };
    }

    // Validate State Transition Matrix
    const rules = VALID_TRANSITIONS[currentStatus];
    const allowedForActor = isFreelancer ? rules?.freelancer || [] : rules?.client || [];

    if (!allowedForActor.includes(newStatus)) {
      const roleStr = isFreelancer ? 'freelancer' : 'client';
      return {
        success: false,
        error: `Illegal transition: A ${roleStr} cannot transition a proposal from "${currentStatus}" to "${newStatus}".`,
        code: 'INVALID_TRANSITION',
      };
    }

    // 2. Execute Status Update (only status column is modified; immutability preserved)
    const { data: updatedProposal, error: updateError } = await supabase
      .from('proposals')
      .update({ status: newStatus })
      .eq('id', proposalId.trim())
      .select()
      .single();

    if (updateError) {
      return {
        success: false,
        error: `Database rejected update: ${updateError.message}`,
        code: updateError.code,
      };
    }

    if (!isFreelancer && proposal.freelancer_id) {
      createNotification({
        userId: proposal.freelancer_id,
        type: 'proposal_status_updated',
        title: 'Proposal Status Updated',
        message: `Your proposal for "${job?.title || 'the job'}" is now ${newStatus.replace('_', ' ')}.`,
        link: `/freelancer`,
        metadata: { proposalId: proposal.id, jobId: proposal.job_id, status: newStatus },
      }).catch(() => {});
    }

    return {
      success: true,
      proposal: {
        id: updatedProposal.id,
        jobId: updatedProposal.job_id,
        jobTitle: job?.title,
        freelancerId: updatedProposal.freelancer_id,
        bidAmount: Number(updatedProposal.bid_amount),
        rateType: updatedProposal.rate_type as ProjectType,
        deliveryDays: updatedProposal.delivery_days ? Number(updatedProposal.delivery_days) : null,
        coverLetter: updatedProposal.cover_letter,
        status: updatedProposal.status,
        isShortlisted: Boolean(updatedProposal.is_shortlisted),
        shortlistedAt: updatedProposal.shortlisted_at || null,
        declinedReason: updatedProposal.declined_reason || null,
        clientNotes: updatedProposal.client_notes || null,
        createdAt: updatedProposal.created_at,
        updatedAt: updatedProposal.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while updating the proposal.';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Toggle shortlist status (thumbs up / favorite) for a candidate proposal.
 */
export async function toggleProposalShortlist(
  proposalId: string,
  isShortlisted: boolean
): Promise<{ success: boolean; isShortlisted?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (!UUID_REGEX.test(proposalId.trim())) {
      return { success: false, error: 'Invalid proposal identifier' };
    }

    const { data, error } = await supabase.rpc('toggle_proposal_shortlist', {
      p_proposal_id: proposalId.trim(),
      p_shortlist: isShortlisted,
    });

    if (!error) {
      return {
        success: true,
        isShortlisted: (data as { is_shortlisted?: boolean })?.is_shortlisted ?? isShortlisted,
      };
    }

    // Direct fallback if RPC is unapplied in database
    let db = supabase;
    try {
      const admin = getAdminSupabaseClient();
      if (admin) db = admin;
    } catch {
      // fallback
    }

    const { error: updateErr } = await db
      .from('proposals')
      .update({
        is_shortlisted: isShortlisted,
        shortlisted_at: isShortlisted ? new Date().toISOString() : null,
      })
      .eq('id', proposalId.trim());

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    return {
      success: true,
      isShortlisted,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update shortlist status';
    return { success: false, error: message };
  }
}

/**
 * Decline / Disqualify a candidate proposal with an optional professional reason.
 */
export async function declineProposal(
  proposalId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (!UUID_REGEX.test(proposalId.trim())) {
      return { success: false, error: 'Invalid proposal identifier' };
    }

    const { error } = await supabase.rpc('decline_proposal', {
      p_proposal_id: proposalId.trim(),
      p_reason: reason?.trim() || null,
    });

    if (!error) {
      return { success: true };
    }

    // Direct fallback if RPC is unapplied in database
    let db = supabase;
    try {
      const admin = getAdminSupabaseClient();
      if (admin) db = admin;
    } catch {
      // fallback
    }

    const { error: updateErr } = await db
      .from('proposals')
      .update({
        status: 'rejected',
        declined_reason: reason?.trim() || null,
      })
      .eq('id', proposalId.trim());

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to decline proposal';
    return { success: false, error: message };
  }
}

/**
 * Save internal client evaluation notes for a candidate proposal.
 */
export async function saveProposalNotes(
  proposalId: string,
  notes: string
): Promise<{ success: boolean; notes?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    if (!UUID_REGEX.test(proposalId.trim())) {
      return { success: false, error: 'Invalid proposal identifier' };
    }

    const { data, error } = await supabase.rpc('set_proposal_notes', {
      p_proposal_id: proposalId.trim(),
      p_notes: notes,
    });

    if (!error) {
      return {
        success: true,
        notes: (data as { client_notes?: string })?.client_notes ?? notes,
      };
    }

    // Direct fallback if RPC is unapplied in database
    let db = supabase;
    try {
      const admin = getAdminSupabaseClient();
      if (admin) db = admin;
    } catch {
      // fallback
    }

    const { error: updateErr } = await db
      .from('proposals')
      .update({ client_notes: notes.trim() })
      .eq('id', proposalId.trim());

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    return { success: true, notes: notes.trim() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save notes';
    return { success: false, error: message };
  }
}
