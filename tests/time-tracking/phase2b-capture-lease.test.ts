import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_LEASE_TTL_MS,
  CAPTURE_HEARTBEAT_INTERVAL_MS,
  type StorageLike,
  type WebLockManagerLike,
  getCaptureLeaseKey,
  getCaptureLockName,
  acquireWebCaptureLock,
  readCaptureLease,
  tryAcquireCaptureLease,
  renewCaptureLease,
  releaseCaptureLease,
  isTabLeaseOwner,
} from '../../lib/capture-lease';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

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

test('Web Locks API provides atomic cross-tab mutual exclusion scoped by freelancerId', async () => {
  const locksApi = createMockWebLocks();

  assert.strictEqual(getCaptureLockName('free-1'), 'workspace_screen_capture_lock_free-1');
  assert.strictEqual(getCaptureLeaseKey('free-1'), 'workspace_screen_capture_lease_free-1');

  const tabA = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabA.supported, true);
  assert.strictEqual(tabA.acquired, true);

  // Second tab for same freelancer is atomically rejected while Tab A holds the lock
  const tabB = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabB.supported, true);
  assert.strictEqual(tabB.acquired, false);

  // Different freelancer in same browser is isolated
  const otherFreelancer = await acquireWebCaptureLock({ freelancerId: 'free-2', locksApi });
  assert.strictEqual(otherFreelancer.acquired, true);
  otherFreelancer.release();

  // After Tab A releases, Tab B can acquire
  tabA.release();
  await new Promise((r) => setTimeout(r, 0));
  const tabBAfter = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi });
  assert.strictEqual(tabBAfter.acquired, true);
  tabBAfter.release();
});

test('Reports supported: false safely when Web Locks API is unavailable', async () => {
  const res = await acquireWebCaptureLock({ freelancerId: 'free-1', locksApi: null });
  assert.strictEqual(res.supported, false);
  assert.strictEqual(res.acquired, false);
});

test('Fallback lease uses 90s TTL / 20s heartbeat and enforces single-tab ownership per freelancer', () => {
  assert.strictEqual(CAPTURE_LEASE_TTL_MS, 90_000);
  assert.strictEqual(CAPTURE_HEARTBEAT_INTERVAL_MS, 20_000);

  const storage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  const tabA = tryAcquireCaptureLease({
    tabId: 'tab-a',
    freelancerId: 'free-1',
    contractId: 'contract-1',
    nowMs: t0,
    storage,
  });
  assert.strictEqual(tabA.acquired, true);
  assert.strictEqual(isTabLeaseOwner({ tabId: 'tab-a', freelancerId: 'free-1', nowMs: t0 + 1000, storage }), true);

  const tabB = tryAcquireCaptureLease({
    tabId: 'tab-b',
    freelancerId: 'free-1',
    contractId: 'contract-1',
    nowMs: t0 + 2000,
    storage,
  });
  assert.strictEqual(tabB.acquired, false);
  assert.strictEqual(tabB.heldByOtherTab, true);
});

test('Expired fallback owner cannot renew stale lease, and recovery transfers ownership', () => {
  const storage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  tryAcquireCaptureLease({
    tabId: 'tab-crashed',
    freelancerId: 'free-1',
    contractId: 'contract-1',
    nowMs: t0,
    storage,
  });

  const afterExpiry = t0 + CAPTURE_LEASE_TTL_MS + 1;
  // Expired owner cannot renew its stale lease
  assert.strictEqual(
    renewCaptureLease({
      tabId: 'tab-crashed',
      freelancerId: 'free-1',
      contractId: 'contract-1',
      nowMs: afterExpiry,
      storage,
    }),
    false
  );

  // Tab B recovers ownership after expiry
  const tabB = tryAcquireCaptureLease({
    tabId: 'tab-b',
    freelancerId: 'free-1',
    contractId: 'contract-1',
    nowMs: afterExpiry,
    storage,
  });
  assert.strictEqual(tabB.acquired, true);
  assert.strictEqual(isTabLeaseOwner({ tabId: 'tab-b', freelancerId: 'free-1', nowMs: afterExpiry + 100, storage }), true);
});

test('Old owner cannot release a newer owner lease, and throwing/null storage fails closed', () => {
  const storage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  tryAcquireCaptureLease({ tabId: 'tab-a', freelancerId: 'free-1', contractId: 'contract-1', nowMs: t0, storage });
  assert.strictEqual(releaseCaptureLease({ tabId: 'tab-b', freelancerId: 'free-1', storage }), false);
  assert.ok(readCaptureLease('free-1', storage));

  assert.strictEqual(releaseCaptureLease({ tabId: 'tab-a', freelancerId: 'free-1', storage }), true);
  assert.strictEqual(readCaptureLease('free-1', storage), null);

  const throwingStorage: StorageLike = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };

  assert.strictEqual(
    tryAcquireCaptureLease({ tabId: 'tab-a', freelancerId: 'free-1', contractId: 'c1', storage: throwingStorage }).acquired,
    false
  );
  assert.strictEqual(
    tryAcquireCaptureLease({ tabId: 'tab-a', freelancerId: 'free-1', contractId: 'c1', storage: null }).acquired,
    false
  );
});
