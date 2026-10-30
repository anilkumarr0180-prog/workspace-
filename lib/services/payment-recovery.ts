import { SupabaseClient } from '@supabase/supabase-js';
import Razorpay from 'razorpay';
import { getRazorpayClient, getRazorpayConfig, extractPaymentErrorMessage } from '@/lib/razorpay';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentInspectionResult {
  paymentId: string;
  canReconcile: boolean;
  alreadyReconciled: boolean;
  reason: string;
  gateway: {
    id: string;
    orderId?: string;
    status?: string;
    amountSubunits?: number;
    currency?: string;
    milestoneId?: string;
    createdAt?: number;
  };
  database: {
    attemptFound: boolean;
    attemptId?: string;
    attemptStatus?: string;
    attemptAmountSubunits?: number;
    attemptCurrency?: string;
    milestoneFound: boolean;
    milestoneStatus?: string;
    milestoneAmount?: number;
    milestoneCurrency?: string;
    contractId?: string;
    fundedLedgerEntryExists: boolean;
  };
  discrepancies: string[];
}

export interface PaymentRecoveryResult {
  success: boolean;
  paymentId: string;
  actionTaken: 'reconciled' | 'already_reconciled' | 'aborted';
  message: string;
  inspection: PaymentInspectionResult;
  rpcResult?: Record<string, unknown>;
}

export interface ReconcilePaymentOptions {
  operatorId?: string;
  notes?: string;
  dryRun?: boolean;
}

/**
 * Read-Only Inspection of a captured Razorpay payment against the database.
 * 
 * Safety Guarantees:
 * - 100% Read-only: Makes zero database mutations and zero gateway mutations.
 * - Strictly validates captured status, order ID, amount, currency, and milestone notes.
 * - Never calls orders.create() or attempts payment re-charging.
 */
