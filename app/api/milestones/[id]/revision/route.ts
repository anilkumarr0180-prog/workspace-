import { NextRequest, NextResponse } from 'next/server';
import { requestMilestoneRevision } from '@/lib/actions/milestones';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Milestone ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const result = await requestMilestoneRevision(id.trim(), {
      feedback: body.feedback,
      deliveryId: body.deliveryId,
    });

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      else if (result.code === '42501') statusCode = 403;
      return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      milestone: result.milestone,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
