import { NextRequest, NextResponse } from 'next/server';
import { getProposals, submitProposal, SubmitProposalInput } from '@/lib/actions/proposals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId') || undefined;
    const asRole = (searchParams.get('as') as 'freelancer' | 'client') || undefined;
    const statusParam = searchParams.get('status') || undefined;

    const result = await getProposals({
      jobId,
      as: asRole,
      status: statusParam,
    });

    if (result.code === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 401 });
    }

    if (result.code === 'FORBIDDEN') {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 403 });
    }

    if (result.code === 'NOT_FOUND') {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch proposals';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const input: SubmitProposalInput = {
      jobId: body.jobId,
      bidAmount: Number(body.bidAmount),
      rateType: body.rateType,
      deliveryDays: body.deliveryDays !== undefined ? Number(body.deliveryDays) : undefined,
      coverLetter: body.coverLetter,
    };

    const result = await submitProposal(input);

    if (!result.success) {
      let status = 400;
      if (result.code === 'UNAUTHENTICATED') status = 401;
      else if (result.code === 'FORBIDDEN' || result.code === 'SELF_APPLICATION_FORBIDDEN' || result.code === 'ACCOUNT_SUSPENDED' || result.code === 'FREELANCER_MODE_REQUIRED') status = 403;
      else if (result.code === 'JOB_NOT_FOUND') status = 404;
      else if (result.code === 'DUPLICATE_PROPOSAL') status = 409;
      else if (result.code === 'JOB_NOT_PUBLISHED') status = 422;

      return NextResponse.json(
        {
          error: result.error || 'Failed to submit proposal',
          code: result.code,
          fieldErrors: result.fieldErrors,
        },
        { status }
      );
    }

    return NextResponse.json(
      { success: true, proposal: result.proposal },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