export async function inspectCapturedPayment(
  paymentId: string,
  deps?: {
    razorpayClient?: Razorpay;
    supabaseClient?: SupabaseClient;
  }
): Promise<PaymentInspectionResult> {
  const cleanPaymentId = paymentId ? paymentId.trim() : '';
  if (!cleanPaymentId) {
    throw new Error('Payment ID cannot be empty');
  }

  const razorpay = deps?.razorpayClient || getRazorpayClient();
  const supabase = deps?.supabaseClient || getAdminSupabaseClient();

  // 1. Fetch payment entity from Razorpay REST API
  let gatewayPayment: {
    id: string;
    order_id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    notes?: Record<string, string>;
    created_at?: number;
  };

  try {
    gatewayPayment = (await razorpay.payments.fetch(cleanPaymentId)) as typeof gatewayPayment;
  } catch (err: unknown) {
    const errorMsg = extractPaymentErrorMessage(err, 'Failed to fetch payment from Razorpay API');
    throw new Error(`Razorpay API Fetch Error for payment ${cleanPaymentId}: ${errorMsg}`);
  }

  const gatewayOrderId = gatewayPayment.order_id?.trim();
  const gatewayStatus = gatewayPayment.status;
  const gatewayAmount = gatewayPayment.amount != null ? Number(gatewayPayment.amount) : undefined;
  const gatewayCurrency = gatewayPayment.currency?.toUpperCase();
  const gatewayMilestoneId = gatewayPayment.notes?.milestone_id?.trim();

  const discrepancies: string[] = [];

  // Validation Check 1: Status must be 'captured'
  if (gatewayStatus !== 'captured') {
    discrepancies.push(`Gateway payment status is '${gatewayStatus}', but reconciliation requires 'captured'.`);
  }

  // Validation Check 2: Order ID must exist
  if (!gatewayOrderId) {
    discrepancies.push('Gateway payment entity does not contain an order_id.');
  }

  // Validation Check 3: Amount must be valid
  if (!gatewayAmount || gatewayAmount <= 0) {
    discrepancies.push(`Gateway payment amount is invalid: ${gatewayAmount}.`);
  }

  // Validation Check 4: Currency must be present
  if (!gatewayCurrency) {
    discrepancies.push('Gateway payment currency is missing.');
  }

  // Validation Check 5: Milestone ID in notes must be valid UUID
  if (!gatewayMilestoneId || !UUID_REGEX.test(gatewayMilestoneId)) {
    discrepancies.push(`Gateway payment notes.milestone_id is invalid or not a UUID: "${gatewayMilestoneId}".`);
  }

  // 2. Fetch corresponding database state
  let attemptFound = false;
  let attemptId: string | undefined;
  let attemptStatus: string | undefined;
  let attemptAmountSubunits: number | undefined;
  let attemptCurrency: string | undefined;
  let milestoneFound = false;
  let milestoneStatus: string | undefined;
  let milestoneAmount: number | undefined;
  let milestoneCurrency: string | undefined;
  let contractId: string | undefined;
  let fundedLedgerEntryExists = false;

  if (gatewayOrderId) {
    const { data: attempt } = await supabase
      .from('payment_attempts')
      .select('id, milestone_id, contract_id, amount_subunits, currency, status, razorpay_order_id, razorpay_payment_id')
      .eq('razorpay_order_id', gatewayOrderId)
      .maybeSingle();

    if (attempt) {
      attemptFound = true;
      attemptId = attempt.id;
      attemptStatus = attempt.status;
      attemptAmountSubunits = Number(attempt.amount_subunits);
      attemptCurrency = attempt.currency?.toUpperCase();
      contractId = attempt.contract_id;

      // Verify milestone association matches
      if (gatewayMilestoneId && attempt.milestone_id !== gatewayMilestoneId) {
        discrepancies.push(
          `Milestone mismatch: Gateway payment notes point to ${gatewayMilestoneId}, but attempt is tied to ${attempt.milestone_id}.`
        );
      }

      // Verify amount matches
      if (gatewayAmount && attemptAmountSubunits !== gatewayAmount) {
        discrepancies.push(
          `Amount mismatch: Gateway payment has ${gatewayAmount} subunits, but database attempt expects ${attemptAmountSubunits} subunits.`
        );
      }

      // Verify currency matches
      if (gatewayCurrency && attemptCurrency !== gatewayCurrency) {
        discrepancies.push(
          `Currency mismatch: Gateway payment is ${gatewayCurrency}, but database attempt is ${attemptCurrency}.`
        );
      }
    } else {
      discrepancies.push(`No payment_attempts record found for Razorpay order ID "${gatewayOrderId}".`);
    }
  }

  const targetMilestoneId = gatewayMilestoneId;
  if (targetMilestoneId && UUID_REGEX.test(targetMilestoneId)) {
    const { data: milestone } = await supabase
      .from('contract_milestones')
      .select('id, contract_id, amount, currency, status')
      .eq('id', targetMilestoneId)
      .maybeSingle();

    if (milestone) {
      milestoneFound = true;
      milestoneStatus = milestone.status;
      milestoneAmount = Number(milestone.amount);
      milestoneCurrency = milestone.currency?.toUpperCase();
      if (!contractId) contractId = milestone.contract_id;
    } else {
      discrepancies.push(`Milestone "${targetMilestoneId}" referenced in payment notes was not found in the database.`);
    }

    const { data: ledgerEntries } = await supabase
      .from('payment_ledger')
      .select('id')
      .eq('milestone_id', targetMilestoneId)
      .eq('event_type', 'escrow_funded');

    fundedLedgerEntryExists = Boolean(ledgerEntries && ledgerEntries.length > 0);
  }

  // 3. Evaluate Reconciliation Readiness
  const alreadyReconciled = milestoneStatus === 'funded' && attemptStatus === 'captured';

  let canReconcile = false;
  let reason = '';

  if (alreadyReconciled) {
    reason = 'Payment is already fully reconciled in the database (Milestone is funded, attempt is captured).';
  } else if (discrepancies.length > 0) {
    reason = `Cannot reconcile due to ${discrepancies.length} discrepancy/discrepancies.`;
  } else if (milestoneStatus !== 'planned') {
    reason = `Milestone is in status "${milestoneStatus}", which cannot be transitioned to funded.`;
  } else if (!attemptFound) {
    reason = 'No matching payment attempt exists to reconcile against.';
  } else {
    canReconcile = true;
    reason = 'Payment capture is valid, verified against gateway, and ready for safe exactly-once atomic reconciliation.';
  }

  return {
    paymentId: cleanPaymentId,
    canReconcile,
    alreadyReconciled,
    reason,
    gateway: {
      id: cleanPaymentId,
      orderId: gatewayOrderId,
      status: gatewayStatus,
      amountSubunits: gatewayAmount,
      currency: gatewayCurrency,
      milestoneId: gatewayMilestoneId,
      createdAt: gatewayPayment.created_at,
    },
    database: {
      attemptFound,
      attemptId,
      attemptStatus,
      attemptAmountSubunits,
      attemptCurrency,
      milestoneFound,
      milestoneStatus,
      milestoneAmount,
      milestoneCurrency,
      contractId,
      fundedLedgerEntryExists,
    },
    discrepancies,
  };
}

