/**
 * Phase 1.3: Security Hardening & Regression Verification Script
 *
 * Verifies:
 * 1. Public health endpoint hygiene & absence of sensitive diagnostics
 * 2. Dedicated admin health authentication (removal of CRON_SECRET fallback, missing secret config error, timing-safe auth)
 * 3. Accurate admin diagnostics (independent jobs and proposals checks, degraded on any failure, healthy only on both)
 * 4. Production email adapter authenticity (prevention of fake Resend impersonation, preservation of local Mailpit)
 * 5. Strict E2E hostname allowlist (removal of .local/.test suffixes, protocol validation, malformed URL rejection)
 * 6. Production & Vercel E2E execution rejection
 * 7. Fail-closed E2E user deletion (rejecting missing records, invalid email, non-@workspace.local domains)
 * 8. Marketplace trust metrics & simulated payout disclosures
 */

import { GET as getPublicHealth } from '../app/api/health/route';
import { GET as getAdminHealth, handleAdminHealthCheck } from '../app/api/admin/health/route';
import { NextRequest } from 'next/server';
import { getEmailAdapter, sendEmail } from '../lib/email/service';
import { ResendEmailAdapter } from '../lib/email/adapters/resend-adapter';
import { NodemailerEmailAdapter } from '../lib/email/adapters/nodemailer-adapter';
import { assertSafeTestEnvironment, deleteTestUser, getRazorpayTestCredentials } from '../e2e/helpers';
import { formatJobForFrontend } from '../lib/actions/jobs';
import { getPayoutProviderMetadata, getPayoutProvider, getTransferProvider } from '../lib/payments/registry';

let passed = 0;
let total = 0;

