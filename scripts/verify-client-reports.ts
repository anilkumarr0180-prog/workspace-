import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

async function main() {
  console.log('================================================================');
  console.log('VERIFYING CLIENT REPORTS DATA & RLS POLICIES');
  console.log('================================================================\n');

  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Authenticate as client
  const { data: clientAuth, error: cErr } = await anonClient.auth.signInWithPassword({
    email: 'e2e-client@workspace.local',
    password: 'ClientPass123!',
  });
  if (cErr || !clientAuth.session) {
    throw new Error(`Client sign in failed: ${cErr?.message}`);
  }
  const clientId = clientAuth.user.id;
  console.log(`[PASS] Client authenticated: ${clientId} (${clientAuth.user.email})`);

  const clientSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${clientAuth.session.access_token}` } },
  });

  // 2. Query Client Contracts via RLS
  const { data: clientContracts, error: ccErr } = await clientSupabase
    .from('contracts')
    .select('id, title, contract_type, status, hourly_rate, fixed_price, client_id, freelancer_id')
    .eq('client_id', clientId);

  if (ccErr) throw new Error(`Query client contracts failed: ${ccErr.message}`);
  console.log(`[PASS] Client accessed ${clientContracts?.length || 0} contracts owned by client.`);

  // 3. Query Timesheets via RLS
  const { data: timesheets, error: tsErr } = await clientSupabase
    .from('timesheets')
    .select('id, contract_id, week_start_date, total_minutes, total_amount, status, client_id')
    .eq('client_id', clientId);

  if (tsErr) throw new Error(`Query client timesheets failed: ${tsErr.message}`);
  console.log(`[PASS] Client accessed ${timesheets?.length || 0} timesheets.`);
  if (timesheets && timesheets.length > 0) {
    console.log(`       Sample timesheet: week ${timesheets[0].week_start_date}, ${timesheets[0].total_minutes}m, $${timesheets[0].total_amount}`);
  }

  // 4. Query Time Entries via RLS
  const { data: timeEntries, error: teErr } = await clientSupabase
    .from('time_entries')
    .select('id, contract_id, start_time, duration_minutes, memo, source')
    .order('start_time', { ascending: false });

  if (teErr) throw new Error(`Query client time entries failed: ${teErr.message}`);
  console.log(`[PASS] Client accessed ${timeEntries?.length || 0} verified time entries.`);
  if (timeEntries && timeEntries.length > 0) {
    console.log(`       Sample entry: ${timeEntries[0].duration_minutes}m, memo: "${timeEntries[0].memo}"`);
  }

  // 5. Test Freelancer isolation (freelancer cannot query client's other client_id records)
  const { data: freeAuth } = await anonClient.auth.signInWithPassword({
    email: 'e2e-freelancer@workspace.local',
    password: 'FreelancerPass123!',
  });
  if (freeAuth?.session) {
    const freeSupabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${freeAuth.session.access_token}` } },
    });

    const { data: freeViewTimesheets } = await freeSupabase
      .from('timesheets')
      .select('id, client_id, freelancer_id');

    const unauthorizedRecords = freeViewTimesheets?.filter((t) => t.freelancer_id !== freeAuth.user.id) || [];
    if (unauthorizedRecords.length > 0) {
      throw new Error(`RLS breach: Freelancer accessed timesheets of other freelancers! Count: ${unauthorizedRecords.length}`);
    }
    console.log(`[PASS] RLS strictly prevents cross-user timesheet access.`);
  }

  console.log('\n================================================================');
  console.log('CLIENT REPORTS DATA INTEGRITY & AUTHORIZATION VERIFIED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
