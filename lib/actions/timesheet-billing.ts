'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getPaymentProvider } from '@/lib/payments/registry';
import { payoutEngine } from '@/lib/services/payout-engine';
import { createNotification } from '@/lib/actions/notifications';
import { Timesheet, TimesheetStatus, TimeEntry } from '@/lib/types';
import { extractPaymentErrorMessage } from '@/lib/razorpay';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TimesheetWithDetails extends Timesheet {
  contractTitle?: string;
  hourlyRate?: number;
  clientName?: string;
  freelancerName?: string;
  timeEntries?: TimeEntry[];
}

export interface TimesheetActionResponse {
  success: boolean;
  timesheet?: Timesheet;
  error?: string;
  code?: string;
}

export interface TimesheetOrderResult {
  success: boolean;
  orderId?: string;
  amount?: number;
  amountSubunits?: number;
  currency?: string;
  keyId?: string;
  contractId?: string;
  timesheetId?: string;
  clientName?: string;
  clientEmail?: string;
  error?: string;
  code?: string;
}

export interface VerifyTimesheetPaymentInput {
  timesheetId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Freelancer reviews and submits their weekly timesheet for client review.
 */
export async function submitTimesheet(timesheetId: string): Promise<TimesheetActionResponse> {
  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
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
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, total_amount, total_minutes, week_start_date, status')
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.freelancer_id !== user.id) {
      return { success: false, error: 'Only the assigned freelancer can submit this timesheet.', code: 'FORBIDDEN' };
    }

    if (timesheet.status !== 'open') {
      return { success: false, error: `Timesheet is already "${timesheet.status}".`, code: 'INVALID_STATE' };
    }

    if (timesheet.total_minutes <= 0) {
      return { success: false, error: 'Cannot submit a timesheet with zero logged time.', code: 'EMPTY_TIMESHEET' };
    }

    // Try trusted stored procedure first
    const { data: rpcUpdated, error: rpcError } = await supabase.rpc('submit_timesheet', {
      p_timesheet_id: timesheetId.trim(),
    });

    let updated = rpcUpdated;
    if (rpcError || !updated) {
      const adminClient = getAdminSupabaseClient();
      const { data: adminUpdated, error: adminErr } = await adminClient
        .from('timesheets')
        .update({ status: 'submitted', updated_at: new Date().toISOString() })
        .eq('id', timesheetId.trim())
        .select()
        .single();

      if (adminErr || !adminUpdated) {
        return { success: false, error: 'Failed to submit timesheet.', code: 'DB_ERROR' };
      }
      updated = adminUpdated;
    }

    // Notify client of submission
    createNotification({
      userId: timesheet.client_id,
      type: 'payment_processed',
      title: 'Weekly Timesheet Submitted',
      message: `Freelancer submitted timesheet for week of ${timesheet.week_start_date} ($${timesheet.total_amount}). Please review.`,
      link: `/contracts/${timesheet.contract_id}`,
      metadata: { timesheetId: timesheet.id, contractId: timesheet.contract_id },
    }).catch(() => {});

    return {
      success: true,
      timesheet: {
        id: updated.id,
        contractId: updated.contract_id,
        clientId: updated.client_id,
        freelancerId: updated.freelancer_id,
        weekStartDate: updated.week_start_date,
        totalMinutes: updated.total_minutes,
        totalAmount: Number(updated.total_amount),
        status: updated.status as TimesheetStatus,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to submit timesheet.';
    return { success: false, error: message };
  }
}

/**
 * Client reviews and approves the submitted weekly timesheet.
 */
export async function approveTimesheet(timesheetId: string): Promise<TimesheetActionResponse> {
  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
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
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, total_amount, total_minutes, week_start_date, status')
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.client_id !== user.id) {
      return { success: false, error: 'Only the client can approve this timesheet.', code: 'FORBIDDEN' };
    }

    if (timesheet.status !== 'submitted' && timesheet.status !== 'under_review') {
      return { success: false, error: `Timesheet in status "${timesheet.status}" cannot be approved.`, code: 'INVALID_STATE' };
    }

