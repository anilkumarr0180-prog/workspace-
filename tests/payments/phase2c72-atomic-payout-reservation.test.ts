import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PayoutEngine } from '../../lib/services/payout-engine';
import { getTransferProvider } from '../../lib/payments/registry';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/20261127000005_atomic_payout_reservation.sql'
);

async function setupPayoutDb(): Promise<PGlite> {
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

    CREATE TABLE public.timesheets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 60,
      total_amount numeric(12,2) NOT NULL DEFAULT 500.00,
      status text NOT NULL DEFAULT 'paid'
    );

    CREATE TABLE public.payout_transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      milestone_id uuid,
      timesheet_id uuid,
      recipient_user_id uuid NOT NULL,
      provider text NOT NULL DEFAULT 'mock_route',
      provider_transfer_id text UNIQUE NOT NULL,
      provider_account_id text NOT NULL,
      gross_amount numeric(12,2) NOT NULL,
      fee_amount numeric(12,2) NOT NULL,
      net_amount numeric(12,2) NOT NULL,
      currency text NOT NULL,
      on_hold boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'processing' CHECK (
        status IN ('pending', 'eligible', 'processing', 'completed', 'failed', 'reversed', 'on_hold')
      ),
      idempotency_key text UNIQUE NOT NULL,
      failure_reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      settled_at timestamptz
    );

    INSERT INTO public.timesheets (id, contract_id, client_id, freelancer_id, week_start_date, total_amount, status)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-11-23', 500.00, 'paid'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-11-16', 250.00, 'paid');

    -- Pre-existing historical completed payout record (must remain preserved!)
    INSERT INTO public.payout_transfers (
      contract_id, timesheet_id, recipient_user_id, provider_transfer_id, provider_account_id,
      gross_amount, fee_amount, net_amount, currency, status, idempotency_key
    ) VALUES (
      '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222',
      'trf_hist_1', 'acct_1', 250.00, 25.00, 225.00, 'INR', 'completed', 'payout:timesheet:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:25000'
    );
  `);

  await db.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  return db;
}

const TS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TS_HIST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FREELANCER = '22222222-2222-4222-8222-222222222222';

test('Phase 2C.7.2 (PGlite): atomic reservation ownership, single active payout index, failed retry, and historical preservation', async () => {
  const db = await setupPayoutDb();

  // 1 & 2. First caller reserves; second caller gets reserved_by_caller=false with same transfer_id
  const r1 = await db.query<{ res: { reserved_by_caller: boolean; transfer_id: string; idempotency_key: string; status: string } }>(
    `SELECT public.reserve_timesheet_payout_transfer($1, $2, 500.00, 50.00, 450.00, 'INR', 'acct_1', '{}'::jsonb) AS res`,
    [TS_A, FREELANCER]
  );
  assert.strictEqual(r1.rows[0].res.reserved_by_caller, true);
  assert.strictEqual(r1.rows[0].res.status, 'pending');

  const r2 = await db.query<{ res: { reserved_by_caller: boolean; transfer_id: string; idempotency_key: string } }>(
    `SELECT public.reserve_timesheet_payout_transfer($1, $2, 500.00, 50.00, 450.00, 'INR', 'acct_1', '{}'::jsonb) AS res`,
    [TS_A, FREELANCER]
  );
  assert.strictEqual(r2.rows[0].res.reserved_by_caller, false);
  assert.strictEqual(r2.rows[0].res.transfer_id, r1.rows[0].res.transfer_id);
  assert.strictEqual(r2.rows[0].res.idempotency_key, r1.rows[0].res.idempotency_key);

  // Partial unique index blocks a second active row directly
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO public.payout_transfers (
          contract_id, timesheet_id, recipient_user_id, provider_transfer_id, provider_account_id,
          gross_amount, fee_amount, net_amount, currency, status, idempotency_key
        ) VALUES ('33333333-3333-4333-8333-333333333333', $1, $2, 'trf_dup', 'acct_1', 500, 50, 450, 'INR', 'processing', 'idem_dup')`,
        [TS_A, FREELANCER]
      ),
    /uq_payout_transfers_active_timesheet|duplicate key/i
  );

  // 6. Definitively failed payout can be safely retried with :retry:2
  await db.query(`SELECT public.mark_payout_transfer_failed($1, 'Provider rejected', '{}'::jsonb)`, [
    r1.rows[0].res.transfer_id,
  ]);
  const rRetry = await db.query<{ res: { reserved_by_caller: boolean; transfer_id: string; idempotency_key: string; attempt_no: number } }>(
    `SELECT public.reserve_timesheet_payout_transfer($1, $2, 500.00, 50.00, 450.00, 'INR', 'acct_1', '{}'::jsonb) AS res`,
    [TS_A, FREELANCER]
  );
  assert.strictEqual(rRetry.rows[0].res.reserved_by_caller, true);
  assert.notStrictEqual(rRetry.rows[0].res.transfer_id, r1.rows[0].res.transfer_id);
  assert.match(rRetry.rows[0].res.idempotency_key, /:retry:2$/);
  assert.strictEqual(rRetry.rows[0].res.attempt_no, 2);

  // Placeholder transfer ID guard in record_payout_transfer_dispatch
  await assert.rejects(
    () =>
      db.query(
        `SELECT public.record_payout_transfer_dispatch($1, 'resv_fake_placeholder', 'processing', false, '{}'::jsonb)`,
        [rRetry.rows[0].res.transfer_id]
      ),
    /Placeholder transfer ID/
  );

  // Duplicate provider_transfer_id overwrite guard & idempotency
  const disp1 = await db.query<{ provider_transfer_id: string; status: string }>(
    `SELECT provider_transfer_id, status FROM public.record_payout_transfer_dispatch($1, 'trf_real_retry_2', 'processing', false, '{}'::jsonb)`,
    [rRetry.rows[0].res.transfer_id]
  );
  assert.strictEqual(disp1.rows[0].provider_transfer_id, 'trf_real_retry_2');
  assert.strictEqual(disp1.rows[0].status, 'processing');

  // Same provider_transfer_id returns idempotently
  const dispSame = await db.query<{ provider_transfer_id: string; status: string }>(
    `SELECT provider_transfer_id, status FROM public.record_payout_transfer_dispatch($1, 'trf_real_retry_2', 'processing', false, '{}'::jsonb)`,
    [rRetry.rows[0].res.transfer_id]
  );
  assert.strictEqual(dispSame.rows[0].provider_transfer_id, 'trf_real_retry_2');

  // Different provider_transfer_id rejects with 23505
  await assert.rejects(
    () =>
      db.query(
        `SELECT public.record_payout_transfer_dispatch($1, 'trf_real_overwrite', 'processing', false, '{}'::jsonb)`,
        [rRetry.rows[0].res.transfer_id]
      ),
    /already has recorded provider_transfer_id/
  );

  // Valid status transition with same provider_transfer_id preserves ID
  const dispHold = await db.query<{ provider_transfer_id: string; status: string; on_hold: boolean }>(
    `SELECT provider_transfer_id, status, on_hold FROM public.record_payout_transfer_dispatch($1, 'trf_real_retry_2', 'on_hold', true, '{}'::jsonb)`,
    [rRetry.rows[0].res.transfer_id]
  );
  assert.strictEqual(dispHold.rows[0].provider_transfer_id, 'trf_real_retry_2');
  assert.strictEqual(dispHold.rows[0].status, 'on_hold');
  assert.strictEqual(dispHold.rows[0].on_hold, true);

  // 8 & 12. Historical completed payout cannot be marked failed or retried
  const histRes = await db.query<{ res: { reserved_by_caller: boolean; status: string } }>(
    `SELECT public.reserve_timesheet_payout_transfer($1, $2, 250.00, 25.00, 225.00, 'INR', 'acct_1', '{}'::jsonb) AS res`,
    [TS_HIST, FREELANCER]
  );
  assert.strictEqual(histRes.rows[0].res.reserved_by_caller, false);
  assert.strictEqual(histRes.rows[0].res.status, 'completed');

  const histTransfer = await db.query<{ id: string }>(
    `SELECT id FROM public.payout_transfers WHERE timesheet_id = $1`,
    [TS_HIST]
  );
  await assert.rejects(
    () => db.query(`SELECT public.mark_payout_transfer_failed($1, 'bad', '{}'::jsonb)`, [histTransfer.rows[0].id]),
    /Completed payout transfer .* cannot be marked failed/
  );
});

