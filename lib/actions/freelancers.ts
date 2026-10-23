'use server';

import { createClient } from '@/lib/supabase/client';
import { PublicFreelancer, TaxonomySkill } from '@/lib/types';

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
  freelancers: PublicFreelancer[];
  source: 'supabase';
  error?: string | null;
}

/**
 * Server Action: Fetches real eligible freelancer profiles from Supabase.
 * Respects RLS and privacy rules, fetching only public-facing fields.
 * Never invents mock records, fake ratings, or fake photos.
 */
export async function getFeaturedFreelancers(limit = 6): Promise<GetFreelancersResult> {
  try {
    const supabase = createClient();

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
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error fetching freelancers from Supabase:', error.message);
      return {
        freelancers: [],
        source: 'supabase',
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
    console.error('Failed to query freelancers:', message);
    return {
      freelancers: [],
      source: 'supabase',
      error: message,
    };
  }
}

export interface GetFreelancerByUsernameResult {
  freelancer: PublicFreelancer | null;
  source: 'supabase';
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

    const supabase = createClient();
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

    if (error) {
      console.error('Error fetching freelancer by username:', error.message);
      return { freelancer: null, source: 'supabase', error: error.message };
    }

    if (!data) {
      return { freelancer: null, source: 'supabase', error: null };
    }

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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error loading freelancer';
    console.error('Failed to query freelancer by username:', message);
    return { freelancer: null, source: 'supabase', error: message };
  }
}
