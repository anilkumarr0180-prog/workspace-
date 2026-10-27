'use server';

import { createClient } from '@/lib/supabase/server';
import { ProjectType, ExperienceLevel, ProjectDuration } from '@/lib/types';
import { ProposalRecord } from '@/lib/actions/proposals';

export interface ClientJobSummary {
  id: string;
  title: string;
  category: string;
  projectType: ProjectType;
  budget: {
    type: ProjectType;
    fixedAmount?: number;
    hourlyMin?: number;
    hourlyMax?: number;
  };
  experienceLevel: ExperienceLevel;
  duration: ProjectDuration;
  status: 'draft' | 'published' | 'in_progress' | 'completed' | 'cancelled';
  proposalCount: number;
  createdAt: string;
  postedAt: string;
  isFeatured?: boolean;
}

export interface ClientDashboardActivity {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  type: 'job_created' | 'proposal_received' | 'proposal_accepted' | 'job_completed';
  link?: string;
}

export interface ClientDashboardStats {
  activeJobs: number;
  proposalsReceived: number;
  hiredTalent: number;
  totalSpend: number;
}

export interface ClientDashboardResult {
  success: boolean;
  stats?: ClientDashboardStats;
  jobs?: {
    published: ClientJobSummary[];
    drafts: ClientJobSummary[];
    completed: ClientJobSummary[];
    all: ClientJobSummary[];
  };
  proposals?: ProposalRecord[];
  recentActivity?: ClientDashboardActivity[];
  client?: {
    id: string;
    fullName: string;
    username: string;
    totalSpent: number;
  };
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

interface CategoryJoin {
  id?: string;
  name?: string | null;
  slug?: string | null;
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
  updated_at?: string;
  categories?: CategoryJoin | CategoryJoin[] | null;
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
  jobs?: { id?: string; title?: string; client_id?: string; company_id?: string | null; status?: string } | Array<{ id?: string; title?: string; client_id?: string; company_id?: string | null; status?: string }> | null;
  profiles?: { id?: string; full_name?: string | null; avatar_url?: string | null; username?: string | null } | Array<{ id?: string; full_name?: string | null; avatar_url?: string | null; username?: string | null }> | null;
}

/**
 * Fetch authenticated client's comprehensive dashboard data strictly from Supabase.
 * Respects RLS and queries only user/company authorized data.
 */
export async function getClientDashboardData(): Promise<ClientDashboardResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required. Please sign in to view your client dashboard.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 1. Fetch Client Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, username, total_spent, rating, review_count')
      .eq('id', user.id)
      .maybeSingle();

    // 2. Fetch User Companies (Hiring authority)
    const { data: userCompanies } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin', 'hiring_manager']);

    const companyIds = (userCompanies || []).map((c) => c.company_id);

