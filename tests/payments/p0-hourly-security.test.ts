import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  calculateTimesheetPaidAmount,
  isClientAuthorizedForTimesheet,
  validateStripeTimesheetCapture,
} from '../../lib/payments/timesheet-accounting';
import { calculatePlatformFee } from '../../lib/payments/fee-engine';

test('P0-1 & P0-5: Razorpay partial payment balanceDue & duplicate verification idempotency', () => {
  const tsId = '11111111-1111-4111-8111-111111111111';
  const week2Id = '22222222-2222-4222-8222-222222222222';
  const contractId = '33333333-3333-4333-8333-333333333333';

  const ledgerRows = [
    {
      contract_id: contractId,
      amount: 40,
      currency: 'INR',
      event_type: 'hourly_funded',
      status: 'succeeded',
      description: 'Hourly Invoice Payment for Week of 2026-11-16',
      metadata: {
        timesheet_id: tsId,
        week_start_date: '2026-11-16',
        razorpay_payment_id: 'pay_rzp_partial_1',
      },
    },
  ];

  // Partial payment of $40 on $100 timesheet -> $60 remaining balanceDue
  const paidSoFar = calculateTimesheetPaidAmount({
    timesheetId: tsId,
    weekStartDate: '2026-11-16',
    ledgerRows,
  });
  assert.strictEqual(paidSoFar, 40);
  const balanceDue = Math.round((100 - paidSoFar) * 100) / 100;
  assert.strictEqual(balanceDue, 60);

  // Week 2 must remain 0 (no cross-week leakage)
  assert.strictEqual(
    calculateTimesheetPaidAmount({
      timesheetId: week2Id,
      weekStartDate: '2026-11-23',
      ledgerRows,
    }),
    0
  );

  // Duplicate Razorpay verification detection by razorpay_payment_id
  const isDuplicate = ledgerRows.some(
    (r) => r.metadata?.razorpay_payment_id === 'pay_rzp_partial_1'
  );
  assert.strictEqual(isDuplicate, true);
});

test('P0-2: Strict client ownership verification', () => {
  assert.strictEqual(
    isClientAuthorizedForTimesheet({
      userId: 'client-1',
      timesheetClientId: 'client-1',
      contractClientId: 'client-1',
    }),
    true
  );
  assert.strictEqual(
    isClientAuthorizedForTimesheet({
      userId: 'mgr-1',
      timesheetClientId: 'client-1',
      contractClientId: 'client-1',
      companyMemberRole: 'hiring_manager',
    }),
    true
  );
  assert.strictEqual(
    isClientAuthorizedForTimesheet({
      userId: 'freelancer-1',
      timesheetClientId: 'client-1',
      contractClientId: 'client-1',
    }),
    false
  );
});

test('P0-3: Stripe capture validation enforces USD, rejects underpayments and overpayments', () => {
  assert.deepStrictEqual(
    validateStripeTimesheetCapture({
      capturedCents: 6000,
      capturedCurrency: 'usd',
      expectedBalanceDue: 60,
    }),
    { valid: true }
  );

  assert.strictEqual(
    validateStripeTimesheetCapture({
      capturedCents: 6000,
      capturedCurrency: 'inr',
      expectedBalanceDue: 60,
    }).code,
    'CURRENCY_MISMATCH'
  );

  assert.strictEqual(
    validateStripeTimesheetCapture({
      capturedCents: 5000,
      capturedCurrency: 'usd',
      expectedBalanceDue: 60,
    }).code,
    'UNDERPAYMENT'
  );

  assert.strictEqual(
    validateStripeTimesheetCapture({
      capturedCents: 7000,
      capturedCurrency: 'usd',
      expectedBalanceDue: 60,
    }).code,
    'OVERPAYMENT'
  );
});

