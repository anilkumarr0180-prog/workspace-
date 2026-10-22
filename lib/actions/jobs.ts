'use server';

import { createClient } from '@/lib/supabase/server';
import { Job, ProjectType, ExperienceLevel, ProjectDuration, ClientInfo } from '@/lib/types';
import { INITIAL_JOBS } from '@/lib/mock-data';

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

  const clientInfo: ClientInfo = {
    id: row.client_id,
    name: profile.full_name || 'Verified Client',
    companyName: company?.name || profile.company_name || undefined,
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
    isFeatured: Boolean(row.is_featured),
  };
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

    if (data && data.length > 0) {
      const mappedJobs = (data as unknown as SupabaseJobRow[]).map(mapSupabaseJobToFrontend);
      return {
        jobs: mappedJobs,
        total: count ?? mappedJobs.length,
        source: 'supabase',
        page,
        limit,
      };
    }

    // If database table is empty, return initial mock dataset so UI is immediately useful
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
      return { job: mapSupabaseJobToFrontend(data as unknown as SupabaseJobRow), source: 'supabase' };
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
  } else if (trimmedDesc.length < 40) {
    fieldErrors.description = 'Description must be at least 40 characters.';
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
    // 3. Resolve Category ID
    let categoryId: string | null = null;
    if (input.category) {
      const { data: catData } = await supabase
        .from('categories')
        .select('id')
        .or(`name.eq."${input.category}",slug.eq."${input.category}"`)
        .maybeSingle();

      if (catData) {
        categoryId = catData.id;
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
    const { job: fullJob } = await getJobById(insertedJob.id);
    return {
      success: true,
      job: fullJob || undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred while creating the job.';
    return {
      success: false,
      error: message,
    };
  }
}
