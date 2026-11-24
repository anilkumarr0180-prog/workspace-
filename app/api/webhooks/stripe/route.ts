import { NextRequest, NextResponse } from 'next/server';
import { getStripeClient, getStripeWebhookSecret } from '@/lib/stripe';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { payoutEngine } from '@/lib/services/payout-engine';
import type Stripe from 'stripe';

export async function POST(request: NextRequest) {
  const webhookSecret = getStripeWebhookSecret();

  if (!webhookSecret) {
    console.error('[STRIPE WEBHOOK ERROR]: STRIPE_WEBHOOK_SECRET is not configured on the server.');
    return NextResponse.json(
      { error: 'Stripe webhook secret is not configured.' },
      { status: 500 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header.' },
      { status: 400 }
    );
  }

  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    console.error('[STRIPE WEBHOOK SIGNATURE VERIFICATION FAILED]:', message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  const adminSupabase = getAdminSupabaseClient();

  // Log receipt into webhook_events for idempotency and auditability
  try {
    await adminSupabase.from('webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
      provider: 'stripe',
      environment: event.livemode ? 'live' : 'test',
      payload_hash: event.id,
      status: 'received',
      metadata: {
        created: event.created,
        api_version: event.api_version,
      },
    });
  } catch (logErr) {
    // Non-blocking for deduplication
    console.warn('[STRIPE WEBHOOK LOG RECEIPT NOTICE]:', logErr);
  }

  // Handle relevant events
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const milestoneId = paymentIntent.metadata?.milestone_id;
    const timesheetId = paymentIntent.metadata?.timesheet_id;

    if (milestoneId) {
      try {
        const paymentMetadata = {
          provider: 'stripe',
          environment: paymentIntent.livemode ? 'live' : 'test',
          razorpay_order_id: paymentIntent.id,
          razorpay_payment_id: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.id,
          captured_amount: paymentIntent.amount,
          captured_currency: paymentIntent.currency.toUpperCase(),
          verified_at: new Date().toISOString(),
          client_id: paymentIntent.metadata?.client_id,
          funded_by: paymentIntent.metadata?.client_id,
          source: 'stripe_webhook',
        };

        // Try fund_milestone_with_payment RPC
        const { error: rpcErr } = await adminSupabase.rpc('fund_milestone_with_payment', {
          p_milestone_id: milestoneId,
          p_payment_metadata: paymentMetadata,
        });

        if (rpcErr) {
          // Direct update fallback
          await adminSupabase
            .from('contract_milestones')
            .update({
              status: 'funded',
              updated_at: new Date().toISOString(),
            })
            .eq('id', milestoneId)
            .eq('status', 'planned');
        }

        // Mark webhook event as processed
        await adminSupabase
          .from('webhook_events')
          .update({
            status: 'processed',
            metadata: {
              reconciled_at: new Date().toISOString(),
              milestone_id: milestoneId,
              payment_intent_id: paymentIntent.id,
            },
          })
          .eq('event_id', event.id);

        console.log(`[STRIPE WEBHOOK SUCCESS]: Milestone ${milestoneId} funded via payment_intent ${paymentIntent.id}`);
      } catch (procErr) {
        console.error('[STRIPE WEBHOOK RECONCILIATION ERROR]:', procErr);
        return NextResponse.json(
          { error: 'Internal error processing payment reconciliation.' },
          { status: 500 }
        );
      }
    } else if (timesheetId) {
      try {
        await adminSupabase
          .from('timesheets')
          .update({
            status: 'paid',
            updated_at: new Date().toISOString(),
          })
          .eq('id', timesheetId)
          .eq('status', 'approved');

        // Mark webhook event as processed
        await adminSupabase
          .from('webhook_events')
          .update({
            status: 'processed',
            metadata: {
              reconciled_at: new Date().toISOString(),
              timesheet_id: timesheetId,
              payment_intent_id: paymentIntent.id,
            },
          })
          .eq('event_id', event.id);

        payoutEngine.initiateTimesheetPayout(timesheetId).catch((payoutErr) => {
          console.error('[STRIPE WEBHOOK] Background payout initiation notice:', payoutErr);
        });

        console.log(`[STRIPE WEBHOOK SUCCESS]: Timesheet ${timesheetId} paid via payment_intent ${paymentIntent.id}`);
      } catch (procErr) {
        console.error('[STRIPE WEBHOOK TIMESHEET RECONCILIATION ERROR]:', procErr);
        return NextResponse.json(
          { error: 'Internal error processing timesheet payment reconciliation.' },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}

