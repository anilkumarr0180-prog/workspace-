import fs from 'fs';
import path from 'path';
import { processOutboxBatch } from '../lib/email/outbox-processor';
import type { ProcessOutboxBatchResult } from '../lib/email/types';

// Load .env.local manually for standalone Node.js execution
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // Ignore if unable to read
}

/**
 * Local Development Email Outbox Worker
 * 
 * Continuously polls the local public.email_outbox table and processes pending
 * transactional emails, dispatching them via Nodemailer to local Mailpit.
 * 
 * Usage:
 *   npx tsx scripts/dev-email-worker.ts          # Continuous polling loop (every 3s)
 *   npx tsx scripts/dev-email-worker.ts --once   # Single batch run
 */

const isOnce = process.argv.includes('--once');
const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
let isRunning = true;

const workerId = `dev-worker-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;

console.log('========================================================================');
console.log('WORKSPACE: LOCAL DEVELOPMENT EMAIL OUTBOX WORKER');
console.log('========================================================================');
console.log(`Worker ID:      ${workerId}`);
console.log(`Mode:           ${isOnce ? 'Single-Execution (--once)' : 'Continuous Polling'}`);
console.log(`Poll Interval:  ${pollIntervalMs} ms`);
console.log(`Email Provider: ${process.env.EMAIL_PROVIDER || 'mailpit'}`);
console.log('Press Ctrl+C to terminate gracefully.\n');

// Handle termination signals
process.on('SIGINT', () => {
  console.log('\n[dev-worker] Received SIGINT. Shutting down gracefully...');
  isRunning = false;
});

process.on('SIGTERM', () => {
  console.log('\n[dev-worker] Received SIGTERM. Shutting down gracefully...');
  isRunning = false;
});

async function runWorkerIteration(): Promise<ProcessOutboxBatchResult> {
  try {
    const result = await processOutboxBatch({
      batchSize: 10,
      workerId,
      lockTimeoutSeconds: 60,
      retryDelaySeconds: 15,
    });

    if (result.claimedCount > 0) {
      console.log(
        `[${new Date().toISOString()}] Batch processed: ` +
        `claimed=${result.claimedCount}, sent=${result.sentCount}, ` +
        `failed=${result.failedCount}, suppressed=${result.suppressedCount}`
      );

      for (const item of result.results) {
        if (item.status === 'sent') {
          console.log(`  -> [SENT] id=${item.id} provider=${item.provider} msgId=${item.providerMessageId || 'N/A'}`);
        } else if (item.status === 'suppressed') {
          console.log(`  -> [SUPPRESSED] id=${item.id} reason="${item.suppressionReason}"`);
        } else if (item.status === 'failed') {
          console.error(`  -> [FAILED] id=${item.id} error="${item.error}"`);
        }
      }
    }

    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toISOString()}] [dev-worker] Error processing batch: ${errorMsg}`);
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      results: [{ id: 'error', success: false, error: errorMsg }],
    };
  }
}

async function main() {
  if (isOnce) {
    const result = await runWorkerIteration();
    console.log(`[dev-worker] Single run complete. (Claimed: ${result.claimedCount})`);
    process.exit(result.failedCount > 0 ? 1 : 0);
  }

  while (isRunning) {
    await runWorkerIteration();
    if (!isRunning) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log('[dev-worker] Worker process stopped.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[dev-worker] Fatal worker crash:', err);
  process.exit(1);
});
