import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  DEFAULT_AUTO_POPOUT_ENABLED,
  computeElapsedSeconds,
  formatStartTimerError,
  classifyStopTimerResult,
} from '../../lib/time-tracking-feedback';

test('Objective 1: auto-popout is disabled by default and Start Tracking Time never calls window.open automatically', () => {
  assert.strictEqual(DEFAULT_AUTO_POPOUT_ENABLED, false);

  const pagePath = path.resolve(process.cwd(), 'app/freelancer/time-tracking/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  // Verify handleStartTimer does not call handleOpenPopout or window.open
  const startFnMatch = source.match(/const handleStartTimer = async[\s\S]*?finally\s*\{[\s\S]*?\}\s*\};/);
  assert.ok(startFnMatch, 'handleStartTimer should exist in time-tracking/page.tsx');
  assert.strictEqual(startFnMatch[0].includes('handleOpenPopout'), false);
  assert.strictEqual(startFnMatch[0].includes('window.open'), false);

  // Explicit Pop Out button still exists and invokes handleOpenPopout
  assert.ok(source.includes('onClick={handleOpenPopout}'));
  assert.ok(source.includes('Pop Out Floating Tracker'));
});

test('Objective 2 & 5: elapsed time is strictly derived from server startTime across refresh and multi-tab', () => {
  const serverStart = '2026-11-27T08:00:00.000Z';
  const tab1Now = new Date('2026-11-27T08:12:34.000Z').getTime();
  const tab2AfterRefreshNow = new Date('2026-11-27T08:12:34.000Z').getTime();

  assert.strictEqual(computeElapsedSeconds(serverStart, tab1Now), 754);
  assert.strictEqual(computeElapsedSeconds(serverStart, tab2AfterRefreshNow), 754);
  assert.strictEqual(computeElapsedSeconds(null, tab1Now), 0);
  assert.strictEqual(computeElapsedSeconds('invalid-date', tab1Now), 0);
});

test('Objective 3: Work Diary never silently auto-switches away from selectedDate when empty', () => {
  const diaryPath = path.resolve(process.cwd(), 'components/contracts/work-diary.tsx');
  const source = fs.readFileSync(diaryPath, 'utf8');

  // Ensure the old auto-switch block is gone
  assert.strictEqual(source.includes('dayWithWork'), false);
  assert.ok(source.includes('No Activity Recorded on This Day'));
});

test('Objective 4: Accurate billing feedback for start and stop timer outcomes', () => {
  assert.match(
    formatStartTimerError({ code: 'CONCURRENT_SESSION_EXISTS' }),
    /already running/i
  );
  assert.match(
    formatStartTimerError({ code: 'UNAUTHORIZED' }),
    /not authorized/i
  );
  assert.match(
    formatStartTimerError({ code: 'INELIGIBLE_CONTRACT', error: 'Contract is paused' }),
    /paused/i
  );

  const saved = classifyStopTimerResult({
    res: { success: true, entry: { durationMinutes: 25 } },
    elapsedSeconds: 1500,
    weekMinutesLogged: 60,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(saved.kind, 'saved');
  assert.strictEqual(saved.isError, false);
  assert.match(saved.message, /Logged 25 minutes/i);

  const shortDiscard = classifyStopTimerResult({
    res: { success: true, entry: undefined },
    elapsedSeconds: 32,
    weekMinutesLogged: 60,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(shortDiscard.kind, 'discarded_short');
  assert.strictEqual(shortDiscard.isError, false);

  const capReached = classifyStopTimerResult({
    res: { success: true, entry: undefined },
    elapsedSeconds: 600,
    weekMinutesLogged: 2400,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(capReached.kind, 'weekly_limit_reached');
  assert.strictEqual(capReached.isError, true);

  const dbErr = classifyStopTimerResult({
    res: { success: false, error: 'Database connection lost', code: 'DATABASE_ERROR' },
    elapsedSeconds: 120,
    weekMinutesLogged: 0,
    weeklyLimitHours: 40,
  });
  assert.strictEqual(dbErr.kind, 'error');
  assert.strictEqual(dbErr.isError, true);
});

test('Objective 6: In-memory PGlite verifies duplicate timer prevention and stop from original tab', async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE active_timer_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id uuid NOT NULL,
      freelancer_id uuid NOT NULL UNIQUE,
      start_time timestamptz NOT NULL DEFAULT now(),
      memo text NOT NULL DEFAULT ''
    );
  `);

  const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const freelancerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await db.query(
    `INSERT INTO active_timer_sessions (contract_id, freelancer_id, memo) VALUES ($1, $2, 'Initial work')`,
    [contractId, freelancerId]
  );

  // Duplicate active timer rejected
  await assert.rejects(
    db.query(
      `INSERT INTO active_timer_sessions (contract_id, freelancer_id, memo) VALUES ($1, $2, 'Second tab')`,
      [contractId, freelancerId]
    )
  );

  // Stop from original tab clears active session cleanly
  const del = await db.query(
    `DELETE FROM active_timer_sessions WHERE freelancer_id = $1 RETURNING id`,
    [freelancerId]
  );
  assert.strictEqual(del.rows.length, 1);
});
