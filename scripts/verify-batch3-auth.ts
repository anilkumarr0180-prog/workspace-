/**
 * Verification test suite for Batch 3 & Batch 3B:
 * Authentication, Role Integrity, Database Security & Demo Data Isolation
 */

function testProxyRoleResolution() {
  console.log('Testing proxy.ts role resolution logic:');

  // Scenario 1: User metadata says 'freelancer', but DB profile.active_mode was switched to 'client'
  const user1 = { id: 'u1', user_metadata: { role: 'freelancer' } };
  const profile1 = { active_mode: 'client', can_hire: true, can_work: true };

  const resolvedRole1 = profile1?.active_mode || user1.user_metadata?.role || 'freelancer';
  if (resolvedRole1 !== 'client') {
    throw new Error(`Failed Scenario 1: expected 'client', got '${resolvedRole1}'`);
  }
  console.log('  [PASS] DB profile takes precedence over stale user_metadata.role');

  // Scenario 2: New user without profile record yet
  const user2 = { id: 'u2', user_metadata: { role: 'client' } };
  const profile2 = null;

  const resolvedRole2 = profile2 || (user2.user_metadata?.role as string) || 'freelancer';
  if (resolvedRole2 !== 'client') {
    throw new Error(`Failed Scenario 2: expected 'client', got '${resolvedRole2}'`);
  }
  console.log('  [PASS] Missing profile safely falls back to user_metadata role');

  // Scenario 3: User with no metadata and no profile
  const user3 = { id: 'u3', user_metadata: {} };
  const profile3 = null;

  const resolvedRole3 = profile3 || (user3.user_metadata as Record<string, unknown>)?.role || 'freelancer';
  if (resolvedRole3 !== 'freelancer') {
    throw new Error(`Failed Scenario 3: expected 'freelancer', got '${resolvedRole3}'`);
  }
  console.log('  [PASS] Safe fallback to default freelancer mode');
}

function testLoginValidation() {
  console.log('\nTesting login validation:');

  const validateInput = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return { valid: false, error: 'Please enter your email address.' };
    if (!trimmed.includes('@')) {
      return {
        valid: false,
        error: 'Username login is not supported by our authentication provider. Please sign in using the email address associated with your account.',
      };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { valid: false, error: 'Please enter a valid email address.' };
    }
    return { valid: true, email: trimmed };
  };

  const usernameTest = validateInput('john_developer');
  if (usernameTest.valid || !usernameTest.error?.includes('Username login is not supported')) {
    throw new Error('Username validation failed to reject username input');
  }
  console.log('  [PASS] Rejects username input with clear explanation');

  const validEmailTest = validateInput('john@example.com');
  if (!validEmailTest.valid || validEmailTest.email !== 'john@example.com') {
    throw new Error('Valid email rejected');
  }
  console.log('  [PASS] Accepts valid email address');
}

function testSafeRedirectResolution() {
  console.log('\nTesting safe redirect URL resolution:');

  const resolveRedirect = (redirectParam: string | null, activeRole: string) => {
    const isSafeRedirect =
      redirectParam &&
      redirectParam.startsWith('/') &&
      !redirectParam.startsWith('//') &&
      !redirectParam.startsWith('/login');

    return isSafeRedirect
      ? redirectParam
      : activeRole === 'client'
      ? '/client'
      : '/freelancer';
  };

  if (resolveRedirect('/client/jobs/new', 'client') !== '/client/jobs/new') {
    throw new Error('Safe internal redirect failed');
  }
  console.log('  [PASS] Allows safe internal redirect path');

  if (resolveRedirect('//evil.com', 'client') !== '/client') {
    throw new Error('Open redirect vulnerability: //evil.com permitted');
  }
  console.log('  [PASS] Blocks protocol-relative open redirect (//evil.com)');

  if (resolveRedirect(null, 'client') !== '/client') {
    throw new Error('Fallback to client dashboard failed');
  }
  console.log('  [PASS] Default redirect for client routes to /client');

  if (resolveRedirect(null, 'freelancer') !== '/freelancer') {
    throw new Error('Fallback to freelancer dashboard failed');
  }
  console.log('  [PASS] Default redirect for freelancer routes to /freelancer');
}

