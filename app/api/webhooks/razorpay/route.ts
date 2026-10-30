import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  verifyRazorpayWebhookSignature,
  isRazorpayWebhookConfigured,
  getRazorpayConfig,
} from '@/lib/razorpay';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { payoutEngine } from '@/lib/services/payout-engine';

/**
 * Hardened Razorpay Webhook Endpoint for asynchronous payment events.
 * 
 * Security & Reliability Guarantees:
 * 1. Cryptographic HMAC SHA-256 signature verification in constant time against raw request body before database interactions.
 * 2. Dedicated server-only Supabase admin client (SERVICE_ROLE_KEY) - never exposed to clients.
 * 3. Webhook event deduplication tracking via public.webhook_events table.
 * 4. Fail-closed validation: Order attempt must exist, amount and currency must match.
 * 5. Atomic database-level idempotency via PostgreSQL procedure reconcile_webhook_payment.
 * 6. Clean separation of 400 (tampering / bad input) vs 500 (transient DB failures for gateway retry).
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify that webhook secret is configured on the server
    if (!isRazorpayWebhookConfigured()) {
      console.error('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured.');
      return NextResponse.json(
        { error: 'Razorpay webhook secret is not configured on the server.' },
        { status: 500 }
      );
    }

    const signature = request.headers.get('x-razorpay-signature');
    const rawBody = await request.text();

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing x-razorpay-signature header' },
        { status: 400 }
      );
    }

    // 2. Cryptographic signature verification in constant time
    const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.error('Razorpay webhook signature verification failed.');
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    // 3. Compute cryptographic payload hash and resolve centralized config
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const config = getRazorpayConfig();

    // 4. Parse JSON payload
    let eventData: {
      id?: string;
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            amount?: number | string;
            currency?: string;
            status?: string;
            notes?: Record<string, string>;
          };
        };
        order?: {
          entity?: {
            id?: string;
            amount?: number | string;
            currency?: string;
            status?: string;
            notes?: Record<string, string>;
          };
        };
      };
    } = {};

    try {
      eventData = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const event = eventData.event || 'unknown';
    const eventId = (eventData.id && typeof eventData.id === 'string' && eventData.id.trim())
      ? eventData.id.trim()
      : `evt_sha_${payloadHash.slice(0, 24)}`;

    const adminSupabase = getAdminSupabaseClient();

    const paymentEntity = eventData.payload?.payment?.entity;
    const orderEntity = eventData.payload?.order?.entity;

    // 5. Deliberate event handling: only payment.captured and order.paid can fund escrow
    if (event !== 'order.paid' && event !== 'payment.captured') {
      try {
        await adminSupabase.rpc('record_webhook_event_receipt', {
          p_event_id: eventId,
          p_event_type: event,
          p_payload_hash: payloadHash,
          p_environment: config.environment,
          p_status: 'ignored',
          p_metadata: { reason: `Unhandled event type: ${event}` },
        });
      } catch (logErr) {
        console.warn('Failed to log ignored webhook event to DB:', logErr);
      }

      return NextResponse.json({
        received: true,
        ignored: true,
        event_id: eventId,
        reason: `Unhandled event type: ${event}`,
      });
    }

    // 6. Target identification: Milestone or Timesheet
    const rawMilestoneId =
      paymentEntity?.notes?.milestone_id || orderEntity?.notes?.milestone_id;
    const rawTimesheetId =
      paymentEntity?.notes?.timesheet_id || orderEntity?.notes?.timesheet_id;

    const milestoneId =
      typeof rawMilestoneId === 'string' && rawMilestoneId.trim() ? rawMilestoneId.trim() : null;
    const timesheetId =
      typeof rawTimesheetId === 'string' && rawTimesheetId.trim() ? rawTimesheetId.trim() : null;

    // Reject conflicting metadata: same payment cannot fund both a milestone and a timesheet
    if (milestoneId && timesheetId) {
      try {
        await adminSupabase.rpc('record_webhook_event_receipt', {
          p_event_id: eventId,
          p_event_type: event,
          p_payload_hash: payloadHash,
          p_environment: config.environment,
          p_status: 'failed',
          p_error_details: {
            code: 'CONFLICTING_PAYMENT_METADATA',
            message: 'Both milestone_id and timesheet_id present in payment notes',
          },
        });
      } catch (logErr) {
        console.warn('Failed to log failed webhook event to DB:', logErr);
      }

      return NextResponse.json(
        {
          error: 'Conflicting payment metadata: both milestone_id and timesheet_id present',
          code: 'CONFLICTING_PAYMENT_METADATA',
        },
        { status: 400 }
      );
    }

    // Reject missing target: at least one must be present
    if (!milestoneId && !timesheetId) {
      try {
        await adminSupabase.rpc('record_webhook_event_receipt', {
          p_event_id: eventId,
          p_event_type: event,
          p_payload_hash: payloadHash,
          p_environment: config.environment,
          p_status: 'failed',
          p_error_details: {
            code: 'MISSING_PAYMENT_TARGET',
            message: 'Missing both milestone_id and timesheet_id in payment notes',
          },
        });
      } catch (logErr) {
        console.warn('Failed to log failed webhook event to DB:', logErr);
      }

      return NextResponse.json(
        {
          error: 'Missing payment target (milestone_id or timesheet_id) in payment notes',
          code: 'MISSING_PAYMENT_TARGET',
        },
        { status: 400 }
      );
    }

    // 7. Extract payment attributes and enforce status checks
    let orderId: string | undefined;
    let paymentId: string | null = null;
    let amountSubunits: number | null = null;
    let currency: string | null = null;

    if (event === 'payment.captured') {
      if (paymentEntity?.status && paymentEntity.status !== 'captured') {
        try {
          await adminSupabase.rpc('record_webhook_event_receipt', {
            p_event_id: eventId,
            p_event_type: event,
            p_payload_hash: payloadHash,
            p_environment: config.environment,
            p_status: 'ignored',
            p_metadata: { reason: `Payment status is '${paymentEntity.status}', not 'captured'.` },
          });
        } catch (logErr) {
          console.warn('Failed to log ignored uncaptured payment event:', logErr);
        }

        return NextResponse.json({
          received: true,
          ignored: true,
          event_id: eventId,
          reason: `Payment status is '${paymentEntity.status}', not 'captured'.`,
        });
      }
      orderId = paymentEntity?.order_id || orderEntity?.id;
      paymentId = paymentEntity?.id || null;
      amountSubunits = paymentEntity?.amount != null ? Number(paymentEntity.amount) : null;
      currency = paymentEntity?.currency || null;
    } else if (event === 'order.paid') {
      if (orderEntity?.status && orderEntity.status !== 'paid') {
        try {
          await adminSupabase.rpc('record_webhook_event_receipt', {
            p_event_id: eventId,
            p_event_type: event,
            p_payload_hash: payloadHash,
            p_environment: config.environment,
            p_status: 'ignored',
            p_metadata: { reason: `Order status is '${orderEntity.status}', not 'paid'.` },
          });
        } catch (logErr) {
          console.warn('Failed to log ignored unpaid order event:', logErr);
        }

        return NextResponse.json({
          received: true,
          ignored: true,
          event_id: eventId,
          reason: `Order status is '${orderEntity.status}', not 'paid'.`,
        });
      }
      orderId = orderEntity?.id || paymentEntity?.order_id;
      paymentId = paymentEntity?.id || null;
      amountSubunits = orderEntity?.amount != null ? Number(orderEntity.amount) : null;
      currency = orderEntity?.currency || null;
    }

    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      try {
        await adminSupabase.rpc('record_webhook_event_receipt', {
          p_event_id: eventId,
          p_event_type: event,
          p_payload_hash: payloadHash,
          p_environment: config.environment,
          p_status: 'failed',
          p_error_details: { code: 'MISSING_ORDER_ID', message: 'Missing Razorpay order_id in webhook payload' },
        });
      } catch (logErr) {
        console.warn('Failed to log failed webhook event to DB:', logErr);
      }

      return NextResponse.json(
        { error: 'Missing Razorpay order_id in webhook payload', code: 'MISSING_ORDER_ID' },
        { status: 400 }
      );
    }

    // 8. Execute atomic reconciliation with event deduplication via server-only admin client
    let result: unknown;
    let rpcError: { code?: string; message: string } | null = null;

    if (milestoneId) {
      const res = await adminSupabase.rpc('reconcile_webhook_payment', {
        p_milestone_id: milestoneId,
        p_razorpay_order_id: orderId.trim(),
        p_razorpay_payment_id: paymentId ? paymentId.trim() : null,
        p_amount_subunits: amountSubunits != null && !isNaN(amountSubunits) ? amountSubunits : null,
        p_currency: currency ? currency.trim() : null,
        p_payment_metadata: {
          provider: 'razorpay',
          source: 'webhook',
          target_type: 'milestone',
          event,
          environment: config.environment,
          razorpay_order_id: orderId.trim(),
          razorpay_payment_id: paymentId ? paymentId.trim() : null,
          processed_at: new Date().toISOString(),
        },
        p_event_id: eventId,
        p_payload_hash: payloadHash,
      });
      result = res.data;
      rpcError = res.error;
    } else if (timesheetId) {
      const res = await adminSupabase.rpc('reconcile_timesheet_webhook_payment', {
        p_timesheet_id: timesheetId,
        p_razorpay_order_id: orderId.trim(),
        p_razorpay_payment_id: paymentId ? paymentId.trim() : null,
        p_amount_subunits: amountSubunits != null && !isNaN(amountSubunits) ? amountSubunits : null,
        p_currency: currency ? currency.trim() : null,
        p_payment_metadata: {
          provider: 'razorpay',
          source: 'webhook',
          target_type: 'timesheet',
          event,
          environment: config.environment,
          razorpay_order_id: orderId.trim(),
          razorpay_payment_id: paymentId ? paymentId.trim() : null,
          processed_at: new Date().toISOString(),
        },
        p_event_id: eventId,
        p_payload_hash: payloadHash,
      });
      result = res.data;
      rpcError = res.error;

      // When timesheet funding succeeds, trigger automatic freelancer payout transfer
      if (!res.error && timesheetId) {
        payoutEngine.initiateTimesheetPayout(timesheetId).catch((payoutErr) => {
          console.error('Background payout transfer initiation failed for timesheet webhook:', payoutErr);
        });
      }
    }

    // 9. Fail-closed error handling: distinguish bad payloads from transient DB failures
    if (rpcError) {
      console.error('Webhook reconciliation error:', rpcError);

      // Record failure details in webhook_events without marking permanently processed
      try {
        await adminSupabase.rpc('record_webhook_event_receipt', {
          p_event_id: eventId,
          p_event_type: event,
          p_payload_hash: payloadHash,
          p_environment: config.environment,
          p_status: 'failed',
          p_error_details: { code: rpcError.code, message: rpcError.message },
        });
      } catch (logErr) {
        console.warn('Failed to update webhook failure status in DB:', logErr);
      }

      // 23503: Attempt not found, target not found (tampering / untracked order) -> 400
      // 22023: Amount mismatch, currency mismatch, or invalid state -> 400
      if (rpcError.code === '23503' || rpcError.code === '22023') {
        return NextResponse.json(
          { error: rpcError.message, code: rpcError.code },
          { status: 400 }
        );
      }

      // Transient errors or configuration issues -> 500 (allows Razorpay to retry)
      return NextResponse.json(
        { error: `Database error during webhook reconciliation: ${rpcError.message}` },
        { status: 500 }
      );
    }

    const res = result as { success?: boolean; idempotent?: boolean; status?: string } | null;

    return NextResponse.json({
      received: true,
      event,
      event_id: eventId,
      idempotent: Boolean(res?.idempotent),
      status: res?.status || (timesheetId ? 'paid' : 'funded'),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook processing error';
    console.error('Error handling Razorpay webhook:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
