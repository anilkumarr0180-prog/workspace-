import { test, expect } from '@playwright/test';

test.describe('Workspace Navbar Search & Category Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('8.1 Search input and default category are rendered on desktop', async ({ page }) => {
    // Search form is present
    const searchForm = page.locator('header form[role="search"]').first();
    await expect(searchForm).toBeVisible();

    // Input has placeholder "Search"
    const searchInput = searchForm.locator('input[placeholder="Search"]');
    await expect(searchInput).toBeVisible();

    // Category button displays "Talent" by default
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');
    await expect(categoryButton).toBeVisible();
    await expect(categoryButton).toContainText('Talent');
  });

  test('8.2 Category dropdown opens and displays exactly Talent and Jobs', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');

    // Click to open dropdown
    await categoryButton.click();

    const dropdown = page.locator('[role="listbox"][aria-label="Search categories"]');
    await expect(dropdown).toBeVisible();

    const options = dropdown.locator('[role="option"]');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('Talent');
    await expect(options.nth(1)).toContainText('Jobs');

    // Talent is selected by default
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'false');
  });

  test('8.3 Switching between Talent and Jobs updates button text and closes dropdown', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');

    // Open dropdown
    await categoryButton.click();
    const dropdown = page.locator('[role="listbox"][aria-label="Search categories"]');
    await expect(dropdown).toBeVisible();

    // Select Jobs
    await dropdown.locator('[role="option"]:has-text("Jobs")').click();

    // Dropdown should close
    await expect(dropdown).not.toBeVisible();

    // Button should now show "Jobs"
    await expect(categoryButton).toContainText('Jobs');

    // Open again to check selected attribute
    await categoryButton.click();
    await expect(dropdown.locator('[role="option"]:has-text("Jobs")')).toHaveAttribute('aria-selected', 'true');
    await expect(dropdown.locator('[role="option"]:has-text("Talent")')).toHaveAttribute('aria-selected', 'false');

    // Switch back to Talent
    await dropdown.locator('[role="option"]:has-text("Talent")').click();
    await expect(dropdown).not.toBeVisible();
    await expect(categoryButton).toContainText('Talent');
  });

  test('8.4 Escape key closes the dropdown and returns focus', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');

    await categoryButton.click();
    const dropdown = page.locator('[role="listbox"][aria-label="Search categories"]');
    await expect(dropdown).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(dropdown).not.toBeVisible();
    await expect(categoryButton).toBeFocused();
  });

  test('8.5 Clicking outside closes the dropdown', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');

    await categoryButton.click();
    const dropdown = page.locator('[role="listbox"][aria-label="Search categories"]');
    await expect(dropdown).toBeVisible();

    // Click outside on body
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await expect(dropdown).not.toBeVisible();
  });

  test('8.6 Typing and submitting with Talent redirects to /freelancers?q=...', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const searchInput = searchForm.locator('input[placeholder="Search"]');

    await searchInput.fill('developer');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/freelancers\?q=developer/);
  });

  test('8.7 Typing and submitting with Jobs redirects to /jobs?q=...', async ({ page }) => {
    const searchForm = page.locator('header form[role="search"]').first();
    const categoryButton = searchForm.locator('button[aria-haspopup="listbox"]');
    const searchInput = searchForm.locator('input[placeholder="Search"]');

    // Switch to Jobs
    await categoryButton.click();
    await page.locator('[role="listbox"] [role="option"]:has-text("Jobs")').click();

    // Type query and submit
    await searchInput.fill('nextjs');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/jobs\?q=nextjs/);
  });
});

