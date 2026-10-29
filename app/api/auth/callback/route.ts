import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const searchParams = requestUrl.searchParams;
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const roleParam = searchParams.get('role');
  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');

  // Resolve trusted origin behind proxies/Vercel without forcing HTTPS on localhost
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const host = forwardedHost || request.headers.get('host');
  const protocol = forwardedProto || (host?.includes('localhost') ? 'http' : requestUrl.protocol.replace(':', ''));
  const origin = host ? `${protocol}://${host}` : requestUrl.origin;

  // Handle OAuth provider error (e.g. user cancelled or denied Google sign-in)
  if (oauthError) {
    const errorUrl = new URL('/login', origin);
    errorUrl.searchParams.set('error', oauthError);
    if (oauthErrorDescription) {
      errorUrl.searchParams.set('error_description', oauthErrorDescription);
    }
    return NextResponse.redirect(errorUrl.toString());
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('OAuth code exchange failed:', error.message);
      }

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
          // Detect whether this is a fresh account confirmation (created_at matches updated_at within 30 seconds)
          const isFreshSignupConfirmation = Boolean(
            profile.created_at &&
            profile.updated_at &&
            Math.abs(new Date(profile.updated_at).getTime() - new Date(profile.created_at).getTime()) < 30000
          );

          if (isFreshSignupConfirmation && requestedRole && profile.active_mode !== requestedRole) {
            // Explicit role parameter from fresh signup OAuth button (?role=client)
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
          const fullName =
            (user.user_metadata?.full_name as string) ||
            (user.user_metadata?.name as string) ||
            cleanPrefix;
          const avatarUrl =
            (user.user_metadata?.avatar_url as string) ||
            (user.user_metadata?.picture as string) ||
            null;
          const candidateUsername = `${cleanPrefix}_${Math.floor(Math.random() * 8999 + 1000)}`;

          await supabase.from('profiles').upsert(
            {
              id: user.id,
              username: candidateUsername,
              full_name: fullName,
              avatar_url: avatarUrl,
              active_mode: effectiveRole,
              can_hire: true,
              can_work: true,
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );
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
    } catch (err: unknown) {
      console.error('OAuth callback error:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
