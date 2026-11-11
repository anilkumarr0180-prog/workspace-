import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { getAdminSupabaseClient } from '../lib/supabase/admin';

// Load .env.local manually
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.error('Error reading .env.local:', e);
}

function runSql(sql: string): string {
  const res = spawnSync('docker', [
    'exec', '-i', 'supabase_db_workspace',
    'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-t', '-A', '-q'
  ], {
    input: sql,
    encoding: 'utf-8'
  });
  if (res.error) throw res.error;
  if (res.status !== 0 || (res.stderr && res.stderr.includes('ERROR:'))) {
    const errMsg = (res.stderr || '') + '\n' + (res.stdout || '');
    throw new Error(errMsg.trim() || `psql process exited with ${res.status}`);
  }
  return res.stdout.trim();
}

async function runStep2D3Verification() {
  console.log('========================================================================');
  console.log('STEP 2D.3: CONCURRENCY & LIFECYCLE HARDENING TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${title}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title}${details ? ` -> ${details}` : ''}`);
    }
  }

  const supabase = getAdminSupabaseClient();
  const runId = Date.now().toString().slice(-6);
  const clientEmail = `client-2d3-${runId}@workspace-test.local`;
  const freelancerEmail = `dev-2d3-${runId}@workspace-test.local`;

  let clientId = '';
  let freelancerId = '';
  let jobId = '';
  let proposalId = '';
  let contractId = '';
  let milestoneId = '';
  let conv1Id = '';
  let conv2Id = '';
  let simContractId = '';
  let simMilestoneId = '';

  try {
    // -------------------------------------------------------------------
    // Setup Isolated Actors
    // -------------------------------------------------------------------
    console.log('--- Setting Up Isolated Test Actors ---');
    const { data: cUser } = await supabase.auth.admin.createUser({
      email: clientEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Client 2D3 ${runId}` },
    });
    clientId = cUser!.user!.id;
    await supabase.from('profiles').update({ full_name: `Acme 2D3 ${runId}`, active_mode: 'client', can_hire: true }).eq('id', clientId);

    const { data: fUser } = await supabase.auth.admin.createUser({
      email: freelancerEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Dev 2D3 ${runId}` },
    });
    freelancerId = fUser!.user!.id;
    await supabase.from('profiles').update({ full_name: `Dev 2D3 ${runId}`, active_mode: 'freelancer', can_work: true }).eq('id', freelancerId);

    assert(Boolean(clientId && freelancerId), 'Created isolated client and freelancer test actors');

    // Create Job, Proposal, Contract
    const { data: cat } = await supabase.from('categories').select('id').limit(1).single();
    const { data: job } = await supabase.from('jobs').insert({
      client_id: clientId,
      category_id: cat?.id,
      title: `Hardening Architect ${runId}`,
      description: 'Distributed concurrency hardening with PostgreSQL and Next.js.',
      project_type: 'fixed',
      budget_min: 5000,
      budget_max: 5000,
      duration: '1_to_3_months',
      experience_level: 'expert',
      status: 'published',
    }).select('id').single();
    jobId = job!.id;

    const { data: prop } = await supabase.from('proposals').insert({
      job_id: jobId,
      freelancer_id: freelancerId,
      bid_amount: 5000,
      rate_type: 'fixed',
      delivery_days: 14,
      cover_letter: 'Deep expertise in advisory locks and outbox idempotency.',
      status: 'submitted',
    }).select('id').single();
    proposalId = prop!.id;

    runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      UPDATE public.proposals SET status = 'under_review' WHERE id = '${proposalId}';
      UPDATE public.proposals SET status = 'accepted' WHERE id = '${proposalId}';
      COMMIT;
    `);

    const { data: contract } = await supabase.from('contracts').select('id').eq('proposal_id', proposalId).single();
    contractId = contract!.id;

    const { data: ms } = await supabase.from('contract_milestones').select('id').eq('contract_id', contractId).single();
    milestoneId = ms!.id;

    // Create primary conversation for messaging tests
    conv1Id = runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      SELECT public.create_or_get_contract_conversation('${contractId}');
      COMMIT;
    `).split('\n').filter(Boolean).pop()?.trim() || '';

    assert(Boolean(conv1Id), 'Initialized contract conversation for lifecycle testing');

    // Set recipient client offline
    const pastTime = new Date(Date.now() - 3600000).toISOString();
    await supabase.from('conversation_participants').update({ last_read_at: pastTime }).eq('conversation_id', conv1Id).eq('user_id', clientId);

    // -------------------------------------------------------------------
    // 1. Message Arriving While Worker Holds Lock (BUG-CONC-01)
    // -------------------------------------------------------------------
    console.log('\n--- 1. Message Arriving While O1 is Processing ---');

    // Message 1 -> queues O1
    await supabase.from('messages').insert({
      conversation_id: conv1Id,
      sender_id: freelancerId,
      content: 'Message 1 for O1',
      message_type: 'text',
    }).select('id').single();

    const { data: win1 } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(Boolean(win1?.outbox_id), 'Message 1 created Window W1 and queued outbox record O1');
    const o1Id = win1!.outbox_id;
    const w1Id = win1!.window_id;

    // Advance O1 next_attempt_at and claim it via worker
    await supabase.from('email_outbox').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('id', o1Id);
    const { data: claimed } = await supabase.rpc('claim_outbox_emails', { p_batch_size: 1, p_worker_id: 'test-worker-1' });
    const claimedRecord = (claimed || [])[0];
    assert(claimedRecord?.id === o1Id && claimedRecord?.status === 'processing', 'Worker claimed O1 into status="processing"');

    // Message 2 arrives while O1 is in 'processing'
    await supabase.from('messages').insert({
      conversation_id: conv1Id,
      sender_id: freelancerId,
      content: 'Message 2 arrives while O1 is processing',
      message_type: 'text',
    });

    // Check O1 payload: MUST NOT HAVE MUTATED
    const { data: o1AfterM2 } = await supabase.from('email_outbox').select('status, payload').eq('id', o1Id).single();
    assert(o1AfterM2?.status === 'processing', 'O1 status remains "processing"');
    assert(o1AfterM2?.payload?.unreadCount === 1, 'O1 payload was NOT mutated while in flight (Strict In-Flight Safety)');

    // Check Window state: MUST HAVE CREATED NEW CYCLE W2 with O2
    const { data: win2 } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(win2?.window_id !== w1Id, 'New notification cycle window_id generated for M2');
    assert(win2?.outbox_id !== o1Id, 'New outbox record O2 linked to coordination window');
    const o2Id = win2!.outbox_id;

    const { data: o2Record } = await supabase.from('email_outbox').select('*').eq('id', o2Id).single();
    assert(o2Record?.status === 'pending' && o2Record?.payload?.unreadCount === 1, 'O2 created in "pending" status representing Message 2 (Zero Message Loss)');

    // -------------------------------------------------------------------
    // 2. Prevent Stale Worker Completion
    // -------------------------------------------------------------------
    console.log('\n--- 2. Stale Worker Completion Prevention ---');

    // Worker completes O1
    await supabase.rpc('mark_outbox_email_sent', {
      p_id: o1Id,
      p_provider: 'mailpit_smtp',
      p_provider_message_id: 'msg-o1-done',
    });

    const { data: o1Final } = await supabase.from('email_outbox').select('status').eq('id', o1Id).single();
    assert(o1Final?.status === 'sent', 'O1 successfully marked as "sent"');

    // Verify Window state: Completing O1 MUST NOT mark W2/O2 as dispatched!
    const { data: winAfterO1Sent } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(winAfterO1Sent?.status === 'active', 'Window remains "active" (Completing O1 cannot mark O2 window as dispatched)');
    assert(winAfterO1Sent?.outbox_id === o2Id, 'Window outbox_id still points to O2');

    // -------------------------------------------------------------------
    // 3. Completing O2 Updates Its Own Window
    // -------------------------------------------------------------------
    console.log('\n--- 3. Completing O2 Updates Its Own Window ---');

    await supabase.rpc('mark_outbox_email_sent', {
      p_id: o2Id,
      p_provider: 'mailpit_smtp',
      p_provider_message_id: 'msg-o2-done',
    });

    const { data: winAfterO2Sent } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(winAfterO2Sent?.status === 'dispatched', 'Window transitioned to "dispatched" upon O2 completion');

    // -------------------------------------------------------------------
    // 4. Message Arriving After Dispatched Window
    // -------------------------------------------------------------------
    console.log('\n--- 4. Message Arriving After Dispatched Window ---');

    await supabase.from('messages').insert({
      conversation_id: conv1Id,
      sender_id: freelancerId,
      content: 'Message 3 arrives after dispatched window',
      message_type: 'text',
    });

    const { data: winAfterM3 } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(winAfterM3?.status === 'active' && winAfterM3?.outbox_id !== o2Id, 'Fresh active cycle started after previous window completed');

    // -------------------------------------------------------------------
    // 5. Message Arriving Immediately After Suppression (BUG-IDEM-01 Fix)
    // -------------------------------------------------------------------
    console.log('\n--- 5. Message Arriving Immediately After Suppression ---');

    // Recipient marks conversation read
    runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      SELECT public.mark_conversation_read('${conv1Id}');
      COMMIT;
    `);

    const { data: winSupp } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();
    assert(winSupp?.status === 'suppressed', 'Window transitioned to "suppressed" upon mark_conversation_read');

    // Reset last_read_at to past time so recipient is considered offline again
    await supabase.from('conversation_participants').update({ last_read_at: pastTime }).eq('conversation_id', conv1Id).eq('user_id', clientId);

    // Immediately insert new message (< 50ms)
    await supabase.from('messages').insert({
      conversation_id: conv1Id,
      sender_id: freelancerId,
      content: 'Message arrives immediately post-suppression',
      message_type: 'text',
    });

    const { data: winPostSupp } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv1Id)
      .eq('recipient_user_id', clientId)
      .single();

    assert(winPostSupp?.status === 'active' && winPostSupp?.window_id !== winSupp?.window_id, 'Fresh cycle created post-suppression with new window_id');

    const { data: outboxPostSupp } = await supabase.from('email_outbox').select('status').eq('id', winPostSupp!.outbox_id).single();
    assert(outboxPostSupp?.status === 'pending', 'New outbox record created in "pending" status (No collision with suppressed record)');

    // -------------------------------------------------------------------
    // 6. Five Concurrent Initial Messages (BUG-CONC-02 Advisory Lock Fix)
    // -------------------------------------------------------------------
    console.log('\n--- 6. Five Concurrent Initial Messages (Advisory Lock Test) ---');

    // Create a brand new job & contract conversation
    const { data: job2, error: job2Err } = await supabase.from('jobs').insert({
      client_id: clientId,
      category_id: cat?.id,
      title: `Concurrent Job ${runId}`,
      description: 'Concurrency stress testing with distributed transactions and advisory locks.',
      project_type: 'fixed',
      budget_min: 4000,
      budget_max: 4000,
      duration: '1_to_3_months',
      experience_level: 'expert',
      status: 'published',
    }).select('id').single();
    if (job2Err) console.error('job2Err:', job2Err);

    const { data: prop2, error: prop2Err } = await supabase.from('proposals').insert({
      job_id: job2!.id,
      freelancer_id: freelancerId,
      bid_amount: 4000,
      rate_type: 'fixed',
      delivery_days: 7,
      cover_letter: 'I have extensive experience with distributed transactions, advisory locks, and concurrent queues.',
      status: 'submitted',
    }).select('id').single();
    if (prop2Err) console.error('prop2Err:', prop2Err);

    runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      UPDATE public.proposals SET status = 'under_review' WHERE id = '${prop2!.id}';
      UPDATE public.proposals SET status = 'accepted' WHERE id = '${prop2!.id}';
      COMMIT;
    `);

    const { data: c2 } = await supabase.from('contracts').select('id').eq('proposal_id', prop2!.id).single();
    conv2Id = runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      SELECT public.create_or_get_contract_conversation('${c2!.id}');
      COMMIT;
    `).split('\n').filter(Boolean).pop()?.trim() || '';

    await supabase.from('conversation_participants').update({ last_read_at: pastTime }).eq('conversation_id', conv2Id).eq('user_id', clientId);

    // Fire 5 concurrent message inserts simultaneously
    const burstPromises = [1, 2, 3, 4, 5].map(i =>
      supabase.from('messages').insert({
        conversation_id: conv2Id,
        sender_id: freelancerId,
        content: `Concurrent burst message #${i}`,
        message_type: 'text',
      })
    );
    await Promise.all(burstPromises);

    // Verify window state: exactly 1 window with unread_count = 5
    const { data: burstWindows } = await supabase.from('message_notification_windows')
      .select('*')
      .eq('conversation_id', conv2Id)
      .eq('recipient_user_id', clientId);

    assert(burstWindows?.length === 1, 'Exactly 1 notification window exists for conversation');
    assert(burstWindows?.[0]?.unread_count === 5, `Unread count aggregated accurately to 5 (Got: ${burstWindows?.[0]?.unread_count})`);

    const { data: burstOutboxes } = await supabase.from('email_outbox')
      .select('*')
      .eq('related_entity_id', conv2Id)
      .eq('recipient_user_id', clientId)
      .eq('status', 'pending');

    assert(burstOutboxes?.length === 1, 'Exactly 1 outbox record queued for concurrent burst (Zero duplicate emails)');
    assert(burstOutboxes?.[0]?.payload?.unreadCount === 5, 'Outbox payload accurately reflects unreadCount = 5');

    // -------------------------------------------------------------------
    // 7. Quiet Window Preservation on Follow-up Messages
    // -------------------------------------------------------------------
    console.log('\n--- 7. Quiet Window Deadline Preservation ---');

    const deadlineBefore = new Date(burstOutboxes![0].next_attempt_at).getTime();

    // Send message 6
    await supabase.from('messages').insert({
      conversation_id: conv2Id,
      sender_id: freelancerId,
      content: 'Message 6 in active window',
      message_type: 'text',
    });

    const { data: updatedOutbox } = await supabase.from('email_outbox').select('*').eq('id', burstOutboxes![0].id).single();
    const deadlineAfter = new Date(updatedOutbox!.next_attempt_at).getTime();

    assert(updatedOutbox?.payload?.unreadCount === 6, 'Payload unreadCount incremented to 6');
    assert(deadlineBefore === deadlineAfter, 'next_attempt_at was NOT postponed (Quiet deadline strictly bounded)');

    // -------------------------------------------------------------------
    // 8. Cancellation Stored Procedure & Claims Exclusion (BUG-SEC-01)
    // -------------------------------------------------------------------
    console.log('\n--- 8. Cancellation Stored Procedure & Immunity ---');

    const { error: cancelErr } = await supabase.rpc('mark_outbox_email_cancelled', {
      p_id: updatedOutbox!.id,
      p_reason: 'Testing cancellation procedure',
    });
    assert(!cancelErr, 'mark_outbox_email_cancelled executed successfully');

    const { data: cancelledRow } = await supabase.from('email_outbox').select('status, last_error').eq('id', updatedOutbox!.id).single();
    assert(cancelledRow?.status === 'cancelled' && cancelledRow?.last_error === 'Testing cancellation procedure', 'Record transitioned to status="cancelled" with reason');

    const { data: claimedAfterCancel } = await supabase.rpc('claim_outbox_emails', { p_batch_size: 50, p_worker_id: 'cancel-test-worker' });
    const claimedAfterIds = ((claimedAfterCancel || []) as Array<{ id: string }>).map(r => r.id);
    assert(!claimedAfterIds.includes(updatedOutbox!.id), 'claim_outbox_emails strictly ignores cancelled records');

    // -------------------------------------------------------------------
    // 9. Live Razorpay Funding Parity & In-App Notification (BUG-PAY-01 & BUG-NOTIF-01)
    // -------------------------------------------------------------------
    console.log('\n--- 9. Live Razorpay Funding Parity & Webhook Deduplication ---');

    // Record live payment attempt for milestone 1 (requires authenticated client)
    const orderId = `order_live_${runId}`;
    const paymentId = `pay_live_${runId}`;

    runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      SELECT public.record_payment_attempt(
        '${milestoneId}',
        '${orderId}',
        5000,
        500000,
        'USD',
        '{"source": "live_test_fixture"}'::jsonb,
        'test'
      );
      COMMIT;
    `);

    // Execute reconcile_webhook_payment (live webhook funding)
    const eventId = `evt_live_${runId}`;
    const { data: reconResult, error: reconErr } = await supabase.rpc('reconcile_webhook_payment', {
      p_milestone_id: milestoneId,
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_amount_subunits: 500000,
      p_currency: 'USD',
      p_payment_metadata: { provider: 'razorpay', environment: 'test', event: 'payment.captured' },
      p_event_id: eventId,
      p_payload_hash: `hash_${runId}`,
    });
    if (reconErr) console.error('reconErr:', reconErr, 'reconResult:', reconResult);

    assert(!reconErr && reconResult?.success === true, 'reconcile_webhook_payment succeeded');

    // Verify payment attempt is captured
    const { data: attemptRow } = await supabase.from('payment_attempts').select('status').eq('razorpay_order_id', orderId).single();
    assert(attemptRow?.status === 'captured', 'Payment attempt authoritatively marked status="captured"');

    // Verify milestone funded email outbox record has isSimulated = false
    const { data: fundedOutbox } = await supabase.from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:milestone_funded:${milestoneId}`)
      .maybeSingle();

    assert(Boolean(fundedOutbox), 'Milestone funded email outbox record created');
    assert(fundedOutbox?.payload?.isSimulated === false, 'isSimulated is strictly FALSE for captured Razorpay payment (BUG-PAY-01 Fixed)');

    // Verify in-app notification in public.notifications (BUG-NOTIF-01 Fixed)
    const { data: inAppNotif } = await supabase.from('notifications')
      .select('*')
      .eq('idempotency_key', `notif:milestone_funded:${milestoneId}`)
      .maybeSingle();

    assert(Boolean(inAppNotif), 'In-app notification atomically inserted into public.notifications by DB transaction (BUG-NOTIF-01 Fixed)');
    assert(inAppNotif?.user_id === freelancerId, 'Notification recipient is freelancer');
    assert(inAppNotif?.message?.includes('via Razorpay'), 'Notification message specifies payment was via Razorpay');

    // Test duplicate webhook reconciliation (Deduplication Check)
    const { data: dupResult } = await supabase.rpc('reconcile_webhook_payment', {
      p_milestone_id: milestoneId,
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_amount_subunits: 500000,
      p_currency: 'USD',
      p_payment_metadata: { provider: 'razorpay', environment: 'test', event: 'payment.captured' },
      p_event_id: eventId,
      p_payload_hash: `hash_${runId}`,
    });

    assert(dupResult?.idempotent === true, 'Duplicate webhook call returned idempotent: true');

    const notifCount = (await supabase.from('notifications').select('id', { count: 'exact' }).eq('idempotency_key', `notif:milestone_funded:${milestoneId}`)).count;
    assert(notifCount === 1, 'Duplicate webhook did NOT create duplicate in-app notification');

    const emailCount = (await supabase.from('email_outbox').select('id', { count: 'exact' }).eq('idempotency_key', `email:milestone_funded:${milestoneId}`)).count;
    assert(emailCount === 1, 'Duplicate webhook did NOT create duplicate email outbox row');

    // -------------------------------------------------------------------
    // 10. Simulated Funding Parity Check
    // -------------------------------------------------------------------
    console.log('\n--- 10. Simulated Funding Parity Check ---');

    // Create a separate contract to test simulated funding
    const { data: simJob, error: simJobErr } = await supabase.from('jobs').insert({
      client_id: clientId,
      category_id: cat?.id,
      title: `Simulated Job ${runId}`,
      description: 'Testing simulated funding parity across outbox and notifications.',
      project_type: 'fixed',
      budget_min: 2000,
      budget_max: 2000,
      duration: 'less_than_1_month',
      experience_level: 'intermediate',
      status: 'published',
    }).select('id').single();
    if (simJobErr) console.error('simJobErr:', simJobErr);

    const { data: simProp, error: simPropErr } = await supabase.from('proposals').insert({
      job_id: simJob!.id,
      freelancer_id: freelancerId,
      bid_amount: 2000,
      rate_type: 'fixed',
      delivery_days: 5,
      cover_letter: 'I have deep expertise in simulated ledger operations and append-only audits.',
      status: 'submitted',
    }).select('id').single();
    if (simPropErr) console.error('simPropErr:', simPropErr);

    runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      UPDATE public.proposals SET status = 'under_review' WHERE id = '${simProp!.id}';
      UPDATE public.proposals SET status = 'accepted' WHERE id = '${simProp!.id}';
      COMMIT;
    `);

    const { data: simCon } = await supabase.from('contracts').select('id').eq('proposal_id', simProp!.id).single();
    simContractId = simCon!.id;
    const { data: simMil } = await supabase.from('contract_milestones').select('id').eq('contract_id', simContractId).single();
    simMilestoneId = simMil!.id;

    // Fund milestone via simulated fund_milestone()
    const { error: simFundErr } = await supabase.rpc('fund_milestone', { p_milestone_id: simMilestoneId });
    if (simFundErr) console.error('simFundErr:', simFundErr);
    assert(!simFundErr, 'fund_milestone executed successfully for simulated escrow');

    const { data: simOutbox } = await supabase.from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:milestone_funded:${simMilestoneId}`)
      .single();

    assert(simOutbox?.payload?.isSimulated === true, 'isSimulated is strictly TRUE for simulated funding');

    const { data: simNotif } = await supabase.from('notifications')
      .select('*')
      .eq('idempotency_key', `notif:milestone_funded:${simMilestoneId}`)
      .single();

    assert(Boolean(simNotif), 'In-app notification created for simulated funding');
    assert(!simNotif?.message?.includes('via Razorpay'), 'Simulated notification message does not claim live payment');

  } finally {
    console.log('\n--- Cleaning Up Isolated Test Fixtures ---');
    try {
      if (conv1Id) {
        await supabase.from('messages').delete().eq('conversation_id', conv1Id);
        await supabase.from('conversation_participants').delete().eq('conversation_id', conv1Id);
        await supabase.from('message_notification_windows').delete().eq('conversation_id', conv1Id);
        await supabase.from('conversations').delete().eq('id', conv1Id);
      }
      if (conv2Id) {
        await supabase.from('messages').delete().eq('conversation_id', conv2Id);
        await supabase.from('conversation_participants').delete().eq('conversation_id', conv2Id);
        await supabase.from('message_notification_windows').delete().eq('conversation_id', conv2Id);
        await supabase.from('conversations').delete().eq('id', conv2Id);
      }
      if (milestoneId) {
        await supabase.from('payment_attempts').delete().eq('milestone_id', milestoneId);
        await supabase.from('payment_ledger').delete().eq('milestone_id', milestoneId);
        await supabase.from('contract_milestones').delete().eq('id', milestoneId);
      }
      if (simMilestoneId) {
        await supabase.from('payment_ledger').delete().eq('milestone_id', simMilestoneId);
        await supabase.from('contract_milestones').delete().eq('id', simMilestoneId);
      }
      if (contractId) await supabase.from('contracts').delete().eq('id', contractId);
      if (simContractId) await supabase.from('contracts').delete().eq('id', simContractId);
      if (proposalId) await supabase.from('proposals').delete().eq('id', proposalId);
      if (jobId) await supabase.from('jobs').delete().eq('id', jobId);
      if (clientId) {
        await supabase.from('notifications').delete().eq('user_id', clientId);
        await supabase.from('email_outbox').delete().eq('recipient_user_id', clientId);
        await supabase.auth.admin.deleteUser(clientId);
      }
      if (freelancerId) {
        await supabase.from('notifications').delete().eq('user_id', freelancerId);
        await supabase.from('email_outbox').delete().eq('recipient_user_id', freelancerId);
        await supabase.auth.admin.deleteUser(freelancerId);
      }
      await supabase.from('email_outbox').delete().like('idempotency_key', `%${runId}%`);
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }

  console.log('\n========================================================================');
  console.log(`STEP 2D.3 HARDENING VERIFICATION: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2D3Verification().catch(err => {
  console.error('Fatal Step 2D.3 verification error:', err);
  process.exit(1);
});