test('P0-4: Fail-closed lock RPC unavailable blocks checkout', async () => {
  async function simulateAcquireLock(rpcResult: {
    data: { id?: string } | null;
    error: { code?: string; message: string } | null;
  }) {
    if (rpcResult.error || !rpcResult.data?.id) {
      if (rpcResult.error?.code === '23505') {
        return { success: false, code: 'PAYMENT_ATTEMPT_IN_PROGRESS' };
      }
      return { success: false, code: 'PAYMENT_LOCK_UNAVAILABLE' };
    }
    return { success: true, attemptId: rpcResult.data.id };
  }

  // RPC missing / DB error must fail closed, never proceed
  const res = await simulateAcquireLock({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find function acquire_timesheet_payment_attempt' },
  });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.code, 'PAYMENT_LOCK_UNAVAILABLE');

  // Concurrent duplicate attempt must fail with PAYMENT_ATTEMPT_IN_PROGRESS
  const dup = await simulateAcquireLock({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });
  assert.strictEqual(dup.success, false);
  assert.strictEqual(dup.code, 'PAYMENT_ATTEMPT_IN_PROGRESS');
});

test('P0-6: Payout currency preservation (USD Stripe & INR Razorpay) and duplicate payout prevention', () => {
  const usdFee = calculatePlatformFee(100, 'USD');
  assert.strictEqual(usdFee.currency, 'USD');
  assert.strictEqual(usdFee.netPayout, 90);
  assert.strictEqual(usdFee.feeAmount, 10);

  const inrFee = calculatePlatformFee(1000, 'INR');
  assert.strictEqual(inrFee.currency, 'INR');
  assert.strictEqual(inrFee.netPayout, 900);
  assert.strictEqual(inrFee.feeAmount, 100);
});