test('Phase 2C.7.2 (Unit): reconciliation of processing transfers, uncertain dispatch, and mixed-currency rejection', async () => {
  const provider = getTransferProvider();
  const originalFetch = provider.fetchTransfer.bind(provider);
  const originalCreate = provider.createTransfer.bind(provider);

  const makeDb = (opts: {
    ledgerRows: Array<{ timesheet_id: string | null; currency: string; event_type: string; metadata: Record<string, unknown>; status: string }>;
    reservation: Record<string, unknown>;
  }) => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          single: async () => ({
            data: {
              id: 'ts-1',
              contract_id: 'c-1',
              client_id: 'cli-1',
              freelancer_id: 'free-1',
              total_amount: 500,
              total_minutes: 120,
              week_start_date: '2026-11-23',
              status: 'paid',
            },
            error: null,
          }),
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
            if (table === 'payment_ledger') resolve({ data: opts.ledgerRows, error: null });
            else resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === 'reserve_timesheet_payout_transfer') {
          return { data: opts.reservation, error: null };
        }
        return { data: { id: 'tr-1' }, error: null };
      },
    } as unknown as SupabaseClient;
    return { db, rpcCalls };
  };

  try {
    // 11. Mixed-currency ledger entries rejected
    const { db: mixedDb } = makeDb({
      ledgerRows: [
        { timesheet_id: 'ts-1', currency: 'INR', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' },
        { timesheet_id: 'ts-1', currency: 'USD', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' },
      ],
      reservation: {},
    });
    const mixedEngine = new PayoutEngine(mixedDb);
    mixedEngine.checkFreelancerPayoutEligibility = async () => ({ eligible: true, accountId: 'acct_1', status: 'complete' });
    const mixedRes = await mixedEngine.initiateTimesheetPayout('ts-1');
    assert.strictEqual(mixedRes.success, false);
    assert.strictEqual(mixedRes.code, 'MIXED_CURRENCY');

    // 4 & 5. Existing processing transfer: pending provider status stays processing (does NOT call confirm)
    provider.fetchTransfer = async (id: string) => ({
      success: true,
      transferId: id,
      destinationAccountId: 'acct_1',
      amount: 450,
      currency: 'INR',
      onHold: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
      isSimulated: true,
    });
    const { db: pendingDb, rpcCalls: pendingCalls } = makeDb({
      ledgerRows: [{ timesheet_id: 'ts-1', currency: 'INR', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' }],
      reservation: {
        reserved_by_caller: false,
        transfer_id: 'tr-proc-1',
        status: 'processing',
        idempotency_key: 'payout:timesheet:ts-1:50000',
        provider_transfer_id: 'trf_real_1',
        gross_amount: 500,
        fee_amount: 50,
        net_amount: 450,
        on_hold: false,
      },
    });
    const pendingEngine = new PayoutEngine(pendingDb);
    pendingEngine.checkFreelancerPayoutEligibility = async () => ({ eligible: true, accountId: 'acct_1', status: 'complete' });
    const pendingRes = await pendingEngine.initiateTimesheetPayout('ts-1');
    assert.strictEqual(pendingRes.status, 'processing');
    assert.strictEqual(pendingCalls.some((c) => c.fn === 'confirm_payout_transfer_completion'), false);

    // 4. Existing processing transfer: processed provider status calls confirm_payout_transfer_completion
    provider.fetchTransfer = async (id: string) => ({
      success: true,
      transferId: id,
      destinationAccountId: 'acct_1',
      amount: 450,
      currency: 'INR',
      onHold: false,
      status: 'processed',
      createdAt: new Date().toISOString(),
      isSimulated: true,
    });
    const { db: doneDb, rpcCalls: doneCalls } = makeDb({
      ledgerRows: [{ timesheet_id: 'ts-1', currency: 'INR', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' }],
      reservation: {
        reserved_by_caller: false,
        transfer_id: 'tr-proc-1',
        status: 'processing',
        idempotency_key: 'payout:timesheet:ts-1:50000',
        provider_transfer_id: 'trf_real_1',
        gross_amount: 500,
        fee_amount: 50,
        net_amount: 450,
        on_hold: false,
      },
    });
    const doneEngine = new PayoutEngine(doneDb);
    doneEngine.checkFreelancerPayoutEligibility = async () => ({ eligible: true, accountId: 'acct_1', status: 'complete' });
    const doneRes = await doneEngine.initiateTimesheetPayout('ts-1');
    assert.strictEqual(doneRes.status, 'completed');
    assert.strictEqual(doneCalls.some((c) => c.fn === 'confirm_payout_transfer_completion'), true);

    // 7. Uncertain provider network failure keeps reservation pending (does NOT mark failed)
    provider.createTransfer = async () => {
      throw new Error('ETIMEDOUT');
    };
    const { db: uncDb, rpcCalls: uncCalls } = makeDb({
      ledgerRows: [{ timesheet_id: 'ts-1', currency: 'INR', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' }],
      reservation: {
        reserved_by_caller: true,
        transfer_id: 'tr-new-1',
        status: 'pending',
        idempotency_key: 'payout:timesheet:ts-1:50000',
        provider_transfer_id: 'resv_1',
        gross_amount: 500,
        fee_amount: 50,
        net_amount: 450,
        on_hold: false,
      },
    });
    const uncEngine = new PayoutEngine(uncDb);
    uncEngine.checkFreelancerPayoutEligibility = async () => ({ eligible: true, accountId: 'acct_1', status: 'complete' });
    const uncRes = await uncEngine.initiateTimesheetPayout('ts-1');
    assert.strictEqual(uncRes.success, false);
    assert.strictEqual(uncRes.code, 'DISPATCH_UNCERTAIN');
    assert.strictEqual(uncCalls.some((c) => c.fn === 'mark_payout_transfer_failed'), false);
  } finally {
    provider.fetchTransfer = originalFetch;
    provider.createTransfer = originalCreate;
  }
});
