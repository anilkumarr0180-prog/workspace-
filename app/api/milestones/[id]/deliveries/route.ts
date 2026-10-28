import { NextRequest, NextResponse } from 'next/server';
import { getMilestoneDeliveries, submitMilestoneDelivery } from '@/lib/actions/milestones';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Milestone ID is required' }, { status: 400 });
    }

    const result = await getMilestoneDeliveries(id.trim());
    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      deliveries: result.deliveries,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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
    const result = await submitMilestoneDelivery(id.trim(), {
      deliveryNotes: body.deliveryNotes,
      attachments: body.attachments,
    });

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      else if (result.code === '42501') statusCode = 403;
      return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      delivery: result.delivery,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
