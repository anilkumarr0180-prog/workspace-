/**
 * Shared typed BroadcastChannel contract for workspace time-tracking & screen capture sync.
 * Every message includes `type`, `eventId`, and `timestamp`.
 */

export const TRACKER_SYNC_CHANNEL = 'workspace_time_tracker_sync';

export const TRACKER_SYNC_EVENT_TYPES = [
  'TIMER_STARTED',
  'TIMER_STOPPED',
  'TIMER_DISCARDED',
  'CAPTURE_LOCK_ACQUIRED',
  'CAPTURE_LOCK_RELEASED',
  'CAPTURE_TAKEOVER_REQUESTED',
  'SLOT_RECORDED',
  'SYNC_STATE',
] as const;

export type TrackerSyncEventType = (typeof TRACKER_SYNC_EVENT_TYPES)[number];

export interface TrackerSyncPayload {
  tabId?: string;
  freelancerId?: string;
  contractId?: string;
}

export interface TrackerSyncEvent extends TrackerSyncPayload {
  type: TrackerSyncEventType;
  eventId: string;
  timestamp: number;
}

const VALID_TYPES = new Set<string>(TRACKER_SYNC_EVENT_TYPES);

function generateEventId(type: TrackerSyncEventType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${type}-${crypto.randomUUID()}`;
  }
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTrackerSyncEvent(
  type: TrackerSyncEventType,
  payload: TrackerSyncPayload = {}
): TrackerSyncEvent {
  return {
    type,
    eventId: generateEventId(type),
    timestamp: Date.now(),
    ...(payload.tabId ? { tabId: payload.tabId } : {}),
    ...(payload.freelancerId ? { freelancerId: payload.freelancerId } : {}),
    ...(payload.contractId ? { contractId: payload.contractId } : {}),
  };
}

export function postTrackerSyncEvent(
  type: TrackerSyncEventType,
  payload: TrackerSyncPayload = {}
): TrackerSyncEvent | null {
  const event = createTrackerSyncEvent(type, payload);
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel(TRACKER_SYNC_CHANNEL);
      channel.postMessage(event);
      channel.close();
      return event;
    }
  } catch {
    // Non-fatal in restricted browser environments
  }
  return null;
}

export function parseTrackerSyncEvent(raw: unknown): TrackerSyncEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<TrackerSyncEvent>;

  if (typeof candidate.type !== 'string' || !VALID_TYPES.has(candidate.type)) {
    return null;
  }
  if (typeof candidate.eventId !== 'string' || !candidate.eventId.trim()) {
    return null;
  }
  if (typeof candidate.timestamp !== 'number' || !Number.isFinite(candidate.timestamp)) {
    return null;
  }

  return {
    type: candidate.type as TrackerSyncEventType,
    eventId: candidate.eventId,
    timestamp: candidate.timestamp,
    ...(typeof candidate.tabId === 'string' ? { tabId: candidate.tabId } : {}),
    ...(typeof candidate.freelancerId === 'string'
      ? { freelancerId: candidate.freelancerId }
      : {}),
    ...(typeof candidate.contractId === 'string' ? { contractId: candidate.contractId } : {}),
  };
}

export function createEventDeduplicator(maxSize = 50): (eventId: string) => boolean {
  const seen: string[] = [];
  const seenSet = new Set<string>();

  return (eventId: string): boolean => {
    if (!eventId || seenSet.has(eventId)) {
      return false;
    }
    seen.push(eventId);
    seenSet.add(eventId);
    if (seen.length > maxSize) {
      const oldest = seen.shift();
      if (oldest) seenSet.delete(oldest);
    }
    return true;
  };
}
