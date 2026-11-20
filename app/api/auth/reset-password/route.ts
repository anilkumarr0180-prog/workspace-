import { NextRequest, NextResponse } from 'next/server';
import { executePasswordReset } from '@/lib/actions/password-recovery';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password, tokenHash } = body;

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    const userAgent = request.headers.get('user-agent') || undefined;

    const result = await executePasswordReset({
      password,
      tokenHash,
      clientIp,
      userAgent,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to reset password',
          fieldErrors: result.fieldErrors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

