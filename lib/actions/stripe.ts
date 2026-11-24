'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getStripeClient, isStripeConfigured, getStripePublishableKey } from '@/lib/stripe';
import { payoutEngine } from '@/lib/services/payout-engine';
import { createNotification } from '@/lib/actions/notifications';

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

    // Query payment_ledger for settled hourly timesheet payments on this contract
    const { data: settledLedger } = await supabase
      .from('payment_ledger')
      .select('timesheet_id, amount, status, metadata, description')
      .eq('contract_id', timesheet.contract_id)
      .eq('status', 'succeeded');

    let alreadyPaid = 0;
    for (const r of settledLedger || []) {
      const tsId = (r.timesheet_id || (r.metadata as Record<string, unknown>)?.timesheet_id) as string | undefined;
      const weekMatch = typeof r.description === 'string' ? r.description.match(/\b\d{4}-\d{2}-\d{2}\b/) : null;
      const weekKey = weekMatch ? weekMatch[0] : ((r.metadata as Record<string, unknown>)?.week_start_date as string | undefined);

      if (tsId === timesheet.id || weekKey === timesheet.week_start_date) {
        alreadyPaid += Number(r.amount || 0);
      }
    }

    // Fallback: if ledger did not match by timesheet_id or week, check payment_attempts or total settled
    if (alreadyPaid === 0) {
      const adminClient = getAdminSupabaseClient();
      const { data: settledAttempts } = await adminClient
        .from('payment_attempts')
        .select('timesheet_id, amount, status, metadata')
        .eq('contract_id', timesheet.contract_id)
        .in('status', ['captured', 'succeeded']);

      for (const a of settledAttempts || []) {
        const tsId = (a.timesheet_id || (a.metadata as Record<string, unknown>)?.timesheet_id) as string | undefined;
        const weekKey = (a.metadata as Record<string, unknown>)?.week_start_date as string | undefined;
        if (tsId === timesheet.id || weekKey === timesheet.week_start_date) {
          alreadyPaid += Number(a.amount || 0);
        }
      }

      if (alreadyPaid === 0 && (settledLedger || []).length > 0) {
        const totalContractSettled = (settledLedger || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
        if (totalContractSettled > 0) {
          alreadyPaid = totalContractSettled;
        }
      }
    }

    alreadyPaid = Math.round(alreadyPaid * 100) / 100;
    const balanceDue = Math.max(0, Math.round((totalAmount - alreadyPaid) * 100) / 100);

    if (balanceDue <= 0.01) {
      return {
        success: false,
        error: `This timesheet has already been fully paid and settled ($${alreadyPaid.toFixed(2)}).`,
        code: 'ALREADY_PAID',
      };
    }

    // Allow payment if status is approved, or if status is 'paid'/'open' with active balance due
    const isPayableStatus = timesheet.status === 'approved' || (['paid', 'open'].includes(timesheet.status) && balanceDue > 0.01);
    if (!isPayableStatus) {
      return {
        success: false,
        error: `Timesheet is in status "${timesheet.status}". Please approve the timesheet before paying.`,
        code: 'INVALID_STATUS',
      };
    }

    // If timesheet was previously marked 'paid' in DB but new hours created a balance due, sync status to 'approved'
    if (timesheet.status === 'paid' && balanceDue > 0.01) {
      try {
        const adminClient = getAdminSupabaseClient();
        await adminClient
          .from('timesheets')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', timesheet.id);
      } catch (syncErr) {
        console.warn('Failed to sync timesheet status to approved:', syncErr);
      }
    }

    const amountSubunits = Math.round(balanceDue * 100);
    const currency = 'usd';

    // 4. Initialize Stripe and create PaymentIntent in USD
    const stripe = getStripeClient();
    const publishableKey = getStripePublishableKey();

    const paymentIntent = await stripe.paymentIntents.create({
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

    if (!paymentIntent.client_secret) {
      return {
        success: false,
        error: 'Stripe failed to return client_secret for checkout.',
        code: 'STRIPE_CLIENT_SECRET_MISSING',
      };
    }

    // 5. Persist record in payment_attempts
    try {
      const adminClient = getAdminSupabaseClient();
      await adminClient.from('payment_attempts').insert({
        contract_id: timesheet.contract_id,
        timesheet_id: timesheet.id,
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
        },
      });
    } catch (attemptErr) {
      console.warn('[STRIPE TIMESHEET ATTEMPT PERSIST NOTICE]:', attemptErr);
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

    // Fetch timesheet
    const adminClient = getAdminSupabaseClient();
    const { data: timesheet, error: timesheetError } = await adminClient
      .from('timesheets')
      .select('id, contract_id, client_id, freelancer_id, total_amount, status, week_start_date')
      .eq('id', input.timesheetId.trim())
      .single();

    if (timesheetError || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    // Fetch prior settled payments on this contract to calculate total paid
    const { data: priorSettled } = await adminClient
      .from('payment_ledger')
      .select('timesheet_id, amount, status, metadata, description')
      .eq('contract_id', timesheet.contract_id)
      .eq('status', 'succeeded');

    let priorPaidTotal = 0;
    for (const r of priorSettled || []) {
      const tsId = (r.timesheet_id || (r.metadata as Record<string, unknown>)?.timesheet_id) as string | undefined;
      const weekMatch = typeof r.description === 'string' ? r.description.match(/\b\d{4}-\d{2}-\d{2}\b/) : null;
      const weekKey = weekMatch ? weekMatch[0] : ((r.metadata as Record<string, unknown>)?.week_start_date as string | undefined);
      if (tsId === timesheet.id || weekKey === timesheet.week_start_date) {
        priorPaidTotal += Number(r.amount || 0);
      }
    }
    priorPaidTotal = Math.round(priorPaidTotal * 100) / 100;

    const capturedDollars = (paymentIntent.amount_received || paymentIntent.amount) / 100;
    const totalPaidAfterThis = Math.round((priorPaidTotal + capturedDollars) * 100) / 100;
    const totalTimesheetAmount = Number(timesheet.total_amount);
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
        .eq('timesheet_id', timesheet.id);
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

      const { error: ledgerError } = await adminClient.from('payment_ledger').insert({
        ...ledgerPayload,
        timesheet_id: timesheet.id,
      });

      if (ledgerError) {
        await adminClient.from('payment_ledger').insert(ledgerPayload);
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


