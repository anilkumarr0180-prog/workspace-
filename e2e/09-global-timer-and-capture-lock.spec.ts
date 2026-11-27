import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI, adminClient } from './helpers';

test.describe('Phase 2B: Global Active Timer, In-Page Start & Multi-Tab Sync', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;
  let contractId: string;
  let jobId: string;
  let proposalId: string;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_p2b_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_p2b_free');

    const { data: cat } = await adminClient.from('categories').select('id').limit(1).single();
    const ts = Date.now();

    const { data: job } = await adminClient
      .from('jobs')
      .insert({
        client_id: clientUser.id,
        category_id: cat?.id,
        title: `Global Timer E2E ${ts}`,
        description: 'End-to-end verification for global navbar timer and multi-tab synchronization.',
        project_type: 'hourly',
        budget_min: 60,
        budget_max: 60,
        experience_level: 'expert',
        duration: '1_to_3_months',
        status: 'published',
      })
      .select()
      .single();
    if (!job) throw new Error('Failed to create test job');
    jobId = job.id;

    const { data: prop } = await adminClient
      .from('proposals')
      .insert({
        job_id: jobId,
        freelancer_id: freelancerUser.id,
        bid_amount: 60,
        rate_type: 'hourly',
        cover_letter: 'Detailed fifty character cover letter for E2E hourly contract testing.',
        status: 'accepted',
      })
      .select()
      .single();
    if (!prop) throw new Error('Failed to create test proposal');
    proposalId = prop.id;

    const { data: contract } = await adminClient
      .from('contracts')
      .insert({
        proposal_id: proposalId,
        job_id: jobId,
        client_id: clientUser.id,
        freelancer_id: freelancerUser.id,
        contract_type: 'hourly',
        title: job.title,
        hourly_rate: 60,
        weekly_hour_limit: 40,
        status: 'active',
      })
      .select()
      .single();
    if (!contract) throw new Error('Failed to create test contract');
    contractId = contract.id;
  });

  test.afterAll(async () => {
    if (contractId) {
      await adminClient.from('active_timer_sessions').delete().eq('contract_id', contractId);
      await adminClient.from('time_entries').delete().eq('contract_id', contractId);
      await adminClient.from('timesheets').delete().eq('contract_id', contractId);
      await adminClient.from('contracts').delete().eq('id', contractId);
    }
    if (jobId) {
      await adminClient.from('proposals').delete().eq('job_id', jobId);
      await adminClient.from('jobs').delete().eq('id', jobId);
    }
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
  });

  test('Start stays in-page (no popup), navbar timer appears across routes & tabs, and stops cleanly', async ({
    page,
    context,
  }) => {
    await loginViaUI(page, freelancerUser);
    await page.goto('/freelancer/time-tracking');

    await expect(page.locator('#contract-selector')).toBeVisible({ timeout: 10000 });
    await page.selectOption('#contract-selector', contractId);
    await page.fill('#work-memo', 'Verifying global navbar timer');

    // Assert no popup/new tab opens on Start Tracking Time
    let openedPopup = false;
    context.once('page', () => {
      openedPopup = true;
    });

    await page.click('button:has-text("Start Tracking Time")');
    await expect(page.locator('button:has-text("Stop & Save Time")')).toBeVisible({ timeout: 10000 });
    expect(openedPopup).toBe(false);

    // Navbar timer pill appears and persists after navigating away
    await expect(page.getByTestId('global-active-timer')).toBeVisible({ timeout: 10000 });
    await page.goto('/freelancer');
    await expect(page.getByTestId('global-active-timer')).toBeVisible({ timeout: 10000 });

    // Second tab displays the same active timer and stops from navbar
    const secondTab = await context.newPage();
    await secondTab.goto('/contracts');
    await expect(secondTab.getByTestId('global-active-timer')).toBeVisible({ timeout: 10000 });

    await secondTab.getByTestId('global-timer-stop-btn').click();
    await expect(secondTab.getByTestId('global-active-timer')).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId('global-active-timer')).toBeHidden({ timeout: 10000 });
    await secondTab.close();
  });

  test('Client never sees freelancer global active timer controls', async ({ page }) => {
    await loginViaUI(page, clientUser);
    await page.goto('/client');
    await expect(page.getByTestId('global-active-timer')).toHaveCount(0);
  });
});
