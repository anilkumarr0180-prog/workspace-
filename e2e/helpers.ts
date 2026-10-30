import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_TtD6UKf1gb9gHP';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'LXSigIHBNd1UrQ32Ll8HRFuw';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'cef8578ce322f3c763bdaecbe3b69e422dd5e736bce81b8065ffb6538069a04d';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: 'client' | 'freelancer';
  fullName: string;
}

/**
 * Creates a verified test user directly in local Supabase
 */
export async function createTestUser(role: 'client' | 'freelancer', prefix = 'user'): Promise<TestUser> {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const email = `${prefix}_${ts}@workspace.local`;
  const password = 'TestPassword123!';
  const fullName = role === 'client' ? `Client Test ${ts}` : `Freelancer Test ${ts}`;

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role,
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message}`);
  }

  const userId = data.user.id;

  // Ensure database profile is aligned
  await adminClient.from('profiles').update({
    full_name: fullName,
    can_hire: role === 'client',
    can_work: role === 'freelancer',
    active_mode: role,
    title: role === 'freelancer' ? 'Full Stack Engineer' : 'Product Director',
    hourly_rate: role === 'freelancer' ? 75 : null,
  }).eq('id', userId);

  return {
    id: userId,
    email,
    password,
    role,
    fullName,
  };
}

/**
 * Deletes a test user
 */
export async function deleteTestUser(userId: string): Promise<void> {
  try {
    await adminClient.auth.admin.deleteUser(userId);
  } catch (err) {
    console.warn(`Could not delete test user ${userId}:`, err);
  }
}

/**
 * Performs full UI login via the Workspace login screen
 */
export async function loginViaUI(page: Page, user: TestUser): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.waitForSelector('#login-email', { state: 'visible' });

  // Step 1: Email
  await page.fill('#login-email', user.email);
  await page.click('button:has-text("Continue with Email")');

  // Step 2: Password
  await page.waitForSelector('#login-password', { state: 'visible' });
  await page.fill('#login-password', user.password);
  await page.click('button[type="submit"]:has-text("Log In")');

  // Verify navigation to dashboard
  const expectedPath = user.role === 'client' ? '/client' : '/freelancer';
  await page.waitForURL(new RegExp(expectedPath), { timeout: 15000 });
}
