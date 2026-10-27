import { NextRequest, NextResponse } from 'next/server';
import { getContractById } from '@/lib/actions/contracts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Contract ID is required' }, { status: 400 });
    }

    const result = await getContractById(id.trim());

    if (!result.success) {
      let statusCode = 400;
      if (result.code === 'UNAUTHENTICATED') statusCode = 401;
      else if (result.code === 'NOT_FOUND') statusCode = 404;
      return NextResponse.json({ error: result.error, code: result.code }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      contract: result.contract,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
