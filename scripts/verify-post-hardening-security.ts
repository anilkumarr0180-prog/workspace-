import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

let passed = 0;
let failed = 0;

function assert(condition: boolean, category: string, description: string) {
  if (condition) {
    console.log(`  ✓ [${category}] ${description}`);
    passed++;
  } else {
    console.error(`  ✗ [${category}] ${description} — FAILED`);
    failed++;
  }
}

// Generate valid test JWTs signed with local JWT_SECRET using native crypto
function generateTestToken(userId: string, email: string, role = 'authenticated') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    aud: 'authenticated',
    role,
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const base64Url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const head = base64Url(header);
  const pay = base64Url(payload);
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${head}.${pay}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${head}.${pay}.${sig}`;
}

async function runPostHardeningSecuritySuite() {
  console.log('================================================================');
  console.log('  WORKSPACE — POST-HARDENING REAL LOCAL SUPABASE SECURITY AUDIT');
  console.log('================================================================\n');

  // 1. Initialize Clients
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });

  // 2. Setup Test Fixtures in Local Database
  console.log('--- 1. Setting up Test Fixtures in Local Database ---');
  const ts = Date.now();
  const { data: uA, error: uAErr } = await adminClient.auth.admin.createUser({
    email: `client_a_${ts}@test.local`,
    password: 'TestPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Client Alpha' },
  });
  if (uAErr || !uA?.user) throw new Error(`Failed to create clientA: ${uAErr?.message}`);

  const { data: uF, error: uFErr } = await adminClient.auth.admin.createUser({
    email: `freelancer_a_${ts}@test.local`,
    password: 'TestPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Freelancer Alpha' },
  });
  if (uFErr || !uF?.user) throw new Error(`Failed to create freelancerA: ${uFErr?.message}`);

  const { data: uB, error: uBErr } = await adminClient.auth.admin.createUser({
    email: `client_b_${ts}@test.local`,
    password: 'TestPassword123!',
    email_confirm: true,
    user_metadata: { full_name: 'Client Beta (Intruder)' },
  });
  if (uBErr || !uB?.user) throw new Error(`Failed to create clientB: ${uBErr?.message}`);

  const clientAId = uA.user.id;
  const freelancerAId = uF.user.id;
  const clientBId = uB.user.id;

  await adminClient.from('profiles').update({ can_hire: true, can_work: false, active_mode: 'client' }).eq('id', clientAId);
  await adminClient.from('profiles').update({ can_hire: false, can_work: true, active_mode: 'freelancer' }).eq('id', freelancerAId);
  await adminClient.from('profiles').update({ can_hire: true, can_work: false, active_mode: 'client' }).eq('id', clientBId);

  const clientAToken = generateTestToken(clientAId, uA.user.email!);
  const freelancerAToken = generateTestToken(freelancerAId, uF.user.email!);
  const clientBToken = generateTestToken(clientBId, uB.user.email!);

  const clientA = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${clientAToken}` } },
  });

  const freelancerA = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${freelancerAToken}` } },
  });

  const clientB = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${clientBToken}` } },
  });

  const contractId = 'c1111111-1111-4000-8000-111111111111';
  const jobId = 'b1111111-1111-4000-8000-111111111111';
  const proposalId = 'e1111111-1111-4000-8000-111111111111';

  // Fetch category
  const { data: cats } = await adminClient.from('categories').select('id').limit(1);
  const categoryId = cats?.[0]?.id;

  const { error: jErr } = await adminClient.from('jobs').upsert([
    {
      id: jobId,
      client_id: clientAId,
      category_id: categoryId,
      title: 'Full Stack Hourly App',
      description: 'Comprehensive detailed job description exceeding the minimum length requirement easily.',
      project_type: 'hourly',
      budget_min: 50,
      experience_level: 'expert',
      duration: '1_to_3_months',
      status: 'published',
    },
  ]);
  if (jErr) console.error('Jobs upsert error:', jErr);

  const { error: propErr } = await adminClient.from('proposals').upsert([
    {
      id: proposalId,
      job_id: jobId,
      freelancer_id: freelancerAId,
      bid_amount: 50,
      rate_type: 'hourly',
      cover_letter: 'Fifty character detailed cover letter to meet the minimum character constraint.',
      status: 'accepted',
    },
  ]);
  if (propErr) console.error('Proposals upsert error:', propErr);

  const { error: cErr } = await adminClient.from('contracts').upsert([
    {
      id: contractId,
      proposal_id: proposalId,
      job_id: jobId,
      client_id: clientAId,
      freelancer_id: freelancerAId,
      contract_type: 'hourly',
      title: 'Full Stack Hourly App',
      hourly_rate: 50,
      weekly_hour_limit: 40,
      status: 'active',
    },
  ]);
  if (cErr) console.error('Contracts upsert error:', cErr);

  const timesheetId = 'd1111111-1111-4000-8000-111111111111';
  const { error: tErr } = await adminClient.from('timesheets').upsert([
    {
      id: timesheetId,
      contract_id: contractId,
      client_id: clientAId,
      freelancer_id: freelancerAId,
      week_start_date: '2026-11-09',
      total_minutes: 600,
      total_amount: 500,
      status: 'open',
    },
  ]);
  if (tErr) console.error('Timesheets upsert error:', tErr);

  console.log('  ✓ Test contract and timesheet initialized.\n');

  // ============================================================================
  // 2. Negative Tests for Anonymous Role (Unauthenticated Callers)
  // ============================================================================
  console.log('--- 2. Anonymous Access Control Verification ---');

  // Test 1: Anonymous submit_timesheet
  const { error: anonSubmitErr } = await anonClient.rpc('submit_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    anonSubmitErr !== null && (anonSubmitErr.code === '42501' || anonSubmitErr.message.includes('Authentication required') || anonSubmitErr.message.includes('permission denied')),
    'AnonAccess',
    'Anonymous caller is strictly rejected from submit_timesheet'
  );

  // Test 2: Anonymous approve_timesheet
  const { error: anonApproveErr } = await anonClient.rpc('approve_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    anonApproveErr !== null && (anonApproveErr.code === '42501' || anonApproveErr.message.includes('Authentication required') || anonApproveErr.message.includes('permission denied')),
    'AnonAccess',
    'Anonymous caller is strictly rejected from approve_timesheet'
  );

  // Test 3: Anonymous dispute_timesheet
  const { error: anonDisputeErr } = await anonClient.rpc('dispute_timesheet', {
    p_timesheet_id: timesheetId,
    p_reason: 'Malicious anonymous dispute attempt',
  });
  assert(
    anonDisputeErr !== null && (anonDisputeErr.code === '42501' || anonDisputeErr.message.includes('Authentication required') || anonDisputeErr.message.includes('permission denied')),
    'AnonAccess',
    'Anonymous caller is strictly rejected from dispute_timesheet'
  );

  // Test 4: Anonymous fund_timesheet_with_payment
  const { error: anonFundErr } = await anonClient.rpc('fund_timesheet_with_payment', {
    p_timesheet_id: timesheetId,
    p_razorpay_payment_id: 'pay_anon_123',
    p_razorpay_order_id: 'order_anon_123',
    p_razorpay_signature: 'sig_anon_123',
    p_amount_subunits: 50000,
    p_currency: 'INR',
  });
  assert(
    anonFundErr !== null && (anonFundErr.code === '42501' || anonFundErr.message.includes('restricted to service_role') || anonFundErr.message.includes('permission denied')),
    'AnonAccess',
    'Anonymous caller is strictly rejected from fund_timesheet_with_payment'
  );

  // Test 5: Anonymous get_payment_attempt_for_timesheet
  const { error: anonGetAttemptErr } = await anonClient.rpc('get_payment_attempt_for_timesheet', {
    p_timesheet_id: timesheetId,
    p_razorpay_order_id: 'order_fake_123',
  });
  assert(
    anonGetAttemptErr !== null && (anonGetAttemptErr.code === '42501' || anonGetAttemptErr.message.includes('Authentication required') || anonGetAttemptErr.message.includes('permission denied')),
    'AnonAccess',
    'Anonymous caller is strictly rejected from get_payment_attempt_for_timesheet'
  );

  // ============================================================================
  // 3. User Authorization & Cross-Tenant Isolation Tests
  // ============================================================================
  console.log('\n--- 3. Authenticated Role Isolation & Least Privilege ---');

  // Test 6: Client A cannot submit the freelancer's timesheet
  const { error: clientSubmitErr } = await clientA.rpc('submit_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    clientSubmitErr !== null && clientSubmitErr.message.includes('Only the assigned freelancer can submit'),
    'RoleIsolation',
    'Client A is rejected from submitting freelancer timesheet'
  );

  // Test 7: Client B (intruder) cannot submit Freelancer A's timesheet
  const { error: clientBSubmitErr } = await clientB.rpc('submit_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    clientBSubmitErr !== null && clientBSubmitErr.message.includes('Only the assigned freelancer can submit'),
    'RoleIsolation',
    'Third-party Client B is rejected from submitting Freelancer A timesheet'
  );

  // Test 8: Freelancer A legitimately submits their timesheet
  const { data: submittedData, error: freelancerSubmitErr } = await freelancerA.rpc('submit_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    freelancerSubmitErr === null && submittedData?.status === 'submitted',
    'Workflow',
    'Freelancer A successfully submits their own open timesheet'
  );

  // Test 9: Freelancer A CANNOT approve their own timesheet (self-approval blocked)
  const { error: freelancerApproveErr } = await freelancerA.rpc('approve_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    freelancerApproveErr !== null && (freelancerApproveErr.message.includes('Freelancers cannot approve') || freelancerApproveErr.message.includes('Only the client can approve')),
    'FraudPrevention',
    'Freelancer A is strictly blocked from approving their own timesheet'
  );

  // Test 10: Client B (intruder) CANNOT approve Client A's timesheet
  const { error: clientBApproveErr } = await clientB.rpc('approve_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    clientBApproveErr !== null && clientBApproveErr.message.includes('Only the client can approve this timesheet'),
    'CrossTenant',
    'Unauthorized Client B cannot approve Client A timesheet'
  );

  // Test 11: Client B cannot dispute Client A's timesheet
  const { error: clientBDisputeErr } = await clientB.rpc('dispute_timesheet', {
    p_timesheet_id: timesheetId,
    p_reason: 'Fraudulent dispute attempt by non-owner client',
  });
  assert(
    clientBDisputeErr !== null && clientBDisputeErr.message.includes('Only the client can dispute this timesheet'),
    'CrossTenant',
    'Unauthorized Client B cannot dispute Client A timesheet'
  );

  // Test 12: Client A legitimately approves the timesheet
  const { data: approvedData, error: clientAApproveErr } = await clientA.rpc('approve_timesheet', {
    p_timesheet_id: timesheetId,
  });
  assert(
    clientAApproveErr === null && approvedData?.status === 'approved',
    'Workflow',
    'Client A successfully approves Freelancer A submitted timesheet'
  );

  // ============================================================================
  // 4. Payment Attempt Recording & Gateway Isolation
  // ============================================================================
  console.log('\n--- 4. Payment Attempt Recording & Disclosure Protection ---');

  const razorpayOrderId = 'order_test_verified_123';

  // Test 13: Client B cannot record payment attempt for Client A's timesheet
  const { error: clientBRecordErr } = await clientB.rpc('record_timesheet_payment_attempt', {
    p_contract_id: contractId,
    p_timesheet_id: timesheetId,
    p_client_id: clientBId,
    p_amount: 500,
    p_amount_subunits: 50000,
    p_currency: 'INR',
    p_razorpay_order_id: razorpayOrderId,
  });
  assert(
    clientBRecordErr !== null && clientBRecordErr.message.includes('Only the client can record payment attempts'),
    'CrossTenant',
    'Unauthorized Client B cannot record payment attempt for Client A contract'
  );

  // Test 14: Client A cannot record mismatched amount
  const { error: amountMismatchErr } = await clientA.rpc('record_timesheet_payment_attempt', {
    p_contract_id: contractId,
    p_timesheet_id: timesheetId,
    p_client_id: clientAId,
    p_amount: 1, // Fraudulent 1 rupee attempt
    p_amount_subunits: 100,
    p_currency: 'INR',
    p_razorpay_order_id: razorpayOrderId,
  });
  assert(
    amountMismatchErr !== null && amountMismatchErr.message.includes('does not match timesheet amount'),
    'AmountIntegrity',
    'Payment attempt fails closed when amount does not match timesheet amount'
  );

  // Test 15: Client A legitimately records valid payment attempt
  const { data: attemptData, error: clientARecordErr } = await clientA.rpc('record_timesheet_payment_attempt', {
    p_contract_id: contractId,
    p_timesheet_id: timesheetId,
    p_client_id: clientAId,
    p_amount: 500,
    p_amount_subunits: 50000,
    p_currency: 'INR',
    p_razorpay_order_id: razorpayOrderId,
  });
  assert(
    clientARecordErr === null && attemptData?.status === 'created' && attemptData?.razorpay_order_id === razorpayOrderId,
    'Workflow',
    'Client A successfully records valid payment attempt'
  );

  // Test 16: Client B CANNOT view Client A payment attempt (anti-disclosure check)
  const { error: clientBViewAttemptErr } = await clientB.rpc('get_payment_attempt_for_timesheet', {
    p_timesheet_id: timesheetId,
    p_razorpay_order_id: razorpayOrderId,
  });
  assert(
    clientBViewAttemptErr !== null && clientBViewAttemptErr.message.includes('Not authorized to view this payment attempt'),
    'AntiDisclosure',
    'Unauthorized Client B cannot view Client A payment attempt details'
  );

  // Test 17: Client A can legitimately view their own payment attempt
  const { data: viewAttemptData, error: clientAViewAttemptErr } = await clientA.rpc('get_payment_attempt_for_timesheet', {
    p_timesheet_id: timesheetId,
    p_razorpay_order_id: razorpayOrderId,
  });
  assert(
    clientAViewAttemptErr === null && viewAttemptData?.razorpay_order_id === razorpayOrderId,
    'Workflow',
    'Client A successfully retrieves authoritative payment attempt'
  );

  // ============================================================================
  // 5. Privileged Financial Settlement Execution
  // ============================================================================
  console.log('\n--- 5. Privileged Settlement & Database Mutation Boundaries ---');

  // Test 18: Authenticated Client A CANNOT invoke fund_timesheet_with_payment directly
  const { error: clientFundErr } = await clientA.rpc('fund_timesheet_with_payment', {
    p_timesheet_id: timesheetId,
    p_razorpay_payment_id: 'pay_spoofed_123',
    p_razorpay_order_id: razorpayOrderId,
    p_razorpay_signature: 'sig_spoofed_123',
    p_amount_subunits: 50000,
    p_currency: 'INR',
  });
  assert(
    clientFundErr !== null && (clientFundErr.code === '42501' || clientFundErr.message.includes('restricted to service_role') || clientFundErr.message.includes('permission denied')),
    'PrivilegeBoundary',
    'Authenticated client cannot directly invoke fund_timesheet_with_payment'
  );

  // Test 19: Authenticated Client A CANNOT invoke confirm_payout_transfer_completion directly
  const { error: clientConfirmErr } = await clientA.rpc('confirm_payout_transfer_completion', {
    p_transfer_id: '00000000-0000-0000-0000-000000000000',
  });
  assert(
    clientConfirmErr !== null && (clientConfirmErr.code === '42501' || clientConfirmErr.message.includes('restricted to service_role') || clientConfirmErr.message.includes('permission denied')),
    'PrivilegeBoundary',
    'Authenticated client cannot directly invoke confirm_payout_transfer_completion'
  );

  // Test 20: Authenticated Client A CANNOT directly mutate freelancer_payout_profiles table
  const { error: directProfileInsertErr } = await clientA.from('freelancer_payout_profiles').insert([
    {
      user_id: clientAId,
      provider: 'mock_route',
      provider_account_id: 'acc_hacked',
      account_status: 'activated',
      legal_name: 'Hacker',
      payout_eligible: true,
    },
  ]);
  assert(
    directProfileInsertErr !== null,
    'PrivilegeBoundary',
    'Authenticated user cannot directly INSERT into freelancer_payout_profiles (mutations revoked)'
  );

  // Test 21: Service role legitimately funds timesheet
  const { data: fundedTimesheet, error: serviceRoleFundErr } = await adminClient.rpc('fund_timesheet_with_payment', {
    p_timesheet_id: timesheetId,
    p_razorpay_payment_id: 'pay_real_service_123',
    p_razorpay_order_id: razorpayOrderId,
    p_razorpay_signature: 'sig_real_service_123',
    p_amount_subunits: 50000,
    p_currency: 'INR',
  });
  assert(
    serviceRoleFundErr === null && fundedTimesheet?.status === 'paid',
    'ServiceRole',
    'Legitimate service_role successfully funds timesheet after verification'
  );

  // Clean up test records
  await adminClient.from('payment_ledger').delete().eq('timesheet_id', timesheetId);
  await adminClient.from('payment_attempts').delete().eq('timesheet_id', timesheetId);
  await adminClient.from('timesheets').delete().eq('id', timesheetId);
  await adminClient.from('contracts').delete().eq('id', contractId);
  await adminClient.from('proposals').delete().eq('id', proposalId);
  await adminClient.from('jobs').delete().eq('id', jobId);
  await adminClient.from('profiles').delete().in('id', [clientAId, freelancerAId, clientBId]);
  await adminClient.auth.admin.deleteUser(clientAId);
  await adminClient.auth.admin.deleteUser(freelancerAId);
  await adminClient.auth.admin.deleteUser(clientBId);

  console.log('\n================================================================');
  console.log(`  POST-HARDENING AUDIT SUMMARY: ${passed} / ${passed + failed} PASSED`);
  if (failed === 0) {
    console.log('  SUCCESS: All real local Supabase security assertions passed!');
  } else {
    console.log(`  FAILURE: ${failed} assertions failed!`);
  }
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runPostHardeningSecuritySuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
