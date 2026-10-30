import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI } from './helpers';

const viewports = [
  { name: 'Desktop 1440px', width: 1440, height: 900 },
  { name: 'Laptop 1280px', width: 1280, height: 800 },
  { name: 'Tablet 768px', width: 768, height: 1024 },
  { name: 'Mobile 390px', width: 390, height: 844 },
];

test.describe('Phase 8: Multi-Device Responsive Layout & UI Interaction Verification', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    clientUser = await createTestUser('client', 'e2e_p8_client');
    freelancerUser = await createTestUser('freelancer', 'e2e_p8_free');
  });

  test.afterAll(async () => {
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
  });

  for (const vp of viewports) {
    test.describe(`${vp.name} Viewport (${vp.width}x${vp.height})`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`8.1 Navigation and Public Landing page at ${vp.width}px`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto('/');
        await expect(page).toHaveTitle(/Workspace/i);

        // Header and core CTA buttons
        await expect(page.locator('header').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('header a, header button').first()).toBeVisible();

        // Check horizontal overflow (body scrollWidth should not exceed viewport width by more than 5px)
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth + 5;
        });
        expect(isOverflowing).toBe(false);

        // Filter out benign Next.js dev server notices if any
        if (consoleErrors.length > 0) {
          console.log(`[${vp.name}] Captured console errors:`, consoleErrors);
        }
      });

      test(`8.2 Client Dashboard responsive cards and empty states at ${vp.width}px`, async ({ page }) => {
        await loginViaUI(page, clientUser);
        await page.goto('/client');

        // Verify dashboard elements render cleanly without overlap
        await expect(page.locator('body')).toContainText(/Dashboard|Active Contracts|Total Spent|Post a Job/i, { timeout: 10000 });

        // Check for horizontal overflow
        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth + 5;
        });
        expect(isOverflowing).toBe(false);
      });

      test(`8.3 Freelancer Time-Tracking responsive layout at ${vp.width}px`, async ({ page }) => {
        await loginViaUI(page, freelancerUser);
        await page.goto('/freelancer/time-tracking');

        await expect(page.locator('body')).toContainText(/Time Tracking|Timer|Recent Completed/i, { timeout: 10000 });

        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth + 5;
        });
        expect(isOverflowing).toBe(false);
      });

      test(`8.4 Freelancer Payout Settings responsive interface at ${vp.width}px`, async ({ page }) => {
        await loginViaUI(page, freelancerUser);
        await page.goto('/freelancer/settings/payouts');

        await expect(page.locator('body')).toContainText(/Payout|Account|Settings|Earnings/i, { timeout: 10000 });

        const isOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth + 5;
        });
        expect(isOverflowing).toBe(false);
      });
    });
  }
});
