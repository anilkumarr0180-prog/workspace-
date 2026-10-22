import { NextRequest, NextResponse } from 'next/server';
import { getJobById } from '@/lib/actions/jobs';

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
