import { NextRequest, NextResponse } from 'next/server';
import { getContracts } from '@/lib/actions/contracts';
import { ContractStatus } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const as = searchParams.get('as') as 'freelancer' | 'client' | null;
    const status = searchParams.get('status') as ContractStatus | null;
    const jobId = searchParams.get('jobId') || undefined;

    const result = await getContracts({
      as: as || undefined,
      status: status || undefined,
      jobId,
    });

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      contracts: result.contracts,
      total: result.total,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
