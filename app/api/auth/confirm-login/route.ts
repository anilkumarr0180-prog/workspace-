import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch {
      return NextResponse.json({ error: 'Admin client unavailable' }, { status: 503 });
    }

    // Find user in auth.users
    const { data: listData, error: listError } = await adminClient.auth.admin.listUsers();
    if (listError || !listData?.users) {
      return NextResponse.json({ error: 'Could not lookup user' }, { status: 500 });
    }

    const user = listData.users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.email_confirmed_at) {
      const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
        email_confirm: true,
      });

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, confirmed: true });
    }

    return NextResponse.json({ success: true, alreadyConfirmed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

