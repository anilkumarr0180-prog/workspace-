import { NextRequest, NextResponse } from 'next/server';
import { endCallSession, CallEndReason } from '@/lib/actions/calls';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ callId: string }> }
) {
  try {
    const { callId } = await context.params;
    let reason: CallEndReason = 'hangup';
    try {
      const body = await request.json();
      if (body?.reason) {
        reason = body.reason;
      }
    } catch {
      // Allow empty body (e.g. sendBeacon)
    }

    const result = await endCallSession(callId, reason);

    if (!result.success) {
      const status = result.error?.includes('Authentication')
        ? 401
        : result.error?.includes('Unauthorized')
        ? 403
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
