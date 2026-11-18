'use server';

import { createClient } from '../supabase/server';
import { Job, ProjectType, ExperienceLevel, ProjectDuration, ClientInfo } from '../types';
import { INITIAL_JOBS } from '../mock-data';
import { createNotification } from './notifications';

export interface CreateJobInput {
  title: string;
  category: string;
  description: string;
  responsibilities?: string[];
  deliverables?: string[];
  projectType: ProjectType;
  budgetMin?: number;
  budgetMax?: number;
  fixedAmount?: number;
  experienceLevel: ExperienceLevel;
  duration: ProjectDuration;
  skills: string[];
  companyId?: string;
  clientName?: string;
  companyName?: string;
}

export interface GetJobsFilters {
  query?: string;
  category?: string;
  projectType?: string;
  experienceLevel?: string;
  minBudget?: number;
  page?: number;
  limit?: number;
  sortBy?: 'newest' | 'budget_high' | 'proposals_low';
}

export interface GetJobsResult {
  jobs: Job[];
  total: number;
  source: 'supabase' | 'fallback';
  page: number;
  limit: number;
}

interface ProfileJoin {
  id?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  rating?: number | null;
  review_count?: number | null;
  total_spent?: number | null;
  created_at?: string | null;
  company_name?: string | null;
}

interface CompanyJoin {
  id?: string;
  name?: string | null;
  location?: string | null;
}

interface CategoryJoin {
  id?: string;
  name?: string | null;
  slug?: string | null;
}

interface SupabaseJobRow {
  id: string;
  client_id: string;
  company_id?: string | null;
  category_id?: string | null;
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
  updated_at?: string;
  responsibilities?: string[] | null;
  deliverables?: string[] | null;
  profiles?: ProfileJoin | ProfileJoin[] | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
  categories?: CategoryJoin | CategoryJoin[] | null;
  job_skills?: Array<{
    skills?: {
      id?: string;
      name?: string | null;
      slug?: string | null;
    } | null;
  }> | null;
}

/**
 * Maps a raw Supabase job row with joins to the standard frontend Job interface.
 */
function mapSupabaseJobToFrontend(row: SupabaseJobRow): Job {
  const profileRaw = row.profiles;
  const profile: ProfileJoin = Array.isArray(profileRaw) ? profileRaw[0] || {} : profileRaw || {};

  const companyRaw = row.companies;
  const company: CompanyJoin | null = Array.isArray(companyRaw) ? companyRaw[0] || null : companyRaw || null;

  const categoryRaw = row.categories;
  const categoryObj: CategoryJoin | null = Array.isArray(categoryRaw) ? categoryRaw[0] || null : categoryRaw || null;
  const categoryName = categoryObj?.name || 'Development & IT';

  const skillsList: string[] = Array.isArray(row.job_skills)
    ? row.job_skills
        .map((js) => js.skills?.name)
        .filter((name): name is string => Boolean(name))
    : [];

  const reviewCount = Number(profile.review_count) || 0;
  const ratingVal = profile.rating !== null && profile.rating !== undefined ? Number(profile.rating) : null;
  const totalSpentVal = Number(profile.total_spent) || 0;

  const clientInfo: ClientInfo = {
    id: row.client_id,
    name: profile.full_name || 'Client',
    companyName: company?.name || undefined,
    location: company?.location || 'Remote / Worldwide',
    rating: reviewCount > 0 && ratingVal !== null ? ratingVal : null,
    reviewCount,
    totalSpent: totalSpentVal,
    paymentVerified: totalSpentVal > 0,
    memberSince: profile.created_at
      ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Recent Member',
    hireRate: null,
    openJobsCount: null,
  };

  const projectType = row.project_type as ProjectType;

  return {
    id: row.id,
    title: row.title,
    category: categoryName,
    description: row.description,
    responsibilities: row.responsibilities || [],
    deliverables: row.deliverables || [],
    projectType,
    budget: {
      type: projectType,
      fixedAmount: projectType === 'fixed' ? Number(row.budget_min) : undefined,
      hourlyMin: projectType === 'hourly' ? Number(row.budget_min) : undefined,
      hourlyMax: projectType === 'hourly' ? Number(row.budget_max) : undefined,
    },
    experienceLevel: row.experience_level as ExperienceLevel,
    duration: row.duration as ProjectDuration,
    skills: skillsList,
    client: clientInfo,
    postedAt: row.created_at
      ? formatTimeAgo(new Date(row.created_at))
      : 'Recently',
    proposalCount: Number(row.proposals_count) || 0,
    interviewingCount: 0,
    invitesCount: 0,
    isFeatured: Boolean(row.is_featured),
  };
}

