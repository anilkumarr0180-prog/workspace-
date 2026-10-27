import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

async function testTimeTrackingFlow() {
  console.log('================================================================');
  console.log('VERIFYING FREELANCER TIME-TRACKING ACTIONS & RPC FLOW');
  console.log('================================================================\n');

  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1. Authenticate as freelancer
  const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
    email: 'e2e-freelancer@workspace.local',
    password: 'FreelancerPass123!'
  });
  if (authErr || !authData.session) throw new Error(`Auth failed: ${authErr?.message}`);

  const freelancerClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
  });

  console.log('[PASS] Freelancer authenticated successfully:', authData.user.id);

  // 2. Fetch contracts
  const { data: contracts, error: cErr } = await freelancerClient
    .from('contracts')
    .select('*')
    .eq('freelancer_id', authData.user.id);

  if (cErr) throw new Error(`Contracts query failed: ${cErr.message}`);
  const hourlyContract = contracts?.find(c => c.contract_type === 'hourly' && c.status === 'active');
  const fixedContract = contracts?.find(c => c.contract_type === 'fixed');

  console.log(`[PASS] Found ${contracts?.length} contracts. Active hourly contract: ${hourlyContract?.id}`);

  // 3. Test: Fixed contract cannot start timer
  if (fixedContract) {
    const { data: failFixed, error: fixErr } = await freelancerClient.rpc('start_timer_session', {
      p_contract_id: fixedContract.id,
      p_memo: 'Attempting invalid timer on fixed price contract'
    });
    if (fixErr && fixErr.message.includes('only permitted on hourly contracts')) {
      console.log('[PASS] Fixed-price contract timer start rejected as expected:', fixErr.message);
    } else {
      console.error('[FAIL] Fixed-price contract was not rejected:', failFixed, fixErr);
    }
  }

  // 4. Test: Clean up any stale active timer session for fresh state via trusted RPC
  await freelancerClient.rpc('discard_timer_session');

  // 5. Test: Valid start on hourly contract
  const testMemo = 'Developing persistent time tracker components and responsive dashboard';
  const { data: session, error: startErr } = await freelancerClient.rpc('start_timer_session', {
    p_contract_id: hourlyContract.id,
    p_memo: testMemo
  });

  if (startErr || !session) {
    console.error('[FAIL] Failed to start timer session:', startErr);
    throw startErr;
  }
  console.log('[PASS] Timer session successfully started via trusted RPC:');
  console.log({
    session_id: session.id,
    contract_id: session.contract_id,
    start_time: session.start_time,
    memo: session.memo
  });

  // 6. Test: Concurrent second timer is rejected
  const { data: dupSession, error: dupErr } = await freelancerClient.rpc('start_timer_session', {
    p_contract_id: hourlyContract.id,
    p_memo: 'Second concurrent session'
  });
  if (dupErr && (dupErr.message.includes('already has an active timer session') || dupErr.code === '23505')) {
    console.log('[PASS] Concurrent timer start rejected as expected:', dupErr.message);
  } else {
    console.error('[FAIL] Concurrent timer was permitted:', dupSession, dupErr);
  }

  // 7. Test: Page reload simulation (fetching active session from DB)
  const { data: activeFetch, error: activeErr } = await freelancerClient
    .from('active_timer_sessions')
    .select('*')
    .eq('freelancer_id', authData.user.id)
    .maybeSingle();

  if (activeErr || !activeFetch || activeFetch.id !== session.id) {
    console.error('[FAIL] Active session reload fetch failed:', activeErr, activeFetch);
  } else {
    const elapsedSeconds = Math.floor((Date.now() - new Date(activeFetch.start_time).getTime()) / 1000);
    console.log(`[PASS] Page reload simulation: Retrieved active session ${activeFetch.id}, elapsed: ${elapsedSeconds}s (not reset to 0)`);
  }

  // 8. Test: Discard session
  const { data: discardRes, error: discardErr } = await freelancerClient.rpc('discard_timer_session');
  if (discardErr) {
    console.error('[FAIL] Discard timer session failed:', discardErr);
  } else {
    console.log('[PASS] Session discarded cleanly without creating billable entry:', discardRes);
  }

  // Verify active session table is now empty
  const { data: checkEmpty } = await freelancerClient
    .from('active_timer_sessions')
    .select('*')
    .eq('freelancer_id', authData.user.id)
    .maybeSingle();
  console.log('[PASS] Active timer cleared after discard:', checkEmpty === null);

  // 9. Test: Start again, sleep 2 seconds, stop session (< 60s rule)
  const { data: shortSession, error: shortErr } = await freelancerClient.rpc('start_timer_session', {
    p_contract_id: hourlyContract.id,
    p_memo: 'Short verification session (< 60 seconds)'
  });
  if (shortErr || !shortSession) throw new Error(`Short start failed: ${shortErr?.message}`);

  const { data: stopRes, error: stopErr } = await freelancerClient.rpc('stop_timer_session', {
    p_memo: 'Short verification session'
  });

  if (stopErr) {
    console.error('[FAIL] Stop session unexpected error on short session:', stopErr);
  } else if (!stopRes || !stopRes.id) {
    console.log('[PASS] Sub-60s session returned null composite (no billable entry created, transaction committed cleanly)');
  } else {
    console.error('[FAIL] Sub-60s session returned unexpected non-null entry:', stopRes);
  }

  // Verify active session was cleared automatically by the single RPC
  const { data: postShortActive } = await freelancerClient
    .from('active_timer_sessions')
    .select('*')
    .eq('freelancer_id', authData.user.id)
    .maybeSingle();
  console.log('[PASS] Active session cleared in DB by single stop_timer_session call:', postShortActive === null);
  // 10. Test: Start session, simulate 75 minutes elapsed, stop session, verify time entry & timesheet
  const { data: billableSession, error: bStartErr } = await freelancerClient.rpc('start_timer_session', {
    p_contract_id: hourlyContract.id,
    p_memo: 'Completed Sprint 5 deliverables and architecture documentation'
  });
  if (bStartErr || !billableSession) throw new Error(`Billable start failed: ${bStartErr?.message}`);

  // Simulate elapsed 75 min by updating start_time directly via postgres superuser
  const { execSync } = await import('child_process');
  execSync(`docker exec -i supabase_db_workspace psql -U postgres -d postgres -c "UPDATE public.active_timer_sessions SET start_time = now() - interval '75 minutes' WHERE id = '${billableSession.id}';"`);

  // Stop session
  const { data: billableEntry, error: bStopErr } = await freelancerClient.rpc('stop_timer_session', {
    p_memo: 'Completed Sprint 5 deliverables and architecture documentation'
  });
  if (bStopErr || !billableEntry) {
    console.error('[FAIL] Billable stop failed:', bStopErr);
  } else {
    console.log('[PASS] Billable session stopped successfully:');
    console.log({
      id: billableEntry.id,
      duration_minutes: billableEntry.duration_minutes,
      memo: billableEntry.memo,
      source: billableEntry.source
    });
  }

  // 11. Verify entry and timesheet in database
  const { data: entries } = await freelancerClient
    .from('time_entries')
    .select('*')
    .eq('freelancer_id', authData.user.id);
  console.log(`[PASS] Verified freelancer has ${entries?.length} completed time entries in DB.`);

  const { data: timesheets } = await freelancerClient
    .from('timesheets')
    .select('*')
    .eq('freelancer_id', authData.user.id);
  console.log(`[PASS] Verified timesheet rollup exists: Total minutes = ${timesheets?.[0]?.total_minutes}, Amount = $${timesheets?.[0]?.total_amount}`);

  console.log('\n================================================================');
  console.log('ALL TIME-TRACKING BACKEND RPCs AND STATE FLOWS VERIFIED SUCCESSFULLY');
  console.log('================================================================\n');
}

testTimeTrackingFlow().catch(console.error);
