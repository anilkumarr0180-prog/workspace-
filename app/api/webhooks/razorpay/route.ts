import { NextRequest, NextResponse } from 'next/server';
import { verifyRazorpayWebhookSignature, isRazorpayWebhookConfigured } from '@/lib/razorpay';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Hardened Razorpay Webhook Endpoint for asynchronous payment events.
 * 
 * Security & Reliability Guarantees:
 * 1. Cryptographic HMAC SHA-256 signature verification in constant time against raw request body.
 * 2. Dedicated server-only Supabase admin client (SERVICE_ROLE_KEY) - never exposed to clients.
 * 3. Fail-closed validation: Order attempt must exist, amount and currency must match.
 * 4. Atomic database-level idempotency via PostgreSQL procedure reconcile_webhook_payment.
 * 5. Clean separation of 400 (tampering / bad input) vs 500 (transient DB failures for gateway retry).
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

    // 3. Parse JSON payload
    let eventData: {
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

    const event = eventData.event;
    const paymentEntity = eventData.payload?.payment?.entity;
    const orderEntity = eventData.payload?.order?.entity;

    // 4. Milestone association: Required to attribute payment
    const milestoneId =
      paymentEntity?.notes?.milestone_id || orderEntity?.notes?.milestone_id;

    if (!milestoneId || typeof milestoneId !== 'string' || !milestoneId.trim()) {
      return NextResponse.json(
        { error: 'Missing milestone_id in payment notes', code: 'MISSING_MILESTONE_ID' },
        { status: 400 }
      );
    }

    // 5. Deliberate event handling: only payment.captured and order.paid can fund escrow
    if (event !== 'order.paid' && event !== 'payment.captured') {
      return NextResponse.json({
        received: true,
        ignored: true,
        reason: `Unhandled event type: ${event}`,
      });
    }

    // 6. Extract payment attributes and enforce status checks
    let orderId: string | undefined;
    let paymentId: string | null = null;
    let amountSubunits: number | null = null;
    let currency: string | null = null;

    if (event === 'payment.captured') {
      if (paymentEntity?.status && paymentEntity.status !== 'captured') {
        return NextResponse.json({
          received: true,
          ignored: true,
          reason: `Payment status is '${paymentEntity.status}', not 'captured'.`,
        });
      }
      orderId = paymentEntity?.order_id || orderEntity?.id;
      paymentId = paymentEntity?.id || null;
      amountSubunits = paymentEntity?.amount != null ? Number(paymentEntity.amount) : null;
      currency = paymentEntity?.currency || null;
    } else if (event === 'order.paid') {
      if (orderEntity?.status && orderEntity.status !== 'paid') {
        return NextResponse.json({
          received: true,
          ignored: true,
          reason: `Order status is '${orderEntity.status}', not 'paid'.`,
        });
      }
      orderId = orderEntity?.id || paymentEntity?.order_id;
      paymentId = paymentEntity?.id || null;
      amountSubunits = orderEntity?.amount != null ? Number(orderEntity.amount) : null;
      currency = orderEntity?.currency || null;
    }

    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      return NextResponse.json(
        { error: 'Missing Razorpay order_id in webhook payload', code: 'MISSING_ORDER_ID' },
        { status: 400 }
      );
    }

    // 7. Execute atomic reconciliation via server-only admin client
    const adminSupabase = getAdminSupabaseClient();

    const { data: result, error: rpcError } = await adminSupabase.rpc('reconcile_webhook_payment', {
      p_milestone_id: milestoneId.trim(),
      p_razorpay_order_id: orderId.trim(),
      p_razorpay_payment_id: paymentId ? paymentId.trim() : null,
      p_amount_subunits: amountSubunits != null && !isNaN(amountSubunits) ? amountSubunits : null,
      p_currency: currency ? currency.trim() : null,
      p_payment_metadata: {
        provider: 'razorpay',
        source: 'webhook',
        event,
        environment: 'test',
        razorpay_order_id: orderId.trim(),
        razorpay_payment_id: paymentId ? paymentId.trim() : null,
        processed_at: new Date().toISOString(),
      },
    });

    // 8. Fail-closed error handling: distinguish bad payloads from transient DB failures
    if (rpcError) {
      console.error('Webhook reconciliation error:', rpcError);

      // 23503: Attempt not found or milestone not found (tampering / untracked order) -> 400
      // 22023: Amount mismatch, currency mismatch, or invalid status -> 400
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
      idempotent: Boolean(res?.idempotent),
      status: res?.status || 'funded',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook processing error';
    console.error('Error handling Razorpay webhook:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
