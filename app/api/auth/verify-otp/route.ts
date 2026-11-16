import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, otp } = body;

    if (!email || !otp) {
      return NextResponse.json(
        { error: 'Email and 6-digit OTP code are required.' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim();
    const cleanOtp = otp.toString().trim();

    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch {
      return NextResponse.json(
        { error: 'Admin client unavailable' },
        { status: 503 }
      );
    }

    // 1. Try standard Supabase verifyOtp via admin client
    try {
      const { data: verifyData, error: verifyError } = await adminClient.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: 'signup',
      });

      if (!verifyError && verifyData.user) {
        return NextResponse.json({
          success: true,
          confirmed: true,
          user: { id: verifyData.user.id, email: verifyData.user.email },
        });
      }
    } catch (adminVerifyErr) {
      console.warn('Admin verifyOtp signup attempt notice:', adminVerifyErr);
    }

    // 2. Try verifyOtp with type 'email'
    try {
      const { data: verifyData2, error: verifyError2 } = await adminClient.auth.verifyOtp({
        email: cleanEmail,
        token: cleanOtp,
        type: 'email',
      });

      if (!verifyError2 && verifyData2.user) {
        return NextResponse.json({
          success: true,
          confirmed: true,
          user: { id: verifyData2.user.id, email: verifyData2.user.email },
        });
      }
    } catch (adminVerifyErr2) {
      console.warn('Admin verifyOtp email attempt notice:', adminVerifyErr2);
    }

    // 3. Fallback: Find user and check if already confirmed
    const { data: listData } = await adminClient.auth.admin.listUsers();
    const existing = listData?.users?.find(
      (u) => u.email?.toLowerCase() === cleanEmail.toLowerCase()
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'No user account found with this email address.' },
        { status: 404 }
      );
    }

    if (existing.email_confirmed_at) {
      return NextResponse.json({
        success: true,
        confirmed: true,
        alreadyConfirmed: true,
        user: { id: existing.id, email: existing.email },
      });
    }

    return NextResponse.json(
      { error: 'Invalid or expired 6-digit verification code. Please request a new code.' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

