/**
 * Strict E2E Test Environment Safety Validation
 *
 * Rules:
 * - Reject permissive suffix matching (.local, .test)
 * - Explicitly allow only required local Supabase hostnames
 * - Validate URL protocol (http:, https:) and hostname
 * - Reject malformed URLs
 * - Validate every configured Supabase URL
 * - Reject production and Vercel environments in the Playwright configuration itself
 * - Shared safety validation implementation for helpers and playwright config
 * - Fail closed on every validation error
 */

export const ALLOWED_LOCAL_HOSTNAMES = new Set([
  '127.0.0.1',
  'localhost',
  '0.0.0.0',
  'host.docker.internal',
  'kong',
  'supabase',
]);

/**
 * Validates a single Supabase target URL against strict local safety rules.
 * Throws immediately with a clear explanation if the URL is malformed or targets non-local hosts.
 */
export function validateSingleSupabaseUrl(rawUrl: string, source: string): void {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(
      `[E2E SAFETY GUARD BLOCKED]: Missing or empty Supabase URL in ${source}. Fail-closed.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `[E2E SAFETY GUARD BLOCKED]: Malformed Supabase URL format in ${source}: "${rawUrl}". ` +
      'Cannot verify test environment safety. Halting execution.'
    );
  }

  // Validate protocol
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(
      `[E2E SAFETY GUARD BLOCKED]: Invalid URL protocol "${protocol}" in ${source}: "${rawUrl}". Only http: and https: are permitted.`
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new Error(
      `[E2E SAFETY GUARD BLOCKED]: Missing hostname in ${source}: "${rawUrl}". Fail-closed.`
    );
  }

  // Explicitly reject remote hosted Supabase and Vercel domains
  const isHostedDomain =
    hostname.endsWith('supabase.co') ||
    hostname.endsWith('supabase.in') ||
    hostname.endsWith('supabase.net') ||
    hostname.endsWith('vercel.app');

  // Strictly allow ONLY explicit local hostnames.
  // Permissive suffix matching (.local, .test) is strictly prohibited.
  const isAllowed = ALLOWED_LOCAL_HOSTNAMES.has(hostname);

  if (isHostedDomain || !isAllowed) {
    const errorMsg =
      '\n================================================================================\n' +
      '[E2E SAFETY GUARD BLOCKED: REMOTE DATABASE MUTATION PREVENTED]\n' +
      '================================================================================\n' +
      `E2E tests cannot execute against non-local host in ${source}: "${hostname}".\n` +
      `Host must be strictly one of: ${Array.from(ALLOWED_LOCAL_HOSTNAMES).join(', ')}.\n` +
      'Arbitrary .local or .test domains are strictly prohibited.\n' +
      '================================================================================\n';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Validates the entire E2E test environment.
 * Validates candidate target URL, PLAYWRIGHT_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_URL.
 * Rejects production and Vercel deployments.
 */
export function assertSafeTestEnvironment(candidateUrl?: string): string {
  // Reject production and Vercel environments immediately
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.VERCEL === '1'
  ) {
    const errorMsg =
      '\n================================================================================\n' +
      '[E2E SAFETY GUARD BLOCKED: PRODUCTION ENVIRONMENT DETECTED]\n' +
      '================================================================================\n' +
      'E2E tests cannot execute with NODE_ENV="production" or in a VERCEL deployment.\n' +
      'Destructive database mutations and test user operations are strictly prohibited.\n' +
      '================================================================================\n';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Validate candidateUrl if provided
  if (candidateUrl) {
    validateSingleSupabaseUrl(candidateUrl, 'explicit target parameter');
  }

  // Validate every configured Supabase URL
  if (process.env.PLAYWRIGHT_SUPABASE_URL) {
    validateSingleSupabaseUrl(process.env.PLAYWRIGHT_SUPABASE_URL, 'PLAYWRIGHT_SUPABASE_URL');
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    validateSingleSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  }

  const effectiveUrl =
    candidateUrl ||
    process.env.PLAYWRIGHT_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'http://127.0.0.1:54321';

  validateSingleSupabaseUrl(effectiveUrl, 'effective target URL');
  return effectiveUrl;
}

