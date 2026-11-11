'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export interface SwitchRoleResult {
  success: boolean;
  activeMode?: 'client' | 'freelancer';
  error?: string;
}

export interface EditableProfileData {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  hourlyRate: number | null;
  skillsOverview: string | null;
  activeMode: 'freelancer' | 'client';
  canHire: boolean;
  canWork: boolean;
  skills: Array<{ id: string; name: string; slug: string }>;
  company?: {
    id: string;
    name: string;
    slug: string;
    website: string | null;
    location: string | null;
    description: string | null;
    logoUrl: string | null;
    role: string;
  } | null;
}

export interface GetEditableProfileResult {
  success: boolean;
  profile?: EditableProfileData;
  availableSkills?: Array<{ id: string; name: string; slug: string }>;
  error?: string;
}

export interface UpdateFreelancerProfileInput {
  fullName: string;
  title: string;
  hourlyRate: number | null;
  bio: string;
  skillIds: string[];
}

export interface UpdateClientProfileInput {
  fullName: string;
  title: string;
  companyName: string;
  companyWebsite?: string | null;
  companyLocation?: string | null;
  companyDescription?: string | null;
  companyLogoUrl?: string | null;
}

export interface ProfileMutationResult {
  success: boolean;
  error?: string;
  avatarUrl?: string | null;
}

/**
 * Helper to safely extract relative storage path if the URL points to an owned avatar.
 */
function extractAvatarStoragePath(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  try {
    const marker = '/avatars/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const pathAfterBucket = url.substring(idx + marker.length).split('?')[0];
    if (pathAfterBucket.startsWith(`${userId}/`)) {
      return pathAfterBucket;
    }
    return null;
  } catch {
    return null;
  }
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

/**
 * Fetch editable profile details for the authenticated user, including skills taxonomy and company links.
 */
export async function getEditableProfile(): Promise<GetEditableProfileResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    // Fetch user profile with freelancer skills
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select(`
        id,
        username,
        full_name,
        avatar_url,
        title,
        bio,
        hourly_rate,
        skills_overview,
        active_mode,
        can_hire,
        can_work,
        freelancer_skills (
          skills (
            id,
            name,
            slug
          )
        )
      `)
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profileRow) {
      return { success: false, error: profileError?.message || 'Profile record not found.' };
    }

    // Fetch all available taxonomy skills for selection
    const { data: taxonomySkills } = await supabase
      .from('skills')
      .select('id, name, slug')
      .order('name', { ascending: true })
      .limit(200);

    // Fetch associated company info if client
    const { data: companyMember } = await supabase
      .from('company_members')
      .select(`
        role,
        companies (
          id,
          name,
          slug,
          website,
          location,
          description,
          logo_url
        )
      `)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    let companyData = null;
    if (companyMember && companyMember.companies) {
      const comp = Array.isArray(companyMember.companies)
        ? companyMember.companies[0]
        : companyMember.companies;
      if (comp) {
        companyData = {
          id: comp.id,
          name: comp.name,
          slug: comp.slug,
          website: comp.website,
          location: comp.location,
          description: comp.description,
          logoUrl: comp.logo_url,
          role: companyMember.role,
        };
      }
    }

    // Map skills safely
    type SkillJoinType = { skills: { id: string; name: string; slug: string } | null };
    const userSkills = Array.isArray(profileRow.freelancer_skills)
      ? (profileRow.freelancer_skills as unknown as SkillJoinType[])
          .map((fs) => fs.skills)
          .filter((s): s is { id: string; name: string; slug: string } => Boolean(s && s.id && s.name))
      : [];

    return {
      success: true,
      profile: {
        id: profileRow.id,
        username: profileRow.username,
        fullName: profileRow.full_name,
        avatarUrl: profileRow.avatar_url,
        title: profileRow.title,
        bio: profileRow.bio,
        hourlyRate: profileRow.hourly_rate ? Number(profileRow.hourly_rate) : null,
        skillsOverview: profileRow.skills_overview,
        activeMode: profileRow.active_mode as 'freelancer' | 'client',
        canHire: profileRow.can_hire,
        canWork: profileRow.can_work,
        skills: userSkills,
        company: companyData,
      },
      availableSkills: taxonomySkills || [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve profile.';
    return { success: false, error: message };
  }
}