function assert(condition: boolean, title: string, details?: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] ${title}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${title}${details ? ` -> ${details}` : ''}`);
    process.exitCode = 1;
  }
}

async function runVerification() {
  console.log('========================================================================');
  console.log('PHASE 1.3: SECURITY HARDENING & REGRESSION VERIFICATION');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Public Health Endpoint Security
  // -------------------------------------------------------------------------
  console.log('--- 1. Public Health Endpoint Security ---');
  const publicRes = await getPublicHealth();
  const publicData = await publicRes.json();

  assert(publicRes.status === 200, 'Public health endpoint returns HTTP 200');
  assert(publicData.status === 'ok', 'Public health status reports "ok"');
  assert(typeof publicData.timestamp === 'string' && !isNaN(Date.parse(publicData.timestamp)), 'Public health includes valid ISO timestamp');
  assert(typeof publicData.uptime === 'number' && publicData.uptime >= 0, 'Public health includes uptime counter');
  assert(publicData.service === 'marketplace-api', 'Public health reports non-sensitive service identifier');
  assert(publicData.environment === undefined, 'Public health does NOT expose environment configuration');
  assert(publicData.databaseSummary === undefined, 'Public health does NOT expose database counts');
  assert(publicData.currentUser === undefined, 'Public health does NOT expose user identity or session data');
  assert(publicData.diagnosis === undefined, 'Public health does NOT expose internal diagnostic messages');

  // -------------------------------------------------------------------------
  // 2. Dedicated Admin Health Authentication & Accurate Diagnostics
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Dedicated Admin Health Authentication & Accurate Diagnostics ---');

  const origAdminSecret = process.env.ADMIN_HEALTH_SECRET;
  const origCronSecret = process.env.CRON_SECRET;

  try {
    const testAdminSecret = 'test_admin_health_secret_9999999999';

    // 2a. Missing ADMIN_HEALTH_SECRET returns 500 configuration error
    delete process.env.ADMIN_HEALTH_SECRET;
    delete process.env.CRON_SECRET;
    const missingSecretReq = new NextRequest('http://localhost:3000/api/admin/health');
    const missingSecretRes = await getAdminHealth(missingSecretReq);
    const missingSecretData = await missingSecretRes.json();
    assert(
      missingSecretRes.status === 500,
      'Missing ADMIN_HEALTH_SECRET returns HTTP 500 configuration error'
    );
    assert(
      missingSecretData.error && missingSecretData.error.includes('Dedicated ADMIN_HEALTH_SECRET is required'),
      'Missing secret error message identifies required ADMIN_HEALTH_SECRET'
    );

    // 2b. Removal of CRON_SECRET fallback: CRON_SECRET alone does NOT authorize
    process.env.CRON_SECRET = 'cron_secret_only_1234567890';
    const cronFallbackReq = new NextRequest('http://localhost:3000/api/admin/health', {
      headers: { authorization: 'Bearer cron_secret_only_1234567890' },
    });
    const cronFallbackRes = await getAdminHealth(cronFallbackReq);
    assert(
      cronFallbackRes.status === 500,
      'CRON_SECRET fallback strictly removed: returns 500 config error when ADMIN_HEALTH_SECRET is missing'
    );
    delete process.env.CRON_SECRET;

    // 2c. Unauthenticated request with ADMIN_HEALTH_SECRET configured returns 401
    process.env.ADMIN_HEALTH_SECRET = testAdminSecret;
    const unauthReq = new NextRequest('http://localhost:3000/api/admin/health');
    const unauthRes = await getAdminHealth(unauthReq);
    assert(
      unauthRes.status === 401,
      'Unauthenticated request returns HTTP 401 Unauthorized'
    );

    // 2d. Incorrect secret returns 401
    const wrongBearerReq = new NextRequest('http://localhost:3000/api/admin/health', {
      headers: { authorization: 'Bearer wrong-secret-token' },
    });
    const wrongBearerRes = await getAdminHealth(wrongBearerReq);
    assert(
      wrongBearerRes.status === 401,
      'Incorrect Bearer secret returns HTTP 401 Unauthorized'
    );

    const wrongHeaderReq = new NextRequest('http://localhost:3000/api/admin/health', {
      headers: { 'x-admin-secret': 'wrong-header-secret' },
    });
    const wrongHeaderRes = await getAdminHealth(wrongHeaderReq);
    assert(
      wrongHeaderRes.status === 401,
      'Incorrect x-admin-secret header returns HTTP 401 Unauthorized'
    );

    // 2e. Valid secret allows request
    const authHeaders = { authorization: `Bearer ${testAdminSecret}` };

    // 2f. Diagnostic check: Both jobs and proposals succeed -> reports healthy (200)
    const mockBothSuccessClient = {
      from: (table: string) => ({
        select: async () => ({
          count: table === 'jobs' ? 42 : 17,
          error: null,
        }),
      }),
    };
    const bothSuccessReq = new NextRequest('http://localhost:3000/api/admin/health', { headers: authHeaders });
    const bothSuccessRes = await handleAdminHealthCheck(bothSuccessReq, { injectedAdminClient: mockBothSuccessClient });
    const bothSuccessData = await bothSuccessRes.json();
    assert(
      bothSuccessRes.status === 200,
      'All diagnostic checks succeed -> reports HTTP 200'
    );
    assert(
      bothSuccessData.status === 'healthy' &&
      bothSuccessData.checks.database === true &&
      bothSuccessData.checks.jobsQuery === true &&
      bothSuccessData.checks.proposalsQuery === true &&
      bothSuccessData.summary.totalJobs === 42 &&
      bothSuccessData.summary.totalProposals === 17,
      'Accurate diagnostics: reports "healthy" with checks and counts when all succeed'
    );

    // 2g. Diagnostic check: Jobs query failure -> reports degraded (503)
    const mockJobsFailClient = {
      from: (table: string) => ({
        select: async () => ({
          count: table === 'jobs' ? null : 17,
          error: table === 'jobs' ? new Error('Jobs table connection timeout') : null,
        }),
      }),
    };
    const jobsFailReq = new NextRequest('http://localhost:3000/api/admin/health', { headers: authHeaders });
    const jobsFailRes = await handleAdminHealthCheck(jobsFailReq, { injectedAdminClient: mockJobsFailClient });
    const jobsFailData = await jobsFailRes.json();
    assert(
      jobsFailRes.status === 503,
      'Jobs query failure -> reports HTTP 503 Service Unavailable'
    );
    assert(
      jobsFailData.status === 'degraded' &&
      jobsFailData.checks.jobsQuery === false &&
      jobsFailData.checks.proposalsQuery === true,
      'Accurate diagnostics: reports "degraded" with jobsQuery=false and proposalsQuery=true'
    );
    assert(
      !JSON.stringify(jobsFailData).includes('Jobs table connection timeout'),
      'Raw database error string is NOT exposed in HTTP response'
    );

    // 2h. Diagnostic check: Proposals query failure -> reports degraded (503)
    const mockProposalsFailClient = {
      from: (table: string) => ({
        select: async () => ({
          count: table === 'jobs' ? 42 : null,
          error: table === 'proposals' ? new Error('Proposals table locked') : null,
        }),
      }),
    };
    const proposalsFailReq = new NextRequest('http://localhost:3000/api/admin/health', { headers: authHeaders });
    const proposalsFailRes = await handleAdminHealthCheck(proposalsFailReq, { injectedAdminClient: mockProposalsFailClient });
    const proposalsFailData = await proposalsFailRes.json();
    assert(
      proposalsFailRes.status === 503,
      'Proposals query failure -> reports HTTP 503 Service Unavailable'
    );
    assert(
      proposalsFailData.status === 'degraded' &&
      proposalsFailData.checks.jobsQuery === true &&
      proposalsFailData.checks.proposalsQuery === false,
      'Accurate diagnostics: reports "degraded" with jobsQuery=true and proposalsQuery=false'
    );
    assert(
      !JSON.stringify(proposalsFailData).includes('Proposals table locked'),
      'Raw proposals error string is NOT exposed in HTTP response'
    );
  } finally {
    if (origAdminSecret !== undefined) process.env.ADMIN_HEALTH_SECRET = origAdminSecret;
    else delete process.env.ADMIN_HEALTH_SECRET;

    if (origCronSecret !== undefined) process.env.CRON_SECRET = origCronSecret;
    else delete process.env.CRON_SECRET;
  }

  // -------------------------------------------------------------------------
  // 3. Production Email Adapter Authenticity
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Production Email Adapter Authenticity ---');
  const origNodeEnv = process.env.NODE_ENV;
  const origEmailProvider = process.env.EMAIL_PROVIDER;
  const origResendKey = process.env.RESEND_API_KEY;

  try {
    // 3a. In production, fake Resend adapter impersonation is rejected
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_dummy_key_12345';

    // Attempt 1: Plain object impersonating Resend
    const fakeObjectAdapter = {
      name: 'resend',
      sendEmail: async () => ({ success: true, provider: 'resend', providerMessageId: 'fake-123' }),
    };

    let fakeObjectBlocked = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendEmail({ to: 'user@example.com', subject: 'Test' }, fakeObjectAdapter as any);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Only genuine ResendEmailAdapter instances are permitted')) {
        fakeObjectBlocked = true;
      }
    }
    assert(fakeObjectBlocked, 'Fake Resend object impersonation rejected in production (not genuine instance)');

    // Attempt 2: Unauthorized class impersonating Resend
    class UnauthorizedResendClass {
      readonly name = 'resend';
      async sendEmail() {
        return { success: true, provider: 'resend', providerMessageId: 'class-fake-123' };
      }
    }

    let fakeClassBlocked = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendEmail({ to: 'user@example.com', subject: 'Test' }, new UnauthorizedResendClass() as any);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Only genuine ResendEmailAdapter instances are permitted')) {
        fakeClassBlocked = true;
      }
    }
    assert(fakeClassBlocked, 'Arbitrary class impersonating Resend rejected in production');

    // 3b. Genuine ResendEmailAdapter is accepted in production
    const mockResendSdkClient = {
      emails: {
        send: async () => ({
          data: { id: 'msg_resend_genuine_789' },
          error: null,
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const genuineResendAdapter = new ResendEmailAdapter('re_valid_api_key', mockResendSdkClient);
    const genuineResult = await sendEmail(
      { to: 'client@example.com', subject: 'Notification', text: 'Important update' },
      genuineResendAdapter
    );
    assert(
      genuineResult.success === true && genuineResult.provider === 'resend' && genuineResult.providerMessageId === 'msg_resend_genuine_789',
      'Genuine ResendEmailAdapter instance accepted and dispatches successfully in production'
    );

    // 3c. Preservation of local Mailpit in development
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.EMAIL_PROVIDER;
    const devAdapter = getEmailAdapter();
    assert(
      devAdapter.name === 'mailpit' && devAdapter instanceof NodemailerEmailAdapter,
      'Local Mailpit adapter preserved and resolved by default in development'
    );

    // 3d. Preservation of test adapter in permitted test environment
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.EMAIL_PROVIDER = 'test';
    const testAdapter = getEmailAdapter();
    assert(
      testAdapter.name === 'test',
      'Test email adapter preserved and permitted in NODE_ENV=test'
    );
  } finally {
    if (origNodeEnv !== undefined) (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    else delete (process.env as Record<string, string | undefined>).NODE_ENV;

    if (origEmailProvider !== undefined) process.env.EMAIL_PROVIDER = origEmailProvider;
    else delete process.env.EMAIL_PROVIDER;

    if (origResendKey !== undefined) process.env.RESEND_API_KEY = origResendKey;
    else delete process.env.RESEND_API_KEY;
  }

  // -------------------------------------------------------------------------
  // 4. Strict E2E Hostname Allowlist & Shared Safety Guard
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Strict E2E Hostname Allowlist & Shared Safety Guard ---');

  // 4a. Remote *.supabase.co rejected
  let remoteSupabaseBlocked = false;
  try {
    assertSafeTestEnvironment('https://myprojectref.supabase.co');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('REMOTE DATABASE MUTATION PREVENTED')) {
      remoteSupabaseBlocked = true;
    }
  }
  assert(remoteSupabaseBlocked, 'Remote *.supabase.co URL rejected by safety guard');

  // 4b. Arbitrary .local domain rejected (removal of permissive .local matching)
  let arbitraryLocalBlocked = false;
  try {
    assertSafeTestEnvironment('http://evil-attacker.local:54321');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('REMOTE DATABASE MUTATION PREVENTED')) {
      arbitraryLocalBlocked = true;
    }
  }
  assert(arbitraryLocalBlocked, 'Arbitrary .local hostname rejected (permissive .local suffix removed)');

  // 4c. Arbitrary .test domain rejected (removal of permissive .test matching)
  let arbitraryTestBlocked = false;
  try {
    assertSafeTestEnvironment('http://staging-database.test:54321');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('REMOTE DATABASE MUTATION PREVENTED')) {
      arbitraryTestBlocked = true;
    }
  }
  assert(arbitraryTestBlocked, 'Arbitrary .test hostname rejected (permissive .test suffix removed)');

  // 4d. Malformed URLs rejected
  let malformedUrlBlocked = false;
  try {
    assertSafeTestEnvironment('not-a-valid-url-format');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Malformed Supabase URL format')) {
      malformedUrlBlocked = true;
    }
  }
  assert(malformedUrlBlocked, 'Malformed Supabase URL format rejected');

  // 4e. Invalid protocol (e.g. ftp:) rejected
  let invalidProtocolBlocked = false;
  try {
    assertSafeTestEnvironment('ftp://127.0.0.1:54321');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Invalid URL protocol')) {
      invalidProtocolBlocked = true;
    }
  }
  assert(invalidProtocolBlocked, 'Invalid URL protocol (ftp:) rejected; only http: and https: permitted');

  // 4f. Allowed explicit hostnames accepted
  let localLoopbackAccepted = false;
  try {
    const url = assertSafeTestEnvironment('http://127.0.0.1:54321');
    if (url === 'http://127.0.0.1:54321') localLoopbackAccepted = true;
  } catch {
    localLoopbackAccepted = false;
  }
  assert(localLoopbackAccepted, 'Explicit local hostname "127.0.0.1" accepted');

  let localhostAccepted = false;
  try {
    const url = assertSafeTestEnvironment('http://localhost:54321');
    if (url === 'http://localhost:54321') localhostAccepted = true;
  } catch {
    localhostAccepted = false;
  }
  assert(localhostAccepted, 'Explicit local hostname "localhost" accepted');

  // 4g. Production environment rejected
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    let prodBlocked = false;
    try {
      assertSafeTestEnvironment('http://127.0.0.1:54321');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('PRODUCTION ENVIRONMENT DETECTED')) {
        prodBlocked = true;
      }
    }
    assert(prodBlocked, 'Production environment (NODE_ENV=production) rejected in E2E safety guard');
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
  }

  // 4h. Vercel deployment environment rejected
  try {
    process.env.VERCEL = '1';
    let vercelBlocked = false;
    try {
      assertSafeTestEnvironment('http://127.0.0.1:54321');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('PRODUCTION ENVIRONMENT DETECTED')) {
        vercelBlocked = true;
      }
    }
    assert(vercelBlocked, 'Vercel environment (VERCEL=1) rejected in E2E safety guard');
  } finally {
    delete process.env.VERCEL;
  }

  // -------------------------------------------------------------------------
  // 5. Fail-Closed E2E User Deletion
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Fail-Closed E2E User Deletion ---');

  // 5a. Missing user record aborts deletion (never delete unknown user)
  let deletedInvoked = false;
  const mockClientNotFound = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: null }, error: null }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  let unknownUserRejected = false;
  try {
    await deleteTestUser('non-existent-user-id', mockClientNotFound);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Never delete an unknown user')) {
      unknownUserRejected = true;
    }
  }
  assert(unknownUserRejected && !deletedInvoked, 'Missing user record aborts deletion (never delete unknown user)');

  // 5b. Lookup error aborts deletion
  deletedInvoked = false;
  const mockClientLookupError = {
    auth: {
      admin: {
        getUserById: async () => ({ data: null, error: new Error('Postgres connection reset') }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  let lookupErrorRejected = false;
  try {
    await deleteTestUser('lookup-err-id', mockClientLookupError);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('getUserById lookup failed')) {
      lookupErrorRejected = true;
    }
  }
  assert(lookupErrorRejected && !deletedInvoked, 'Lookup error aborts deletion fail-closed');

  // 5c. User with missing/empty email aborts deletion
  deletedInvoked = false;
  const mockClientMissingEmail = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: 'u-1', email: null } }, error: null }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  let missingEmailRejected = false;
  try {
    await deleteTestUser('u-1', mockClientMissingEmail);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('no valid email address')) {
      missingEmailRejected = true;
    }
  }
  assert(missingEmailRejected && !deletedInvoked, 'User with null/missing email aborts deletion fail-closed');

  // 5d. Non-test user (@gmail.com) aborts deletion
  deletedInvoked = false;
  const mockClientGmailUser = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: 'u-real', email: 'admin@gmail.com' } }, error: null }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  let gmailUserRejected = false;
  try {
    await deleteTestUser('u-real', mockClientGmailUser);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Exact "@workspace.local" domain required')) {
      gmailUserRejected = true;
    }
  }
  assert(gmailUserRejected && !deletedInvoked, 'Non-test user (admin@gmail.com) deletion strictly rejected');

  // 5e. Subdomain/spoofed domain (@evil.workspace.local, @workspace.local.evil.com) aborts deletion
  deletedInvoked = false;
  const mockClientSpoofedUser = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: 'u-spoof', email: 'user@workspace.local.evil.com' } }, error: null }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  let spoofedUserRejected = false;
  try {
    await deleteTestUser('u-spoof', mockClientSpoofedUser);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Exact "@workspace.local" domain required')) {
      spoofedUserRejected = true;
    }
  }
  assert(spoofedUserRejected && !deletedInvoked, 'Spoofed domain (user@workspace.local.evil.com) deletion strictly rejected');

  // 5f. Genuine test user with exact @workspace.local domain permits deletion
  deletedInvoked = false;
  const mockClientValidTestUser = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: 'u-valid', email: 'test_user_12345@workspace.local' } }, error: null }),
        deleteUser: async () => { deletedInvoked = true; return { error: null }; },
      },
    },
  };
  await deleteTestUser('u-valid', mockClientValidTestUser);
  assert(deletedInvoked, 'Genuine test user (test_user_12345@workspace.local) permits deletion');

  // 5g. Razorpay test credentials fail closed
  const origKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const origSecret = process.env.RAZORPAY_KEY_SECRET;
  try {
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    let missingRazorpayCredsBlocked = false;
    try {
      getRazorpayTestCredentials();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Razorpay test credentials are required')) {
        missingRazorpayCredsBlocked = true;
      }
    }
    assert(missingRazorpayCredsBlocked, 'getRazorpayTestCredentials fails closed when credentials are not configured');
  } finally {
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = origKeyId;
    process.env.RAZORPAY_KEY_SECRET = origSecret;
  }

  // -------------------------------------------------------------------------
  // 6. Marketplace Trust Metrics Validation
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Marketplace Trust Metrics Validation ---');

  const mockRowNewClient = {
    id: 'job-test-1',
    title: 'Test Job',
    description: 'Test job description',
    client_id: 'client-1',
    project_type: 'fixed',
    budget_min: 500,
    budget_max: null,
    experience_level: 'intermediate',
    duration: '1_to_3_months',
    created_at: new Date().toISOString(),
    proposals_count: 0,
    is_featured: false,
    responsibilities: [],
    deliverables: [],
    profiles: {
      id: 'client-1',
      full_name: null,
      rating: 5.0,
      review_count: 0,
      total_spent: 0,
      created_at: new Date().toISOString(),
    },
    companies: null,
    categories: { id: 'cat-1', name: 'Engineering', slug: 'eng' },
    job_skills: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedJob1 = await formatJobForFrontend(mockRowNewClient as any);
  assert(mappedJob1.client.rating === null, 'Client with 0 reviews has rating=null (not defaulted to 5.0)');
  assert(mappedJob1.client.paymentVerified === false, 'Client with $0 spend has paymentVerified=false');
  assert(mappedJob1.client.hireRate === null, 'Client hire rate is null (not fabricated at 90%)');
  assert(mappedJob1.client.openJobsCount === null, 'Client openJobsCount is null (not fabricated at 1)');
  assert(mappedJob1.client.name === 'Client', 'Unnamed client defaults to "Client"');

  const mockRowEstablishedClient = {
    id: 'job-test-2',
    title: 'Enterprise Project',
    description: 'Enterprise project description',
    client_id: 'client-2',
    project_type: 'hourly',
    budget_min: 75,
    budget_max: 120,
    experience_level: 'expert',
    duration: '3_to_6_months',
    created_at: new Date().toISOString(),
    proposals_count: 3,
    is_featured: true,
    responsibilities: [],
    deliverables: [],
    profiles: {
      id: 'client-2',
      full_name: 'Acme Corp Hiring',
      rating: 4.85,
      review_count: 24,
      total_spent: 35000,
      created_at: new Date().toISOString(),
    },
    companies: { id: 'comp-1', name: 'Acme Corp', location: 'San Francisco, CA' },
    categories: { id: 'cat-1', name: 'Engineering', slug: 'eng' },
    job_skills: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedJob2 = await formatJobForFrontend(mockRowEstablishedClient as any);
  assert(mappedJob2.client.rating === 4.85, 'Client with verified reviews displays genuine rating (4.85)');
  assert(mappedJob2.client.paymentVerified === true, 'Client with confirmed spend displays paymentVerified=true');
  assert(mappedJob2.client.totalSpent === 35000, 'Client totalSpent displays genuine spend ($35,000)');

  // -------------------------------------------------------------------------
  // 7. Payout Disclosures & Simulation Metadata
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Payout Disclosures & Simulation Metadata ---');
  const metadata = getPayoutProviderMetadata();
  assert(metadata.isSimulated === true && metadata.mode === 'simulated', 'Payout registry explicitly discloses simulated mode (isSimulated=true)');
  assert(metadata.supportsActualPayouts === false, 'Payout registry confirms supportsActualPayouts=false');

  const payoutProvider = getPayoutProvider();
  assert(payoutProvider.name === 'mock_route', 'Active payout provider is mock_route');

  const transferProvider = getTransferProvider();
  assert(transferProvider.name === 'mock_route', 'Active transfer provider is mock_route');

  const simAccount = await payoutProvider.createPayoutAccount({
    userId: '00000000-0000-0000-0000-000000000001',
    email: 'test@workspace.local',
    legalName: 'Test Freelancer',
    bankName: 'Test Bank',
    bankIfsc: 'TEST0001234',
    accountNumberMasked: 'XXXXXX1234',
    panMasked: 'XXXXX1234F',
  });
  assert(simAccount.isSimulated === true, 'Simulated payout account response includes isSimulated=true');

  console.log('\n========================================================================');
  console.log(`VERIFICATION COMPLETE: ${passed}/${total} checks passed.`);
  console.log('========================================================================\n');
}

runVerification().catch((err) => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
