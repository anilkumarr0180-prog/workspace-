'use server';

import { createClient } from '@/lib/supabase/server';
import { Job, ProjectType } from '@/lib/types';
import { ProposalRecord } from '@/lib/actions/proposals';
import { getSavedJobs } from '@/lib/actions/saved-jobs';
import { getJobs } from '@/lib/actions/jobs';

export interface FreelancerDashboardStats {
  submittedProposals: number;
  activeProposals: number;
  interviewingProposals: number;
  acceptedProposals: number;
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
  type: 'proposal_submitted' | 'proposal_interviewing' | 'proposal_accepted' | 'job_saved';
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

/**
 * Fetch the authenticated freelancer's comprehensive dashboard data strictly from Supabase.
 * Respects RLS and queries only user-authorized records.
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
        freelancerId: row.freelancer_id,
        freelancerName: profile.fullName,
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

    // 3. Fetch Genuine Saved Jobs
    const savedJobsResult = await getSavedJobs();
    const savedJobs: Job[] = savedJobsResult.savedJobs || [];

    // 4. Fetch Recommended Published Jobs from Database
    const jobsResult = await getJobs({ limit: 3, sortBy: 'newest' });
    const recommendedJobs: Job[] = jobsResult.jobs || [];

    // 5. Calculate Genuine Statistics
    const submittedProposals = proposals.length;
    const activeProposals = proposals.filter((p) => !['withdrawn', 'rejected'].includes(p.status)).length;
    const interviewingProposals = proposals.filter((p) => p.status === 'interviewing').length;
    const acceptedProposals = proposals.filter((p) => p.status === 'accepted').length;
    const actualEarnings = profile.totalEarnings;

    const stats: FreelancerDashboardStats = {
      submittedProposals,
      activeProposals,
      interviewingProposals,
      acceptedProposals,
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
    ];

    const completedChecks = completionChecks.filter((c) => c.value);
    const profileCompletion = Math.round((completedChecks.length / completionChecks.length) * 100);
    const profileCompletionTips = completionChecks.filter((c) => !c.value).map((c) => c.tip);

    if (profileCompletionTips.length === 0) {
      profileCompletionTips.push('Profile is 100% complete! Keep your skills and portfolio up to date.');
    }

    // 7. Dynamic Recent Activity from Genuine Events
    interface ActivitySortItem extends FreelancerDashboardActivity {
      rawDate: Date;
    }

    const activityList: ActivitySortItem[] = [];

    // Proposal events
    proposals.forEach((p) => {
      if (p.status === 'accepted') {
        activityList.push({
          id: `act-prop-acc-${p.id}`,
          title: 'Offer Accepted / Contract Initiated',
          description: `Offer accepted for "${p.jobTitle}" ($${p.bidAmount})`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_accepted',
        });
      } else if (p.status === 'interviewing') {
        activityList.push({
          id: `act-prop-int-${p.id}`,
          title: 'Interview In Progress',
          description: `Client is interviewing you for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.updatedAt || p.createdAt)),
          rawDate: new Date(p.updatedAt || p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_interviewing',
        });
      } else {
        activityList.push({
          id: `act-prop-sub-${p.id}`,
          title: 'Proposal Submitted',
          description: `Submitted bid ($${p.bidAmount}) for "${p.jobTitle}"`,
          timestamp: formatTimeAgo(new Date(p.createdAt)),
          rawDate: new Date(p.createdAt),
          link: `/jobs/${p.jobId}`,
          type: 'proposal_submitted',
        });
      }
    });

    // Saved job events
    savedJobs.slice(0, 3).forEach((sj) => {
      activityList.push({
        id: `act-saved-${sj.id}`,
        title: 'Job Bookmarked',
        description: `Saved "${sj.title}" (${sj.category})`,
        timestamp: sj.postedAt ? `Posted ${sj.postedAt}` : 'Recently saved',
        rawDate: new Date(),
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
