import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { calculateTimesheetPaidAmount } from '../../lib/payments/timesheet-accounting';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/20261127000004_harden_timesheet_payment_permissions.sql'
);

async function setupDbWithHistoricalDuplicates(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT 'service_role'::text;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;

    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.contracts (id uuid PRIMARY KEY, client_id uuid NOT NULL, freelancer_id uuid NOT NULL);
    CREATE TABLE public.contract_milestones (id uuid PRIMARY KEY);
    CREATE TABLE public.webhook_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id text UNIQUE NOT NULL,
      event_type text NOT NULL,
      provider text NOT NULL,
      environment text NOT NULL,
      payload_hash text NOT NULL,
      status text NOT NULL,
      error_details jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE public.timesheets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES public.contracts(id),
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'under_review', 'approved', 'disputed', 'paid')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.payment_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      milestone_id uuid,
      timesheet_id uuid,
      billing_type text NOT NULL DEFAULT 'milestone',
      client_id uuid NOT NULL,
      provider text NOT NULL DEFAULT 'razorpay',
      environment text NOT NULL DEFAULT 'test',
      razorpay_order_id text UNIQUE NOT NULL,
      razorpay_payment_id text,
      razorpay_signature text,
      amount numeric(12,2) NOT NULL,
      amount_subunits bigint NOT NULL,
      currency text NOT NULL,
      status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded')),
      error_code text,
      error_description text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.payment_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      milestone_id uuid,
      timesheet_id uuid,
      from_user_id uuid,
      to_user_id uuid,
      amount numeric(12,2) NOT NULL,
      currency text NOT NULL DEFAULT 'USD',
      event_type text NOT NULL,
      status text NOT NULL DEFAULT 'succeeded',
      description text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO public.profiles (id) VALUES
      ('11111111-1111-4111-8111-111111111111'),
      ('22222222-2222-4222-8222-222222222222');

    INSERT INTO public.contracts (id, client_id, freelancer_id) VALUES (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    );

    INSERT INTO public.timesheets (id, contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status) VALUES
      ('d1111111-1111-4000-8000-111111111111', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-11-09', 600, 500.00, 'paid'),
      ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-11-23', 120, 500.00, 'approved'),
      ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-11-16', 60, 250.00, 'approved');

    -- Pre-existing historical duplicate rows (must be preserved untouched when migration runs!)
    INSERT INTO public.payment_ledger (contract_id, timesheet_id, amount, currency, event_type, status, description, metadata) VALUES
      ('33333333-3333-4333-8333-333333333333', 'd1111111-1111-4000-8000-111111111111', 500.00, 'INR', 'hourly_funded', 'succeeded', 'hist 1', '{"razorpay_payment_id":"pay_real_service_123"}'::jsonb),
      ('33333333-3333-4333-8333-333333333333', 'd1111111-1111-4000-8000-111111111111', 500.00, 'INR', 'hourly_funded', 'succeeded', 'hist 2', '{"razorpay_payment_id":"pay_real_service_123"}'::jsonb);
  `);

  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await db.exec(migrationSql);
  return db;
}

const CONTRACT_1 = '33333333-3333-4333-8333-333333333333';
const CLIENT_1 = '11111111-1111-4111-8111-111111111111';
const TS_PARTIAL = '44444444-4444-4444-8444-444444444444';
const TS_FULL = '55555555-5555-4555-8555-555555555555';

test('Phase 2C.3.2 (PGlite): migration succeeds with preserved historical duplicates, full payment marks paid, partial payments settle incrementally, and overpayment rejects', async () => {
  const db = await setupDbWithHistoricalDuplicates();

  // Verify both historical duplicate rows remain untouched
  const hist = await db.query(
    `SELECT id FROM public.payment_ledger WHERE metadata->>'razorpay_payment_id' = 'pay_real_service_123'`
  );
  assert.strictEqual(hist.rows.length, 2);

  // 1. Full payment marks timesheet paid
  await db.query(
    `INSERT INTO public.payment_attempts (contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status)
     VALUES ($1, $2, 'timesheet', $3, 'ord_full', 250.00, 25000, 'INR', 'created')`,
    [CONTRACT_1, TS_FULL, CLIENT_1]
  );
  const fullRes = await db.query<{ status: string }>(
    `SELECT status FROM public.fund_timesheet_with_payment($1, 'pay_full_1', 'ord_full', 'sig_1', 25000, 'INR', 'test', '{}'::jsonb)`,
    [TS_FULL]
  );
  assert.strictEqual(fullRes.rows[0].status, 'paid');

  // 2. Partial payment (200 of 500) keeps timesheet 'approved'
  await db.query(
    `INSERT INTO public.payment_attempts (contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status)
     VALUES ($1, $2, 'timesheet', $3, 'ord_p1', 200.00, 20000, 'INR', 'created')`,
    [CONTRACT_1, TS_PARTIAL, CLIENT_1]
  );
  const p1Res = await db.query<{ status: string }>(
    `SELECT status FROM public.fund_timesheet_with_payment($1, 'pay_p1', 'ord_p1', 'sig_p1', 20000, 'INR', 'test', '{}'::jsonb)`,
    [TS_PARTIAL]
  );
  assert.strictEqual(p1Res.rows[0].status, 'approved');

  // 4. Overpayment (350 when only 300 remains) is rejected
  await db.query(
    `INSERT INTO public.payment_attempts (contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status)
     VALUES ($1, $2, 'timesheet', $3, 'ord_over', 350.00, 35000, 'INR', 'created')`,
    [CONTRACT_1, TS_PARTIAL, CLIENT_1]
  );
  await assert.rejects(
    () =>
      db.query(
        `SELECT status FROM public.fund_timesheet_with_payment($1, 'pay_over', 'ord_over', 'sig_over', 35000, 'INR', 'test', '{}'::jsonb)`,
        [TS_PARTIAL]
      ),
    /exceeds remaining timesheet balance/
  );

  // 3. Second partial payment via webhook settles remaining 300.00 -> status becomes 'paid'
  await db.query(
    `INSERT INTO public.payment_attempts (contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status)
     VALUES ($1, $2, 'timesheet', $3, 'ord_p2', 300.00, 30000, 'INR', 'created')`,
    [CONTRACT_1, TS_PARTIAL, CLIENT_1]
  );
  const p2Res = await db.query<{ res: { status: string; paid_amount: number } }>(
    `SELECT public.reconcile_timesheet_webhook_payment($1, 'ord_p2', 'pay_p2', 30000, 'INR', '{}'::jsonb, 'evt_p2', 'hash_p2') AS res`,
    [TS_PARTIAL]
  );
  assert.strictEqual(p2Res.rows[0].res.status, 'paid');
  assert.strictEqual(p2Res.rows[0].res.paid_amount, 500);

  // 5. Repeated payment ID / webhook retry does not create another ledger entry
  const retryRes = await db.query<{ res: { idempotent: boolean; status: string } }>(
    `SELECT public.reconcile_timesheet_webhook_payment($1, 'ord_p2', 'pay_p2', 30000, 'INR', '{}'::jsonb, 'evt_p2_retry', 'hash_p2') AS res`,
    [TS_PARTIAL]
  );
  assert.strictEqual(retryRes.rows[0].res.idempotent, true);
  const ledgerRows = await db.query(`SELECT amount FROM public.payment_ledger WHERE timesheet_id = $1`, [TS_PARTIAL]);
  assert.strictEqual(ledgerRows.rows.length, 2);
});

test('Phase 2C.3.2 (PGlite): webhook reconciliation rejects failed, expired, refunded, and invalid billing_type / milestone_id attempts', async () => {
  const db = await setupDbWithHistoricalDuplicates();

  await db.query(
    `INSERT INTO public.payment_attempts (contract_id, milestone_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status, error_code)
     VALUES
       ($1, NULL, $2, 'timesheet', $3, 'wh_failed', 500.00, 50000, 'INR', 'failed', 'GATEWAY_ERROR'),
       ($1, NULL, $2, 'timesheet', $3, 'wh_expired', 500.00, 50000, 'INR', 'failed', 'EXPIRED'),
       ($1, NULL, $2, 'timesheet', $3, 'wh_refunded', 500.00, 50000, 'INR', 'refunded', NULL),
       ($1, NULL, $2, 'milestone', $3, 'wh_wrong_type', 500.00, 50000, 'INR', 'created', NULL),
       ($1, '99999999-9999-4999-8999-999999999999', $2, 'timesheet', $3, 'wh_has_ms', 500.00, 50000, 'INR', 'created', NULL)`,
    [CONTRACT_1, TS_PARTIAL, CLIENT_1]
  );

  for (const [orderId, pattern] of [
    ['wh_failed', /terminal status "failed"/],
    ['wh_expired', /terminal status "failed"/],
    ['wh_refunded', /terminal status "refunded"/],
    ['wh_wrong_type', /not configured for timesheet billing/],
    ['wh_has_ms', /not configured for timesheet billing/],
  ] as const) {
    await assert.rejects(
      () =>
        db.query(
          `SELECT public.reconcile_timesheet_webhook_payment($1, $2, 'pay_x', 50000, 'INR', '{}'::jsonb, $3, 'hash_x')`,
          [TS_PARTIAL, orderId, `evt_${orderId}`]
        ),
      pattern
    );
  }
});

test('Phase 2C.3.2 (Unit): calculateTimesheetPaidAmount excludes refunds/reversals and avoids double-counting attempts', () => {
  const paid = calculateTimesheetPaidAmount({
    timesheetId: TS_PARTIAL,
    weekStartDate: '2026-11-23',
    ledgerRows: [
      { timesheet_id: TS_PARTIAL, amount: 200, event_type: 'hourly_funded', status: 'succeeded' },
      { timesheet_id: TS_PARTIAL, amount: 200, event_type: 'escrow_refund', status: 'succeeded' },
      { timesheet_id: TS_PARTIAL, amount: 100, event_type: 'hourly_funded', status: 'reversed' },
    ],
    attemptRows: [
      { timesheet_id: TS_PARTIAL, billing_type: 'timesheet', amount: 200, status: 'captured' },
    ],
  });
  assert.strictEqual(paid, 200);
});
