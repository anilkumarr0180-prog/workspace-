import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/actions/password-recovery';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email;

    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const host = forwardedHost || request.headers.get('host');
    const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
    const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;

    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    const userAgent = request.headers.get('user-agent') || undefined;

    const result = await requestPasswordReset({
      email,
      origin,
      clientIp,
      userAgent,
    });

    if (result.rateLimited) {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 429 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

