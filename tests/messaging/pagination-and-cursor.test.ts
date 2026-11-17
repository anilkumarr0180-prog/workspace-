import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, parseCursor } from '@/lib/messages-cursor';

test('Cursor Pagination - Encoding, Parsing, and Validation', async (t) => {
  await t.test('encodes createdAt and id deterministically', () => {
    const time = '2026-11-17T07:30:00.000Z';
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const cursor = encodeCursor(time, id);
    assert.strictEqual(cursor, `${time}_${id}`);
  });

  await t.test('parses composite cursor (<ISO timestamp>_<UUID>) accurately', () => {
    const time = '2026-11-17T07:30:00.000Z';
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const cursor = `${time}_${id}`;
    const parsed = parseCursor(cursor);
    assert.notStrictEqual(parsed, null);
    assert.strictEqual(parsed?.createdAt, time);
    assert.strictEqual(parsed?.id, id);
  });

  await t.test('parses pure ISO timestamp cursor fallback', () => {
    const time = '2026-11-17T07:30:00.000Z';
    const parsed = parseCursor(time);
    assert.notStrictEqual(parsed, null);
    assert.strictEqual(parsed?.createdAt, time);
    assert.strictEqual(parsed?.id, undefined);
  });

  await t.test('parses pure UUID cursor fallback', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const parsed = parseCursor(id);
    assert.notStrictEqual(parsed, null);
    assert.strictEqual(parsed?.createdAt, '');
    assert.strictEqual(parsed?.id, id);
  });

  await t.test('rejects malformed or invalid cursors', () => {
    assert.strictEqual(parseCursor(null), null);
    assert.strictEqual(parseCursor(undefined), null);
    assert.strictEqual(parseCursor(''), null);
    assert.strictEqual(parseCursor('   '), null);
    assert.strictEqual(parseCursor('not-a-date-or-uuid'), null);
    assert.strictEqual(parseCursor('2026-99-99_invalid-uuid'), null);
  });
});

test('Cursor Pagination - Keyset Tie-Breaking with Identical Timestamps', async (t) => {
  interface MockMessage {
    id: string;
    created_at: string;
    content: string;
  }

  // Sample data: messages where M2 and M3 share the exact same timestamp
  const messages: MockMessage[] = [
    { id: '11111111-1111-1111-1111-111111111111', created_at: '2026-11-17T10:00:00.000Z', content: 'Message 1' },
    { id: '22222222-2222-2222-2222-222222222222', created_at: '2026-11-17T10:05:00.000Z', content: 'Message 2' },
    { id: '33333333-3333-3333-3333-333333333333', created_at: '2026-11-17T10:05:00.000Z', content: 'Message 3' },
    { id: '44444444-4444-4444-4444-444444444444', created_at: '2026-11-17T10:10:00.000Z', content: 'Message 4' },
  ];

  // Simulating keyset condition: (created_at < cursor.time) OR (created_at = cursor.time AND id < cursor.id)
  function queryOlderMessages(cursorStr: string | null, limit: number): { results: MockMessage[]; nextCursor: string | null; hasMore: boolean } {
    let filtered = [...messages];
    if (cursorStr) {
      const parsed = parseCursor(cursorStr);
      assert.notStrictEqual(parsed, null);
      filtered = filtered.filter((m) => {
        const mTime = new Date(m.created_at).getTime();
        const cTime = new Date(parsed!.createdAt).getTime();
        if (mTime < cTime) return true;
        if (mTime === cTime && parsed!.id) return m.id.localeCompare(parsed!.id) < 0;
        return false;
      });
    }

    // Order created_at DESC, id DESC
    filtered.sort((a, b) => {
      const tDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (tDiff !== 0) return tDiff;
      return b.id.localeCompare(a.id);
    });

    const hasMore = filtered.length > limit;
    const sliced = hasMore ? filtered.slice(0, limit) : filtered;
    const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1].created_at, sliced[sliced.length - 1].id) : null;
    const chronological = sliced.slice().reverse();

    return { results: chronological, nextCursor, hasMore };
  }

  await t.test('paginates across identical timestamps without skipping messages', () => {
    // Page 1: limit 2 (fetches M4 and M3)
    const page1 = queryOlderMessages(null, 2);
    assert.strictEqual(page1.results.length, 2);
    assert.strictEqual(page1.results[0].content, 'Message 3');
    assert.strictEqual(page1.results[1].content, 'Message 4');
    assert.strictEqual(page1.hasMore, true);
    assert.notStrictEqual(page1.nextCursor, null);

    // Page 2: load earlier using nextCursor from page 1
    const page2 = queryOlderMessages(page1.nextCursor, 2);
    assert.strictEqual(page2.results.length, 2);
    assert.strictEqual(page2.results[0].content, 'Message 1');
    assert.strictEqual(page2.results[1].content, 'Message 2');
    assert.strictEqual(page2.hasMore, false);
    assert.strictEqual(page2.nextCursor, null);

    // Verify all 4 messages retrieved without gaps or duplicates
    const combined = [...page2.results, ...page1.results];
    assert.strictEqual(combined.length, 4);
    assert.deepStrictEqual(
      combined.map((m) => m.content),
      ['Message 1', 'Message 2', 'Message 3', 'Message 4']
    );
  });

  await t.test('newer-message recovery after cursor recovers new messages without duplicates', () => {
    // Client has seen up to Message 2
    const clientLatest = messages[1]; // Message 2
    const afterCursor = encodeCursor(clientLatest.created_at, clientLatest.id);

    const parsedAfter = parseCursor(afterCursor);
    assert.notStrictEqual(parsedAfter, null);

    // Simulating condition: (created_at > cursor.time) OR (created_at = cursor.time AND id > cursor.id)
    const newerMessages = messages.filter((m) => {
      const mTime = new Date(m.created_at).getTime();
      const cTime = new Date(parsedAfter!.createdAt).getTime();
      if (mTime > cTime) return true;
      if (mTime === cTime && parsedAfter!.id) return m.id.localeCompare(parsedAfter!.id) > 0;
      return false;
    });

    assert.strictEqual(newerMessages.length, 2);
    assert.strictEqual(newerMessages[0].content, 'Message 3'); // identical timestamp to M2, but id > M2.id
    assert.strictEqual(newerMessages[1].content, 'Message 4');
  });
});
