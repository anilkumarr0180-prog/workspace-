import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { dispatchVerificationEmail } from '@/lib/email/dispatch-verification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim();

    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch {
      return NextResponse.json(
        { error: 'Admin client unavailable' },
        { status: 503 }
      );
    }

    // Resolve trusted origin
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const host = forwardedHost || request.headers.get('host');
    const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
    const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;

    // Check if user exists
    const { data: listData } = await adminClient.auth.admin.listUsers();
    const existing = listData?.users?.find(
      (u) => u.email?.toLowerCase() === cleanEmail.toLowerCase()
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'No account found with this email address.' },
        { status: 404 }
      );
    }

    if (existing.email_confirmed_at) {
      return NextResponse.json(
        { error: 'This account is already verified. Please log in.', alreadyConfirmed: true },
        { status: 400 }
      );
    }

    // Generate fresh link/OTP
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
      options: {
        redirectTo: `${origin}/auth/callback?role=${existing.user_metadata?.role || 'freelancer'}`,
      },
    });

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    const fullName = existing.user_metadata?.full_name || 'there';
    const role = (existing.user_metadata?.role as 'client' | 'freelancer') || 'freelancer';
    const otp = linkData.properties?.email_otp || '';
    const actionLink = linkData.properties?.hashed_token
      ? `${origin}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=magiclink&role=${role}`
      : (linkData.properties?.action_link || `${origin}/login`);

    const dispatchResult = await dispatchVerificationEmail({
      recipientName: fullName,
      email: cleanEmail,
      otp,
      actionLink,
      role,
    });

    // Fallback to Supabase native email dispatch if custom email service is not configured
    if (!dispatchResult.success) {
      try {
        const { error: nativeErr } = await adminClient.auth.resend({
          type: 'signup',
          email: cleanEmail,
          options: {
            emailRedirectTo: `${origin}/auth/callback?role=${role}`,
          },
        });
        if (!nativeErr) {
          dispatchResult.success = true;
          dispatchResult.provider = 'supabase';
        } else {
          console.warn('[ResendVerification] Supabase native email notice:', nativeErr.message);
        }
      } catch (nativeExc) {
        console.warn('[ResendVerification] Exception triggering Supabase email:', nativeExc);
      }
    }

    return NextResponse.json({
      success: true,
      emailSent: dispatchResult.success,
      message: 'A new verification code has been dispatched.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

