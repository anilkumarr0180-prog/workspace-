import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  classifyStopTimerResult,
  toISTDateString,
  getISTHour,
  getISTDayBoundsUtc,
} from '../../lib/time-tracking-feedback';

async function setupBillingIntegrityDb() {
  const db = new PGlite();

  await db.exec(`
    CREATE TABLE contracts (
      id uuid PRIMARY KEY,
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      contract_type text NOT NULL CHECK (contract_type IN ('hourly', 'fixed')),
      status text NOT NULL CHECK (status IN ('pending_offer', 'active', 'paused', 'completed', 'cancelled', 'declined')),
      hourly_rate numeric(10,2) NOT NULL,
      weekly_hour_limit integer NOT NULL
    );

    CREATE TABLE timesheets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      client_id uuid NOT NULL,
      freelancer_id uuid NOT NULL,
      week_start_date date NOT NULL,
      total_minutes integer NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'under_review', 'approved', 'disputed', 'paid')),
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
      CONSTRAINT chk_time_entry_max_duration CHECK (end_time - start_time <= interval '12 hours'),
      CONSTRAINT chk_time_entry_duration_matches_interval CHECK (
        duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::integer)
      )
    );

    CREATE TABLE active_timer_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      freelancer_id uuid NOT NULL UNIQUE,
      start_time timestamptz NOT NULL,
      memo text NOT NULL DEFAULT ''
    );

    CREATE TABLE work_diary_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      time_entry_id uuid REFERENCES time_entries(id),
      freelancer_id uuid NOT NULL,
      slot_time timestamptz NOT NULL,
      duration_minutes integer NOT NULL DEFAULT 10,
      activity_score integer NOT NULL DEFAULT 8,
      keystrokes_count integer NOT NULL DEFAULT 0,
      mouse_clicks_count integer NOT NULL DEFAULT 0,
      memo text NOT NULL DEFAULT '',
      screenshot_url text,
      is_manual boolean NOT NULL DEFAULT false
    );

    CREATE OR REPLACE FUNCTION public.utc_ten_minute_bucket(p_ts timestamptz)
    RETURNS timestamptz
    LANGUAGE sql
    IMMUTABLE
    STRICT
    AS $$
      SELECT (
        date_trunc('hour', p_ts AT TIME ZONE 'UTC')
        + (floor(EXTRACT(MINUTE FROM (p_ts AT TIME ZONE 'UTC')) / 10)::integer * interval '10 minutes')
      ) AT TIME ZONE 'UTC';
    $$;

    CREATE UNIQUE INDEX uq_work_diary_slots_auto_10min_bucket
      ON public.work_diary_slots (
        contract_id,
        freelancer_id,
        public.utc_ten_minute_bucket(slot_time)
      )
      WHERE is_manual = false;

    CREATE OR REPLACE FUNCTION public.test_start_timer(
      p_actor_id uuid,
      p_contract_id uuid,
      p_now timestamptz,
      p_memo text DEFAULT ''
    ) RETURNS uuid
    LANGUAGE plpgsql AS $$
    DECLARE
      v_contract RECORD;
      v_week_start date;
      v_week_end timestamptz;
      v_existing_week_minutes integer := 0;
      v_session_id uuid;
    BEGIN
      SELECT id, contract_type, status, freelancer_id, weekly_hour_limit
        INTO v_contract
        FROM contracts
       WHERE id = p_contract_id
         FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract not found' USING ERRCODE = '23503';
      END IF;
      IF v_contract.freelancer_id <> p_actor_id THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
      END IF;
      IF v_contract.contract_type <> 'hourly' OR v_contract.status <> 'active' THEN
        RAISE EXCEPTION 'Ineligible contract status: %', v_contract.status USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM active_timer_sessions WHERE freelancer_id = p_actor_id) THEN
        RAISE EXCEPTION 'Active session exists' USING ERRCODE = '23505';
      END IF;

      IF v_contract.weekly_hour_limit > 0 THEN
        v_week_start := date_trunc('week', p_now AT TIME ZONE 'UTC')::date;
        v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';
        SELECT COALESCE(SUM(duration_minutes), 0) INTO v_existing_week_minutes
          FROM time_entries
         WHERE contract_id = v_contract.id
           AND start_time >= (v_week_start AT TIME ZONE 'UTC')
           AND start_time < v_week_end;
        IF v_existing_week_minutes >= (v_contract.weekly_hour_limit * 60) THEN
          RAISE EXCEPTION 'Weekly hour limit reached' USING ERRCODE = '22023';
        END IF;
      END IF;

      INSERT INTO active_timer_sessions (contract_id, freelancer_id, start_time, memo)
      VALUES (p_contract_id, p_actor_id, p_now, COALESCE(trim(p_memo), ''))
      RETURNING id INTO v_session_id;

      RETURN v_session_id;
    END;
    $$;

    CREATE OR REPLACE FUNCTION public.test_stop_timer_v2(
      p_actor_id uuid,
      p_now timestamptz,
      p_memo text DEFAULT NULL
    ) RETURNS jsonb
    LANGUAGE plpgsql AS $$
    DECLARE
      v_session RECORD;
      v_contract RECORD;
      v_end_time timestamptz := p_now;
      v_duration_seconds numeric;
      v_duration_minutes integer;
      v_week_start date;
      v_week_end timestamptz;
      v_existing_week_minutes integer := 0;
      v_remaining_minutes integer;
      v_existing_timesheet timesheets;
      v_timesheet_id uuid;
      v_entry time_entries;
    BEGIN
      SELECT * INTO v_session FROM active_timer_sessions WHERE freelancer_id = p_actor_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No active timer session' USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_contract FROM contracts WHERE id = v_session.contract_id FOR UPDATE;
      IF v_contract.status <> 'active' OR v_contract.contract_type <> 'hourly' THEN
        DELETE FROM active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object(
          'outcome', 'discarded',
          'discard_reason', CASE WHEN v_contract.status = 'cancelled' THEN 'contract_cancelled' ELSE 'contract_ineligible' END
        );
      END IF;

      v_duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_end_time - v_session.start_time)));
      IF v_duration_seconds < 60 THEN
        DELETE FROM active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object('outcome', 'discarded', 'discard_reason', 'short_session');
      END IF;

      IF (v_end_time - v_session.start_time) > interval '12 hours' THEN
        DELETE FROM active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object('outcome', 'discarded', 'discard_reason', 'session_exceeded_max_duration');
      END IF;

      v_duration_minutes := GREATEST(1, ROUND(v_duration_seconds / 60)::integer);
      v_week_start := date_trunc('week', v_session.start_time AT TIME ZONE 'UTC')::date;
      v_week_end := (v_week_start + interval '7 days') AT TIME ZONE 'UTC';

      SELECT * INTO v_existing_timesheet FROM timesheets
       WHERE contract_id = v_contract.id AND week_start_date = v_week_start FOR UPDATE;

      SELECT COALESCE(SUM(duration_minutes), 0) INTO v_existing_week_minutes
        FROM time_entries
       WHERE contract_id = v_contract.id
         AND start_time >= (v_week_start AT TIME ZONE 'UTC')
         AND start_time < v_week_end;

      v_remaining_minutes := (v_contract.weekly_hour_limit * 60) - v_existing_week_minutes;
      IF v_remaining_minutes <= 0 THEN
        DELETE FROM active_timer_sessions WHERE id = v_session.id;
        RETURN jsonb_build_object('outcome', 'discarded', 'discard_reason', 'weekly_limit_reached', 'remaining_week_minutes', 0);
      END IF;

      IF v_duration_minutes > v_remaining_minutes THEN
        v_duration_minutes := v_remaining_minutes;
        v_end_time := v_session.start_time + make_interval(mins => v_duration_minutes);
      END IF;

      IF FOUND AND v_existing_timesheet.status IN ('paid', 'approved', 'submitted', 'under_review') THEN
        v_timesheet_id := NULL;
      ELSE
        INSERT INTO timesheets (contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
        VALUES (v_contract.id, v_contract.client_id, p_actor_id, v_week_start, v_duration_minutes,
                ROUND((v_duration_minutes::numeric / 60.0) * v_contract.hourly_rate, 2), 'open')
        ON CONFLICT (contract_id, week_start_date) DO UPDATE
           SET total_minutes = timesheets.total_minutes + EXCLUDED.total_minutes,
               total_amount = ROUND(((timesheets.total_minutes + EXCLUDED.total_minutes)::numeric / 60.0) * v_contract.hourly_rate, 2)
        RETURNING id INTO v_timesheet_id;
      END IF;

      INSERT INTO time_entries (contract_id, timesheet_id, freelancer_id, start_time, end_time, duration_minutes, memo, source)
      VALUES (v_contract.id, v_timesheet_id, p_actor_id, v_session.start_time, v_end_time, v_duration_minutes, COALESCE(NULLIF(trim(p_memo), ''), 'Work'), 'timer')
      RETURNING * INTO v_entry;

      DELETE FROM active_timer_sessions WHERE id = v_session.id;

      RETURN jsonb_build_object(
        'outcome', 'saved',
        'entry', row_to_json(v_entry),
        'remaining_week_minutes', GREATEST(0, v_remaining_minutes - v_duration_minutes)
      );
    END;
    $$;
  `);

  return db;
}

