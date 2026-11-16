import { NextResponse } from 'next/server';

/**
 * Public Health Endpoint
 *
 * Provides minimal, non-sensitive application availability information for uptime monitors,
 * load balancers, and external health probes.
 *
 * STRICT COMPLIANCE RULES:
 * - Public response contains ONLY application status, timestamp, and basic availability info.
 * - NEVER exposes environment configuration, database counts, credentials, user data,
 *   or internal diagnostic messages.
 * - Authenticated administrative diagnostics are segregated to /api/admin/health.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      service: 'marketplace-api',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
