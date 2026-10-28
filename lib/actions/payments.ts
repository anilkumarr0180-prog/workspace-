'use server';

import { createClient } from '@/lib/supabase/server';
import { getRazorpayClient, verifyRazorpayPaymentSignature } from '@/lib/razorpay';
import { MilestoneResult } from '@/lib/actions/milestones';
import { MilestoneStatus } from '@/lib/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  amount?: number;
  currency?: string;
  keyId?: string;
  milestoneTitle?: string;
  clientName?: string;
  clientEmail?: string;
  contractId?: string;
  error?: string;
  code?: string;
}

export interface VerifyPaymentInput {
  milestoneId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

interface RawPaymentAttemptRow {
  id: string;
  contract_id: string;
  milestone_id: string;
  client_id: string;
  provider: string;
  environment: string;
  razorpay_order_id: string;
  razorpay_payment_id?: string | null;
  razorpay_signature?: string | null;
  amount: number | string;
  amount_subunits: number | string;
  currency: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Creates and persists a server-verified Razorpay Order for milestone escrow funding.
 * Rejects currency mismatches and validates all milestone constraints.
 */
export async function createMilestoneRazorpayOrder(
  milestoneId: string
): Promise<CreateOrderResult> {
  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to create payment orders.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Fetch milestone and contract
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

    // 2. Validate contract type and milestone status
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

    // 3. Verify user authorization (client or authorized company member)
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

    // 4. Validate Currency Matching (No silent conversions between USD and INR)
    const milestoneCurrency = (milestone.currency || 'USD').toUpperCase();
    const configuredCurrency = (process.env.RAZORPAY_CURRENCY || 'USD').toUpperCase();

    if (milestoneCurrency !== configuredCurrency) {
      return {
        success: false,
        error: `Currency mismatch: Milestone currency (${milestoneCurrency}) does not match configured gateway currency (${configuredCurrency}). Automatic cross-currency conversion is not permitted.`,
        code: 'CURRENCY_MISMATCH',
      };
    }

    // 5. Calculate amount in smallest currency unit (cents/paise)
    const milestoneAmount = Number(milestone.amount);
    if (isNaN(milestoneAmount) || milestoneAmount <= 0) {
      return { success: false, error: 'Invalid milestone amount.', code: 'INVALID_AMOUNT' };
    }

    const amountSubunits = Math.round(milestoneAmount * 100);
    if (!Number.isSafeInteger(amountSubunits) || amountSubunits <= 0) {
      return { success: false, error: 'Invalid currency sub-unit calculation.', code: 'INVALID_AMOUNT' };
    }

    // 6. Initialize Razorpay SDK client
    const razorpay = getRazorpayClient();
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();

    // Receipt length maximum is 40 characters in Razorpay
    const receipt = `ms_${milestone.id.replace(/-/g, '').slice(0, 32)}`;

    // 7. Create Razorpay Order via REST API
    const order = await razorpay.orders.create({
      amount: amountSubunits,
      currency: milestoneCurrency,
      receipt,
      notes: {
        milestone_id: milestone.id,
        contract_id: rawContract.id,
        client_id: user.id,
        environment: 'test',
        platform: 'Workspace',
      },
    });

    // 8. Persist the generated order attempt in database (Fail closed if migration unapplied)
    const { error: attemptError } = await supabase.rpc('record_payment_attempt', {
      p_milestone_id: milestone.id,
      p_razorpay_order_id: order.id,
      p_amount: milestoneAmount,
      p_amount_subunits: amountSubunits,
      p_currency: milestoneCurrency,
      p_metadata: {
        receipt,
        environment: 'test',
      },
    });

    if (attemptError) {
      if (attemptError.code === '42883' || attemptError.code === '42P01') {
        return {
          success: false,
          error: 'Payment order database schema is not installed. Please apply migration 20261028000002_razorpay_payment_orders.sql.',
          code: 'MIGRATION_UNAPPLIED',
        };
      }
      return {
        success: false,
        error: `Failed to persist payment attempt: ${attemptError.message}`,
        code: attemptError.code,
      };
    }

    const { data: clientProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    return {
      success: true,
      orderId: order.id,
      amount: order.amount as number,
      currency: order.currency,
      keyId,
      milestoneTitle: milestone.title,
      clientName: clientProfile?.full_name || user.user_metadata?.full_name || 'Client',
      clientEmail: user.email || '',
      contractId: rawContract.id,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create Razorpay payment order.';
    return { success: false, error: message };
  }
}

/**
 * Cryptographically verifies Razorpay payment signature and transitions milestone to funded.
 * Enforces fail-closed validation against server-persisted order attempt and Razorpay API.
 */
export async function verifyAndFundMilestoneRazorpay(
  input: VerifyPaymentInput
): Promise<MilestoneResult> {
  const { milestoneId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;

  if (!milestoneId || !UUID_REGEX.test(milestoneId.trim())) {
    return { success: false, error: 'Invalid milestone ID format.', code: 'INVALID_ID' };
  }

  if (!razorpayOrderId?.trim() || !razorpayPaymentId?.trim() || !razorpaySignature?.trim()) {
    return {
      success: false,
      error: 'Missing required Razorpay payment verification fields.',
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

  // 1. Fetch the server-persisted payment attempt (Never trust client-supplied order ID without DB match)
  const { data: rawAttempt, error: attemptError } = await supabase.rpc('get_payment_attempt_for_milestone', {
    p_milestone_id: milestoneId.trim(),
    p_razorpay_order_id: razorpayOrderId.trim(),
  });

  if (attemptError) {
    if (attemptError.code === '42883' || attemptError.code === '42P01') {
      return {
        success: false,
        error: 'Payment order database schema is not installed. Please apply migration 20261028000002_razorpay_payment_orders.sql.',
        code: 'MIGRATION_UNAPPLIED',
      };
    }
    return {
      success: false,
      error: 'No persisted payment order found matching this milestone and order ID.',
      code: 'ORDER_NOT_FOUND',
    };
  }

  const attempt = rawAttempt as unknown as RawPaymentAttemptRow;
  if (!attempt) {
    return {
      success: false,
      error: 'No persisted payment attempt found matching this milestone.',
      code: 'ORDER_NOT_FOUND',
    };
  }

  // Idempotency check: If attempt was already captured, check milestone status
  const { data: milestone, error: milestoneError } = await supabase
    .from('contract_milestones')
    .select('id, contract_id, client_id, freelancer_id, status, amount, currency, sequence_order, title, description, due_date, created_at, updated_at')
    .eq('id', milestoneId.trim())
    .single();

  if (milestoneError || !milestone) {
    return { success: false, error: 'Milestone not found.', code: 'NOT_FOUND' };
  }

  if (milestone.status === 'funded') {
    return {
      success: true,
      milestone: {
        id: milestone.id,
        contractId: milestone.contract_id,
        clientId: milestone.client_id,
        freelancerId: milestone.freelancer_id,
        title: milestone.title,
        description: milestone.description,
        amount: Number(milestone.amount),
        currency: milestone.currency,
        sequenceOrder: milestone.sequence_order,
        dueDate: milestone.due_date || null,
        status: milestone.status as MilestoneStatus,
        createdAt: milestone.created_at,
        updatedAt: milestone.updated_at,
      },
    };
  }

  if (milestone.status !== 'planned') {
    return {
      success: false,
      error: `Milestone is in state "${milestone.status}" and cannot be funded.`,
      code: 'INVALID_STATE',
    };
  }

  // 2. Verify Razorpay HMAC-SHA256 signature using the PERSISTED expected order ID
  const isValidSignature = verifyRazorpayPaymentSignature(
    attempt.razorpay_order_id,
    razorpayPaymentId.trim(),
    razorpaySignature.trim()
  );

  if (!isValidSignature) {
    return {
      success: false,
      error: 'Cryptographic signature verification failed. Payment authenticity could not be verified.',
      code: 'INVALID_SIGNATURE',
    };
  }

  // 3. Mandatory Fail-Closed check against Razorpay REST API
  // Fetch payment details directly from Razorpay's servers
  let payment: {
    status?: string;
    order_id?: string;
    amount?: number;
    currency?: string;
  };

  try {
    const razorpay = getRazorpayClient();
    payment = (await razorpay.payments.fetch(razorpayPaymentId.trim())) as typeof payment;
  } catch (apiErr) {
    const message = apiErr instanceof Error ? apiErr.message : 'Communication error with Razorpay API';
    return {
      success: false,
      error: `Failed to verify payment with Razorpay: ${message}. Payment funding rejected.`,
      code: 'PAYMENT_API_FAILED',
    };
  }

  // Strict check 1: Status must be captured
  if (payment.status !== 'captured') {
    return {
      success: false,
      error: `Razorpay payment status is "${payment.status}". Only fully captured payments are accepted.`,
      code: 'PAYMENT_NOT_CAPTURED',
    };
  }

  // Strict check 2: Associated order ID must match persisted attempt order ID
  if (payment.order_id !== attempt.razorpay_order_id) {
    return {
      success: false,
      error: `Payment order mismatch: payment belongs to ${payment.order_id}, expected ${attempt.razorpay_order_id}.`,
      code: 'ORDER_ID_MISMATCH',
    };
  }

  // Strict check 3: Captured amount must match expected sub-units exactly
  const expectedSubunits = Number(attempt.amount_subunits);
  if (Number(payment.amount) !== expectedSubunits) {
    return {
      success: false,
      error: `Payment amount mismatch: captured ${payment.amount}, expected ${expectedSubunits}.`,
      code: 'AMOUNT_MISMATCH',
    };
  }

  // Strict check 4: Currency must match milestone currency exactly
  const expectedCurrency = attempt.currency.toUpperCase();
  if (payment.currency?.toUpperCase() !== expectedCurrency) {
    return {
      success: false,
      error: `Payment currency mismatch: captured ${payment.currency}, expected ${expectedCurrency}.`,
      code: 'CURRENCY_MISMATCH',
    };
  }

  // 4. Execute atomic database stored procedure to fund milestone and record ledger event
  const paymentMetadata = {
    provider: 'razorpay',
    environment: 'test',
    razorpay_order_id: attempt.razorpay_order_id,
    razorpay_payment_id: razorpayPaymentId.trim(),
    razorpay_signature: razorpaySignature.trim(),
    captured_amount: payment.amount,
    captured_currency: payment.currency,
    verified_at: new Date().toISOString(),
  };

  try {
    const { data: rawMilestoneData, error: rpcError } = await supabase.rpc('fund_milestone_with_payment', {
      p_milestone_id: milestoneId.trim(),
      p_payment_metadata: paymentMetadata,
    });

    if (rpcError) {
      if (rpcError.code === '42883' || rpcError.code === '42P01') {
        return {
          success: false,
          error: 'Milestone funding database procedure is not installed. Please apply migration 20261028000002_razorpay_payment_orders.sql.',
          code: 'MIGRATION_UNAPPLIED',
        };
      }
      return { success: false, error: rpcError.message, code: rpcError.code };
    }

    const raw = rawMilestoneData as {
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
    };

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
    const message = err instanceof Error ? err.message : 'Failed to finalize milestone payment.';
    return { success: false, error: message };
  }
}