test('Phase 2C: Weekly limit exhausted rejects start_timer, and active session prevents concurrent second start', async () => {
  const db = await setupBillingIntegrityDb();
  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.query(
    `INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
     VALUES ($1, $2, $3, 'hourly', 'active', 75.00, 1)`,
    [contractId, clientId, freelancerId]
  );

  // Start first session, stop after 45m -> 15m remaining
  await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T09:00:00Z', 'S1')`, [freelancerId, contractId]);
  // Concurrent start while active session exists is rejected
  await assert.rejects(
    db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T09:05:00Z', 'Dup')`, [freelancerId, contractId])
  );

  const stop1 = await db.query<{ res: { outcome: string; remaining_week_minutes: number } }>(
    `SELECT public.test_stop_timer_v2($1, '2026-11-27T09:45:00Z', 'S1') AS res`,
    [freelancerId]
  );
  assert.strictEqual(stop1.rows[0].res.outcome, 'saved');
  assert.strictEqual(stop1.rows[0].res.remaining_week_minutes, 15);

  // Start second session, stop after 30m -> capped to 15m (end_time adjusted to satisfy CHECK constraint)
  await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T10:00:00Z', 'S2')`, [freelancerId, contractId]);
  const stop2 = await db.query<{ res: { outcome: string; entry: { duration_minutes: number }; remaining_week_minutes: number } }>(
    `SELECT public.test_stop_timer_v2($1, '2026-11-27T10:30:00Z', 'S2') AS res`,
    [freelancerId]
  );
  assert.strictEqual(stop2.rows[0].res.outcome, 'saved');
  assert.strictEqual(stop2.rows[0].res.entry.duration_minutes, 15);
  assert.strictEqual(stop2.rows[0].res.remaining_week_minutes, 0);

  // Third start rejected because 60/60 weekly minutes are exhausted
  await assert.rejects(
    db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T11:00:00Z', 'S3')`, [freelancerId, contractId]),
    /Weekly hour limit reached/i
  );
});

