import { NextRequest, NextResponse } from 'next/server';
import { verifyAndFundMilestoneRazorpay } from '@/lib/actions/payments';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { milestoneId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body || {};

    if (!milestoneId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json(
        {
          error:
            'Missing required parameters. Required: milestoneId, razorpayOrderId, razorpayPaymentId, razorpaySignature',
        },
        { status: 400 }
      );
    }

    const result = await verifyAndFundMilestoneRazorpay({
      milestoneId: String(milestoneId).trim(),
      razorpayOrderId: String(razorpayOrderId).trim(),
      razorpayPaymentId: String(razorpayPaymentId).trim(),
      razorpaySignature: String(razorpaySignature).trim(),
    });

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      else if (result.code === 'FORBIDDEN') statusCode = 403;
      else if (result.code === 'NOT_FOUND') statusCode = 404;
      else if (result.code === 'INVALID_SIGNATURE') statusCode = 422;

      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      milestone: result.milestone,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
