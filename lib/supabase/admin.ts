import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase Admin Client using the SERVICE_ROLE_KEY.
 * STRICTLY RESTRICTED TO SECURE SERVER-SIDE WEBHOOK RECONCILIATION.
 * NEVER IMPORT THIS IN CLIENT COMPONENTS OR PUBLIC ENDPOINTS.
 */

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Supabase Admin Client cannot be initialized on the client.');
}

let adminClientInstance: SupabaseClient | null = null;

export function getAdminSupabaseClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: Supabase Admin Client cannot be executed on the client.');
  }

  if (adminClientInstance) {
    return adminClientInstance;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseUrl.trim()) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable for Supabase admin client.');
  }

  if (!serviceRoleKey || !serviceRoleKey.trim()) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Required for secure webhook reconciliation.');
  }

  adminClientInstance = createClient(supabaseUrl.trim(), serviceRoleKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClientInstance;
}
