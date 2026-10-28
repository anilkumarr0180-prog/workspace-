import { NextRequest, NextResponse } from 'next/server';
import { createMilestoneRazorpayOrder } from '@/lib/actions/payments';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const milestoneId = body?.milestoneId;

    if (!milestoneId || typeof milestoneId !== 'string') {
      return NextResponse.json(
        { error: 'Milestone ID is required and must be a valid string' },
        { status: 400 }
      );
    }

    const result = await createMilestoneRazorpayOrder(milestoneId.trim());

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      else if (result.code === 'FORBIDDEN') statusCode = 403;
      else if (result.code === 'NOT_FOUND') statusCode = 404;

      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      amount: result.amount,
      currency: result.currency,
      keyId: result.keyId,
      milestoneTitle: result.milestoneTitle,
      clientName: result.clientName,
      clientEmail: result.clientEmail,
      contractId: result.contractId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
