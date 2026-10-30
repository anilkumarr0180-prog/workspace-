/**
 * Workspace — Phase 1: Razorpay Gateway Hardening Test Suite
 * 
 * Tests:
 * 1. Test and live environment configuration validation.
 * 2. Missing or mismatched credentials and live guardrails.
 * 3. Partial unique index on payment_attempts.razorpay_payment_id (PostgreSQL 23505).
 * 4. Webhook event deduplication via webhook_events table.
 * 5. Out-of-order webhook delivery handling without duplicate ledger rows.
 * 6. Safe recovery architecture for interrupted checkout (inspection & explicit recovery).
 * 7. Exactly-once ledger insertion verification.
 * 
 * Execution: Strictly isolated in-memory PostgreSQL (PGlite) + Mock Gateway objects.
 * No real payment transactions, no gateway API calls, no production data mutation.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { getRazorpayConfig } from '../lib/razorpay';
import { inspectCapturedPayment, reconcileCapturedPayment } from '../lib/services/payment-recovery';

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

async function runGatewayHardeningTests() {
  console.log('\n================================================================');
  console.log('  WORKSPACE — PHASE 1: RAZORPAY GATEWAY HARDENING TEST SUITE');
  console.log('================================================================\n');

  // ==========================================================================
  // SUITE 1: DYNAMIC RAZORPAY ENVIRONMENT CONFIGURATION & VALIDATION
  // ==========================================================================
  console.log('--- 1. Environment Configuration & Credential Validation ---');

  // 1a. Valid Test Mode Configuration
  const validTestEnv = {
    RAZORPAY_ENVIRONMENT: 'test',
    NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_valid1234567890',
    RAZORPAY_KEY_SECRET: 'test_secret_1234567890',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_test_secret_1234',
    RAZORPAY_CURRENCY: 'USD',
  };
  const testCfg = getRazorpayConfig(validTestEnv);
  assert(
    testCfg.environment === 'test' && testCfg.isTest === true && testCfg.isLive === false && testCfg.currency === 'USD',
    'Config',
    'Valid test mode configuration resolves successfully with test flags'
  );

  // 1b. Default to Test Mode when RAZORPAY_ENVIRONMENT is omitted
  const omittedEnv = {
    NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_valid1234567890',
    RAZORPAY_KEY_SECRET: 'test_secret_1234567890',
  };
  const defaultCfg = getRazorpayConfig(omittedEnv);
  assert(
    defaultCfg.environment === 'test' && defaultCfg.isTest === true,
    'Config',
    'Omitting RAZORPAY_ENVIRONMENT defaults safely to "test"'
  );

  // 1c. Valid Live Mode Configuration
  const validLiveEnv = {
    RAZORPAY_ENVIRONMENT: 'live',
    NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_abc1234567890xyz',
    RAZORPAY_KEY_SECRET: 'live_secret_genuine_enterprise_key_999',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_live_genuine_webhook_secret_888',
    RAZORPAY_CURRENCY: 'INR',
  };
  const liveCfg = getRazorpayConfig(validLiveEnv);
  assert(
    liveCfg.environment === 'live' && liveCfg.isLive === true && liveCfg.isTest === false && liveCfg.currency === 'INR',
    'Config',
    'Valid live mode configuration resolves successfully with live flags'
  );

  // 1d. Mismatched Credentials: Test mode with Live Key
  let testWithLiveKeyBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'test',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_accidental_live_key',
      RAZORPAY_KEY_SECRET: 'test_secret_123',
    });
  } catch (err: unknown) {
    testWithLiveKeyBlocked = err instanceof Error && err.message.includes('Razorpay environment mismatch');
  }
  assert(testWithLiveKeyBlocked, 'Config', 'Test environment rejects live key (rzp_live_...) fail-closed');

  // 1e. Mismatched Credentials: Live mode with Test Key
  let liveWithTestKeyBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'live',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_accidental_test_key',
      RAZORPAY_KEY_SECRET: 'live_secret_genuine_enterprise_key_999',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_live_valid',
    });
  } catch (err: unknown) {
    liveWithTestKeyBlocked = err instanceof Error && err.message.includes('Razorpay environment mismatch');
  }
  assert(liveWithTestKeyBlocked, 'Config', 'Live environment rejects test key (rzp_test_...) fail-closed');

  // 1f. Accidental Live Execution: Live mode without Webhook Secret
  let liveWithoutWebhookBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'live',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_valid_key_12345',
      RAZORPAY_KEY_SECRET: 'live_secret_genuine_key_123456789',
      // RAZORPAY_WEBHOOK_SECRET missing
    });
  } catch (err: unknown) {
    liveWithoutWebhookBlocked = err instanceof Error && err.message.includes('RAZORPAY_WEBHOOK_SECRET is required in live mode');
  }
  assert(liveWithoutWebhookBlocked, 'Config', 'Live mode strictly requires RAZORPAY_WEBHOOK_SECRET fail-closed');

  // 1g. Accidental Live Execution: Live mode with placeholder secret
  let liveWithPlaceholderSecretBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'live',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_valid_key_12345',
      RAZORPAY_KEY_SECRET: 'your_razorpay_key_secret_here',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_valid_1234',
    });
  } catch (err: unknown) {
    liveWithPlaceholderSecretBlocked = err instanceof Error && err.message.includes('genuine live credentials');
  }
  assert(liveWithPlaceholderSecretBlocked, 'Config', 'Live mode rejects template placeholder secrets fail-closed');

  // 1h. Invalid Environment Value (e.g. 'staging' or 'production')
  let invalidEnvBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'staging',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_12345',
      RAZORPAY_KEY_SECRET: 'test_secret_123',
    });
  } catch (err: unknown) {
    invalidEnvBlocked = err instanceof Error && err.message.includes('Supported environments are "test" and "live"');
  }
  assert(invalidEnvBlocked, 'Config', 'Unsupported environment names (e.g. "staging") are rejected fail-closed');

  // 1i. Missing Key ID or Key Secret
  let missingKeyIdBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'test',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: 'test_secret_123',
    });
  } catch (err: unknown) {
    missingKeyIdBlocked = err instanceof Error && err.message.includes('Missing NEXT_PUBLIC_RAZORPAY_KEY_ID');
  }
  assert(missingKeyIdBlocked, 'Config', 'Missing Key ID is rejected fail-closed');

  let missingKeySecretBlocked = false;
  try {
    getRazorpayConfig({
      RAZORPAY_ENVIRONMENT: 'test',
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_12345',
      RAZORPAY_KEY_SECRET: '',
    });
  } catch (err: unknown) {
    missingKeySecretBlocked = err instanceof Error && err.message.includes('Missing RAZORPAY_KEY_SECRET');
  }
  assert(missingKeySecretBlocked, 'Config', 'Missing Key Secret is rejected fail-closed');

  // ==========================================================================
  // SUITE 2: ISOLATED DATABASE INITIALIZATION & MIGRATION EXECUTION
  // ==========================================================================
  console.log('\n--- 2. Isolated Database Schema & Migration Execution ---');

  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

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

  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'));
  }
  assert(true, 'Database', `Successfully applied all ${migrationFiles.length} database migrations in PGlite`);

  async function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const res = await db.query(sql);
    return res.rows as T[];
  }

  // Verify partial unique index exists on payment_attempts.razorpay_payment_id
  const indexRows = await queryRows<{ indexname: string; indexdef: string }>(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'payment_attempts' AND indexname = 'uq_payment_attempts_razorpay_payment_id';
  `);
  assert(
    indexRows.length === 1 && String(indexRows[0].indexdef).includes('WHERE (razorpay_payment_id IS NOT NULL)'),
    'Database',
    'Partial unique index uq_payment_attempts_razorpay_payment_id verified in PostgreSQL system catalog'
  );

  // Verify webhook_events table exists
  const whTableRows = await queryRows(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'webhook_events' AND column_name IN ('event_id', 'event_type', 'payload_hash', 'status', 'received_at', 'processed_at');
  `);
  assert(
    whTableRows.length === 6,
    'Database',
    'webhook_events table schema verified with event_id, event_type, payload_hash, status, received_at, processed_at'
  );

  // Setup seed fixtures (User, Company, Contract, Milestone)
  const clientId = 'a0000000-0000-0000-0000-000000000001';
  const freelancerId = 'b0000000-0000-0000-0000-000000000002';
  const contractId = 'c0000000-0000-0000-0000-000000000003';
  const milestone1Id = 'd0000000-0000-0000-0000-000000000004';
  const milestone2Id = 'd0000000-0000-0000-0000-000000000005';
  const milestone3Id = 'd0000000-0000-0000-0000-000000000006';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${clientId}', 'client_test@workspace.local'),
      ('${freelancerId}', 'freelancer_test@workspace.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, active_mode) VALUES
      ('${clientId}', 'test_client_harden', 'Test Client', true, false, 'client'),
      ('${freelancerId}', 'test_free_harden', 'Test Freelancer', false, true, 'freelancer')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
    VALUES ('e0000000-0000-0000-0000-000000000001', '${clientId}', (SELECT id FROM public.categories LIMIT 1), 'Harden Test Job', 'Long enough description exceeding the fifty character constraint requirement.', 'fixed', 1500, 'expert', 'less_than_1_month', 'published');

    INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
    VALUES ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '${freelancerId}', 1500, 'fixed', 'A fifty character proposal cover letter to satisfy the validation constraint check.', 'accepted');

    INSERT INTO public.contracts (id, proposal_id, job_id, client_id, freelancer_id, contract_type, title, fixed_price, status)
    VALUES ('${contractId}', 'e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '${clientId}', '${freelancerId}', 'fixed', 'Harden Test Job', 1500, 'active');

    -- Update trigger-generated default milestone 1
    UPDATE public.contract_milestones
       SET id = '${milestone1Id}', amount = 500, title = 'Milestone 1 - Deduplication', description = 'Test Deduplication'
     WHERE contract_id = '${contractId}' AND sequence_order = 1;

    -- Create milestones 2 and 3 in planned status
    INSERT INTO public.contract_milestones (id, contract_id, client_id, freelancer_id, title, description, amount, currency, sequence_order, status)
    VALUES
      ('${milestone2Id}', '${contractId}', '${clientId}', '${freelancerId}', 'Milestone 2 - Out of Order', 'Test Out of Order', 500, 'USD', 2, 'planned'),
      ('${milestone3Id}', '${contractId}', '${clientId}', '${freelancerId}', 'Milestone 3 - Recovery', 'Test Recovery', 500, 'USD', 3, 'planned');
  `);

  // ==========================================================================
  // SUITE 3: PAYMENT ID INTEGRITY: PARTIAL UNIQUE INDEX ENFORCEMENT
  // ==========================================================================
  console.log('\n--- 3. Payment ID Integrity & Partial Unique Index ---');

  // 3a. Inserting initial attempt with razorpay_payment_id succeeds
  const orderA = 'order_UNIQUE_TEST_001';
  const paymentA = 'pay_SHARED_ATTACK_001';
  await db.exec(`
    INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, razorpay_payment_id, amount, amount_subunits, currency, status)
    VALUES ('${contractId}', '${milestone1Id}', '${clientId}', '${orderA}', '${paymentA}', 500, 50000, 'USD', 'created');
  `);
  assert(true, 'PaymentID', 'Initial payment attempt with unique razorpay_payment_id inserted successfully');

  // 3b. Inserting SECOND attempt with SAME razorpay_payment_id MUST fail with unique_violation (23505)
  const orderB = 'order_UNIQUE_TEST_002';
  let duplicatePaymentIdBlocked = false;
  let duplicateErrorCode = '';
  try {
    await db.exec(`
      INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, razorpay_payment_id, amount, amount_subunits, currency, status)
      VALUES ('${contractId}', '${milestone2Id}', '${clientId}', '${orderB}', '${paymentA}', 500, 50000, 'USD', 'created');
    `);
  } catch (err: unknown) {
    duplicatePaymentIdBlocked = true;
    duplicateErrorCode = (err as { code?: string })?.code || '';
  }
  assert(
    duplicatePaymentIdBlocked && duplicateErrorCode === '23505',
    'PaymentID',
    'Duplicate non-null razorpay_payment_id rejected by partial unique index with PostgreSQL error 23505'
  );

  // 3c. Multiple attempts with NULL payment IDs are permitted (Partial Index behavior)
  let multipleNullPaymentsAllowed = false;
  try {
    await db.exec(`
      INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, razorpay_payment_id, amount, amount_subunits, currency, status)
      VALUES 
        ('${contractId}', '${milestone2Id}', '${clientId}', 'order_NULL_TEST_001', NULL, 500, 50000, 'USD', 'created'),
        ('${contractId}', '${milestone3Id}', '${clientId}', 'order_NULL_TEST_002', NULL, 500, 50000, 'USD', 'created');
    `);
    multipleNullPaymentsAllowed = true;
  } catch (err: unknown) {
    console.error('Null payment insert error:', err);
  }
  assert(multipleNullPaymentsAllowed, 'PaymentID', 'Partial index permits multiple pending attempts with NULL payment IDs');

  // Clean up test order attempts for subsequent suites
  await db.exec(`DELETE FROM public.payment_attempts WHERE contract_id = '${contractId}';`);

  // ==========================================================================
  // SUITE 4: WEBHOOK EVENT DEDUPLICATION (webhook_events)
  // ==========================================================================
  console.log('\n--- 4. Webhook Event Deduplication ---');

  const dedupeOrderId = 'order_DEDUPE_1001';
  const dedupePaymentId = 'pay_DEDUPE_1001';
  const dedupeEventId = 'evt_DEDUPE_EVENT_ALPHA_001';
  const dedupeHash = crypto.createHash('sha256').update('{"mock":"raw_body_dedupe"}').digest('hex');

  // Insert payment attempt for milestone 1
  await db.exec(`
    INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, amount, amount_subunits, currency, status, environment)
    VALUES ('${contractId}', '${milestone1Id}', '${clientId}', '${dedupeOrderId}', 500, 50000, 'USD', 'created', 'test');
  `);

  // First webhook delivery: should successfully fund milestone and insert 1 ledger entry
  await db.exec('SET ROLE service_role;');
  const firstDeliveryRes = await db.query(`
    SELECT public.reconcile_webhook_payment(
      p_milestone_id := '${milestone1Id}'::uuid,
      p_razorpay_order_id := '${dedupeOrderId}',
      p_razorpay_payment_id := '${dedupePaymentId}',
      p_amount_subunits := 50000::bigint,
      p_currency := 'USD',
      p_payment_metadata := '{"provider": "razorpay", "environment": "test", "event": "payment.captured"}'::jsonb,
      p_event_id := '${dedupeEventId}',
      p_payload_hash := '${dedupeHash}'
    ) as result;
  `);
  await db.exec('RESET ROLE;');

  const firstJson = (firstDeliveryRes.rows[0] as { result: { success: boolean; idempotent: boolean; status: string } }).result;
  assert(
    firstJson.success === true && firstJson.idempotent === false && firstJson.status === 'funded',
    'Deduplication',
    'Initial webhook delivery transitions milestone to "funded" with idempotent: false'
  );

  // Verify webhook_events record status is 'processed'
  const whEventRows = await queryRows(`
    SELECT status, event_id, payload_hash, processed_at
    FROM public.webhook_events
    WHERE event_id = '${dedupeEventId}';
  `);
  assert(
    whEventRows.length === 1 && whEventRows[0].status === 'processed' && whEventRows[0].processed_at !== null,
    'Deduplication',
    'webhook_events audit table recorded event as "processed" with non-null processed_at timestamp'
  );

  // Verify exactly 1 ledger entry exists
  const ledgerRows1 = await queryRows(`
    SELECT count(*) as count FROM public.payment_ledger
    WHERE milestone_id = '${milestone1Id}' AND event_type = 'escrow_funded';
  `);
  assert(
    Number(ledgerRows1[0].count) === 1,
    'Deduplication',
    'Exactly 1 escrow_funded ledger entry recorded after initial webhook'
  );

  // Duplicate webhook delivery: Send identical event ID again
  await db.exec('SET ROLE service_role;');
  const secondDeliveryRes = await db.query(`
    SELECT public.reconcile_webhook_payment(
      p_milestone_id := '${milestone1Id}'::uuid,
      p_razorpay_order_id := '${dedupeOrderId}',
      p_razorpay_payment_id := '${dedupePaymentId}',
      p_amount_subunits := 50000::bigint,
      p_currency := 'USD',
      p_payment_metadata := '{"provider": "razorpay", "environment": "test", "event": "payment.captured"}'::jsonb,
      p_event_id := '${dedupeEventId}',
      p_payload_hash := '${dedupeHash}'
    ) as result;
  `);
  await db.exec('RESET ROLE;');

  const secondJson = (secondDeliveryRes.rows[0] as { result: { success: boolean; idempotent: boolean; status: string } }).result;
  assert(
    secondJson.success === true && secondJson.idempotent === true && secondJson.status === 'already_processed',
    'Deduplication',
    'Repeated delivery of same event_id immediately short-circuits with status: "already_processed"'
  );

  // Verify STILL exactly 1 ledger entry exists (no duplicate ledger insertion)
  const ledgerRows2 = await queryRows(`
    SELECT count(*) as count FROM public.payment_ledger
    WHERE milestone_id = '${milestone1Id}' AND event_type = 'escrow_funded';
  `);
  assert(
    Number(ledgerRows2[0].count) === 1,
    'Deduplication',
    'Exactly-once ledger insertion preserved: ledger count remains strictly 1 after duplicate delivery'
  );

  // ==========================================================================
  // SUITE 5: OUT-OF-ORDER WEBHOOK DELIVERY HANDLING
  // ==========================================================================
  console.log('\n--- 5. Out-of-Order Webhook Delivery Handling ---');

  const oooOrderId = 'order_OOO_2002';
  const oooPaymentId = 'pay_OOO_2002';
  const oooOrderPaidEventId = 'evt_OOO_ORDER_PAID_001';
  const oooPaymentCapturedEventId = 'evt_OOO_PAYMENT_CAPTURED_002';

  // Attempt for milestone 2
  await db.exec(`
    INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, amount, amount_subunits, currency, status, environment)
    VALUES ('${contractId}', '${milestone2Id}', '${clientId}', '${oooOrderId}', 500, 50000, 'USD', 'created', 'test');
  `);

  // Event 1: 'order.paid' arrives FIRST
  await db.exec('SET ROLE service_role;');
  const oooDelivery1 = await db.query(`
    SELECT public.reconcile_webhook_payment(
      p_milestone_id := '${milestone2Id}'::uuid,
      p_razorpay_order_id := '${oooOrderId}',
      p_razorpay_payment_id := NULL,
      p_amount_subunits := 50000::bigint,
      p_currency := 'USD',
      p_payment_metadata := '{"provider": "razorpay", "environment": "test", "event": "order.paid"}'::jsonb,
      p_event_id := '${oooOrderPaidEventId}',
      p_payload_hash := 'hash_order_paid_ooo'
    ) as result;
  `);
  await db.exec('RESET ROLE;');

  const ooo1Json = (oooDelivery1.rows[0] as { result: { success: boolean; idempotent: boolean; status: string } }).result;
  assert(
    ooo1Json.success === true && ooo1Json.status === 'funded',
    'OutOfOrder',
    'First event (order.paid) successfully funds milestone'
  );

  // Event 2: 'payment.captured' arrives LATER out-of-order for the same order attempt
  await db.exec('SET ROLE service_role;');
  const oooDelivery2 = await db.query(`
    SELECT public.reconcile_webhook_payment(
      p_milestone_id := '${milestone2Id}'::uuid,
      p_razorpay_order_id := '${oooOrderId}',
      p_razorpay_payment_id := '${oooPaymentId}',
      p_amount_subunits := 50000::bigint,
      p_currency := 'USD',
      p_payment_metadata := '{"provider": "razorpay", "environment": "test", "event": "payment.captured"}'::jsonb,
      p_event_id := '${oooPaymentCapturedEventId}',
      p_payload_hash := 'hash_payment_captured_ooo'
    ) as result;
  `);
  await db.exec('RESET ROLE;');

  const ooo2Json = (oooDelivery2.rows[0] as { result: { success: boolean; idempotent: boolean; status: string } }).result;
  assert(
    ooo2Json.success === true && ooo2Json.idempotent === true,
    'OutOfOrder',
    'Subsequent event (payment.captured) arrives out-of-order and acknowledges idempotently'
  );

  // Verify payment attempt received the payment ID from the second event
  const attemptRowsOOO = await queryRows(`
    SELECT status, razorpay_payment_id FROM public.payment_attempts WHERE razorpay_order_id = '${oooOrderId}';
  `);
  assert(
    attemptRowsOOO[0].status === 'captured' && attemptRowsOOO[0].razorpay_payment_id === oooPaymentId,
    'OutOfOrder',
    'Out-of-order event safely updated razorpay_payment_id without regressing attempt status'
  );

  // Verify ledger has strictly 1 entry
  const ledgerRowsOOO = await queryRows(`
    SELECT count(*) as count FROM public.payment_ledger WHERE milestone_id = '${milestone2Id}' AND event_type = 'escrow_funded';
  `);
  assert(
    Number(ledgerRowsOOO[0].count) === 1,
    'OutOfOrder',
    'Exactly-once ledger insertion preserved under out-of-order event delivery'
  );

  // ==========================================================================
  // SUITE 6: SAFE RECOVERY ARCHITECTURE (INTERRUPTED CHECKOUT RECOVERY)
  // ==========================================================================
  console.log('\n--- 6. Safe Recovery Architecture for Interrupted Checkout ---');

  process.env.RAZORPAY_ENVIRONMENT = 'test';
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = 'rzp_test_recovery_123456';
  process.env.RAZORPAY_KEY_SECRET = 'recovery_secret_key_1234567890';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_recovery_secret_1234';

  const recoveryOrderId = 'order_RECOVERY_3003';
  const recoveryPaymentId = 'pay_RECOVERY_3003';

  // Setup attempt for milestone 3 representing an interrupted checkout:
  // Client completed modal payment, payment was captured at gateway, but client disconnected
  // before synchronous verification and webhook was delayed.
  // DB state: milestone is 'planned', attempt is 'created'.
  await db.exec(`
    INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, amount, amount_subunits, currency, status, environment)
    VALUES ('${contractId}', '${milestone3Id}', '${clientId}', '${recoveryOrderId}', 500, 50000, 'USD', 'created', 'test');
  `);

  // Create Mock Razorpay Client and Mock Supabase Client adapter pointing to isolated PGlite
  const mockRazorpay = {
    payments: {
      fetch: async (id: string) => {
        if (id === recoveryPaymentId) {
          return {
            id: recoveryPaymentId,
            order_id: recoveryOrderId,
            status: 'captured',
            amount: 50000,
            currency: 'USD',
            notes: {
              milestone_id: milestone3Id,
              contract_id: contractId,
            },
            created_at: 1730000000,
          };
        }
        throw new Error(`Payment not found: ${id}`);
      },
    },
  } as unknown as import('razorpay');

  // Supabase adapter over PGlite for inspection and recovery execution
  const mockSupabase = {
    from: (table: string) => {
      return {
        select: () => {
          return {
            eq: (col: string, val: string) => {
              return {
                maybeSingle: async () => {
                  const res = await db.query(`SELECT * FROM public.${table} WHERE ${col} = '${val}' LIMIT 1;`);
                  return { data: res.rows[0] || null, error: null };
                },
                eq: (col2: string, val2: string) => {
                  return (async () => {
                    const res = await db.query(`SELECT * FROM public.${table} WHERE ${col} = '${val}' AND ${col2} = '${val2}';`);
                    return { data: res.rows, error: null };
                  })();
                },
              };
            },
          };
        },
      };
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'reconcile_webhook_payment') {
        const metadataJson = JSON.stringify(params.p_payment_metadata || {});
        await db.exec('SET ROLE service_role;');
        const res = await db.query(`
          SELECT public.reconcile_webhook_payment(
            p_milestone_id := '${params.p_milestone_id}'::uuid,
            p_razorpay_order_id := '${params.p_razorpay_order_id}',
            p_razorpay_payment_id := ${params.p_razorpay_payment_id ? `'${params.p_razorpay_payment_id}'` : 'NULL'},
            p_amount_subunits := ${params.p_amount_subunits}::bigint,
            p_currency := '${params.p_currency}',
            p_payment_metadata := '${metadataJson}'::jsonb,
            p_event_id := ${params.p_event_id ? `'${params.p_event_id}'` : 'NULL'},
            p_payload_hash := ${params.p_payload_hash ? `'${params.p_payload_hash}'` : 'NULL'}
          ) as result;
        `);
        await db.exec('RESET ROLE;');
        return { data: (res.rows[0] as { result: unknown }).result, error: null };
      }
      return { data: null, error: new Error(`Unknown RPC ${fn}`) };
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  // 6a. Read-Only Inspection of Interrupted Checkout
  const inspection = await inspectCapturedPayment(recoveryPaymentId, {
    razorpayClient: mockRazorpay,
    supabaseClient: mockSupabase,
  });

  assert(
    inspection.canReconcile === true && inspection.alreadyReconciled === false && inspection.discrepancies.length === 0,
    'Recovery',
    'Read-only inspection correctly identifies recoverable interrupted checkout with 0 discrepancies'
  );
  assert(
    inspection.database.milestoneStatus === 'planned' && inspection.database.attemptStatus === 'created',
    'Recovery',
    'Inspection confirms database state is un-reconciled (milestone: planned, attempt: created)'
  );

  // 6b. Dry Run Execution: verifies zero database mutations occur
  const dryRunRes = await reconcileCapturedPayment(recoveryPaymentId, { dryRun: true }, {
    razorpayClient: mockRazorpay,
    supabaseClient: mockSupabase,
  });
  assert(
    dryRunRes.success === true && dryRunRes.actionTaken === 'aborted',
    'Recovery',
    'Dry-run reconciliation aborts before mutation and modifies zero database records'
  );

  const dryRunDbRows = await queryRows(`SELECT status FROM public.contract_milestones WHERE id = '${milestone3Id}';`);
  assert(
    dryRunDbRows[0].status === 'planned',
    'Recovery',
    'Milestone remains in "planned" state after dry-run inspection'
  );

  // 6c. Explicit Recovery Execution: performs atomic reconciliation
  const recoveryExecRes = await reconcileCapturedPayment(
    recoveryPaymentId,
    { operatorId: 'ops_engineer_test', notes: 'Automated recovery unit test' },
    { razorpayClient: mockRazorpay, supabaseClient: mockSupabase }
  );
  assert(
    recoveryExecRes.success === true && recoveryExecRes.actionTaken === 'reconciled',
    'Recovery',
    'Explicit recovery execution successfully transitions payment to reconciled'
  );

  // Verify milestone is now funded and attempt is captured
  const milestoneRecoveredRows = await queryRows(`SELECT status FROM public.contract_milestones WHERE id = '${milestone3Id}';`);
  const attemptRecoveredRows = await queryRows(`SELECT status, razorpay_payment_id FROM public.payment_attempts WHERE razorpay_order_id = '${recoveryOrderId}';`);
  assert(
    milestoneRecoveredRows[0].status === 'funded' &&
    attemptRecoveredRows[0].status === 'captured' &&
    attemptRecoveredRows[0].razorpay_payment_id === recoveryPaymentId,
    'Recovery',
    'Database state atomically updated: milestone is "funded" and attempt is "captured" with payment ID'
  );

  // Verify exactly 1 ledger row exists with operator recovery metadata
  const ledgerRecoveredRows = await queryRows(`
    SELECT count(*) as count, (array_agg(metadata))[1] as meta
    FROM public.payment_ledger
    WHERE milestone_id = '${milestone3Id}' AND event_type = 'escrow_funded';
  `);
  assert(
    Number(ledgerRecoveredRows[0].count) === 1 && JSON.stringify(ledgerRecoveredRows[0].meta).includes('operator_recovery'),
    'Recovery',
    'Exactly 1 ledger entry appended with source: "operator_recovery" and operator audit trail'
  );

  // 6d. Idempotent Re-Run: executing recovery again on already reconciled payment
  const idempotentRecoveryRes = await reconcileCapturedPayment(
    recoveryPaymentId,
    { operatorId: 'ops_engineer_test' },
    { razorpayClient: mockRazorpay, supabaseClient: mockSupabase }
  );
  assert(
    idempotentRecoveryRes.success === true && idempotentRecoveryRes.actionTaken === 'already_reconciled',
    'Recovery',
    'Repeated recovery invocation identifies already-reconciled state and exits cleanly'
  );

  const ledgerFinalRows = await queryRows(`
    SELECT count(*) as count FROM public.payment_ledger WHERE milestone_id = '${milestone3Id}' AND event_type = 'escrow_funded';
  `);
  assert(
    Number(ledgerFinalRows[0].count) === 1,
    'Recovery',
    'Ledger count remains strictly 1 after repeated recovery attempts (Exactly-Once invariant holds)'
  );

  // ==========================================================================
  // FINAL REPORT
  // ==========================================================================
  console.log('\n================================================================');
  console.log('                          TEST SUMMARY');
  console.log('================================================================');
  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`Total Assertions Passed: ${totalPassed} / ${results.length}`);

  if (totalPassed === results.length) {
    console.log('🎉 ALL GATEWAY HARDENING ASSERTIONS PASSED!\n');
    process.exit(0);
  } else {
    console.error(`❌ ${results.length - totalPassed} assertion(s) failed.\n`);
    process.exit(1);
  }
}

runGatewayHardeningTests().catch((err) => {
  console.error('Fatal Test Execution Error:', err);
  process.exit(1);
});
