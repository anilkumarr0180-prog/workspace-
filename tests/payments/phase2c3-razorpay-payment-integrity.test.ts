import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/20261127000004_harden_timesheet_payment_permissions.sql'
);
const TIMESHEET_BILLING_PATH = path.resolve(process.cwd(), 'lib/actions/timesheet-billing.ts');
const RAZORPAY_PROVIDER_PATH = path.resolve(
  process.cwd(),
  'lib/payments/providers/razorpay-provider.ts'
);

async function setupPaymentDb(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT 'service_role'::text;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY
    );

    CREATE TABLE public.contracts (
      id uuid PRIMARY KEY,
      client_id uuid NOT NULL REFERENCES public.profiles(id),
      freelancer_id uuid NOT NULL REFERENCES public.profiles(id)
    );

    CREATE TABLE public.contract_milestones (
      id uuid PRIMARY KEY
    );

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
      contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
      client_id uuid NOT NULL REFERENCES public.profiles(id),
      freelancer_id uuid NOT NULL REFERENCES public.profiles(id),
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'submitted', 'under_review', 'approved', 'disputed', 'paid')
      ),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.payment_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
      milestone_id uuid REFERENCES public.contract_milestones(id) ON DELETE CASCADE,
      timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE CASCADE,
      billing_type text NOT NULL DEFAULT 'milestone',
      client_id uuid NOT NULL REFERENCES public.profiles(id),
      provider text NOT NULL DEFAULT 'razorpay',
      environment text NOT NULL DEFAULT 'test',
      razorpay_order_id text UNIQUE NOT NULL,
      razorpay_payment_id text,
      razorpay_signature text,
      amount numeric(12,2) NOT NULL CHECK (amount > 0),
      amount_subunits bigint NOT NULL CHECK (amount_subunits > 0),
      currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      status text NOT NULL DEFAULT 'created' CHECK (
        status IN ('created', 'authorized', 'captured', 'failed', 'refunded')
      ),
      error_code text,
      error_description text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.payment_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
      milestone_id uuid REFERENCES public.contract_milestones(id) ON DELETE SET NULL,
      timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE SET NULL,
      from_user_id uuid REFERENCES public.profiles(id),
      to_user_id uuid REFERENCES public.profiles(id),
      amount numeric(12,2) NOT NULL CHECK (amount > 0),
      currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
      event_type text NOT NULL,
      status text NOT NULL DEFAULT 'succeeded' CHECK (
        status IN ('succeeded', 'pending', 'reversed', 'failed')
      ),
      description text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await db.exec(migrationSql);

  await db.exec(`
    INSERT INTO public.profiles (id) VALUES
      ('11111111-1111-4111-8111-111111111111'),
      ('22222222-2222-4222-8222-222222222222');

    INSERT INTO public.contracts (id, client_id, freelancer_id) VALUES (
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    );

    INSERT INTO public.contract_milestones (id) VALUES (
      '99999999-9999-4999-8999-999999999999'
    );

    INSERT INTO public.timesheets (
      id, contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status
    ) VALUES
      (
        '44444444-4444-4444-8444-444444444444',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '2026-11-23',
        120,
        500.00,
        'approved'
      ),
      (
        '55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '2026-11-16',
        60,
        250.00,
        'approved'
      );
  `);

  return db;
}

const TS_1 = '44444444-4444-4444-8444-444444444444';
const TS_2 = '55555555-5555-4555-8555-555555555555';
const CONTRACT_1 = '33333333-3333-4333-8333-333333333333';
const CLIENT_1 = '11111111-1111-4111-8111-111111111111';
const MILESTONE_1 = '99999999-9999-4999-8999-999999999999';

async function callFundRpc(
  db: PGlite,
  params: {
    timesheetId: string | null;
    paymentId: string | null;
    orderId: string | null;
    signature: string | null;
    amountSubunits: number | null;
    currency: string | null;
    environment?: string;
  }
) {
  return db.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.fund_timesheet_with_payment($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.timesheetId,
      params.paymentId,
      params.orderId,
      params.signature,
      params.amountSubunits,
      params.currency,
      params.environment ?? 'test',
      JSON.stringify({ source: 'test' }),
    ]
  );
}