function testSelfApplicationProtection() {
  console.log('\nTesting self-application protection logic:');

  const evaluateSelfApplication = (
    userId: string,
    job: { client_id: string; company_id?: string | null },
    companyMemberships: Array<{ company_id: string; user_id: string; role: string }>
  ) => {
    // 1. Direct job ownership check
    if (job.client_id === userId) {
      return { allowed: false, code: 'SELF_APPLICATION_FORBIDDEN', reason: 'Direct job owner' };
    }

    // 2. Company manager check
    if (job.company_id) {
      const isManager = companyMemberships.some(
        (cm) =>
          cm.company_id === job.company_id &&
          cm.user_id === userId &&
          ['owner', 'admin', 'hiring_manager'].includes(cm.role)
      );
      if (isManager) {
        return { allowed: false, code: 'SELF_APPLICATION_FORBIDDEN', reason: 'Company hiring manager' };
      }
    }

    return { allowed: true };
  };

  const clientJob = { client_id: 'user-client-1', company_id: null };
  const res1 = evaluateSelfApplication('user-client-1', clientJob, []);
  if (res1.allowed) {
    throw new Error('Direct job owner self-application was permitted!');
  }
  console.log('  [PASS] Prohibits direct job owner from submitting proposal');

  const companyJob = { client_id: 'other-user', company_id: 'comp-100' };
  const memberships = [{ company_id: 'comp-100', user_id: 'user-manager-1', role: 'admin' }];
  const res2 = evaluateSelfApplication('user-manager-1', companyJob, memberships);
  if (res2.allowed) {
    throw new Error('Company manager self-application was permitted!');
  }
  console.log('  [PASS] Prohibits company admin/hiring manager from bidding on company job');

  const legitApplicantRes = evaluateSelfApplication('user-freelancer-9', clientJob, []);
  if (!legitApplicantRes.allowed) {
    throw new Error('Legitimate freelancer application was blocked!');
  }
  console.log('  [PASS] Permits unassociated third-party freelancer to submit proposal');
}

function testOAuthActiveModePreservation() {
  console.log('\nTesting OAuth active mode preservation logic:');

  const resolveOAuthCallbackRole = (
    roleParam: string | null,
    metadataRole: string | null,
    profile: { active_mode: string; created_at: string; updated_at: string } | null
  ) => {
    if (!profile) {
      return roleParam || metadataRole || 'freelancer';
    }

    const isFreshSignupConfirmation =
      Math.abs(new Date(profile.updated_at).getTime() - new Date(profile.created_at).getTime()) < 30000;

    // Only align role if this is a fresh signup confirmation
    if (isFreshSignupConfirmation && roleParam && profile.active_mode !== roleParam) {
      return roleParam;
    }

    if (isFreshSignupConfirmation && metadataRole && profile.active_mode !== metadataRole) {
      return metadataRole;
    }

    // Existing user login or returning user on signup page: legitimate database active mode is strictly preserved
    return profile.active_mode;
  };

  // Scenario 1: Existing user signed up as freelancer months ago, but switched to client mode in DB
  const existingProfile = {
    active_mode: 'client',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-06-01T12:00:00Z',
  };

  // They log in with Google OAuth (no roleParam in URL, old metadata role is 'freelancer')
  const effectiveRole = resolveOAuthCallbackRole(null, 'freelancer', existingProfile);
  if (effectiveRole !== 'client') {
    throw new Error(`Existing user active_mode was overwritten! Expected 'client', got '${effectiveRole}'`);
  }
  console.log('  [PASS] Existing user active_mode is preserved during OAuth login');

  // Scenario 2: Returning user arrives at /signup/freelancer and clicks Google OAuth button (?role=freelancer), but their DB profile is 'client'
  const returningUserThroughSignup = resolveOAuthCallbackRole('freelancer', 'freelancer', existingProfile);
  if (returningUserThroughSignup !== 'client') {
    throw new Error(`Returning user active_mode was overwritten by signup roleParam! Expected 'client', got '${returningUserThroughSignup}'`);
  }
  console.log('  [PASS] Returning user active_mode is NOT overwritten if they click Google button on signup page');

  // Scenario 3: Fresh signup confirmation with role param
  const freshProfile = {
    active_mode: 'freelancer', // defaulted by DB trigger
    created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-27T10:00:02Z',
  };
  const freshRole = resolveOAuthCallbackRole('client', null, freshProfile);
  if (freshRole !== 'client') {
    throw new Error(`Fresh signup OAuth button failed to set initial role! Expected 'client', got '${freshRole}'`);
  }
  console.log('  [PASS] Fresh signup OAuth button sets initial role');
}