    // 3. Fetch Client Jobs (all statuses owned by client or client's companies)
    let jobQuery = supabase
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
        updated_at,
        categories (id, name, slug)
      `)
      .order('created_at', { ascending: false });

    if (companyIds.length > 0) {
      jobQuery = jobQuery.or(`client_id.eq.${user.id},company_id.in.(${companyIds.join(',')})`);
    } else {
      jobQuery = jobQuery.eq('client_id', user.id);
    }

    const { data: rawJobs, error: jobsError } = await jobQuery;

    if (jobsError) {
      return {
        success: false,
        error: `Failed to fetch client jobs: ${jobsError.message}`,
        code: jobsError.code,
      };
    }

    const clientJobs: ClientJobSummary[] = ((rawJobs as unknown as SupabaseRawJob[]) || []).map((row) => {
      const catObj = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const projectType = row.project_type as ProjectType;

      return {
        id: row.id,
        title: row.title,
        category: catObj?.name || 'Development & IT',
        projectType,
        budget: {
          type: projectType,
          fixedAmount: projectType === 'fixed' ? Number(row.budget_min) : undefined,
          hourlyMin: projectType === 'hourly' ? Number(row.budget_min) : undefined,
          hourlyMax: projectType === 'hourly' ? Number(row.budget_max) : undefined,
        },
        experienceLevel: row.experience_level as ExperienceLevel,
        duration: row.duration as ProjectDuration,
        status: row.status as ClientJobSummary['status'],
        proposalCount: Number(row.proposals_count) || 0,
        createdAt: row.created_at,
        postedAt: formatTimeAgo(new Date(row.created_at)),
        isFeatured: Boolean(row.is_featured),
      };
    });

    // 4. Fetch Client Proposals (Proposals submitted to client's jobs)
    const jobIds = clientJobs.map((j) => j.id);
    let proposals: ProposalRecord[] = [];

    if (jobIds.length > 0) {
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
          jobs (id, title, client_id, company_id, status),
          profiles!freelancer_id (id, full_name, avatar_url, username)
        `)
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });

      if (!propError && rawProposals) {
        proposals = ((rawProposals as unknown as ProposalRawRow[]) || []).map((row) => {
          const jobObj = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
          const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

          return {
            id: row.id,
            jobId: row.job_id,
            jobTitle: jobObj?.title || 'Project Application',
            freelancerId: row.freelancer_id,
            freelancerName: profileObj?.full_name || 'Freelancer Specialist',
            freelancerUsername: profileObj?.username || undefined,
            freelancerAvatar: profileObj?.avatar_url || undefined,
            bidAmount: Number(row.bid_amount),
            rateType: row.rate_type as ProjectType,
            deliveryDays: row.delivery_days ? Number(row.delivery_days) : null,
            coverLetter: row.cover_letter,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
      }
    }

    // 5. Partition Jobs into Categories
    // Active/Published includes published and cancelled/paused for interactive management
    const published = clientJobs.filter((j) => j.status === 'published' || j.status === 'cancelled' || j.status === 'in_progress');
    const drafts = clientJobs.filter((j) => j.status === 'draft');
    const completed = clientJobs.filter((j) => j.status === 'completed');

    // 6. Compute Real Statistics
    const activeJobsCount = clientJobs.filter((j) => j.status === 'published').length;
    const proposalsReceivedCount = proposals.length;
    const hiredCount = proposals.filter((p) => p.status === 'accepted').length;

    // Calculate real spend: profile total_spent or sum of accepted bids
    const acceptedBidsSum = proposals
      .filter((p) => p.status === 'accepted')
      .reduce((sum, p) => sum + (p.bidAmount || 0), 0);
    const profileSpent = Number(profile?.total_spent) || 0;
    const totalSpend = Math.max(profileSpent, acceptedBidsSum);

    // 7. Dynamic Activity Feed from genuine events
    interface ActivitySortItem extends ClientDashboardActivity {
      rawDate: Date;
    }

    const activityList: ActivitySortItem[] = [];

    // Job posting activities
    clientJobs.forEach((job) => {
      activityList.push({
        id: `act-job-${job.id}`,
        title: job.status === 'draft' ? 'Draft Saved' : 'Job Posted',
        description: `"${job.title}" (${job.category})`,
        timestamp: formatTimeAgo(new Date(job.createdAt)),
        rawDate: new Date(job.createdAt),
        type: 'job_created',
        link: `/jobs/${job.id}`,
      });
    });

    // Proposal received activities
    proposals.forEach((prop) => {
      if (prop.status === 'accepted') {
        activityList.push({
          id: `act-prop-accepted-${prop.id}`,
          title: 'Offer Accepted / Talent Hired',
          description: `Contract initiated with ${prop.freelancerName} for "${prop.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(prop.updatedAt || prop.createdAt)),
          rawDate: new Date(prop.updatedAt || prop.createdAt),
          type: 'proposal_accepted',
          link: `/jobs/${prop.jobId}`,
        });
      } else {
        activityList.push({
          id: `act-prop-received-${prop.id}`,
          title: 'Proposal Received',
          description: `${prop.freelancerName} applied for "${prop.jobTitle}" ($${prop.bidAmount})`,
          timestamp: formatTimeAgo(new Date(prop.createdAt)),
          rawDate: new Date(prop.createdAt),
          type: 'proposal_received',
          link: `/jobs/${prop.jobId}`,
        });
      }
    });

    // Sort by recent first and take top 6
    activityList.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
    const recentActivity = activityList.slice(0, 6).map(({ id, title, description, timestamp, type, link }) => ({
      id,
      title,
      description,
      timestamp,
      type,
      link,
    }));

    return {
      success: true,
      stats: {
        activeJobs: activeJobsCount,
        proposalsReceived: proposalsReceivedCount,
        hiredTalent: hiredCount,
        totalSpend,
      },
      jobs: {
        published,
        drafts,
        completed,
        all: clientJobs,
      },
      proposals,
      recentActivity,
      client: {
        id: user.id,
        fullName: profile?.full_name || 'Employer Account',
        username: profile?.username || 'client',
        totalSpent: totalSpend,
      },
      source: 'supabase',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An error occurred while fetching client dashboard data.';
    return {
      success: false,
      error: message,
    };
  }
}
