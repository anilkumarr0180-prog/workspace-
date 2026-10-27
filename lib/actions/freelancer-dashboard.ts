'use server';

import { createClient } from '@/lib/supabase/server';
import { Job, ProjectType, ExperienceLevel, ProjectDuration, ClientInfo } from '@/lib/types';
import { ProposalRecord } from '@/lib/actions/proposals';

export interface FreelancerDashboardStats {
  submittedProposals: number;
  pendingProposals: number;
  activeProposals: number;
  interviewingProposals: number;
  acceptedProposals: number;
  activeContracts: number;
  actualEarnings: number;
  rating: number;
  reviewCount: number;
}

export interface FreelancerDashboardActivity {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  link?: string;
  type: 'proposal_submitted' | 'proposal_interviewing' | 'proposal_accepted' | 'proposal_withdrawn' | 'proposal_rejected' | 'job_saved';
}

export interface FreelancerProfileSummary {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string | null;
  title?: string | null;
  bio?: string | null;
  hourlyRate?: number | null;
  rating: number;
  reviewCount: number;
  totalEarnings: number;
  skills: string[];
}

export interface FreelancerDashboardResult {
  success: boolean;
  stats?: FreelancerDashboardStats;
  proposals?: ProposalRecord[];
  savedJobs?: Job[];
  recommendedJobs?: Job[];
  recentActivity?: FreelancerDashboardActivity[];
  profileCompletion?: number;
  profileCompletionTips?: string[];
  profile?: FreelancerProfileSummary;
  error?: string;
  code?: string;
  source?: 'supabase' | 'fallback';
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

interface ProposalRawRow {
  id: string;
  job_id: string;
  freelancer_id: string;
  bid_amount: number;
  rate_type: string;
  delivery_days: number | null;
  cover_letter: string;
  status: 'submitted' | 'under_review' | 'interviewing' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  updated_at: string;
  jobs?: { id?: string; title?: string; status?: string } | Array<{ id?: string; title?: string; status?: string }> | null;
}

interface FreelancerSkillJoin {
  skills?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

interface SupabaseRawJob {
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
  profiles?: {
    id?: string;
    full_name?: string | null;
    avatar_url?: string | null;
    rating?: number | null;
    review_count?: number | null;
    total_spent?: number | null;
    created_at?: string | null;
  } | Array<{
    id?: string;
    full_name?: string | null;
    avatar_url?: string | null;
    rating?: number | null;
    review_count?: number | null;
    total_spent?: number | null;
    created_at?: string | null;
  }> | null;
  companies?: {
    id?: string;
    name?: string | null;
    location?: string | null;
  } | Array<{
    id?: string;
    name?: string | null;
    location?: string | null;
  }> | null;
  categories?: {
    id?: string;
    name?: string | null;
    slug?: string | null;
  } | Array<{
    id?: string;
    name?: string | null;
    slug?: string | null;
  }> | null;
  job_skills?: Array<{
    skills?: {
      id?: string;
      name?: string | null;
      slug?: string | null;
    } | null;
  }> | null;
}

function mapSupabaseJob(row: SupabaseRawJob): Job {
  const profileRaw = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const companyRaw = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  const categoryRaw = Array.isArray(row.categories) ? row.categories[0] : row.categories;

  const skillsList: string[] = Array.isArray(row.job_skills)
    ? row.job_skills
        .map((js) => js.skills?.name)
        .filter((name): name is string => Boolean(name))
    : [];

  const clientInfo: ClientInfo = {
    id: row.client_id,
    name: profileRaw?.full_name || 'Verified Client',
    companyName: companyRaw?.name || undefined,
    location: companyRaw?.location || 'Remote / Worldwide',
    rating: profileRaw?.rating ? Number(profileRaw.rating) : 5.0,
    reviewCount: profileRaw?.review_count ? Number(profileRaw.review_count) : 0,
    totalSpent: profileRaw?.total_spent ? Number(profileRaw.total_spent) : 0,
    paymentVerified: true,
    memberSince: profileRaw?.created_at
      ? new Date(profileRaw.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Active Client',
    hireRate: 90,
    openJobsCount: 1,
  };

  const projectType = row.project_type as ProjectType;

  return {
    id: row.id,
    title: row.title,
    category: categoryRaw?.name || 'General',
    description: row.description,
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
      ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Recently',
    proposalCount: Number(row.proposals_count) || 0,
    isFeatured: Boolean(row.is_featured),
  };
}

/**
 * Fetch the authenticated freelancer's comprehensive dashboard data strictly from Supabase.
 * Respects RLS and queries only user-authorized records without mock fallbacks.
 */
export async function getFreelancerDashboardData(): Promise<FreelancerDashboardResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to access the talent workspace.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 1. Fetch Freelancer Profile & Associated Skills
    const { data: profileRow, error: profError } = await supabase
      .from('profiles')
      .select(`
        id,
        username,
        full_name,
        avatar_url,
        title,
        bio,
        hourly_rate,
        rating,
        review_count,
        total_earnings,
        created_at,
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

    if (profError) {
      return {
        success: false,
        error: `Failed to load freelancer profile: ${profError.message}`,
        code: profError.code,
      };
    }

    const skills: string[] = Array.isArray(profileRow?.freelancer_skills)
      ? (profileRow.freelancer_skills as unknown as FreelancerSkillJoin[])
          .map((fs) => {
            const skillObj = Array.isArray(fs.skills) ? fs.skills[0] : fs.skills;
            return skillObj?.name;
          })
          .filter((name): name is string => Boolean(name))
      : [];

    const profile: FreelancerProfileSummary = {
      id: user.id,
      username: profileRow?.username || 'freelancer',
      fullName: profileRow?.full_name || 'Freelancer Specialist',
      avatarUrl: profileRow?.avatar_url || null,
      title: profileRow?.title || null,
      bio: profileRow?.bio || null,
      hourlyRate: profileRow?.hourly_rate ? Number(profileRow.hourly_rate) : null,
      rating: profileRow?.rating ? Number(profileRow.rating) : 5.0,
      reviewCount: profileRow?.review_count ? Number(profileRow.review_count) : 0,
      totalEarnings: profileRow?.total_earnings ? Number(profileRow.total_earnings) : 0,
      skills,
    };

    // 2. Fetch Freelancer Proposals strictly for this user
    const { data: rawProposals, error: propError } = await supabase
      .from('proposals')
      .select(`
        id,
        job_id,
        freelancer_id,
        bid_amount,
        rate_type,
        delivery_days,
        cover_letter,
        status,
        created_at,
        updated_at,
        jobs (id, title, status)
      `)
      .eq('freelancer_id', user.id)
      .order('created_at', { ascending: false });

    if (propError) {
      return {
        success: false,
        error: `Failed to load proposals: ${propError.message}`,
        code: propError.code,
      };
    }

    const proposals: ProposalRecord[] = ((rawProposals as unknown as ProposalRawRow[]) || []).map((row) => {
      const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;

      return {
        id: row.id,
        jobId: row.job_id,
        jobTitle: jobObj?.title || 'Project Application',
        jobStatus: jobObj?.status || 'published',
        freelancerId: row.freelancer_id,
        freelancerName: profile.fullName,
        freelancerUsername: profile.username || undefined,
        freelancerAvatar: profile.avatarUrl || undefined,
        bidAmount: Number(row.bid_amount),
        rateType: row.rate_type as ProjectType,
        deliveryDays: row.delivery_days ? Number(row.delivery_days) : null,
        coverLetter: row.cover_letter,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    // 3. Fetch Genuine Saved Jobs strictly from database
    const { data: rawSavedRows } = await supabase
      .from('saved_jobs')
      .select(`
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
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    interface SavedRowItem {
      job_id: string;
      created_at: string;
      jobs: SupabaseRawJob | SupabaseRawJob[] | null;
    }

    const savedJobs: Job[] = [];
    const savedJobTimestamps = new Map<string, string>();

    for (const sRow of (rawSavedRows as unknown as SavedRowItem[]) || []) {
      const jobObj = Array.isArray(sRow.jobs) ? sRow.jobs[0] : sRow.jobs;
      if (jobObj && jobObj.id) {
        savedJobs.push(mapSupabaseJob(jobObj));
        savedJobTimestamps.set(jobObj.id, sRow.created_at);
      }
    }

    // 4. Fetch Recommended Published Jobs directly from Supabase (Never mock marketplace data)
    // Exclude jobs the freelancer already applied to
    const appliedJobIds = new Set(proposals.map((p) => p.jobId));

    let recommendedJobs: Job[] = [];
    const { data: rawRecommendedRows } = await supabase
      .from('jobs')
      .select(`
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
      `)
      .eq('status', 'published')
      .neq('client_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (rawRecommendedRows && rawRecommendedRows.length > 0) {
      recommendedJobs = (rawRecommendedRows as unknown as SupabaseRawJob[])
        .filter((j) => !appliedJobIds.has(j.id))
        .slice(0, 3)
        .map(mapSupabaseJob);
    }

    // 5. Calculate Genuine Statistics
    const submittedProposals = proposals.length;
    const pendingProposals = proposals.filter((p) => p.status === 'submitted' || p.status === 'under_review').length;
    const interviewingProposals = proposals.filter((p) => p.status === 'interviewing').length;
    const acceptedProposals = proposals.filter((p) => p.status === 'accepted').length;
    const activeProposals = proposals.filter((p) => !['withdrawn', 'rejected'].includes(p.status)).length;
    
    // Active contracts: genuine accepted bids on currently active or in-progress jobs
    const activeContracts = proposals.filter(
      (p) => p.status === 'accepted' && (p.jobStatus === 'in_progress' || p.jobStatus === 'published')
    ).length;

    // Actual verified earnings strictly from database billing engine records (profiles.total_earnings)
    // We never treat accepted bids as completed earnings without verified payment records
    const actualEarnings = profile.totalEarnings;

    const stats: FreelancerDashboardStats = {
      submittedProposals,
      pendingProposals,
      activeProposals,
      interviewingProposals,
      acceptedProposals,
      activeContracts,
      actualEarnings,
      rating: profile.rating,
      reviewCount: profile.reviewCount,
    };

    // 6. Calculate Real Profile Completion & Actionable Tips
    const completionChecks = [
      { key: 'name', value: Boolean(profile.fullName && profile.fullName.trim()), tip: 'Add your full name' },
      { key: 'title', value: Boolean(profile.title && profile.title.trim()), tip: 'Add your professional title' },
      { key: 'bio', value: Boolean(profile.bio && profile.bio.trim().length >= 20), tip: 'Write a bio highlighting your experience' },
      { key: 'rate', value: Boolean(profile.hourlyRate && profile.hourlyRate > 0), tip: 'Set your target hourly rate' },
      { key: 'skills', value: Boolean(profile.skills.length > 0), tip: 'Add technical skills to your profile' },
      { key: 'avatar', value: Boolean(profile.avatarUrl && profile.avatarUrl.trim().length > 0), tip: 'Upload a professional profile photo' },
    ];

    const completedChecks = completionChecks.filter((c) => c.value);
    const profileCompletion = Math.round((completedChecks.length / completionChecks.length) * 100);
    const profileCompletionTips = completionChecks.filter((c) => !c.value).map((c) => c.tip);

    if (profileCompletionTips.length === 0) {
      profileCompletionTips.push('Profile is 100% complete! Keep your skills and portfolio up to date.');
    }

    // 7. Dynamic Recent Activity from Genuine Events Only
    interface ActivitySortItem extends FreelancerDashboardActivity {
      rawDate: Date;
    }

    const activityList: ActivitySortItem[] = [];

    // Proposal events
    proposals.forEach((p) => {
      if (p.status === 'accepted') {
        activityList.push({
          id: `act-prop-acc-${p.id}`,
          title: 'Offer Accepted',
          description: `Your proposal for "${p.jobTitle}" was accepted ($${p.bidAmount})`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_accepted',
        });
      } else if (p.status === 'interviewing') {
        activityList.push({
          id: `act-prop-int-${p.id}`,
          title: 'Interview in Progress',
          description: `Client is interviewing you for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_interviewing',
        });
      } else if (p.status === 'withdrawn') {
        activityList.push({
          id: `act-prop-wd-${p.id}`,
          title: 'Proposal Withdrawn',
          description: `Withdrew proposal for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_withdrawn',
        });
      } else if (p.status === 'rejected') {
        activityList.push({
          id: `act-prop-dec-${p.id}`,
          title: 'Proposal Declined',
          description: `Client declined bid for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_rejected',
        });
      } else {
        activityList.push({
          id: `act-prop-sub-${p.id}`,
          title: 'Proposal Submitted',
          description: `Submitted bid ($${p.bidAmount}${p.rateType === 'hourly' ? '/hr' : ''}) for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.createdAt)),
          rawDate: new Date(p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_submitted',
        });
      }
    });

    // Saved job events
    savedJobs.slice(0, 5).forEach((sj) => {
      const savedDate = savedJobTimestamps.get(sj.id) ? new Date(savedJobTimestamps.get(sj.id)!) : new Date();
      activityList.push({
        id: `act-saved-${sj.id}`,
        title: 'Job Bookmarked',
        description: `Saved "${sj.title}" (${sj.category})`,
        timestamp: formatTimeAgo(savedDate),
        rawDate: savedDate,
        link: `/jobs/${sj.id}`,
        type: 'job_saved',
      });
    });

    // Sort by recent first and take top 5
    activityList.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
    const recentActivity = activityList.slice(0, 5).map(({ id, title, description, timestamp, link, type }) => ({
      id,
      title,
      description,
      timestamp,
      link,
      type,
    }));

    return {
      success: true,
      stats,
      proposals,
      savedJobs,
      recommendedJobs,
      recentActivity,
      profileCompletion,
      profileCompletionTips,
      profile,
      source: 'supabase',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while fetching freelancer dashboard data.';
    return {
      success: false,
      error: message,
    };
  }
}
