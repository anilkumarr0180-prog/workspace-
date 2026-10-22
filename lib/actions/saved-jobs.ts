'use server';

import { createClient } from '@/lib/supabase/server';
import { Job, ProjectType, ExperienceLevel, ProjectDuration, ClientInfo } from '@/lib/types';

interface SavedJobResult {
  savedJobs: Job[];
  savedJobIds: string[];
  total: number;
  source: 'supabase' | 'fallback';
  error?: string;
  code?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retrieve the authenticated user's saved jobs.
 */
export async function getSavedJobs(): Promise<SavedJobResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      savedJobs: [],
      savedJobIds: [],
      total: 0,
      source: 'fallback',
      error: 'Authentication required to view saved jobs.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data, count, error } = await supabase
      .from('saved_jobs')
      .select(
        `
        job_id,
        created_at,
        jobs (
          id,
          client_id,
          company_id,
          category_id,
          title,
          description,
          project_type,
          budget_min,
          budget_max,
          experience_level,
          duration,
          status,
          proposals_count,
          is_featured,
          created_at,
          profiles!client_id (id, full_name, avatar_url, rating, review_count, total_spent, created_at),
          companies (id, name, location),
          categories (id, name, slug),
          job_skills (skills (id, name, slug))
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet or user has no saved jobs
      return { savedJobs: [], savedJobIds: [], total: 0, source: 'fallback' };
    }

    const savedJobIds: string[] = [];
    const mappedJobs: Job[] = [];

    interface RawSavedJobItem {
      id: string;
      client_id: string;
      title: string;
      description: string;
      project_type: string;
      budget_min?: number | null;
      budget_max?: number | null;
      experience_level: string;
      duration: string;
      status: string;
      proposals_count?: number | null;
      is_featured?: boolean | null;
      created_at: string;
      profiles?: { id?: string; full_name?: string | null; created_at?: string | null; rating?: number | null; review_count?: number | null; total_spent?: number | null } | null;
      companies?: { id?: string; name?: string | null; location?: string | null } | null;
      categories?: { id?: string; name?: string | null } | null;
      job_skills?: Array<{ skills?: { id?: string; name?: string | null } | null }> | null;
    }

    for (const row of data || []) {
      const jobsData = row.jobs;
      const rawJob: RawSavedJobItem | null = Array.isArray(jobsData)
        ? (jobsData[0] as unknown as RawSavedJobItem)
        : (jobsData as unknown as RawSavedJobItem);
      if (!rawJob) continue;

      savedJobIds.push(rawJob.id);

      const profile = rawJob.profiles || {};
      const company = rawJob.companies || null;
      const categoryName = rawJob.categories?.name || 'Development & IT';
      const skillsList: string[] = Array.isArray(rawJob.job_skills)
        ? rawJob.job_skills
            .map((js) => js.skills?.name)
            .filter((name): name is string => Boolean(name))
        : [];

      const clientInfo: ClientInfo = {
        id: rawJob.client_id,
        name: profile.full_name || 'Verified Client',
        companyName: company?.name || undefined,
        location: company?.location || 'Remote / Worldwide',
        rating: Number(profile.rating) || 5.0,
        reviewCount: Number(profile.review_count) || 0,
        totalSpent: Number(profile.total_spent) || 0,
        paymentVerified: true,
        memberSince: profile.created_at
          ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          : 'Recent Member',
        hireRate: 90,
        openJobsCount: 1,
      };

      const projectType = rawJob.project_type as ProjectType;

      mappedJobs.push({
        id: rawJob.id,
        title: rawJob.title,
        category: categoryName,
        description: rawJob.description,
        projectType,
        budget: {
          type: projectType,
          fixedAmount: projectType === 'fixed' ? Number(rawJob.budget_min) : undefined,
          hourlyMin: projectType === 'hourly' ? Number(rawJob.budget_min) : undefined,
          hourlyMax: projectType === 'hourly' ? Number(rawJob.budget_max) : undefined,
        },
        experienceLevel: rawJob.experience_level as ExperienceLevel,
        duration: rawJob.duration as ProjectDuration,
        skills: skillsList,
        client: clientInfo,
        postedAt: rawJob.created_at
          ? new Date(rawJob.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Recently',
        proposalCount: Number(rawJob.proposals_count) || 0,
        isFeatured: Boolean(rawJob.is_featured),
      });
    }

    return {
      savedJobs: mappedJobs,
      savedJobIds,
      total: count ?? mappedJobs.length,
      source: 'supabase',
    };
  } catch {
    return { savedJobs: [], savedJobIds: [], total: 0, source: 'fallback' };
  }
}

/**
 * Save a job for the authenticated user.
 */
export async function saveJob(jobId: string): Promise<{
  success: boolean;
  saved?: boolean;
  alreadySaved?: boolean;
  error?: string;
  code?: string;
}> {
  if (!jobId || !jobId.trim()) {
    return { success: false, error: 'Job ID is required.', code: 'INVALID_JOB_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to save jobs.',
      code: 'UNAUTHENTICATED',
    };
  }

  const trimmedId = jobId.trim();
  if (!UUID_REGEX.test(trimmedId)) {
    return { success: false, error: 'Target job not found (invalid ID format).', code: 'JOB_NOT_FOUND' };
  }

  try {
    // 1. Verify job exists
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', trimmedId)
      .maybeSingle();

    if (jobError || !job) {
      return { success: false, error: 'Target job not found.', code: 'JOB_NOT_FOUND' };
    }

    // 2. Check if already saved (idempotent safe handling)
    const { data: existing } = await supabase
      .from('saved_jobs')
      .select('job_id')
      .eq('user_id', user.id)
      .eq('job_id', trimmedId)
      .maybeSingle();

    if (existing) {
      return { success: true, saved: true, alreadySaved: true };
    }

    const { error: insertError } = await supabase
      .from('saved_jobs')
      .insert({ user_id: user.id, job_id: trimmedId });

    if (insertError) {
      if (insertError.code === '23505') {
        return { success: true, saved: true, alreadySaved: true };
      }
      return { success: false, error: insertError.message, code: insertError.code };
    }

    return { success: true, saved: true, alreadySaved: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save job.';
    return { success: false, error: message };
  }
}

/**
 * Remove a saved job for the authenticated user.
 */
export async function unsaveJob(jobId: string): Promise<{
  success: boolean;
  saved?: boolean;
  error?: string;
  code?: string;
}> {
  if (!jobId || !jobId.trim()) {
    return { success: false, error: 'Job ID is required.', code: 'INVALID_JOB_ID' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to modify saved jobs.',
      code: 'UNAUTHENTICATED',
    };
  }

  const trimmedId = jobId.trim();
  if (!UUID_REGEX.test(trimmedId)) {
    return { success: false, error: 'Target job not found.', code: 'JOB_NOT_FOUND' };
  }

  try {
    const { error } = await supabase
      .from('saved_jobs')
      .delete()
      .eq('user_id', user.id)
      .eq('job_id', trimmedId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    return { success: true, saved: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to unsave job.';
    return { success: false, error: message };
  }
}
