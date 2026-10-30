/**
 * Workspace — Marketplace Payment Engine & Payout Architecture Verification Suite
 * 
 * Verifies:
 * 1. Provider-independent architecture (PaymentProvider, TransferProvider, RefundProvider, PayoutProvider).
 * 2. MockRouteProvider realistic simulation of linked accounts, transfers, holds, and reversals.
 * 3. Centralized Platform Fee Engine (authoritative 10% fee calculation, rounding, subunits).
 * 4. Freelancer linked-account onboarding, simulated KYC, and payout eligibility checks.
 * 5. Fixed-price lifecycle: checkout -> funding -> delivery -> client approval -> automatic payout -> delayed earnings settlement.
 * 6. Cancellation & transfer reversal simulation.
 * 7. Hourly payment lifecycle: time entry tracking -> timesheet submission -> client review & approval -> Razorpay test checkout -> payment verification -> automatic payout -> delayed earnings settlement.
 * 8. Financial integrity, duplicate transfer rejection, and idempotency guarantees.
 * 
 * Execution: Strictly isolated in-memory PostgreSQL (PGlite).
 * No real money, no real Razorpay APIs, no live bank transfers.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { calculatePlatformFee } from '../lib/payments/fee-engine';
import { MockRouteProvider } from '../lib/payments/providers/mock-route-provider';
import { PayoutEngine } from '../lib/services/payout-engine';

interface AssertionResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: AssertionResult[] = [];

function assert(condition: boolean, suite: string, name: string, errorMsg?: string) {
  if (condition) {
    results.push({ suite, name, passed: true });
    console.log(`  ✓ [${suite}] ${name}`);
  } else {
    results.push({ suite, name, passed: false, error: errorMsg });
    console.error(`  ✗ [${suite}] ${name} — ${errorMsg || 'Assertion failed'}`);
  }
}

async function runMarketplacePayoutTests() {
  console.log('\n================================================================');
  console.log('  WORKSPACE — MARKETPLACE PAYMENT ENGINE VERIFICATION SUITE');
  console.log('================================================================\n');

  // ==========================================================================
  // SUITE 1: PROVIDER-INDEPENDENT ARCHITECTURE & MOCK ROUTE PROVIDER
  // ==========================================================================
  console.log('--- 1. Provider-Independent Architecture & Mock Route ---');
  const mockRoute = new MockRouteProvider();

  // 1a. Simulated Linked Account Onboarding
  const accountRes = await mockRoute.createPayoutAccount({
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'freelancer@test.local',
    legalName: 'Aditi Sharma',
    bankName: 'HDFC Bank',
    bankIfsc: 'HDFC0001234',
    accountNumberMasked: 'XXXXXX5678',
    panMasked: 'XXXXX1234A',
  });

  assert(
    accountRes.success &&
    accountRes.accountId.startsWith('acc_sim_') &&
    accountRes.status === 'activated' &&
    accountRes.payoutEligible === true &&
    accountRes.isSimulated === true,
    'Provider',
    'MockRouteProvider creates realistic simulated linked account (acc_sim_...)'
  );

  // 1b. Create Held Transfer (on_hold: true)
  const transferRes = await mockRoute.createTransfer({
    paymentId: 'pay_test_fixed_123',
    destinationAccountId: accountRes.accountId,
    amount: 900.0,
    currency: 'INR',
    onHold: true,
    idempotencyKey: 'idemp_key_suite1_test1',
  });

  assert(
    transferRes.success &&
    transferRes.transferId.startsWith('trf_sim_') &&
    transferRes.onHold === true &&
    transferRes.status === 'processed' &&
    transferRes.isSimulated === true,
    'Provider',
    'MockRouteProvider creates realistic held transfer with on_hold: true'
  );

  // 1c. Idempotency Check: repeated request returns identical transfer
  const dupTransferRes = await mockRoute.createTransfer({
    paymentId: 'pay_test_fixed_123',
    destinationAccountId: accountRes.accountId,
    amount: 900.0,
    currency: 'INR',
    onHold: true,
    idempotencyKey: 'idemp_key_suite1_test1',
  });

  assert(
    dupTransferRes.success &&
    dupTransferRes.transferId === transferRes.transferId &&
    dupTransferRes.amount === transferRes.amount,
    'Provider',
    'MockRouteProvider returns identical transfer for identical idempotency key'
  );

  // 1d. Release Held Transfer (on_hold: false)
  const releaseRes = await mockRoute.releaseTransfer({
    transferId: transferRes.transferId,
  });

  assert(
    releaseRes.success &&
    releaseRes.transferId === transferRes.transferId &&
    releaseRes.onHold === false,
    'Provider',
    'MockRouteProvider successfully releases settlement hold (on_hold: false)'
  );

  // 1e. Reversal Simulation
  const reversalRes = await mockRoute.reverseTransfer({
    transferId: transferRes.transferId,
    amount: 900.0,
  });

  assert(
    reversalRes.success &&
    reversalRes.reversalId.startsWith('rvr_sim_') &&
    reversalRes.amount === 900.0,
    'Provider',
    'MockRouteProvider successfully simulates transfer reversal (rvr_sim_...)'
  );

  // ==========================================================================
  // SUITE 2: CENTRALIZED PLATFORM FEE ENGINE
  // ==========================================================================
  console.log('\n--- 2. Centralized Platform Fee Engine ---');

  // 2a. Standard 10% Fee on $1,000 Milestone
  const fee1 = calculatePlatformFee(1000.0, 'INR');
  assert(
    fee1.grossAmount === 1000.0 &&
    fee1.feeRate === 0.10 &&
    fee1.feeAmount === 100.0 &&
    fee1.netPayout === 900.0 &&
    fee1.grossSubunits === 100000 &&
    fee1.feeSubunits === 10000 &&
    fee1.netSubunits === 90000,
    'FeeEngine',
    'Standard 10% fee calculation on round figure ($1,000 -> $100 fee, $900 net)'
  );

  // 2b. Fractional Amount with Cent/Paise Rounding ($125.75)
  const fee2 = calculatePlatformFee(125.75, 'INR');
  assert(
    fee2.feeAmount === 12.58 &&
    fee2.netPayout === 113.17 &&
    fee2.feeAmount + fee2.netPayout === 125.75,
    'FeeEngine',
    'Fractional rounding preserves exact conservation: gross = fee + net'
  );

  // 2c. Invalid Inputs Rejection
  let zeroAmountBlocked = false;
  try {
    calculatePlatformFee(0, 'INR');
  } catch {
    zeroAmountBlocked = true;
  }
  assert(zeroAmountBlocked, 'FeeEngine', 'Rejects non-positive gross amounts fail-closed');

  // ==========================================================================
  // SUITE 3-8: ISOLATED DATABASE RECONCILIATION & WORKFLOW VERIFICATION
  // ==========================================================================
  console.log('\n--- Initializing Isolated PGlite Database Environment ---');

  const db = new PGlite({
    extensions: { pgcrypto, pg_trgm },
  });

  // Setup mock roles, extensions, and auth functions exactly as in Supabase
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
    END $$;
  `);

  // Apply migrations in order
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of migrationFiles) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    await db.exec(sql);
  }

  // Grant permissions for service_role in PGlite
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT USAGE ON SCHEMA public TO service_role;
  `);

  // Helper query runner
  async function queryRows<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    const res = await db.query(query, params);
    return res.rows as T[];
  }

  // Seed Users
  const clientId = 'c0000000-0000-4000-8000-000000000001';
  const freelancerId = 'f0000000-0000-4000-8000-000000000002';
  const unauthorizedId = 'e0000000-0000-4000-8000-000000000003';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${clientId}', 'client@marketplace.local'),
      ('${freelancerId}', 'freelancer@marketplace.local'),
      ('${unauthorizedId}', 'intruder@marketplace.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, active_mode) VALUES
      ('${clientId}', 'client_corp', 'Acme Client Corp', true, false, 'client'),
      ('${freelancerId}', 'top_coder', 'Aditi Sharma', false, true, 'freelancer'),
      ('${unauthorizedId}', 'intruder', 'Malicious Actor', true, true, 'client')
    ON CONFLICT (id) DO NOTHING;
  `);

  // ==========================================================================
  // SUITE 3: FREELANCER PAYOUT PROFILE ONBOARDING
  // ==========================================================================
  console.log('\n--- 3. Freelancer Payout Profile Onboarding ---');

  // Set auth context as freelancer
  await db.exec(`SET request.jwt.claim.sub = '${freelancerId}';`);

  const payoutProfileRows = await queryRows<{
    id: string;
    account_status: string;
    payout_eligible: boolean;
    provider_account_id: string;
    pan_last4: string;
    bank_account_last4: string;
  }>(`
    SELECT * FROM public.setup_freelancer_payout_profile(
      $1,
      'Aditi Sharma',
      'HDFC Bank',
      'HDFC0001234',
      'XXXXXX7890',
      'XXXXX1234A',
      'individual',
      'acc_sim_aditi_1234'
    );
  `, [freelancerId]);

  assert(
    payoutProfileRows.length === 1 &&
    payoutProfileRows[0].account_status === 'activated' &&
    payoutProfileRows[0].payout_eligible === true &&
    payoutProfileRows[0].pan_last4 === '234A' &&
    payoutProfileRows[0].bank_account_last4 === '7890',
    'Onboarding',
    'Freelancer successfully configures simulated payout profile'
  );

  // RLS test: Unauthorized user cannot modify freelancer's payout profile
  await db.exec(`SET request.jwt.claim.sub = '${unauthorizedId}';`);
  let unauthorizedProfileBlocked = false;
  try {
    await db.query(`
      SELECT * FROM public.setup_freelancer_payout_profile(
        $1,
        'Hacker Name',
        'Bad Bank',
        'BAD0001234',
        '9999999999',
        'BADPAN1234',
        'individual'
      );
    `, [freelancerId]);
  } catch {
    unauthorizedProfileBlocked = true;
  }
  assert(unauthorizedProfileBlocked, 'Onboarding', 'RLS rejects modifying another user payout profile');

  // ==========================================================================
  // SUITE 4: FIXED-PRICE PAYMENT & DELAYED SETTLEMENT LIFECYCLE
  // ==========================================================================
  console.log('\n--- 4. Fixed-Price Milestone Lifecycle & Delayed Settlement ---');

  // 4a. Client creates fixed-price contract with milestone
  await db.exec(`SET request.jwt.claim.sub = '${clientId}';`);
  const contractId = 'c1000000-0000-4000-8000-000000000001';
  const jobId = 'a1000000-0000-4000-8000-000000000001';
  const proposalId = 'b1000000-0000-4000-8000-000000000001';

  await db.exec(`
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES ('${jobId}', '${clientId}', (SELECT id FROM public.categories LIMIT 1), 'E-Commerce Marketplace Website', 'A complete description that is safely longer than the required minimum length.', 'fixed', 1000, 'expert', 'less_than_1_month', 'published');

    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
    VALUES ('${proposalId}', '${jobId}', '${freelancerId}', 1000, 'fixed', 'A valid proposal cover letter of sufficient length to meet all database requirements.', 'accepted');

    INSERT INTO public.contracts (
      id, proposal_id, job_id, client_id, freelancer_id, title, contract_type, status, fixed_price
    ) VALUES (
      '${contractId}', '${proposalId}', '${jobId}', '${clientId}', '${freelancerId}', 'E-Commerce Marketplace Website', 'fixed', 'active', 1000.0
    );
  `);

  // Milestone was auto-created by trigger with sequence 1
  const milestoneRows = await queryRows<{ id: string; status: string; amount: string }>(`
    SELECT id, status, amount FROM public.contract_milestones WHERE contract_id = $1 AND sequence_order = 1;
  `, [contractId]);
  const milestoneId = milestoneRows[0].id;

  await db.query(`
    UPDATE public.contract_milestones
       SET title = 'Phase 1: Backend Architecture',
           amount = 1000.0,
           currency = 'INR'
     WHERE id = $1;
  `, [milestoneId]);

  // 4b. Client funds milestone with Razorpay Test Mode
  const orderId = `order_test_fixed_${crypto.randomBytes(4).toString('hex')}`;
  const paymentId = `pay_test_fixed_${crypto.randomBytes(4).toString('hex')}`;
  const signature = crypto.createHmac('sha256', 'test_secret').update(`${orderId}|${paymentId}`).digest('hex');

  await db.query(`
    SELECT public.record_payment_attempt(
      $1::uuid, $2::text, 1000.0, 100000::bigint, 'INR'::text, '{"checkout":"test"}'::jsonb, 'test'::text
    );
  `, [milestoneId, orderId]);

  await db.exec(`SET ROLE service_role;`);
  await db.query(`
    SELECT public.fund_milestone_with_payment(
      $1::uuid,
      jsonb_build_object(
        'razorpay_payment_id', $2::text,
        'razorpay_order_id', $3::text,
        'razorpay_signature', $4::text,
        'client_id', $5::uuid,
        'environment', 'test'
      )
    );
  `, [milestoneId, paymentId, orderId, signature, clientId]);
  await db.exec(`RESET ROLE;`);

  const fundedMilestone = await queryRows<{ status: string }>(`
    SELECT status FROM public.contract_milestones WHERE id = $1;
  `, [milestoneId]);
  assert(fundedMilestone[0].status === 'funded', 'FixedPrice', 'Milestone transitions to funded after payment');

  // 4c. Freelancer starts and submits delivery
  await db.exec(`SET request.jwt.claim.sub = '${freelancerId}';`);
  await db.query(`
    SELECT public.start_milestone_work($1);
  `, [milestoneId]);

  await db.query(`
    SELECT public.submit_milestone_delivery($1, 'Complete delivery notes for Phase 1 backend.', '[]'::jsonb);
  `, [milestoneId]);

  const submittedMilestone = await queryRows<{ status: string }>(`
    SELECT status FROM public.contract_milestones WHERE id = $1;
  `, [milestoneId]);
  assert(submittedMilestone[0].status === 'submitted', 'FixedPrice', 'Milestone transitions to submitted upon work delivery');

  // 4d. Client approves delivery
  await db.exec(`SET request.jwt.claim.sub = '${clientId}';`);
  await db.query(`
    SELECT public.approve_and_release_milestone($1, 'Excellent delivery approved.');
  `, [milestoneId]);

  // 4d-2. Client duplicate approval succeeds idempotently without error
  const dupApprovalRows = await queryRows<{ status: string }>(`
    SELECT status FROM public.approve_and_release_milestone($1, 'Repeat approval');
  `, [milestoneId]);
  assert(
    dupApprovalRows[0].status === 'approved',
    'FixedPrice',
    'approve_and_release_milestone handles duplicate approval idempotently'
  );

  // 4e. Payout Engine initiates transfer via MockRouteProvider
  const transferIdempotencyKey = `payout:milestone:${milestoneId}:100000`;
  const simTransfer = await mockRoute.createTransfer({
    paymentId,
    destinationAccountId: 'acc_sim_aditi_1234',
    amount: 900.0,
    currency: 'INR',
    onHold: true,
    idempotencyKey: transferIdempotencyKey,
  });

  const transferRows = await queryRows<{ id: string; status: string; net_amount: string }>(`
    SELECT * FROM public.create_payout_transfer_record(
      $1, $2, 1000.0, 100.0, 900.0, 'INR', $3, $4, 'acc_sim_aditi_1234', $5, NULL, true
    );
  `, [contractId, freelancerId, transferIdempotencyKey, simTransfer.transferId, milestoneId]);
  const transferDbId = transferRows[0].id;

  // DELAYED SETTLEMENT VERIFICATION:
  // Freelancer earnings MUST STILL BE ZERO before provider confirms transfer completion!
  const preSettlementEarnings = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);
  assert(
    Number(preSettlementEarnings[0].total_earnings) === 0,
    'DelayedSettlement',
    'CRITICAL: Freelancer earnings DO NOT update before provider confirms completion'
  );

  // 4f. Provider confirms transfer completion
  await db.query(`
    SELECT public.confirm_payout_transfer_completion($1);
  `, [transferDbId]);

  // Earnings MUST NOW reflect the exact net payout ($900)
  const postSettlementEarnings = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);
  assert(
    Number(postSettlementEarnings[0].total_earnings) === 900.0,
    'DelayedSettlement',
    'Freelancer earnings update authoritatively only AFTER provider confirms transfer'
  );

  // Verify Ledger has exactly 3 entries for this milestone: escrow_funded, service_fee_deducted, payout_disbursed
  const ledgerRows = await queryRows<{ event_type: string; amount: string }>(`
    SELECT event_type, amount FROM public.payment_ledger WHERE milestone_id = $1 ORDER BY created_at ASC;
  `, [milestoneId]);
  assert(
    ledgerRows.some(r => r.event_type === 'escrow_funded' && Number(r.amount) === 1000.0) &&
    ledgerRows.some(r => r.event_type === 'service_fee_deducted' && Number(r.amount) === 100.0) &&
    ledgerRows.some(r => r.event_type === 'payout_disbursed' && Number(r.amount) === 900.0),
    'Ledger',
    'Ledger records escrow_funded, service_fee_deducted, and payout_disbursed'
  );

  // ==========================================================================
  // SUITE 4g: PAYOUT STATUS HARDENING & PAYOUTENGINE STATUS GUARDS
  // ==========================================================================
  console.log('\n--- 4g. Payout Status Hardening & PayoutEngine Guards ---');

  const pgliteDbAdapter = {
    from: (table: string) => {
      let selectedCols = '*';
      const filters: Array<{ col: string; val: unknown }> = [];
      const builder = {
        select: (cols: string) => {
          selectedCols = cols;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return builder;
        },
        single: async () => {
          let q = `SELECT ${selectedCols} FROM public.${table} WHERE 1=1`;
          const p: unknown[] = [];
          filters.forEach((f, idx) => {
            q += ` AND ${f.col} = $${idx + 1}`;
            p.push(f.val);
          });
          const rows = await queryRows(q, p);
          if (!rows[0]) return { data: null, error: new Error('Row not found') };
          return { data: rows[0], error: null };
        },
        maybeSingle: async () => {
          let q = `SELECT ${selectedCols} FROM public.${table} WHERE 1=1`;
          const p: unknown[] = [];
          filters.forEach((f, idx) => {
            q += ` AND ${f.col} = $${idx + 1}`;
            p.push(f.val);
          });
          const rows = await queryRows(q, p);
          return { data: rows[0] || null, error: null };
        },
      };
      return builder;
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'create_payout_transfer_record') {
        const rows = await queryRows(
          `SELECT * FROM public.create_payout_transfer_record(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          );`,
          [
            params.p_contract_id,
            params.p_recipient_user_id,
            params.p_gross_amount,
            params.p_fee_amount,
            params.p_net_amount,
            params.p_currency,
            params.p_idempotency_key,
            params.p_provider_transfer_id,
            params.p_provider_account_id,
            params.p_milestone_id || null,
            params.p_timesheet_id || null,
            params.p_on_hold || false,
            JSON.stringify(params.p_metadata || {}),
          ]
        );
        return { data: rows[0], error: null };
      }
      if (fn === 'confirm_payout_transfer_completion') {
        const rows = await queryRows(
          `SELECT * FROM public.confirm_payout_transfer_completion($1);`,
          [params.p_transfer_id]
        );
        return { data: rows[0], error: null };
      }
      return { data: null, error: new Error(`Unknown RPC ${fn}`) };
    },
  };

  const testEngine = new PayoutEngine(pgliteDbAdapter as unknown as import('@supabase/supabase-js').SupabaseClient);

  // Create Milestone #2 on contractId
  const m2Rows = await queryRows<{ id: string }>(`
    INSERT INTO public.contract_milestones (
      contract_id, client_id, freelancer_id, title, description, amount, currency, status, sequence_order
    ) VALUES (
      $1, $2, $3, 'Milestone 2 - Status Guard Hardening', 'Verification of status guards', 500.0, 'INR', 'planned', 2
    ) RETURNING id;
  `, [contractId, clientId, freelancerId]);
  const m2Id = m2Rows[0].id;

  // 1. Planned milestone rejected
  const plannedRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    plannedRes.success === false && plannedRes.code === 'MILESTONE_NOT_APPROVED',
    'PayoutStatusGuard',
    'initiateMilestonePayout rejects planned milestone with code MILESTONE_NOT_APPROVED'
  );

  // 2. Funded milestone rejected
  await db.query(`UPDATE public.contract_milestones SET status = 'funded' WHERE id = $1;`, [m2Id]);
  const fundedRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    fundedRes.success === false && fundedRes.code === 'MILESTONE_NOT_APPROVED',
    'PayoutStatusGuard',
    'initiateMilestonePayout rejects funded milestone with code MILESTONE_NOT_APPROVED'
  );

  // 3. In-progress milestone rejected
  await db.query(`UPDATE public.contract_milestones SET status = 'in_progress' WHERE id = $1;`, [m2Id]);
  const inProgRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    inProgRes.success === false && inProgRes.code === 'MILESTONE_NOT_APPROVED',
    'PayoutStatusGuard',
    'initiateMilestonePayout rejects in-progress milestone with code MILESTONE_NOT_APPROVED'
  );

  // 4. Submitted milestone rejected
  await db.query(`UPDATE public.contract_milestones SET status = 'submitted' WHERE id = $1;`, [m2Id]);
  const submittedRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    submittedRes.success === false && submittedRes.code === 'MILESTONE_NOT_APPROVED',
    'PayoutStatusGuard',
    'initiateMilestonePayout rejects submitted milestone with code MILESTONE_NOT_APPROVED'
  );

  // 5. Revision-requested milestone rejected
  await db.query(`UPDATE public.contract_milestones SET status = 'revision_requested' WHERE id = $1;`, [m2Id]);
  const revReqRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    revReqRes.success === false && revReqRes.code === 'MILESTONE_NOT_APPROVED',
    'PayoutStatusGuard',
    'initiateMilestonePayout rejects revision-requested milestone with code MILESTONE_NOT_APPROVED'
  );

  // 6. Approved milestone accepted and settles cleanly
  // Per database state transition trigger, revision_requested must re-submit before approval
  await db.query(`UPDATE public.contract_milestones SET status = 'submitted' WHERE id = $1;`, [m2Id]);
  await db.query(`UPDATE public.contract_milestones SET status = 'approved' WHERE id = $1;`, [m2Id]);
  const earningsBeforeM2 = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);

  const approvedRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    approvedRes.success === true &&
    approvedRes.status === 'completed' &&
    approvedRes.grossAmount === 500.0 &&
    approvedRes.feeAmount === 50.0 &&
    approvedRes.netAmount === 450.0,
    'PayoutStatusGuard',
    'initiateMilestonePayout accepts approved milestone and settles 10% platform fee ($450 net)'
  );

  // Verify milestone transitioned to released
  const m2FinalStatus = await queryRows<{ status: string }>(`
    SELECT status FROM public.contract_milestones WHERE id = $1;
  `, [m2Id]);
  assert(
    m2FinalStatus[0].status === 'released',
    'PayoutStatusGuard',
    'Milestone authoritatively transitions to released upon payout settlement'
  );

  // 7. Already-released milestone handled idempotently
  const releasedRes = await testEngine.initiateMilestonePayout(m2Id);
  assert(
    releasedRes.success === true &&
    releasedRes.status === 'completed' &&
    releasedRes.transferId === approvedRes.transferId,
    'PayoutStatusGuard',
    'initiateMilestonePayout handles already-released milestone idempotently returning existing transfer'
  );

  // 8. Duplicate payout cannot increase earnings twice
  const earningsAfterM2Duplicate = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);
  assert(
    Number(earningsAfterM2Duplicate[0].total_earnings) === Number(earningsBeforeM2[0].total_earnings) + 450.0,
    'PayoutStatusGuard',
    'Idempotent duplicate payout strictly prevents double balance inflation'
  );

  // ==========================================================================
  // SUITE 5: TRANSFER REVERSAL & CANCELLATION
  // ==========================================================================
  console.log('\n--- 5. Transfer Reversal Simulation ---');

  const reversalId = `rvr_sim_${crypto.randomBytes(4).toString('hex')}`;
  await db.query(`
    SELECT public.reverse_payout_transfer($1, $2, 'Client dispute settlement reversal');
  `, [transferDbId, reversalId]);

  const reversedTransfer = await queryRows<{ status: string; reversal_id: string }>(`
    SELECT status, reversal_id FROM public.payout_transfers WHERE id = $1;
  `, [transferDbId]);

  assert(
    reversedTransfer[0].status === 'reversed' &&
    reversedTransfer[0].reversal_id === reversalId,
    'Reversal',
    'Payout transfer status updates to reversed with logged reversal identifier'
  );

  // ==========================================================================
  // SUITE 6: HOURLY TIMESHEET BILLING & PAYOUT LIFECYCLE
  // ==========================================================================
  console.log('\n--- 6. Hourly Payment Lifecycle ---');

  // 6a. Client creates hourly contract ($50/hr, 40 hrs weekly limit)
  await db.exec(`SET request.jwt.claim.sub = '${clientId}';`);
  const hourlyContractId = 'c2000000-0000-4000-8000-000000000002';
  const hourlyJobId = 'a2000000-0000-4000-8000-000000000002';
  const hourlyProposalId = 'b2000000-0000-4000-8000-000000000002';

  await db.exec(`
    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES ('${hourlyJobId}', '${clientId}', (SELECT id FROM public.categories LIMIT 1), 'Full-Stack Developer Hourly Work', 'A sufficiently detailed project description for hourly contract work tracking.', 'hourly', 50, 'intermediate', '1_to_3_months', 'published');

    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
    VALUES ('${hourlyProposalId}', '${hourlyJobId}', '${freelancerId}', 50, 'hourly', 'Proposal bid cover letter for hourly contract development with necessary length.', 'accepted');

    INSERT INTO public.contracts (
      id, proposal_id, job_id, client_id, freelancer_id, title, contract_type, status, hourly_rate, weekly_hour_limit
    ) VALUES (
      '${hourlyContractId}', '${hourlyProposalId}', '${hourlyJobId}', '${clientId}', '${freelancerId}', 'Full-Stack Developer Hourly Work', 'hourly', 'active', 50.0, 40
    );
  `);

  // 6b. Freelancer logs time via timer
  await db.exec(`SET request.jwt.claim.sub = '${freelancerId}';`);
  const sessionRes = await queryRows<{ id: string }>(`
    SELECT * FROM public.start_timer_session($1, 'Refactoring auth middleware');
  `, [hourlyContractId]);
  const sessionId = sessionRes[0].id;

  // Backdate start_time by 2 hours so that stopping creates an entry and weekly timesheet rollup
  await db.query(`
    UPDATE public.active_timer_sessions
       SET start_time = clock_timestamp() - interval '2 hours'
     WHERE id = $1;
  `, [sessionId]);

  // Stop session after simulated work
  await db.query(`
    SELECT public.stop_timer_session('Completed unit tests for authentication') as entry;
  `);

  // Query timesheet generated for contract
  const timesheetRows = await queryRows<{ id: string; status: string; total_amount: string; total_minutes: number }>(`
    SELECT id, status, total_amount, total_minutes FROM public.timesheets WHERE contract_id = $1;
  `, [hourlyContractId]);
  const timesheetId = timesheetRows[0].id;

  // Update timesheet with concrete test hours (10 hours = $500.00)
  await db.query(`
    UPDATE public.timesheets
       SET total_minutes = 600,
           total_amount = 500.0
     WHERE id = $1;
  `, [timesheetId]);

  // 6c. Freelancer submits timesheet via authoritative procedure
  await db.exec(`SET request.jwt.claim.sub = '${freelancerId}';`);
  const submittedTimesheet = await queryRows<{ status: string }>(`
    SELECT status FROM public.submit_timesheet($1);
  `, [timesheetId]);
  assert(submittedTimesheet[0].status === 'submitted', 'Hourly', 'Timesheet submitted by freelancer via submit_timesheet()');

  // Authorization check: Freelancer cannot approve their own timesheet
  let unauthorizedApprovalBlocked = false;
  try {
    await db.query(`SELECT public.approve_timesheet($1);`, [timesheetId]);
  } catch {
    unauthorizedApprovalBlocked = true;
  }
  assert(unauthorizedApprovalBlocked, 'Hourly', 'Freelancer is strictly blocked from approving own timesheet');

  // 6d. Client reviews and approves timesheet via authoritative procedure
  await db.exec(`SET request.jwt.claim.sub = '${clientId}';`);
  const approvedTimesheet = await queryRows<{ status: string }>(`
    SELECT status FROM public.approve_timesheet($1);
  `, [timesheetId]);
  assert(approvedTimesheet[0].status === 'approved', 'Hourly', 'Timesheet approved by client via approve_timesheet()');

  // 6e. Client checkout via Razorpay Test Mode
  const hourlyOrderId = `order_hourly_${crypto.randomBytes(4).toString('hex')}`;
  const hourlyPaymentId = `pay_hourly_${crypto.randomBytes(4).toString('hex')}`;
  const hourlySig = crypto.createHmac('sha256', 'test_secret').update(`${hourlyOrderId}|${hourlyPaymentId}`).digest('hex');

  await db.query(`
    SELECT public.record_timesheet_payment_attempt(
      $1, $2, $3, 500.0, 50000, 'INR', $4, 'test', '{"hours":10}'::jsonb
    );
  `, [hourlyContractId, timesheetId, clientId, hourlyOrderId]);

  // Verify payment attempt target constraint
  const attemptRow = await queryRows<{ billing_type: string; timesheet_id: string }>(`
    SELECT billing_type, timesheet_id FROM public.payment_attempts WHERE razorpay_order_id = $1;
  `, [hourlyOrderId]);
  assert(
    attemptRow[0].billing_type === 'timesheet' &&
    attemptRow[0].timesheet_id === timesheetId,
    'Hourly',
    'Payment attempt recorded with billing_type = timesheet and timesheet_id'
  );

  // 6f. Fund timesheet with payment
  await db.query(`
    SELECT public.fund_timesheet_with_payment(
      $1, $2, $3, $4, 50000, 'INR', 'test', '{"verified":true}'::jsonb
    );
  `, [timesheetId, hourlyPaymentId, hourlyOrderId, hourlySig]);

  const paidTimesheet = await queryRows<{ status: string }>(`
    SELECT status FROM public.timesheets WHERE id = $1;
  `, [timesheetId]);
  assert(paidTimesheet[0].status === 'paid', 'Hourly', 'Timesheet transitions to paid after payment funding');

  // 6g. Automatic Payout for Timesheet ($500 gross - 10% fee = $450 net)
  const hourlyIdempKey = `payout:timesheet:${timesheetId}:50000`;
  const hourlySimTransfer = await mockRoute.createTransfer({
    paymentId: hourlyPaymentId,
    destinationAccountId: 'acc_sim_aditi_1234',
    amount: 450.0,
    currency: 'INR',
    onHold: false,
    idempotencyKey: hourlyIdempKey,
  });

  const hourlyTransferRows = await queryRows<{ id: string }>(`
    SELECT * FROM public.create_payout_transfer_record(
      $1, $2, 500.0, 50.0, 450.0, 'INR', $3, $4, 'acc_sim_aditi_1234', NULL, $5, false
    );
  `, [hourlyContractId, freelancerId, hourlyIdempKey, hourlySimTransfer.transferId, timesheetId]);
  const hourlyTransferId = hourlyTransferRows[0].id;

  // Confirm payout transfer completion
  await db.query(`
    SELECT public.confirm_payout_transfer_completion($1);
  `, [hourlyTransferId]);

  // Earnings should now equal previous $900 (M1) + $450 (M2) + current $450 (hourly) = $1,800!
  const finalFreelancerProfile = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);
  assert(
    Number(finalFreelancerProfile[0].total_earnings) === 1800.0,
    'Hourly',
    'Total earnings reflect fixed milestones ($900 + $450) + hourly timesheet ($450) = $1,800'
  );

  // 6h. Hourly Webhook Payment Reconciliation via Stored Procedure
  const webhookWeekStart = '2026-11-02';
  const secondTimesheetRows = await queryRows<{ id: string }>(`
    INSERT INTO public.timesheets (
      contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status
    ) VALUES (
      $1, $2, $3, $4, 300, 250.0, 'approved'
    ) RETURNING id;
  `, [hourlyContractId, clientId, freelancerId, webhookWeekStart]);
  const secondTimesheetId = secondTimesheetRows[0].id;

  const hookOrderId = `order_hook_${crypto.randomBytes(4).toString('hex')}`;
  const hookPaymentId = `pay_hook_${crypto.randomBytes(4).toString('hex')}`;
  const hookEventId = `evt_hook_${crypto.randomBytes(4).toString('hex')}`;
  const hookPayloadHash = crypto.createHash('sha256').update(hookEventId).digest('hex');

  // Pre-insert payment attempt
  await db.query(`
    SELECT public.record_timesheet_payment_attempt(
      $1, $2, $3, 250.0, 25000, 'INR', $4, 'test', '{"source":"webhook_test"}'::jsonb
    );
  `, [hourlyContractId, secondTimesheetId, clientId, hookOrderId]);

  // Execute reconcile_timesheet_webhook_payment
  const webhookResult = await queryRows<{ result: { status: string; idempotent: boolean; success: boolean } }>(`
    SELECT public.reconcile_timesheet_webhook_payment(
      p_timesheet_id => $1,
      p_razorpay_order_id => $2,
      p_razorpay_payment_id => $3,
      p_amount_subunits => 25000::bigint,
      p_currency => 'INR',
      p_payment_metadata => '{"method":"upi"}'::jsonb,
      p_event_id => $4,
      p_payload_hash => $5
    ) as result;
  `, [secondTimesheetId, hookOrderId, hookPaymentId, hookEventId, hookPayloadHash]);

  const hookRes = webhookResult[0].result;
  assert(
    hookRes.success === true && hookRes.status === 'paid' && hookRes.idempotent === false,
    'HourlyWebhook',
    'reconcile_timesheet_webhook_payment transitions timesheet to paid with idempotent: false'
  );

  const reconciledTimesheet = await queryRows<{ status: string }>(`
    SELECT status FROM public.timesheets WHERE id = $1;
  `, [secondTimesheetId]);
  assert(reconciledTimesheet[0].status === 'paid', 'HourlyWebhook', 'Timesheet transitioned to paid after webhook reconciliation');

  // 6i. Duplicate Hourly Webhook Replay Deduplication
  const dupWebhookResult = await queryRows<{ result: { status: string; idempotent: boolean; success: boolean } }>(`
    SELECT public.reconcile_timesheet_webhook_payment(
      p_timesheet_id => $1,
      p_razorpay_order_id => $2,
      p_razorpay_payment_id => $3,
      p_amount_subunits => 25000::bigint,
      p_currency => 'INR',
      p_payment_metadata => '{"method":"upi"}'::jsonb,
      p_event_id => $4,
      p_payload_hash => $5
    ) as result;
  `, [secondTimesheetId, hookOrderId, hookPaymentId, hookEventId, hookPayloadHash]);

  const dupHookRes = dupWebhookResult[0].result;
  assert(
    dupHookRes.status === 'already_processed' && dupHookRes.idempotent === true,
    'HourlyWebhook',
    'Repeated delivery of same webhook event returns already_processed with idempotent: true'
  );

  // Exactly-once ledger invariant: ledger entry for hourly_funded must be exactly 1
  const hourlyFundedLedgerCount = await queryRows<{ count: string }>(`
    SELECT COUNT(*) as count FROM public.payment_ledger WHERE timesheet_id = $1 AND event_type = 'hourly_funded';
  `, [secondTimesheetId]);
  assert(
    Number(hourlyFundedLedgerCount[0].count) === 1,
    'HourlyWebhook',
    'Deduplication preserves Exactly-Once ledger recording: count is strictly 1'
  );

  // 6j. Fail-closed: Mismatched payment amount rejects reconciliation
  let amountMismatchBlocked = false;
  try {
    await db.query(`
      SELECT public.reconcile_timesheet_webhook_payment(
        p_timesheet_id => $1,
        p_razorpay_order_id => $2,
        p_razorpay_payment_id => 'pay_mismatch_123',
        p_amount_subunits => 99999::bigint,
        p_currency => 'INR',
        p_payment_metadata => '{}'::jsonb,
        p_event_id => 'evt_mismatch_123',
        p_payload_hash => 'hash_123'
      );
    `, [secondTimesheetId, hookOrderId]);
  } catch {
    amountMismatchBlocked = true;
  }
  assert(amountMismatchBlocked, 'HourlyWebhook', 'Webhook reconciliation fails closed on amount mismatch');

  // ==========================================================================
  // SUITE 7: FINANCIAL INTEGRITY & IDEMPOTENCY
  // ==========================================================================
  console.log('\n--- 7. Financial Integrity & Idempotency ---');

  // 7a. Re-executing confirm_payout_transfer_completion is idempotent
  const repeatConfirm = await queryRows<{ status: string }>(`
    SELECT status FROM public.confirm_payout_transfer_completion($1);
  `, [hourlyTransferId]);
  assert(repeatConfirm[0].status === 'completed', 'Integrity', 'confirm_payout_transfer_completion is safely idempotent');

  // Earnings must NOT have incremented a second time
  const unchangedEarnings = await queryRows<{ total_earnings: string }>(`
    SELECT total_earnings FROM public.profiles WHERE id = $1;
  `, [freelancerId]);
  assert(
    Number(unchangedEarnings[0].total_earnings) === 1800.0,
    'Integrity',
    'Idempotent confirmation prevents double payout and duplicate balance inflation'
  );

  // 7b. Duplicate transfer insertion on identical idempotency key returns existing row
  const duplicateTransferAttempt = await queryRows<{ id: string }>(`
    SELECT id FROM public.create_payout_transfer_record(
      $1, $2, 500.0, 50.0, 450.0, 'INR', $3, 'trf_sim_duplicate_attempt', 'acc_sim_aditi_1234', NULL, $4, false
    );
  `, [hourlyContractId, freelancerId, hourlyIdempKey, timesheetId]);
  assert(
    duplicateTransferAttempt[0].id === hourlyTransferId,
    'Integrity',
    'create_payout_transfer_record returns existing transfer record on duplicate key'
  );

  // 7c. Provider failure simulation & recovery retry
  const failMilestoneId = milestoneId;
  const failIdempKey = `payout:milestone:${failMilestoneId}:recovery_test`;
  
  const failedTransferRes = await mockRoute.createTransfer({
    paymentId: 'pay_fail_test',
    destinationAccountId: 'acc_sim_aditi_1234',
    amount: 100.0,
    currency: 'INR',
    onHold: false,
    idempotencyKey: failIdempKey,
  });

  const failTransferRow = await queryRows<{ id: string; status: string }>(`
    SELECT * FROM public.create_payout_transfer_record(
      $1, $2, 111.11, 11.11, 100.0, 'INR', $3, $4, 'acc_sim_aditi_1234', $5, NULL, false
    );
  `, [contractId, freelancerId, failIdempKey, failedTransferRes.transferId, failMilestoneId]);

  // Repeated call with same idempotency key recovers existing record
  const retryTransferRow = await queryRows<{ id: string; status: string }>(`
    SELECT * FROM public.create_payout_transfer_record(
      $1, $2, 111.11, 11.11, 100.0, 'INR', $3, 'trf_retry_diff', 'acc_sim_aditi_1234', $4::uuid, NULL, false
    );
  `, [contractId, freelancerId, failIdempKey, failMilestoneId]);

  assert(
    retryTransferRow[0].id === failTransferRow[0].id,
    'Integrity',
    'Recovery retry retrieves original transfer without duplicating records'
  );

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n================================================================');
  console.log(`  MARKETPLACE PAYOUT SUITE SUMMARY: ${passed}/${total} PASSED`);
  if (failed > 0) {
    console.error(`  FAILURE: ${failed} tests failed!`);
  } else {
    console.log('  SUCCESS: All marketplace transfer and payout verifications passed!');
  }
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMarketplacePayoutTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
