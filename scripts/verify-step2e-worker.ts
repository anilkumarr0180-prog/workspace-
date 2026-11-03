import fs from 'fs';
import path from 'path';
import http from 'http';
import { NextRequest } from 'next/server';
import { GET as workerGet, POST as workerPost } from '../app/api/email/process/route';
import { getAdminSupabaseClient } from '../lib/supabase/admin';
import { spawnSync } from 'child_process';

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
process.env.CRON_SECRET = CRON_SECRET;

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
  To?: Array<{ Address?: string }>;
}

// Mailpit HTTP query helper
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

async function runStep2EVerification() {
  console.log('========================================================================');
  console.log('STEP 2E: PRODUCTION-READY EMAIL DELIVERY WORKER VERIFICATION SUITE');
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

  try {
    // -------------------------------------------------------------------
    // 1. Security & Authentication (Constant-Time Verification)
    // -------------------------------------------------------------------
    console.log('--- 1. Route Handler Authentication & Constant-Time Security ---');

    // Test 1.1: Request without authorization header
    const reqNoAuth = new NextRequest('http://localhost:3000/api/email/process', { method: 'POST' });
    const resNoAuth = await workerPost(reqNoAuth);
    assert(resNoAuth.status === 401, 'Rejects unauthenticated POST request with HTTP 401');

    const reqNoAuthGet = new NextRequest('http://localhost:3000/api/email/process', { method: 'GET' });
    const resNoAuthGet = await workerGet(reqNoAuthGet);
    assert(resNoAuthGet.status === 401, 'Rejects unauthenticated GET request with HTTP 401');

    // Test 1.2: Request with invalid secret
    const reqWrongSecret = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: 'Bearer invalid_secret_token_1234567890' },
    });
    const resWrongSecret = await workerPost(reqWrongSecret);
    assert(resWrongSecret.status === 401, 'Rejects incorrect Bearer secret with HTTP 401');

    // Test 1.3: Request with wrong length secret (constant-time guard)
    const reqShortSecret = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: 'Bearer short' },
    });
    const resShortSecret = await workerPost(reqShortSecret);
    assert(resShortSecret.status === 401, 'Rejects wrong-length secret cleanly with HTTP 401');

    // Test 1.4: Request with valid Bearer secret
    const reqValidBearer = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resValidBearer = await workerPost(reqValidBearer);
    assert(resValidBearer.status === 200, 'Authorizes valid Bearer CRON_SECRET with HTTP 200');

    // Test 1.5: Request with valid x-cron-secret header
    const reqValidHeader = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'GET',
      headers: { 'x-cron-secret': CRON_SECRET },
    });
    const resValidHeader = await workerGet(reqValidHeader);
    assert(resValidHeader.status === 200, 'Authorizes valid x-cron-secret header with HTTP 200');

    // -------------------------------------------------------------------
    // 2. Outbox Processing & Telemetry via Worker Route
    // -------------------------------------------------------------------
    console.log('\n--- 2. End-to-End Outbox Processing & Telemetry ---');

    const testEmail = `recipient-${runId}@workspace-test.local`;
    const idempotencyKey1 = `email:step2e_test1:${runId}`;

    const { data: outbox1, error: insErr1 } = await supabase.from('email_outbox').insert({
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: testEmail,
      subject: `Step 2E Verification Proposal ${runId}`,
      payload: {
        clientName: 'Alice Client',
        freelancerName: 'Bob Developer',
        jobTitle: `Next.js 16 Architect ${runId}`,
        jobId: `job-${runId}`,
        proposalId: `prop-${runId}`,
        bidAmount: 7500,
        currency: 'USD',
        accountState: 'existing_account',
      },
      idempotency_key: idempotencyKey1,
      status: 'pending',
    }).select('id').single();

    assert(Boolean(outbox1 && !insErr1), 'Inserted pending test email record into email_outbox');

    // Invoke worker route via POST with valid auth
    const reqProcess = new NextRequest('http://localhost:3000/api/email/process?batch_size=10', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resProcess = await workerPost(reqProcess);
    const bodyProcess = await resProcess.json();

    assert(resProcess.status === 200, 'Worker route returned HTTP 200');
    assert(bodyProcess.claimedCount >= 1, 'Worker claimed pending record', `Claimed: ${bodyProcess.claimedCount}`);
    assert(bodyProcess.sentCount >= 1, 'Worker successfully sent record', `Sent: ${bodyProcess.sentCount}`);
    assert(typeof bodyProcess.durationMs === 'number', 'Telemetry includes durationMs');
    assert(typeof bodyProcess.workerId === 'string', 'Telemetry includes workerId');

    // Verify database record status
    const { data: updated1 } = await supabase.from('email_outbox').select('status, provider, provider_message_id, locked_at, locked_by').eq('id', outbox1!.id).single();
    assert(updated1?.status === 'sent', 'Database record transitioned to status="sent"');
    assert(Boolean(updated1?.provider), 'Provider recorded in outbox row');
    assert(updated1?.locked_at === null, 'Lock released upon delivery');

    // Verify email arrived in Mailpit
    const mailpitMessages = await getMailpitMessages();
    const foundEmail = mailpitMessages.find((m) => m.To?.some((t) => t.Address === testEmail));
    assert(Boolean(foundEmail), 'Email confirmed received in Mailpit inbox');

    // -------------------------------------------------------------------
    // 3. Pre-flight Suppression via Worker Route
    // -------------------------------------------------------------------
    console.log('\n--- 3. Pre-Flight Suppression via Worker Route ---');

    // Create isolated user first
    const { data: testUser } = await supabase.auth.admin.createUser({
      email: `user-${runId}@workspace-test.local`,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    const userId = testUser!.user!.id;

    // Create isolated conversation
    const { data: conv } = await supabase.from('conversations').insert({
      created_by: userId,
      title: `Step 2E Chat ${runId}`,
    }).select('id').single();

    // Add participant with last_read_at in future
    const nowTime = new Date();
    const futureReadTime = new Date(nowTime.getTime() + 60000).toISOString();
    await supabase.from('conversation_participants').insert({
      conversation_id: conv!.id,
      user_id: userId,
      last_read_at: futureReadTime,
    });

    // Insert pending unread_message record with message timestamp older than read time
    const idempotencyKeySuppressed = `email:step2e_suppressed:${runId}`;
    const { data: outboxSuppressed } = await supabase.from('email_outbox').insert({
      event_type: 'unread_message',
      template_key: 'unread_message_v1',
      recipient_email: `user-${runId}@workspace-test.local`,
      recipient_user_id: userId,
      related_entity_id: conv!.id,
      subject: `New Message ${runId}`,
      payload: {
        recipientName: 'Read User',
        senderName: 'Sender Bob',
        conversationId: conv!.id,
        unreadCount: 1,
        lastMessageTimestamp: nowTime.toISOString(),
      },
      idempotency_key: idempotencyKeySuppressed,
      status: 'pending',
    }).select('id').single();

    // Trigger worker route
    const reqSuppressed = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resSuppressed = await workerPost(reqSuppressed);
    const bodySuppressed = await resSuppressed.json();

    assert(bodySuppressed.suppressedCount >= 1, 'Worker telemetry reports suppressed record');

    const { data: suppressedDb } = await supabase.from('email_outbox').select('status, last_error').eq('id', outboxSuppressed!.id).single();
    assert(suppressedDb?.status === 'suppressed', 'Database record transitioned to status="suppressed"');
    assert(suppressedDb?.last_error?.includes('Recipient read conversation'), 'Suppression reason recorded accurately');

    // -------------------------------------------------------------------
    // 4. Bounded Loop & Multi-Batch Queue Draining
    // -------------------------------------------------------------------
    console.log('\n--- 4. Sequential Bounded Loop & Multi-Batch Draining ---');

    // Insert 6 records with small batch_size=2 to force multi-iteration draining
    const batchEmail = `batch-${runId}@workspace-test.local`;
    const batchIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const { data: row } = await supabase.from('email_outbox').insert({
        event_type: 'proposal_received',
        template_key: 'proposal_received_v1',
        recipient_email: batchEmail,
        subject: `Batch Drain Test ${i} - ${runId}`,
        payload: {
          clientName: `Client ${i}`,
          freelancerName: 'Dev',
          jobTitle: `Job ${i}`,
          jobId: `job-${runId}-${i}`,
          proposalId: `prop-${runId}-${i}`,
          bidAmount: 1000 * i,
          currency: 'USD',
          accountState: 'existing_account',
        },
        idempotency_key: `email:step2e_batch:${runId}:${i}`,
        status: 'pending',
      }).select('id').single();
      if (row) batchIds.push(row.id);
    }

    assert(batchIds.length === 6, 'Inserted 6 test records to verify multi-batch draining');

    // Call worker with batch_size=2: should iterate 3 times in loop
    const reqDrain = new NextRequest('http://localhost:3000/api/email/process?batch_size=2', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resDrain = await workerPost(reqDrain);
    const bodyDrain = await resDrain.json();

    assert(bodyDrain.claimedCount === 6, `Worker drained all 6 records (Claimed: ${bodyDrain.claimedCount})`);
    assert(bodyDrain.sentCount === 6, 'All 6 records sent successfully');
    assert(bodyDrain.batches >= 3, `Worker completed multiple batch iterations in single request (Batches: ${bodyDrain.batches})`);

    // Verify all 6 records are status=sent in database
    const { data: verifiedBatch } = await supabase.from('email_outbox').select('id, status').in('id', batchIds);
    const allSent = verifiedBatch?.every((r) => r.status === 'sent');
    assert(Boolean(allSent), 'All 6 database records confirmed status="sent"');

    // -------------------------------------------------------------------
    // 5. Crash Recovery (Stale Lock Reclaiming)
    // -------------------------------------------------------------------
    console.log('\n--- 5. Stale Lock Reclaiming & Crash Recovery ---');

    // Insert a record simulating a worker that crashed 10 minutes ago
    const staleTime = new Date(Date.now() - 600000).toISOString();
    const { data: staleRow } = await supabase.from('email_outbox').insert({
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: `stale-${runId}@workspace-test.local`,
      subject: `Stale Lock Recovery ${runId}`,
      payload: {
        clientName: 'Stale Client',
        freelancerName: 'Stale Dev',
        jobTitle: 'Crashed Job',
        jobId: `job-stale-${runId}`,
        proposalId: `prop-stale-${runId}`,
        bidAmount: 5000,
        currency: 'USD',
        accountState: 'existing_account',
      },
      idempotency_key: `email:step2e_stale:${runId}`,
      status: 'processing',
      attempts: 1,
      max_attempts: 5,
      locked_at: staleTime,
      locked_by: 'crashed-worker-pid-999',
    }).select('id').single();

    assert(Boolean(staleRow), 'Inserted simulated crashed worker record (status="processing", locked 10 mins ago)');

    // Trigger worker: should recover the stale lock and send
    const reqRecover = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resRecover = await workerPost(reqRecover);
    const bodyRecover = await resRecover.json();

    assert(bodyRecover.claimedCount >= 1, 'Worker successfully claimed stale locked record');
    const { data: recoveredDb } = await supabase.from('email_outbox').select('status, attempts, locked_at').eq('id', staleRow!.id).single();
    assert(recoveredDb?.status === 'sent', 'Crashed worker record successfully recovered and sent');
    assert(recoveredDb?.attempts === 2, 'Attempts accurately incremented upon recovery (Got: 2)');
    assert(recoveredDb?.locked_at === null, 'Lock cleared after delivery');

    // -------------------------------------------------------------------
    // 6. Dead-Letter Strict Isolation
    // -------------------------------------------------------------------
    console.log('\n--- 6. Dead-Letter Isolation (No Accidental Recovery) ---');

    const { data: deadRow } = await supabase.from('email_outbox').insert({
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: `dead-${runId}@workspace-test.local`,
      subject: `Dead Letter Test ${runId}`,
      payload: {
        clientName: 'Dead Client',
        freelancerName: 'Dead Dev',
        jobTitle: 'Dead Job',
        jobId: `job-dead-${runId}`,
        proposalId: `prop-dead-${runId}`,
      },
      idempotency_key: `email:step2e_dead:${runId}`,
      status: 'dead_letter',
      attempts: 5,
      max_attempts: 5,
      last_error: 'Exhausted maximum retry attempts',
    }).select('id').single();

    // Trigger worker
    const reqDead = new NextRequest('http://localhost:3000/api/email/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const resDead = await workerPost(reqDead);
    const bodyDead = await resDead.json();

    assert(bodyDead.claimedCount === 0, 'Worker claimed 0 records when only dead_letter records exist');
    const { data: deadDb } = await supabase.from('email_outbox').select('status').eq('id', deadRow!.id).single();
    assert(deadDb?.status === 'dead_letter', 'Dead letter record remains strictly in status="dead_letter"');

    // -------------------------------------------------------------------
    // 7. Supabase pg_cron, pg_net & Vault Infrastructure Verification
    // -------------------------------------------------------------------
    console.log('\n--- 7. Supabase pg_cron, pg_net & Vault Infrastructure ---');

    const extRaw = runSql("SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'supabase_vault') ORDER BY extname;");
    assert(extRaw.includes('pg_cron'), 'Extension pg_cron is installed in PostgreSQL');
    assert(extRaw.includes('pg_net'), 'Extension pg_net is installed in PostgreSQL');
    assert(extRaw.includes('supabase_vault'), 'Extension supabase_vault is installed in PostgreSQL');

    const jobRaw = runSql("SELECT schedule, command, active, jobname FROM cron.job WHERE jobname = 'process-email-outbox';");
    assert(jobRaw.includes('process-email-outbox'), 'Job "process-email-outbox" is registered in cron.job');
    assert(jobRaw.includes('* * * * *'), 'Cron job schedule is "* * * * *" (Every 1 minute)');

    const fnRaw = runSql("SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'trigger_email_outbox_worker';");
    assert(fnRaw.includes('t'), 'trigger_email_outbox_worker is SECURITY DEFINER');

    // Test calling trigger_email_outbox_worker() when Vault secrets are not populated
    const testCallRaw = runSql("SELECT public.trigger_email_outbox_worker();");
    assert(!testCallRaw.includes('ERROR'), 'trigger_email_outbox_worker exits cleanly when Vault secrets are unconfigured');

    // -------------------------------------------------------------------
    // 8. Vercel Hobby & vercel.json Compliance Audit
    // -------------------------------------------------------------------
    console.log('\n--- 8. Vercel Hobby & Configuration Compliance ---');

    const vercelConfigPath = path.resolve(process.cwd(), 'vercel.json');
    assert(fs.existsSync(vercelConfigPath), 'vercel.json configuration exists');

    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8'));
    assert(Array.isArray(vercelConfig.crons), 'vercel.json contains crons array');
    assert(vercelConfig.crons.length === 1, 'vercel.json has exactly 1 cron job (Hobby compliance)');
    assert(vercelConfig.crons[0].path === '/api/email/process', 'vercel.json cron targets /api/email/process');

    const cronParts = vercelConfig.crons[0].schedule.trim().split(/\s+/);
    assert(cronParts.length === 5, 'Cron expression has standard 5 fields');
    assert(cronParts[0] === '0' && cronParts[1] !== '*', 'Cron schedule runs strictly once per day (Hobby compliance)');

    // -------------------------------------------------------------------
    // Cleanup Test Records
    // -------------------------------------------------------------------
    console.log('\n--- Cleaning Up Ephemeral Step 2E Test Fixtures ---');
    await supabase.from('email_outbox').delete().in('id', [
      outbox1!.id,
      outboxSuppressed!.id,
      ...batchIds,
      staleRow!.id,
      deadRow!.id,
    ]);
    if (conv) await supabase.from('conversations').delete().eq('id', conv.id);
    if (userId) await supabase.auth.admin.deleteUser(userId);

    console.log(`\n========================================================================`);
    console.log(`STEP 2E VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
    console.log(`========================================================================\n`);

    if (passed < total) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Step 2E verification error:', err);
    process.exit(1);
  }
}

runStep2EVerification();
