import { NextRequest, NextResponse } from 'next/server';
import { scheduleMeetingAndSendEmail, ScheduleMeetingInput } from '@/lib/actions/meetings';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const input: ScheduleMeetingInput = {
      proposalId: body.proposalId,
      topic: body.topic,
      date: body.date,
      time: body.time,
      timezone: body.timezone,
      durationMinutes: body.durationMinutes,
      platform: body.platform,
      meetingLink: body.meetingLink,
      notes: body.notes,
      conversationId: body.conversationId,
    };

    const result = await scheduleMeetingAndSendEmail(input);

    if (!result.success) {
      const status = result.error?.includes('Authentication required') ? 401 : 400;
      return NextResponse.json({ error: result.error || 'Failed to schedule meeting' }, { status });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

