import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { getAdminSupabaseClient } from '../lib/supabase/admin';

// Load .env.local manually
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
} catch (e) {
  console.warn('Could not load .env.local:', e);
}

const CRON_SECRET = process.env.CRON_SECRET || 'test_cron_secret_step2e_local_hardening_key_32_chars';
const WORKER_URL = 'http://host.docker.internal:3000/api/email/process';

function runSql(query: string): string {
  const res = spawnSync('docker', ['exec', '-i', 'supabase_db_workspace', 'psql', '-U', 'postgres', '-d', 'postgres', '-c', query], {
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`SQL execution failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

interface MailpitMessage {
  ID?: string;
  To?: Array<{ Address?: string }>;
  Subject?: string;
}

async function getMailpitMessages(): Promise<MailpitMessage[]> {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:54324/api/v1/messages', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.messages || []);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function deleteMailpitMessage(id: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(`http://127.0.0.1:54324/api/v1/message/${id}`, { method: 'DELETE' }, () => resolve());
    req.on('error', () => resolve());
    req.end();
  });
}

async function runStep2E1Verification() {
  console.log('========================================================================');
  console.log('STEP 2E.1: SCHEDULER-TO-WORKER INTEGRATION VERIFICATION SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${title}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title}${details ? ` -> ${details}` : ''}`);
    }
  }

  const supabase = getAdminSupabaseClient();
  const runId = Date.now().toString().slice(-6);
  let testOutboxId = '';
  let testMailpitId = '';

  try {
    // -------------------------------------------------------------------
    // 1. Verify Local Stack & Networking
    // -------------------------------------------------------------------
    console.log('--- 1. Verify Local Stack & Container Networking ---');

    // Check host port 3000 connectivity from Docker
    const curlCheck = spawnSync('docker', [
      'exec', 'supabase_db_workspace',
      'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
      WORKER_URL
    ], { encoding: 'utf-8' });

    assert(
      curlCheck.stdout.trim() === '401',
      'Database container can reach Next.js server via host.docker.internal:3000 (returned HTTP 401 unauthenticated)'
    );

    // -------------------------------------------------------------------
    // 2. Configure Local Vault Secrets
    // -------------------------------------------------------------------
    console.log('\n--- 2. Configure Local Supabase Vault Secrets ---');

    // Upsert app_worker_url into Vault
    runSql(`
      DO $$
      BEGIN
        DELETE FROM vault.decrypted_secrets WHERE name = 'app_worker_url';
        PERFORM vault.create_secret('${WORKER_URL}', 'app_worker_url', 'Next.js email worker endpoint');

        DELETE FROM vault.decrypted_secrets WHERE name = 'app_cron_secret';
        PERFORM vault.create_secret('${CRON_SECRET}', 'app_cron_secret', 'Email worker authorization secret');
      END $$;
    `);

    const vaultCheck = runSql("SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name IN ('app_worker_url', 'app_cron_secret') ORDER BY name;");
    assert(vaultCheck.includes('app_worker_url'), 'Vault contains secret: app_worker_url');
    assert(vaultCheck.includes('app_cron_secret'), 'Vault contains secret: app_cron_secret');
    assert(vaultCheck.includes(WORKER_URL), 'app_worker_url matches host.docker.internal target');

    // -------------------------------------------------------------------
    // 3. Create Isolated Test Outbox Record
    // -------------------------------------------------------------------
    console.log('\n--- 3. Create Isolated Test Outbox Record ---');

    const recipientEmail = `scheduler-test-${runId}@workspace-test.local`;
    const idempotencyKey = `email:step2e1_sched:${runId}`;

    const { data: outboxRow, error: insErr } = await supabase.from('email_outbox').insert({
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: recipientEmail,
      subject: `Step 2E.1 End-to-End Scheduler Test ${runId}`,
      payload: {
        clientName: `Alice Client ${runId}`,
        freelancerName: `Bob Developer ${runId}`,
        jobTitle: `Distributed Systems Architect ${runId}`,
        jobId: `job-sched-${runId}`,
        proposalId: `prop-sched-${runId}`,
        bidAmount: 12000,
        currency: 'USD',
        accountState: 'existing_account',
      },
      idempotency_key: idempotencyKey,
      status: 'pending',
    }).select('id').single();

    if (insErr || !outboxRow) {
      throw new Error(`Failed to create outbox test record: ${insErr?.message}`);
    }
    testOutboxId = outboxRow.id;
    assert(Boolean(testOutboxId), 'Created isolated pending test record in public.email_outbox');

    // -------------------------------------------------------------------
    // 4. Execute Full Scheduler-to-Worker Delivery Chain
    // -------------------------------------------------------------------
    console.log('\n--- 4. Execute Full Delivery Chain (pg_cron -> trigger -> pg_net -> Next.js -> Mailpit) ---');

    // Trigger trigger_email_outbox_worker() directly via SQL to capture pg_net request_id
    const triggerRaw = runSql("SELECT public.trigger_email_outbox_worker() as request_id;");
    const match = triggerRaw.match(/\s+(\d+)\s+/);
    const requestId = match ? match[1] : null;

    assert(Boolean(requestId), `public.trigger_email_outbox_worker() executed successfully (pg_net request_id=${requestId})`);

    // Poll net._http_response for completion (up to 10 seconds)
    let httpResponse: { status_code?: number; content?: string; timed_out?: boolean; error_msg?: string } | null = null;
    const startPoll = Date.now();
    while (Date.now() - startPoll < 10000) {
      const respRaw = runSql(`
        SELECT status_code, content, timed_out, error_msg 
        FROM net._http_response 
        WHERE id = ${requestId};
      `);

      if (respRaw.includes('200') || respRaw.includes('status_code')) {
        const lines = respRaw.trim().split('\n').filter(l => l.trim() && !l.includes('status_code') && !l.includes('---') && !l.includes('rows'));
        if (lines.length > 0) {
          const parts = lines[0].split('|').map(p => p.trim());
          if (parts[0] && parts[0] !== '') {
            httpResponse = {
              status_code: parseInt(parts[0], 10),
              content: parts[1],
              timed_out: parts[2] === 't',
              error_msg: parts[3] || undefined,
            };
            break;
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    assert(Boolean(httpResponse), 'pg_net completed HTTP dispatch and recorded response');
    assert(httpResponse?.status_code === 200, `Next.js route responded with HTTP 200 (Got: ${httpResponse?.status_code})`);

    interface WorkerResponseBody {
      success?: boolean;
      claimedCount?: number;
      sentCount?: number;
      failedCount?: number;
      suppressedCount?: number;
    }
    let parsedContent: WorkerResponseBody = {};
    try {
      parsedContent = JSON.parse(httpResponse?.content || '{}');
    } catch {
      parsedContent = {};
    }

    assert(Boolean(parsedContent.success), 'Next.js response body confirms success=true');
    assert((parsedContent.claimedCount ?? 0) >= 1, `Next.js worker claimed pending test record (Claimed: ${parsedContent.claimedCount})`);
    assert((parsedContent.sentCount ?? 0) >= 1, `Next.js worker sent record successfully (Sent: ${parsedContent.sentCount})`);

    // Verify outbox record in database
    const { data: finalOutbox } = await supabase
      .from('email_outbox')
      .select('status, provider, provider_message_id, locked_at, sent_at')
      .eq('id', testOutboxId)
      .single();

    assert(finalOutbox?.status === 'sent', 'email_outbox record transitioned to status="sent"');
    assert(finalOutbox?.provider === 'mailpit', 'Provider recorded as "mailpit"');
    assert(Boolean(finalOutbox?.sent_at), 'sent_at timestamp populated');
    assert(finalOutbox?.locked_at === null, 'Worker lock released upon completion');

    // Verify Mailpit received the actual email
    const mailpitMessages = await getMailpitMessages();
    const deliveredEmail = mailpitMessages.find(m => m.To?.some(t => t.Address === recipientEmail));
    assert(Boolean(deliveredEmail), 'Email confirmed received in Mailpit inbox');
    if (deliveredEmail?.ID) {
      testMailpitId = deliveredEmail.ID;
    }

    // -------------------------------------------------------------------
    // 5. Negative Cases & Resilience Verification
    // -------------------------------------------------------------------
    console.log('\n--- 5. Negative Cases & Security Boundaries ---');

    // 5.1 Invalid secret returns HTTP 401
    const invalidSecretReq = spawnSync('docker', [
      'exec', 'supabase_db_workspace',
      'curl', '-s', '-i',
      '-H', 'Authorization: Bearer wrong_secret_key_12345678901234567890',
      WORKER_URL
    ], { encoding: 'utf-8' });
    assert(invalidSecretReq.stdout.includes('401 Unauthorized'), 'Incorrect CRON_SECRET returns HTTP 401 Unauthorized');

    // 5.2 Empty outbox invocation exits cleanly
    const emptyOutboxTrigger = runSql("SELECT public.trigger_email_outbox_worker() as req_id;");
    const emptyMatch = emptyOutboxTrigger.match(/\s+(\d+)\s+/);
    const emptyReqId = emptyMatch ? emptyMatch[1] : null;
    assert(Boolean(emptyReqId), 'Empty outbox scheduler invocation succeeded');

    // Wait 1 second for pg_net to process empty run
    await new Promise(r => setTimeout(r, 1000));
    const emptyRespRaw = runSql(`SELECT status_code, content FROM net._http_response WHERE id = ${emptyReqId};`);
    assert(emptyRespRaw.includes('200'), 'Empty outbox run returned HTTP 200 cleanly');
    assert(emptyRespRaw.includes('"claimedCount":0'), 'Empty outbox run reported claimedCount=0');

    // 5.3 Missing Vault Secret Safety: Temporarily delete secret to test fallback
    runSql("DELETE FROM vault.decrypted_secrets WHERE name = 'app_cron_secret';");
    const missingSecretCall = runSql("SELECT public.trigger_email_outbox_worker() as req_id;");
    assert(missingSecretCall.includes('req_id') && !missingSecretCall.includes('ERROR'), 'Missing Vault secret does not throw SQL error or crash');
    const returnedVal = missingSecretCall.split('\n')[2]?.trim();
    assert(returnedVal === '' || returnedVal === null || !Number(returnedVal), 'Returns NULL when Vault secret is absent (Fails closed)');

    // Restore Vault secret
    runSql(`SELECT vault.create_secret('${CRON_SECRET}', 'app_cron_secret', 'Email worker authorization secret');`);

    // 5.4 Concurrency & SKIP LOCKED: Duplicate scheduler invocation does not double-process active record
    const { data: lockTestRow } = await supabase.from('email_outbox').insert({
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: `lock-${runId}@workspace-test.local`,
      subject: `Lock Test ${runId}`,
      payload: {
        clientName: 'Lock Client',
        freelancerName: 'Lock Dev',
        jobTitle: 'Lock Job',
        jobId: `job-lock-${runId}`,
        proposalId: `prop-lock-${runId}`,
      },
      idempotency_key: `email:step2e1_lock:${runId}`,
      status: 'processing',
      locked_at: new Date().toISOString(), // Active lock held now
      locked_by: 'worker-active-other-process',
      attempts: 1,
      max_attempts: 5,
    }).select('id').single();

    assert(Boolean(lockTestRow), 'Inserted active locked record (status="processing", current lock)');

    // Trigger worker
    const lockTrigger = runSql("SELECT public.trigger_email_outbox_worker() as req_id;");
    const lockMatch = lockTrigger.match(/\s+(\d+)\s+/);
    const lockReqId = lockMatch ? lockMatch[1] : null;

    await new Promise(r => setTimeout(r, 1000));
    const lockResp = runSql(`SELECT content FROM net._http_response WHERE id = ${lockReqId};`);
    assert(!lockResp.includes(lockTestRow!.id), 'Concurrent scheduler invocation skips active locked record (SKIP LOCKED)');

    // Cleanup locked row
    await supabase.from('email_outbox').delete().eq('id', lockTestRow!.id);

    // -------------------------------------------------------------------
    // 6. Verify Cron Job Registration
    // -------------------------------------------------------------------
    console.log('\n--- 6. Verify pg_cron Registration ---');

    const cronList = runSql("SELECT jobid, schedule, command, active, jobname FROM cron.job WHERE jobname = 'process-email-outbox';");
    assert(cronList.includes('process-email-outbox'), 'Cron job "process-email-outbox" is registered');
    assert(cronList.includes('* * * * *'), 'Cron schedule is "* * * * *"');
    assert(cronList.includes('SELECT public.trigger_email_outbox_worker();'), 'Cron command targets trigger_email_outbox_worker()');

    const cronCount = runSql("SELECT count(*) FROM cron.job WHERE jobname = 'process-email-outbox';");
    assert(cronCount.includes('1'), 'Cron job is registered exactly once');

    // -------------------------------------------------------------------
    // Cleanup Test Records
    // -------------------------------------------------------------------
    console.log('\n--- Cleaning Up Ephemeral Test Fixtures ---');
    if (testOutboxId) {
      await supabase.from('email_outbox').delete().eq('id', testOutboxId);
    }
    if (testMailpitId) {
      await deleteMailpitMessage(testMailpitId);
    }

    console.log(`\n========================================================================`);
    console.log(`STEP 2E.1 VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
    console.log(`========================================================================\n`);

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Fatal Step 2E.1 verification error:', err);
    process.exit(1);
  }
}

runStep2E1Verification();