    // Try trusted stored procedure first
    const { data: rpcUpdated, error: rpcError } = await supabase.rpc('approve_timesheet', {
      p_timesheet_id: timesheetId.trim(),
    });

    let updated = rpcUpdated;
    if (rpcError || !updated) {
      const adminClient = getAdminSupabaseClient();
      const { data: adminUpdated, error: adminErr } = await adminClient
        .from('timesheets')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', timesheetId.trim())
        .select()
        .single();

      if (adminErr || !adminUpdated) {
        return { success: false, error: 'Failed to approve timesheet.', code: 'DB_ERROR' };
      }
      updated = adminUpdated;
    }

    // Notify freelancer
    createNotification({
      userId: timesheet.freelancer_id,
      type: 'milestone_approved',
      title: 'Timesheet Approved',
      message: `Your timesheet for week of ${timesheet.week_start_date} ($${timesheet.total_amount}) has been approved. Invoicing initiated.`,
      link: `/contracts/${timesheet.contract_id}`,
      metadata: { timesheetId: timesheet.id, contractId: timesheet.contract_id },
    }).catch(() => {});

    return {
      success: true,
      timesheet: {
        id: updated.id,
        contractId: updated.contract_id,
        clientId: updated.client_id,
        freelancerId: updated.freelancer_id,
        weekStartDate: updated.week_start_date,
        totalMinutes: updated.total_minutes,
        totalAmount: Number(updated.total_amount),
        status: updated.status as TimesheetStatus,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve timesheet.';
    return { success: false, error: message };
  }
}

/**
 * Client disputes a submitted timesheet.
 */
export async function disputeTimesheet(
  timesheetId: string,
  reason: string
): Promise<TimesheetActionResponse> {
  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
  }

  if (!reason || reason.trim().length < 5) {
    return { success: false, error: 'Dispute reason must be at least 5 characters.', code: 'INVALID_INPUT' };
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
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, week_start_date, status')
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.client_id !== user.id) {
      return { success: false, error: 'Only the client can dispute this timesheet.', code: 'FORBIDDEN' };
    }

    // Try trusted stored procedure first
    const { data: rpcUpdated, error: rpcError } = await supabase.rpc('dispute_timesheet', {
      p_timesheet_id: timesheetId.trim(),
      p_reason: reason.trim(),
    });

    let updated = rpcUpdated;
    if (rpcError || !updated) {
      const adminClient = getAdminSupabaseClient();
      const { data: adminUpdated, error: adminErr } = await adminClient
        .from('timesheets')
        .update({ status: 'disputed', updated_at: new Date().toISOString() })
        .eq('id', timesheetId.trim())
        .select()
        .single();

      if (adminErr || !adminUpdated) {
        return { success: false, error: 'Failed to update timesheet.', code: 'DB_ERROR' };
      }
      updated = adminUpdated;
    }

    // Notify freelancer of dispute
    createNotification({
      userId: timesheet.freelancer_id,
      type: 'milestone_revision_requested',
      title: 'Timesheet Disputed',
      message: `Client disputed timesheet for week of ${timesheet.week_start_date}: ${reason.trim()}`,
      link: `/contracts/${timesheet.contract_id}`,
      metadata: { timesheetId: timesheet.id, contractId: timesheet.contract_id, reason },
    }).catch(() => {});

    return {
      success: true,
      timesheet: {
        id: updated.id,
        contractId: updated.contract_id,
        clientId: updated.client_id,
        freelancerId: updated.freelancer_id,
        weekStartDate: updated.week_start_date,
        totalMinutes: updated.total_minutes,
        totalAmount: Number(updated.total_amount),
        status: updated.status as TimesheetStatus,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to dispute timesheet.';
    return { success: false, error: message };
  }
}

/**
 * Creates a Razorpay payment order for an approved weekly timesheet.
 */
export async function createTimesheetRazorpayOrder(
  timesheetId: string
): Promise<TimesheetOrderResult> {
  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
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
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, total_amount, status, week_start_date')
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.client_id !== user.id) {
      return { success: false, error: 'Only the client can pay this timesheet.', code: 'FORBIDDEN' };
    }

