import { NextRequest, NextResponse } from 'next/server';
import { getJobById, updateJobStatus, updateJobBudget, withdrawJob } from '@/lib/actions/jobs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const { job, source } = await getJobById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job, source });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch job details';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const body = await request.json();

    // 1. Handle Withdraw / Cancel Action
    if (body.action === 'withdraw') {
      const result = await withdrawJob(id);
      if (!result.success) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    // 2. Handle Budget / Price Update
    if (
      body.action === 'update_budget' ||
      typeof body.fixedAmount === 'number' ||
      typeof body.budgetMin === 'number' ||
      typeof body.budgetMax === 'number'
    ) {
      const result = await updateJobBudget(id, {
        projectType: body.projectType,
        fixedAmount: body.fixedAmount,
        budgetMin: body.budgetMin,
        budgetMax: body.budgetMax,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    // 3. Handle Status Update
    const { status } = body;
    if (!status) {
      return NextResponse.json({ error: 'Status or budget parameters are required' }, { status: 400 });
    }

    const result = await updateJobStatus(id, status);

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

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

