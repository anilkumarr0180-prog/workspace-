'use server';

import { createClient } from '@/lib/supabase/client';
import { TaxonomyCategory, TaxonomySkill } from '@/lib/types';

interface DbSkillRow {
  id: string;
  name: string;
  slug: string;
}

interface DbCategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  skills: DbSkillRow[] | null;
}

export interface GetCategoriesResult {
  categories: TaxonomyCategory[];
  source: 'supabase';
  error?: string | null;
}

/**
 * Server Action: Fetches real active categories with joined skills from Supabase.
 * Job counts are calculated strictly from real published jobs in the database.
 * If a category has no published jobs, the count is omitted (undefined).
 */
export async function getCategories(): Promise<GetCategoriesResult> {
  try {
    const supabase = await createClient();

    // 1. Query active categories and their relational skills from Supabase
    const { data: dbCategories, error: catError } = await supabase
      .from('categories')
      .select(`
        id,
        name,
        slug,
        icon,
        skills (
          id,
          name,
          slug
        )
      `)
      .order('name');

    if (catError) {
      console.error('Error fetching categories from Supabase:', catError.message);
      return {
        categories: [],
        source: 'supabase',
        error: catError.message,
      };
    }

    if (!dbCategories || dbCategories.length === 0) {
      return {
        categories: [],
        source: 'supabase',
        error: null,
      };
    }

    // 2. Query real published jobs to calculate genuine category job counts
    const { data: dbJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('category_id')
      .eq('status', 'published');

    if (jobsError) {
      console.warn('Could not query published jobs for category counts:', jobsError.message);
    }

    // Build job count map per category_id
    const jobCountMap = new Map<string, number>();
    if (dbJobs && Array.isArray(dbJobs)) {
      for (const job of dbJobs) {
        if (job.category_id) {
          jobCountMap.set(job.category_id, (jobCountMap.get(job.category_id) || 0) + 1);
        }
      }
    }

    // 3. Map database categories and skills
    const categories: TaxonomyCategory[] = (dbCategories as unknown as DbCategoryRow[]).map(
      (cat) => {
        const skills: TaxonomySkill[] = Array.isArray(cat.skills)
          ? cat.skills.map((s) => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
            }))
          : [];

        // Genuine job count from real published jobs; omitted if 0
        const realCount = jobCountMap.get(cat.id);
        const jobCount = realCount && realCount > 0 ? realCount : undefined;

        return {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          icon: cat.icon,
          skills,
          jobCount,
        };
      }
    );

    return {
      categories,
      source: 'supabase',
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error loading categories';
    console.error('Failed to query categories:', errorMsg);
    return {
      categories: [],
      source: 'supabase',
      error: errorMsg,
    };
  }
}
