import { NextResponse, NextRequest } from 'next/server';
import {
  getConversations,
  getUnreadMessageCount,
  createOrGetConversation,
  sendMessage,
} from '@/lib/actions/messages';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unreadCount') === 'true';
    const search = searchParams.get('q') || undefined;

    if (unreadOnly) {
      const result = await getUnreadMessageCount();
      return NextResponse.json(result);
    }

    const result = await getConversations({ search });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch conversations' },
        { status: result.error?.includes('Authentication') ? 401 : 400 }
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 1. Initialize or get conversation
    if (body.proposalId || body.contractId) {
      const result = await createOrGetConversation({
        proposalId: body.proposalId,
        contractId: body.contractId,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to initialize conversation' },
          { status: result.error?.includes('Unauthorized') || result.error?.includes('Authentication') ? 403 : 400 }
        );
      }

      return NextResponse.json(result, { status: 201 });
    }

    // 2. Send message if conversationId & content provided
    if (body.conversationId && (body.content !== undefined || body.attachmentPath)) {
      const result = await sendMessage({
        conversationId: body.conversationId,
        content: body.content,
        messageType: body.messageType,
        attachmentPath: body.attachmentPath,
        attachmentName: body.attachmentName,
        attachmentSize: body.attachmentSize,
        attachmentType: body.attachmentType,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to send message' },
          { status: result.error?.includes('Unauthorized') ? 403 : 400 }
        );
      }

      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json(
      { error: 'Invalid request body. Expected proposalId, contractId, or message payload' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
