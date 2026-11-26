'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getStripeClient, isStripeConfigured, getStripePublishableKey } from '@/lib/stripe';
import { payoutEngine } from '@/lib/services/payout-engine';
import { createNotification } from '@/lib/actions/notifications';
import {
  calculateTimesheetPaidAmount,
  isClientAuthorizedForTimesheet,
  validateStripeTimesheetCapture,
} from '@/lib/payments/timesheet-accounting';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateStripePaymentIntentResult {
  success: boolean;
  clientSecret?: string;
  paymentIntentId?: string;
  publishableKey?: string;
  amount?: number;
  currency?: string;
  milestoneTitle?: string;
  error?: string;
  code?: string;
}

export interface VerifyStripePaymentInput {
  milestoneId: string;
  paymentIntentId: string;
}

export interface VerifyStripePaymentResult {
  success: boolean;
  error?: string;
  code?: string;
  milestone?: {
    id: string;
    contractId: string;
    clientId: string;
    freelancerId: string;
    title: string;
    amount: number;
    currency: string;
    status: string;
  };
}

/**
 * Creates a server-verified Stripe PaymentIntent for milestone escrow funding.
 * Operates alongside Razorpay for international USD payments.
 */
export async function createMilestoneStripePaymentIntent(
  milestoneId: string
): Promise<CreateStripePaymentIntentResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  if (!isStripeConfigured()) {
    return {
      success: false,
      error: 'Stripe is not configured on the server. Please ensure STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are set.',
      code: 'GATEWAY_NOT_CONFIGURED',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to fund milestones.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Fetch milestone and associated contract
    const { data: milestone, error: milestoneError } = await supabase
      .from('contract_milestones')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        title,
        amount,
        currency,
        status,
        sequence_order,
        contracts:contract_id (
          id,
          client_id,
          company_id,
          contract_type,
          status,
          title
        )
      `)
      .eq('id', milestoneId.trim())
      .single();

    if (milestoneError || !milestone) {
      return { success: false, error: 'Milestone not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(milestone.contracts) ? milestone.contracts[0] : milestone.contracts;
    if (!rawContract) {
      return { success: false, error: 'Associated contract not found.', code: 'NOT_FOUND' };
    }

    if (rawContract.contract_type !== 'fixed') {
      return { success: false, error: 'Milestone payments are only valid for fixed-price contracts.', code: 'INVALID_CONTRACT_TYPE' };
    }

    if (milestone.status !== 'planned') {
      return {
        success: false,
        error: `Milestone cannot be funded because current status is "${milestone.status}".`,
        code: 'INVALID_STATE',
      };
    }

    // 2. Authorization check
    const isDirectClient = milestone.client_id === user.id || rawContract.client_id === user.id;
    if (!isDirectClient) {
      if (rawContract.company_id) {
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

    // 3. Amount and currency
    const milestoneAmount = Number(milestone.amount);
    if (isNaN(milestoneAmount) || milestoneAmount <= 0) {
      return { success: false, error: 'Invalid milestone amount.', code: 'INVALID_AMOUNT' };
    }

    const amountSubunits = Math.round(milestoneAmount * 100);
    const currency = (milestone.currency || 'USD').toLowerCase();

    // 4. Initialize Stripe and create PaymentIntent
    const stripe = getStripeClient();
    const publishableKey = getStripePublishableKey();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountSubunits,
      currency,
      metadata: {
        milestone_id: milestone.id,
        contract_id: rawContract.id,
        client_id: user.id,
        freelancer_id: milestone.freelancer_id,
        platform: 'Workspace',
        provider: 'stripe',
      },
      description: `Escrow Funding: Milestone #${milestone.sequence_order} (${milestone.title})`,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    if (!paymentIntent.client_secret) {
      return {
        success: false,
        error: 'Stripe failed to return client_secret for checkout.',
        code: 'STRIPE_CLIENT_SECRET_MISSING',
      };
    }

    // 5. Persist record in payment_attempts
    try {
      await supabase.rpc('record_payment_attempt', {
        p_milestone_id: milestone.id,
        p_razorpay_order_id: paymentIntent.id,
        p_amount: milestoneAmount,
        p_amount_subunits: amountSubunits,
        p_currency: currency.toUpperCase(),
        p_metadata: {
          provider: 'stripe',
          stripe_payment_intent_id: paymentIntent.id,
          receipt: `stripe_${paymentIntent.id.slice(-12)}`,
          environment: paymentIntent.livemode ? 'live' : 'test',
        },
        p_environment: paymentIntent.livemode ? 'live' : 'test',
      });
    } catch (attemptErr) {
      console.warn('[STRIPE ATTEMPT PERSIST NOTICE]:', attemptErr);
    }

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey,
      amount: milestoneAmount,
      currency: currency.toUpperCase(),
      milestoneTitle: milestone.title,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initialize Stripe PaymentIntent.';
    console.error('[STRIPE CREATE PAYMENT INTENT ERROR]:', err);
    return {
      success: false,
      error: message,
      code: 'STRIPE_INTENT_CREATION_FAILED',
    };
  }
}

