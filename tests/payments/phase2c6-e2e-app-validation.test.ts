import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { calculateTimesheetPaidAmount } from '../../lib/payments/timesheet-accounting';
import { verifyRazorpayPaymentSignature } from '../../lib/razorpay';
import { RazorpayPaymentProvider } from '../../lib/payments/providers/razorpay-provider';
import { POST as razorpayWebhookPOST } from '../../app/api/webhooks/razorpay/route';
import { payoutEngine } from '../../lib/services/payout-engine';

// Load .env.local if present and assert local Supabase target ONLY
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

assert.ok(
  SUPABASE_URL.startsWith('http://127.0.0.1:') || SUPABASE_URL.startsWith('http://localhost:'),
  `Safety abort: NEXT_PUBLIC_SUPABASE_URL must be local, got ${SUPABASE_URL}`
);
assert.ok(SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required in .env.local');
assert.ok(RZP_SECRET, 'RAZORPAY_KEY_SECRET is required in .env.local');
assert.ok(RZP_WEBHOOK_SECRET, 'RAZORPAY_WEBHOOK_SECRET is required in .env.local');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CONTRACT_ID = '87b0d9c7-5b6e-410d-bb41-32bc799de80b';
const CLIENT_ID = 'bbdacc86-05e8-4de6-ac5f-37afb730b010';
const FREELANCER_ID = '1121cd79-c1c2-4deb-b49a-97bdce21103c';
const RUN = Date.now();

function signPayment(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', RZP_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

function signWebhook(rawBody: string): string {
  return crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

test('Phase 2C.6 (Local Supabase + Mocked Razorpay): Checkout & Webhook E2E flows, Payout safety, and UI accounting consistency', async () => {
  const tsFullId = crypto.randomUUID();
  const tsPartialId = crypto.randomUUID();
  const tsWebhookId = crypto.randomUUID();
  const tsWebhookPartialId = crypto.randomUUID();
  const allTsIds = [tsFullId, tsPartialId, tsWebhookId, tsWebhookPartialId];
  const createdEventIds: string[] = [];

  try {
    // Pick 4 unused Monday dates for this contract so repeated test runs never collide
    const { data: existingWeeks } = await admin
      .from('timesheets')
      .select('week_start_date')
      .eq('contract_id', CONTRACT_ID);
    const usedWeeks = new Set((existingWeeks || []).map((r) => r.week_start_date));
    const freeMondays: string[] = [];
    const cursor = new Date('2018-01-01T00:00:00Z'); // Monday
    while (freeMondays.length < 4) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!usedWeeks.has(iso)) freeMondays.push(iso);
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }

    // Seed isolated approved timesheets on local Supabase
    const { error: seedErr } = await admin.from('timesheets').insert([
      {
        id: tsFullId,
        contract_id: CONTRACT_ID,
        client_id: CLIENT_ID,
        freelancer_id: FREELANCER_ID,
        week_start_date: freeMondays[0],
        total_minutes: 60,
        total_amount: 250.0,
        status: 'approved',
      },
      {
        id: tsPartialId,
        contract_id: CONTRACT_ID,
        client_id: CLIENT_ID,
        freelancer_id: FREELANCER_ID,
        week_start_date: freeMondays[1],
        total_minutes: 120,
        total_amount: 500.0,
        status: 'approved',
      },
      {
        id: tsWebhookId,
        contract_id: CONTRACT_ID,
        client_id: CLIENT_ID,
        freelancer_id: FREELANCER_ID,
        week_start_date: freeMondays[2],
        total_minutes: 60,
        total_amount: 250.0,
        status: 'approved',
      },
      {
        id: tsWebhookPartialId,
        contract_id: CONTRACT_ID,
        client_id: CLIENT_ID,
        freelancer_id: FREELANCER_ID,
        week_start_date: freeMondays[3],
        total_minutes: 120,
        total_amount: 500.0,
        status: 'approved',
      },
    ]);
    assert.strictEqual(seedErr, null, `Seed error: ${seedErr?.message}`);

    // --- PHASE 2: Checkout Flow (Provider verification + Local Supabase RPCs) ---
    // 2.6 - 2.9: RazorpayProvider.verifyPayment() validation with mocked Razorpay fetch
    const provider = new RazorpayPaymentProvider();
    assert.strictEqual(verifyRazorpayPaymentSignature('ord_sig', 'pay_sig', 'bad_sig'), false);

    // Invalid signature rejected before API/RPC
    const badSigRes = await provider.verifyPayment({
      orderId: 'ord_sig',
      paymentId: 'pay_sig',
      signature: 'bad_sig',
      expectedAmountSubunits: 25000,
      expectedCurrency: 'INR',
    });
    assert.strictEqual(badSigRes.success, false);
    assert.match(badSigRes.error || '', /signature verification failed/i);

    // 2.1 & 2.3: Full payment via acquire_timesheet_payment_attempt + fund_timesheet_with_payment
    const fullOrderId = `ord_e2e_full_${RUN}`;
    const fullPayId = `pay_e2e_full_${RUN}`;
    const { data: fullLock, error: fullLockErr } = await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsFullId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 250.0,
      p_amount_subunits: 25000,
      p_currency: 'INR',
      p_temp_order_id: fullOrderId,
      p_metadata: { timesheet_id: tsFullId },
    });
    assert.strictEqual(fullLockErr, null, fullLockErr?.message);
    assert.ok(fullLock?.id);

    const fullSig = signPayment(fullOrderId, fullPayId);
    assert.strictEqual(verifyRazorpayPaymentSignature(fullOrderId, fullPayId, fullSig), true);

    const { data: fullPaidTs, error: fullFundErr } = await admin.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: tsFullId,
      p_razorpay_payment_id: fullPayId,
      p_razorpay_order_id: fullOrderId,
      p_razorpay_signature: fullSig,
      p_amount_subunits: 25000,
      p_currency: 'INR',
      p_environment: 'test',
      p_metadata: { timesheet_id: tsFullId },
    });
    assert.strictEqual(fullFundErr, null, fullFundErr?.message);
    assert.strictEqual(fullPaidTs.status, 'paid');

    // 2.2, 2.4, 2.5: Partial payment (200 of 500) -> approved, then second partial (300) -> paid
    const p1OrderId = `ord_e2e_p1_${RUN}`;
    const p1PayId = `pay_e2e_p1_${RUN}`;
    await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsPartialId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 200.0,
      p_amount_subunits: 20000,
      p_currency: 'INR',
      p_temp_order_id: p1OrderId,
      p_metadata: { timesheet_id: tsPartialId },
    });
    const { data: p1Ts, error: p1Err } = await admin.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: tsPartialId,
      p_razorpay_payment_id: p1PayId,
      p_razorpay_order_id: p1OrderId,
      p_razorpay_signature: signPayment(p1OrderId, p1PayId),
      p_amount_subunits: 20000,
      p_currency: 'INR',
      p_environment: 'test',
      p_metadata: { timesheet_id: tsPartialId },
    });
    assert.strictEqual(p1Err, null, p1Err?.message);
    assert.strictEqual(p1Ts.status, 'approved');

    // Phase 4: Payout must NOT run on partial payment
    const partialPayoutRes = await payoutEngine.initiateTimesheetPayout(tsPartialId);
    assert.strictEqual(partialPayoutRes.success, false);
    assert.strictEqual(partialPayoutRes.code, 'TIMESHEET_UNPAID');

    // Phase 5: UI accounting consistency on partial payment
    const { data: p1Ledger } = await admin
      .from('payment_ledger')
      .select('id, contract_id, timesheet_id, amount, currency, event_type, status, description, metadata')
      .eq('timesheet_id', tsPartialId);
    const p1PaidAmount = calculateTimesheetPaidAmount({
      timesheetId: tsPartialId,
      weekStartDate: freeMondays[1],
      ledgerRows: p1Ledger || [],
    });
    assert.strictEqual(p1PaidAmount, 200);
    assert.strictEqual(Math.round((500 - p1PaidAmount) * 100) / 100, 300);

    // Second partial payment settling remaining 300
    const p2OrderId = `ord_e2e_p2_${RUN}`;
    const p2PayId = `pay_e2e_p2_${RUN}`;
    await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsPartialId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 300.0,
      p_amount_subunits: 30000,
      p_currency: 'INR',
      p_temp_order_id: p2OrderId,
      p_metadata: { timesheet_id: tsPartialId },
    });
    const { data: p2Ts, error: p2Err } = await admin.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: tsPartialId,
      p_razorpay_payment_id: p2PayId,
      p_razorpay_order_id: p2OrderId,
      p_razorpay_signature: signPayment(p2OrderId, p2PayId),
      p_amount_subunits: 30000,
      p_currency: 'INR',
      p_environment: 'test',
      p_metadata: { timesheet_id: tsPartialId },
    });
    assert.strictEqual(p2Err, null, p2Err?.message);
    assert.strictEqual(p2Ts.status, 'paid');

    // 2.10: Missing payment attempt rejected
    const { error: missingErr } = await admin.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: tsPartialId,
      p_razorpay_payment_id: 'pay_missing',
      p_razorpay_order_id: 'ord_missing',
      p_razorpay_signature: 'sig_missing',
      p_amount_subunits: 30000,
      p_currency: 'INR',
      p_environment: 'test',
      p_metadata: {},
    });
    assert.strictEqual(missingErr?.code, '23503');

    // --- PHASE 3: Webhook Flow (POST /api/webhooks/razorpay -> Local Supabase) ---
    const whOrderId = `ord_wh_${RUN}`;
    const whPayId = `pay_wh_${RUN}`;
    await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsWebhookId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 250.0,
      p_amount_subunits: 25000,
      p_currency: 'INR',
      p_temp_order_id: whOrderId,
      p_metadata: { timesheet_id: tsWebhookId },
    });

    // 3.2: Invalid signature -> 400
    const whEvt1 = `evt_wh_1_${RUN}`;
    const whBody1 = JSON.stringify({
      id: whEvt1,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: whPayId,
            order_id: whOrderId,
            amount: 25000,
            currency: 'INR',
            status: 'captured',
            notes: { timesheet_id: tsWebhookId },
          },
        },
      },
    });
    const badWhRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': 'invalid_sig', 'content-type': 'application/json' },
        body: whBody1,
      })
    );
    assert.strictEqual(badWhRes.status, 400);

    // 3.1: Valid signed captured-payment webhook -> 200, paid
    createdEventIds.push(whEvt1);
    const okWhRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(whBody1), 'content-type': 'application/json' },
        body: whBody1,
      })
    );
    assert.strictEqual(okWhRes.status, 200);
    const okWhJson = await okWhRes.json();
    assert.strictEqual(okWhJson.status, 'paid');
    assert.strictEqual(okWhJson.idempotent, false);

    // 3.3: Duplicate event ID -> 200, idempotent
    const dupEvtRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(whBody1), 'content-type': 'application/json' },
        body: whBody1,
      })
    );
    assert.strictEqual(dupEvtRes.status, 200);
    const dupEvtJson = await dupEvtRes.json();
    assert.strictEqual(dupEvtJson.idempotent, true);

    // 3.4: Duplicate payment ID with new event_id -> 200, idempotent, still 1 ledger row
    const whEvt2 = `evt_wh_2_${RUN}`;
    createdEventIds.push(whEvt2);
    const whBody2 = JSON.stringify({
      id: whEvt2,
      event: 'order.paid',
      payload: {
        order: {
          entity: {
            id: whOrderId,
            amount: 25000,
            currency: 'INR',
            status: 'paid',
            notes: { timesheet_id: tsWebhookId },
          },
        },
        payment: {
          entity: { id: whPayId, order_id: whOrderId, amount: 25000, currency: 'INR', status: 'captured' },
        },
      },
    });
    const dupPayRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(whBody2), 'content-type': 'application/json' },
        body: whBody2,
      })
    );
    assert.strictEqual(dupPayRes.status, 200);
    const dupPayJson = await dupPayRes.json();
    assert.strictEqual(dupPayJson.idempotent, true);

    const { data: whLedger } = await admin
      .from('payment_ledger')
      .select('id')
      .eq('timesheet_id', tsWebhookId);
    assert.strictEqual(whLedger?.length, 1);

    // 3.5: Failed payment event -> ignored
    const whEvtFail = `evt_wh_fail_${RUN}`;
    createdEventIds.push(whEvtFail);
    const whBodyFail = JSON.stringify({ id: whEvtFail, event: 'payment.failed', payload: {} });
    const failEvtRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(whBodyFail), 'content-type': 'application/json' },
        body: whBodyFail,
      })
    );
    assert.strictEqual(failEvtRes.status, 200);
    assert.strictEqual((await failEvtRes.json()).ignored, true);

    // 3.6: Late webhook for expired attempt -> 400 (22023)
    const expOrderId = `ord_wh_exp_${RUN}`;
    await admin.from('payment_attempts').insert({
      contract_id: CONTRACT_ID,
      timesheet_id: tsWebhookPartialId,
      billing_type: 'timesheet',
      client_id: CLIENT_ID,
      provider: 'razorpay',
      environment: 'test',
      razorpay_order_id: expOrderId,
      amount: 200.0,
      amount_subunits: 20000,
      currency: 'INR',
      status: 'failed',
      error_code: 'EXPIRED',
    });
    const whEvtExp = `evt_wh_exp_${RUN}`;
    createdEventIds.push(whEvtExp);
    const whBodyExp = JSON.stringify({
      id: whEvtExp,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_exp_${RUN}`,
            order_id: expOrderId,
            amount: 20000,
            currency: 'INR',
            status: 'captured',
            notes: { timesheet_id: tsWebhookPartialId },
          },
        },
      },
    });
    const expRes = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(whBodyExp), 'content-type': 'application/json' },
        body: whBodyExp,
      })
    );
    assert.strictEqual(expRes.status, 400);

    // 3.7 & 3.8: Partial payment webhook (200 -> approved), then final payment webhook (300 -> paid)
    const wp1Order = `ord_wh_p1_${RUN}`;
    const wp1Pay = `pay_wh_p1_${RUN}`;
    await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsWebhookPartialId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 200.0,
      p_amount_subunits: 20000,
      p_currency: 'INR',
      p_temp_order_id: wp1Order,
      p_metadata: { timesheet_id: tsWebhookPartialId },
    });
    const wp1Evt = `evt_wh_p1_${RUN}`;
    createdEventIds.push(wp1Evt);
    const wp1Body = JSON.stringify({
      id: wp1Evt,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: wp1Pay,
            order_id: wp1Order,
            amount: 20000,
            currency: 'INR',
            status: 'captured',
            notes: { timesheet_id: tsWebhookPartialId },
          },
        },
      },
    });
    const wp1Res = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(wp1Body), 'content-type': 'application/json' },
        body: wp1Body,
      })
    );
    assert.strictEqual(wp1Res.status, 200);
    assert.strictEqual((await wp1Res.json()).status, 'approved');

    const wp2Order = `ord_wh_p2_${RUN}`;
    const wp2Pay = `pay_wh_p2_${RUN}`;
    await admin.rpc('acquire_timesheet_payment_attempt', {
      p_timesheet_id: tsWebhookPartialId,
      p_client_id: CLIENT_ID,
      p_provider: 'razorpay',
      p_environment: 'test',
      p_amount: 300.0,
      p_amount_subunits: 30000,
      p_currency: 'INR',
      p_temp_order_id: wp2Order,
      p_metadata: { timesheet_id: tsWebhookPartialId },
    });
    const wp2Evt = `evt_wh_p2_${RUN}`;
    createdEventIds.push(wp2Evt);
    const wp2Body = JSON.stringify({
      id: wp2Evt,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: wp2Pay,
            order_id: wp2Order,
            amount: 30000,
            currency: 'INR',
            status: 'captured',
            notes: { timesheet_id: tsWebhookPartialId },
          },
        },
      },
    });
    const wp2Res = await razorpayWebhookPOST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signWebhook(wp2Body), 'content-type': 'application/json' },
        body: wp2Body,
      })
    );
    assert.strictEqual(wp2Res.status, 200);
    assert.strictEqual((await wp2Res.json()).status, 'paid');
  } finally {
    // Clean up only the disposable test fixtures we created
    await admin.from('payout_transfers').delete().in('timesheet_id', allTsIds);
    await admin.from('payment_attempts').delete().in('timesheet_id', allTsIds);
    if (createdEventIds.length > 0) {
      await admin.from('webhook_events').delete().in('event_id', createdEventIds);
    }
    await admin.from('timesheets').delete().in('id', allTsIds);
  }
});