/**
 * Operator Recovery Procedure: Safely reconciles an existing captured payment.
 * 
 * Strict Guarantees:
 * 1. Performs thorough read-only inspection first; refuses to execute if any discrepancy is found.
 * 2. If already reconciled, returns immediately without modifying state.
 * 3. Never calls razorpay.orders.create() or initiates any charge.
 * 4. Calls the atomic stored procedure reconcile_webhook_payment using the service_role client.
 * 5. Guarantees exactly-once escrow ledger insertion.
 */
export async function reconcileCapturedPayment(
  paymentId: string,
  options?: ReconcilePaymentOptions,
  deps?: {
    razorpayClient?: Razorpay;
    supabaseClient?: SupabaseClient;
  }
): Promise<PaymentRecoveryResult> {
  const inspection = await inspectCapturedPayment(paymentId, deps);

  // If already reconciled, exit cleanly
  if (inspection.alreadyReconciled) {
    return {
      success: true,
      paymentId,
      actionTaken: 'already_reconciled',
      message: 'Payment was already reconciled in database; no changes needed.',
      inspection,
    };
  }

  // Refuse execution if unsafe or discrepant
  if (!inspection.canReconcile) {
    return {
      success: false,
      paymentId,
      actionTaken: 'aborted',
      message: `Reconciliation aborted: ${inspection.reason}`,
      inspection,
    };
  }

  // Dry run check
  if (options?.dryRun) {
    return {
      success: true,
      paymentId,
      actionTaken: 'aborted',
      message: 'Dry-run inspection succeeded. No database mutations executed.',
      inspection,
    };
  }

  const supabase = deps?.supabaseClient || getAdminSupabaseClient();
  const config = getRazorpayConfig();

  const operatorId = options?.operatorId || 'operator_recovery_cli';
  const notes = options?.notes || 'Safe operator-initiated recovery for captured payment';

  // Execute atomic reconciliation via existing stored procedure
  const { data: rpcResult, error: rpcError } = await supabase.rpc('reconcile_webhook_payment', {
    p_milestone_id: inspection.gateway.milestoneId!,
    p_razorpay_order_id: inspection.gateway.orderId!,
    p_razorpay_payment_id: paymentId.trim(),
    p_amount_subunits: inspection.gateway.amountSubunits,
    p_currency: inspection.gateway.currency,
    p_payment_metadata: {
      provider: 'razorpay',
      source: 'operator_recovery',
      environment: config.environment,
      operator_id: operatorId,
      notes,
      razorpay_order_id: inspection.gateway.orderId,
      razorpay_payment_id: paymentId.trim(),
      reconciled_at: new Date().toISOString(),
    },
    p_event_id: `recovery_${paymentId.trim()}`,
    p_payload_hash: `manual_recovery_${Date.now()}`,
  });

  if (rpcError) {
    throw new Error(`Database atomic reconciliation failed: ${rpcError.message} (Code: ${rpcError.code})`);
  }

  return {
    success: true,
    paymentId,
    actionTaken: 'reconciled',
    message: 'Payment successfully and atomically reconciled into escrow.',
    inspection,
    rpcResult: rpcResult as Record<string, unknown>,
  };
}