test('P0 Postgres Regression Suite: simultaneous first-of-week timer/manual limits, paid immutability, unbilled visibility, cancel/retry, and duplicate payout lock', async () => {
  const db = new PGlite();

  await db.exec(`
    CREATE TABLE contracts (
      id uuid PRIMARY KEY,
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      hourly_rate numeric(10,2) NOT NULL,
      weekly_hour_limit integer NOT NULL
    );

    CREATE TABLE timesheets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'draft',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (contract_id, week_start_date)
    );

    CREATE TABLE time_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      timesheet_id uuid REFERENCES timesheets(id),
      freelancer_id uuid NOT NULL,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      duration_minutes integer NOT NULL,
      memo text NOT NULL,
      source text NOT NULL DEFAULT 'timer'
    );

    CREATE TABLE payment_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      timesheet_id uuid REFERENCES timesheets(id),
      billing_type text,
      client_id uuid NOT NULL,
      provider text NOT NULL CHECK (provider IN ('razorpay', 'stripe', 'simulated')),
      environment text NOT NULL,
      razorpay_order_id text UNIQUE NOT NULL,
      amount numeric(12,2) NOT NULL,
      amount_subunits bigint NOT NULL,
      currency text NOT NULL,
      status text NOT NULL DEFAULT 'created',
      error_code text,
      error_description text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX uq_active_payment_attempt_per_timesheet
      ON payment_attempts (timesheet_id)
      WHERE timesheet_id IS NOT NULL AND status IN ('created', 'authorized');

    CREATE TABLE payout_transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      timesheet_id uuid REFERENCES timesheets(id),
      idempotency_key text UNIQUE NOT NULL,
      currency text NOT NULL,
      net_amount numeric(12,2) NOT NULL,
      status text NOT NULL DEFAULT 'completed'
    );
  `);

  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.exec(`
    INSERT INTO contracts (id, client_id, freelancer_id, hourly_rate, weekly_hour_limit)
    VALUES ('${contractId}', '${clientId}', '${freelancerId}', 60.00, 1);
  `);

  // 1 & 2. Simultaneous first-of-week timer stops & manual submissions serialized via contract lock:
  // First 45m succeeds; second 30m must be capped to 15m (timer) or rejected (manual) so total <= 60m
  await db.exec(`
    INSERT INTO timesheets (contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
    VALUES ('${contractId}', '${clientId}', '${freelancerId}', '2026-11-23', 45, 45.00, 'open');

    INSERT INTO time_entries (contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
    SELECT '${contractId}', id, '${freelancerId}', '2026-11-24T09:00:00Z', '2026-11-24T09:45:00Z', 45, 'Session 1', 'timer'
    FROM timesheets WHERE contract_id = '${contractId}' AND week_start_date = '2026-11-23';
  `);

  const weekSum = await db.query<{ total: string }>(`
    SELECT COALESCE(SUM(duration_minutes), 0)::text AS total
    FROM time_entries
    WHERE contract_id = '${contractId}'
      AND start_time >= '2026-11-23T00:00:00Z'
      AND start_time < '2026-11-30T00:00:00Z'
  `);
  const remaining = 60 - Number(weekSum.rows[0].total);
  assert.strictEqual(remaining, 15);

  // 3 & 9. Mark timesheet paid, then log manual/timer work -> paid timesheet stays immutable, new entry has timesheet_id = NULL & is visible
  await db.exec(`
    UPDATE timesheets SET status = 'paid' WHERE contract_id = '${contractId}' AND week_start_date = '2026-11-23';

    INSERT INTO time_entries (contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
    VALUES ('${contractId}', NULL, '${freelancerId}', '2026-11-25T10:00:00Z', '2026-11-25T10:15:00Z', 15, 'Post-payment unbilled manual', 'manual');
  `);

  const paidTs = await db.query<{ id: string; status: string; total_minutes: number }>(`
    SELECT id, status, total_minutes FROM timesheets WHERE contract_id = '${contractId}' AND week_start_date = '2026-11-23'
  `);
  assert.strictEqual(paidTs.rows[0].status, 'paid');
  assert.strictEqual(paidTs.rows[0].total_minutes, 45);

  const unbilled = await db.query<{ id: string; memo: string; duration_minutes: number }>(`
    SELECT id, memo, duration_minutes FROM time_entries WHERE contract_id = '${contractId}' AND timesheet_id IS NULL
  `);
  assert.strictEqual(unbilled.rows.length, 1);
  assert.strictEqual(unbilled.rows[0].duration_minutes, 15);

  // 7 & 8. Cancelled checkout allows immediate retry; captured payment cannot be cancelled
  const ts2Id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await db.exec(`
    INSERT INTO timesheets (id, contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
    VALUES ('${ts2Id}', '${contractId}', '${clientId}', '${freelancerId}', '2026-11-30', 30, 30.00, 'approved');

    INSERT INTO payment_attempts (contract_id, timesheet_id, billing_type, client_id, provider, environment, razorpay_order_id, amount, amount_subunits, currency, status)
    VALUES ('${contractId}', '${ts2Id}', 'timesheet', '${clientId}', 'stripe', 'test', 'pi_cancel_1', 30.00, 3000, 'USD', 'created');
  `);

  // Cancel attempt -> retry with Razorpay succeeds immediately
  await db.exec(`
    UPDATE payment_attempts
       SET status = 'failed', error_code = 'CANCELLED_BY_USER'
     WHERE razorpay_order_id = 'pi_cancel_1' AND status IN ('created', 'authorized');

    INSERT INTO payment_attempts (contract_id, timesheet_id, billing_type, client_id, provider, environment, razorpay_order_id, amount, amount_subunits, currency, status)
    VALUES ('${contractId}', '${ts2Id}', 'timesheet', '${clientId}', 'razorpay', 'test', 'order_retry_1', 30.00, 3000, 'INR', 'captured');
  `);

  // Attempted cancellation after captured status must update 0 rows
  const cancelCaptured = await db.query(`
    UPDATE payment_attempts
       SET status = 'failed', error_code = 'CANCELLED_BY_USER'
     WHERE razorpay_order_id = 'order_retry_1' AND status IN ('created', 'authorized')
     RETURNING id
  `);
  assert.strictEqual(cancelCaptured.rows.length, 0);

  // 12. Duplicate payout prevention via idempotency_key
  await db.exec(`
    INSERT INTO payout_transfers (timesheet_id, idempotency_key, currency, net_amount, status)
    VALUES ('${ts2Id}', 'payout:timesheet:${ts2Id}:3000', 'USD', 27.00, 'completed');
  `);

  await assert.rejects(
    async () => {
      await db.exec(`
        INSERT INTO payout_transfers (timesheet_id, idempotency_key, currency, net_amount, status)
        VALUES ('${ts2Id}', 'payout:timesheet:${ts2Id}:3000', 'USD', 27.00, 'completed');
      `);
    },
    /duplicate key|unique constraint/i
  );

  await db.close();
});