/**
 * Update freelancer profile details and synchronize skills taxonomy.
 */
export async function updateFreelancerProfile(
  input: UpdateFreelancerProfileInput
): Promise<ProfileMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    const cleanName = (input.fullName || '').trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      return { success: false, error: 'Full name must be between 2 and 80 characters.' };
    }

    const cleanTitle = (input.title || '').trim().slice(0, 100);
    const cleanBio = (input.bio || '').trim().slice(0, 5000);

    let cleanHourlyRate: number | null = null;
    if (input.hourlyRate !== null && input.hourlyRate !== undefined) {
      const rateNum = Number(input.hourlyRate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 2000) {
        return { success: false, error: 'Hourly rate must be a valid amount between $0 and $2,000/hr.' };
      }
      cleanHourlyRate = Math.round(rateNum * 100) / 100;
    }

    // 1. Update Profile Fields
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        full_name: cleanName,
        title: cleanTitle || null,
        bio: cleanBio || null,
        hourly_rate: cleanHourlyRate,
      })
      .eq('id', user.id);

    if (profileUpdateError) {
      return { success: false, error: profileUpdateError.message };
    }

    // 2. Synchronize Freelancer Skills
    const skillIds = Array.isArray(input.skillIds)
      ? Array.from(new Set(input.skillIds.filter((id) => typeof id === 'string' && id.trim().length > 0))).slice(0, 25)
      : [];

    // Delete existing skills
    const { error: deleteSkillsError } = await supabase
      .from('freelancer_skills')
      .delete()
      .eq('profile_id', user.id);

    if (deleteSkillsError) {
      console.warn('Warning: Could not clear previous freelancer skills:', deleteSkillsError.message);
    }

    // Insert new skills batch
    if (skillIds.length > 0) {
      const rowsToInsert = skillIds.map((skillId) => ({
        profile_id: user.id,
        skill_id: skillId,
      }));

      const { error: insertSkillsError } = await supabase
        .from('freelancer_skills')
        .insert(rowsToInsert);

      if (insertSkillsError) {
        console.warn('Warning: Could not link new skills:', insertSkillsError.message);
      }
    }

    // Get current username for path revalidation
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    if (userProfile?.username) {
      revalidatePath(`/freelancers/${userProfile.username}`);
    }
    revalidatePath('/freelancers');
    revalidatePath('/freelancer');
    revalidatePath('/');

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update freelancer profile.';
    return { success: false, error: message };
  }
}

/**
 * Update client profile details and company organization information.
 */
