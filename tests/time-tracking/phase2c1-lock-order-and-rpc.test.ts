import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  mapStopTimerV2RpcResponse,
  mapRecordScreenshotSlotRpcResponse,
} from '../../lib/time-tracking-feedback';

async function setupPhase2C1Db() {
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
      memo text NOT NULL DEFAULT ''
    );

    CREATE TABLE work_diary_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL REFERENCES contracts(id),
      time_entry_id uuid,
      freelancer_id uuid NOT NULL,
      slot_time timestamptz NOT NULL,
      duration_minutes integer NOT NULL DEFAULT 10,
      activity_score integer NOT NULL DEFAULT 8,
      keystrokes_count integer NOT NULL DEFAULT 0,
      mouse_clicks_count integer NOT NULL DEFAULT 0,
      memo text NOT NULL DEFAULT '',
      screenshot_url text,
      is_manual boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
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

    CREATE OR REPLACE FUNCTION public.test_record_screenshot_slot(
      p_actor_id uuid,
      p_contract_id uuid,
      p_slot_time timestamptz,
      p_memo text DEFAULT 'Work'
    ) RETURNS jsonb
    LANGUAGE plpgsql AS $$
    DECLARE
      v_contract RECORD;
      v_session_id uuid;
      v_slot work_diary_slots;
    BEGIN
      -- Canonical lock order: contracts (FOR UPDATE) -> active_timer_sessions (FOR UPDATE) -> work_diary_slots
      SELECT id, freelancer_id, contract_type, status
        INTO v_contract
        FROM contracts
       WHERE id = p_contract_id
         FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'ineligible', 'code', 'NOT_FOUND', 'error', 'Contract not found');
      END IF;

      IF v_contract.freelancer_id <> p_actor_id THEN
        RETURN jsonb_build_object('outcome', 'ineligible', 'code', 'FORBIDDEN', 'error', 'Forbidden');
      END IF;

      IF v_contract.contract_type <> 'hourly' OR v_contract.status <> 'active' THEN
        RETURN jsonb_build_object('outcome', 'ineligible', 'code', 'INELIGIBLE_CONTRACT', 'error', 'Contract ineligible');
      END IF;

      SELECT id INTO v_session_id
        FROM active_timer_sessions
       WHERE freelancer_id = p_actor_id
         AND contract_id = p_contract_id
         FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'ineligible', 'code', 'NO_ACTIVE_SESSION', 'error', 'No active timer');
      END IF;

      INSERT INTO work_diary_slots (
        contract_id, freelancer_id, slot_time, duration_minutes, activity_score, memo, is_manual
      ) VALUES (
        p_contract_id, p_actor_id, p_slot_time, 10, 8, p_memo, false
      )
      ON CONFLICT (contract_id, freelancer_id, public.utc_ten_minute_bucket(slot_time))
      WHERE is_manual = false
      DO NOTHING
      RETURNING * INTO v_slot;

      IF NOT FOUND THEN
        SELECT * INTO v_slot
          FROM work_diary_slots
         WHERE contract_id = p_contract_id
           AND freelancer_id = p_actor_id
           AND is_manual = false
           AND public.utc_ten_minute_bucket(slot_time) = public.utc_ten_minute_bucket(p_slot_time)
         LIMIT 1;

        RETURN jsonb_build_object('outcome', 'duplicate', 'slot', row_to_json(v_slot));
      END IF;

      RETURN jsonb_build_object('outcome', 'inserted', 'slot', row_to_json(v_slot));
    END;
    $$;
  `);

  return db;
}

test('Phase 2C.1: Atomic screenshot RPC enforces active timer, contract status, freelancer ownership, and 10-min bucket idempotency', async () => {
  const db = await setupPhase2C1Db();
  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const otherFreelancerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  await db.query(
    `INSERT INTO contracts (id, client_id, freelancer_id, contract_type, status, hourly_rate, weekly_hour_limit)
     VALUES ($1, $2, $3, 'hourly', 'active', 75.00, 40)`,
    [contractId, clientId, freelancerId]
  );

  // 1. Screenshot recording after timer stop (no active session) -> ineligible
  const noSession = await db.query<{ res: { outcome: string; code: string } }>(
    `SELECT public.test_record_screenshot_slot($1, $2, '2026-11-27T09:12:00Z') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(noSession.rows[0].res.outcome, 'ineligible');
  assert.strictEqual(noSession.rows[0].res.code, 'NO_ACTIVE_SESSION');

  // Start timer for freelancer
  await db.query(
    `INSERT INTO active_timer_sessions (contract_id, freelancer_id, start_time, memo)
     VALUES ($1, $2, '2026-11-27T09:00:00Z', 'Coding')`,
    [contractId, freelancerId]
  );

  // 2. Screenshot recording with another freelancer's timer -> ineligible (FORBIDDEN)
  const wrongFreelancer = await db.query<{ res: { outcome: string; code: string } }>(
    `SELECT public.test_record_screenshot_slot($1, $2, '2026-11-27T09:12:00Z') AS res`,
    [otherFreelancerId, contractId]
  );
  assert.strictEqual(wrongFreelancer.rows[0].res.outcome, 'ineligible');
  assert.strictEqual(wrongFreelancer.rows[0].res.code, 'FORBIDDEN');

  // 3. Valid screenshot insertion -> inserted
  const inserted = await db.query<{ res: { outcome: string; slot: { id: string } } }>(
    `SELECT public.test_record_screenshot_slot($1, $2, '2026-11-27T09:12:00Z', 'First') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(inserted.rows[0].res.outcome, 'inserted');
  const firstSlotId = inserted.rows[0].res.slot.id;

  // 4. Duplicate bucket insertion (09:18 UTC in same 09:10-09:19 bucket) -> duplicate returning same slot id
  const duplicate = await db.query<{ res: { outcome: string; slot: { id: string } } }>(
    `SELECT public.test_record_screenshot_slot($1, $2, '2026-11-27T09:18:00Z', 'Dup') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(duplicate.rows[0].res.outcome, 'duplicate');
  assert.strictEqual(duplicate.rows[0].res.slot.id, firstSlotId);

  // 5. Manual entry in the same 10-min bucket remains unaffected
  await db.query(
    `INSERT INTO work_diary_slots (contract_id, freelancer_id, slot_time, memo, is_manual)
     VALUES ($1, $2, '2026-11-27T09:15:00Z', 'Manual', true)`,
    [contractId, freelancerId]
  );

  // 6. Screenshot recording after contract pause -> ineligible (INELIGIBLE_CONTRACT)
  await db.query(`UPDATE contracts SET status = 'paused' WHERE id = $1`, [contractId]);
  const paused = await db.query<{ res: { outcome: string; code: string } }>(
    `SELECT public.test_record_screenshot_slot($1, $2, '2026-11-27T09:22:00Z') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(paused.rows[0].res.outcome, 'ineligible');
  assert.strictEqual(paused.rows[0].res.code, 'INELIGIBLE_CONTRACT');
});

test('Phase 2C.1: Missing v2 RPCs (PGRST202) fail closed without legacy fallback', () => {
  const stopMissing = mapStopTimerV2RpcResponse({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function public.stop_timer_session_v2' },
  });
  assert.strictEqual(stopMissing.success, false);
  assert.strictEqual(stopMissing.code, 'MIGRATION_REQUIRED');
  assert.match(stopMissing.error || '', /stop_timer_session_v2/i);

  const slotMissing = mapRecordScreenshotSlotRpcResponse({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function public.record_work_diary_screenshot_slot' },
  });
  assert.strictEqual(slotMissing.success, false);
  assert.strictEqual(slotMissing.code, 'MIGRATION_REQUIRED');
  assert.match(slotMissing.error || '', /record_work_diary_screenshot_slot/i);

  const slotDuplicate = mapRecordScreenshotSlotRpcResponse({
    data: {
      outcome: 'duplicate',
      slot: {
        id: 'slot-1',
        contract_id: 'c-1',
        freelancer_id: 'f-1',
        slot_time: '2026-11-27T09:12:00Z',
        duration_minutes: 10,
        activity_score: 8,
        keystrokes_count: 10,
        mouse_clicks_count: 5,
        memo: 'Work',
        is_manual: false,
        created_at: '2026-11-27T09:12:00Z',
      },
    },
    error: null,
  });
  assert.strictEqual(slotDuplicate.success, true);
  assert.strictEqual(slotDuplicate.outcome, 'duplicate');
  assert.strictEqual(slotDuplicate.duplicate, true);
  assert.strictEqual(slotDuplicate.slot?.id, 'slot-1');
});
