import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

async function main() {
  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Sign in client
  const { data: clientAuth, error: cErr } = await anonClient.auth.signInWithPassword({
    email: 'e2e-client@workspace.local',
    password: 'ClientPass123!'
  });
  if (cErr || !clientAuth.session) throw new Error(`Client sign in failed: ${cErr?.message}`);

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${clientAuth.session.access_token}` } }
  });

  // Sign in freelancer
  const { data: freeAuth, error: fErr } = await anonClient.auth.signInWithPassword({
    email: 'e2e-freelancer@workspace.local',
    password: 'FreelancerPass123!'
  });
  if (fErr || !freeAuth.session) throw new Error(`Freelancer sign in failed: ${fErr?.message}`);

  const freelancer = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${freeAuth.session.access_token}` } }
  });

  const { data: categories } = await anonClient.from('categories').select('id').limit(1);
  const categoryId = categories?.[0]?.id;

  // 1. Client creates published hourly job
  const { data: job, error: jobErr } = await client.from('jobs').insert({
    client_id: clientAuth.user.id,
    title: 'Cloud Infrastructure & SRE Consulting',
    description: 'Ongoing cloud platform optimization, reliability engineering, and Terraform automation on Kubernetes clusters.',
    category_id: categoryId,
    project_type: 'hourly',
    budget_min: 75.0,
    budget_max: 95.0,
    duration: '3_to_6_months',
    status: 'published',
    experience_level: 'expert'
  }).select().single();

  if (jobErr || !job) throw new Error(`Job creation failed: ${jobErr?.message}`);
  console.log('Created hourly job:', job.id);

  // 2. Freelancer submits hourly proposal
  const { data: proposal, error: propErr } = await freelancer.from('proposals').insert({
    job_id: job.id,
    freelancer_id: freeAuth.user.id,
    rate_type: 'hourly',
    bid_amount: 85.0,
    cover_letter: 'Senior Cloud SRE with 10+ years optimizing AWS and Kubernetes infrastructure. Ready to assist on hourly terms with complete production automation experience.',
    status: 'submitted'
  }).select().single();

  if (propErr || !proposal) throw new Error(`Proposal submission failed: ${propErr?.message}`);
  console.log('Created hourly proposal:', proposal.id);

  // 3. Client transitions proposal through review -> interviewing -> accepted
  await client.from('proposals').update({ status: 'under_review' }).eq('id', proposal.id);
  await client.from('proposals').update({ status: 'interviewing' }).eq('id', proposal.id);
  const { data: acceptedProposal, error: acceptErr } = await client.from('proposals').update({
    status: 'accepted'
  }).eq('id', proposal.id).select().single();

  if (acceptErr || !acceptedProposal) throw new Error(`Proposal accept failed: ${acceptErr?.message}`);
  console.log('Proposal accepted. Status:', acceptedProposal.status);

  // 4. Verify contract created
  const { data: contract, error: contractErr } = await freelancer.from('contracts').select('*').eq('proposal_id', proposal.id).single();
  if (contractErr || !contract) throw new Error(`Contract retrieval failed: ${contractErr?.message}`);

  console.log('Successfully created hourly contract:');
  console.log({
    id: contract.id,
    title: contract.title,
    contract_type: contract.contract_type,
    hourly_rate: contract.hourly_rate,
    weekly_hour_limit: contract.weekly_hour_limit,
    status: contract.status
  });
}

main().catch(console.error);
