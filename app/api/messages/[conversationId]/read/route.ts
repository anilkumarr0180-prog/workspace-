import { NextResponse, NextRequest } from 'next/server';
import { markConversationAsRead } from '@/lib/actions/messages';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;
    const result = await markConversationAsRead(conversationId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update read status' },
        { status: result.error?.includes('Unauthorized') ? 403 : 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
