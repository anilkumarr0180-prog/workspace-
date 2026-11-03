import { NextResponse, NextRequest } from 'next/server';
import { editMessage, deleteMessage } from '@/lib/actions/messages';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const { messageId } = await context.params;
    const body = await request.json();

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const result = await editMessage(messageId, body.content);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to edit message' },
        { status: result.error?.includes('Unauthorized') ? 403 : 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ conversationId: string; messageId: string }> }
) {
  try {
    const { messageId } = await context.params;
    const result = await deleteMessage(messageId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete message' },
        { status: result.error?.includes('Unauthorized') ? 403 : 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