    if (timesheet.status !== 'approved') {
      return { success: false, error: `Timesheet is in status "${timesheet.status}". Only approved timesheets can be invoiced.`, code: 'INVALID_STATUS' };
    }

    const amount = Number(timesheet.total_amount);
    if (amount <= 0) {
      return { success: false, error: 'Timesheet has no billable amount.', code: 'ZERO_AMOUNT' };
    }

    const paymentProvider = getPaymentProvider();
    const orderRes = await paymentProvider.createOrder({
      contractId: timesheet.contract_id,
      timesheetId: timesheet.id,
      clientId: user.id,
      amount,
      currency: 'INR',
      notes: {
        timesheet_id: timesheet.id,
        week_start: timesheet.week_start_date,
      },
    });

    if (!orderRes.success) {
      return { success: false, error: orderRes.error || 'Failed to create payment order.' };
    }

    // Persist payment attempt via stored procedure
    const { error: attemptError } = await supabase.rpc('record_timesheet_payment_attempt', {
      p_contract_id: timesheet.contract_id,
      p_timesheet_id: timesheet.id,
      p_client_id: user.id,
      p_amount: amount,
      p_amount_subunits: orderRes.amountSubunits,
      p_currency: orderRes.currency,
      p_razorpay_order_id: orderRes.orderId,
      p_environment: paymentProvider.environment,
      p_metadata: {
        week_start_date: timesheet.week_start_date,
      },
    });

    if (attemptError) {
      return { success: false, error: `Failed to record payment attempt: ${attemptError.message}`, code: attemptError.code };
    }

    return {
      success: true,
      orderId: orderRes.orderId,
      amount,
      amountSubunits: orderRes.amountSubunits,
      currency: orderRes.currency,
      keyId: orderRes.keyId,
      contractId: timesheet.contract_id,
      timesheetId: timesheet.id,
      clientName: (user.user_metadata?.full_name as string) || 'Client',
      clientEmail: user.email || '',
    };
  } catch (err: unknown) {
    const message = extractPaymentErrorMessage(err, 'Failed to create timesheet payment order.');
    return { success: false, error: message };
  }
}

/**
 * Verifies Razorpay payment for an approved timesheet, transitions timesheet to paid,
 * and automatically triggers eligible freelancer payout transfer.
 */
