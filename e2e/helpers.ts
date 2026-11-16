import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { assertSafeTestEnvironment, ALLOWED_LOCAL_HOSTNAMES } from './safety';

export { assertSafeTestEnvironment, ALLOWED_LOCAL_HOSTNAMES };

// Enforce safety validation immediately upon module import
const resolvedSupabaseUrl = assertSafeTestEnvironment();

// Use standard local demo keys only for verified local test environments
const LOCAL_DEMO_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL_DEMO_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const SUPABASE_URL = resolvedSupabaseUrl;
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || LOCAL_DEMO_SERVICE_KEY;
export const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  LOCAL_DEMO_ANON_KEY;

export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Retrieves explicitly configured Razorpay test credentials.
 * Throws a clear error if test credentials are not provided via environment variables.
 * Hardcoded credentials in source code are strictly removed.
 */
export function getRazorpayTestCredentials(): {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
} {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!keyId || !keySecret || !webhookSecret) {
    throw new Error(
      '[E2E CONFIGURATION ERROR]: Razorpay test credentials are required for payment tests but not configured.\n' +
      'Please explicitly configure NEXT_PUBLIC_RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET in your test environment.'
    );
  }

  return { keyId, keySecret, webhookSecret };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: 'client' | 'freelancer';
  fullName: string;
}

/**
 * Creates a verified test user directly in verified local Supabase
 */
export async function createTestUser(role: 'client' | 'freelancer', prefix = 'user'): Promise<TestUser> {
  assertSafeTestEnvironment(SUPABASE_URL);

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
 * Safely deletes a test user with strict fail-closed safety checks.
 *
 * Requirements:
 * 1. Verify local test environment again.
 * 2. Require a successful getUserById() response.
 * 3. Require an existing, valid user email.
 * 4. Require the exact @workspace.local domain.
 * 5. Abort deletion on lookup errors, missing records, missing email, or any unexpected result.
 * 6. Never delete an unknown user.
 */
export async function deleteTestUser(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = adminClient
): Promise<void> {
  // 1. Verify local test environment again
  assertSafeTestEnvironment(SUPABASE_URL);

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('[E2E SAFETY GUARD]: User deletion aborted: missing or invalid userId.');
  }

  // 2. Require a successful getUserById() response
  const { data: userRecord, error: lookupError } = await client.auth.admin.getUserById(userId.trim());
  if (lookupError) {
    throw new Error(
      `[E2E SAFETY GUARD]: User deletion aborted: getUserById lookup failed for user "${userId}": ${lookupError.message}`
    );
  }

  if (!userRecord || !userRecord.user) {
    throw new Error(
      `[E2E SAFETY GUARD]: User deletion aborted: user record "${userId}" not found. Never delete an unknown user.`
    );
  }

  // 3. Require an existing, valid user email
  const email = userRecord.user.email;
  if (!email || typeof email !== 'string' || !email.trim()) {
    throw new Error(
      `[E2E SAFETY GUARD]: User deletion aborted: user "${userId}" has no valid email address.`
    );
  }

  // 4. Require the exact @workspace.local domain
  const normalizedEmail = email.trim().toLowerCase();
  const parts = normalizedEmail.split('@');
  if (parts.length !== 2 || !parts[0] || parts[1] !== 'workspace.local') {
    throw new Error(
      `[E2E SAFETY GUARD]: Refusing to delete non-test user "${email}". Exact "@workspace.local" domain required.`
    );
  }

  // 5. Delete test user only after all safety assertions pass
  const { error: deleteError } = await client.auth.admin.deleteUser(userId.trim());
  if (deleteError) {
    throw new Error(
      `[E2E SAFETY GUARD]: Failed to delete test user "${userId}": ${deleteError.message}`
    );
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
