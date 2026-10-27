import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: getUser() authenticates with the Supabase server
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isClientRoute = pathname === '/client' || pathname.startsWith('/client/');
  const isFreelancerRoute = pathname === '/freelancer' || pathname.startsWith('/freelancer/');

  const copyCookies = (from: NextResponse, to: NextResponse) => {
    from.cookies.getAll().forEach((cookie) => {
      to.cookies.set(cookie.name, cookie.value, cookie);
    });
  };

  // 1. Unauthenticated users cannot access protected routes
  if (!user && (isClientRoute || isFreelancerRoute)) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect', pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyCookies(supabaseResponse, redirectResponse);
    return redirectResponse;
  }

  // 2. Authenticated role-based access control
  if (user) {
    // Authoritative role derives from public.profiles.active_mode in the database
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_mode, can_hire, can_work')
      .eq('id', user.id)
      .maybeSingle();

    const role =
      profile?.active_mode ||
      (user.user_metadata?.role as 'client' | 'freelancer') ||
      'freelancer';

    // Authenticated Freelancer attempting to access Client-only routes
    if (role === 'freelancer' && isClientRoute) {
      const redirectResponse = NextResponse.redirect(new URL('/freelancer', request.url));
      copyCookies(supabaseResponse, redirectResponse);
      return redirectResponse;
    }

    // Authenticated Client attempting to access Freelancer-only routes
    if (role === 'client' && isFreelancerRoute) {
      const redirectResponse = NextResponse.redirect(new URL('/client', request.url));
      copyCookies(supabaseResponse, redirectResponse);
      return redirectResponse;
    }

    // If authenticated user visits login page, redirect to their role dashboard
    if (pathname === '/login') {
      const targetDashboard = role === 'client' ? '/client' : '/freelancer';
      const redirectResponse = NextResponse.redirect(new URL(targetDashboard, request.url));
      copyCookies(supabaseResponse, redirectResponse);
      return redirectResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public asset extensions (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
