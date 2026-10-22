import { NextRequest, NextResponse } from 'next/server';
import { unsaveJob } from '@/lib/actions/saved-jobs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Job ID is required', code: 'INVALID_JOB_ID' }, { status: 400 });
    }

    const result = await unsaveJob(id.trim());

    if (!result.success) {
      let status = 400;
      if (result.code === 'UNAUTHENTICATED') status = 401;
      else if (result.code === 'JOB_NOT_FOUND') status = 404;

      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    return NextResponse.json({ success: true, saved: false }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
