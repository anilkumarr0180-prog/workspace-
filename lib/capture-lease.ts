/**
 * Cross-tab screenshot capture ownership manager.
 *
 * Primary mechanism: Web Locks API (`navigator.locks.request(..., { ifAvailable: true })`)
 * which provides atomic, browser-enforced mutual exclusion across tabs in the same origin
 * and automatically releases when a tab crashes or closes.
 *
 * Fallback mechanism (only when `navigator.locks` is unavailable):
 * Best-effort `localStorage` lease with 90s TTL and 20s heartbeat.
 * NOTE: The `localStorage` fallback is best-effort and NOT atomic under simultaneous
 * acquisition. This is a browser-profile coordinator, not a cross-device lock.
 */

export const CAPTURE_LEASE_STORAGE_KEY_PREFIX = 'workspace_screen_capture_lease';
export const CAPTURE_LOCK_NAME_PREFIX = 'workspace_screen_capture_lock';
export const CAPTURE_LEASE_TTL_MS = 90_000;
export const CAPTURE_HEARTBEAT_INTERVAL_MS = 20_000;

export interface CaptureLease {
  tabId: string;
  freelancerId: string;
  contractId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebLockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown | null) => Promise<T>
  ): Promise<T>;
}

export interface WebLockAcquisition {
  acquired: boolean;
  supported: boolean;
  timedOut?: boolean;
  release: () => void;
}

export function getCaptureLeaseKey(freelancerId?: string | null): string {
  const scope = freelancerId && freelancerId.trim() ? freelancerId.trim() : 'default';
  return `${CAPTURE_LEASE_STORAGE_KEY_PREFIX}_${scope}`;
}

export function getCaptureLockName(freelancerId?: string | null): string {
  const scope = freelancerId && freelancerId.trim() ? freelancerId.trim() : 'default';
  return `${CAPTURE_LOCK_NAME_PREFIX}_${scope}`;
}

function getSafeStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSafeLocksApi(locksApi?: WebLockManagerLike | null): WebLockManagerLike | null {
  if (locksApi !== undefined) return locksApi;
  if (typeof navigator === 'undefined') return null;
  try {
    const locks = (navigator as unknown as { locks?: WebLockManagerLike }).locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

/**
 * Atomically acquire the screenshot capture lock via the Web Locks API (`ifAvailable: true`).
 * The returned `release()` function MUST be called when capture stops or unmounts.
 */
export async function acquireWebCaptureLock(params: {
  freelancerId?: string | null;
  locksApi?: WebLockManagerLike | null;
}): Promise<WebLockAcquisition> {
  const { freelancerId, locksApi } = params;
  const locks = getSafeLocksApi(locksApi);

  if (!locks) {
    return {
      acquired: false,
      supported: false,
      release: () => {},
    };
  }

  const lockName = getCaptureLockName(freelancerId);

  return new Promise<WebLockAcquisition>((resolve) => {
    let settled = false;
    let releaseHold: (() => void) | null = null;

    const holdPromise = new Promise<void>((resolveHold) => {
      releaseHold = resolveHold;
    });

    locks
      .request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          if (!settled) {
            settled = true;
            resolve({
              acquired: false,
              supported: true,
              release: () => {},
            });
          }
          return;
        }

        if (!settled) {
          settled = true;
          resolve({
            acquired: true,
            supported: true,
            release: () => {
              releaseHold?.();
              releaseHold = null;
            },
          });
        }

        await holdPromise;
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          resolve({
            acquired: false,
            supported: false,
            release: () => {},
          });
        }
      });
  });
}

/**
 * Acquire the Web Lock, optionally requesting release from an existing owner and
 * waiting for actual lock availability up to `timeoutMs` without forcing an occupied lock.
 */
export async function acquireWebCaptureLockWithTakeover(params: {
  freelancerId?: string | null;
  forceTakeover?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onRequestTakeover?: () => void;
  locksApi?: WebLockManagerLike | null;
  signal?: AbortSignal;
}): Promise<WebLockAcquisition> {
  const {
    freelancerId,
    forceTakeover = false,
    timeoutMs = 2_500,
    pollIntervalMs = 40,
    onRequestTakeover,
    locksApi,
    signal,
  } = params;

  const firstAttempt = await acquireWebCaptureLock({ freelancerId, locksApi });
  if (!firstAttempt.supported || firstAttempt.acquired || !forceTakeover) {
    return firstAttempt;
  }

  // Request current owner to stop local capture and release the Web Lock
  onRequestTakeover?.();

  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { acquired: false, supported: true, timedOut: false, release: () => {} };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    if (signal?.aborted) {
      return { acquired: false, supported: true, timedOut: false, release: () => {} };
    }
    const retry = await acquireWebCaptureLock({ freelancerId, locksApi });
    if (!retry.supported || retry.acquired) {
      return retry;
    }
  }

  return {
    acquired: false,
    supported: true,
    timedOut: true,
    release: () => {},
  };
}

