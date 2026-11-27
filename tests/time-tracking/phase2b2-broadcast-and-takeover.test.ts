import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKER_SYNC_EVENT_TYPES,
  createTrackerSyncEvent,
  parseTrackerSyncEvent,
  createEventDeduplicator,
} from '../../lib/tracker-broadcast';
import {
  type WebLockManagerLike,
  acquireWebCaptureLock,
  acquireWebCaptureLockWithTakeover,
} from '../../lib/capture-lease';

function createMockWebLocks(): WebLockManagerLike {
  const held = new Set<string>();
  return {
    async request<T>(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: unknown | null) => Promise<T>
    ): Promise<T> {
      if (options.ifAvailable && held.has(name)) {
        return callback(null);
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

test('All BroadcastChannel event types follow the shared contract with eventId and timestamp', () => {
  for (const type of TRACKER_SYNC_EVENT_TYPES) {
    const evt = createTrackerSyncEvent(type, {
      tabId: 'tab-1',
      freelancerId: 'free-1',
      contractId: 'contract-1',
    });

    assert.strictEqual(evt.type, type);
    assert.ok(typeof evt.eventId === 'string' && evt.eventId.startsWith(`${type}-`));
    assert.ok(typeof evt.timestamp === 'number' && Number.isFinite(evt.timestamp));
    assert.strictEqual(evt.tabId, 'tab-1');
    assert.strictEqual(evt.freelancerId, 'free-1');
    assert.strictEqual(evt.contractId, 'contract-1');

    const parsed = parseTrackerSyncEvent(evt);
    assert.deepStrictEqual(parsed, evt);
  }
});

test('SLOT_RECORDED follows the shared contract and malformed messages are ignored', () => {
  const slotEvt = createTrackerSyncEvent('SLOT_RECORDED', {
    contractId: 'contract-99',
    freelancerId: 'free-99',
    tabId: 'tab-99',
  });
  const parsed = parseTrackerSyncEvent(slotEvt);
  assert.ok(parsed);
  assert.strictEqual(parsed.type, 'SLOT_RECORDED');
  assert.ok(parsed.eventId.length > 0);
  assert.ok(parsed.timestamp > 0);

  assert.strictEqual(parseTrackerSyncEvent(null), null);
  assert.strictEqual(parseTrackerSyncEvent('TIMER_STARTED'), null);
  assert.strictEqual(parseTrackerSyncEvent({ type: 'TIMER_STARTED' }), null);
  assert.strictEqual(
    parseTrackerSyncEvent({ type: 'TIMER_STARTED', eventId: 'id-1', timestamp: NaN }),
    null
  );
  assert.strictEqual(
    parseTrackerSyncEvent({ type: 'UNKNOWN_EVENT', eventId: 'id-2', timestamp: Date.now() }),
    null
  );
});

test('Duplicate eventIds are not processed twice', () => {
  const isNew = createEventDeduplicator(10);
  const evt = createTrackerSyncEvent('TIMER_STOPPED', { contractId: 'c1' });

  assert.strictEqual(isNew(evt.eventId), true);
  assert.strictEqual(isNew(evt.eventId), false);
});

test('Capture takeover succeeds when previous owner releases asynchronously', async () => {
  const locksApi = createMockWebLocks();

  const tabA = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabA.acquired, true);

  // Tab B requests takeover; Tab A releases after 60ms
  const tabB = await acquireWebCaptureLockWithTakeover({
    freelancerId: 'free-1',
    forceTakeover: true,
    timeoutMs: 1000,
    pollIntervalMs: 20,
    locksApi,
    onRequestTakeover: () => {
      setTimeout(() => tabA.release(), 60);
    },
  });

  assert.strictEqual(tabB.acquired, true);
  assert.notStrictEqual(tabB.timedOut, true);

  // Exclusivity: Tab C cannot acquire while Tab B holds it
  const tabC = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabC.acquired, false);

  tabB.release();
});

test('Capture takeover times out cleanly if previous owner never releases and respects AbortSignal', async () => {
  const locksApi = createMockWebLocks();

  const tabA = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabA.acquired, true);

  // Timeout case
  const timedOutAttempt = await acquireWebCaptureLockWithTakeover({
    freelancerId: 'free-1',
    forceTakeover: true,
    timeoutMs: 80,
    pollIntervalMs: 20,
    locksApi,
  });
  assert.strictEqual(timedOutAttempt.acquired, false);
  assert.strictEqual(timedOutAttempt.timedOut, true);

  // Cancellation case
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const abortedAttempt = await acquireWebCaptureLockWithTakeover({
    freelancerId: 'free-1',
    forceTakeover: true,
    timeoutMs: 1000,
    pollIntervalMs: 20,
    locksApi,
    signal: controller.signal,
  });
  assert.strictEqual(abortedAttempt.acquired, false);
  assert.strictEqual(abortedAttempt.timedOut, false);

  tabA.release();
});