export async function updateClientProfile(
  input: UpdateClientProfileInput
): Promise<ProfileMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    const cleanName = (input.fullName || '').trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      return { success: false, error: 'Full name must be between 2 and 80 characters.' };
    }

    const cleanTitle = (input.title || '').trim().slice(0, 100);

    // 1. Update personal client profile fields
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        full_name: cleanName,
        title: cleanTitle || null,
      })
      .eq('id', user.id);

    if (profileUpdateError) {
      return { success: false, error: profileUpdateError.message };
    }

    // 2. Handle company profile if companyName is provided
    const cleanCompanyName = (input.companyName || '').trim();
    if (cleanCompanyName.length >= 2) {
      const cleanWebsite = (input.companyWebsite || '').trim() || null;
      const cleanLocation = (input.companyLocation || '').trim() || null;
      const cleanDesc = (input.companyDescription || '').trim() || null;
      const cleanLogo = (input.companyLogoUrl || '').trim() || null;

      // Check existing company membership
      const { data: existingMember } = await supabase
        .from('company_members')
        .select('company_id, role')
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin'])
        .limit(1)
        .maybeSingle();

      if (existingMember?.company_id) {
        // Update existing company
        await supabase
          .from('companies')
          .update({
            name: cleanCompanyName,
            website: cleanWebsite,
            location: cleanLocation,
            description: cleanDesc,
            logo_url: cleanLogo,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingMember.company_id);
      } else {
        // Create new company
        const baseSlug = cleanCompanyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'company';
        const uniqueSlug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;

        const { data: newCompany, error: createCompanyError } = await supabase
          .from('companies')
          .insert({
            name: cleanCompanyName,
            slug: uniqueSlug,
            website: cleanWebsite,
            location: cleanLocation,
            description: cleanDesc,
            logo_url: cleanLogo,
          })
          .select('id')
          .single();

        if (newCompany && !createCompanyError) {
          await supabase.from('company_members').insert({
            company_id: newCompany.id,
            user_id: user.id,
            role: 'owner',
          });
        }
      }
    }

    revalidatePath('/client');
    revalidatePath('/client/jobs/new');
    revalidatePath('/');

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update client profile.';
    return { success: false, error: message };
  }
}

/**
 * Persist a newly uploaded avatar URL and safely prune any prior orphaned image in storage.
 */
export async function updateProfileAvatar(
  newAvatarUrl: string
): Promise<ProfileMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    if (!newAvatarUrl || !newAvatarUrl.trim()) {
      return { success: false, error: 'Avatar URL is required.' };
    }

    // 1. Fetch current avatar URL to identify if an old image needs deletion
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('avatar_url, username')
      .eq('id', user.id)
      .maybeSingle();

    const oldAvatarUrl = currentProfile?.avatar_url;
    const oldRelativePath = extractAvatarStoragePath(oldAvatarUrl, user.id);
    const newRelativePath = extractAvatarStoragePath(newAvatarUrl, user.id);

    // 2. Prune old file from avatars storage bucket if different
    if (oldRelativePath && oldRelativePath !== newRelativePath) {
      try {
        const adminClient = getAdminSupabaseClient();
        await adminClient.storage.from('avatars').remove([oldRelativePath]);
      } catch (pruneErr) {
        console.warn('Non-fatal: could not prune prior avatar image:', pruneErr);
      }
    }

    // 3. Update database record
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: newAvatarUrl.trim() })
      .eq('id', user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (currentProfile?.username) {
      revalidatePath(`/freelancers/${currentProfile.username}`);
    }
    revalidatePath('/freelancers');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    revalidatePath('/');

    return { success: true, avatarUrl: newAvatarUrl.trim() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set avatar.';
    return { success: false, error: message };
  }
}

/**
 * Remove user's profile picture, purge the binary object from storage, and reset to initials fallback.
 */
export async function removeProfileAvatar(): Promise<ProfileMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    // 1. Fetch current avatar URL
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('avatar_url, username')
      .eq('id', user.id)
      .maybeSingle();

    const oldAvatarUrl = currentProfile?.avatar_url;
    const oldRelativePath = extractAvatarStoragePath(oldAvatarUrl, user.id);

    // 2. Prune old file from avatars storage
    if (oldRelativePath) {
      try {
        const adminClient = getAdminSupabaseClient();
        await adminClient.storage.from('avatars').remove([oldRelativePath]);
      } catch (pruneErr) {
        console.warn('Non-fatal: could not remove avatar file from storage:', pruneErr);
      }
    }

    // 3. Clear avatar_url in profiles
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (currentProfile?.username) {
      revalidatePath(`/freelancers/${currentProfile.username}`);
    }
    revalidatePath('/freelancers');
    revalidatePath('/freelancer');
    revalidatePath('/client');
    revalidatePath('/');

    return { success: true, avatarUrl: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to remove avatar.';
    return { success: false, error: message };
  }
}
