import { NextResponse, NextRequest } from 'next/server';
import {
  getConversationDetails,
  getMessages,
  sendMessage,
} from '@/lib/actions/messages';
import { parseCursor, UUID_REGEX } from '@/lib/messages-cursor';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;

    // 1. Validate conversation ID parameter
    if (!conversationId || !UUID_REGEX.test(conversationId)) {
      return NextResponse.json(
        { error: 'Invalid conversation identifier' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before') || undefined;
    const after = searchParams.get('after') || undefined;
    const limitParam = searchParams.get('limit');

    let limit = 40;
    if (limitParam !== null && limitParam !== undefined) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return NextResponse.json(
          { error: 'Invalid limit parameter' },
          { status: 400 }
        );
      }
      limit = Math.min(parsedLimit, 100);
    }

    // Validate cursor formats upfront if present
    if (before && !parseCursor(before)) {
      return NextResponse.json(
        { error: 'Invalid cursor parameter' },
        { status: 400 }
      );
    }

    if (after && !parseCursor(after)) {
      return NextResponse.json(
        { error: 'Invalid cursor parameter' },
        { status: 400 }
      );
    }

    // 2. Fetch conversation details and messages concurrently
    const [detailsRes, messagesRes] = await Promise.all([
      getConversationDetails(conversationId),
      getMessages(conversationId, { before, after, limit }),
    ]);

    // 3. Check detailsRes independently with appropriate HTTP status codes
    if (!detailsRes.success) {
      const err = detailsRes.error || '';
      if (err.includes('Authentication required')) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      if (err.includes('Unauthorized') || err.includes('Access denied')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      if (err.toLowerCase().includes('not found')) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'Failed to retrieve conversation details' },
        { status: 500 }
      );
    }

    // 4. Check messagesRes independently — NEVER return 200 on failure and do not leak DB internals
    if (!messagesRes.success) {
      const err = messagesRes.error || '';
      if (err.includes('Authentication required')) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      if (err.includes('Unauthorized') || err.includes('Access denied')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      if (err.includes('Invalid cursor')) {
        return NextResponse.json({ error: 'Invalid cursor parameter' }, { status: 400 });
      }
      return NextResponse.json(
        { error: 'Failed to retrieve messages' },
        { status: 500 }
      );
    }

    // 5. Return preserved contract for successful requests
    return NextResponse.json({
      success: true,
      conversation: detailsRes.conversation,
      messages: messagesRes.messages,
      hasMore: messagesRes.hasMore,
      nextCursor: messagesRes.nextCursor,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;

    if (!conversationId || !UUID_REGEX.test(conversationId)) {
      return NextResponse.json(
        { error: 'Invalid conversation identifier' },
        { status: 400 }
      );
    }

    const body = await request.json();

    const result = await sendMessage({
      conversationId,
      content: body.content,
      messageType: body.messageType,
      attachmentPath: body.attachmentPath,
      attachmentName: body.attachmentName,
      attachmentSize: body.attachmentSize,
      attachmentType: body.attachmentType,
    });

    if (!result.success) {
      const err = result.error || '';
      if (err.includes('Authentication required')) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      if (err.includes('Unauthorized') || err.includes('not a participant')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      return NextResponse.json(
        { error: result.error || 'Failed to send message' },
        { status: 400 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
