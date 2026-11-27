
'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getPaymentProvider } from '@/lib/payments/registry';
import { payoutEngine } from '@/lib/services/payout-engine';
import { createNotification } from '@/lib/actions/notifications';
import { Timesheet, TimesheetStatus, TimeEntry } from '@/lib/types';
import { extractPaymentErrorMessage } from '@/lib/razorpay';
import { revalidatePath } from 'next/cache';
import { getStripeClient } from '@/lib/stripe';
import {
  calculateTimesheetPaidAmount,
  isClientAuthorizedForTimesheet,
} from '@/lib/payments/timesheet-accounting';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TimesheetWithDetails extends Timesheet {
  contractTitle?: string;
  hourlyRate?: number;
  clientName?: string;
  freelancerName?: string;
  timeEntries?: TimeEntry[];
  paidAmount?: number;
  balanceDue?: number;
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

    if (timesheet.status === 'approved' || timesheet.status === 'paid') {
      return { success: false, error: `Timesheet is already ${timesheet.status}.`, code: 'ALREADY_APPROVED' };
    }

    if (timesheet.status === 'open' && Number(timesheet.total_minutes) <= 0) {
      return { success: false, error: 'Cannot approve an open timesheet with zero logged time.', code: 'EMPTY_TIMESHEET' };
    }

    // 1. Try atomic SECURITY DEFINER stored procedure first (handles permissions & state transitions cleanly)
    const { data: rpcUpdated, error: rpcError } = await supabase.rpc('approve_timesheet', {
      p_timesheet_id: timesheetId.trim(),
    });

    let updated = rpcUpdated;

    // 2. Fallback: If RPC is not available or rejected due to older schema, attempt via admin client or direct client
    if (rpcError || !updated) {
      let clientToUse = supabase;
      try {
        clientToUse = getAdminSupabaseClient();
      } catch {
        // Safe fallback to authenticated client if service role key is absent in serverless environment
        clientToUse = supabase;
      }

      const { data: adminUpdated, error: adminErr } = await clientToUse
        .from('timesheets')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', timesheetId.trim())
        .select()
        .single();

      if (adminErr || !adminUpdated) {
        const detailError =
          adminErr?.message || rpcError?.message || 'Failed to approve timesheet.';
        return { success: false, error: detailError, code: adminErr?.code || 'DB_ERROR' };
      }
      updated = adminUpdated;
    }

    // Notify freelancer of approval
    createNotification({
      userId: timesheet.freelancer_id,
      type: 'milestone_approved',
      title: 'Timesheet Approved',
      message: `Your timesheet for week of ${timesheet.week_start_date} ($${timesheet.total_amount}) has been approved. Invoicing initiated.`,
      link: `/contracts/${timesheet.contract_id}`,
      metadata: { timesheetId: timesheet.id, contractId: timesheet.contract_id },
    }).catch(() => {});

    revalidatePath(`/contracts/${timesheet.contract_id}`);
    revalidatePath('/contracts');
    revalidatePath('/client/reports');

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
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        total_amount,
        status,
        week_start_date,
        contracts:contract_id ( id, client_id, company_id )
      `)
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(timesheet.contracts) ? timesheet.contracts[0] : timesheet.contracts;
    let companyMemberRole: string | null = null;
    if (timesheet.client_id !== user.id && rawContract?.client_id !== user.id && rawContract?.company_id) {
      const { data: membership } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', rawContract.company_id)
        .eq('user_id', user.id)
        .maybeSingle();
      companyMemberRole = membership?.role || null;
    }

    if (
      !isClientAuthorizedForTimesheet({
        userId: user.id,
        timesheetClientId: timesheet.client_id,
        contractClientId: rawContract?.client_id,
        companyMemberRole,
      })
    ) {
      return { success: false, error: 'Unauthorized: Only the client can verify and pay this timesheet.', code: 'FORBIDDEN' };
    }

    if (timesheet.client_id !== user.id) {
      return { success: false, error: 'Only the client can pay this timesheet.', code: 'FORBIDDEN' };
    }

    // Query payment_ledger & payment_attempts for THIS specific timesheet/week only
    const admin = getAdminSupabaseClient();
    const [{ data: settledLedger }, { data: settledAttempts }] = await Promise.all([
      admin
        .from('payment_ledger')
        .select('id, contract_id, amount, currency, event_type, status, description, metadata, created_at')
        .eq('contract_id', timesheet.contract_id)
        .in('status', ['succeeded', 'captured', 'completed']),
      admin
        .from('payment_attempts')
        .select('id, contract_id, billing_type, amount, currency, status, metadata, created_at')
        .eq('contract_id', timesheet.contract_id)
        .in('status', ['captured', 'succeeded']),
    ]);

    const alreadyPaid = calculateTimesheetPaidAmount({
      timesheetId: timesheet.id,
      weekStartDate: timesheet.week_start_date,
      ledgerRows: settledLedger || [],
      attemptRows: settledAttempts || [],
    });
    const totalAmount = Number(timesheet.total_amount);
    const balanceDue = Math.max(0, Math.round((totalAmount - alreadyPaid) * 100) / 100);

    if (timesheet.status === 'paid' || balanceDue <= 0.01) {
      return { success: false, error: `Timesheet has already been fully paid ($${alreadyPaid.toFixed(2)}).`, code: 'ALREADY_PAID' };
    }

    const isPayableStatus = timesheet.status === 'approved' || (['open'].includes(timesheet.status) && balanceDue > 0.01);
    if (!isPayableStatus) {
      return { success: false, error: `Timesheet is in status "${timesheet.status}". Please approve the timesheet before paying.`, code: 'INVALID_STATUS' };
    }

    const amount = balanceDue;
    const paymentProvider = getPaymentProvider();
    const expectedSubunits = Math.round(amount * 100);
    const tempOrderId = `lock_rzp_${timesheet.id.slice(0, 8)}_${Date.now()}`;

    // Atomically acquire single active payment attempt lock for this timesheet (fail-closed)
    const { data: lockRow, error: lockError } = await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: timesheet.id,
      p_client_id: user.id,
      p_provider: 'razorpay',
      p_environment: paymentProvider.environment,
      p_amount: amount,
      p_amount_subunits: expectedSubunits,
      p_currency: 'INR',
      p_temp_order_id: tempOrderId,
      p_metadata: {
        week_start_date: timesheet.week_start_date,
        timesheet_id: timesheet.id,
      },
    });

    if (lockError || !lockRow?.id) {
      if (lockError?.code === '23505') {
        return {
          success: false,
          error: 'Another payment attempt is already in progress for this timesheet. Please complete it or wait for it to expire.',
          code: 'PAYMENT_ATTEMPT_IN_PROGRESS',
        };
      }
      console.error('[RAZORPAY TIMESHEET LOCK FAILED]:', lockError?.message || 'Missing lock row');
      return {
        success: false,
        error: 'Unable to initialize secure payment lock. Please try again shortly.',
        code: 'PAYMENT_LOCK_UNAVAILABLE',
      };
    }

    const lockedAttemptId: string = lockRow.id;

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
      if (lockedAttemptId) {
        await admin
          .from('payment_attempts')
          .update({
            status: 'failed',
            error_code: 'ORDER_CREATE_FAILED',
            error_description: orderRes.error || 'Failed to create Razorpay order',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lockedAttemptId);
      }
      return { success: false, error: orderRes.error || 'Failed to create payment order.' };
    }

    if (lockedAttemptId) {
      await admin
        .from('payment_attempts')
        .update({
          razorpay_order_id: orderRes.orderId,
          amount_subunits: orderRes.amountSubunits,
          currency: orderRes.currency,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lockedAttemptId);
    } else {
      try {
        await admin.from('payment_attempts').insert({
          contract_id: timesheet.contract_id,
          billing_type: 'timesheet',
          client_id: user.id,
          provider: 'razorpay',
          environment: paymentProvider.environment,
          razorpay_order_id: orderRes.orderId,
          amount,
          amount_subunits: orderRes.amountSubunits,
          currency: orderRes.currency,
          status: 'created',
          metadata: {
            timesheet_id: timesheet.id,
            week_start_date: timesheet.week_start_date,
          },
        });
      } catch (persistErr) {
        console.warn('Non-blocking payment attempt persistence error:', persistErr);
      }
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
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        total_amount,
        status,
        week_start_date,
        contracts:contract_id ( id, client_id, company_id )
      `)
      .eq('id', timesheetId.trim())
      .single();

    if (error || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(timesheet.contracts) ? timesheet.contracts[0] : timesheet.contracts;
    let companyMemberRole: string | null = null;
    if (timesheet.client_id !== user.id && rawContract?.client_id !== user.id && rawContract?.company_id) {
      const { data: membership } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', rawContract.company_id)
        .eq('user_id', user.id)
        .maybeSingle();
      companyMemberRole = membership?.role || null;
    }

    if (
      !isClientAuthorizedForTimesheet({
        userId: user.id,
        timesheetClientId: timesheet.client_id,
        contractClientId: rawContract?.client_id,
        companyMemberRole,
      })
    ) {
      return { success: false, error: 'Unauthorized: Only the client can verify and pay this timesheet.', code: 'FORBIDDEN' };
    }

    const adminClient = getAdminSupabaseClient();

    // Check prior payments for THIS specific timesheet/week and idempotency by razorpay_payment_id
    const [{ data: priorSettled }, { data: priorAttempts }] = await Promise.all([
      adminClient
        .from('payment_ledger')
        .select('id, contract_id, amount, currency, event_type, status, description, metadata, created_at')
        .eq('contract_id', timesheet.contract_id)
        .in('status', ['succeeded', 'captured', 'completed']),
      adminClient
        .from('payment_attempts')
        .select('id, contract_id, billing_type, amount, currency, status, metadata, created_at')
        .eq('contract_id', timesheet.contract_id)
        .in('status', ['captured', 'succeeded']),
    ]);

    const alreadyRecordedPayment = (priorSettled || []).some((r) => {
      const meta = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>;
      return meta.razorpay_payment_id === razorpayPaymentId.trim();
    });

    if (timesheet.status === 'paid' || alreadyRecordedPayment) {
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

    const alreadyPaid = calculateTimesheetPaidAmount({
      timesheetId: timesheet.id,
      weekStartDate: timesheet.week_start_date,
      ledgerRows: priorSettled || [],
      attemptRows: priorAttempts || [],
    });
    const totalTimesheetAmount = Number(timesheet.total_amount);
    const expectedBalanceDue = Math.max(0, Math.round((totalTimesheetAmount - alreadyPaid) * 100) / 100);

    if (expectedBalanceDue <= 0.01) {
      return { success: false, error: 'Timesheet has no outstanding balance due.', code: 'ALREADY_PAID' };
    }

    const expectedSubunits = Math.round(expectedBalanceDue * 100);

    // Validate Razorpay identifiers upfront
    const cleanOrderId = razorpayOrderId?.trim() || '';
    const cleanPaymentId = razorpayPaymentId?.trim() || '';
    const cleanSignature = razorpaySignature?.trim() || '';
    if (!cleanOrderId || !cleanPaymentId || !cleanSignature) {
      return { success: false, error: 'Missing required Razorpay payment verification details.', code: 'INVALID_INPUT' };
    }

    // Verify server-persisted payment attempt exists for this timesheet (fail-closed)
    let rawAttempt: Record<string, unknown> | null = null;
    const { data: rpcAttempt, error: attemptError } = await supabase.rpc('get_payment_attempt_for_timesheet', {
      p_timesheet_id: timesheet.id,
      p_razorpay_order_id: cleanOrderId,
    });

    if (!attemptError && rpcAttempt) {
      rawAttempt = rpcAttempt;
    } else {
      const { data: directAttempt } = await adminClient
        .from('payment_attempts')
        .select('*')
        .eq('timesheet_id', timesheet.id)
        .eq('razorpay_order_id', cleanOrderId)
        .maybeSingle();

      if (directAttempt) {
        rawAttempt = directAttempt;
      }
    }

    if (!rawAttempt) {
      return {
        success: false,
        error: 'No matching payment attempt was found for this timesheet and order.',
        code: 'PAYMENT_ATTEMPT_NOT_FOUND',
      };
    }

    // Cryptographic & API verification
    const paymentProvider = getPaymentProvider();
    const verification = await paymentProvider.verifyPayment({
      orderId: cleanOrderId,
      paymentId: cleanPaymentId,
      signature: cleanSignature,
      expectedAmountSubunits: expectedSubunits,
      expectedCurrency: 'INR',
    });

    if (!verification.success) {
      return { success: false, error: verification.error || 'Payment verification failed.', code: 'VERIFICATION_FAILED' };
    }

    // Fund timesheet atomically in database via privileged service_role client (fail-closed, bounded deadlock retry)
    interface DbTimesheetRow {
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
    }
    let paidTimesheet: DbTimesheetRow | null = null;
    let fundError: { code?: string; message?: string } | null = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { data: rpcPaid, error: rpcErr } = await adminClient.rpc('fund_timesheet_with_payment', {
        p_timesheet_id: timesheet.id,
        p_razorpay_payment_id: cleanPaymentId,
        p_razorpay_order_id: cleanOrderId,
        p_razorpay_signature: cleanSignature,
        p_amount_subunits: expectedSubunits,
        p_currency: 'INR',
        p_environment: paymentProvider.environment,
        p_metadata: {
          payment_verified_at: new Date().toISOString(),
        },
      });

      if (!rpcErr && rpcPaid) {
        paidTimesheet = rpcPaid as DbTimesheetRow;
        fundError = null;
        break;
      }

      fundError = rpcErr;
      const isRetryableLockConflict = rpcErr?.code === '40P01' || rpcErr?.code === '40001';
      if (!isRetryableLockConflict || attempt === maxAttempts) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }

    if (!paidTimesheet) {
      console.error('fund_timesheet_with_payment RPC failed:', fundError?.code, fundError?.message);
      if (fundError?.code === '40P01' || fundError?.code === '40001') {
        return {
          success: false,
          error: 'Payment verification is currently busy. Please retry in a moment.',
          code: 'RETRYABLE_CONFLICT',
        };
      }
      if (fundError?.code === '23503' || fundError?.code === '22023') {
        return {
          success: false,
          error: 'Payment attempt could not be validated for this timesheet.',
          code: 'PAYMENT_VALIDATION_FAILED',
        };
      }
      return {
        success: false,
        error: 'Unable to finalize timesheet payment right now. Please try again.',
        code: 'FUND_FAILED',
      };
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
        status: paidTimesheet.status as TimesheetStatus,
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
 * Cancels an abandoned/user-dismissed Stripe or Razorpay timesheet payment attempt
 * after verifying ownership and confirming the provider has not captured/succeeded.
 */
export async function cancelTimesheetPaymentAttempt(
  orderOrIntentId: string
): Promise<{ success: boolean; alreadyCancelled?: boolean; error?: string; code?: string }> {
  if (!orderOrIntentId || !orderOrIntentId.trim()) {
    return { success: false, error: 'Payment attempt identifier is required.', code: 'INVALID_INPUT' };
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
    const cleanId = orderOrIntentId.trim();
    const admin = getAdminSupabaseClient();

    const { data: attempt, error: findErr } = await admin
      .from('payment_attempts')
      .select(`
        id,
        contract_id,
        timesheet_id,
        client_id,
        provider,
        razorpay_order_id,
        status,
        metadata
      `)
      .eq('razorpay_order_id', cleanId)
      .maybeSingle();

    if (findErr || !attempt) {
      return { success: false, error: 'Payment attempt not found.', code: 'NOT_FOUND' };
    }

    const { data: contract } = await admin
      .from('contracts')
      .select('id, client_id, company_id')
      .eq('id', attempt.contract_id)
      .maybeSingle();

    let companyMemberRole: string | null = null;
    if (attempt.client_id !== user.id && contract?.client_id !== user.id && contract?.company_id) {
      const { data: membership } = await admin
        .from('company_members')
        .select('role')
        .eq('company_id', contract.company_id)
        .eq('user_id', user.id)
        .maybeSingle();
      companyMemberRole = membership?.role || null;
    }

    if (
      !isClientAuthorizedForTimesheet({
        userId: user.id,
        timesheetClientId: attempt.client_id,
        contractClientId: contract?.client_id,
        companyMemberRole,
      })
    ) {
      return { success: false, error: 'Unauthorized to cancel this payment attempt.', code: 'FORBIDDEN' };
    }

    if (attempt.status === 'captured' || attempt.status === 'succeeded') {
      return {
        success: false,
        error: 'Cannot cancel an already captured payment.',
        code: 'ALREADY_CAPTURED',
      };
    }

    if (attempt.status === 'failed') {
      return { success: true, alreadyCancelled: true };
    }

    // Verify with provider before cancelling: never cancel a succeeded/processing payment
    if (attempt.provider === 'stripe') {
      try {
        const stripe = getStripeClient();
        const pi = await stripe.paymentIntents.retrieve(cleanId);
        if (pi.status === 'succeeded' || pi.status === 'processing') {
          return {
            success: false,
            error: `Payment cannot be cancelled because its provider status is "${pi.status}".`,
            code: 'ALREADY_SUCCEEDED',
          };
        }
        if (pi.status !== 'canceled') {
          await stripe.paymentIntents.cancel(cleanId);
        }
      } catch (stripeErr) {
        console.error('[CANCEL STRIPE INTENT ERROR]:', stripeErr);
        return {
          success: false,
          error: 'Could not verify Stripe payment status before cancellation.',
          code: 'PROVIDER_CHECK_FAILED',
        };
      }
    } else {
      // Razorpay: ensure no ledger settlement exists for this order before cancelling
      const { data: ledgerRows } = await admin
        .from('payment_ledger')
        .select('id, metadata')
        .eq('contract_id', attempt.contract_id)
        .in('status', ['succeeded', 'captured', 'completed']);

      const settledForOrder = (ledgerRows || []).some((r) => {
        const meta = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>;
        return meta.razorpay_order_id === cleanId;
      });

      if (settledForOrder) {
        return {
          success: false,
          error: 'Cannot cancel an already settled Razorpay order.',
          code: 'ALREADY_CAPTURED',
        };
      }
    }

    const { error: updateErr } = await admin
      .from('payment_attempts')
      .update({
        status: 'failed',
        error_code: 'CANCELLED_BY_USER',
        error_description: 'Checkout cancelled by client',
        updated_at: new Date().toISOString(),
      })
      .eq('id', attempt.id)
      .in('status', ['created', 'authorized']);

    if (updateErr) {
      return { success: false, error: updateErr.message, code: 'DB_ERROR' };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to cancel payment attempt.';
    return { success: false, error: message };
  }
}

/**
 * Fetches all weekly timesheets and their granular time entries for the authenticated freelancer.
 */
export async function getFreelancerTimesheets(
  contractId?: string
): Promise<{ success: boolean; timesheets: TimesheetWithDetails[]; unbilledEntries?: TimeEntry[]; error?: string }> {
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

    // Query payment_ledger for settled hourly timesheet payments on this contract using admin client
    const admin = getAdminSupabaseClient();
    let ledgerQuery = admin
      .from('payment_ledger')
      .select('id, contract_id, amount, currency, event_type, status, description, metadata, created_at')
      .in('status', ['succeeded', 'captured', 'completed']);
    if (contractId && UUID_REGEX.test(contractId.trim())) {
      ledgerQuery = ledgerQuery.eq('contract_id', contractId.trim());
    }
    const { data: ledgerRows } = await ledgerQuery;

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

      const totalAmount = Number(row.total_amount) || 0;
      const matchedPaid = calculateTimesheetPaidAmount({
        timesheetId: row.id,
        weekStartDate: row.week_start_date,
        ledgerRows: (ledgerRows || []).filter((l) => l.contract_id === row.contract_id),
      });

      const paidAmount = Math.round((matchedPaid || 0) * 100) / 100;
      const balanceDue = row.status === 'paid' ? 0 : Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);

      let resolvedStatus = row.status as TimesheetStatus;
      if (row.status === 'paid' || (balanceDue <= 0.01 && totalAmount > 0 && paidAmount > 0)) {
        resolvedStatus = 'paid';
      }

      return {
        id: row.id,
        contractId: row.contract_id,
        clientId: row.client_id,
        freelancerId: row.freelancer_id,
        weekStartDate: row.week_start_date,
        totalMinutes: Number(row.total_minutes) || 0,
        totalAmount,
        paidAmount,
        balanceDue,
        status: resolvedStatus,
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

    // Fetch unbilled time_entries (timesheet_id IS NULL) for this freelancer
    let unbilledQuery = admin
      .from('time_entries')
      .select('id, contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source, created_at, contracts (title)')
      .eq('freelancer_id', user.id)
      .is('timesheet_id', null)
      .order('start_time', { ascending: false });
    if (contractId && UUID_REGEX.test(contractId.trim())) {
      unbilledQuery = unbilledQuery.eq('contract_id', contractId.trim());
    }
    const { data: rawUnbilled } = await unbilledQuery;
    const unbilledEntries: TimeEntry[] = (rawUnbilled || []).map((e) => {
      const cJoin = Array.isArray(e.contracts) ? e.contracts[0] : e.contracts;
      return {
        id: e.id,
        contractId: e.contract_id,
        contractTitle: cJoin?.title || 'Hourly Contract',
        timesheetId: null,
        freelancerId: e.freelancer_id,
        startTime: e.start_time,
        endTime: e.end_time,
        durationMinutes: e.duration_minutes,
        memo: e.memo || '',
        source: e.source as 'timer' | 'manual',
        createdAt: e.created_at,
      };
    });

    return { success: true, timesheets: mapped, unbilledEntries };
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
): Promise<{ success: boolean; timesheets: TimesheetWithDetails[]; unbilledEntries?: TimeEntry[]; error?: string }> {
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

    // Query payment_ledger using admin client so RLS never hides settled amounts
    const admin = getAdminSupabaseClient();
    const { data: ledgerRows } = await admin
      .from('payment_ledger')
      .select('id, contract_id, amount, currency, event_type, status, description, metadata, created_at')
      .eq('contract_id', contractId.trim())
      .in('status', ['succeeded', 'captured', 'completed']);

    // Also fetch captured payment attempts in case payment_ledger was asynchronous
    const { data: attemptRows } = await admin
      .from('payment_attempts')
      .select('id, contract_id, billing_type, amount, currency, status, metadata, created_at')
      .eq('contract_id', contractId.trim())
      .in('status', ['captured', 'succeeded']);

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

      const totalAmount = Number(row.total_amount) || 0;
      const matchedPaid = calculateTimesheetPaidAmount({
        timesheetId: row.id,
        weekStartDate: row.week_start_date,
        ledgerRows: (ledgerRows || []).filter((l) => l.contract_id === row.contract_id),
        attemptRows: attemptRows || [],
      });

      const paidAmount = Math.round((matchedPaid || 0) * 100) / 100;
      const balanceDue = row.status === 'paid' ? 0 : Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);

      let resolvedStatus = row.status as TimesheetStatus;
      if (row.status === 'paid' || (balanceDue <= 0.01 && totalAmount > 0 && paidAmount > 0)) {
        resolvedStatus = 'paid';
      }

      return {
        id: row.id,
        contractId: row.contract_id,
        clientId: row.client_id,
        freelancerId: row.freelancer_id,
        weekStartDate: row.week_start_date,
        totalMinutes: Number(row.total_minutes) || 0,
        totalAmount,
        paidAmount,
        balanceDue,
        status: resolvedStatus,
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

    // Fetch unbilled post-payment time_entries (timesheet_id IS NULL) for this contract
    // Authorized via RLS-enforced contracts lookup so both client and freelancer can view them
    const { data: contractAuth } = await supabase
      .from('contracts')
      .select('id, title')
      .eq('id', contractId.trim())
      .maybeSingle();

    let unbilledEntries: TimeEntry[] = [];
    if (contractAuth) {
      const { data: rawUnbilled } = await admin
        .from('time_entries')
        .select('id, contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source, created_at')
        .eq('contract_id', contractId.trim())
        .is('timesheet_id', null)
        .order('start_time', { ascending: false });

      unbilledEntries = (rawUnbilled || []).map((e) => ({
        id: e.id,
        contractId: e.contract_id,
        contractTitle: contractAuth.title || 'Hourly Contract',
        timesheetId: null,
        freelancerId: e.freelancer_id,
        startTime: e.start_time,
        endTime: e.end_time,
        durationMinutes: e.duration_minutes,
        memo: e.memo || '',
        source: e.source as 'timer' | 'manual',
        createdAt: e.created_at,
      }));
    }

    return { success: true, timesheets: mapped, unbilledEntries };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve contract timesheets.';
    return { success: false, timesheets: [], error: message };
  }
}

