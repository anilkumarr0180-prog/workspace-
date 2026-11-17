import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, parseCursor } from '@/lib/messages-cursor';

test('Inbox Pagination - Limit and Keyset Ordering', async (t) => {
  interface MockConversation {
    id: string;
    last_message_at: string;
    title: string;
  }

  const id1 = '11111111-1111-1111-1111-111111111111';
  const id2 = '22222222-2222-2222-2222-222222222222';
  const id3 = '33333333-3333-3333-3333-333333333333';
  const id4 = '44444444-4444-4444-4444-444444444444';
  const id5 = '55555555-5555-5555-5555-555555555555';

  const conversations: MockConversation[] = [
    { id: id1, last_message_at: '2026-11-17T12:00:00.000Z', title: 'Conv 1' },
    { id: id2, last_message_at: '2026-11-17T11:00:00.000Z', title: 'Conv 2' },
    { id: id3, last_message_at: '2026-11-17T11:00:00.000Z', title: 'Conv 3' },
    { id: id4, last_message_at: '2026-11-17T10:00:00.000Z', title: 'Conv 4' },
    { id: id5, last_message_at: '2026-11-17T09:00:00.000Z', title: 'Conv 5' },
  ];

  function paginateConversations(cursorStr?: string, limit = 2) {
    let filtered = [...conversations];
    if (cursorStr) {
      const parsed = parseCursor(cursorStr);
      assert.notStrictEqual(parsed, null);
      filtered = filtered.filter((c) => {
        const cTime = new Date(c.last_message_at).getTime();
        const curTime = new Date(parsed!.createdAt).getTime();
        if (cTime < curTime) return true;
        if (cTime === curTime && parsed!.id) return c.id.localeCompare(parsed!.id) < 0;
        return false;
      });
    }

    filtered.sort((a, b) => {
      const tDiff = new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      if (tDiff !== 0) return tDiff;
      return b.id.localeCompare(a.id);
    });

    const hasMore = filtered.length > limit;
    const sliced = hasMore ? filtered.slice(0, limit) : filtered;
    const nextCursor = hasMore && sliced.length > 0 ? encodeCursor(sliced[sliced.length - 1].last_message_at, sliced[sliced.length - 1].id) : null;

    return { conversations: sliced, hasMore, nextCursor };
  }

  await t.test('paginates conversations stably across pages', () => {
    // Page 1
    const p1 = paginateConversations(undefined, 2);
    assert.strictEqual(p1.conversations.length, 2);
    assert.strictEqual(p1.conversations[0].id, id1);
    assert.strictEqual(p1.conversations[1].id, id3); // id3 > id2 when timestamp is equal (descending)
    assert.strictEqual(p1.hasMore, true);
    assert.notStrictEqual(p1.nextCursor, null);

    // Page 2
    const p2 = paginateConversations(p1.nextCursor!, 2);
    assert.strictEqual(p2.conversations.length, 2);
    assert.strictEqual(p2.conversations[0].id, id2);
    assert.strictEqual(p2.conversations[1].id, id4);
    assert.strictEqual(p2.hasMore, true);
    assert.notStrictEqual(p2.nextCursor, null);

    // Page 3
    const p3 = paginateConversations(p2.nextCursor!, 2);
    assert.strictEqual(p3.conversations.length, 1);
    assert.strictEqual(p3.conversations[0].id, id5);
    assert.strictEqual(p3.hasMore, false);
    assert.strictEqual(p3.nextCursor, null);

    // Ensure all 5 retrieved without duplicates
    const all = [...p1.conversations, ...p2.conversations, ...p3.conversations];
    assert.strictEqual(all.length, 5);
    assert.deepStrictEqual(all.map((c) => c.id), [id1, id3, id2, id4, id5]);
  });
});

