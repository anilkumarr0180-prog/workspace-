import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { dispatchVerificationEmail } from '@/lib/email/dispatch-verification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, firstName, lastName, role, country, sendEmails } = body;

    // 1. Validation
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    const fullName = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
    if (!fullName) {
      return NextResponse.json({ error: 'Please enter your first and last name.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const assignedRole: 'client' | 'freelancer' = role === 'client' ? 'client' : 'freelancer';

    // 2. Check if admin client is available
    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch (adminErr) {
      console.warn('Supabase Admin client unavailable, falling back:', adminErr);
      return NextResponse.json(
        { fallback: true, error: 'Admin client unavailable' },
        { status: 503 }
      );
    }

    // Resolve trusted origin for redirect links
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const host = forwardedHost || request.headers.get('host');
    const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
    const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;

    // 3. Generate link + OTP (This creates the user in GoTrue WITHOUT triggering Supabase's rate-limited GoTrue email sender!)
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'signup',
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: fullName,
          role: assignedRole,
          country: country || 'United States',
          marketing_opt_in: Boolean(sendEmails),
        },
        redirectTo: `${origin}/auth/callback?role=${assignedRole}`,
      },
    });

    if (linkError) {
      const errLower = linkError.message.toLowerCase();

      // If user already exists:
      if (errLower.includes('already registered') || errLower.includes('already exists')) {
        try {
          const { data: listData } = await adminClient.auth.admin.listUsers();
          const existing = listData?.users?.find(
            (u) => u.email?.toLowerCase() === cleanEmail
          );

          if (existing) {
            // Case A: User exists but is unconfirmed
            if (!existing.email_confirmed_at) {
              // Update user password and metadata so they can verify and log in
              await adminClient.auth.admin.updateUserById(existing.id, {
                password,
                user_metadata: {
                  full_name: fullName || existing.user_metadata?.full_name,
                  role: assignedRole,
                  country: country || existing.user_metadata?.country,
                },
              });

              // Generate new OTP & magiclink for unconfirmed user
              const { data: regenData } = await adminClient.auth.admin.generateLink({
                type: 'magiclink',
                email: cleanEmail,
                options: {
                  redirectTo: `${origin}/auth/callback?role=${assignedRole}`,
                },
              });

              const otp = regenData?.properties?.email_otp || '123456';
              const actionLink = regenData?.properties?.hashed_token
                ? `${origin}/auth/callback?token_hash=${encodeURIComponent(regenData.properties.hashed_token)}&type=magiclink&role=${assignedRole}`
                : (regenData?.properties?.action_link || `${origin}/login`);

              const dispatchResult = await dispatchVerificationEmail({
                recipientName: fullName,
                email: cleanEmail,
                otp,
                actionLink,
                role: assignedRole,
              });

              // Fallback to Supabase native email dispatch if custom email provider was unconfigured
              if (!dispatchResult.success) {
                try {
                  const { error: nativeErr } = await adminClient.auth.resend({
                    type: 'signup',
                    email: cleanEmail,
                    options: {
                      emailRedirectTo: `${origin}/auth/callback?role=${assignedRole}`,
                    },
                  });
                  if (!nativeErr) {
                    dispatchResult.success = true;
                    dispatchResult.provider = 'supabase';
                  } else {
                    console.warn('[Signup] Supabase native email notice:', nativeErr.message);
                  }
                } catch (nativeExc) {
                  console.warn('[Signup] Exception triggering Supabase email:', nativeExc);
                }
              }

              return NextResponse.json(
                {
                  success: true,
                  requiresVerification: true,
                  email: cleanEmail,
                  emailSent: dispatchResult.success,
                  message: 'A verification code has been sent to your email address.',
                },
                { status: 200 }
              );
            }
          }
        } catch (findErr) {
          console.error('Error handling existing user in signup:', findErr);
        }

        return NextResponse.json(
          {
            error:
              'An account with this email address already exists. Please log in with your password.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    const otp = linkData?.properties?.email_otp || '';
    const actionLink = linkData?.properties?.hashed_token
      ? `${origin}/auth/callback?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=signup&role=${assignedRole}`
      : (linkData?.properties?.action_link || `${origin}/login`);
    const newUserId = linkData?.user?.id;

    if (newUserId) {
      // Ensure profile record exists with active_mode set
      try {
        await adminClient.from('profiles').upsert(
          {
            id: newUserId,
            full_name: fullName,
            active_mode: assignedRole,
            can_hire: true,
            can_work: true,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      } catch (profileErr) {
        console.warn('Profile sync notice:', profileErr);
      }
    }

    // 4. Dispatch the branded verification email via application email service (Resend / SMTP)
    const dispatchResult = await dispatchVerificationEmail({
      recipientName: fullName,
      email: cleanEmail,
      otp,
      actionLink,
      role: assignedRole,
    });

    // 5. Fallback to Supabase native email dispatch if custom email service is not configured
    if (!dispatchResult.success) {
      try {
        const { error: nativeErr } = await adminClient.auth.resend({
          type: 'signup',
          email: cleanEmail,
          options: {
            emailRedirectTo: `${origin}/auth/callback?role=${assignedRole}`,
          },
        });
        if (!nativeErr) {
          dispatchResult.success = true;
          dispatchResult.provider = 'supabase';
        } else {
          console.warn('[Signup] Supabase native email notice:', nativeErr.message);
        }
      } catch (nativeExc) {
        console.warn('[Signup] Exception triggering Supabase email:', nativeExc);
      }
    }

    return NextResponse.json(
      {
        success: true,
        requiresVerification: true,
        email: cleanEmail,
        emailSent: dispatchResult.success,
        message: 'A verification code has been dispatched to your email address.',
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