/**
 * Authoritatively verifies a succeeded Stripe PaymentIntent and transitions milestone to 'funded'.
 */
export async function verifyAndFundMilestoneStripe(
  input: VerifyStripePaymentInput
): Promise<VerifyStripePaymentResult> {
  if (!input.milestoneId || !UUID_REGEX.test(input.milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  if (!input.paymentIntentId || !input.paymentIntentId.trim()) {
    return { success: false, error: 'PaymentIntent ID is required.', code: 'INVALID_INPUT' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to verify payment.', code: 'UNAUTHENTICATED' };
  }

  try {
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId.trim());

    if (paymentIntent.status !== 'succeeded') {
      return {
        success: false,
        error: `Payment is not completed. Current status: ${paymentIntent.status}.`,
        code: 'PAYMENT_NOT_SUCCEEDED',
      };
    }

    const metadataMilestoneId = paymentIntent.metadata?.milestone_id;
    if (metadataMilestoneId && metadataMilestoneId !== input.milestoneId.trim()) {
      return {
        success: false,
        error: 'PaymentIntent metadata does not match the requested milestone.',
        code: 'PAYMENT_METADATA_MISMATCH',
      };
    }

    // Fetch milestone
    const { data: milestone, error: milestoneError } = await supabase
      .from('contract_milestones')
      .select('id, contract_id, client_id, freelancer_id, status, amount, currency, sequence_order, title')
      .eq('id', input.milestoneId.trim())
      .single();

    if (milestoneError || !milestone) {
      return { success: false, error: 'Milestone not found.', code: 'NOT_FOUND' };
    }

    // If already funded, return idempotent success
    if (milestone.status === 'funded') {
      return {
        success: true,
        milestone: {
          id: milestone.id,
          contractId: milestone.contract_id,
          clientId: milestone.client_id,
          freelancerId: milestone.freelancer_id,
          title: milestone.title,
          amount: Number(milestone.amount),
          currency: milestone.currency,
          status: milestone.status,
        },
      };
    }

    const adminSupabase = getAdminSupabaseClient();
    const paymentMetadata = {
      provider: 'stripe',
      environment: paymentIntent.livemode ? 'live' : 'test',
      razorpay_order_id: paymentIntent.id,
      razorpay_payment_id: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.id,
      captured_amount: paymentIntent.amount,
      captured_currency: paymentIntent.currency.toUpperCase(),
      verified_at: new Date().toISOString(),
      funded_by: user.id,
      client_id: user.id,
      stripe_payment_intent_id: paymentIntent.id,
    };

    let updatedMilestone: {
      id: string;
      contract_id: string;
      client_id: string;
      freelancer_id: string;
      title: string;
      amount: number | string;
      currency: string;
      status: string;
    } | null = null;

    // 1. Try fund_milestone_with_payment RPC
    const { data: rawMilestoneData, error: rpcError } = await adminSupabase.rpc('fund_milestone_with_payment', {
      p_milestone_id: input.milestoneId.trim(),
      p_payment_metadata: paymentMetadata,
    });

    if (!rpcError && rawMilestoneData) {
      updatedMilestone = rawMilestoneData as typeof updatedMilestone;
    } else {
      // 2. Fallback to direct status transition
      const { data: updatedRow, error: updateError } = await adminSupabase
        .from('contract_milestones')
        .update({
          status: 'funded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.milestoneId.trim())
        .select('id, contract_id, client_id, freelancer_id, title, amount, currency, status')
        .single();

      if (updateError || !updatedRow) {
        throw new Error(updateError?.message || 'Failed to update milestone status to funded.');
      }

      updatedMilestone = updatedRow;

      // Record in payment_ledger
      try {
        await adminSupabase.from('payment_ledger').insert({
          contract_id: milestone.contract_id,
          milestone_id: milestone.id,
          from_user_id: user.id,
          to_user_id: milestone.freelancer_id,
          amount: Number(milestone.amount),
          currency: milestone.currency,
          event_type: 'escrow_funded',
          status: 'confirmed',
          description: `Escrow Funded via Stripe: Milestone #${milestone.sequence_order} (${milestone.title})`,
          metadata: paymentMetadata,
        });
      } catch (ledgerErr) {
        console.warn('[STRIPE LEDGER INSERT NOTICE]:', ledgerErr);
      }
    }

    // Activate contract if first funded milestone
    try {
      await adminSupabase
        .from('contracts')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', milestone.contract_id)
        .eq('status', 'pending');
    } catch {
      // Non-blocking
    }

    return {
      success: true,
      milestone: {
        id: updatedMilestone?.id || milestone.id,
        contractId: updatedMilestone?.contract_id || milestone.contract_id,
        clientId: updatedMilestone?.client_id || milestone.client_id,
        freelancerId: updatedMilestone?.freelancer_id || milestone.freelancer_id,
        title: updatedMilestone?.title || milestone.title,
        amount: Number(updatedMilestone?.amount || milestone.amount),
        currency: updatedMilestone?.currency || milestone.currency,
        status: updatedMilestone?.status || 'funded',
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to verify and fund milestone with Stripe.';
    console.error('[STRIPE VERIFY ERROR]:', err);
    return {
      success: false,
      error: message,
      code: 'STRIPE_VERIFICATION_FAILED',
    };
  }
}

export interface CreateTimesheetStripePaymentIntentResult {
  success: boolean;
  clientSecret?: string;
  paymentIntentId?: string;
  publishableKey?: string;
  amount?: number;
  currency?: string;
  timesheetTitle?: string;
  error?: string;
  code?: string;
}

export interface VerifyTimesheetStripePaymentInput {
  timesheetId: string;
  paymentIntentId: string;
}

export interface VerifyTimesheetStripePaymentResult {
  success: boolean;
  error?: string;
  code?: string;
  timesheet?: {
    id: string;
    contractId: string;
    clientId: string;
    freelancerId: string;
    totalAmount: number;
    status: string;
    weekStartDate: string;
  };
}

/**
 * Creates a server-verified Stripe PaymentIntent for weekly hourly timesheet payment in USD ($).
 */
export async function createTimesheetStripePaymentIntent(
  timesheetId: string
): Promise<CreateTimesheetStripePaymentIntentResult> {
  if (!timesheetId || !UUID_REGEX.test(timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
  }

  if (!isStripeConfigured()) {
    return {
      success: false,
      error: 'Stripe is not configured on the server. Please ensure STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are set.',
      code: 'GATEWAY_NOT_CONFIGURED',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to pay timesheets.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Fetch timesheet and associated contract
    const { data: timesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        total_amount,
        status,
        week_start_date,
        contracts:contract_id (
          id,
          client_id,
          company_id,
          contract_type,
          status,
          title
        )
      `)
      .eq('id', timesheetId.trim())
      .single();

    if (timesheetError || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(timesheet.contracts) ? timesheet.contracts[0] : timesheet.contracts;

    // 2. Authorization check
    const isDirectClient = timesheet.client_id === user.id || (rawContract && rawContract.client_id === user.id);
    if (!isDirectClient) {
      if (rawContract?.company_id) {
        const { data: membership } = await supabase
          .from('company_members')
          .select('role')
          .eq('company_id', rawContract.company_id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!membership || !['owner', 'admin', 'hiring_manager'].includes(membership.role)) {
          return { success: false, error: 'You are not authorized to pay this timesheet.', code: 'FORBIDDEN' };
        }
      } else {
        return { success: false, error: 'You are not authorized to pay this timesheet.', code: 'FORBIDDEN' };
      }
    }

    // 3. Amount and currency - Calculate incremental balance due
    const totalAmount = Number(timesheet.total_amount);
    if (isNaN(totalAmount) || totalAmount <= 0) {
      return { success: false, error: 'Timesheet has no billable amount to charge.', code: 'ZERO_AMOUNT' };
    }

    // Query payment_ledger & payment_attempts for THIS specific timesheet/week only
    const adminClient = getAdminSupabaseClient();
    const [{ data: settledLedger }, { data: settledAttempts }] = await Promise.all([
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

    let alreadyPaid = calculateTimesheetPaidAmount({
      timesheetId: timesheet.id,
      weekStartDate: timesheet.week_start_date,
      ledgerRows: settledLedger || [],
      attemptRows: settledAttempts || [],
    });

    if (timesheet.status === 'paid' && alreadyPaid === 0) {
      alreadyPaid = totalAmount;
    }
    const balanceDue = timesheet.status === 'paid' ? 0 : Math.max(0, Math.round((totalAmount - alreadyPaid) * 100) / 100);

    if (timesheet.status === 'paid' || balanceDue <= 0.01) {
      return {
        success: false,
        error: `This timesheet has already been fully paid and settled ($${(alreadyPaid || totalAmount).toFixed(2)}).`,
        code: 'ALREADY_PAID',
      };
    }

    // Allow payment if status is approved, or if status is 'paid'/'open' with active balance due
    const isPayableStatus = timesheet.status === 'approved' || (['open'].includes(timesheet.status) && balanceDue > 0.01);
    if (!isPayableStatus) {
      return {
        success: false,
        error: `Timesheet is in status "${timesheet.status}". Please approve the timesheet before paying.`,
        code: 'INVALID_STATUS',
      };
    }

    const amountSubunits = Math.round(balanceDue * 100);
    const currency = 'usd';
    const tempOrderId = `lock_stripe_${timesheet.id.slice(0, 8)}_${Date.now()}`;

    // Atomically acquire single active payment attempt lock for this timesheet (fail-closed)
    const { data: lockRow, error: lockError } = await adminClient.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: timesheet.id,
      p_client_id: user.id,
      p_provider: 'stripe',
      p_environment: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
      p_amount: balanceDue,
      p_amount_subunits: amountSubunits,
      p_currency: 'USD',
      p_temp_order_id: tempOrderId,
      p_metadata: {
        provider: 'stripe',
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
      console.error('[STRIPE TIMESHEET LOCK FAILED]:', lockError?.message || 'Missing lock row');
      return {
        success: false,
        error: 'Unable to initialize secure payment lock. Please try again shortly.',
        code: 'PAYMENT_LOCK_UNAVAILABLE',
      };
    }

    const lockedAttemptId: string = lockRow.id;

    // 4. Initialize Stripe and create PaymentIntent in USD
    const stripe = getStripeClient();
    const publishableKey = getStripePublishableKey();

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountSubunits,
        currency,
        metadata: {
          timesheet_id: timesheet.id,
          contract_id: timesheet.contract_id,
          client_id: user.id,
          freelancer_id: timesheet.freelancer_id,
          platform: 'Workspace',
          provider: 'stripe',
          type: 'hourly_timesheet',
          week_start_date: timesheet.week_start_date,
          total_timesheet_amount: totalAmount.toString(),
          prior_paid_amount: alreadyPaid.toString(),
          balance_due: balanceDue.toString(),
        },
        description: alreadyPaid > 0
          ? `Hourly Invoice Balance: Week of ${timesheet.week_start_date} ($${balanceDue.toFixed(2)} due after $${alreadyPaid.toFixed(2)} prior payment)`
          : `Hourly Invoice Payment: Week of ${timesheet.week_start_date} (${rawContract?.title || 'Contract'})`,
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (stripeErr) {
      if (lockedAttemptId) {
        await adminClient
          .from('payment_attempts')
          .update({
            status: 'failed',
            error_code: 'STRIPE_INTENT_CREATE_FAILED',
            error_description: stripeErr instanceof Error ? stripeErr.message : 'Stripe PaymentIntent creation failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lockedAttemptId);
      }
      throw stripeErr;
    }

    if (!paymentIntent.client_secret) {
      if (lockedAttemptId) {
        await adminClient
          .from('payment_attempts')
          .update({
            status: 'failed',
            error_code: 'STRIPE_CLIENT_SECRET_MISSING',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lockedAttemptId);
      }
      return {
        success: false,
        error: 'Stripe failed to return client_secret for checkout.',
        code: 'STRIPE_CLIENT_SECRET_MISSING',
      };
    }

    // 5. Finalize record in payment_attempts with real PaymentIntent ID
    if (lockedAttemptId) {
      await adminClient
        .from('payment_attempts')
        .update({
          razorpay_order_id: paymentIntent.id,
          environment: paymentIntent.livemode ? 'live' : 'test',
          metadata: {
            provider: 'stripe',
            stripe_payment_intent_id: paymentIntent.id,
            receipt: `stripe_${paymentIntent.id.slice(-12)}`,
            week_start_date: timesheet.week_start_date,
            prior_paid_amount: alreadyPaid,
            balance_due: balanceDue,
            timesheet_id: timesheet.id,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', lockedAttemptId);
    } else {
      try {
        await adminClient.from('payment_attempts').insert({
          contract_id: timesheet.contract_id,
          billing_type: 'timesheet',
          client_id: user.id,
          provider: 'stripe',
          environment: paymentIntent.livemode ? 'live' : 'test',
          razorpay_order_id: paymentIntent.id,
          amount: balanceDue,
          amount_subunits: amountSubunits,
          currency: 'USD',
          status: 'created',
          metadata: {
            provider: 'stripe',
            stripe_payment_intent_id: paymentIntent.id,
            receipt: `stripe_${paymentIntent.id.slice(-12)}`,
            week_start_date: timesheet.week_start_date,
            prior_paid_amount: alreadyPaid,
            balance_due: balanceDue,
            timesheet_id: timesheet.id,
          },
        });
      } catch (attemptErr) {
        console.warn('[STRIPE TIMESHEET ATTEMPT PERSIST NOTICE]:', attemptErr);
      }
    }

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey,
      amount: balanceDue,
      currency: 'USD',
      timesheetTitle: alreadyPaid > 0
        ? `Week of ${timesheet.week_start_date} (Remaining $${balanceDue.toFixed(2)})`
        : `Week of ${timesheet.week_start_date}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to initialize Stripe PaymentIntent for timesheet.';
    console.error('[STRIPE CREATE TIMESHEET INTENT ERROR]:', err);
    return {
      success: false,
      error: message,
      code: 'STRIPE_TIMESHEET_INTENT_FAILED',
    };
  }
}

/**
 * Authoritatively verifies a succeeded Stripe PaymentIntent and transitions timesheet to 'paid'.
 * Triggers freelancer payout transfer and client receipt recording.
 */
export async function verifyAndPayTimesheetStripe(
  input: VerifyTimesheetStripePaymentInput
): Promise<VerifyTimesheetStripePaymentResult> {
  if (!input.timesheetId || !UUID_REGEX.test(input.timesheetId.trim())) {
    return { success: false, error: 'Invalid timesheet ID format.', code: 'INVALID_ID' };
  }

  if (!input.paymentIntentId || !input.paymentIntentId.trim()) {
    return { success: false, error: 'PaymentIntent ID is required.', code: 'INVALID_INPUT' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to verify payment.', code: 'UNAUTHENTICATED' };
  }

  try {
    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(input.paymentIntentId.trim());

    if (paymentIntent.status !== 'succeeded') {
      return {
        success: false,
        error: `Payment is not completed. Current status: ${paymentIntent.status}.`,
        code: 'PAYMENT_NOT_SUCCEEDED',
      };
    }

    const metadataTimesheetId = paymentIntent.metadata?.timesheet_id;
    if (metadataTimesheetId && metadataTimesheetId !== input.timesheetId.trim()) {
      return {
        success: false,
        error: 'PaymentIntent metadata does not match the requested timesheet.',
        code: 'PAYMENT_METADATA_MISMATCH',
      };
    }

    // Fetch timesheet & contract for strict ownership verification
    const adminClient = getAdminSupabaseClient();
    const { data: timesheet, error: timesheetError } = await adminClient
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
      .eq('id', input.timesheetId.trim())
      .single();

    if (timesheetError || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    const rawContract = Array.isArray(timesheet.contracts) ? timesheet.contracts[0] : timesheet.contracts;
    let companyMemberRole: string | null = null;
    if (timesheet.client_id !== user.id && rawContract?.client_id !== user.id && rawContract?.company_id) {
      const { data: membership } = await adminClient
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

    // Fetch prior settled payments for THIS specific timesheet/week only
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

    // Idempotency check: if this PaymentIntent was already recorded in payment_ledger or timesheet is paid
    const alreadyRecordedIntent = (priorSettled || []).some((r) => {
      const meta = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>;
      return meta.stripe_payment_intent_id === paymentIntent.id;
    });

    if (timesheet.status === 'paid' || alreadyRecordedIntent) {
      return {
        success: true,
        timesheet: {
          id: timesheet.id,
          contractId: timesheet.contract_id,
          clientId: timesheet.client_id,
          freelancerId: timesheet.freelancer_id,
          totalAmount: Number(timesheet.total_amount),
          status: 'paid',
          weekStartDate: timesheet.week_start_date,
        },
      };
    }

    const priorPaidTotal = calculateTimesheetPaidAmount({
      timesheetId: timesheet.id,
      weekStartDate: timesheet.week_start_date,
      ledgerRows: priorSettled || [],
      attemptRows: priorAttempts || [],
    });

    const totalTimesheetAmount = Number(timesheet.total_amount);
    const expectedBalanceDue = Math.max(0, Math.round((totalTimesheetAmount - priorPaidTotal) * 100) / 100);
    const capturedCents = paymentIntent.amount_received || paymentIntent.amount;

    const captureValidation = validateStripeTimesheetCapture({
      capturedCents,
      capturedCurrency: paymentIntent.currency,
      expectedBalanceDue,
      expectedCurrency: 'USD',
    });

    if (!captureValidation.valid) {
      return {
        success: false,
        error: captureValidation.error || 'Captured payment amount or currency mismatch.',
        code: captureValidation.code || 'PAYMENT_AMOUNT_MISMATCH',
      };
    }

    const capturedDollars = capturedCents / 100;
    const totalPaidAfterThis = Math.round((priorPaidTotal + capturedDollars) * 100) / 100;
    const isFullySettled = totalPaidAfterThis >= (totalTimesheetAmount - 0.01);

    const newTimesheetStatus = isFullySettled ? 'paid' : 'approved';

    // 1. Transition timesheet status
    const { data: updatedTimesheet, error: updateError } = await adminClient
      .from('timesheets')
      .update({
        status: newTimesheetStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', timesheet.id)
      .select()
      .single();

    if (updateError || !updatedTimesheet) {
      throw new Error(updateError?.message || 'Failed to update timesheet status.');
    }

    // 2. Update payment_attempts record
    try {
      await adminClient
        .from('payment_attempts')
        .update({
          status: 'captured',
          provider: 'stripe',
          updated_at: new Date().toISOString(),
          metadata: {
            provider: 'stripe',
            stripe_payment_intent_id: paymentIntent.id,
            receipt: `stripe_${paymentIntent.id.slice(-12)}`,
            week_start_date: timesheet.week_start_date,
            prior_paid_total: priorPaidTotal,
            new_paid_total: totalPaidAfterThis,
            is_fully_settled: isFullySettled,
          },
        })
        .eq('razorpay_order_id', paymentIntent.id);
    } catch (attErr) {
      console.warn('[STRIPE TIMESHEET ATTEMPT UPDATE NOTICE]:', attErr);
    }

    // 3. Record in payment_ledger
    try {
      const ledgerPayload = {
        contract_id: timesheet.contract_id,
        from_user_id: timesheet.client_id,
        to_user_id: timesheet.freelancer_id,
        amount: capturedDollars > 0 ? capturedDollars : totalTimesheetAmount,
        currency: 'USD',
        event_type: 'hourly_funded',
        status: 'succeeded',
        description: priorPaidTotal > 0
          ? `Hourly Invoice Balance Payment for Week of ${timesheet.week_start_date} ($${capturedDollars.toFixed(2)})`
          : `Hourly Invoice Payment for Week of ${timesheet.week_start_date}`,
        metadata: {
          provider: 'stripe',
          environment: paymentIntent.livemode ? 'live' : 'test',
          stripe_payment_intent_id: paymentIntent.id,
          timesheet_id: timesheet.id,
          captured_amount: paymentIntent.amount,
          captured_currency: paymentIntent.currency.toUpperCase(),
          payment_verified_at: new Date().toISOString(),
          prior_paid_total: priorPaidTotal,
          new_paid_total: totalPaidAfterThis,
          is_fully_settled: isFullySettled,
        },
      };

      const { error: ledgerErr } = await adminClient.from('payment_ledger').insert(ledgerPayload);
      if (ledgerErr) {
        console.warn('[STRIPE TIMESHEET LEDGER INSERT ERROR]:', ledgerErr.message);
        // Fallback: try with event_type 'escrow_funded' and to_user_id null in case check constraint chk_ledger_event_type rejected 'hourly_funded'
        await adminClient.from('payment_ledger').insert({
          ...ledgerPayload,
          event_type: 'escrow_funded',
          to_user_id: null,
        });
      }
    } catch (ledgerErr) {
      console.warn('[STRIPE TIMESHEET LEDGER INSERT NOTICE]:', ledgerErr);
    }

    // 4. Trigger background freelancer payout via PayoutEngine
    payoutEngine.initiateTimesheetPayout(timesheet.id).catch((payoutErr) => {
      console.error('Background payout transfer initiation failed:', payoutErr);
    });

    // 5. Send notification to freelancer
    try {
      await createNotification({
        userId: timesheet.freelancer_id,
        type: 'payment_processed',
        title: 'Weekly Timesheet Paid in USD!',
        message: `Client approved and paid $${Number(timesheet.total_amount).toFixed(2)} USD via Stripe for the week of ${timesheet.week_start_date}.`,
        metadata: {
          contractId: timesheet.contract_id,
          timesheetId: timesheet.id,
          amount: Number(timesheet.total_amount),
          currency: 'USD',
        },
      });
    } catch (notifErr) {
      console.warn('[NOTIFICATION NOTICE]:', notifErr);
    }

    return {
      success: true,
      timesheet: {
        id: updatedTimesheet.id,
        contractId: updatedTimesheet.contract_id,
        clientId: updatedTimesheet.client_id,
        freelancerId: updatedTimesheet.freelancer_id,
        totalAmount: Number(updatedTimesheet.total_amount),
        status: 'paid',
        weekStartDate: updatedTimesheet.week_start_date,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to verify and pay timesheet with Stripe.';
    console.error('[STRIPE TIMESHEET VERIFY ERROR]:', err);
    return {
      success: false,
      error: message,
      code: 'STRIPE_VERIFICATION_FAILED',
    };
  }
}


