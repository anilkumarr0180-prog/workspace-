import { createBrowserClient } from '@supabase/ssr';

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

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();

  return createBrowserClient(url, publishableKey);
}
