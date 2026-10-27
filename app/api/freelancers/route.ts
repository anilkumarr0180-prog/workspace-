import { NextRequest, NextResponse } from 'next/server';
import { getFreelancers, getFeaturedFreelancers, FreelancerQueryFilters } from '@/lib/actions/freelancers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get('featured') === 'true';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 3, 1), 50) : undefined;

    if (featured) {
      const result = await getFeaturedFreelancers(limit || 3);
      return NextResponse.json(result, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    const filters: FreelancerQueryFilters = {
      query: searchParams.get('q') || undefined,
      category: searchParams.get('category') || undefined,
      badge: searchParams.get('badge') || undefined,
      minRate: searchParams.get('minRate') ? Number(searchParams.get('minRate')) : undefined,
      maxRate: searchParams.get('maxRate') ? Number(searchParams.get('maxRate')) : undefined,
      availability: searchParams.get('availability') || undefined,
      sortBy: (searchParams.get('sortBy') as FreelancerQueryFilters['sortBy']) || 'rating',
      limit: limit || 20,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
    };

    const result = await getFreelancers(filters);

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

