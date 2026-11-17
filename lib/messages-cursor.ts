export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministically encode a pagination cursor combining ISO timestamp and UUID.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}_${id}`;
}

/**
 * Safely parse and validate a cursor string.
 * Supports <ISO timestamp>_<UUID>, pure ISO timestamp, or pure UUID.
 */
export function parseCursor(cursor?: string | null): { createdAt: string; id?: string } | null {
  if (!cursor || typeof cursor !== 'string') return null;
  const trimmed = cursor.trim();
  if (!trimmed) return null;

  const lastUnderscore = trimmed.lastIndexOf('_');
  if (lastUnderscore !== -1) {
    const timePart = trimmed.slice(0, lastUnderscore);
    const idPart = trimmed.slice(lastUnderscore + 1);
    const parsedTime = Date.parse(timePart);
    if (!isNaN(parsedTime) && UUID_REGEX.test(idPart)) {
      return { createdAt: new Date(parsedTime).toISOString(), id: idPart };
    }
  }

  const parsedTime = Date.parse(trimmed);
  if (!isNaN(parsedTime)) {
    return { createdAt: new Date(parsedTime).toISOString() };
  }

  if (UUID_REGEX.test(trimmed)) {
    return { createdAt: '', id: trimmed };
  }

  return null;
}