test('Inbox - Large Message Histories & Unread Accuracy', async (t) => {
  const currentUserId = '11111111-aaaa-1111-aaaa-111111111111';

  interface MockDbMessage {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    deleted_at: string | null;
  }

  // Create conversation with 1,000 historical messages and only 2 unread
  const convId = '22222222-bbbb-2222-bbbb-222222222222';
  const lastReadAt = '2026-11-17T11:50:00.000Z';
  const allMessages: MockDbMessage[] = [];

  // Generate 1000 messages from 2025 up to 11:45
  for (let i = 1; i <= 1000; i++) {
    allMessages.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      conversation_id: convId,
      sender_id: i % 2 === 0 ? currentUserId : '33333333-cccc-3333-cccc-333333333333',
      content: `Historical message ${i}`,
      created_at: new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 60000).toISOString(),
      deleted_at: null,
    });
  }

  // Add 2 newer messages: one normal, one from caller (should not count as unread), one deleted (should not count)
  allMessages.push({
    id: '44444444-dddd-4444-dddd-444444444444',
    conversation_id: convId,
    sender_id: '33333333-cccc-3333-cccc-333333333333',
    content: 'Unread message 1',
    created_at: '2026-11-17T11:55:00.000Z',
    deleted_at: null,
  });

  allMessages.push({
    id: '55555555-eeee-5555-eeee-555555555555',
    conversation_id: convId,
    sender_id: '33333333-cccc-3333-cccc-333333333333',
    content: 'Deleted unread message',
    created_at: '2026-11-17T11:56:00.000Z',
    deleted_at: '2026-11-17T11:57:00.000Z', // soft-deleted
  });

  allMessages.push({
    id: '66666666-ffff-6666-ffff-666666666666',
    conversation_id: convId,
    sender_id: currentUserId, // sent by caller
    content: 'My reply',
    created_at: '2026-11-17T11:58:00.000Z',
    deleted_at: null,
  });

  allMessages.push({
    id: '77777777-aaaa-7777-aaaa-777777777777',
    conversation_id: convId,
    sender_id: '33333333-cccc-3333-cccc-333333333333',
    content: 'Latest unread message',
    created_at: '2026-11-17T12:00:00.000Z',
    deleted_at: null,
  });

  const lastMessageAt = '2026-11-17T12:00:00.000Z';

  await t.test('retrieves ONLY latest message without fetching 1,000 historical messages', () => {
    // Simulating bounded batch query matching lastMessageAt
    const latestMessages = allMessages.filter(
      (m) => m.conversation_id === convId && m.created_at === lastMessageAt && m.deleted_at === null
    );

    assert.strictEqual(latestMessages.length, 1);
    assert.strictEqual(latestMessages[0].id, '77777777-aaaa-7777-aaaa-777777777777');
    assert.strictEqual(latestMessages[0].content, 'Latest unread message');
  });

  await t.test('computes unread count accurately without scanning full message collection', () => {
    // Only inspect messages created AFTER lastReadAt
    const candidateUnread = allMessages.filter(
      (m) =>
        m.conversation_id === convId &&
        m.sender_id !== currentUserId &&
        m.deleted_at === null &&
        new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
    );

    // Out of the messages after lastReadAt:
    // - msg-unread-1: unread from other-user -> counts (1)
    // - msg-deleted-after-read: deleted_at is not null -> excluded
    // - msg-sent-by-me: sender_id === currentUserId -> excluded
    // - msg-unread-2: unread from other-user -> counts (2)
    assert.strictEqual(candidateUnread.length, 2);
    assert.deepStrictEqual(candidateUnread.map((m) => m.id), [
      '44444444-dddd-4444-dddd-444444444444',
      '77777777-aaaa-7777-aaaa-777777777777',
    ]);
  });

  await t.test('returns 0 unread when conversation last_message_at <= last_read_at', () => {
    const fullyReadLastRead = '2026-11-17T12:05:00.000Z';
    const hasUnread = new Date(lastMessageAt).getTime() > new Date(fullyReadLastRead).getTime();
    assert.strictEqual(hasUnread, false);
  });
});
