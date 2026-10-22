import { NextRequest, NextResponse } from 'next/server';
import { getSavedJobs, saveJob } from '@/lib/actions/saved-jobs';

export async function GET() {
  try {
    const result = await getSavedJobs();

    if (result.code === 'UNAUTHENTICATED' || result.error?.includes('Authentication required')) {
      return NextResponse.json({ error: result.error, code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve saved jobs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const jobId = body?.jobId;

    if (!jobId || typeof jobId !== 'string') {
      return NextResponse.json({ error: 'Valid jobId is required', code: 'INVALID_JOB_ID' }, { status: 400 });
    }

    const result = await saveJob(jobId.trim());

    if (!result.success) {
      let status = 400;
      if (result.code === 'UNAUTHENTICATED') status = 401;
      else if (result.code === 'JOB_NOT_FOUND') status = 404;

      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    const status = result.alreadySaved ? 200 : 201;
    return NextResponse.json(
      { success: true, saved: true, alreadySaved: Boolean(result.alreadySaved) },
      { status }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
