import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { processOutboxBatch } from '@/lib/email/outbox-processor';
import type { ProcessOutboxBatchResult } from '@/lib/email/types';

export const maxDuration = 60; // Supported on Vercel Hobby (up to 60s)

/**
 * Validates the caller's authorization header or secret token using constant-time comparison
 * to eliminate timing-attack side-channel vulnerabilities.
 */
function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || !expectedSecret.trim()) {
    // If CRON_SECRET is not configured in environment, fail closed for security
    return false;
  }

  // Check Authorization header (standard for Vercel Cron and pg_net: "Bearer <token>")
  const authHeader = request.headers.get('authorization');
  let providedToken: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    providedToken = authHeader.slice(7).trim();
  }

  // Fallback to x-cron-secret header if provided
  if (!providedToken) {
    providedToken = request.headers.get('x-cron-secret')?.trim() || null;
  }

  if (!providedToken) {
    return false;
    
  }

  const expectedBuffer = Buffer.from(expectedSecret.trim());
  const providedBuffer = Buffer.from(providedToken);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Core worker execution logic. Runs a time-budgeted batch loop to drain pending records
 * without exceeding the function duration limit or creating unmonitored background promises.
 */
async function executeEmailWorker(source: 'GET' | 'POST', request: NextRequest): Promise<NextResponse> {
  const requestStartTime = Date.now();

  // 1. Authenticate caller
  if (!isAuthorized(request)) {
    console.warn(JSON.stringify({
      level: 'WARN',
      event: 'email_worker_unauthorized',
      source,
      timestamp: new Date().toISOString(),
      message: 'Unauthorized attempt to invoke email outbox worker',
    }));

    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Valid CRON_SECRET required in Authorization or x-cron-secret header.',
      },
      { status: 401 }
    );
  }

  // 2. Parse batch size from query params (default: 10, max: 50)
  const searchParams = request.nextUrl.searchParams;
  const requestedBatchSize = parseInt(searchParams.get('batch_size') || '10', 10);
  const batchSize = Math.max(1, Math.min(Number.isNaN(requestedBatchSize) ? 10 : requestedBatchSize, 50));

  // Time budget: 45 seconds maximum execution to leave safe buffer before Vercel 60s timeout
  const TIME_BUDGET_MS = 45000;
  const workerId = `worker-cron-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let totalClaimed = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalSuppressed = 0;
  let batchIterations = 0;
  const allResults: ProcessOutboxBatchResult['results'] = [];

  try {
    // 3. Sequential Bounded Drain Loop (No fire-and-forget; every batch is strictly awaited)
    while (Date.now() - requestStartTime < TIME_BUDGET_MS) {
      batchIterations++;

      const batchResult = await processOutboxBatch({
        batchSize,
        workerId,
        lockTimeoutSeconds: 300,
        retryDelaySeconds: 60,
      });

      totalClaimed += batchResult.claimedCount;
      totalSent += batchResult.sentCount;
      totalFailed += batchResult.failedCount;
      totalSuppressed += batchResult.suppressedCount;
      allResults.push(...batchResult.results);

      // If no records were claimed, the queue is drained; break immediately
      if (batchResult.claimedCount === 0) {
        break;
      }

      // If claimed fewer than requested, no more ready records exist right now
      if (batchResult.claimedCount < batchSize) {
        break;
      }
    }

    const durationMs = Date.now() - requestStartTime;

    const summary = {
      level: 'INFO',
      event: 'email_worker_completed',
      source,
      workerId,
      batches: batchIterations,
      claimedCount: totalClaimed,
      sentCount: totalSent,
      failedCount: totalFailed,
      suppressedCount: totalSuppressed,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    if (totalClaimed > 0) {
      console.log(JSON.stringify(summary));
    }

    return NextResponse.json({
      success: true,
      workerId,
      batches: batchIterations,
      claimedCount: totalClaimed,
      sentCount: totalSent,
      failedCount: totalFailed,
      suppressedCount: totalSuppressed,
      durationMs,
      results: allResults,
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStartTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error(JSON.stringify({
      level: 'ERROR',
      event: 'email_worker_failure',
      source,
      workerId,
      error: errorMsg,
      durationMs,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json(
      {
        success: false,
        error: 'Email worker execution error',
        details: errorMsg,
        durationMs,
      },
      { status: 500 }
    );
  }
}

/**
 * GET Handler: Invoked by Vercel Cron or manual health-check request.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return executeEmailWorker('GET', request);
}

/**
 * POST Handler: Invoked by Supabase pg_cron + pg_net or webhook caller.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return executeEmailWorker('POST', request);
}
