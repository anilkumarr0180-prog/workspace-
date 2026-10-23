import { NextRequest, NextResponse } from 'next/server';
import { getFeaturedFreelancers } from '@/lib/actions/freelancers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 3, 1), 20) : 3;

    const result = await getFeaturedFreelancers(limit);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { freelancers: [], error: message, source: 'supabase' },
      { status: 500 }
    );
  }
}
