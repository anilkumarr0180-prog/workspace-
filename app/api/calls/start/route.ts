import { NextRequest, NextResponse } from 'next/server';
import { startCallSession } from '@/lib/actions/calls';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await startCallSession({
      conversationId: body.conversationId,
      callType: body.callType,
    });

    if (!result.success) {
      const status = result.error?.includes('Authentication')
        ? 401
        : result.error?.includes('Unauthorized')
        ? 403
        : result.error?.includes('another call')
        ? 409
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
