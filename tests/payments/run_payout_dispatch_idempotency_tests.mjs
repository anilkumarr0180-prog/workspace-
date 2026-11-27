/**
 * Phase 2C.7.3.2.1 — Real PostgreSQL Dispatch Idempotency Tests
 *
 * Validates hardened record_payout_transfer_dispatch() (migration 20261127000006).
 * Uses real separate PostgreSQL backend connections (docker exec psql).
 *
 * Does NOT initiate real provider transfers.
 * Does NOT modify historical payout records (completed/processing).
 * Does NOT reset the database.
 *
 * Fixture strategy:
 *   Uses timesheet 54fdb74f (paid, no active payout, no ledger rows) on
 *   contract 87b0d9c7. Inserts a fresh payout_transfers row (pending) each run.
 *   After E.1 (confirm_payout_transfer_completion), a ledger row is created for
 *   PT_ID, so cleanup deletes only PT_ID_F (failed sibling). PT_ID is left as a
 *   completed test fixture — it's on a test timesheet with no production data.
 */

import { execSync, spawn } from 'child_process';

const CONTAINER = 'supabase_db_workspace';
const RUN = 'R' + Math.random().toString(36).slice(2, 8).toUpperCase();

// Fixture foreign-key references (test data, same contract used by prior concurrency tests)
const CONTRACT_ID    = '87b0d9c7-5b6e-410d-bb41-32bc799de80b';
const TIMESHEET_ID   = '54fdb74f-1ad3-4705-a57b-3188236afcf6';  // paid, no active payout, no ledger rows
const RECIPIENT_ID   = '1121cd79-c1c2-4deb-b49a-97bdce21103c';
const PROVIDER_ACCT  = 'acct_test';

// Fresh UUIDs per run
const RUN_HEX = Buffer.from(RUN).toString('hex').slice(0, 12).padEnd(12, '0');
const PT_ID   = `fe000001-0001-0001-0001-${RUN_HEX}`;
const PT_ID_F = `fe000002-0001-0001-0001-${RUN_HEX}`;

const TRF_A = `trf_A_7321_${RUN}`;
const TRF_B = `trf_B_7321_${RUN}`;

// ─── psql helpers ─────────────────────────────────────────────────────────────

function psqlRaw(sql) {
  try {
    const out = execSync(
      `docker exec -i ${CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1`,
      { input: sql, encoding: 'utf8', timeout: 15000 }
    );
    return { ok: true, output: out.trim() };
  } catch (err) {
    return { ok: false, output: ((err.stdout || '') + (err.stderr || '')).trim() };
  }
}

function psql(sql) { return psqlRaw(sql); }

function psqlExpectFail(sql) {
  const r = psqlRaw(sql);
  if (r.ok) return { ok: false, sqlstate: null, output: r.output };
  const m = r.output.match(/SQLSTATE[: ]+([0-9A-Za-z]{5})/i)
           || r.output.match(/sqlstate "([0-9A-Za-z]{5})"/i);
  return { ok: true, sqlstate: m ? m[1].toUpperCase() : 'UNKNOWN', output: r.output };
}

function psqlConcurrent(sql1, sql2) {
  const run = (sql) => new Promise((resolve) => {
    let out = '';
    const p = spawn('docker', ['exec', '-i', CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
    p.stdin.write(sql);
    p.stdin.end();
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, output: out.trim() }));
  });
  return Promise.all([run(sql1), run(sql2)]);
}

// ─── Assertions ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = [];

function assert(condition, id, desc, evidence) {
  const st = condition ? 'PASS' : 'FAIL';
  condition ? passed++ : failed++;
  results.push({ id, st, desc, evidence });
  console.log(`${condition ? '✅' : '❌'} [${id}] ${st}: ${desc}`);
  if (!condition) console.log(`   Evidence: ${String(evidence).slice(0, 400)}`);
}

// ─── Fixture setup ─────────────────────────────────────────────────────────────

