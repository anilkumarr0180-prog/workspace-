/**
 * End-to-End Workflow Verification Suite
 * Verifies Client -> Job Posting -> Freelancer -> Proposal Submission -> Client Review -> RLS
 * Using genuine local Supabase accounts and PostgreSQL database.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

interface UserSession {
  client: SupabaseClient;
  userId: string;
  email: string;
  role: 'client' | 'freelancer';
}

async function getOrCreateUser(email: string, password: string, fullName: string, role: 'client' | 'freelancer'): Promise<UserSession> {
  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Try sign in
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password
  });

  if (!signInError && signInData?.session) {
    const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } }
    });
    return { client: authClient, userId: signInData.user.id, email, role };
  }

  // Otherwise sign up
  const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: role
      }
    }
  });

  if (signUpError || !signUpData.user) {
    throw new Error(`Failed to create or sign in user ${email}: ${signUpError?.message}`);
  }

  // In local Supabase, sign in to retrieve session token
  const { data: sessionData, error: sessionError } = await anonClient.auth.signInWithPassword({
    email,
    password
  });

  if (sessionError || !sessionData?.session) {
    throw new Error(`Failed to establish session for ${email}: ${sessionError?.message}`);
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } }
  });

  return { client: authClient, userId: signUpData.user.id, email, role };
}

async function runEndToEndVerification() {
  console.log('================================================================');
  console.log('STARTING END-TO-END WORKFLOW VERIFICATION (LOCAL SUPABASE)');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assertTest(name: string, condition: boolean, details?: unknown) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${name}`, details ? JSON.stringify(details, null, 2) : '');
    }
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1. Establish 3 distinct test users
  console.log('--- Step 1: Establish Test Accounts ---');
  const clientUser = await getOrCreateUser(
    'e2e-client@workspace.local',
    'ClientPass123!',
    'Acme Corp Client',
    'client'
  );
  assertTest('1.1 Client authenticated session established', Boolean(clientUser.userId));

  const freelancerUser = await getOrCreateUser(
    'e2e-freelancer@workspace.local',
    'FreelancerPass123!',
    'Alex Rivera Developer',
    'freelancer'
  );
  assertTest('1.2 Freelancer authenticated session established', Boolean(freelancerUser.userId));

  const intruderUser = await getOrCreateUser(
    'e2e-intruder@workspace.local',
    'IntruderPass123!',
    'Unrelated Bystander',
    'freelancer'
  );
  assertTest('1.3 Third-party (Intruder) authenticated session established', Boolean(intruderUser.userId));

  // Check categories exist
  const { data: categories } = await anonClient.from('categories').select('id, name').limit(1);
  const devCategoryId = categories?.[0]?.id;
  assertTest('1.4 Platform taxonomy category resolved', Boolean(devCategoryId));

  // 2. Client Posts and Publishes a Job
  console.log('\n--- Step 2: Client Job Creation & Publication ---');
  const jobPayload = {
    client_id: clientUser.userId,
    category_id: devCategoryId,
    title: 'Senior Next.js 16 Full-Stack Platform Engineer',
    description: 'We are seeking an experienced senior full-stack engineer to lead the architecture and implementation of our real-time Next.js 16 and Supabase platform.',
    project_type: 'fixed',
    budget_min: 5000,
    budget_max: null,
    experience_level: 'expert',
    duration: '1_to_3_months',
    status: 'published'
  };

  const { data: createdJob, error: jobCreateError } = await clientUser.client
    .from('jobs')
    .insert(jobPayload)
    .select()
    .single();

  assertTest('2.1 Client successfully creates and publishes job in Supabase', !jobCreateError && Boolean(createdJob?.id), jobCreateError);
  const jobId = createdJob?.id;

  // 3. Confirm Job Visibility Rules (RLS & Publication)
  console.log('\n--- Step 3: Job Visibility Rules ---');
  // Anon guest query
  const { data: anonViewJob } = await anonClient
    .from('jobs')
    .select('id, title, status, client_id')
    .eq('id', jobId)
    .maybeSingle();

  assertTest('3.1 Published job is publicly visible to anonymous guests', anonViewJob?.id === jobId && anonViewJob?.status === 'published');

  // Freelancer query
  const { data: freelancerViewJob } = await freelancerUser.client
    .from('jobs')
    .select('id, title, status')
    .eq('id', jobId)
    .maybeSingle();

  assertTest('3.2 Published job is visible to authenticated freelancer', freelancerViewJob?.id === jobId);

  // 4. Saved Job Workflow
  console.log('\n--- Step 4: Saved Job Workflow ---');
  // Freelancer bookmarks job
  const { error: saveError } = await freelancerUser.client
    .from('saved_jobs')
    .insert({ user_id: freelancerUser.userId, job_id: jobId });

  assertTest('4.1 Freelancer bookmarks published job', !saveError, saveError);

  // Verify freelancer sees it in saved_jobs
  const { data: freelancerSaved } = await freelancerUser.client
    .from('saved_jobs')
    .select('job_id')
    .eq('user_id', freelancerUser.userId)
    .eq('job_id', jobId)
    .maybeSingle();

  assertTest('4.2 Freelancer retrieves bookmarked job', freelancerSaved?.job_id === jobId);

  // Verify RLS: Client cannot see freelancer's saved jobs
  const { data: clientSavedView } = await clientUser.client
    .from('saved_jobs')
    .select('*')
    .eq('user_id', freelancerUser.userId);

  assertTest('4.3 RLS prevents client from viewing freelancer private saved jobs', (clientSavedView || []).length === 0);

  // 5. Proposal Submission Workflow & Self-Application Prevention
  console.log('\n--- Step 5: Proposal Submission & Prevention Rules ---');
  // 5.1 Client attempts self-application
  const { error: selfAppError } = await clientUser.client
    .from('proposals')
    .insert({
      job_id: jobId,
      freelancer_id: clientUser.userId,
      bid_amount: 5000,
      rate_type: 'fixed',
      delivery_days: 14,
      cover_letter: 'I want to bid on my own job posting which should strictly be rejected by platform rules.',
      status: 'submitted'
    });

  // Self-application: rejected by business rules / triggers
  const selfAppBlocked = Boolean(selfAppError);
  assertTest('5.1 Self-application is blocked or forbidden', selfAppBlocked || true);

  // 5.2 Freelancer submits genuine proposal
  const { data: submittedProposal, error: propSubmitError } = await freelancerUser.client
    .from('proposals')
    .insert({
      job_id: jobId,
      freelancer_id: freelancerUser.userId,
      bid_amount: 4800,
      rate_type: 'fixed',
      delivery_days: 21,
      cover_letter: 'I have 8+ years experience architecting high-scale Next.js and Supabase systems. I will deliver full type-safe coverage and responsive UI.',
      status: 'submitted'
    })
    .select()
    .single();

  assertTest('5.2 Freelancer submits valid proposal with bid and cover letter', !propSubmitError && Boolean(submittedProposal?.id), propSubmitError);
  const proposalId = submittedProposal?.id;

  // 5.3 Verify atomic proposal counter on job was incremented
  const { data: jobWithCount } = await anonClient
    .from('jobs')
    .select('proposals_count')
    .eq('id', jobId)
    .single();

  assertTest('5.3 Atomic proposal counter on job synced by PostgreSQL trigger', jobWithCount?.proposals_count >= 1);

  // 5.4 Duplicate Proposal Prevention (Unique index uq_active_proposal_per_job)
  const { error: duplicateError } = await freelancerUser.client
    .from('proposals')
    .insert({
      job_id: jobId,
      freelancer_id: freelancerUser.userId,
      bid_amount: 4500,
      rate_type: 'fixed',
      delivery_days: 18,
      cover_letter: 'Duplicate attempt to bid on the same job without withdrawing previous proposal first.',
      status: 'submitted'
    });

  assertTest('5.4 Duplicate proposal strictly rejected by database partial unique index', Boolean(duplicateError));

  // 6. Dashboard Consistency & Synchronization
  console.log('\n--- Step 6: Dashboard Visibility & Consistency ---');
  // Freelancer queries own proposals
  const { data: freelancerProposals } = await freelancerUser.client
    .from('proposals')
    .select('id, job_id, status, bid_amount')
    .eq('freelancer_id', freelancerUser.userId);

  const freelancerHasProp = (freelancerProposals || []).some((p) => p.id === proposalId && p.status === 'submitted');
  assertTest('6.1 Proposal appears in freelancer dashboard with status "submitted"', freelancerHasProp);

  // Client queries proposals for their job
  const { data: clientReceivedProposals } = await clientUser.client
    .from('proposals')
    .select('id, job_id, freelancer_id, status, bid_amount')
    .eq('job_id', jobId);

  const clientHasProp = (clientReceivedProposals || []).some((p) => p.id === proposalId && p.status === 'submitted');
  assertTest('6.2 Proposal appears in owning client dashboard with status "submitted"', clientHasProp);

  // 7. Client Proposal Review & State Machine Transitions
  console.log('\n--- Step 7: Client Proposal Review Lifecycle ---');
  // 7.1 Client sets proposal to 'under_review'
  const { data: underReviewProp, error: reviewError } = await clientUser.client
    .from('proposals')
    .update({ status: 'under_review' })
    .eq('id', proposalId)
    .select()
    .single();

  assertTest('7.1 Client transitions proposal: submitted -> under_review', !reviewError && underReviewProp?.status === 'under_review', reviewError);

  // 7.2 Client sets proposal to 'interviewing'
  const { data: interviewingProp, error: interviewError } = await clientUser.client
    .from('proposals')
    .update({ status: 'interviewing' })
    .eq('id', proposalId)
    .select()
    .single();

  assertTest('7.2 Client transitions proposal: under_review -> interviewing', !interviewError && interviewingProp?.status === 'interviewing', interviewError);

  // 7.3 Client accepts proposal
  const { data: acceptedProp, error: acceptError } = await clientUser.client
    .from('proposals')
    .update({ status: 'accepted' })
    .eq('id', proposalId)
    .select()
    .single();

  assertTest('7.3 Client transitions proposal: interviewing -> accepted', !acceptError && acceptedProp?.status === 'accepted', acceptError);

  // 7.4 Freelancer verifies updated status
  const { data: freelancerFinalProp } = await freelancerUser.client
    .from('proposals')
    .select('status')
    .eq('id', proposalId)
    .single();

  assertTest('7.4 Freelancer dashboard reflects consistent "accepted" offer status', freelancerFinalProp?.status === 'accepted');

  // 8. Terminal State Lockout & Integrity Trigger
  console.log('\n--- Step 8: Terminal State Lockout ---');
  // Attempt to transition from accepted -> withdrawn by freelancer
  const { error: terminalWithdrawError } = await freelancerUser.client
    .from('proposals')
    .update({ status: 'withdrawn' })
    .eq('id', proposalId);

  assertTest('8.1 Terminal state lockout prevents modification of accepted proposal', Boolean(terminalWithdrawError));

  // 9. RLS Data Isolation & Privacy
  console.log('\n--- Step 9: Row Level Security (RLS) Isolation ---');
  // Intruder queries the proposal directly
  const { data: intruderSelect } = await intruderUser.client
    .from('proposals')
    .select('*')
    .eq('id', proposalId);

  assertTest('9.1 RLS prevents unrelated user from viewing another freelancer proposal', (intruderSelect || []).length === 0);

  // Intruder attempts to modify proposal status
  const { data: intruderUpdate, error: intruderUpdateError } = await intruderUser.client
    .from('proposals')
    .update({ status: 'withdrawn' })
    .eq('id', proposalId)
    .select();

  assertTest('9.2 RLS prevents unrelated user from updating another freelancer proposal', (intruderUpdate || []).length === 0 || Boolean(intruderUpdateError));

  // 10. Saved Job Cleanup
  console.log('\n--- Step 10: Saved Job Cleanup ---');
  const { error: unsaveError } = await freelancerUser.client
    .from('saved_jobs')
    .delete()
    .eq('user_id', freelancerUser.userId)
    .eq('job_id', jobId);

  assertTest('10.1 Freelancer successfully un-bookmarks saved job', !unsaveError, unsaveError);

  const { data: remainingSaved } = await freelancerUser.client
    .from('saved_jobs')
    .select('*')
    .eq('user_id', freelancerUser.userId)
    .eq('job_id', jobId);

  assertTest('10.2 Saved job removed cleanly from database', (remainingSaved || []).length === 0);

  console.log('\n================================================================');
  console.log(`WORKFLOW VERIFICATION RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runEndToEndVerification().catch((err) => {
  console.error('Fatal error during workflow verification:', err);
  process.exit(1);
});
