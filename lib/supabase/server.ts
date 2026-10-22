import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || url.trim() === '') {
    throw new Error(
      'Missing or empty environment variable: NEXT_PUBLIC_SUPABASE_URL. Please configure it in .env.local for local development or in your Vercel Project Settings -> Environment Variables for deployment.'
    );
  }

  if (!publishableKey || publishableKey.trim() === '') {
    throw new Error(
      'Missing or empty environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY). Please configure it in .env.local for local development or in your Vercel Project Settings -> Environment Variables for deployment.'
    );
  }

  return { url, publishableKey };
}

export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch (error) {
          // In Next.js, invoking cookieStore.set() from a Server Component throws ReadonlyRequestCookiesError
          // because response headers cannot be mutated during component rendering.
          // Supabase documentation notes this can be safely ignored in Server Components
          // when sessions are managed by proxy/middleware.
          // We only suppress this known limitation; unrelated errors are re-thrown.
          if (
            error instanceof Error &&
            error.message.includes('Cookies can only be modified')
          ) {
            return;
          }
          throw error;
        }
      },
    },
  });
}
