'use server';

import { createClient } from '@/lib/supabase/server';
import { Freelancer, PublicFreelancer, TaxonomySkill } from '@/lib/types';
import { INITIAL_FREELANCERS } from '@/lib/mock-data';

interface DbSkillJoin {
  skills: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

interface DbProfileRow {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
  bio: string | null;
  hourly_rate: number | null;
  rating: number;
  review_count: number;
  total_earnings: number;
  created_at: string;
  freelancer_skills: DbSkillJoin[] | null;
}

export interface GetFreelancersResult {
  freelancers: Freelancer[];
  total: number;
  source: 'supabase' | 'fallback';
  error?: string | null;
}

export interface FreelancerQueryFilters {
  query?: string;
  category?: string;
  badge?: string;
  minRate?: number;
  maxRate?: number;
  availability?: string;
  sortBy?: 'rating' | 'rate_low' | 'rate_high' | 'success_score' | 'hourly_rate_low' | 'hourly_rate_high';
  limit?: number;
  page?: number;
}

/**
 * Maps a real database profile row into the standard Freelancer interface.
 */
function mapProfileRowToFreelancer(row: DbProfileRow): Freelancer {
  const skillsList: string[] = Array.isArray(row.freelancer_skills)
    ? row.freelancer_skills
        .map((fs) => fs.skills?.name)
        .filter((name): name is string => Boolean(name))
    : [];

  const hourlyRate = row.hourly_rate ? Number(row.hourly_rate) : 50;
  const rating = row.rating ? Number(row.rating) : 5.0;
  const reviewCount = row.review_count ? Number(row.review_count) : 0;
  const totalEarningsNum = row.total_earnings ? Number(row.total_earnings) : 0;

  const totalEarningsFormatted =
    totalEarningsNum >= 1000
      ? `$${Math.round(totalEarningsNum / 1000)}k+`
      : `$${totalEarningsNum}`;

  const jobSuccessScore = reviewCount > 0 ? (rating >= 4.8 ? 100 : Math.round(rating * 20)) : 100;

  let badge: 'top_rated' | 'top_rated_plus' | 'rising_talent' = 'rising_talent';
  if (rating >= 4.9 && reviewCount >= 3) {
    badge = 'top_rated_plus';
  } else if (rating >= 4.7 && reviewCount >= 1) {
    badge = 'top_rated';
  }

  // Fallback avatar using user initials if avatar_url is missing
  const avatarUrl =
    row.avatar_url && row.avatar_url.trim().length > 0
      ? row.avatar_url
      : `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80`;

  return {
    id: row.id,
    username: row.username,
    name: row.full_name,
    avatarUrl,
    title: row.title || 'Independent Professional',
    tagline: row.title || 'Specialized Marketplace Talent',
    bio: row.bio || 'Verified independent specialist on Workspace.',
    hourlyRate,
    rating,
    reviewCount,
    jobSuccessScore,
    badge,
    location: 'Remote / Global',
    localTime: 'Flexible Timezone',
    totalEarnings: totalEarningsFormatted,
    hoursWorked: Math.max(10, Math.round(totalEarningsNum / Math.max(hourlyRate, 20))),
    completedJobsCount: Math.max(reviewCount, totalEarningsNum > 0 ? 1 : 0),
    primaryCategory: 'Development & IT',
    skills: skillsList.length > 0 ? skillsList : ['Full-Stack Development', 'TypeScript', 'Next.js'],
    availability: 'Available now',
    englishLevel: 'Fluent',
    portfolio: [],
    experience: [],
    education: [],
    reviews: [],
  };
}

/**
 * Server Action: Fetches real eligible freelancer profiles from Supabase.
 * Respects RLS and privacy rules, fetching only public-facing fields.
 */
export async function getFreelancers(filters: FreelancerQueryFilters = {}): Promise<GetFreelancersResult> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from('profiles')
      .select(
        `
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
      `,
        { count: 'exact' }
      )
      .eq('can_work', true)
      .eq('is_suspended', false);

    // Keyword search across profile text fields
    if (filters.query && filters.query.trim()) {
      const q = filters.query.trim();
      query = query.or(`full_name.ilike.%${q}%,username.ilike.%${q}%,title.ilike.%${q}%,bio.ilike.%${q}%`);
    }

    // Hourly rate bounds
    if (filters.minRate && filters.minRate > 0) {
      query = query.gte('hourly_rate', filters.minRate);
    }
    if (filters.maxRate && filters.maxRate > 0) {
      query = query.lte('hourly_rate', filters.maxRate);
    }

    // Sort order
    if (filters.sortBy === 'rate_low' || filters.sortBy === 'hourly_rate_low') {
      query = query.order('hourly_rate', { ascending: true, nullsFirst: false });
    } else if (filters.sortBy === 'rate_high' || filters.sortBy === 'hourly_rate_high') {
      query = query.order('hourly_rate', { ascending: false, nullsFirst: false });
    } else {
      query = query.order('rating', { ascending: false }).order('review_count', { ascending: false });
    }

