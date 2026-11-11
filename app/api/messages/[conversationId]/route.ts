import { NextResponse, NextRequest } from 'next/server';
import {
  getConversationDetails,
  getMessages,
  sendMessage,
} from '@/lib/actions/messages';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;
    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 40;

    const [detailsRes, messagesRes] = await Promise.all([
      getConversationDetails(conversationId),
      getMessages(conversationId, { before, limit }),
    ]);

    if (!detailsRes.success) {
      return NextResponse.json(
        { error: detailsRes.error || 'Conversation not found' },
        { status: detailsRes.error?.includes('Unauthorized') ? 403 : 404 }
      );
    }

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
      return NextResponse.json(
        { error: result.error || 'Failed to send message' },
        { status: result.error?.includes('Unauthorized') ? 403 : 400 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
