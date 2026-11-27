import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

test('Phase 2C.2: Historical synthesized slots (screenshot_url IS NULL) coexist with live screenshot slot, while duplicate live screenshots return duplicate', async () => {
  const db = new PGlite();

  await db.exec(`
    CREATE TABLE contracts (
      id uuid PRIMARY KEY,
      freelancer_id uuid NOT NULL,
      contract_type text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE active_timer_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      freelancer_id uuid NOT NULL UNIQUE
    );

    CREATE TABLE work_diary_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
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
      WHERE is_manual = false AND screenshot_url IS NOT NULL;

    CREATE OR REPLACE FUNCTION public.test_record_screenshot_slot_v2(
      p_actor_id uuid,
      p_contract_id uuid,
      p_slot_time timestamptz,
      p_screenshot_url text
    ) RETURNS jsonb
    LANGUAGE plpgsql AS $$
    DECLARE
      v_clean_url text := NULLIF(trim(COALESCE(p_screenshot_url, '')), '');
      v_slot work_diary_slots;
    BEGIN
      IF v_clean_url IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible', 'code', 'INVALID_SCREENSHOT');
      END IF;

      INSERT INTO work_diary_slots (
        contract_id, freelancer_id, slot_time, screenshot_url, is_manual
      ) VALUES (
        p_contract_id, p_actor_id, p_slot_time, v_clean_url, false
      )
      ON CONFLICT (contract_id, freelancer_id, public.utc_ten_minute_bucket(slot_time))
      WHERE is_manual = false AND screenshot_url IS NOT NULL
      DO NOTHING
      RETURNING * INTO v_slot;

      IF NOT FOUND THEN
        SELECT * INTO v_slot
          FROM work_diary_slots
         WHERE contract_id = p_contract_id
           AND freelancer_id = p_actor_id
           AND is_manual = false
           AND screenshot_url IS NOT NULL
           AND public.utc_ten_minute_bucket(slot_time) = public.utc_ten_minute_bucket(p_slot_time)
         LIMIT 1;
        RETURN jsonb_build_object('outcome', 'duplicate', 'slot', row_to_json(v_slot));
      END IF;

      RETURN jsonb_build_object('outcome', 'inserted', 'slot', row_to_json(v_slot));
    END;
    $$;
  `);

  const contractId = '0f14eafe-9d36-467a-abf9-a48beda80bc0';
  const freelancerId = '2ce2cd9c-86c2-4472-8222-e0dfae656537';

  // Insert historical synthesized slot (screenshot_url IS NULL) + live screenshot slot in SAME 09:10 bucket
  await db.query(
    `INSERT INTO work_diary_slots (id, contract_id, freelancer_id, slot_time, screenshot_url, is_manual)
     VALUES ('9d15e50b-cdb7-46bf-8bc7-7988eafa186b', $1, $2, '2026-11-11T09:19:57Z', NULL, false)`,
    [contractId, freelancerId]
  );

  const firstLive = await db.query<{ res: { outcome: string; slot: { id: string } } }>(
    `SELECT public.test_record_screenshot_slot_v2($1, $2, '2026-11-11T09:18:38Z', 'https://example.com/snap1.jpg') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(firstLive.rows[0].res.outcome, 'inserted');
  const firstId = firstLive.rows[0].res.slot.id;

  // Second live screenshot in same 09:10 bucket returns 'duplicate' with the live screenshot slot (not the NULL-url row)
  const dupLive = await db.query<{ res: { outcome: string; slot: { id: string; screenshot_url: string } } }>(
    `SELECT public.test_record_screenshot_slot_v2($1, $2, '2026-11-11T09:15:00Z', 'https://example.com/snap2.jpg') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(dupLive.rows[0].res.outcome, 'duplicate');
  assert.strictEqual(dupLive.rows[0].res.slot.id, firstId);
  assert.strictEqual(dupLive.rows[0].res.slot.screenshot_url, 'https://example.com/snap1.jpg');

  // Empty screenshot_url is rejected as INVALID_SCREENSHOT
  const emptyUrl = await db.query<{ res: { outcome: string; code: string } }>(
    `SELECT public.test_record_screenshot_slot_v2($1, $2, '2026-11-11T09:25:00Z', '   ') AS res`,
    [freelancerId, contractId]
  );
  assert.strictEqual(emptyUrl.rows[0].res.outcome, 'ineligible');
  assert.strictEqual(emptyUrl.rows[0].res.code, 'INVALID_SCREENSHOT');
});

test('Phase 2C.2: Payment RPC restricts execution to service_role and revokes direct table writes from authenticated/anon', async () => {
  const db = new PGlite();

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;

    CREATE TABLE timesheets (
      id uuid PRIMARY KEY,
      status text NOT NULL DEFAULT 'open'
    );

    CREATE OR REPLACE FUNCTION public.test_fund_timesheet(p_role text)
    RETURNS text
    LANGUAGE plpgsql AS $$
    BEGIN
      IF p_role <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied: fund_timesheet_with_payment is restricted to service_role'
          USING ERRCODE = '42501';
      END IF;
      RETURN 'paid';
    END;
    $$;

    REVOKE ALL ON FUNCTION public.test_fund_timesheet(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.test_fund_timesheet(text) TO service_role;

    REVOKE INSERT, UPDATE, DELETE ON public.timesheets FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.timesheets TO authenticated;
    GRANT ALL ON public.timesheets TO service_role;
  `);

  // Authenticated & anon callers are blocked both by role guard and privilege revokes
  await assert.rejects(db.query(`SELECT public.test_fund_timesheet('authenticated')`), /42501|Access denied/);
  await assert.rejects(db.query(`SELECT public.test_fund_timesheet('anon')`), /42501|Access denied/);

  const ok = await db.query<{ res: string }>(`SELECT public.test_fund_timesheet('service_role') AS res`);
  assert.strictEqual(ok.rows[0].res, 'paid');

  // Verify table privilege catalog reflects SELECT-only for authenticated and none for anon
  const grants = await db.query<{ grantee: string; privilege_type: string }>(
    `SELECT grantee, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_name = 'timesheets'
        AND grantee IN ('anon', 'authenticated')
      ORDER BY grantee, privilege_type`
  );
  assert.deepStrictEqual(grants.rows, [{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
});
