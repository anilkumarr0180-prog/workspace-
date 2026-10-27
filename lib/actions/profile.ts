'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface SwitchRoleResult {
  success: boolean;
  activeMode?: 'client' | 'freelancer';
  error?: string;
}

/**
 * Persistently switch the authenticated user's active role between 'client' and 'freelancer'.
 * Authoritative source of truth is public.profiles.active_mode.
 */
export async function switchActiveRole(
  targetRole: 'client' | 'freelancer'
): Promise<SwitchRoleResult> {
  if (targetRole !== 'client' && targetRole !== 'freelancer') {
    return { success: false, error: 'Invalid target role specified.' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required to switch roles.' };
    }

    // 1. Fetch current profile
    const { data: profile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id, active_mode, can_hire, can_work')
      .eq('id', user.id)
      .maybeSingle();

    if (profileFetchError) {
      return { success: false, error: 'Failed to access user profile.' };
    }

    // 2. Validate role capabilities if profile exists
    if (profile) {
      if (targetRole === 'client' && profile.can_hire === false) {
        return {
          success: false,
          error: 'This profile is not authorized for employer/client operations.',
        };
      }
      if (targetRole === 'freelancer' && profile.can_work === false) {
        return {
          success: false,
          error: 'This profile is not authorized for freelancer operations.',
        };
      }

      // Update active_mode in profiles
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ active_mode: targetRole })
        .eq('id', user.id);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    } else {
      // Missing profile record: safely initialize default profile
      const rawPrefix = user.email
        ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_')
        : 'user';
      const cleanPrefix = rawPrefix.slice(0, 20) || 'user';
      const fullName = (user.user_metadata?.full_name as string) || cleanPrefix;
      const candidateUsername = `${cleanPrefix}_${Math.floor(Math.random() * 8999 + 1000)}`;

      const { error: insertError } = await supabase.from('profiles').insert({
        id: user.id,
        username: candidateUsername,
        full_name: fullName,
        active_mode: targetRole,
        can_hire: true,
        can_work: true,
      });

      if (insertError) {
        return { success: false, error: 'Could not initialize profile record.' };
      }
    }

    // Revalidate paths for Server Components and route guards
    revalidatePath('/client');
    revalidatePath('/freelancer');
    revalidatePath('/');

    return { success: true, activeMode: targetRole };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred while switching roles.';
    return { success: false, error: message };
  }
}