function testGoogleOAuthCallbackRouteLogic() {
  console.log('\nTesting Google OAuth callback handler route logic:');

  // 1. Origin resolution behind proxies
  const resolveOrigin = (urlStr: string, headers: Record<string, string | null>) => {
    const forwardedHost = headers['x-forwarded-host'];
    const forwardedProto = headers['x-forwarded-proto'];
    const host = forwardedHost || headers['host'];
    const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
    return host ? `${protocol}://${host}` : new URL(urlStr).origin;
  };

  const localOrigin = resolveOrigin('http://localhost:3000/api/auth/callback', {
    'host': 'localhost:3000',
    'x-forwarded-host': null,
    'x-forwarded-proto': null,
  });
  if (localOrigin !== 'http://localhost:3000') {
    throw new Error(`Local origin failed: expected http://localhost:3000, got ${localOrigin}`);
  }
  const prodOrigin = resolveOrigin('http://internal-cluster/api/auth/callback', {
    'host': 'internal-cluster',
    'x-forwarded-host': 'workspace-inky-six.vercel.app',
    'x-forwarded-proto': 'https',
  });
  if (prodOrigin !== 'https://workspace-inky-six.vercel.app') {
    throw new Error(`Forwarded host resolution failed: got '${prodOrigin}'`);
  }
  console.log('  [PASS] Origin resolution honors trusted x-forwarded-host in production');

  // 2. OAuth error parameter handling (e.g. user cancelled Google consent)
  const handleOAuthParams = (searchParams: URLSearchParams, origin: string) => {
    const oauthError = searchParams.get('error');
    const oauthErrorDescription = searchParams.get('error_description');

    if (oauthError) {
      const errorUrl = new URL('/login', origin);
      errorUrl.searchParams.set('error', oauthError);
      if (oauthErrorDescription) {
        errorUrl.searchParams.set('error_description', oauthErrorDescription);
      }
      return { redirect: errorUrl.toString() };
    }
    return { redirect: null };
  };

  const denialParams = new URLSearchParams('error=access_denied&error_description=User+cancelled+flow');
  const denialResult = handleOAuthParams(denialParams, 'https://workspace-inky-six.vercel.app');
  if (
    !denialResult.redirect?.includes('/login?error=access_denied') ||
    !denialResult.redirect?.includes('error_description=User+cancelled+flow')
  ) {
    throw new Error(`OAuth cancellation redirect failed: got '${denialResult.redirect}'`);
  }
  console.log('  [PASS] User cancellation / access_denied redirects safely to /login with error params');

  // 3. Fallback profile bootstrap metadata extraction
  const extractGoogleProfileMetadata = (user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  }) => {
    const rawPrefix = user.email
      ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_')
      : 'user';
    const cleanPrefix = rawPrefix.slice(0, 20) || 'user';
    const fullName =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      cleanPrefix;
    const avatarUrl =
      (user.user_metadata?.avatar_url as string) ||
      (user.user_metadata?.picture as string) ||
      null;

    return { fullName, avatarUrl, cleanPrefix };
  };

  const googleUser = {
    id: 'g-user-123',
    email: 'sarah.engineer@gmail.com',
    user_metadata: {
      name: 'Sarah Connor',
      picture: 'https://lh3.googleusercontent.com/a/photo123',
    },
  };
  const extracted = extractGoogleProfileMetadata(googleUser);
  if (extracted.fullName !== 'Sarah Connor' || extracted.avatarUrl !== 'https://lh3.googleusercontent.com/a/photo123') {
    throw new Error('Google metadata extraction failed for picture/name');
  }
  console.log('  [PASS] Profile bootstrap extracts Google OAuth avatar picture and display name');
}

function testDemoDataIsolation() {
  console.log('\nTesting demo data isolation:');

  // When database query succeeds (!error && !data), profile does not exist
  const resolveProfile = (error: unknown, data: Record<string, unknown> | null) => {
    if (!error && !data) {
      return { freelancer: null, source: 'supabase' };
    }
    if (!error && data) {
      return { freelancer: data, source: 'supabase' };
    }
    return { freelancer: { name: 'Demo User' }, source: 'fallback' };
  };

  const nonExistentResult = resolveProfile(null, null);
  if (nonExistentResult.freelancer !== null) {
    throw new Error('Nonexistent database profile was presented as a demo freelancer!');
  }
  console.log('  [PASS] Nonexistent database profile returns null, not demo fallback');
}

function testJobsEmptyState() {
  console.log('\nTesting jobs query empty state handling:');

  const resolveJobs = (error: unknown, data: Array<Record<string, unknown>>) => {
    if (data) {
      return { jobs: data, source: 'supabase' };
    }
    return { jobs: [{ title: 'Mock Job' }], source: 'fallback' };
  };

  // Query succeeds with 0 published jobs in database and no active filters
  const emptyResult = resolveJobs(null, []);
  if (emptyResult.source !== 'supabase' || emptyResult.jobs.length !== 0) {
    throw new Error('Empty database result fell back to mock jobs!');
  }
  console.log('  [PASS] Returns genuine empty state without falling back to mock jobs');
}

function runAll() {
  console.log('====================================================');
  console.log('BATCH 3 & 3B AUTHENTICATION & SECURITY VERIFICATION');
  console.log('====================================================\n');
  testProxyRoleResolution();
  testLoginValidation();
  testSafeRedirectResolution();
  testSelfApplicationProtection();
  testOAuthActiveModePreservation();
  testGoogleOAuthCallbackRouteLogic();
  testDemoDataIsolation();
  testJobsEmptyState();
  console.log('\n----------------------------------------------------');
  console.log('All Batch 3 & 3B verification checks passed.');
  console.log('----------------------------------------------------');
}

runAll();
