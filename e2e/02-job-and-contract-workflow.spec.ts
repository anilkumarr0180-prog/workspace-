import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI, adminClient } from './helpers';

test.describe('Phase 4: Job and Contract Workflow', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;
  let createdJobId: string | null = null;
  let createdContractId: string | null = null;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_p4_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_p4_free');
  });

  test.afterAll(async () => {
    if (createdContractId) {
      await adminClient.from('payment_ledger').delete().eq('contract_id', createdContractId);
      await adminClient.from('contract_milestones').delete().eq('contract_id', createdContractId);
      await adminClient.from('contracts').delete().eq('id', createdContractId);
    }
    if (createdJobId) {
      await adminClient.from('proposals').delete().eq('job_id', createdJobId);
      await adminClient.from('jobs').delete().eq('id', createdJobId);
    }
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
  });

  test('4.1 Client creates and publishes a new job listing via UI', async ({ page }) => {
    await loginViaUI(page, clientUser);

    await page.goto('/client/jobs/new');
    await expect(page.locator('h1')).toContainText(/Post a Project|Create a Job/i);

    const ts = Date.now();
    const jobTitle = `E2E High Performance Web App ${ts}`;

    await page.fill('#postJobTitleInput', jobTitle);
    await page.fill(
      '#postJobDescTextarea',
      'Comprehensive enterprise web application requiring Next.js, TypeScript, and high throughput payment engine with automated escrow.'
    );

    // Submit Job
    await page.click('button[type="submit"]:has-text("Review & Post Job")');

    // Verify success confirmation
    await expect(page.locator('body')).toContainText(/Job Posted Successfully/i, {
      timeout: 15000,
    });

    // Query authoritative job record from database
    const { data: jobRow } = await adminClient
      .from('jobs')
      .select('id, title, status')
      .eq('client_id', clientUser.id)
      .eq('title', jobTitle)
      .single();

    expect(jobRow).toBeTruthy();
    expect(jobRow?.status).toBe('published');
    createdJobId = jobRow!.id;
  });

  test('4.2 Freelancer discovers the job and submits a proposal via UI modal', async ({ page }) => {
    expect(createdJobId).toBeTruthy();

    await loginViaUI(page, freelancerUser);
    await page.goto(`/jobs/${createdJobId}`);

    // Wait for job title and details
    await expect(page.locator('h1')).toContainText(/E2E High Performance Web App/);

    // Click Apply Now button
    const applyBtn = page.locator('button:has-text("Apply Now")');
    await expect(applyBtn).toBeVisible({ timeout: 10000 });
    await applyBtn.click();

    // Fill Proposal Modal
    await expect(page.locator('#bidAmountInput')).toBeVisible({ timeout: 5000 });
    await page.fill('#bidAmountInput', '1000');
    await page.fill('#deliveryDaysInput', '10');
    await page.fill(
      '#coverLetterInput',
      'I have 10+ years of full-stack fintech engineering experience and will build this system to institutional specifications.'
    );

    // Submit proposal
    await page.click('button:has-text("Submit Proposal")');

    // Verify confirmation inside modal
    await expect(page.locator('body')).toContainText(/Proposal Sent Successfully/i, { timeout: 10000 });

    // Close modal
    await page.click('button:has-text("Close")');

    // Verify button shows submitted status
    await expect(page.locator('button:has-text("Proposal Submitted")')).toBeVisible({ timeout: 5000 });

    // Database verification
    const { data: propRow } = await adminClient
      .from('proposals')
      .select('id, status, bid_amount')
      .eq('job_id', createdJobId!)
      .eq('freelancer_id', freelancerUser.id)
      .single();

    expect(propRow).toBeTruthy();
    expect(propRow?.status).toBe('submitted');
    expect(Number(propRow?.bid_amount)).toBe(1000);
  });

  test('4.3 Client reviews and accepts proposal, generating an active contract', async ({ page }) => {
    expect(createdJobId).toBeTruthy();

    await loginViaUI(page, clientUser);
    await page.goto('/client');

    // Click on Proposals tab
    const proposalsTab = page.locator('button:has-text("Proposals Received")').first();
    await expect(proposalsTab).toBeVisible({ timeout: 10000 });
    await proposalsTab.click();

    // Find the Review Proposal button and open review modal
    const reviewBtn = page.locator('button:has-text("Review Proposal")').first();
    await expect(reviewBtn).toBeVisible({ timeout: 10000 });
    await reviewBtn.click();

    // In modal, advance state machine: Mark as Under Review -> Accept Offer
    const underReviewBtn = page.locator('[role="dialog"] button:has-text("Mark as Under Review")');
    if (await underReviewBtn.isVisible({ timeout: 3000 })) {
      await underReviewBtn.click();
    }

    const acceptOfferBtn = page.locator('[role="dialog"] button:has-text("Accept Offer")');
    await expect(acceptOfferBtn).toBeVisible({ timeout: 5000 });
    await acceptOfferBtn.click();

    // Verify contract created atomically in PostgreSQL via trigger
    await expect.poll(async () => {
      const { data: contractRow } = await adminClient
        .from('contracts')
        .select('id, client_id, freelancer_id, status, fixed_price')
        .eq('job_id', createdJobId!)
        .eq('freelancer_id', freelancerUser.id)
        .maybeSingle();

      if (contractRow?.id) {
        createdContractId = contractRow.id;
      }
      return contractRow?.status;
    }, { timeout: 10000 }).toBe('active');

    expect(createdContractId).toBeTruthy();
  });

  test('4.4 Both Client and Freelancer can view contract details', async ({ page }) => {
    expect(createdContractId).toBeTruthy();

    // 1. Client view
    await loginViaUI(page, clientUser);
    await page.goto(`/contracts/${createdContractId}`);
    await expect(page.locator('h1')).toContainText(/E2E High Performance Web App/i, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Milestones|Overview|Payment Ledger/i);

    // 2. Freelancer view
    await loginViaUI(page, freelancerUser);
    await page.goto(`/contracts/${createdContractId}`);
    await expect(page.locator('h1')).toContainText(/E2E High Performance Web App/i, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Milestones|Overview|Payment Ledger/i);
  });
});