export async function verifyAndPayTimesheet(
  input: VerifyTimesheetPaymentInput
): Promise<TimesheetActionResponse> {
  const { timesheetId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;

  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
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
    const { data: timesheet, error } = await supabase
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, total_amount, status, week_start_date')
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.status === 'paid') {
      return {
        success: true,
        timesheet: {
          id: timesheet.id,
          contractId: timesheet.contract_id,
          clientId: timesheet.client_id,
          freelancerId: timesheet.freelancer_id,
          weekStartDate: timesheet.week_start_date,
          totalMinutes: 0,
          totalAmount: Number(timesheet.total_amount),
          status: 'paid',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    const expectedSubunits = Math.round(Number(timesheet.total_amount) * 100);

    // Verify server-persisted payment attempt exists for this timesheet
    const { data: rawAttempt, error: attemptError } = await supabase.rpc('get_payment_attempt_for_timesheet', {
      p_timesheet_id: timesheet.id,
      p_razorpay_order_id: razorpayOrderId.trim(),
    });

    if (attemptError || !rawAttempt) {
      return {
        success: false,
        error: 'No persisted payment attempt found matching this timesheet and order ID.',
        code: 'ORDER_NOT_FOUND',
      };
    }

    // Cryptographic & API verification
    const paymentProvider = getPaymentProvider();
    const verification = await paymentProvider.verifyPayment({
      orderId: razorpayOrderId.trim(),
      paymentId: razorpayPaymentId.trim(),
      signature: razorpaySignature.trim(),
      expectedAmountSubunits: expectedSubunits,
      expectedCurrency: 'INR',
    });

    if (!verification.success) {
      return { success: false, error: verification.error || 'Payment verification failed.', code: 'VERIFICATION_FAILED' };
    }

    // Fund timesheet atomically in database via privileged service_role client
    const adminClient = getAdminSupabaseClient();
    const { data: paidTimesheet, error: fundError } = await adminClient.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: timesheet.id,
      p_razorpay_payment_id: razorpayPaymentId.trim(),
      p_razorpay_order_id: razorpayOrderId.trim(),
      p_razorpay_signature: razorpaySignature.trim(),
      p_amount_subunits: expectedSubunits,
      p_currency: 'INR',
      p_environment: paymentProvider.environment,
      p_metadata: {
        payment_verified_at: new Date().toISOString(),
      },
    });

    if (fundError || !paidTimesheet) {
      return { success: false, error: `Failed to record timesheet payment: ${fundError?.message || 'DB Error'}`, code: 'FUND_FAILED' };
    }

    // Automatically trigger freelancer payout transfer via PayoutEngine
    payoutEngine.initiateTimesheetPayout(timesheet.id).catch((payoutErr) => {
      console.error('Background payout transfer initiation failed:', payoutErr);
    });

    return {
      success: true,
      timesheet: {
        id: paidTimesheet.id,
        contractId: paidTimesheet.contract_id,
        clientId: paidTimesheet.client_id,
        freelancerId: paidTimesheet.freelancer_id,
        weekStartDate: paidTimesheet.week_start_date,
        totalMinutes: paidTimesheet.total_minutes,
        totalAmount: Number(paidTimesheet.total_amount),
        status: 'paid',
        createdAt: paidTimesheet.created_at,
        updatedAt: paidTimesheet.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = extractPaymentErrorMessage(err, 'Failed to verify timesheet payment.');
    return { success: false, error: message };
  }
}

/**
 * Fetches all weekly timesheets and their granular time entries for the authenticated freelancer.
 */
export async function getFreelancerTimesheets(
  contractId?: string
): Promise<{ success: boolean; timesheets: TimesheetWithDetails[]; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, timesheets: [], error: 'Authentication required.' };
  }

  try {
    let query = supabase
      .from('timesheets')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        week_start_date,
        total_minutes,
        total_amount,
        status,
        created_at,
        updated_at,
        contracts:contracts!contract_id (title, hourly_rate),
        client:profiles!client_id (full_name),
        time_entries (
          id,
          contract_id,
          timesheet_id,
          freelancer_id,
          start_time,
          end_time,
          duration_minutes,
          memo,
          source,
          created_at
        )
      `)
      .eq('freelancer_id', user.id)
      .order('week_start_date', { ascending: false });

    if (contractId && UUID_REGEX.test(contractId.trim())) {
      query = query.eq('contract_id', contractId.trim());
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, timesheets: [], error: error.message };
    }

    interface RawQueryRow {
      id: string;
      contract_id: string;
      client_id: string;
      freelancer_id: string;
      week_start_date: string;
      total_minutes: number;
      total_amount: number | string;
      status: string;
      created_at: string;
      updated_at: string;
      contracts?: { title?: string; hourly_rate?: number | string } | Array<{ title?: string; hourly_rate?: number | string }> | null;
      client?: { full_name?: string } | Array<{ full_name?: string }> | null;
      time_entries?: Array<{
        id: string;
        contract_id: string;
        timesheet_id: string;
        freelancer_id: string;
        start_time: string;
        end_time: string;
        duration_minutes: number;
        memo: string;
        source: 'timer' | 'manual';
        created_at: string;
      }>;
    }

    const mapped: TimesheetWithDetails[] = ((data as unknown as RawQueryRow[]) || []).map((row) => {
      const cObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      const clObj = Array.isArray(row.client) ? row.client[0] : row.client;

      return {
        id: row.id,
        contractId: row.contract_id,
        clientId: row.client_id,
        freelancerId: row.freelancer_id,
        weekStartDate: row.week_start_date,
        totalMinutes: Number(row.total_minutes) || 0,
        totalAmount: Number(row.total_amount) || 0,
        status: row.status as TimesheetStatus,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        contractTitle: cObj?.title || 'Hourly Contract',
        hourlyRate: Number(cObj?.hourly_rate) || 0,
        clientName: clObj?.full_name || 'Client',
        timeEntries: (row.time_entries || []).map((e) => ({
          id: e.id,
          contractId: e.contract_id,
          timesheetId: e.timesheet_id,
          freelancerId: e.freelancer_id,
          startTime: e.start_time,
          endTime: e.end_time,
          durationMinutes: e.duration_minutes,
          memo: e.memo || '',
          source: e.source,
          createdAt: e.created_at,
        })),
      };
    });

    return { success: true, timesheets: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve timesheets.';
    return { success: false, timesheets: [], error: message };
  }
}

/**
 * Fetches timesheets and granular time entries for a specific contract.
 * Verified for both clients and assigned freelancers.
 */
export async function getContractTimesheets(
  contractId: string
): Promise<{ success: boolean; timesheets: TimesheetWithDetails[]; error?: string }> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, timesheets: [], error: 'Invalid contract ID.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, timesheets: [], error: 'Authentication required.' };
  }

  try {
    const { data, error } = await supabase
      .from('timesheets')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        week_start_date,
        total_minutes,
        total_amount,
        status,
        created_at,
        updated_at,
        contracts:contracts!contract_id (title, hourly_rate),
        freelancer:profiles!freelancer_id (full_name),
        client:profiles!client_id (full_name),
        time_entries (
          id,
          contract_id,
          timesheet_id,
          freelancer_id,
          start_time,
          end_time,
          duration_minutes,
          memo,
          source,
          created_at
        )
      `)
      .eq('contract_id', contractId.trim())
      .order('week_start_date', { ascending: false });

    if (error) {
      return { success: false, timesheets: [], error: error.message };
    }

    interface RawQueryRow {
      id: string;
      contract_id: string;
      client_id: string;
      freelancer_id: string;
      week_start_date: string;
      total_minutes: number;
      total_amount: number | string;
      status: string;
      created_at: string;
      updated_at: string;
      contracts?: { title?: string; hourly_rate?: number | string } | Array<{ title?: string; hourly_rate?: number | string }> | null;
      client?: { full_name?: string } | Array<{ full_name?: string }> | null;
      freelancer?: { full_name?: string } | Array<{ full_name?: string }> | null;
      time_entries?: Array<{
        id: string;
        contract_id: string;
        timesheet_id: string;
        freelancer_id: string;
        start_time: string;
        end_time: string;
        duration_minutes: number;
        memo: string;
        source: 'timer' | 'manual';
        created_at: string;
      }>;
    }

    const mapped: TimesheetWithDetails[] = ((data as unknown as RawQueryRow[]) || []).map((row) => {
      const cObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      const clObj = Array.isArray(row.client) ? row.client[0] : row.client;
      const flObj = Array.isArray(row.freelancer) ? row.freelancer[0] : row.freelancer;

      return {
        id: row.id,
        contractId: row.contract_id,
        clientId: row.client_id,
        freelancerId: row.freelancer_id,
        weekStartDate: row.week_start_date,
        totalMinutes: Number(row.total_minutes) || 0,
        totalAmount: Number(row.total_amount) || 0,
        status: row.status as TimesheetStatus,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        contractTitle: cObj?.title || 'Hourly Contract',
        hourlyRate: Number(cObj?.hourly_rate) || 0,
        freelancerName: flObj?.full_name || 'Freelancer',
        clientName: clObj?.full_name || 'Client',
        timeEntries: (row.time_entries || []).map((e) => ({
          id: e.id,
          contractId: e.contract_id,
          timesheetId: e.timesheet_id,
          freelancerId: e.freelancer_id,
          startTime: e.start_time,
          endTime: e.end_time,
          durationMinutes: e.duration_minutes,
          memo: e.memo || '',
          source: e.source,
          createdAt: e.created_at,
        })),
      };
    });

    return { success: true, timesheets: mapped };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve contract timesheets.';
    return { success: false, timesheets: [], error: message };
  }
}

