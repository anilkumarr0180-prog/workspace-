import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env.local manually
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                const key = trimmed.slice(0, idx).trim();
                let val = trimmed.slice(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    }
} catch (e) {
    console.error('Error reading .env.local:', e);
}

import { spawnSync } from 'child_process';

function runSql(sql: string): string {
    const res = spawnSync('docker', [
        'exec', '-i', 'supabase_db_workspace',
        'psql', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1',
        '-t', '-A', '-q'
    ], {
        input: sql,
        encoding: 'utf-8'
    });
    if (res.error) throw res.error;
    if (res.status !== 0 || (res.stderr && res.stderr.includes('ERROR:'))) {
        const errMsg = (res.stderr || '') + '\n' + (res.stdout || '');
        throw new Error(errMsg.trim() || `psql process exited with ${res.status}`);
    }
    return res.stdout.trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function runVerification() {
    console.log('===============================================================');
    console.log('STEP 2A: EMAIL OUTBOX DATABASE MIGRATION VERIFICATION SUITE');
    console.log('===============================================================\n');

    let passedChecks = 0;
    let totalChecks = 0;

    function assert(condition: boolean, name: string, detail?: string) {
        totalChecks++;
        if (condition) {
            console.log(`✅ [PASS] ${name}`);
            passedChecks++;
        } else {
            console.error(`❌ [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
        }
    }

    // -------------------------------------------------------------
    // 1. Table Existence and Column Audit
    // -------------------------------------------------------------
    console.log('\n--- 1. Table Schema & Column Audit ---');
    const tableExists = runSql("SELECT to_regclass('public.email_outbox');");
    assert(tableExists === 'public.email_outbox' || tableExists === 'email_outbox', 'Table public.email_outbox exists');

    const expectedColumns = [
        'id', 'event_type', 'template_key', 'recipient_email', 'recipient_user_id',
        'subject', 'payload', 'related_entity_id', 'status', 'attempts', 'max_attempts',
        'next_attempt_at', 'last_attempt_at', 'sent_at', 'failed_at', 'last_error',
        'provider', 'provider_message_id', 'idempotency_key', 'locked_at', 'locked_by',
        'created_at', 'updated_at'
    ];

    const actualColumns = runSql(`
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'email_outbox';
    `).split(',');

    const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
    assert(missingColumns.length === 0, 'All 23 required columns exist', `Missing: ${missingColumns.join(', ')}`);

    // -------------------------------------------------------------
    // 2. Constraints Audit
    // -------------------------------------------------------------
    console.log('\n--- 2. Database Constraints Audit ---');
    const constraints = runSql(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.email_outbox'::regclass;
    `).split('\n');

    assert(constraints.includes('chk_email_outbox_status'), 'chk_email_outbox_status exists');
    assert(constraints.includes('chk_email_outbox_attempts'), 'chk_email_outbox_attempts exists');
    assert(constraints.includes('chk_email_outbox_max_attempts'), 'chk_email_outbox_max_attempts exists');
    assert(constraints.includes('chk_email_outbox_recipient'), 'chk_email_outbox_recipient exists');
    assert(constraints.includes('chk_email_outbox_subject'), 'chk_email_outbox_subject exists');
    assert(constraints.includes('uq_email_outbox_idempotency_key'), 'uq_email_outbox_idempotency_key exists');

    // Test status constraint rejection
    let invalidStatusRejected = false;
    try {
        runSql(`
            INSERT INTO public.email_outbox (
                event_type, template_key, recipient_email, subject, status, idempotency_key
            ) VALUES (
                'test_event', 'test_tpl', 'test@example.com', 'Subject', 'invalid_status_xyz', 'idem_test_bad_status'
            );
        `);
    } catch (err: unknown) {
        if (err instanceof Error && (err.message.includes('chk_email_outbox_status') || err.message.includes('violates check constraint'))) {
            invalidStatusRejected = true;
        }
    }
    assert(invalidStatusRejected, 'chk_email_outbox_status rejects invalid status values');

    // Test idempotency key duplicate rejection
    let duplicateRejected = false;
    const testIdemKey = `idem_test_${Date.now()}`;
    runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key
        ) VALUES (
            'test_event', 'test_tpl', 'test@example.com', 'Subject', '${testIdemKey}'
        );
    `);
    try {
        runSql(`
            INSERT INTO public.email_outbox (
                event_type, template_key, recipient_email, subject, idempotency_key
            ) VALUES (
                'test_event_2', 'test_tpl_2', 'test2@example.com', 'Subject 2', '${testIdemKey}'
            );
        `);
    } catch (err: unknown) {
        if (err instanceof Error && (err.message.includes('uq_email_outbox_idempotency_key') || err.message.includes('duplicate key value'))) {
            duplicateRejected = true;
        }
    }
    assert(duplicateRejected, 'Unique constraint rejects duplicate idempotency_key values');

    // Clean up initial test row
    runSql(`DELETE FROM public.email_outbox WHERE idempotency_key = '${testIdemKey}';`);

    // -------------------------------------------------------------
    // 3. Indexes Audit
    // -------------------------------------------------------------
    console.log('\n--- 3. Performance & Worker Indexes Audit ---');
    const indexes = runSql(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'email_outbox';
    `).split('\n');

    assert(indexes.includes('idx_email_outbox_claimable'), 'idx_email_outbox_claimable index exists');
    assert(indexes.includes('idx_email_outbox_status'), 'idx_email_outbox_status index exists');
    assert(indexes.includes('idx_email_outbox_recipient_user'), 'idx_email_outbox_recipient_user index exists');
    assert(indexes.includes('idx_email_outbox_event_entity'), 'idx_email_outbox_event_entity index exists');

    // -------------------------------------------------------------
    // 4. Concurrency Worker Functions Testing
    // -------------------------------------------------------------
    console.log('\n--- 4. Concurrency Worker Stored Procedures Audit ---');

    // Insert 2 records: one ready to claim, one scheduled in future
    const keyReady = `test_claim_ready_${Date.now()}`;
    const keyFuture = `test_claim_future_${Date.now()}`;

    runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, next_attempt_at, status
        ) VALUES 
        ('worker_test', 'tpl_ready', 'ready@example.com', 'Ready Test', '${keyReady}', now() - interval '1 minute', 'pending'),
        ('worker_test', 'tpl_future', 'future@example.com', 'Future Test', '${keyFuture}', now() + interval '1 hour', 'pending');
    `);

    // Claim batch of 1
    const claimedId = runSql(`
        SELECT id FROM public.claim_outbox_emails(1, 'worker-node-1', 300);
    `);
    const claimedRecord = runSql(`
        SELECT idempotency_key || '|' || status || '|' || locked_by || '|' || attempts
        FROM public.email_outbox
        WHERE id = '${claimedId}';
    `);
    assert(claimedRecord.startsWith(`${keyReady}|processing|worker-node-1|1`), 'claim_outbox_emails correctly claims only ready pending record and increments attempts');

    // Try claiming again with same worker or another worker (should not claim the same record or the future record)
    const claimedSecond = runSql(`
        SELECT count(*) FROM public.claim_outbox_emails(10, 'worker-node-2', 300);
    `);
    assert(claimedSecond === '0', 'claim_outbox_emails skips locked and future pending records (FOR UPDATE SKIP LOCKED)');

    // Test mark_outbox_email_sent
    runSql(`SELECT public.mark_outbox_email_sent('${claimedId}', 'mailpit_smtp', 'msg_12345');`);
    const sentRecord = runSql(`
        SELECT status || '|' || provider || '|' || provider_message_id || '|' || (locked_at IS NULL)::text
        FROM public.email_outbox
        WHERE id = '${claimedId}';
    `);
    assert(sentRecord === 'sent|mailpit_smtp|msg_12345|true', 'mark_outbox_email_sent transitions status to sent, stores provider info, and clears lock');

    // Test mark_outbox_email_failed and retry / dead_letter
    const keyFail = `test_fail_${Date.now()}`;
    const failId = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, max_attempts, attempts, status
        ) VALUES (
            'worker_test', 'tpl_fail', 'fail@example.com', 'Fail Test', '${keyFail}', 2, 1, 'processing'
        ) RETURNING id;
    `);

    // First failure (attempts 1 < max 2 -> status 'failed')
    runSql(`SELECT public.mark_outbox_email_failed('${failId}', 'SMTP timeout connection refused', 30);`);
    const failRecord1 = runSql(`
        SELECT status || '|' || last_error || '|' || (locked_at IS NULL)::text
        FROM public.email_outbox
        WHERE id = '${failId}';
    `);
    assert(failRecord1 === 'failed|SMTP timeout connection refused|true', 'mark_outbox_email_failed sets status=failed with delay when attempts < max_attempts');

    // Second failure: simulate retry claim then fail again
    runSql(`UPDATE public.email_outbox SET attempts = 2 WHERE id = '${failId}';`);
    runSql(`SELECT public.mark_outbox_email_failed('${failId}', 'Fatal SMTP 550 recipient rejected', 30);`);
    const deadLetterRecord = runSql(`
        SELECT status || '|' || last_error
        FROM public.email_outbox
        WHERE id = '${failId}';
    `);
    assert(deadLetterRecord === 'dead_letter|Fatal SMTP 550 recipient rejected', 'mark_outbox_email_failed transitions to dead_letter when attempts reach max_attempts');

    // Test stale lock recovery: worker crash / timeout
    const keyStale = `test_stale_${Date.now()}`;
    const staleId = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, status, locked_at, locked_by
        ) VALUES (
            'worker_test', 'tpl_stale', 'stale@example.com', 'Stale Test', '${keyStale}', 'processing', now() - interval '10 minutes', 'crashed-worker'
        ) RETURNING id;
    `);
    const reclaimedId = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'recovery-worker', 300);`);
    const reclaimedRecord = runSql(`SELECT status || '|' || locked_by FROM public.email_outbox WHERE id = '${staleId}';`);
    assert(reclaimedId === staleId && reclaimedRecord === 'processing|recovery-worker', 'claim_outbox_emails recovers stale processing locks after lock timeout');
    runSql(`DELETE FROM public.email_outbox WHERE id = '${staleId}';`);

    // Clean up worker test records
    runSql(`DELETE FROM public.email_outbox WHERE idempotency_key IN ('${keyReady}', '${keyFuture}', '${keyFail}');`);

    // -------------------------------------------------------------
    // 5. Security & RLS Isolation Audit
    // -------------------------------------------------------------
    console.log('\n--- 5. Security, Grants & RLS Isolation Audit ---');
    const rlsEnabled = runSql(`
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.email_outbox'::regclass;
    `);
    assert(rlsEnabled === 't', 'Row Level Security is ENABLED on public.email_outbox');

    // Verify Supabase Anon Client cannot access email_outbox
    const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY);
    const anonReadResult = await supabaseAnon.from('email_outbox').select('*');
    assert(
        anonReadResult.error !== null || (anonReadResult.data && anonReadResult.data.length === 0),
        'Supabase Anon client CANNOT read from email_outbox (Blocked by RLS & Revoked Privileges)'
    );

    const anonInsertResult = await supabaseAnon.from('email_outbox').insert({
        event_type: 'hacker_event',
        template_key: 'malicious',
        recipient_email: 'anon@hack.com',
        subject: 'Spam',
        idempotency_key: `anon_${Date.now()}`
    });
    assert(
        anonInsertResult.error !== null,
        'Supabase Anon client CANNOT insert into email_outbox (Blocked by RLS & Revoked Privileges)'
    );

    // Verify Supabase Service Role Client CAN operate cleanly
    const supabaseService = createClient(SUPABASE_URL, SERVICE_KEY);
    const serviceTestKey = `service_test_${Date.now()}`;
    const serviceInsertResult = await supabaseService.from('email_outbox').insert({
        event_type: 'proposal_received',
        template_key: 'proposal_received_v1',
        recipient_email: 'client@workspace.local',
        subject: 'New proposal received for your job',
        payload: { job_title: 'Full Stack Engineer', proposal_id: 'prop-123' },
        idempotency_key: serviceTestKey
    }).select().single();

    assert(
        serviceInsertResult.error === null && serviceInsertResult.data?.idempotency_key === serviceTestKey,
        'Supabase Service Role client CAN insert and read from email_outbox'
    );

    // Clean up service test record
    if (serviceInsertResult.data?.id) {
        await supabaseService.from('email_outbox').delete().eq('id', serviceInsertResult.data.id);
    }

    // -------------------------------------------------------------
    // 6. Database Regression Audit
    // -------------------------------------------------------------
    console.log('\n--- 6. Database Regression & Existing Tables Audit ---');
    const coreTables = ['profiles', 'companies', 'jobs', 'proposals', 'contracts', 'notifications', 'messages', 'conversations'];
    let allCoreTablesIntact = true;
    for (const table of coreTables) {
        const count = runSql(`SELECT count(*) FROM public.${table};`);
        if (isNaN(Number(count))) {
            allCoreTablesIntact = false;
            console.error(`Core table check failed for ${table}: ${count}`);
        }
    }
    assert(allCoreTablesIntact, 'All 8 core business tables (profiles, companies, jobs, proposals, contracts, notifications, messages, conversations) are intact');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`VERIFICATION COMPLETE: ${passedChecks}/${totalChecks} CHECKS PASSED`);
    console.log('===============================================================\n');

    if (passedChecks !== totalChecks) {
        process.exit(1);
    }
}

runVerification().catch(err => {
    console.error('Fatal verification error:', err);
    process.exit(1);
});
