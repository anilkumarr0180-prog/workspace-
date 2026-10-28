import { NextRequest, NextResponse } from 'next/server';
import { startMilestoneWork, cancelMilestone } from '@/lib/actions/milestones';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Milestone ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const action = body.action as 'start_work' | 'cancel';

    if (action === 'start_work') {
      const result = await startMilestoneWork(id.trim());
      if (!result.success) {
        let statusCode = 400;
        if (result.code === 'UNAUTHENTICATED') statusCode = 401;
        else if (result.code === '42501') statusCode = 403;
        return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
      }
      return NextResponse.json({ success: true, milestone: result.milestone });
    }

    if (action === 'cancel') {
      const result = await cancelMilestone(id.trim(), body.reason || '');
      if (!result.success) {
        let statusCode = 400;
        if (result.code === 'UNAUTHENTICATED') statusCode = 401;
        else if (result.code === '42501') statusCode = 403;
        return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
      }
      return NextResponse.json({ success: true, milestone: result.milestone });
    }

    return NextResponse.json(
      { error: 'Invalid action. Supported actions: "start_work", "cancel".' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
