import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI } from './helpers';

test.describe('Phase 3: Authentication and Role Isolation', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_freelancer');
  });

  test.afterAll(async () => {
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
  });

  test('3.1 Client registration via UI form', async ({ page }) => {
    const ts = Date.now();
    const testEmail = `reg_client_${ts}@workspace.local`;

    await page.goto('/signup/client');
    await expect(page.locator('h1')).toContainText('Sign up to hire talent');

    // Fill registration form
    await page.fill('input#first_name', 'John');
    await page.fill('input#last_name', 'Doe');
    await page.fill('input#email', testEmail);
    await page.fill('input#password', 'TestPassword123!');
    await page.locator('input[type="checkbox"][required]').check();

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for either direct dashboard redirect or verification prompt
    await page.waitForFunction(
      () => window.location.pathname === '/client' || document.body.innerText.includes('Verify your email'),
      { timeout: 15000 }
    );
  });

  test('3.2 Freelancer registration via UI form', async ({ page }) => {
    const ts = Date.now();
    const testEmail = `reg_free_${ts}@workspace.local`;

    await page.goto('/signup/freelancer');
    await expect(page.locator('h1')).toContainText('Sign up to find work');

    // Fill registration form
    await page.fill('input#first_name', 'Jane');
    await page.fill('input#last_name', 'Smith');
    await page.fill('input#email', testEmail);
    await page.fill('input#password', 'TestPassword123!');
    await page.locator('input[type="checkbox"][required]').check();

    // Submit form
    await page.click('button[type="submit"]');

    await page.waitForFunction(
      () => window.location.pathname === '/freelancer' || document.body.innerText.includes('Verify your email'),
      { timeout: 15000 }
    );
  });

  test('3.3 Client login and dashboard access', async ({ page }) => {
    await loginViaUI(page, clientUser);
    expect(page.url()).toContain('/client');
    await expect(page.locator('body')).toContainText(/Active Jobs|Client Control Center|Post a Job/i);
  });

  test('3.4 Freelancer login and dashboard access', async ({ page }) => {
    await loginViaUI(page, freelancerUser);
    expect(page.url()).toContain('/freelancer');
    await expect(page.locator('body')).toContainText(/Find Work|My Proposals|Hourly Tracker/i);
  });

  test('3.5 Unauthorized visitor cannot view private dashboard data and is redirected to login', async ({ page }) => {
    // Fresh context without cookies
    await page.goto('/client');
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Log in to Workspace/i);
  });

  test('3.6 Logout successfully clears session', async ({ page }) => {
    await loginViaUI(page, clientUser);
    expect(page.url()).toContain('/client');

    // Open user menu using title="Account profile & settings"
    const profileBtn = page.locator('button[title="Account profile & settings"]');
    await expect(profileBtn).toBeVisible({ timeout: 10000 });
    await profileBtn.click();

    const logoutBtn = page.locator('button:has-text("Log out")');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});
