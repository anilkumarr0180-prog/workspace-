import { spawnSync } from 'child_process';
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

async function runStep2A1Verification() {
    console.log('========================================================================');
    console.log('STEP 2A.1: EMAIL OUTBOX RETRY BOUNDARY & SECURITY VERIFICATION SUITE');
    console.log('========================================================================\n');

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

    // Clean any initial state
    runSql('DELETE FROM public.email_outbox;');

    // -------------------------------------------------------------
    // SCENARIO 1: Normal pending -> processing -> sent
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Normal pending -> processing -> sent ---');
    const s1Key = `s1_${Date.now()}`;
    const s1Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status
        ) VALUES (
            'test_evt', 'tpl_1', 'user1@test.com', 'Subject 1', '${s1Key}', 0, 3, 'pending'
        ) RETURNING id;
    `);

    // Claim
    const s1Claimed = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'w1', 300);`);
    const s1RowProcessing = runSql(`SELECT status || '|' || attempts || '|' || locked_by FROM public.email_outbox WHERE id = '${s1Id}';`);
    assert(s1Claimed === s1Id && s1RowProcessing === 'processing|1|w1', 'Scenario 1: Claimed pending record into processing with attempts=1');

    // Mark sent
    runSql(`SELECT public.mark_outbox_email_sent('${s1Id}', 'mailpit_smtp', 'msg-101');`);
    const s1RowSent = runSql(`SELECT status || '|' || provider || '|' || provider_message_id || '|' || (locked_at IS NULL)::text FROM public.email_outbox WHERE id = '${s1Id}';`);
    assert(s1RowSent === 'sent|mailpit_smtp|msg-101|true', 'Scenario 1: Completed sent transition and cleared lock');

    // -------------------------------------------------------------
    // SCENARIO 2: Pending -> processing -> failed -> processing -> sent
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Pending -> processing -> failed -> processing -> sent ---');
    const s2Key = `s2_${Date.now()}`;
    const s2Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status
        ) VALUES (
            'test_evt', 'tpl_2', 'user2@test.com', 'Subject 2', '${s2Key}', 0, 3, 'pending'
        ) RETURNING id;
    `);

    // Claim 1
    const s2Claim1 = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'w1', 300);`);
    assert(s2Claim1 === s2Id, 'Scenario 2: First claim succeeded');

    // Mark failed with delay 0 for immediate retry eligibility
    runSql(`SELECT public.mark_outbox_email_failed('${s2Id}', 'Transient SMTP network failure', 0);`);
    const s2RowFailed = runSql(`SELECT status || '|' || attempts || '|' || (locked_at IS NULL)::text || '|' || (next_attempt_at <= now())::text FROM public.email_outbox WHERE id = '${s2Id}';`);
    assert(s2RowFailed === 'failed|1|true|true', 'Scenario 2: mark_outbox_email_failed set status=failed without double-incrementing attempts and cleared lock');

    // Claim 2
    const s2Claim2 = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'w2', 300);`);
    const s2RowProcessing2 = runSql(`SELECT status || '|' || attempts || '|' || locked_by FROM public.email_outbox WHERE id = '${s2Id}';`);
    assert(s2Claim2 === s2Id && s2RowProcessing2 === 'processing|2|w2', 'Scenario 2: Re-claimed failed record, attempts incremented to 2');

    // Mark sent
    runSql(`SELECT public.mark_outbox_email_sent('${s2Id}', 'mailpit_smtp', 'msg-202');`);
    const s2RowSent = runSql(`SELECT status || '|' || attempts FROM public.email_outbox WHERE id = '${s2Id}';`);
    assert(s2RowSent === 'sent|2', 'Scenario 2: Delivered successfully on second attempt');

    // -------------------------------------------------------------
    // SCENARIO 3: Maximum attempts reached -> dead_letter
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Maximum attempts reached -> dead_letter ---');
    const s3Key = `s3_${Date.now()}`;
    const s3Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status
        ) VALUES (
            'test_evt', 'tpl_3', 'user3@test.com', 'Subject 3', '${s3Key}', 0, 2, 'pending'
        ) RETURNING id;
    `);

    // Attempt 1
    runSql(`SELECT public.claim_outbox_emails(1, 'w1', 300);`);
    runSql(`SELECT public.mark_outbox_email_failed('${s3Id}', 'Error 1', 0);`);

    // Attempt 2 (final attempt: attempts = 2, max_attempts = 2)
    runSql(`SELECT public.claim_outbox_emails(1, 'w1', 300);`);
    const s3Attempt2 = runSql(`SELECT attempts || '|' || max_attempts FROM public.email_outbox WHERE id = '${s3Id}';`);
    assert(s3Attempt2 === '2|2', 'Scenario 3: Final attempt claimed with attempts=2 (matching max_attempts)');

    // Mark failed on final attempt -> MUST become dead_letter
    runSql(`SELECT public.mark_outbox_email_failed('${s3Id}', 'Permanent fatal error 550', 0);`);
    const s3DeadLetter = runSql(`SELECT status || '|' || attempts || '|' || (locked_at IS NULL)::text FROM public.email_outbox WHERE id = '${s3Id}';`);
    assert(s3DeadLetter === 'dead_letter|2|true', 'Scenario 3: Exhausted retries moved to dead_letter with lock released');

    // Verify cannot be claimed again
    const s3SubsequentClaim = runSql(`SELECT count(*) FROM public.claim_outbox_emails(10, 'w1', 300);`);
    assert(s3SubsequentClaim === '0', 'Scenario 3: dead_letter record cannot be claimed');

    // -------------------------------------------------------------
    // SCENARIO 4: Worker crash -> stale lock recovery below attempt limit
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Worker crash -> stale lock recovery below limit ---');
    const s4Key = `s4_${Date.now()}`;
    const s4Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, locked_at, locked_by
        ) VALUES (
            'test_evt', 'tpl_4', 'user4@test.com', 'Subject 4', '${s4Key}', 1, 3, 'processing', now() - interval '10 minutes', 'crashed-worker-4'
        ) RETURNING id;
    `);

    // Claim with timeout 300s (5 mins) -> lock was 10 mins ago
    const s4Claim = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'recovering-worker', 300);`);
    const s4RowRecovered = runSql(`SELECT status || '|' || attempts || '|' || locked_by FROM public.email_outbox WHERE id = '${s4Id}';`);
    assert(s4Claim === s4Id && s4RowRecovered === 'processing|2|recovering-worker', 'Scenario 4: Stale processing record below max_attempts successfully recovered and attempts incremented to 2');

    // -------------------------------------------------------------
    // SCENARIO 5: Worker crash on final attempt -> dead_letter after lock expiry
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Worker crash on final attempt -> dead_letter after lock expiry ---');
    const s5Key = `s5_${Date.now()}`;
    const s5Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, locked_at, locked_by
        ) VALUES (
            'test_evt', 'tpl_5', 'user5@test.com', 'Subject 5', '${s5Key}', 3, 3, 'processing', now() - interval '10 minutes', 'crashed-worker-final'
        ) RETURNING id;
    `);

    // Worker calls claim_outbox_emails: the stale lock at max_attempts MUST be swept to dead_letter, NOT claimed
    const s5Claim = runSql(`SELECT count(*) FROM public.claim_outbox_emails(10, 'sweeper-worker', 300);`);
    assert(s5Claim === '0', 'Scenario 5: Stale record at max_attempts was NOT claimed as processing');

    const s5RowSwept = runSql(`SELECT status || '|' || attempts || '|' || (locked_at IS NULL)::text FROM public.email_outbox WHERE id = '${s5Id}';`);
    assert(s5RowSwept === 'dead_letter|3|true', 'Scenario 5: Stale record at max_attempts automatically transitioned to dead_letter');

    // -------------------------------------------------------------
    // SCENARIO 6: Pending record already at max attempts cannot be claimed
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Record at max attempts cannot be claimed ---');
    const s6Key = `s6_${Date.now()}`;
    runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, next_attempt_at
        ) VALUES (
            'test_evt', 'tpl_6', 'user6@test.com', 'Subject 6', '${s6Key}', 3, 3, 'pending', now() - interval '1 minute'
        );
    `);

    const s6Claim = runSql(`SELECT count(*) FROM public.claim_outbox_emails(10, 'w1', 300);`);
    assert(s6Claim === '0', 'Scenario 6: Pending record with attempts >= max_attempts is ignored by claim_outbox_emails');

    // -------------------------------------------------------------
    // SCENARIO 7: Concurrent workers cannot claim the same record
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Concurrency & SKIP LOCKED ---');
    const s7Key = `s7_${Date.now()}`;
    const s7Id = runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, next_attempt_at
        ) VALUES (
            'test_evt', 'tpl_7', 'user7@test.com', 'Subject 7', '${s7Key}', 0, 3, 'pending', now() - interval '1 minute'
        ) RETURNING id;
    `);

    // Worker 1 claims
    const s7Claim1 = runSql(`SELECT id FROM public.claim_outbox_emails(1, 'concurrent-worker-1', 300);`);
    assert(s7Claim1 === s7Id, 'Scenario 7: Worker 1 successfully claimed pending record');

    // Worker 2 attempts claim while record is locked by Worker 1
    const s7Claim2 = runSql(`SELECT count(*) FROM public.claim_outbox_emails(1, 'concurrent-worker-2', 300);`);
    assert(s7Claim2 === '0', 'Scenario 7: Worker 2 receives 0 records (SKIP LOCKED prevents double claiming)');

    // -------------------------------------------------------------
    // SCENARIO 8: Sent records cannot be reclaimed
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Sent records cannot be reclaimed ---');
    const s8Key = `s8_${Date.now()}`;
    runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, next_attempt_at
        ) VALUES (
            'test_evt', 'tpl_8', 'user8@test.com', 'Subject 8', '${s8Key}', 1, 3, 'sent', now() - interval '1 minute'
        );
    `);

    const s8Claim = runSql(`SELECT count(*) FROM public.claim_outbox_emails(10, 'w1', 300);`);
    assert(s8Claim === '0', 'Scenario 8: Sent record cannot be claimed');

    // -------------------------------------------------------------
    // SCENARIO 9: Dead-letter records cannot be reclaimed
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Dead-letter records cannot be reclaimed ---');
    const s9Key = `s9_${Date.now()}`;
    runSql(`
        INSERT INTO public.email_outbox (
            event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status, next_attempt_at
        ) VALUES (
            'test_evt', 'tpl_9', 'user9@test.com', 'Subject 9', '${s9Key}', 3, 3, 'dead_letter', now() - interval '1 minute'
        );
    `);

    const s9Claim = runSql(`SELECT count(*) FROM public.claim_outbox_emails(10, 'w1', 300);`);
    assert(s9Claim === '0', 'Scenario 9: Dead-letter record cannot be claimed');

    // -------------------------------------------------------------
    // ADDITIONAL SECURITY & CONSTRAINT CHECKS
    // -------------------------------------------------------------
    console.log('\n--- Additional Constraint & Security Verification ---');

    // Test attempts <= max_attempts constraint
    let constraintRejected = false;
    try {
        runSql(`
            INSERT INTO public.email_outbox (
                event_type, template_key, recipient_email, subject, idempotency_key, attempts, max_attempts, status
            ) VALUES (
                'test_evt', 'tpl_bad', 'bad@test.com', 'Bad Subject', 'bad_attempts_${Date.now()}', 6, 5, 'pending'
            );
        `);
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('chk_email_outbox_attempts_limit')) {
            constraintRejected = true;
        }
    }
    assert(constraintRejected, 'chk_email_outbox_attempts_limit rejects attempts > max_attempts at schema level');

    // Test argument sanitization
    const safeClaimTest = runSql(`SELECT count(*) FROM public.claim_outbox_emails(-5, '', -10);`);
    assert(safeClaimTest === '0', 'claim_outbox_emails safely handles negative/empty arguments without SQL error');

    // Clean up all test rows
    runSql('DELETE FROM public.email_outbox;');
    const finalCount = runSql('SELECT count(*) FROM public.email_outbox;');
    assert(finalCount === '0', 'All test rows cleaned up, email_outbox table is clean');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`STEP 2A.1 VERIFICATION COMPLETE: ${passedChecks}/${totalChecks} CHECKS PASSED`);
    console.log('========================================================================\n');

    if (passedChecks !== totalChecks) {
        process.exit(1);
    }
}

runStep2A1Verification().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