/**
 * Server action to format a Supabase job row into the frontend Job interface.
 */
export async function formatJobForFrontend(row: SupabaseJobRow): Promise<Job> {
  return mapSupabaseJobToFrontend(row);
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Fetch jobs with search, filtering, and pagination.
 * Queries Supabase `jobs` table with fallbacks for local/pre-migration states.
 */
export async function getJobs(filters: GetJobsFilters = {}): Promise<GetJobsResult> {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(50, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  try {
    const supabase = await createClient();

    let query = supabase
      .from('jobs')
      .select(
        `
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
        updated_at,
        profiles!client_id (id, full_name, avatar_url, rating, review_count, total_spent, created_at),
        companies (id, name, location),
        categories (id, name, slug),
        job_skills (skills (id, name, slug))
      `,
        { count: 'exact' }
      )
      .eq('status', 'published');

    // Keyword search on title/description
    if (filters.query && filters.query.trim()) {
      const q = filters.query.trim();
      query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    }

    // Category filter
    if (filters.category && filters.category !== 'all') {
      const { data: catRecord } = await supabase
        .from('categories')
        .select('id')
        .or(`name.eq."${filters.category}",slug.eq."${filters.category}"`)
        .maybeSingle();

      if (catRecord) {
        query = query.eq('category_id', catRecord.id);
      }
    }

    // Project type filter
    if (filters.projectType && filters.projectType !== 'all') {
      query = query.eq('project_type', filters.projectType);
    }

    // Experience level filter
    if (filters.experienceLevel && filters.experienceLevel !== 'all') {
      query = query.eq('experience_level', filters.experienceLevel);
    }

    // Minimum budget filter
    if (filters.minBudget && filters.minBudget > 0) {
      query = query.gte('budget_min', filters.minBudget);
    }

    // Sorting
    if (filters.sortBy === 'budget_high') {
      query = query.order('budget_min', { ascending: false });
    } else if (filters.sortBy === 'proposals_low') {
      query = query.order('proposals_count', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      // Table may not exist yet if migrations haven't run on the remote instance
      return getFilteredFallbackJobs(filters, page, limit);
    }

    if (data) {
      // Database query executed successfully. Return genuine live records (empty or populated)
      const mappedJobs = (data as unknown as SupabaseJobRow[]).map(mapSupabaseJobToFrontend);
      return {
        jobs: mappedJobs,
        total: count ?? mappedJobs.length,
        source: 'supabase',
        page,
        limit,
      };
    }

    return getFilteredFallbackJobs(filters, page, limit);
  } catch {
    return getFilteredFallbackJobs(filters, page, limit);
  }
}

function getFilteredFallbackJobs(filters: GetJobsFilters, page: number, limit: number): GetJobsResult {
  let list = [...INITIAL_JOBS];

  if (filters.query && filters.query.trim()) {
    const q = filters.query.toLowerCase().trim();
    list = list.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.description.toLowerCase().includes(q) ||
        j.skills.some((s) => s.toLowerCase().includes(q))
    );
  }

  if (filters.category && filters.category !== 'all') {
    list = list.filter((j) => j.category === filters.category);
  }

  if (filters.projectType && filters.projectType !== 'all') {
    list = list.filter((j) => j.projectType === filters.projectType);
  }

  if (filters.experienceLevel && filters.experienceLevel !== 'all') {
    list = list.filter((j) => j.experienceLevel === filters.experienceLevel);
  }

  if (filters.minBudget && filters.minBudget > 0) {
    list = list.filter((j) => {
      const b = j.budget.type === 'fixed' ? j.budget.fixedAmount || 0 : j.budget.hourlyMax || 0;
      return b >= (filters.minBudget || 0);
    });
  }

  if (filters.sortBy === 'budget_high') {
    list.sort((a, b) => {
      const valA = a.budget.type === 'fixed' ? a.budget.fixedAmount || 0 : (a.budget.hourlyMax || 0) * 40;
      const valB = b.budget.type === 'fixed' ? b.budget.fixedAmount || 0 : (b.budget.hourlyMax || 0) * 40;
      return valB - valA;
    });
  } else if (filters.sortBy === 'proposals_low') {
    list.sort((a, b) => a.proposalCount - b.proposalCount);
  }

  const total = list.length;
  const paginated = list.slice((page - 1) * limit, page * limit);

  return {
    jobs: paginated,
    total,
    source: 'fallback',
    page,
    limit,
  };
}

/**
 * Fetch a single job by its ID.
 */
export async function getJobById(id: string): Promise<{ job: Job | null; source: 'supabase' | 'fallback' }> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
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
        updated_at,
        profiles!client_id (id, full_name, avatar_url, rating, review_count, total_spent, created_at),
        companies (id, name, location),
        categories (id, name, slug),
        job_skills (skills (id, name, slug))
      `
      )
      .eq('id', id)
      .maybeSingle();

    if (!error && data) {
      let proposalsCount = Number(data.proposals_count) || 0;
      let interviewingCount = 0;

      try {
        const [pCountRes, iCountRes] = await Promise.all([
          supabase
            .from('proposals')
            .select('id', { count: 'exact', head: true })
            .eq('job_id', id),
          supabase
            .from('proposals')
            .select('id', { count: 'exact', head: true })
            .eq('job_id', id)
            .eq('status', 'interviewing'),
        ]);

        if (pCountRes.count !== null && pCountRes.count !== undefined) {
          proposalsCount = pCountRes.count;
        }
        if (iCountRes.count !== null && iCountRes.count !== undefined) {
          interviewingCount = iCountRes.count;
        }
      } catch {
        // Non-blocking query
      }

      const mappedJob = mapSupabaseJobToFrontend(data as unknown as SupabaseJobRow);
      mappedJob.proposalCount = proposalsCount;
      mappedJob.interviewingCount = interviewingCount;
      mappedJob.invitesCount = 0;

      return { job: mappedJob, source: 'supabase' };
    }

    if (!error && !data) {
      // Record does not exist in database. Only match demo fallback if ID explicitly matches mock dataset
      const fallback = INITIAL_JOBS.find((j) => j.id === id);
      if (fallback) {
        return { job: fallback, source: 'fallback' };
      }
      return { job: null, source: 'supabase' };
    }
  } catch {
    // Continue to fallback
  }

  const fallback = INITIAL_JOBS.find((j) => j.id === id) || null;
  return { job: fallback, source: 'fallback' };
}

/**
 * Create a new job in the database.
 * Strictly verifies authentication on the server and validates all business constraints.
 */
export async function createJob(input: CreateJobInput): Promise<{
  success: boolean;
  job?: Job;
  error?: string;
  fieldErrors?: Record<string, string>;
}> {
  const fieldErrors: Record<string, string> = {};

  // 1. Input Validation
  const trimmedTitle = input.title?.trim() || '';
  if (!trimmedTitle) {
    fieldErrors.title = 'Title is required.';
  } else if (trimmedTitle.length < 10) {
    fieldErrors.title = 'Title must be at least 10 characters.';
  }

  const trimmedDesc = input.description?.trim() || '';
  if (!trimmedDesc) {
    fieldErrors.description = 'Description is required.';
  } else if (trimmedDesc.length < 50) {
    fieldErrors.description = 'Description must be at least 50 characters.';
  }

  if (!input.skills || input.skills.length === 0) {
    fieldErrors.skills = 'At least one skill is required.';
  }

  let budgetMin: number | null = null;
  let budgetMax: number | null = null;

  if (input.projectType === 'fixed') {
    const fixed = Number(input.fixedAmount || input.budgetMin || 0);
    if (fixed <= 0) {
      fieldErrors.budget = 'Fixed budget must be a positive number.';
    } else {
      budgetMin = fixed;
      budgetMax = null;
    }
  } else {
    const min = Number(input.budgetMin || 0);
    const max = Number(input.budgetMax || 0);
    if (min <= 0 || max <= 0 || max < min) {
      fieldErrors.budget = 'Hourly budget requires a valid range (max >= min > 0).';
    } else {
      budgetMin = min;
      budgetMax = max;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  // 2. Authentication Check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to post a live database job.',
    };
  }

  try {
    // 3. Resolve Category ID safely (with fallback so trigger never rejects null category)
    let categoryId: string | null = null;
    if (input.category) {
      try {
        const { data: catData } = await supabase
          .from('categories')
          .select('id')
          .eq('name', input.category)
          .maybeSingle();

        if (catData) {
          categoryId = catData.id;
        } else {
          const { data: firstCat } = await supabase
            .from('categories')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (firstCat) categoryId = firstCat.id;
        }
      } catch {
        // Non-blocking fallback
      }
    }

    if (!categoryId) {
      try {
        const { data: fallbackCat } = await supabase
          .from('categories')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (fallbackCat) categoryId = fallbackCat.id;
      } catch {
        // Non-blocking
      }
    }

    // 4. Insert Job Record
    const insertPayload: Record<string, string | number | boolean | null> = {
      client_id: user.id,
      title: trimmedTitle,
      description: trimmedDesc,
      project_type: input.projectType,
      budget_min: budgetMin,
      budget_max: budgetMax,
      experience_level: input.experienceLevel,
      duration: input.duration,
      status: 'published',
      category_id: categoryId,
      company_id: input.companyId || null,
    };

    const { data: insertedJob, error: insertError } = await supabase
      .from('jobs')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      return {
        success: false,
        error: `Database error: ${insertError.message}`,
      };
    }

    // 4b. Ensure user profile can hire and sync profile name if provided
    try {
      const profileUpdates: { full_name?: string; can_hire?: boolean } = { can_hire: true };
      if (input.clientName && input.clientName.trim()) {
        profileUpdates.full_name = input.clientName.trim();
      }
      await supabase.from('profiles').update(profileUpdates).eq('id', user.id);
    } catch (profileUpdateErr) {
      console.warn('Notice updating profile name from job post:', profileUpdateErr);
    }

    // 5. Associate Skills
    if (input.skills && input.skills.length > 0) {
      for (const skillName of input.skills) {
        const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        // Resolve skill ID
        let skillId: string | null = null;
        const { data: existingSkill } = await supabase
          .from('skills')
          .select('id')
          .eq('slug', slug)
          .maybeSingle();

        if (existingSkill) {
          skillId = existingSkill.id;
        } else {
          const { data: newSkill } = await supabase
            .from('skills')
            .insert({ name: skillName.trim(), slug })
            .select('id')
            .maybeSingle();
          if (newSkill) skillId = newSkill.id;
        }

        if (skillId) {
          await supabase.from('job_skills').insert({
            job_id: insertedJob.id,
            skill_id: skillId,
          });
        }
      }
    }

    // Fetch complete newly created job
    let fullJob: Job | null = null;
    try {
      const jobRes = await getJobById(insertedJob.id);
      fullJob = jobRes.job;
    } catch {
      // Non-blocking fallback
    }

    const finalJob = fullJob || mapSupabaseJobToFrontend(insertedJob as unknown as SupabaseJobRow);

    // Notify client of successful job publication
    createNotification({
      userId: user.id,
      type: 'job_created',
      title: 'Job Successfully Posted',
      message: `Your job listing "${input.title}" is now published and open for proposals.`,
      link: `/jobs/${insertedJob.id}`,
    }).catch(() => {});

    return {
      success: true,
      job: finalJob,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while creating the job.';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Update the status of a job (e.g., publish, pause/cancel, complete).
 * Strictly verifies client ownership or company manager authority.
 */
export async function updateJobStatus(
  jobId: string,
  newStatus: 'published' | 'cancelled' | 'draft' | 'completed'
): Promise<{
  success: boolean;
  job?: Job;
  error?: string;
  code?: string;
}> {
  const allowedStatuses = ['published', 'cancelled', 'draft', 'completed'];
  if (!allowedStatuses.includes(newStatus)) {
    return {
      success: false,
      error: `Invalid status "${newStatus}". Must be one of: ${allowedStatuses.join(', ')}`,
      code: 'INVALID_STATUS',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to update job status.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, client_id, company_id, status')
      .eq('id', jobId.trim())
      .maybeSingle();

    if (fetchError || !job) {
      return {
        success: false,
        error: 'Job not found.',
        code: 'NOT_FOUND',
      };
    }

    let isAuthorized = job.client_id === user.id;

    if (!isAuthorized && job.company_id) {
      const { data: member } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', job.company_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'hiring_manager'])
        .maybeSingle();

      if (member) isAuthorized = true;
    }

    if (!isAuthorized) {
      return {
        success: false,
        error: 'Unauthorized: You do not have permission to update this job.',
        code: 'FORBIDDEN',
      };
    }

    const { error: updateError } = await supabase
      .from('jobs')
      .update({ status: newStatus })
      .eq('id', jobId.trim());

    if (updateError) {
      return {
        success: false,
        error: `Database error: ${updateError.message}`,
        code: updateError.code,
      };
    }

    const { job: updatedJob } = await getJobById(jobId.trim());

    return {
      success: true,
      job: updatedJob || undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while updating the job.';
    return {
      success: false,
      error: message,
    };
  }
}

export interface UpdateJobBudgetInput {
  projectType?: 'fixed' | 'hourly';
  fixedAmount?: number;
  budgetMin?: number;
  budgetMax?: number;
}

/**
 * Update the budget / price of a job post with client ownership verification.
 */
export async function updateJobBudget(
  jobId: string,
  input: UpdateJobBudgetInput
): Promise<{
  success: boolean;
  job?: Job;
  error?: string;
  code?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to update job budget.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, client_id, company_id, status, project_type')
      .eq('id', jobId.trim())
      .maybeSingle();

    if (fetchError || !job) {
      return { success: false, error: 'Job not found.', code: 'NOT_FOUND' };
    }

    let isAuthorized = job.client_id === user.id;
    if (!isAuthorized && job.company_id) {
      const { data: member } = await supabase
        .from('company_members')
        .select('role')
        .eq('company_id', job.company_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'hiring_manager'])
        .maybeSingle();
      if (member) isAuthorized = true;
    }

    if (!isAuthorized) {
      return {
        success: false,
        error: 'Unauthorized: You do not have permission to update this job.',
        code: 'FORBIDDEN',
      };
    }

    const updatePayload: Record<string, unknown> = {};

    if (input.projectType) {
      updatePayload.project_type = input.projectType;
    }

    const type = input.projectType || job.project_type;

    if (type === 'fixed') {
      const amount = typeof input.fixedAmount === 'number' ? input.fixedAmount : input.budgetMax;
      if (typeof amount !== 'number' || amount <= 0) {
        return { success: false, error: 'Fixed price budget must be greater than zero.' };
      }
      updatePayload.budget_min = amount;
      updatePayload.budget_max = amount;
    } else {
      const min = typeof input.budgetMin === 'number' ? input.budgetMin : 0;
      const max = typeof input.budgetMax === 'number' ? input.budgetMax : min;
      if (min < 0 || max <= 0 || min > max) {
        return { success: false, error: 'Hourly rate minimum must be less than or equal to maximum.' };
      }
      updatePayload.budget_min = min;
      updatePayload.budget_max = max;
    }

    const { error: updateError } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', jobId.trim());

    if (updateError) {
      return { success: false, error: updateError.message, code: updateError.code };
    }

    const { job: updatedJob } = await getJobById(jobId.trim());

    return {
      success: true,
      job: updatedJob || undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error updating job budget.',
    };
  }
}

/**
 * Client action to withdraw / cancel a job post.
 */
export async function withdrawJob(jobId: string) {
  return updateJobStatus(jobId, 'cancelled');
}

