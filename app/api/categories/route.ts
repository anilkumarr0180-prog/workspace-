import { NextResponse } from 'next/server';
import { getCategories } from '@/lib/actions/categories';

export async function GET() {
  try {
    const result = await getCategories();
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      { categories: [], error: message, source: 'supabase' },
      { status: 500 }
    );
  }
}
