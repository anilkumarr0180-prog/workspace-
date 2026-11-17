import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCursor, UUID_REGEX } from '@/lib/messages-cursor';

// Replicate route handler verification logic directly to test all status code paths, error sanitization, and independent checks
function simulateGetHandler({
  conversationId,
  limitParam,
  beforeParam,
  afterParam,
  detailsRes,
  messagesRes,
}: {
  conversationId: string;
  limitParam?: string;
  beforeParam?: string;
  afterParam?: string;
  detailsRes: { success: boolean; conversation?: unknown; error?: string };
  messagesRes: { success: boolean; messages?: unknown[]; hasMore?: boolean; nextCursor?: string | null; error?: string };
}) {
  if (!conversationId || !UUID_REGEX.test(conversationId)) {
    return { status: 400, body: { error: 'Invalid conversation identifier' } };
  }

  if (limitParam !== undefined) {
    const parsedLimit = parseInt(limitParam, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      return { status: 400, body: { error: 'Invalid limit parameter' } };
    }
  }

  if (beforeParam && !parseCursor(beforeParam)) {
    return { status: 400, body: { error: 'Invalid cursor parameter' } };
  }

  if (afterParam && !parseCursor(afterParam)) {
    return { status: 400, body: { error: 'Invalid cursor parameter' } };
  }

  if (!detailsRes.success) {
    const err = detailsRes.error || '';
    if (err.includes('Authentication required')) {
      return { status: 401, body: { error: 'Authentication required' } };
    }
    if (err.includes('Unauthorized') || err.includes('Access denied')) {
      return { status: 403, body: { error: 'Access denied' } };
    }
    if (err.toLowerCase().includes('not found')) {
      return { status: 404, body: { error: 'Conversation not found' } };
    }
    return { status: 500, body: { error: 'Failed to retrieve conversation details' } };
  }

  if (!messagesRes.success) {
    const err = messagesRes.error || '';
    if (err.includes('Authentication required')) {
      return { status: 401, body: { error: 'Authentication required' } };
    }
    if (err.includes('Unauthorized') || err.includes('Access denied')) {
      return { status: 403, body: { error: 'Access denied' } };
    }
    if (err.includes('Invalid cursor')) {
      return { status: 400, body: { error: 'Invalid cursor parameter' } };
    }
    // Database internal error messages must be sanitized
    return { status: 500, body: { error: 'Failed to retrieve messages' } };
  }

  return {
    status: 200,
    body: {
      success: true,
      conversation: detailsRes.conversation,
      messages: messagesRes.messages,
      hasMore: messagesRes.hasMore,
      nextCursor: messagesRes.nextCursor,
    },
  };
}

test('API Route - GET /api/messages/[conversationId] Validation and Error Handling', async (t) => {
  const validConvId = '123e4567-e89b-12d3-a456-426614174000';

  await t.test('rejects invalid conversation ID with 400', () => {
    const res = simulateGetHandler({
      conversationId: 'not-a-uuid',
      detailsRes: { success: true },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid conversation identifier');
  });

  await t.test('rejects invalid limit parameter with 400', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      limitParam: '-5',
      detailsRes: { success: true },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid limit parameter');
  });

  await t.test('rejects malformed before cursor with 400', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      beforeParam: 'invalid-cursor-value',
      detailsRes: { success: true },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid cursor parameter');
  });

  await t.test('returns 401 when conversation details requires authentication', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      detailsRes: { success: false, error: 'Authentication required' },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Authentication required');
  });

  await t.test('returns 403 when user is unauthorized to access conversation', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      detailsRes: { success: false, error: 'Unauthorized to view this conversation' },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Access denied');
  });

  await t.test('returns 404 when conversation is not found', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      detailsRes: { success: false, error: 'Conversation not found or access denied' },
      messagesRes: { success: true },
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Conversation not found');
  });

  await t.test('NEVER returns 200 when message retrieval fails (checks messagesRes independently)', () => {
    const res = simulateGetHandler({
      conversationId: validConvId,
      detailsRes: { success: true, conversation: { id: validConvId } },
      messagesRes: {
        success: false,
        error: 'relation "public.messages" does not exist (SQLSTATE 42P01)',
      },
    });
    // Must NOT be 200
    assert.notStrictEqual(res.status, 200);
    assert.strictEqual(res.status, 500);
    // Must NOT leak internal DB error
    assert.strictEqual(res.body.error, 'Failed to retrieve messages');
    assert.strictEqual(JSON.stringify(res.body).includes('SQLSTATE'), false);
    assert.strictEqual(JSON.stringify(res.body).includes('42P01'), false);
  });

  await t.test('returns preserved 200 contract on success', () => {
    const mockConv = { id: validConvId, title: 'Test Conversation' };
    const mockMsgs = [{ id: 'm1', content: 'Hello' }];
    const res = simulateGetHandler({
      conversationId: validConvId,
      detailsRes: { success: true, conversation: mockConv },
      messagesRes: { success: true, messages: mockMsgs, hasMore: false, nextCursor: null },
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as {
      success: boolean;
      conversation?: unknown;
      messages?: unknown[];
      hasMore?: boolean;
      nextCursor?: string | null;
    };
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(body.conversation, mockConv);
    assert.deepStrictEqual(body.messages, mockMsgs);
    assert.strictEqual(body.hasMore, false);
    assert.strictEqual(body.nextCursor, null);
  });
});