test('Phase 2C.3 (PGlite): rejects missing attempt, wrong order ID, and attempt belonging to another timesheet', async () => {
  const db = await setupPaymentDb();

  await db.query(
    `INSERT INTO public.payment_attempts (
      contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status
    ) VALUES ($1, $2, 'timesheet', $3, 'order_ts2', 250.00, 25000, 'INR', 'created')`,
    [CONTRACT_1, TS_2, CLIENT_1]
  );

  // 1. Missing attempt
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_nonexistent',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /Payment attempt not found/
  );

  // 2 & 3. Order belonging to TS_2 used against TS_1
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_ts2',
        signature: 'sig_1',
        amountSubunits: 25000,
        currency: 'INR',
      }),
    /Payment attempt not found/
  );

  const ts1 = await db.query<{ status: string }>(`SELECT status FROM public.timesheets WHERE id = $1`, [TS_1]);
  assert.strictEqual(ts1.rows[0].status, 'approved');
  const ledger = await db.query(`SELECT * FROM public.payment_ledger`);
  assert.strictEqual(ledger.rows.length, 0);
});

test('Phase 2C.3 (PGlite): rejects wrong billing_type, non-null milestone_id, amount mismatch, currency mismatch, and empty IDs', async () => {
  const db = await setupPaymentDb();

  // 4 & 5. Wrong billing_type and non-null milestone_id
  await db.query(
    `INSERT INTO public.payment_attempts (
      contract_id, milestone_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status
    ) VALUES
      ($1, NULL, $2, 'milestone', $3, 'order_wrong_type', 500.00, 50000, 'INR', 'created'),
      ($1, $4, $2, 'timesheet', $3, 'order_with_milestone', 500.00, 50000, 'INR', 'created'),
      ($1, NULL, $2, 'timesheet', $3, 'order_valid', 500.00, 50000, 'INR', 'created')`,
    [CONTRACT_1, TS_1, CLIENT_1, MILESTONE_1]
  );

  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_wrong_type',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /not configured for timesheet billing/
  );

  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_with_milestone',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /not configured for timesheet billing/
  );

  // 6. Amount mismatch
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_valid',
        signature: 'sig_1',
        amountSubunits: 49900,
        currency: 'INR',
      }),
    /does not match persisted attempt/
  );

  // 7. Currency mismatch
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_valid',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'USD',
      }),
    /currency/i
  );

  // 8. Empty identifiers
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: '   ',
        orderId: 'order_valid',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /payment ID is required/
  );

  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: '',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /order ID is required/
  );

  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_1',
        orderId: 'order_valid',
        signature: '  ',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /signature is required/
  );
});

test('Phase 2C.3 (PGlite): never resurrects failed, expired, or refunded attempts and rejects unrelated attempts on paid timesheets', async () => {
  const db = await setupPaymentDb();

  await db.query(
    `INSERT INTO public.payment_attempts (
      contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status, error_code
    ) VALUES
      ($1, $2, 'timesheet', $3, 'order_failed', 500.00, 50000, 'INR', 'failed', 'GATEWAY_ERROR'),
      ($1, $2, 'timesheet', $3, 'order_expired', 500.00, 50000, 'INR', 'failed', 'EXPIRED'),
      ($1, $2, 'timesheet', $3, 'order_refunded', 500.00, 50000, 'INR', 'refunded', NULL),
      ($1, $2, 'timesheet', $3, 'order_good', 500.00, 50000, 'INR', 'authorized', NULL)`,
    [CONTRACT_1, TS_1, CLIENT_1]
  );

  // 9. Failed
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_fail',
        orderId: 'order_failed',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /terminal status "failed"/
  );

  // 10. Expired
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_exp',
        orderId: 'order_expired',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /terminal status "failed"/
  );

  // 11. Refunded
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_ref',
        orderId: 'order_refunded',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /terminal status "refunded"/
  );

  // 18. Valid authorized payment succeeds (normalizes lowercase 'inr')
  const res = await callFundRpc(db, {
    timesheetId: TS_1,
    paymentId: 'pay_good_1',
    orderId: 'order_good',
    signature: 'sig_good',
    amountSubunits: 50000,
    currency: 'inr',
  });
  assert.strictEqual(res.rows[0].status, 'paid');

  // 13. Even after TS_1 is paid, failed/expired attempt still rejects (never returns idempotent success)
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_exp',
        orderId: 'order_expired',
        signature: 'sig_1',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /terminal status "failed"/
  );

  // 12. Already captured attempt with DIFFERENT payment ID rejects
  await assert.rejects(
    () =>
      callFundRpc(db, {
        timesheetId: TS_1,
        paymentId: 'pay_different',
        orderId: 'order_good',
        signature: 'sig_good',
        amountSubunits: 50000,
        currency: 'INR',
      }),
    /already captured with a different payment ID/
  );
});

