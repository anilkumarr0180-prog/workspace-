import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI, adminClient } from './helpers';

test.describe('Phase 6: Hourly Timesheet Lifecycle, Timer Synchronization & Payout Engine', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;
  let contractId: string;
  let jobId: string;
  let proposalId: string;
  let timesheetId: string;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_p6_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_p6_free');

    // Onboard freelancer simulated payout profile to receive MockRoute disbursements
    const { error: profileErr } = await adminClient.from('freelancer_payout_profiles').upsert([
      {
        user_id: freelancerUser.id,
        provider: 'mock_route',
        provider_account_id: `acc_sim_${Date.now()}`,
        account_status: 'activated',
        legal_name: freelancerUser.fullName,
        business_type: 'individual',
        bank_name: 'HDFC Bank',
        bank_account_last4: '4321',
        bank_ifsc: 'HDFC0001234',
        pan_last4: '5678',
        payout_eligible: true,
      },
    ]);
    if (profileErr) throw new Error(`Failed to onboard payout profile: ${profileErr.message}`);

    // Create hourly job and contract ($50/hr, 40h/wk limit)
    const { data: cat } = await adminClient.from('categories').select('id').limit(1).single();
    const ts = Date.now();

    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        client_id: clientUser.id,
        category_id: cat?.id,
        title: `Distributed Cloud Automation ${ts}`,
        description: 'Hourly infrastructure engineering and automated deployment workflows requiring high reliability.',
        project_type: 'hourly',
        budget_min: 50,
        budget_max: 50,
        experience_level: 'expert',
        duration: '1_to_3_months',
        status: 'published',
      })
      .select()
      .single();

    if (jobErr || !job) throw new Error(`Failed to create test job: ${jobErr?.message}`);
    jobId = job.id;

    const { data: prop, error: propErr } = await adminClient
      .from('proposals')
      .insert({
        job_id: jobId,
        freelancer_id: freelancerUser.id,
        bid_amount: 50,
        rate_type: 'hourly',
        cover_letter: 'Fifty character detailed cover letter to meet the minimum character constraint.',
        status: 'accepted',
      })
      .select()
      .single();

    if (propErr || !prop) throw new Error(`Failed to create test proposal: ${propErr?.message}`);
    proposalId = prop.id;

    const { data: cRow, error: cErr } = await adminClient
      .from('contracts')
      .insert({
        proposal_id: proposalId,
        job_id: jobId,
        client_id: clientUser.id,
        freelancer_id: freelancerUser.id,
        contract_type: 'hourly',
        title: job.title,
        hourly_rate: 50,
        weekly_hour_limit: 40,
        status: 'active',
      })
      .select()
      .single();

    if (cErr || !cRow) throw new Error(`Failed to create test hourly contract: ${cErr?.message}`);
    contractId = cRow.id;
  });

  test.afterAll(async () => {
    if (contractId) {
      await adminClient.from('payment_ledger').delete().eq('contract_id', contractId);
      await adminClient.from('payout_transfers').delete().eq('contract_id', contractId);
      await adminClient.from('time_entries').delete().eq('contract_id', contractId);
      await adminClient.from('active_timer_sessions').delete().eq('contract_id', contractId);
      await adminClient.from('timesheets').delete().eq('contract_id', contractId);
      await adminClient.from('contracts').delete().eq('id', contractId);
    }
    if (jobId) {
      await adminClient.from('proposals').delete().eq('job_id', jobId);
      await adminClient.from('jobs').delete().eq('id', jobId);
    }
    await adminClient.from('freelancer_payout_profiles').delete().eq('user_id', freelancerUser.id);
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
  });

  test('6.1 Freelancer starts active timer on hourly contract', async ({ page }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto('/freelancer/time-tracking');

    // Verify contract is selected in dropdown
    await expect(page.locator('#contract-selector')).toBeVisible({ timeout: 10000 });
    await page.selectOption('#contract-selector', contractId);

    // Enter memo
    await page.fill('#work-memo', 'Architecting automated deployment workflows');

    // Click "Start Tracking Time"
    await page.click('button:has-text("Start Tracking Time")');

    // Verify toast & UI changes to running timer state
    await expect(page.locator('body')).toContainText(/Timer started successfully/i, { timeout: 10000 });
    await expect(page.locator('button:has-text("Stop & Save Time")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Discard")')).toBeVisible({ timeout: 5000 });

    // Verify database has active timer session
    await expect.poll(async () => {
      const { data: session } = await adminClient
        .from('active_timer_sessions')
        .select('*')
        .eq('freelancer_id', freelancerUser.id)
        .maybeSingle();
      return session?.contract_id;
    }, { timeout: 10000 }).toBe(contractId);
  });

  test('6.2 Active timer persists across page refresh and multi-tab state', async ({ page, context }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto('/freelancer/time-tracking');

    // Verify timer is running
    await expect(page.locator('button:has-text("Stop & Save Time")')).toBeVisible({ timeout: 10000 });

    // Refresh page
    await page.reload();
    await expect(page.locator('button:has-text("Stop & Save Time")')).toBeVisible({ timeout: 10000 });

    // Open second page (multi-tab) in the same browser context
    const secondPage = await context.newPage();
    await secondPage.goto('/freelancer/time-tracking');
    await expect(secondPage.locator('button:has-text("Stop & Save Time")')).toBeVisible({ timeout: 10000 });
    await secondPage.close();
  });

  test('6.3 Sub-minute sessions (<60s) are safely discarded without billing', async ({ page }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto('/freelancer/time-tracking');

    // Click "Stop & Save Time" while elapsed < 60s
    const stopBtn = page.locator('button:has-text("Stop & Save Time")');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await stopBtn.click();

    // Verify discard feedback
    await expect(page.locator('body')).toContainText(/discarded without billing|under 1 minute/i, { timeout: 10000 });

    // Verify no billable time entries were logged
    const { data: entries } = await adminClient
      .from('time_entries')
      .select('id')
      .eq('contract_id', contractId);

    expect(entries?.length || 0).toBe(0);

    // Verify active session was cleared
    await expect.poll(async () => {
      const { data: session } = await adminClient
        .from('active_timer_sessions')
        .select('id')
        .eq('freelancer_id', freelancerUser.id)
        .maybeSingle();
      return session;
    }, { timeout: 10000 }).toBeNull();
  });

  test('6.4 Valid billable session is logged and rolled into weekly timesheet', async ({ page }) => {
    // Calculate current Monday UTC
    const now = new Date();
    const day = now.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
    const weekStart = monday.toISOString().split('T')[0];

    // Create weekly timesheet in 'open' status
    const { data: tsRow, error: tsErr } = await adminClient
      .from('timesheets')
      .insert({
        contract_id: contractId,
        client_id: clientUser.id,
        freelancer_id: freelancerUser.id,
        week_start_date: weekStart,
        total_minutes: 120, // 2 hours
        total_amount: 100, // 2h * $50/hr = $100
        status: 'open',
      })
      .select()
      .single();

    if (tsErr || !tsRow) throw new Error(`Failed to create test timesheet: ${tsErr?.message}`);
    timesheetId = tsRow.id;

    // Insert corresponding completed time entry
    await adminClient.from('time_entries').insert({
      contract_id: contractId,
      timesheet_id: timesheetId,
      freelancer_id: freelancerUser.id,
      duration_minutes: 120,
      memo: 'Implemented automated end-to-end cloud pipeline',
      start_time: new Date(Date.now() - 7200000).toISOString(),
      end_time: new Date().toISOString(),
    });

    // Freelancer visits time-tracking page and switches to timesheets tab
    await loginViaUI(page, freelancerUser);
    await page.goto('/freelancer/time-tracking');

    // Click "Weekly Timesheets & Billing" tab
    await page.click('button:has-text("Weekly Timesheets & Billing")');

    // Verify timesheet is listed with 2.0 hrs ($100.00)
    await expect(page.locator('body')).toContainText(/2\.0 hrs|2h/i, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/\$100\.00|\$100/);

    // Click "Submit Timesheet" button
    const submitBtn = page.locator('button:has-text("Submit Timesheet")').first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Verify toast confirmation
    await expect(page.locator('body')).toContainText(/Timesheet submitted successfully/i, { timeout: 10000 });

    // Poll DB to verify status transitioned to submitted
    await expect.poll(async () => {
      const { data } = await adminClient
        .from('timesheets')
        .select('status')
        .eq('id', timesheetId)
        .single();
      return data?.status;
    }, { timeout: 10000 }).toBe('submitted');
  });

  test('6.5 Client reviews and disputes timesheet, then approves resubmitted timesheet', async ({ page }) => {
    // 1. Client logs in and views the contract page
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    // Verify timesheet card is rendered with "Dispute" and "Approve Timesheet"
    const disputeBtn = page.locator('button:has-text("Dispute")').first();
    await expect(disputeBtn).toBeVisible({ timeout: 10000 });

    // Test Dispute Workflow
    await disputeBtn.click();
    await expect(page.locator('body')).toContainText(/Dispute Weekly Timesheet/i, { timeout: 5000 });
    const disputeTextarea = page.locator('textarea[placeholder*="Describe specific discrepancies"]');
    await expect(disputeTextarea).toBeVisible({ timeout: 5000 });
    await disputeTextarea.fill('Please clarify breakdown of infrastructure scripts and deployment notes.');
    await page.click('button[type="submit"]:has-text("Submit Dispute")');

    // Verify dispute state
    await expect(page.locator('body')).toContainText(/Timesheet disputed/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient.from('timesheets').select('status').eq('id', timesheetId).single();
      return data?.status;
    }, { timeout: 10000 }).toBe('disputed');

    // 2. Freelancer resubmits timesheet
    await adminClient.from('timesheets').update({ status: 'submitted' }).eq('id', timesheetId);

    // 3. Client reloads and approves timesheet
    await page.reload();
    const approveBtn = page.locator('button:has-text("Approve Timesheet")').first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await approveBtn.click();

    await expect(page.locator('body')).toContainText(/Timesheet approved/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient.from('timesheets').select('status').eq('id', timesheetId).single();
      return data?.status;
    }, { timeout: 10000 }).toBe('approved');
  });

  test('6.6 Client pays approved timesheet via simulated payment, triggering 10% fee and 90% payout', async ({ page }) => {
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    // Verify "Pay $100.00 with Razorpay (Test)" button is visible
    const payBtn = page.locator('button:has-text("Pay $100.00 with Razorpay")').first();
    await expect(payBtn).toBeVisible({ timeout: 10000 });

    // Execute timesheet funding via backend verification procedure (simulated payment settlement)
    const { error: fundErr } = await adminClient.rpc('fund_timesheet_with_payment', {
      p_timesheet_id: timesheetId,
      p_razorpay_payment_id: `pay_sim_ts_${Date.now()}`,
      p_razorpay_order_id: `order_sim_ts_${Date.now()}`,
      p_razorpay_signature: `sig_mock_${Date.now()}`,
      p_amount_subunits: 10000, // $100.00 in subunits
      p_currency: 'USD',
      p_environment: 'test',
      p_metadata: { simulated: true },
    });

    if (fundErr) throw new Error(`Failed to simulate timesheet payment: ${fundErr.message}`);

    // Trigger automatic payout engine for the paid timesheet
    const { initiateTimesheetPayout } = await import('../lib/services/payout-engine').then(m => ({
      initiateTimesheetPayout: m.payoutEngine.initiateTimesheetPayout.bind(m.payoutEngine),
    }));
    const payoutRes = await initiateTimesheetPayout(timesheetId);
    expect(payoutRes.success).toBe(true);

    // Reload contract page and verify UI displays payment confirmation
    await page.reload();
    await expect(page.locator('body')).toContainText(/Payment Captured • Simulated Freelancer Payout Complete/i, { timeout: 10000 });

    // Verify timesheet authoritative status is 'paid'
    const { data: tsRow } = await adminClient.from('timesheets').select('status').eq('id', timesheetId).single();
    expect(tsRow?.status).toBe('paid');

    // Verify payment ledger conservation: $100 gross = $10 fee (10%) + $90 net payout (90%)
    const { data: ledgerEntries } = await adminClient
      .from('payment_ledger')
      .select('event_type, amount, status')
      .eq('contract_id', contractId);

    const feeEntry = ledgerEntries?.find((e) => e.event_type === 'service_fee_deducted');
    const payoutEntry = ledgerEntries?.find((e) => e.event_type === 'payout_disbursed');

    expect(feeEntry).toBeTruthy();
    expect(Number(feeEntry?.amount)).toBe(10); // 10% of $100

    expect(payoutEntry).toBeTruthy();
    expect(Number(payoutEntry?.amount)).toBe(90); // 90% of $100

    // Verify freelancer earnings increased by exactly $90
    const { data: fProfile } = await adminClient
      .from('profiles')
      .select('total_earnings')
      .eq('id', freelancerUser.id)
      .single();

    expect(Number(fProfile?.total_earnings)).toBe(90);
  });
});
