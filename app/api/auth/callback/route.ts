import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const roleParam = searchParams.get('role');

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data?.user) {
        const user = data.user;
        const requestedRole =
          roleParam === 'client' || roleParam === 'freelancer' ? roleParam : null;
        const metadataRole =
          user.user_metadata?.role === 'client' || user.user_metadata?.role === 'freelancer'
            ? user.user_metadata.role
            : null;

        const intendedRole = requestedRole || metadataRole;

        // 1. Fetch or initialize profile record
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, active_mode, created_at, updated_at')
          .eq('id', user.id)
          .maybeSingle();

        let effectiveRole: 'client' | 'freelancer' = 'freelancer';

        if (profile) {
          // Detect whether this is a fresh account confirmation (created_at matches updated_at within 15 seconds)
          const isFreshSignupConfirmation =
            profile.created_at &&
            profile.updated_at &&
            Math.abs(new Date(profile.updated_at).getTime() - new Date(profile.created_at).getTime()) < 15000;

          if (requestedRole && profile.active_mode !== requestedRole) {
            // Explicit role parameter from signup OAuth button (?role=client)
            await supabase
              .from('profiles')
              .update({ active_mode: requestedRole })
              .eq('id', user.id);
            effectiveRole = requestedRole;
          } else if (
            isFreshSignupConfirmation &&
            metadataRole &&
            profile.active_mode !== metadataRole
          ) {
            // Initial email confirmation: align default trigger role with chosen signup metadata
            await supabase
              .from('profiles')
              .update({ active_mode: metadataRole })
              .eq('id', user.id);
            effectiveRole = metadataRole;
          } else {
            // Existing user login: preserve legitimate database active_mode without overwriting!
            effectiveRole = profile.active_mode === 'client' ? 'client' : 'freelancer';
          }
        } else {
          // Profile missing: safely bootstrap default profile
          effectiveRole = intendedRole || 'freelancer';
          const rawPrefix = user.email
            ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_')
            : 'user';
          const cleanPrefix = rawPrefix.slice(0, 20) || 'user';
          const fullName = (user.user_metadata?.full_name as string) || cleanPrefix;
          const candidateUsername = `${cleanPrefix}_${Math.floor(Math.random() * 8999 + 1000)}`;

          await supabase.from('profiles').insert({
            id: user.id,
            username: candidateUsername,
            full_name: fullName,
            active_mode: effectiveRole,
            can_hire: true,
            can_work: true,
          });
        }

        // 2. Determine safe destination redirect
        const isSafeNext =
          next &&
          next.startsWith('/') &&
          !next.startsWith('//') &&
          !next.startsWith('/login') &&
          next !== '/';

        const destination = isSafeNext
          ? next
          : effectiveRole === 'client'
          ? '/client'
          : '/freelancer';

        return NextResponse.redirect(`${origin}${destination}`);
      }
    } catch {
      // In case of error, fall through to redirect to login
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
