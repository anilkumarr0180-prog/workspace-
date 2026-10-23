import { NextResponse } from 'next/server';
import { getFreelancerDashboardData } from '@/lib/actions/freelancer-dashboard';

export async function GET() {
  try {
    const result = await getFreelancerDashboardData();

    if (!result.success) {
      if (result.code === 'UNAUTHENTICATED') {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 401 });
      }
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve freelancer dashboard data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
