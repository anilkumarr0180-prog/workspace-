import { createBrowserClient } from '@supabase/ssr';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

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

let clientInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();

  if (typeof window === 'undefined') {
    return createBrowserClient(url, publishableKey);
  }

  if (!clientInstance) {
    clientInstance = createBrowserClient(url, publishableKey);

    // Keep Supabase Realtime WebSocket connection authenticated with active JWT
    clientInstance.auth.getSession().then((res: { data: { session: Session | null } }) => {
      const token = res?.data?.session?.access_token;
      if (token && clientInstance) {
        clientInstance.realtime.setAuth(token);
      }
    });

    clientInstance.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session?.access_token && clientInstance) {
        clientInstance.realtime.setAuth(session.access_token);
      }
    });
  }

  return clientInstance;
}