function setupFixture() {
  console.log('\n── Setting up test fixtures ──────────────────────────────');

  // Verify target timesheet has no active payout (should always pass on this fresh timesheet)
  const check = psql(`
    SELECT t.id, t.status,
           (SELECT pt.status FROM public.payout_transfers pt
            WHERE pt.timesheet_id = t.id
              AND pt.status IN ('pending','eligible','processing','completed','on_hold')
            LIMIT 1) AS active_pt_status
    FROM public.timesheets t WHERE t.id = '${TIMESHEET_ID}';
  `);
  if (check.output.match(/active_pt_status\s*\|(?!\s*$)/m) && !check.output.match(/active_pt_status\s*\|\s*\n/)) {
    console.error('⚠ Timesheet has an active payout. Choose a different test timesheet.');
    return false;
  }

  const r = psql(`
    INSERT INTO public.payout_transfers (
      id, contract_id, timesheet_id, recipient_user_id,
      provider, provider_transfer_id, provider_account_id,
      gross_amount, fee_amount, net_amount, currency,
      status, idempotency_key, metadata, created_at, updated_at
    ) VALUES (
      '${PT_ID}',
      '${CONTRACT_ID}',
      '${TIMESHEET_ID}',
      '${RECIPIENT_ID}',
      'razorpay',
      'resv_${RUN}',
      '${PROVIDER_ACCT}',
      1000.00, 50.00, 950.00, 'INR',
      'pending',
      'idem_7321_${RUN}',
      '{"test":true}',
      clock_timestamp(), clock_timestamp()
    ) RETURNING id, status, provider_transfer_id;
  `);

  if (!r.ok || !r.output.includes('pending')) {
    console.error('⚠ payout_transfers insert failed:', r.output.slice(0, 500));
    return false;
  }
  console.log('Fixture payout row:', r.output.split('\n').slice(-5).join('\n'));
  return true;
}

