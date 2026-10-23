import { NextResponse } from 'next/server';
import { getClientDashboardData } from '@/lib/actions/client';

export async function GET() {
  try {
    const result = await getClientDashboardData();

    if (!result.success) {
      if (result.code === 'UNAUTHENTICATED') {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 401 });
      }
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve client dashboard data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
