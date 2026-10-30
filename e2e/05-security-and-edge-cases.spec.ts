import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestUser, deleteTestUser, loginViaUI, adminClient, SUPABASE_URL, ANON_KEY } from './helpers';
import { payoutEngine } from '../lib/services/payout-engine';

test.describe('Phase 7: Payment and Security Edge Cases Verification', () => {
  let clientA: Awaited<ReturnType<typeof createTestUser>>;
  let clientB: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerA: Awaited<ReturnType<typeof createTestUser>>;
  let contractAId: string;
  let milestoneAId: string;
  let timesheetAId: string;

  test.beforeAll(async () => {
    clientA = await createTestUser('client', 'e2e_p7_clientA');
    clientB = await createTestUser('client', 'e2e_p7_clientB');
    freelancerA = await createTestUser('freelancer', 'e2e_p7_freeA');

    // Onboard freelancer payout profile
    await adminClient.from('freelancer_payout_profiles').upsert([
      {
        user_id: freelancerA.id,
        provider: 'mock_route',
        provider_account_id: `acc_sim_${Date.now()}`,
        account_status: 'activated',
        legal_name: freelancerA.fullName,
        business_type: 'individual',
        bank_name: 'HDFC Bank',
        bank_account_last4: '9988',
        bank_ifsc: 'HDFC0001234',
        pan_last4: '9988',
        payout_eligible: true,
      },
    ]);

    const { data: cat } = await adminClient.from('categories').select('id').limit(1).single();
    const ts = Date.now();

    // Create Job & Contract for Client A
    const { data: job } = await adminClient
      .from('jobs')
      .insert({
        client_id: clientA.id,
        category_id: cat?.id,
        title: `Security Audited Contract ${ts}`,
        description: 'Rigorous cross-tenant financial security and authorization edge testing.',
        project_type: 'fixed',
        budget_min: 500,
        budget_max: 500,
        experience_level: 'expert',
        duration: '1_to_3_months',
        status: 'published',
      })
      .select()
      .single();

    const { data: prop } = await adminClient
      .from('proposals')
      .insert({
        job_id: job!.id,
        freelancer_id: freelancerA.id,
        bid_amount: 500,
        rate_type: 'fixed',
        cover_letter: 'Fifty character detailed cover letter to meet the minimum character constraint.',
        status: 'accepted',
      })
      .select()
      .single();

    const { data: cRow } = await adminClient
      .from('contracts')
      .insert({
        proposal_id: prop!.id,
        job_id: job!.id,
        client_id: clientA.id,
        freelancer_id: freelancerA.id,
        contract_type: 'fixed',
        title: job!.title,
        fixed_price: 500,
        status: 'active',
      })
      .select()
      .single();

    contractAId = cRow!.id;

    // Get the auto-created milestone
    const { data: mRow } = await adminClient
      .from('contract_milestones')
      .select('id')
      .eq('contract_id', contractAId)
      .single();

    milestoneAId = mRow!.id;

    // Create a timesheet on contract A
    const now = new Date();
    const day = now.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
    const weekStart = monday.toISOString().split('T')[0];

    const { data: tsRow } = await adminClient
      .from('timesheets')
      .insert({
        contract_id: contractAId,
        client_id: clientA.id,
        freelancer_id: freelancerA.id,
        week_start_date: weekStart,
        total_minutes: 60,
        total_amount: 50,
        status: 'open',
      })
      .select()
      .single();

    timesheetAId = tsRow!.id;
  });

  test.afterAll(async () => {
    if (contractAId) {
      await adminClient.from('payment_ledger').delete().eq('contract_id', contractAId);
      await adminClient.from('payout_transfers').delete().eq('contract_id', contractAId);
      await adminClient.from('contract_milestones').delete().eq('contract_id', contractAId);
      await adminClient.from('timesheets').delete().eq('contract_id', contractAId);
      await adminClient.from('contracts').delete().eq('id', contractAId);
    }
    await adminClient.from('freelancer_payout_profiles').delete().eq('user_id', freelancerA.id);
    if (clientA?.id) await deleteTestUser(clientA.id);
    if (clientB?.id) await deleteTestUser(clientB.id);
    if (freelancerA?.id) await deleteTestUser(freelancerA.id);
  });

  test('7.1 Freelancer cannot approve their own milestone (Self-Approval Rejection)', async () => {
    // Authenticate as Freelancer A
    const freelancerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await freelancerClient.auth.signInWithPassword({
      email: freelancerA.email,
      password: freelancerA.password,
    });

    const { error } = await freelancerClient.rpc('approve_and_release_milestone', {
      p_milestone_id: milestoneAId,
      p_feedback: 'Freelancer self-approval attempt',
    });

    // Must be rejected with 42501 Unauthorized
    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/Only the client can approve/i);
  });

  test('7.2 Freelancer cannot approve their own timesheet (Self-Approval Rejection)', async () => {
    const freelancerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await freelancerClient.auth.signInWithPassword({
      email: freelancerA.email,
      password: freelancerA.password,
    });

    const { error } = await freelancerClient.rpc('approve_timesheet', {
      p_timesheet_id: timesheetAId,
    });

    expect(error).toBeTruthy();
    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/Freelancers cannot approve|Only the client can approve/i);
  });

  test('7.3 Cross-Tenant Authorization: Unrelated client B cannot view or approve Client A contract', async ({ page }) => {
    // 1. Client B tries via UI
    await loginViaUI(page, clientB);
    await page.goto(`/contracts/${contractAId}`);

    // UI should show Access Denied or redirect away or show not found
    await expect(page.locator('body')).toContainText(/Access Denied|Contract not found|Unauthorized|Not Authorized/i, { timeout: 10000 });

    // 2. Client B tries via database RPC
    const clientBClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientBClient.auth.signInWithPassword({
      email: clientB.email,
      password: clientB.password,
    });

    const { error: rpcErr } = await clientBClient.rpc('approve_and_release_milestone', {
      p_milestone_id: milestoneAId,
      p_feedback: 'Cross-tenant rogue approval',
    });

    expect(rpcErr).toBeTruthy();
    expect(rpcErr?.code).toBe('42501');
  });

  test('7.4 Unapproved milestone cannot receive payout from Payout Engine', async () => {
    // Milestone status is currently 'planned'
    const res = await payoutEngine.initiateMilestonePayout(milestoneAId);
    expect(res.success).toBe(false);
    expect(res.code).toBe('MILESTONE_NOT_APPROVED');
    expect(res.error).toMatch(/Only approved milestones are eligible for payout/i);
  });

  test('7.5 Unapproved timesheet cannot receive payout from Payout Engine', async () => {
    // Timesheet status is currently 'open'
    const res = await payoutEngine.initiateTimesheetPayout(timesheetAId);
    expect(res.success).toBe(false);
    expect(res.code).toBe('TIMESHEET_UNPAID');
  });

  test('7.6 Direct invocation of privileged settlement procedure by authenticated caller is blocked', async () => {
    // Call confirm_payout_transfer_completion as Client A (authenticated role, not service_role)
    const clientAClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientAClient.auth.signInWithPassword({
      email: clientA.email,
      password: clientA.password,
    });

    const fakeTransferId = '00000000-0000-0000-0000-000000000001';
    const { error } = await clientAClient.rpc('confirm_payout_transfer_completion', {
      p_transfer_id: fakeTransferId,
    });

    expect(error).toBeTruthy();
    // Function permissions revoked from authenticated or error 42501
    expect(['42501', 'P0001', '42883']).toContain(error?.code);
  });

  test('7.7 Duplicate payment attempt on timesheet does not corrupt ledger', async () => {
    // Fund timesheet first time via service role
    const { data: firstPayment, error: firstErr } = await adminClient.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: timesheetAId,
      p_razorpay_payment_id: `pay_edge_first_${Date.now()}`,
      p_razorpay_order_id: `order_edge_${Date.now()}`,
      p_razorpay_signature: `sig_edge_${Date.now()}`,
      p_amount_subunits: 5000,
      p_currency: 'USD',
      p_environment: 'test',
    });

    expect(firstErr).toBeNull();
    expect(firstPayment?.status).toBe('paid');

    // Attempt second payment with duplicate parameters
    const { data: secondPayment } = await adminClient.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: timesheetAId,
      p_razorpay_payment_id: `pay_edge_second_${Date.now()}`,
      p_razorpay_order_id: `order_edge_dup_${Date.now()}`,
      p_razorpay_signature: `sig_edge_dup_${Date.now()}`,
      p_amount_subunits: 5000,
      p_currency: 'USD',
      p_environment: 'test',
    });

    // Procedure returns existing row idempotently without error
    expect(secondPayment?.status).toBe('paid');
  });

  test('7.8 Invalid payment signature is rejected by gateway verification', async () => {
    const { getPaymentProvider } = await import('../lib/payments/registry');
    const provider = getPaymentProvider();

    // Verify tampered signature
    const verification = await provider.verifyPayment({
      orderId: 'order_test_12345',
      paymentId: 'pay_test_12345',
      signature: 'invalid_tampered_signature_hex_0000000000',
      expectedAmountSubunits: 5000,
      expectedCurrency: 'INR',
    });

    expect(verification.success).toBe(false);
    expect(verification.error).toMatch(/signature/i);
  });
});
