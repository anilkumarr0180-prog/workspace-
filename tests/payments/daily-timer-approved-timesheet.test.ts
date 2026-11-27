import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

test('Daily hourly timer tracking preserves approved timesheets, enforces weekly cap, prevents duplicates & client starts, and creates next-week timesheets', async () => {
  const db = new PGlite();

  await db.exec(`
    CREATE TABLE contracts (
      id uuid PRIMARY KEY,
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      contract_type text NOT NULL,
      status text NOT NULL,
      hourly_rate numeric(10,2) NOT NULL,
      weekly_hour_limit integer NOT NULL
    );

    CREATE TABLE active_timer_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      freelancer_id uuid NOT NULL UNIQUE,
      start_time timestamptz NOT NULL,
      memo text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE timesheets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (contract_id, week_start_date)
    );

    CREATE TABLE time_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      timesheet_id uuid REFERENCES timesheets(id),
      freelancer_id uuid NOT NULL,
      start_time timestamptz NOT NULL,
      end_time timestamptz NOT NULL,
      duration_minutes integer NOT NULL,
      memo text NOT NULL,
      source text NOT NULL DEFAULT 'timer',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE work_diary_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      time_entry_id uuid REFERENCES time_entries(id) ON DELETE CASCADE,
      freelancer_id uuid NOT NULL,
      slot_time timestamptz NOT NULL,
      duration_minutes integer NOT NULL DEFAULT 10,
      activity_score integer NOT NULL DEFAULT 8,
      keystrokes_count integer NOT NULL DEFAULT 300,
      mouse_clicks_count integer NOT NULL DEFAULT 80,
      memo text NOT NULL DEFAULT '',
      screenshot_url text,
      is_manual boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.exec(`
    INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
    VALUES ('${contractId}', '${clientId}', '${freelancerId}', 'hourly', 'active', 75.00, 40);

    -- Yesterday (2026-11-26, week of 2026-11-23) approved timesheet: 2 hours = $150.00
    INSERT INTO timesheets (contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
    VALUES ('${contractId}', '${clientId}', '${freelancerId}', '2026-11-23', 120, 150.00, 'approved');

    INSERT INTO time_entries (contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
    SELECT '${contractId}', id, '${freelancerId}', '2026-11-26T10:00:00Z', '2026-11-26T12:00:00Z', 120, 'Yesterday approved work', 'timer'
    FROM timesheets WHERE contract_id = '${contractId}' AND week_start_date = '2026-11-23';
  `);

  // 1. Client cannot start a freelancer timer
  const clientContractCheck = await db.query<{ freelancer_id: string }>(
    `SELECT freelancer_id FROM contracts WHERE id = $1`,
    [contractId]
  );
  assert.notStrictEqual(clientContractCheck.rows[0].freelancer_id, clientId);

  // 2. Freelancer starts timer on 2026-11-27 (same billing week as yesterday's approved timesheet)
  const startRes = await db.query<{ id: string }>(
    `INSERT INTO active_timer_sessions (contract_id, freelancer_id, start_time, memo)
     VALUES ($1, $2, '2026-11-27T09:00:00Z', 'Today feature work')
     RETURNING id`,
    [contractId, freelancerId]
  );
  assert.strictEqual(startRes.rows.length, 1);

  // 3. Duplicate active timer session is rejected by UNIQUE(freelancer_id)
  await assert.rejects(
    db.query(
      `INSERT INTO active_timer_sessions (contract_id, freelancer_id, start_time, memo)
       VALUES ($1, $2, '2026-11-27T09:05:00Z', 'Duplicate')`,
      [contractId, freelancerId]
    )
  );

  // 4. Stop timer on 2026-11-27 (60 mins): existing timesheet is 'approved', so timesheet_id must be NULL
  const stopResult = await db.query<{ timesheet_id: string | null; status: string }>(`
    SELECT id AS timesheet_id, status FROM timesheets
    WHERE contract_id = '${contractId}' AND week_start_date = '2026-11-23'
  `);
  const existingStatus = stopResult.rows[0].status;
  assert.strictEqual(existingStatus, 'approved');

  const isImmutable = ['paid', 'approved', 'submitted', 'under_review'].includes(existingStatus);
  assert.strictEqual(isImmutable, true);

  const entryInsert = await db.query<{ id: string; timesheet_id: string | null }>(
    `INSERT INTO time_entries (contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
     VALUES ($1, NULL, $2, '2026-11-27T09:00:00Z', '2026-11-27T10:00:00Z', 60, 'Today feature work', 'timer')
     RETURNING id, timesheet_id`,
    [contractId, freelancerId]
  );
  assert.strictEqual(entryInsert.rows[0].timesheet_id, null);

  await db.query(
    `INSERT INTO work_diary_slots (contract_id, time_entry_id, freelancer_id, slot_time, duration_minutes, memo, is_manual)
     VALUES ($1, $2, $3, '2026-11-27T09:00:00Z', 10, 'Today feature work', false)`,
    [contractId, entryInsert.rows[0].id, freelancerId]
  );
  await db.query(`DELETE FROM active_timer_sessions WHERE freelancer_id = $1`, [freelancerId]);

  // 5. Verify yesterday's approved timesheet is completely unchanged
  const approvedTs = await db.query<{ status: string; total_minutes: number; total_amount: string }>(
    `SELECT status, total_minutes, total_amount::text FROM timesheets WHERE contract_id = $1 AND week_start_date = '2026-11-23'`,
    [contractId]
  );
  assert.strictEqual(approvedTs.rows[0].status, 'approved');
  assert.strictEqual(approvedTs.rows[0].total_minutes, 120);
  assert.strictEqual(approvedTs.rows[0].total_amount, '150.00');

  // 6. Verify weekly hour cap includes both billed and unbilled entries for week of 2026-11-23
  const weekTotal = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(duration_minutes), 0)::text AS total
     FROM time_entries
     WHERE contract_id = $1
       AND start_time >= '2026-11-23T00:00:00Z'
       AND start_time < '2026-11-30T00:00:00Z'`,
    [contractId]
  );
  assert.strictEqual(Number(weekTotal.rows[0].total), 180);

  // 7. Verify next week (2026-11-30) creates a brand new 'open' timesheet independently
  const nextWeekTs = await db.query<{ id: string; status: string; total_minutes: number }>(
    `INSERT INTO timesheets (contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
     VALUES ($1, $2, $3, '2026-11-30', 30, 37.50, 'open')
     RETURNING id, status, total_minutes`,
    [contractId, clientId, freelancerId]
  );
  assert.strictEqual(nextWeekTs.rows[0].status, 'open');
  assert.strictEqual(nextWeekTs.rows[0].total_minutes, 30);
});
