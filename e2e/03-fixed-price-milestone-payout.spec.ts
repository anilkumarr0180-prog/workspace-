import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI, adminClient } from './helpers';

test.describe('Phase 5: Fixed-Price Milestone Lifecycle & Automated Payout Engine', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;
  let contractId: string;
  let jobId: string;
  let proposalId: string;
  let milestoneId: string;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_p5_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_p5_free');

    // Onboard freelancer simulated payout profile to receive MockRoute transfers
    const { error: profileErr } = await adminClient.from('freelancer_payout_profiles').upsert([
      {
        user_id: freelancerUser.id,
        provider: 'mock_route',
        provider_account_id: `acc_sim_${Date.now()}`,
        account_status: 'activated',
        legal_name: freelancerUser.fullName,
        business_type: 'individual',
        bank_name: 'HDFC Bank',
        bank_account_last4: '1099',
        bank_ifsc: 'HDFC0001234',
        pan_last4: '1234',
        payout_eligible: true,
      },
    ]);
    if (profileErr) throw new Error(`Failed to create payout profile: ${profileErr.message}`);

    // Setup active contract
    const { data: cat } = await adminClient.from('categories').select('id').limit(1).single();
    const ts = Date.now();

    const { data: job } = await adminClient
      .from('jobs')
      .insert({
        client_id: clientUser.id,
        category_id: cat?.id,
        title: `FinTech Escrow Engine ${ts}`,
        description: 'Comprehensive fixed price payment platform requiring automated escrow settlement.',
        project_type: 'fixed',
        budget_min: 1000,
        budget_max: 1000,
        experience_level: 'expert',
        duration: '1_to_3_months',
        status: 'published',
      })
      .select()
      .single();
    jobId = job!.id;

    const { data: prop } = await adminClient
      .from('proposals')
      .insert({
        job_id: jobId,
        freelancer_id: freelancerUser.id,
        bid_amount: 1000,
        rate_type: 'fixed',
        cover_letter: 'Fifty character detailed cover letter to meet the minimum character constraint.',
        status: 'accepted',
      })
      .select()
      .single();
    proposalId = prop!.id;

    const { data: cRow, error: cErr } = await adminClient
      .from('contracts')
      .insert({
        proposal_id: proposalId,
        job_id: jobId,
        client_id: clientUser.id,
        freelancer_id: freelancerUser.id,
        contract_type: 'fixed',
        title: job!.title,
        fixed_price: 1000,
        status: 'active',
      })
      .select()
      .single();

    if (cErr || !cRow) throw new Error(`Failed to create test contract: ${cErr?.message}`);
    contractId = cRow.id;
  });

  test.afterAll(async () => {
    if (contractId) {
      await adminClient.from('payment_ledger').delete().eq('contract_id', contractId);
      await adminClient.from('payout_transfers').delete().eq('contract_id', contractId);
      await adminClient.from('contract_milestones').delete().eq('contract_id', contractId);
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

  test('5.1 Verify planned milestone and contract details', async ({ page }) => {
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    // Verify Milestone #1 is rendered
    await expect(page.locator('body')).toContainText(/Milestone #1/i, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Planned/i);
    await expect(page.locator('body')).toContainText(/\$1,000|\$1000/);

    const { data: mRow } = await adminClient
      .from('contract_milestones')
      .select('id, status, amount')
      .eq('contract_id', contractId)
      .single();

    expect(mRow).toBeTruthy();
    expect(mRow?.status).toBe('planned');
    expect(Number(mRow?.amount)).toBe(1000);
    milestoneId = mRow!.id;
  });

  test('5.2 Client funds the milestone into escrow', async ({ page }) => {
    expect(milestoneId).toBeTruthy();

    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    // Click "Fund Milestone Escrow" button on the milestone card
    const fundBtn = page.locator('button:has-text("Fund Milestone Escrow"), button:has-text("Fund Milestone")').first();
    await expect(fundBtn).toBeVisible({ timeout: 10000 });
    await fundBtn.click();

    // In the Fund Escrow Modal, use the Direct Mock Deposit simulation
    const mockDepositBtn = page.locator('button:has-text("Deposit via Simulation")');
    await expect(mockDepositBtn).toBeVisible({ timeout: 5000 });
    await mockDepositBtn.click();

    // Verify UI reflects success
    await expect(page.locator('body')).toContainText(/Milestone funded successfully/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient
        .from('contract_milestones')
        .select('status')
        .eq('id', milestoneId)
        .single();
      return data?.status;
    }, { timeout: 10000 }).toBe('funded');
  });

  test('5.3 Freelancer submits milestone delivery', async ({ page }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto(`/contracts/${contractId}`);

    // Click "Submit Completed Work" button
    const submitBtn = page.locator('button:has-text("Submit Completed Work")').first();
    await expect(submitBtn).toBeVisible({ timeout: 10000 });
    await submitBtn.click();

    // Fill notes in modal
    const notesTextarea = page.locator('textarea[placeholder*="Describe the deliverables"]');
    await expect(notesTextarea).toBeVisible({ timeout: 5000 });
    await notesTextarea.fill('Completed full payment engine implementation with complete 46/46 passing test coverage.');

    // Submit to client
    await page.click('button[type="submit"]:has-text("Send to Client for Review")');

    // Verify status updates
    await expect(page.locator('body')).toContainText(/Work submitted successfully/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient
        .from('contract_milestones')
        .select('status')
        .eq('id', milestoneId)
        .single();
      return data?.status;
    }, { timeout: 10000 }).toBe('submitted');
  });

  test('5.4 Client requests a revision on submitted delivery', async ({ page }) => {
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    // Click "Request Changes" button on the milestone card
    const requestChangesBtn = page.locator('button:has-text("Request Changes")').first();
    await expect(requestChangesBtn).toBeVisible({ timeout: 10000 });
    await requestChangesBtn.click();

    // Fill feedback in modal
    const feedbackTextarea = page.locator('textarea[placeholder*="Specify the exact adjustments"]');
    await expect(feedbackTextarea).toBeVisible({ timeout: 5000 });
    await feedbackTextarea.fill('Please add an extra integration test verifying out-of-order webhook delivery.');

    // Submit revision request
    await page.click('button[type="submit"]:has-text("Request Revision")');

    // Milestone status should transition to revision_requested
    await expect(page.locator('body')).toContainText(/Revision requested/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient
        .from('contract_milestones')
        .select('status')
        .eq('id', milestoneId)
        .single();
      return data?.status;
    }, { timeout: 10000 }).toBe('revision_requested');
  });

  test('5.5 Freelancer resubmits delivery', async ({ page }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto(`/contracts/${contractId}`);

    const resubmitBtn = page.locator('button:has-text("Submit Revised Work")').first();
    await expect(resubmitBtn).toBeVisible({ timeout: 10000 });
    await resubmitBtn.click();

    const notesTextarea = page.locator('textarea[placeholder*="Describe the deliverables"]');
    await notesTextarea.fill('Out-of-order webhook test added and verified. All 46 assertions passing cleanly.');

    await page.click('button[type="submit"]:has-text("Send to Client for Review")');
    await expect(page.locator('body')).toContainText(/Work submitted successfully/i, { timeout: 10000 });

    await expect.poll(async () => {
      const { data } = await adminClient
        .from('contract_milestones')
        .select('status')
        .eq('id', milestoneId)
        .single();
      return data?.status;
    }, { timeout: 10000 }).toBe('submitted');
  });

  test('5.6 Client approves delivery, initiating automated 10% fee settlement', async ({ page }) => {
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${contractId}`);

    const approveBtn = page.locator('button:has-text("Approve & Release Payment")').first();
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await approveBtn.click();

    // Verify financial fee breakdown is rendered in modal
    await expect(page.locator('body')).toContainText(/Payment Disbursement Breakdown/i);
    await expect(page.locator('body')).toContainText(/Standard Platform Fee \(10%\)/i);
    await expect(page.locator('body')).toContainText(/\$900\.00/); // Net freelancer payout ($1000 - $100 fee)

    // Click "Release Escrow Payout"
    const releaseBtn = page.locator('button[type="submit"]:has-text("Release Escrow Payout")');
    await expect(releaseBtn).toBeVisible({ timeout: 5000 });
    await releaseBtn.click();

    // Verify status becomes released in DB
    await expect.poll(async () => {
      const { data } = await adminClient
        .from('contract_milestones')
        .select('status')
        .eq('id', milestoneId)
        .single();
      return data?.status;
    }, { timeout: 15000 }).toBe('released');

    // Verify payment ledger conservation: $1,000 gross = $100 fee + $900 net payout
    const { data: ledgerEntries } = await adminClient
      .from('payment_ledger')
      .select('event_type, amount, status')
      .eq('contract_id', contractId);

    const escrowEntry = ledgerEntries?.find((e) => e.event_type === 'escrow_funded');
    const feeEntry = ledgerEntries?.find((e) => e.event_type === 'service_fee_deducted');
    const payoutEntry = ledgerEntries?.find((e) => e.event_type === 'payout_disbursed');

    expect(escrowEntry).toBeTruthy();
    expect(Number(escrowEntry?.amount)).toBe(1000);

    expect(feeEntry).toBeTruthy();
    expect(Number(feeEntry?.amount)).toBe(100);

    expect(payoutEntry).toBeTruthy();
    expect(Number(payoutEntry?.amount)).toBe(900);

    // Verify freelancer profile reflects exactly $900 in total_earnings
    const { data: fProfile } = await adminClient
      .from('profiles')
      .select('total_earnings')
      .eq('id', freelancerUser.id)
      .single();

    expect(Number(fProfile?.total_earnings)).toBe(900);
  });
});