test('Phase 2C: Structured stop discard reasons for short_session, >12h max_duration, and paused/completed/cancelled contracts', async () => {
  const db = await setupBillingIntegrityDb();
  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.query(
    `INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
     VALUES ($1, $2, $3, 'hourly', 'active', 75.00, 40)`,
    [contractId, clientId, freelancerId]
  );

  // 1. Short session (< 60s)
  await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T09:00:00Z', 'Short')`, [freelancerId, contractId]);
  const shortRes = await db.query<{ res: { outcome: string; discard_reason: string } }>(
    `SELECT public.test_stop_timer_v2($1, '2026-11-27T09:00:45Z') AS res`,
    [freelancerId]
  );
  assert.strictEqual(shortRes.rows[0].res.outcome, 'discarded');
  assert.strictEqual(shortRes.rows[0].res.discard_reason, 'short_session');

  // 2. Exceeds 12-hour max duration
  await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T01:00:00Z', 'Long')`, [freelancerId, contractId]);
  const longRes = await db.query<{ res: { outcome: string; discard_reason: string } }>(
    `SELECT public.test_stop_timer_v2($1, '2026-11-27T14:00:00Z') AS res`,
    [freelancerId]
  );
  assert.strictEqual(longRes.rows[0].res.outcome, 'discarded');
  assert.strictEqual(longRes.rows[0].res.discard_reason, 'session_exceeded_max_duration');

  // 3. Contract transitions to paused, completed, cancelled while timer is running
  for (const [status, expectedReason] of [
    ['paused', 'contract_ineligible'],
    ['completed', 'contract_ineligible'],
    ['cancelled', 'contract_cancelled'],
  ] as const) {
    await db.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [contractId]);
    await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T15:00:00Z', 'Test')`, [freelancerId, contractId]);
    await db.query(`UPDATE contracts SET status = $1 WHERE id = $2`, [status, contractId]);

    const res = await db.query<{ res: { outcome: string; discard_reason: string } }>(
      `SELECT public.test_stop_timer_v2($1, '2026-11-27T15:15:00Z') AS res`,
      [freelancerId]
    );
    assert.strictEqual(res.rows[0].res.outcome, 'discarded');
    assert.strictEqual(res.rows[0].res.discard_reason, expectedReason);
  }
});

