import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';

export async function GET() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  let adminClientWorks = false;
  let adminError: string | null = null;
  let totalJobsInDb = 0;
  let totalProposalsInDb = 0;

  try {
    const admin = getAdminSupabaseClient();
    adminClientWorks = true;

    const { count: jobCount, error: jErr } = await admin
      .from('jobs')
      .select('*', { count: 'exact', head: true });
    if (!jErr) totalJobsInDb = jobCount || 0;

    const { count: propCount, error: pErr } = await admin
      .from('proposals')
      .select('*', { count: 'exact', head: true });
    if (!pErr) totalProposalsInDb = propCount || 0;
  } catch (err: unknown) {
    adminError = err instanceof Error ? err.message : 'Admin client failed';
  }

  // Session user check
  let currentUser: { id: string; email?: string } | null = null;
  let userJobsCount = 0;
  let userProposalsCount = 0;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      currentUser = { id: user.id, email: user.email };

      const { count: uJobs } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', user.id);
      userJobsCount = uJobs || 0;

      const { count: uProps } = await supabase
        .from('proposals')
        .select('*', { count: 'exact', head: true })
        .eq('freelancer_id', user.id);
      userProposalsCount = uProps || 0;
    }
  } catch {
    // Session check failed
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      hasSupabaseUrl: hasUrl,
      hasAnonKey: hasAnonKey,
      hasServiceRoleKey: hasServiceRoleKey,
      adminClientWorks,
      adminError,
    },
    databaseSummary: {
      totalJobs: totalJobsInDb,
      totalProposals: totalProposalsInDb,
    },
    currentUser: currentUser ? {
      ...currentUser,
      jobsPostedCount: userJobsCount,
      proposalsSubmittedCount: userProposalsCount,
    } : null,
    diagnosis: !hasServiceRoleKey
      ? 'CRITICAL WARNING: SUPABASE_SERVICE_ROLE_KEY is missing in environment variables. Server actions cannot bypass RLS to create notifications or read client proposals.'
      : 'All core environment variables configured.',
  });
}