export function readCaptureLease(
  freelancerId?: string | null,
  storage?: StorageLike | null
): CaptureLease | null {
  const store = getSafeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(getCaptureLeaseKey(freelancerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureLease>;
    if (
      typeof parsed.tabId === 'string' &&
      typeof parsed.contractId === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      typeof parsed.acquiredAt === 'number'
    ) {
      return {
        tabId: parsed.tabId,
        freelancerId: typeof parsed.freelancerId === 'string' ? parsed.freelancerId : 'default',
        contractId: parsed.contractId,
        acquiredAt: parsed.acquiredAt,
        expiresAt: parsed.expiresAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function isLeaseActive(
  lease: CaptureLease | null,
  nowMs: number = Date.now()
): boolean {
  return Boolean(lease && lease.expiresAt > nowMs);
}

/**
 * Best-effort (non-atomic) fallback lease acquisition via `localStorage`.
 */
export function tryAcquireCaptureLease(params: {
  tabId: string;
  freelancerId?: string | null;
  contractId: string;
  nowMs?: number;
  ttlMs?: number;
  forceTakeover?: boolean;
  storage?: StorageLike | null;
}): { acquired: boolean; lease: CaptureLease | null; heldByOtherTab: boolean } {
  const {
    tabId,
    freelancerId,
    contractId,
    nowMs = Date.now(),
    ttlMs = CAPTURE_LEASE_TTL_MS,
    forceTakeover = false,
    storage,
  } = params;

  const scope = freelancerId && freelancerId.trim() ? freelancerId.trim() : 'default';
  const key = getCaptureLeaseKey(scope);
  const store = getSafeStorage(storage);

  if (!store) {
    return {
      acquired: false,
      lease: null,
      heldByOtherTab: false,
    };
  }

  const existing = readCaptureLease(scope, store);
  if (
    !forceTakeover &&
    existing &&
    existing.tabId !== tabId &&
    isLeaseActive(existing, nowMs)
  ) {
    return {
      acquired: false,
      lease: existing,
      heldByOtherTab: true,
    };
  }

  const nextLease: CaptureLease = {
    tabId,
    freelancerId: scope,
    contractId,
    acquiredAt: existing?.tabId === tabId ? existing.acquiredAt : nowMs,
    expiresAt: nowMs + ttlMs,
  };

  try {
    store.setItem(key, JSON.stringify(nextLease));
    return {
      acquired: true,
      lease: nextLease,
      heldByOtherTab: false,
    };
  } catch {
    return {
      acquired: false,
      lease: null,
      heldByOtherTab: false,
    };
  }
}

/**
 * Renew a fallback lease only if this tab is still the active (non-expired) owner.
 * Prevents expired owners from renewing stale leases.
 */
export function renewCaptureLease(params: {
  tabId: string;
  freelancerId?: string | null;
  contractId: string;
  nowMs?: number;
  ttlMs?: number;
  storage?: StorageLike | null;
}): boolean {
  const {
    tabId,
    freelancerId,
    contractId,
    nowMs = Date.now(),
    ttlMs = CAPTURE_LEASE_TTL_MS,
    storage,
  } = params;

  const scope = freelancerId && freelancerId.trim() ? freelancerId.trim() : 'default';
  const key = getCaptureLeaseKey(scope);
  const store = getSafeStorage(storage);
  if (!store) return false;

  const existing = readCaptureLease(scope, store);
  if (!existing || existing.tabId !== tabId || !isLeaseActive(existing, nowMs)) {
    return false;
  }

  const renewed: CaptureLease = {
    tabId,
    freelancerId: scope,
    contractId,
    acquiredAt: existing.acquiredAt,
    expiresAt: nowMs + ttlMs,
  };

  try {
    store.setItem(key, JSON.stringify(renewed));
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the fallback lease only if this tab is the current owner.
 * Prevents an old owner from releasing a newer owner's lease.
 */
export function releaseCaptureLease(params: {
  tabId: string;
  freelancerId?: string | null;
  storage?: StorageLike | null;
}): boolean {
  const { tabId, freelancerId, storage } = params;
  const scope = freelancerId && freelancerId.trim() ? freelancerId.trim() : 'default';
  const key = getCaptureLeaseKey(scope);
  const store = getSafeStorage(storage);
  if (!store) return false;

  const existing = readCaptureLease(scope, store);
  if (existing && existing.tabId !== tabId) {
    return false;
  }

  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function isTabLeaseOwner(params: {
  tabId: string;
  freelancerId?: string | null;
  nowMs?: number;
  storage?: StorageLike | null;
}): boolean {
  const { tabId, freelancerId, nowMs = Date.now(), storage } = params;
  const store = getSafeStorage(storage);
  if (!store) return false;
  const existing = readCaptureLease(freelancerId, store);
  if (!existing) return false;
  return existing.tabId === tabId && isLeaseActive(existing, nowMs);
}
