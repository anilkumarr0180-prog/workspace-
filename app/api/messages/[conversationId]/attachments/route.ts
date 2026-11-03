import { NextResponse, NextRequest } from 'next/server';
import { uploadMessageAttachment } from '@/lib/actions/messages';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;
    const formData = await request.formData();

    const result = await uploadMessageAttachment(conversationId, formData);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to upload attachment' },
        { status: result.error?.includes('Unauthorized') ? 403 : 400 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
