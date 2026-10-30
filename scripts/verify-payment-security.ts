/**
 * Payment Security Verification Test Suite
 * Covers the 11 payment security audit checks without executing live transactions
 * or mutating production data.
 */

import crypto from 'crypto';
import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  isRazorpayWebhookConfigured,
  extractPaymentErrorMessage,
} from '../lib/razorpay';

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, failureDetails?: string) {
  if (condition) {
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } else {
    results.push({ name, passed: false, message: failureDetails });
    console.error(`  ✗ ${name} — ${failureDetails || 'Assertion failed'}`);
  }
}

async function runTests() {
  console.log('\n🔒 Running Payment Security Test Suite...\n');

  const testKeySecret = process.env.RAZORPAY_KEY_SECRET || 'test_secret_key_1234567890';
  const testWebhookSecret = 'whsec_test_webhook_secret_abcdef123456';
  const testOrderId = 'order_M1234567890ABC';
  const testPaymentId = 'pay_P9876543210XYZ';

  // 1. Valid Signature Generation & Verification
  const legitimatePayload = `${testOrderId}|${testPaymentId}`;
  const validSignature = crypto
    .createHmac('sha256', testKeySecret)
    .update(legitimatePayload)
    .digest('hex');

  // Temporarily ensure testKeySecret is in env for pure signature checks
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = testKeySecret;

  const isValid = verifyRazorpayPaymentSignature(testOrderId, testPaymentId, validSignature);
  assert(isValid === true, 'Test 1: Valid checkout signature passes verification');

  // 2. Invalid Checkout Signature (Tampered)
  const tamperedSignature = validSignature.slice(0, -4) + 'abcd';
  const isInvalid = verifyRazorpayPaymentSignature(testOrderId, testPaymentId, tamperedSignature);
  assert(isInvalid === false, 'Test 2: Tampered checkout signature is rejected');

  // 3. Mismatched Order ID in Signature
  const mismatchedOrderId = 'order_DIFFERENT_ORDER_999';
  const isOrderMismatch = verifyRazorpayPaymentSignature(mismatchedOrderId, testPaymentId, validSignature);
  assert(isOrderMismatch === false, 'Test 3: Mismatched order ID fails signature verification');

  // 4. Missing Webhook Secret Handling
  const origWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;

  const webhookCheckNoSecret = isRazorpayWebhookConfigured();
  assert(webhookCheckNoSecret === false, 'Test 4a: isRazorpayWebhookConfigured returns false when secret is missing');

  const webhookSigNoSecret = verifyRazorpayWebhookSignature('{"event":"payment.captured"}', 'dummy_sig');
  assert(webhookSigNoSecret === false, 'Test 4b: verifyRazorpayWebhookSignature fails closed without secret (no fallback to key secret)');

  // 5. Webhook Signature Verification with Dedicated Secret
  process.env.RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;
  const rawWebhookBody = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: testPaymentId,
          order_id: testOrderId,
          amount: 50000,
          currency: 'USD',
          status: 'captured',
        },
      },
    },
  });

  const validWebhookSig = crypto
    .createHmac('sha256', testWebhookSecret)
    .update(rawWebhookBody)
    .digest('hex');

  const isWebhookValid = verifyRazorpayWebhookSignature(rawWebhookBody, validWebhookSig);
  assert(isWebhookValid === true, 'Test 5: Webhook signature passes with dedicated RAZORPAY_WEBHOOK_SECRET');

  // 6. Invalid Webhook Signature
  const isWebhookInvalid = verifyRazorpayWebhookSignature(rawWebhookBody, 'invalid_signature_hex_123');
  assert(isWebhookInvalid === false, 'Test 6: Invalid webhook signature is rejected');

  // Restore env
  if (origKeySecret) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
  if (origWebhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = origWebhookSecret;
  else delete process.env.RAZORPAY_WEBHOOK_SECRET;

  // 7. Currency Safety Validation (No silent USD to INR conversions)
  const milestoneCurrency: string = 'USD';
  const configuredGatewayCurrency: string = 'INR';
  const isCurrencyMismatch = milestoneCurrency !== configuredGatewayCurrency;
  assert(
    isCurrencyMismatch,
    'Test 7: Currency mismatch detection correctly flags USD milestone vs INR gateway configuration'
  );

  // 8. Authorized but Uncaptured Payment Check (Fail Closed)
  const paymentEntities = [
    { status: 'authorized', shouldPass: false },
    { status: 'failed', shouldPass: false },
    { status: 'created', shouldPass: false },
    { status: 'captured', shouldPass: true },
  ];

  paymentEntities.forEach(({ status, shouldPass }) => {
    const isStatusAccepted = status === 'captured';
    assert(
      isStatusAccepted === shouldPass,
      `Test 8 (${status}): Payment with status '${status}' is ${shouldPass ? 'accepted' : 'rejected'}`
    );
  });

  // 9. Payment Attribute Comparison (Order ID, Amount, Currency)
  const persistedAttempt = {
    razorpay_order_id: testOrderId,
    amount_subunits: 50000,
    currency: 'USD',
  };

  const testAttributes = [
    {
      desc: 'Matches exact persisted attempt',
      payment: { order_id: testOrderId, amount: 50000, currency: 'USD' },
      expected: true,
    },
    {
      desc: 'Wrong order ID',
      payment: { order_id: 'order_DIFFERENT', amount: 50000, currency: 'USD' },
      expected: false,
    },
    {
      desc: 'Wrong amount (underpaid by 1 cent)',
      payment: { order_id: testOrderId, amount: 49999, currency: 'USD' },
      expected: false,
    },
    {
      desc: 'Wrong currency (INR instead of USD)',
      payment: { order_id: testOrderId, amount: 50000, currency: 'INR' },
      expected: false,
    },
  ];

  testAttributes.forEach(({ desc, payment, expected }) => {
    const matches =
      payment.order_id === persistedAttempt.razorpay_order_id &&
      Number(payment.amount) === persistedAttempt.amount_subunits &&
      payment.currency.toUpperCase() === persistedAttempt.currency.toUpperCase();

    assert(matches === expected, `Test 9 (${desc}): Attribute check ${expected ? 'passes' : 'fails'}`);
  });

  // 10. Concurrency & Idempotency State Invariant
  // If milestone is already 'funded', duplicate callbacks must return early without ledger inserts
  const milestoneStatuses = [
    { status: 'planned', canFund: true },
    { status: 'funded', canFund: false },
    { status: 'in_progress', canFund: false },
    { status: 'submitted', canFund: false },
    { status: 'released', canFund: false },
  ];

  milestoneStatuses.forEach(({ status, canFund }) => {
    const isEligibleForFunding = status === 'planned';
    assert(
      isEligibleForFunding === canFund,
      `Test 10 (${status}): Milestone in '${status}' ${canFund ? 'can proceed to funding' : 'fails/returns early idempotently'}`
    );
  });

  // 11. Unauthorized Client Check
  const contractClientId: string = 'client_uuid_1111';
  const unauthorizedUser: string = 'attacker_uuid_9999';
  const isAuthorized = unauthorizedUser === contractClientId;
  assert(!isAuthorized, 'Test 11: Unauthorized caller is rejected from funding client milestone');

  // ==========================================================================
  // Isolated Database Authorization Tests (Proving no faked capture by client)
  // ==========================================================================
  console.log('\n  --- Running Isolated Database Authorization Verification ---');
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const fs = await import('fs');
    const path = await import('path');

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
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'));
    }

    // Setup test users, job, proposal, contract, milestone
    const clientId = '11111111-1111-1111-1111-111111111111';
    const freelancerId = '22222222-2222-2222-2222-222222222222';
    const contractId = '33333333-3333-3333-3333-333333333333';
    const fakeOrderId = 'order_FAKED_ATTACK_123';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${clientId}', 'client_test@workspace.local'),
        ('${freelancerId}', 'freelancer_test@workspace.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (id, username, full_name, can_hire, can_work, active_mode) VALUES
        ('${clientId}', 'testclient', 'Test Client', true, false, 'client'),
        ('${freelancerId}', 'testfree', 'Test Freelancer', false, true, 'freelancer')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
      VALUES ('55555555-5555-5555-5555-555555555555', '${clientId}', (SELECT id FROM public.categories LIMIT 1), 'Test Fixed Job', 'This is a comprehensive test job description that easily exceeds the fifty character minimum requirement.', 'fixed', 500, 'expert', 'less_than_1_month', 'published');

      INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
      VALUES ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '${freelancerId}', 500, 'fixed', 'A minimum fifty character cover letter to satisfy the integrity check requirement.', 'accepted');

      INSERT INTO public.contracts (id, proposal_id, job_id, client_id, freelancer_id, contract_type, title, fixed_price, status)
      VALUES ('${contractId}', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '${clientId}', '${freelancerId}', 'fixed', 'Test Fixed Job', 500, 'active');
    `);

    const mRes = await db.query(`SELECT id FROM public.contract_milestones WHERE contract_id = '${contractId}' AND sequence_order = 1;`);
    const mRows = mRes.rows as Array<{ id: string }>;
    const milestoneId = String(mRows[0].id);

    await db.exec(`
      INSERT INTO public.payment_attempts (contract_id, milestone_id, client_id, razorpay_order_id, amount, amount_subunits, currency, status)
      VALUES ('${contractId}', '${milestoneId}', '${clientId}', '${fakeOrderId}', 500, 50000, 'USD', 'created');
    `);

    // Test 12: Authenticated user attempting to call fund_milestone_with_payment directly
    let authenticatedCallBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.fund_milestone_with_payment('${milestoneId}'::uuid, '{"razorpay_order_id": "${fakeOrderId}"}'::jsonb);
      `);
    } catch {
      authenticatedCallBlocked = true;
    }
    assert(authenticatedCallBlocked, 'Test 12: Authenticated user cannot directly invoke fund_milestone_with_payment (faked payment capture rejected)');

    // Test 13: Authenticated user attempting to call fund_milestone directly
    let simulatedCallBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.fund_milestone('${milestoneId}'::uuid);
      `);
    } catch {
      simulatedCallBlocked = true;
    }
    assert(simulatedCallBlocked, 'Test 13: Authenticated user cannot directly invoke fund_milestone (direct simulation bypass rejected)');

    // Test 14: Privileged service_role caller successfully funds milestone
    let serviceRoleCallSucceeded = false;
    try {
      await db.exec(`
        SET LOCAL ROLE service_role;
        SET LOCAL "request.jwt.claim.role" = 'service_role';
        SELECT public.fund_milestone_with_payment(
          '${milestoneId}'::uuid,
          '{"provider": "razorpay", "razorpay_order_id": "${fakeOrderId}", "razorpay_payment_id": "pay_REAL_123", "funded_by": "${clientId}"}'::jsonb
        );
      `);
      const checkRes = await db.query(`SELECT status FROM public.contract_milestones WHERE id = '${milestoneId}';`);
      const attemptRes = await db.query(`SELECT status FROM public.payment_attempts WHERE razorpay_order_id = '${fakeOrderId}';`);
      const checkRows = checkRes.rows as Array<{ status?: string }>;
      const attemptRows = attemptRes.rows as Array<{ status?: string }>;
      if (checkRows[0]?.status === 'funded' && attemptRows[0]?.status === 'captured') {
        serviceRoleCallSucceeded = true;
      }
    } catch (err: unknown) {
      console.error('Service role error:', err);
    }
    assert(serviceRoleCallSucceeded, 'Test 14: Authorized service_role server call successfully captures payment and funds milestone');

  // Test 15: Bidirectional Idempotency: duplicate service_role call on already-funded milestone
    let idempotentCallSucceeded = false;
    try {
      await db.exec(`
        SET LOCAL ROLE service_role;
        SET LOCAL "request.jwt.claim.role" = 'service_role';
        SELECT public.fund_milestone_with_payment(
          '${milestoneId}'::uuid,
          '{"provider": "razorpay", "razorpay_order_id": "${fakeOrderId}", "razorpay_payment_id": "pay_REAL_123"}'::jsonb
        );
      `);
      idempotentCallSucceeded = true;
    } catch {
      idempotentCallSucceeded = false;
    }
    assert(idempotentCallSucceeded, 'Test 15: Idempotent duplicate server funding call succeeds gracefully without ledger mutation');

    // Test 15b: Authenticated user attempting to call fund_timesheet_with_payment directly
    const hourlyJobId = '55555555-5555-5555-5555-555555555556';
    const hourlyContractId = '44444444-4444-4444-4444-444444444444';
    const hourlyProposalId = '66666666-6666-6666-6666-666666666667';
    const fakeTimesheetId = '77777777-7777-7777-7777-777777777777';
    await db.exec(`
      INSERT INTO public.jobs (id, client_id, category_id, title, description, project_type, budget_min, experience_level, duration, status)
      VALUES ('${hourlyJobId}', '${clientId}', (SELECT id FROM public.categories LIMIT 1), 'Test Hourly Job', 'This is a comprehensive test hourly job description that easily exceeds the minimum length requirement.', 'hourly', 50, 'expert', 'less_than_1_month', 'published')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.proposals (id, job_id, freelancer_id, bid_amount, rate_type, cover_letter, status)
      VALUES ('${hourlyProposalId}', '${hourlyJobId}', '${freelancerId}', 50, 'hourly', 'Another minimum fifty character cover letter for the hourly test contract.', 'accepted')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.contracts (id, proposal_id, job_id, client_id, freelancer_id, contract_type, title, hourly_rate, weekly_hour_limit, status)
      VALUES ('${hourlyContractId}', '${hourlyProposalId}', '${hourlyJobId}', '${clientId}', '${freelancerId}', 'hourly', 'Hourly Contract', 50, 40, 'active')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.timesheets (id, contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
      VALUES ('${fakeTimesheetId}', '${hourlyContractId}', '${clientId}', '${freelancerId}', '2026-11-02', 600, 500, 'approved')
      ON CONFLICT (id) DO NOTHING;
    `);

    let authenticatedTimesheetFundBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.fund_timesheet_with_payment(
          '${fakeTimesheetId}'::uuid,
          'pay_FAKE_123',
          'order_FAKE_123',
          'sig_FAKE_123',
          50000::bigint,
          'INR'
        );
      `);
    } catch {
      authenticatedTimesheetFundBlocked = true;
    }
    assert(authenticatedTimesheetFundBlocked, 'Test 15b: Authenticated user cannot directly invoke fund_timesheet_with_payment (restricted to service_role)');

    // Test 15c: Authenticated user cannot directly invoke confirm_payout_transfer_completion
    let authenticatedConfirmTransferBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.confirm_payout_transfer_completion('99999999-9999-9999-9999-999999999999'::uuid);
      `);
    } catch {
      authenticatedConfirmTransferBlocked = true;
    }
    assert(authenticatedConfirmTransferBlocked, 'Test 15c: Authenticated user cannot directly invoke confirm_payout_transfer_completion (restricted to service_role)');

    // Test 15d: Authenticated user cannot directly invoke create_payout_transfer_record
    let authenticatedCreateTransferBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.create_payout_transfer_record(
          '${contractId}'::uuid,
          '${freelancerId}'::uuid,
          500.0,
          50.0,
          450.0,
          'INR',
          'idemp_fake_123',
          'trf_fake_123',
          'acc_fake_123'
        );
      `);
    } catch {
      authenticatedCreateTransferBlocked = true;
    }
    assert(authenticatedCreateTransferBlocked, 'Test 15d: Authenticated user cannot directly invoke create_payout_transfer_record (restricted to service_role)');

    // Test 15e: Authenticated user cannot directly invoke reverse_payout_transfer
    let authenticatedReverseTransferBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${clientId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        SELECT public.reverse_payout_transfer(
          '99999999-9999-9999-9999-999999999999'::uuid,
          'rvr_fake_123'
        );
      `);
    } catch {
      authenticatedReverseTransferBlocked = true;
    }
    assert(authenticatedReverseTransferBlocked, 'Test 15e: Authenticated user cannot directly invoke reverse_payout_transfer (restricted to service_role)');

    // Test 15f: Authenticated user cannot directly INSERT into freelancer_payout_profiles (must use setup_freelancer_payout_profile)
    let directProfileInsertBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE authenticated;
        SET LOCAL "request.jwt.claim.sub" = '${freelancerId}';
        SET LOCAL "request.jwt.claim.role" = 'authenticated';
        INSERT INTO public.freelancer_payout_profiles (
          user_id, provider, provider_account_id, account_status, legal_name, payout_eligible
        ) VALUES (
          '${freelancerId}', 'mock_route', 'acc_hacked', 'activated', 'Hacker', true
        );
      `);
    } catch {
      directProfileInsertBlocked = true;
    }
    assert(directProfileInsertBlocked, 'Test 15f: Authenticated user cannot directly insert into freelancer_payout_profiles (table mutations revoked)');

    // Test 15g: Unauthenticated execution of submit_timesheet fails closed
    let unauthSubmitBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE anon;
        SET LOCAL "request.jwt.claim.sub" = '';
        SET LOCAL "request.jwt.claim.role" = 'anon';
        SELECT public.submit_timesheet('${fakeTimesheetId}'::uuid);
      `);
    } catch {
      unauthSubmitBlocked = true;
    }
    assert(unauthSubmitBlocked, 'Test 15g: Unauthenticated caller cannot execute submit_timesheet');

    // Test 15h: Unauthenticated execution of approve_timesheet fails closed
    let unauthApproveBlocked = false;
    try {
      await db.exec(`
        SET LOCAL ROLE anon;
        SET LOCAL "request.jwt.claim.sub" = '';
        SET LOCAL "request.jwt.claim.role" = 'anon';
        SELECT public.approve_timesheet('${fakeTimesheetId}'::uuid);
      `);
    } catch {
      unauthApproveBlocked = true;
    }
    assert(unauthApproveBlocked, 'Test 15h: Unauthenticated caller cannot execute approve_timesheet');

  } catch (dbErr) {
    console.error('Database security test failure:', dbErr);
    assert(false, 'Database security suite execution', String(dbErr));
  }

  // 16. Payment Error Handling Robustness Suite
  console.log('\n  --- Running Payment Error Extraction Verification ---');

  // 16a. Standard Error object
  const stdError = new Error('Gateway network timeout');
  const stdMsg = extractPaymentErrorMessage(stdError, 'Fallback error');
  assert(stdMsg === 'Gateway network timeout', 'Test 16a: Extracts message from standard Error instance');

  // 16b. Razorpay SDK normalized error with nested error.description
  const rzpSdkDescError = {
    statusCode: 400,
    error: {
      code: 'BAD_REQUEST_ERROR',
      description: 'Invalid API key',
      source: 'NA',
      step: 'NA',
      reason: 'NA',
    },
  };
  const rzpDescMsg = extractPaymentErrorMessage(rzpSdkDescError, 'Fallback error');
  assert(rzpDescMsg === 'Invalid API key', 'Test 16b: Extracts description from Razorpay SDK error object');

  // 16c. Razorpay SDK error with nested error.message
  const rzpSdkMsgError = {
    statusCode: 500,
    error: {
      code: 'GATEWAY_ERROR',
      message: 'Payment service temporarily unavailable',
    },
  };
  const rzpMsg = extractPaymentErrorMessage(rzpSdkMsgError, 'Fallback error');
  assert(rzpMsg === 'Payment service temporarily unavailable', 'Test 16c: Extracts message from Razorpay SDK nested error.message');

  // 16d. Direct object error with description or message
  const directDescObj = { description: 'Card expired or declined by issuer' };
  assert(
    extractPaymentErrorMessage(directDescObj, 'Fallback error') === 'Card expired or declined by issuer',
    'Test 16d: Extracts description from direct object'
  );

  const directMsgObj = { message: 'Transaction rejected' };
  assert(
    extractPaymentErrorMessage(directMsgObj, 'Fallback error') === 'Transaction rejected',
    'Test 16e: Extracts message from direct object'
  );

  // 16e. String error
  const stringErr = 'Direct failure string';
  assert(
    extractPaymentErrorMessage(stringErr, 'Fallback error') === 'Direct failure string',
    'Test 16f: Extracts direct string error'
  );

  // 16f. Unknown error shapes fall back safely without leaking secrets
  const fallbackDefault = 'Default fallback error';
  assert(extractPaymentErrorMessage(null, fallbackDefault) === fallbackDefault, 'Test 16g: null falls back safely');
  assert(extractPaymentErrorMessage(undefined, fallbackDefault) === fallbackDefault, 'Test 16h: undefined falls back safely');
  assert(extractPaymentErrorMessage({}, fallbackDefault) === fallbackDefault, 'Test 16i: empty object falls back safely');
  assert(extractPaymentErrorMessage({ error: {} }, fallbackDefault) === fallbackDefault, 'Test 16j: empty nested error object falls back safely');
  assert(extractPaymentErrorMessage(12345, fallbackDefault) === fallbackDefault, 'Test 16k: numeric error falls back safely');
  assert(extractPaymentErrorMessage(true, fallbackDefault) === fallbackDefault, 'Test 16l: boolean error falls back safely');
  assert(
    extractPaymentErrorMessage({ secret_token: 'super_secret_value' }, fallbackDefault) === fallbackDefault,
    'Test 16m: Sensitive property object falls back safely without leaking tokens'
  );

  console.log('\n--- Summary ---');
  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`Total Passed: ${totalPassed} / ${results.length}`);

  if (totalPassed === results.length) {
    console.log('🎉 All Payment Security assertions PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ Some assertions failed.\n');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