function cleanup(ptIdHasLedger) {
  console.log('\n── Cleanup ───────────────────────────────────────────────');
  if (!ptIdHasLedger) {
    // Can delete PT_ID directly (no ledger cascade issue)
    const r = psql(`DELETE FROM public.payout_transfers WHERE id = '${PT_ID}' RETURNING id, status;`);
    console.log('Deleted PT_ID:', r.output.split('\n').slice(-4).join('\n'));
  } else {
    console.log(`Note: PT_ID (${PT_ID}) has ledger rows — left as completed test fixture (not production data).`);
  }
  // Always try to delete PT_ID_F (failed sibling — no ledger rows)
  const r2 = psql(`DELETE FROM public.payout_transfers WHERE id = '${PT_ID_F}' RETURNING id, status;`);
  console.log('Deleted PT_ID_F:', r2.output.split('\n').slice(-4).join('\n'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Phase 2C.7.3.2.1 — Dispatch Idempotency Real PostgreSQL Tests');
  console.log(`  RUN TAG: ${RUN}  |  PT_ID prefix: ${PT_ID.slice(0, 8)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const ping = psql(`SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261127000006';`);
  if (!ping.ok || !ping.output.includes('20261127000006')) {
    console.error('ABORT: Migration 20261127000006 not applied.'); process.exit(1);
  }
  console.log('✅ Migration 20261127000006 confirmed applied.\n');

  if (!setupFixture()) { console.error('ABORT: Fixture failed.'); process.exit(1); }

  let ptIdHasLedger = false;

  // ── Scenario A: First dispatch ────────────────────────────────────────────
  console.log(`\n── Scenario A: First dispatch with provider ID "${TRF_A}" ──`);
  {
    const r = psql(
      `SELECT id, status, provider_transfer_id FROM ` +
      `public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'processing', false, '{}');`
    );
    assert(r.ok && r.output.includes(TRF_A) && r.output.includes('processing'),
      'A', `First dispatch with ${TRF_A} succeeds, status=processing`, r.output.slice(0, 300));
  }

  // ── Scenario B: Idempotent retry with same ID ─────────────────────────────
  console.log(`\n── Scenario B: Idempotent retry with same ID "${TRF_A}" ──`);
  {
    const r = psql(
      `SELECT id, status, provider_transfer_id FROM ` +
      `public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'processing', false, '{}');`
    );
    assert(r.ok && r.output.includes(TRF_A) && r.output.includes('processing'),
      'B', `Idempotent retry with same ID returns existing row`, r.output.slice(0, 300));
  }

  // ── Scenario C: Concurrent dispatch with conflicting ID ───────────────────
  console.log(`\n── Scenario C: Concurrent dispatch — connection 1 ${TRF_A}, connection 2 ${TRF_B} ──`);
  {
    const sql1 = `SELECT id, status, provider_transfer_id FROM public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'processing', false, '{}');`;
    const sql2 = `SELECT id, status, provider_transfer_id FROM public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_B}', 'processing', false, '{}');`;
    const [r1, r2] = await psqlConcurrent(sql1, sql2);

    console.log(`  Conn1 exit code: ${r1.code}, Conn2 exit code: ${r2.code}`);

    assert(r1.code === 0 && r1.output.includes(TRF_A),
      'C.1', `Connection 1 (same ID ${TRF_A}) returns idempotently`, r1.output.slice(0, 200));
    assert(r2.code !== 0 && (r2.output.includes('23505') || r2.output.includes('already has recorded')),
      'C.2', `Connection 2 (different ID ${TRF_B}) rejected with 23505`, r2.output.slice(0, 300));

    const verify = psql(`SELECT provider_transfer_id FROM public.payout_transfers WHERE id = '${PT_ID}';`);
    assert(verify.output.includes(TRF_A) && !verify.output.includes(TRF_B),
      'C.3', `DB provider_transfer_id remains ${TRF_A} after concurrent conflict`, verify.output.slice(0, 200));
  }

  // ── Scenario D: Status transition with same ID ────────────────────────────
  console.log(`\n── Scenario D: Status transition processing → on_hold with same ID "${TRF_A}" ──`);
  {
    const r = psql(
      `SELECT id, status, on_hold, provider_transfer_id FROM ` +
      `public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'on_hold', true, '{"hold_reason":"test"}');`
    );
    assert(r.ok && r.output.includes('on_hold') && r.output.includes(TRF_A),
      'D', `Status transition to on_hold with same ID succeeds`, r.output.slice(0, 300));
  }

  // ── Scenario E: Completed passthrough ────────────────────────────────────
  console.log('\n── Scenario E: Completed payout passthrough ──');
  {
    // confirm_payout_transfer_completion(p_transfer_id uuid, p_settled_at timestamptz DEFAULT clock_timestamp())
    const confirm = psql(
      `SELECT id, status FROM public.confirm_payout_transfer_completion('${PT_ID}');`
    );
    const confirmOk = confirm.ok && confirm.output.includes('completed');
    assert(confirmOk, 'E.1', 'confirm_payout_transfer_completion sets status=completed', confirm.output.slice(0, 300));

    if (confirmOk) {
      ptIdHasLedger = true; // ledger rows now exist for PT_ID

      // Same ID after completed → returns completed row unchanged
      const dispatchSameAfterComplete = psql(
        `SELECT id, status, provider_transfer_id FROM ` +
        `public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'processing', false, '{}');`
      );
      assert(
        dispatchSameAfterComplete.ok
          && dispatchSameAfterComplete.output.includes('completed')
          && dispatchSameAfterComplete.output.includes(TRF_A),
        'E.2',
        `Dispatch (same ID) on completed payout returns completed row unchanged`,
        dispatchSameAfterComplete.output.slice(0, 300)
      );

      // Different ID after completed → completed check fires first → returns completed row unchanged (not 23505)
      const dispatchDiffAfterComplete = psql(
        `SELECT id, status, provider_transfer_id FROM ` +
        `public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_B}', 'processing', false, '{}');`
      );
      assert(
        dispatchDiffAfterComplete.ok && dispatchDiffAfterComplete.output.includes('completed'),
        'E.3',
        `Dispatch (different ID) on completed payout returns completed row unchanged`,
        dispatchDiffAfterComplete.output.slice(0, 300)
      );
    } else {
      // E.1 failed — skip E.2/E.3 but still count them
      assert(false, 'E.2', `Dispatch (same ID) on completed payout returns completed row unchanged`, 'Skipped: E.1 failed');
      assert(false, 'E.3', `Dispatch (different ID) on completed payout returns completed row unchanged`, 'Skipped: E.1 failed');
    }
  }

  // ── Scenario F: Placeholder resv_ rejection ───────────────────────────────
  console.log('\n── Scenario F: Placeholder resv_ ID rejected with 22023 ──');
  {
    // Insert a 'failed' sibling — outside partial unique index, no ledger entry
    // Note: PT_ID is now completed so partial index no longer blocks this timesheet
    const insF = psql(`
      INSERT INTO public.payout_transfers (
        id, contract_id, timesheet_id, recipient_user_id,
        provider, provider_transfer_id, provider_account_id,
        gross_amount, fee_amount, net_amount, currency,
        status, idempotency_key, metadata, created_at, updated_at
      ) VALUES (
        '${PT_ID_F}',
        '${CONTRACT_ID}',
        '${TIMESHEET_ID}',
        '${RECIPIENT_ID}',
        'razorpay',
        'resv_F_${RUN}',
        '${PROVIDER_ACCT}',
        100.00, 5.00, 95.00, 'INR',
        'failed',
        'idem_F_7321_${RUN}',
        '{}',
        clock_timestamp(), clock_timestamp()
      ) RETURNING id, status;
    `);
    if (!insF.ok) console.warn('  ⚠ failed row insert:', insF.output.slice(0, 200));
    else console.log('  Failed sibling row inserted:', insF.output.split('\n').slice(-4).join('\n'));

    const r = psqlExpectFail(
      `SELECT public.record_payout_transfer_dispatch('${PT_ID_F}', 'resv_fake_placeholder', 'processing', false, '{}');`
    );
    assert(r.ok && (r.sqlstate === '22023' || r.output.toLowerCase().includes('placeholder')),
      'F', `Placeholder resv_ ID rejected with 22023`, `sqlstate=${r.sqlstate} | ${r.output.slice(0, 250)}`);
  }

  // ── Scenario G: Authorization check ──────────────────────────────────────
  console.log('\n── Scenario G: authenticated role → rejected 42501 ──');
  {
    // SET LOCAL ROLE requires a transaction block
    const r = psqlExpectFail(
      `BEGIN;\n` +
      `SET LOCAL ROLE authenticated;\n` +
      `SELECT public.record_payout_transfer_dispatch('${PT_ID}', '${TRF_A}', 'processing', false, '{}');\n` +
      `ROLLBACK;`
    );
    assert(r.ok && (r.sqlstate === '42501' || r.output.toLowerCase().includes('access denied') || r.output.toLowerCase().includes('permission denied')),
      'G', `authenticated role rejected (access denied / permission denied / 42501)`, `sqlstate=${r.sqlstate} | ${r.output.slice(0, 250)}`);
  }

  // ── Historical count verification ─────────────────────────────────────────
  console.log('\n── Historical payout count verification ──────────────────');
  {
    // Cast id to text for LIKE comparison (uuid type doesn't support LIKE directly in PG)
    const countR = psql(`
      SELECT status, COUNT(*) FROM public.payout_transfers
      WHERE id::text NOT LIKE 'fe000001%'
        AND id::text NOT LIKE 'fe000002%'
        AND provider_transfer_id NOT LIKE 'trf_d%'
      GROUP BY 1 ORDER BY 1;
    `);
    console.log('Counts (excluding test fixtures):\n', countR.output.split('\n').slice(-10).join('\n'));
    assert(!!(countR.output.match(/completed\s*\|\s*10/)),
      'H.1', 'Historical completed count = 10 preserved', countR.output.slice(0, 300));
    assert(!!(countR.output.match(/processing\s*\|\s*2/)),
      'H.2', 'Historical processing count = 2 preserved', countR.output.slice(0, 300));
  }

  cleanup(ptIdHasLedger);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n${'ID'.padEnd(6)} ${'Status'.padEnd(6)} Description`);
  console.log('─'.repeat(72));
  for (const r of results) {
    const icon = r.st === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${r.id.padEnd(6)} ${r.st.padEnd(6)} ${r.desc}`);
    if (r.st === 'FAIL') console.log(`         ↳ ${String(r.evidence).slice(0, 350)}`);
  }
  console.log('─'.repeat(72));
  console.log(`\n  Total: ${passed} PASS / ${failed} FAIL out of ${passed + failed} scenarios`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