    const limit = filters.limit ? Math.min(Math.max(filters.limit, 1), 50) : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.warn('Supabase query error for freelancers:', error.message);
      return {
        freelancers: INITIAL_FREELANCERS,
        total: INITIAL_FREELANCERS.length,
        source: 'fallback',
        error: error.message,
      };
    }

    if (data) {
      let mapped = (data as unknown as DbProfileRow[]).map(mapProfileRowToFreelancer);

      // In-memory category filter if requested
      if (filters.category && filters.category !== 'all') {
        const catLower = filters.category.toLowerCase();
        mapped = mapped.filter(
          (f) =>
            f.primaryCategory.toLowerCase() === catLower ||
            f.skills.some((s) => s.toLowerCase().includes(catLower))
        );
      }

      // If database returned genuine records
      if (mapped.length > 0 || (count !== null && count === 0)) {
        return {
          freelancers: mapped,
          total: count ?? mapped.length,
          source: 'supabase',
          error: null,
        };
      }
    }

    return {
      freelancers: INITIAL_FREELANCERS,
      total: INITIAL_FREELANCERS.length,
      source: 'fallback',
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error loading freelancers';
    return {
      freelancers: INITIAL_FREELANCERS,
      total: INITIAL_FREELANCERS.length,
      source: 'fallback',
      error: message,
    };
  }
}

/**
 * Server Action: Fetches featured freelancers (top rated) from Supabase.
 */
export async function getFeaturedFreelancers(limit = 6): Promise<{ freelancers: PublicFreelancer[]; source: 'supabase' | 'fallback'; error?: string | null }> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
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
      .eq('can_work', true)
      .eq('is_suspended', false)
      .order('rating', { ascending: false })
      .order('review_count', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Error fetching featured freelancers from Supabase:', error.message);
      return {
        freelancers: [],
        source: 'fallback',
        error: error.message,
      };
    }

    if (!data || data.length === 0) {
      return {
        freelancers: [],
        source: 'supabase',
        error: null,
      };
    }

    const freelancers: PublicFreelancer[] = (data as unknown as DbProfileRow[]).map((row) => {
      const skills: TaxonomySkill[] = Array.isArray(row.freelancer_skills)
        ? row.freelancer_skills
            .map((fs) => fs.skills)
            .filter((s): s is TaxonomySkill => Boolean(s && s.id && s.name))
        : [];

      return {
        id: row.id,
        username: row.username,
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
        title: row.title,
        bio: row.bio,
        hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
        rating: row.rating ? Number(row.rating) : 5,
        reviewCount: row.review_count ? Number(row.review_count) : 0,
        totalEarnings: row.total_earnings ? Number(row.total_earnings) : 0,
        skills,
        createdAt: row.created_at,
      };
    });

    return {
      freelancers,
      source: 'supabase',
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error loading freelancers';
    return {
      freelancers: [],
      source: 'fallback',
      error: message,
    };
  }
}

export interface GetFreelancerByUsernameResult {
  freelancer: PublicFreelancer | null;
  source: 'supabase' | 'fallback';
  error?: string | null;
}

/**
 * Server Action: Fetches a single public freelancer profile by username.
 * Respects RLS and returns null if not found, not eligible, or suspended.
 */
export async function getFreelancerByUsername(
  username: string
): Promise<GetFreelancerByUsernameResult> {
  try {
    if (!username || !username.trim()) {
      return { freelancer: null, source: 'supabase', error: 'Username is required' };
    }

    const supabase = await createClient();
    const cleanUsername = username.trim();

    const { data, error } = await supabase
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
      .ilike('username', cleanUsername)
      .eq('can_work', true)
      .eq('is_suspended', false)
      .maybeSingle();

    if (!error && data) {
      const skills: TaxonomySkill[] = Array.isArray(data.freelancer_skills)
        ? (data.freelancer_skills as unknown as DbSkillJoin[])
            .map((fs) => fs.skills)
            .filter((s): s is TaxonomySkill => Boolean(s && s.id && s.name))
        : [];

      const freelancer: PublicFreelancer = {
        id: data.id,
        username: data.username,
        fullName: data.full_name,
        avatarUrl: data.avatar_url,
        title: data.title,
        bio: data.bio,
        hourlyRate: data.hourly_rate ? Number(data.hourly_rate) : null,
        rating: data.rating ? Number(data.rating) : 5,
        reviewCount: data.review_count ? Number(data.review_count) : 0,
        totalEarnings: data.total_earnings ? Number(data.total_earnings) : 0,
        skills,
        createdAt: data.created_at,
      };

      return { freelancer, source: 'supabase', error: null };
    }

    if (!error && !data) {
      // Authoritative database returned no matching active profile: profile does NOT exist
      return { freelancer: null, source: 'supabase', error: null };
    }

    // Only if a database/network error occurred during offline development, allow demo accounts
    if (error) {
      const fallback = INITIAL_FREELANCERS.find(
        (f) => f.username.toLowerCase() === cleanUsername.toLowerCase()
      );

      if (fallback) {
        const freelancer: PublicFreelancer = {
          id: fallback.id,
          username: fallback.username,
          fullName: fallback.name,
          avatarUrl: fallback.avatarUrl,
          title: fallback.title,
          bio: fallback.bio,
          hourlyRate: fallback.hourlyRate,
          rating: fallback.rating,
          reviewCount: fallback.reviewCount,
          totalEarnings: 15000,
          skills: fallback.skills.map((s, idx) => ({
            id: `fs-${idx}`,
            name: s,
            slug: s.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          })),
          createdAt: '2025-01-15T00:00:00.000Z',
        };
        return { freelancer, source: 'fallback', error: null };
      }
    }

    return { freelancer: null, source: 'supabase', error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error loading freelancer';
    return { freelancer: null, source: 'fallback', error: message };
  }
}