test('Phase 2C.3 (PGlite): idempotency, partial balance amount in ledger, and partial unique index allow distinct payments but block duplicates', async () => {
  const db = await setupPaymentDb();

  // Partial payment attempt: 300.00 INR on a 500.00 INR timesheet
  await db.query(
    `INSERT INTO public.payment_attempts (
      contract_id, timesheet_id, billing_type, client_id, razorpay_order_id, amount, amount_subunits, currency, status
    ) VALUES ($1, $2, 'timesheet', $3, 'order_partial_2', 300.00, 30000, 'INR', 'created')`,
    [CONTRACT_1, TS_1, CLIENT_1]
  );

  // 18. First valid partial call succeeds, keeps status 'approved', and writes attempt.amount (300.00, not 500.00)
  const first = await callFundRpc(db, {
    timesheetId: TS_1,
    paymentId: 'pay_partial_2',
    orderId: 'order_partial_2',
    signature: 'sig_p2',
    amountSubunits: 30000,
    currency: 'INR',
  });
  assert.strictEqual(first.rows[0].status, 'approved');

  // 14. Duplicate checkout verification returns idempotently with 1 ledger row
  const second = await callFundRpc(db, {
    timesheetId: TS_1,
    paymentId: 'pay_partial_2',
    orderId: 'order_partial_2',
    signature: 'sig_p2',
    amountSubunits: 30000,
    currency: 'INR',
  });
  assert.strictEqual(second.rows[0].status, 'approved');

  const ledgerRows = await db.query<{ amount: string; currency: string }>(
    `SELECT amount::text, currency FROM public.payment_ledger WHERE timesheet_id = $1`,
    [TS_1]
  );
  assert.strictEqual(ledgerRows.rows.length, 1);
  assert.strictEqual(ledgerRows.rows[0].amount, '300.00');
  assert.strictEqual(ledgerRows.rows[0].currency, 'INR');

  // 19. Trigger blocks duplicate razorpay_payment_id but allows distinct payment IDs on same timesheet
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO public.payment_ledger (
          contract_id, timesheet_id, amount, currency, event_type, status, description, metadata
        ) VALUES ($1, $2, 300.00, 'INR', 'hourly_funded', 'succeeded', 'dup', '{"razorpay_payment_id":"pay_partial_2"}'::jsonb)`,
        [CONTRACT_1, TS_1]
      ),
    /Duplicate Razorpay payment/i
  );

  await db.query(
    `INSERT INTO public.payment_ledger (
      contract_id, timesheet_id, amount, currency, event_type, status, description, metadata
    ) VALUES ($1, $2, 200.00, 'INR', 'hourly_funded', 'succeeded', 'earlier partial', '{"razorpay_payment_id":"pay_partial_1"}'::jsonb)`,
    [CONTRACT_1, TS_1]
  );

  const totalLedger = await db.query(`SELECT * FROM public.payment_ledger WHERE timesheet_id = $1`, [TS_1]);
  assert.strictEqual(totalLedger.rows.length, 2);
});

test('Phase 2C.3 (Static/Source): verifyAndPayTimesheet removes unsafe fallback, RazorpayProvider checks currency, and lock order matches webhook', () => {
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  const billingSrc = fs.readFileSync(TIMESHEET_BILLING_PATH, 'utf8');
  const providerSrc = fs.readFileSync(RAZORPAY_PROVIDER_PATH, 'utf8');

  // 15. Lock order in fund_timesheet_with_payment: payment_attempts BEFORE timesheets
  const attemptLockIdx = migrationSql.indexOf('FROM public.payment_attempts');
  const timesheetLockIdx = migrationSql.indexOf('FROM public.timesheets');
  assert.ok(attemptLockIdx > 0 && timesheetLockIdx > attemptLockIdx);

  // 16. No direct fallback writes in verifyAndPayTimesheet
  assert.strictEqual(billingSrc.includes('fund_timesheet_with_payment RPC fallback triggered'), false);
  assert.strictEqual(billingSrc.includes('Continuing with authoritative Razorpay verification'), false);
  assert.ok(billingSrc.includes('PAYMENT_ATTEMPT_NOT_FOUND'));
  assert.ok(billingSrc.includes("'40P01'"));

  // 17. RazorpayProvider.verifyPayment validates currency
  assert.ok(providerSrc.includes('Currency mismatch:'));
  assert.ok(providerSrc.includes('expectedCurrency'));
});