test('Phase 2C: Protected timesheet statuses (approved, submitted, under_review, paid) remain immutable', async () => {
  const db = await setupBillingIntegrityDb();
  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.query(
    `INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
     VALUES ($1, $2, $3, 'hourly', 'active', 75.00, 40)`,
    [contractId, clientId, freelancerId]
  );

  for (const protectedStatus of ['approved', 'submitted', 'under_review', 'paid'] as const) {
    await db.query(`DELETE FROM time_entries`);
    await db.query(`DELETE FROM timesheets`);
    await db.query(
      `INSERT INTO timesheets (contract_id, client_id, freelancer_id, week_start_date, total_minutes, total_amount, status)
       VALUES ($1, $2, $3, '2026-11-23', 120, 150.00, $4)`,
      [contractId, clientId, freelancerId, protectedStatus]
    );

    await db.query(`SELECT public.test_start_timer($1, $2, '2026-11-27T09:00:00Z', 'Extra')`, [freelancerId, contractId]);
    const stopRes = await db.query<{ res: { outcome: string; entry: { timesheet_id: string | null } } }>(
      `SELECT public.test_stop_timer_v2($1, '2026-11-27T09:30:00Z', 'Extra') AS res`,
      [freelancerId]
    );

    assert.strictEqual(stopRes.rows[0].res.outcome, 'saved');
    assert.strictEqual(stopRes.rows[0].res.entry.timesheet_id, null);

    const tsCheck = await db.query<{ status: string; total_minutes: number; total_amount: string }>(
      `SELECT status, total_minutes, total_amount::text FROM timesheets WHERE contract_id = $1`,
      [contractId]
    );
    assert.strictEqual(tsCheck.rows[0].status, protectedStatus);
    assert.strictEqual(tsCheck.rows[0].total_minutes, 120);
    assert.strictEqual(tsCheck.rows[0].total_amount, '150.00');
  }
});

test('Phase 2C: Screenshot slot 10-minute UTC bucket unique index blocks duplicates while preserving manual slots', async () => {
  const db = await setupBillingIntegrityDb();
  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.query(
    `INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
     VALUES ($1, $2, $3, 'hourly', 'active', 75.00, 40)`,
    [contractId, clientId, freelancerId]
  );

  // First auto slot in 09:10-09:19 UTC bucket succeeds
  await db.query(
    `INSERT INTO work_diary_slots (contract_id, freelancer_id, slot_time, memo, is_manual)
     VALUES ($1, $2, '2026-11-27T09:12:00Z', 'Work', false)`,
    [contractId, freelancerId]
  );

  // Second auto slot in same 09:10-09:19 UTC bucket (from another device/tab) is rejected
  await assert.rejects(
    db.query(
      `INSERT INTO work_diary_slots (contract_id, freelancer_id, slot_time, memo, is_manual)
       VALUES ($1, $2, '2026-11-27T09:18:00Z', 'Duplicate', false)`,
      [contractId, freelancerId]
    )
  );

  // Auto slot in next 10-minute bucket (09:20 UTC) succeeds
  await db.query(
    `INSERT INTO work_diary_slots (contract_id, freelancer_id, slot_time, memo, is_manual)
     VALUES ($1, $2, '2026-11-27T09:21:00Z', 'Next bucket', false)`,
    [contractId, freelancerId]
  );

  // Manual slot in same bucket is preserved (is_manual = true excluded from unique index)
  await db.query(
    `INSERT INTO work_diary_slots (contract_id, freelancer_id, slot_time, memo, is_manual)
     VALUES ($1, $2, '2026-11-27T09:15:00Z', 'Manual', true)`,
    [contractId, freelancerId]
  );
});

test('Phase 2C: IST (Asia/Kolkata) 00:00-05:29 boundaries & structured stop feedback classification', () => {
  // 2026-11-26T20:00:00Z is 2026-11-27 01:30 IST
  const earlyIstUtc = '2026-11-26T20:00:00.000Z';
  assert.strictEqual(toISTDateString(earlyIstUtc), '2026-11-27');
  assert.strictEqual(getISTHour(earlyIstUtc), 1);

  const bounds = getISTDayBoundsUtc('2026-11-27');
  assert.strictEqual(bounds.startUtc, '2026-11-26T18:30:00.000Z');
  assert.strictEqual(bounds.endUtc, '2026-11-27T18:29:59.999Z');

  // Structured server discardReason takes precedence even when weekMinutesLogged=0 (GlobalTimerPill)
  const capRes = classifyStopTimerResult({
    res: { success: true, outcome: 'discarded', discardReason: 'weekly_limit_reached' },
    elapsedSeconds: 300,
    weekMinutesLogged: 0,
    weeklyLimitHours: 0,
  });
  assert.strictEqual(capRes.kind, 'weekly_limit_reached');
  assert.strictEqual(capRes.isError, true);

  const maxDurRes = classifyStopTimerResult({
    res: { success: true, outcome: 'discarded', discardReason: 'session_exceeded_max_duration' },
    elapsedSeconds: 50000,
    weekMinutesLogged: 0,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(maxDurRes.kind, 'session_exceeded_max_duration');
  assert.strictEqual(maxDurRes.isError, true);

  const pausedRes = classifyStopTimerResult({
    res: { success: true, outcome: 'discarded', discardReason: 'contract_ineligible' },
    elapsedSeconds: 300,
    weekMinutesLogged: 0,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(pausedRes.kind, 'ineligible');
  assert.strictEqual(pausedRes.isError, true);
});
