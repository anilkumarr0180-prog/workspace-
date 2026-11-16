import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

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

    const assignedRole = role === 'client' ? 'client' : 'freelancer';

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

    // 3. Attempt to create user with email_confirm: true (bypassing GoTrue SMTP rate limiter)
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: assignedRole,
        country: country || 'United States',
        marketing_opt_in: Boolean(sendEmails),
      },
    });

    if (createError) {
      const errLower = createError.message.toLowerCase();

      // If user already exists:
      if (errLower.includes('already registered') || errLower.includes('already exists')) {
        // Check if the user is unconfirmed (e.g. from an earlier rate-limited signup attempt)
        try {
          const { data: listData } = await adminClient.auth.admin.listUsers();
          const existing = listData?.users?.find(
            (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
          );

          if (existing) {
            if (!existing.email_confirmed_at) {
              // Auto-confirm the user and update password so they can log in immediately
              await adminClient.auth.admin.updateUserById(existing.id, {
                email_confirm: true,
                password,
                user_metadata: {
                  full_name: fullName || existing.user_metadata?.full_name,
                  role: assignedRole,
                  country: country || existing.user_metadata?.country,
                },
              });

              // Ensure profile active_mode is updated
              await adminClient
                .from('profiles')
                .update({ active_mode: assignedRole, full_name: fullName })
                .eq('id', existing.id);

              return NextResponse.json(
                { success: true, autoConfirmed: true, message: 'Account confirmed successfully.' },
                { status: 200 }
              );
            }
          }
        } catch (confirmErr) {
          console.error('Error auto-confirming existing user:', confirmErr);
        }

        return NextResponse.json(
          {
            error:
              'An account with this email address already exists. Please log in with your password.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const newUserId = createData.user?.id;

    if (newUserId) {
      // Ensure profile record active_mode is aligned
      try {
        await adminClient
          .from('profiles')
          .update({ active_mode: assignedRole, full_name: fullName })
          .eq('id', newUserId);
      } catch (profileErr) {
        console.warn('Profile sync notice:', profileErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        autoConfirmed: true,
        user: { id: newUserId, email: createData.user?.email },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

