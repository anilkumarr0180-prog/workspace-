import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminSupabaseClient } from '../../../../lib/supabase/admin';

/**
 * Validates administrative caller authorization using timing-safe comparison.
 * Requires dedicated ADMIN_HEALTH_SECRET token via Authorization header (Bearer) or x-admin-secret.
 * The legacy CRON_SECRET fallback is strictly removed.
 * Uses SHA-256 pre-hashing before comparison to ensure strictly constant-time evaluation
 * without disclosing token length.
 */
function verifyAdminSecret(request: NextRequest): { authorized: boolean; configError?: string } {
  const adminSecret = process.env.ADMIN_HEALTH_SECRET;
  if (!adminSecret || !adminSecret.trim()) {
    return {
      authorized: false,
      configError: 'Administrative health endpoint is not configured. Dedicated ADMIN_HEALTH_SECRET is required.',
    };
  }

  const authHeader = request.headers.get('authorization');
  let providedToken: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    providedToken = authHeader.slice(7).trim();
  }

  if (!providedToken) {
    providedToken = request.headers.get('x-admin-secret')?.trim() || null;
  }

  if (!providedToken) {
    return { authorized: false };
  }

  const expectedHash = crypto.createHash('sha256').update(adminSecret.trim()).digest();
  const providedHash = crypto.createHash('sha256').update(providedToken).digest();

  const isMatch = crypto.timingSafeEqual(expectedHash, providedHash);
  return { authorized: isMatch };
}

export interface AdminHealthOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  injectedAdminClient?: any;
}

/**
 * Core Administrative Health & Diagnostics Handler
 *
 * Accessible strictly by authorized platform administrators / ops monitors.
 * Reports diagnostic telemetry, infrastructure connectivity, and summary metrics.
 * NEVER exposes raw credentials, secrets, or internal database error messages.
 */
export async function handleAdminHealthCheck(request: NextRequest, options?: AdminHealthOptions) {
  const authResult = verifyAdminSecret(request);

  if (authResult.configError) {
    return NextResponse.json(
      {
        error: authResult.configError,
      },
      { status: 500 }
    );
  }

  if (!authResult.authorized) {
    return NextResponse.json(
      {
        error: 'Unauthorized. Valid administrative credentials required.',
      },
      { status: 401 }
    );
  }

  let jobsCheckPassed = false;
  let totalJobsInDb = 0;
  let proposalsCheckPassed = false;
  let totalProposalsInDb = 0;

  try {
    const admin = options?.injectedAdminClient || getAdminSupabaseClient();

    // Check 1: Jobs query (executed independently)
    try {
      const { count: jobCount, error: jErr } = await admin
        .from('jobs')
        .select('*', { count: 'exact', head: true });

      if (!jErr && jobCount !== null) {
        jobsCheckPassed = true;
        totalJobsInDb = jobCount;
      } else if (jErr) {
        console.error('[Admin Health Diagnostics] Jobs query error:', jErr.message);
      }
    } catch (jException) {
      console.error('[Admin Health Diagnostics] Jobs query exception:', jException);
    }

    // Check 2: Proposals query (executed independently)
    try {
      const { count: propCount, error: pErr } = await admin
        .from('proposals')
        .select('*', { count: 'exact', head: true });

      if (!pErr && propCount !== null) {
        proposalsCheckPassed = true;
        totalProposalsInDb = propCount;
      } else if (pErr) {
        console.error('[Admin Health Diagnostics] Proposals query error:', pErr.message);
      }
    } catch (pException) {
      console.error('[Admin Health Diagnostics] Proposals query exception:', pException);
    }
  } catch (clientErr) {
    console.error('[Admin Health Diagnostics] Supabase client initialization error:', clientErr);
  }

  // All required diagnostic checks must succeed to report healthy
  const isHealthy = jobsCheckPassed && proposalsCheckPassed;

  return NextResponse.json(
    {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks: {
        database: isHealthy,
        jobsQuery: jobsCheckPassed,
        proposalsQuery: proposalsCheckPassed,
      },
      summary: {
        totalJobs: totalJobsInDb,
        totalProposals: totalProposalsInDb,
      },
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

/**
 * Route handler for GET /api/admin/health
 */
export async function GET(request: NextRequest) {
  return handleAdminHealthCheck(request);
}
