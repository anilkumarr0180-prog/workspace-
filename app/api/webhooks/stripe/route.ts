import { NextRequest, NextResponse } from 'next/server';
import { getStripeClient, getStripeWebhookSecret } from '@/lib/stripe';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { payoutEngine } from '@/lib/services/payout-engine';
import {
  calculateTimesheetPaidAmount,
  validateStripeTimesheetCapture,
} from '@/lib/payments/timesheet-accounting';
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

  // Deduplicate webhook events by event_id before processing
  const { data: existingEvent } = await adminSupabase
    .from('webhook_events')
    .select('id, status')
    .eq('event_id', event.id)
    .maybeSingle();

  if (existingEvent?.status === 'processed') {
    return NextResponse.json({ received: true, idempotent: true });
  }

  // Log receipt into webhook_events for idempotency and auditability
  if (!existingEvent) {
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
        // 1. Fetch authoritative timesheet record
        const { data: timesheet, error: tsError } = await adminSupabase
          .from('timesheets')
          .select('id, contract_id, client_id, freelancer_id, total_amount, status, week_start_date')
          .eq('id', timesheetId)
          .maybeSingle();

        if (tsError || !timesheet) {
          return NextResponse.json(
            { error: 'Timesheet not found for webhook reconciliation.' },
            { status: 400 }
          );
        }

        // 2. Fetch prior ledger & attempt rows for THIS specific timesheet
        const [{ data: priorSettled }, { data: priorAttempts }] = await Promise.all([
          adminSupabase
            .from('payment_ledger')
            .select('id, contract_id, amount, currency, event_type, status, description, metadata, created_at')
            .eq('contract_id', timesheet.contract_id)
            .in('status', ['succeeded', 'captured', 'completed']),
          adminSupabase
            .from('payment_attempts')
            .select('id, contract_id, billing_type, amount, currency, status, metadata, created_at')
            .eq('contract_id', timesheet.contract_id)
            .in('status', ['captured', 'succeeded']),
        ]);

        // 3. Idempotency check: if PaymentIntent already recorded in payment_ledger or timesheet already paid
        const alreadyRecordedIntent = (priorSettled || []).some((r) => {
          const meta = (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>;
          return meta.stripe_payment_intent_id === paymentIntent.id;
        });

        if (timesheet.status === 'paid' || alreadyRecordedIntent) {
          await adminSupabase
            .from('webhook_events')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
              metadata: {
                reconciled_at: new Date().toISOString(),
                timesheet_id: timesheetId,
                payment_intent_id: paymentIntent.id,
                idempotent: true,
              },
            })
            .eq('event_id', event.id);

          return NextResponse.json({ received: true, idempotent: true });
        }

        // 4. Verify captured amount and currency against expected balance due
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
          await adminSupabase
            .from('webhook_events')
            .update({
              status: 'failed',
              error_details: { code: captureValidation.code, message: captureValidation.error },
            })
            .eq('event_id', event.id);

          return NextResponse.json(
            { error: captureValidation.error, code: captureValidation.code },
            { status: 400 }
          );
        }

        const capturedDollars = capturedCents / 100;
        const totalPaidAfterThis = Math.round((priorPaidTotal + capturedDollars) * 100) / 100;
        const isFullySettled = totalPaidAfterThis >= (totalTimesheetAmount - 0.01);
        const nextStatus = isFullySettled ? 'paid' : 'approved';

        // 5. Update payment_attempts to captured
        await adminSupabase
          .from('payment_attempts')
          .update({
            status: 'captured',
            provider: 'stripe',
            updated_at: new Date().toISOString(),
          })
          .eq('razorpay_order_id', paymentIntent.id);

        // 6. Update timesheets status only after verified capture
        await adminSupabase
          .from('timesheets')
          .update({
            status: nextStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', timesheetId);

        // 7. Insert payment_ledger record (with fallback if check constraint requires escrow_funded)
        const ledgerPayload = {
          contract_id: timesheet.contract_id,
          from_user_id: timesheet.client_id,
          to_user_id: timesheet.freelancer_id,
          amount: capturedDollars,
          currency: 'USD',
          event_type: 'hourly_funded',
          status: 'succeeded',
          description: `Hourly Invoice Payment for Week of ${timesheet.week_start_date} (Stripe Webhook)`,
          metadata: {
            provider: 'stripe',
            source: 'stripe_webhook',
            environment: paymentIntent.livemode ? 'live' : 'test',
            stripe_payment_intent_id: paymentIntent.id,
            timesheet_id: timesheet.id,
            captured_amount: capturedCents,
            captured_currency: paymentIntent.currency.toUpperCase(),
            payment_verified_at: new Date().toISOString(),
            prior_paid_total: priorPaidTotal,
            new_paid_total: totalPaidAfterThis,
            is_fully_settled: isFullySettled,
          },
        };

        const { error: ledgerErr } = await adminSupabase.from('payment_ledger').insert(ledgerPayload);
        if (ledgerErr) {
          await adminSupabase.from('payment_ledger').insert({
            ...ledgerPayload,
            event_type: 'escrow_funded',
            to_user_id: null,
          });
        }

        // 8. Mark webhook event as processed
        await adminSupabase
          .from('webhook_events')
          .update({
            status: 'processed',
            processed_at: new Date().toISOString(),
            metadata: {
              reconciled_at: new Date().toISOString(),
              timesheet_id: timesheetId,
              payment_intent_id: paymentIntent.id,
              captured_dollars: capturedDollars,
            },
          })
          .eq('event_id', event.id);

        if (isFullySettled) {
          payoutEngine.initiateTimesheetPayout(timesheetId).catch((payoutErr) => {
            console.error('[STRIPE WEBHOOK] Background payout initiation notice:', payoutErr);
          });
        }

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

