import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawnSync } from 'child_process';
import { processOutboxBatch } from '../lib/email/outbox-processor';
import { getAdminSupabaseClient } from '../lib/supabase/admin';

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

interface MailpitMessageSummary {
  Subject?: string;
  ID?: string;
  To?: Array<{ Address?: string }>;
}

function fetchMailpitMessages(): Promise<MailpitMessageSummary[]> {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:54324/api/v1/messages', (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.messages || []) as MailpitMessageSummary[]);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runStep2DVerification() {
  console.log('========================================================================');
  console.log('STEP 2D.2: TRANSACTIONAL BUSINESS EVENT OUTBOX INTEGRATION TEST SUITE');
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

  // Test Run Identity Tags
  const runId = Date.now().toString().slice(-6);
  const clientEmail = `client-${runId}@workspace-test.local`;
  const freelancerEmail = `freelancer-${runId}@workspace-test.local`;

  let clientId: string = '';
  let freelancerId: string = '';
  let jobId: string = '';
  let proposalId: string = '';
  let contractId: string = '';
  let milestoneId: string = '';
  let conversationId: string = '';

  try {
    // -------------------------------------------------------------------
    // 1. Setup Test Actors (Client and Freelancer) in auth.users and profiles
    // -------------------------------------------------------------------
    console.log('--- 1. Setting up Isolated Test Actors & Infrastructure ---');

    const { data: clientUser, error: clientErr } = await supabase.auth.admin.createUser({
      email: clientEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Test Client ${runId}`, username: `client_${runId}` },
    });
    if (clientErr || !clientUser.user) throw new Error(`Failed to create client user: ${clientErr?.message}`);
    clientId = clientUser.user.id;

    // Update profile
    await supabase.from('profiles').update({
      full_name: `Acme Corp ${runId}`,
      active_mode: 'client',
      can_hire: true,
    }).eq('id', clientId);

    const { data: freelancerUser, error: freeErr } = await supabase.auth.admin.createUser({
      email: freelancerEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: `Dev Specialist ${runId}`, username: `dev_${runId}` },
    });
    if (freeErr || !freelancerUser.user) throw new Error(`Failed to create freelancer user: ${freeErr?.message}`);
    freelancerId = freelancerUser.user.id;

    await supabase.from('profiles').update({
      full_name: `Dev Specialist ${runId}`,
      active_mode: 'freelancer',
      can_work: true,
    }).eq('id', freelancerId);

    assert(Boolean(clientId && freelancerId), 'Created isolated client and freelancer test accounts');

    // -------------------------------------------------------------------
    // 2. Outbox Schema Constraints & Suppression Function Audit
    // -------------------------------------------------------------------
    console.log('\n--- 2. Outbox Schema & Suppression Function Audit ---');

    // Test inserting a record with status 'suppressed'
    const testSuppressedKey = `test:suppressed:${runId}`;
    const { error: suppInsertErr } = await supabase.from('email_outbox').insert({
      event_type: 'test_event',
      template_key: 'unread_message_v1',
      recipient_email: clientEmail,
      recipient_user_id: clientId,
      subject: 'Test Suppressed Record',
      payload: { test: true },
      idempotency_key: testSuppressedKey,
      status: 'suppressed',
    });
    assert(!suppInsertErr, 'Email outbox schema permits status="suppressed"');

    // Verify mark_outbox_email_suppressed stored procedure
    const testProcKey = `test:proc:${runId}`;
    const { data: procRow } = await supabase.from('email_outbox').insert({
      event_type: 'test_event',
      template_key: 'unread_message_v1',
      recipient_email: clientEmail,
      recipient_user_id: clientId,
      subject: 'Test Pending for Suppression',
      payload: { test: true },
      idempotency_key: testProcKey,
      status: 'pending',
    }).select('id').single();

    if (procRow) {
      const { error: markSuppErr } = await supabase.rpc('mark_outbox_email_suppressed', {
        p_id: procRow.id,
        p_reason: 'Testing suppression stored procedure',
      });
      assert(!markSuppErr, 'mark_outbox_email_suppressed() stored procedure executed successfully');

      const { data: refetched } = await supabase.from('email_outbox').select('status, last_error').eq('id', procRow.id).single();
      assert(refetched?.status === 'suppressed' && refetched?.last_error === 'Testing suppression stored procedure',
        'Outbox record status successfully transitioned to "suppressed" with explanation');

      // Verify claim_outbox_emails NEVER claims suppressed records
      const { data: claimed } = await supabase.rpc('claim_outbox_emails', {
        p_batch_size: 50,
        p_worker_id: 'test-supp-worker',
      });
      const claimedIds = ((claimed || []) as Array<{ id: string }>).map(r => r.id);
      assert(!claimedIds.includes(procRow.id), 'claim_outbox_emails() strictly ignores suppressed records');
    }

    // -------------------------------------------------------------------
    // 3. Event A: Proposal Received Transactional Integration
    // -------------------------------------------------------------------
    console.log('\n--- 3. Event A: Proposal Received Trigger Verification ---');

    // Create a published job
    const { data: category } = await supabase.from('categories').select('id').limit(1).single();
    const { data: job, error: jobErr } = await supabase.from('jobs').insert({
      client_id: clientId,
      category_id: category?.id,
      title: `Distributed Cloud Engineer ${runId}`,
      description: 'Building resilient backend cloud services with PostgreSQL and Next.js.',
      project_type: 'fixed',
      budget_min: 3500,
      budget_max: 3500,
      duration: '1_to_3_months',
      experience_level: 'expert',
      status: 'published',
    }).select('id, title').single();
    if (jobErr || !job) throw new Error(`Job creation failed: ${jobErr?.message}`);
    jobId = job.id;

    // Insert proposal (freelancer bids on job)
    const { data: proposal, error: propErr } = await supabase.from('proposals').insert({
      job_id: jobId,
      freelancer_id: freelancerId,
      bid_amount: 3200,
      rate_type: 'fixed',
      delivery_days: 14,
      cover_letter: 'I have deep expertise with high-throughput outbox architectures and PostgreSQL queues.',
      status: 'submitted',
    }).select('id').single();
    if (propErr || !proposal) throw new Error(`Proposal insertion failed: ${propErr?.message}`);
    proposalId = proposal.id;

    // Check email_outbox for proposal_received_v1
    const { data: propOutbox } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:proposal_received:${proposalId}`)
      .maybeSingle();

    assert(Boolean(propOutbox), 'Trigger automatically queued proposal_received outbox record upon proposal insert');
    assert(propOutbox?.recipient_email === clientEmail, 'Recipient email resolved accurately to authoritative client email', `Got: ${propOutbox?.recipient_email}`);
    assert(propOutbox?.template_key === 'proposal_received_v1', 'Template key matches proposal_received_v1');
    assert(propOutbox?.payload?.jobTitle === job.title, 'Payload correctly captures job title');
    assert(propOutbox?.payload?.clientName === `Acme Corp ${runId}`, 'Payload correctly captures client full name');

    // Hold record for batch dispatch in Step 8
    if (propOutbox) {
      await supabase.from('email_outbox').update({ next_attempt_at: new Date(Date.now() + 3600000).toISOString() }).eq('id', propOutbox.id);
    }

    // -------------------------------------------------------------------
    // 4. Event B: Proposal Accepted Transactional Integration
    // -------------------------------------------------------------------
    console.log('\n--- 4. Event B: Proposal Accepted Trigger Verification ---');

    // Update proposal status submitted -> under_review -> accepted with client auth context
    try {
      runSql(`
        BEGIN;
        SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
        UPDATE public.proposals SET status = 'under_review' WHERE id = '${proposalId}';
        UPDATE public.proposals SET status = 'accepted' WHERE id = '${proposalId}';
        COMMIT;
      `);
      assert(true, 'Proposal status transitioned submitted -> under_review -> accepted by client');
    } catch (e: unknown) {
      assert(false, 'Proposal status transition failed', e instanceof Error ? e.message : String(e));
    }

    // Verify contract was created
    const { data: contract } = await supabase
      .from('contracts')
      .select('id, title, status, contract_type, fixed_price')
      .eq('proposal_id', proposalId)
      .maybeSingle();
    assert(Boolean(contract && contract.status === 'active'), 'Contract established automatically upon proposal acceptance');
    contractId = contract?.id || '';

    // Verify proposal_accepted outbox record
    const { data: acceptOutbox } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:proposal_accepted:${proposalId}`)
      .maybeSingle();

    assert(Boolean(acceptOutbox), 'Trigger automatically queued proposal_accepted outbox record upon contract creation');
    assert(acceptOutbox?.recipient_email === freelancerEmail, 'Recipient email resolved accurately to freelancer email');
    assert(acceptOutbox?.template_key === 'proposal_accepted_v1', 'Template key matches proposal_accepted_v1');
    assert(acceptOutbox?.payload?.contractId === contractId, 'Payload correctly binds newly created contractId');
    assert(acceptOutbox?.payload?.freelancerName === `Dev Specialist ${runId}`, 'Payload contains freelancer full name');

    // Hold record for batch dispatch in Step 8
    if (acceptOutbox) {
      await supabase.from('email_outbox').update({ next_attempt_at: new Date(Date.now() + 3600000).toISOString() }).eq('id', acceptOutbox.id);
    }

    // -------------------------------------------------------------------
    // 5. Event C: Milestone Funded (Simulated vs Live) Integration
    // -------------------------------------------------------------------
    console.log('\n--- 5. Event C: Milestone Funded Trigger Verification ---');

    // Verify initial milestone was created on fixed contract
    const { data: milestone } = await supabase
      .from('contract_milestones')
      .select('id, contract_id, status, amount, sequence_order')
      .eq('contract_id', contractId)
      .eq('sequence_order', 1)
      .single();
    assert(Boolean(milestone), 'Initial milestone 1 present on contract');
    milestoneId = milestone?.id || '';

    // 5A. Simulated Escrow Funding
    const { error: fundErr } = await supabase.rpc('fund_milestone', {
      p_milestone_id: milestoneId,
    });
    assert(!fundErr, 'fund_milestone() executed successfully');

    const { data: fundedOutbox } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:milestone_funded:${milestoneId}`)
      .maybeSingle();

    assert(Boolean(fundedOutbox), 'Trigger automatically queued milestone_funded outbox record upon status="funded"');
    assert(fundedOutbox?.template_key === 'milestone_funded_v1', 'Template key matches milestone_funded_v1');
    assert(fundedOutbox?.payload?.isSimulated === true, 'isSimulated correctly resolved to true for simulated funding');
    assert(fundedOutbox?.recipient_email === freelancerEmail, 'Recipient email is freelancer email');

    // Hold record for batch dispatch in Step 8
    if (fundedOutbox) {
      await supabase.from('email_outbox').update({ next_attempt_at: new Date(Date.now() + 3600000).toISOString() }).eq('id', fundedOutbox.id);
    }

    // 5B. Idempotency Check: Re-funding or duplicate webhook cannot duplicate outbox row
    const countBefore = (await supabase.from('email_outbox').select('id', { count: 'exact' }).eq('idempotency_key', `email:milestone_funded:${milestoneId}`)).count;
    // Attempt duplicate trigger execution simulation
    try {
      await supabase.rpc('fund_milestone_with_payment', {
        p_milestone_id: milestoneId,
        p_payment_metadata: { simulated: false },
      });
    } catch {
      // Already funded, exits idempotently
    }
    const countAfter = (await supabase.from('email_outbox').select('id', { count: 'exact' }).eq('idempotency_key', `email:milestone_funded:${milestoneId}`)).count;
    assert(countBefore === countAfter, 'Idempotency key strictly prevents duplicate milestone_funded outbox records');

    // -------------------------------------------------------------------
    // 6. Event D: Milestone Released Transactional Integration
    // -------------------------------------------------------------------
    console.log('\n--- 6. Event D: Milestone Released Trigger Verification ---');

    // Transition milestone: funded -> submitted -> approved
    const { error: subErr } = await supabase.from('contract_milestones').update({ status: 'submitted' }).eq('id', milestoneId);
    if (subErr) console.error('subErr:', subErr);
    const { error: appErr } = await supabase.from('contract_milestones').update({ status: 'approved' }).eq('id', milestoneId);
    if (appErr) console.error('appErr:', appErr);
    assert(!subErr && !appErr, 'Milestone transitioned funded -> submitted -> approved');

    // Verify NO release email queued during 'approved' status
    const { data: earlyReleaseOutbox } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:milestone_released:${milestoneId}`)
      .maybeSingle();
    assert(!earlyReleaseOutbox, 'No milestone_released email queued while status is merely "approved"');

    // Create payout transfer record
    const { data: transferRecord, error: trfErr } = await supabase.rpc('create_payout_transfer_record', {
      p_contract_id: contractId,
      p_recipient_user_id: freelancerId,
      p_gross_amount: 3200,
      p_fee_amount: 320,
      p_net_amount: 2880,
      p_currency: 'USD',
      p_idempotency_key: `payout:test:${milestoneId}:${runId}`,
      p_provider_transfer_id: `trf_sim_${runId}`,
      p_provider_account_id: `acc_sim_${runId}`,
      p_milestone_id: milestoneId,
      p_timesheet_id: null,
      p_on_hold: false,
      p_metadata: { is_simulated: true },
    });
    if (trfErr) console.error('trfErr:', trfErr);
    assert(Boolean(transferRecord), 'Payout transfer record created', trfErr?.message);

    // Confirm payout transfer completion (transitions milestone to 'released')
    if (transferRecord) {
      const { error: confErr } = await supabase.rpc('confirm_payout_transfer_completion', {
        p_transfer_id: transferRecord.id,
      });
      if (confErr) console.error('confErr:', confErr);
      assert(!confErr, 'confirm_payout_transfer_completion succeeded', confErr?.message);
    }

    const { data: releasedOutbox } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('idempotency_key', `email:milestone_released:${milestoneId}`)
      .maybeSingle();

    assert(Boolean(releasedOutbox), 'Trigger automatically queued milestone_released outbox record upon status="released"');
    assert(releasedOutbox?.template_key === 'milestone_released_v1', 'Template key matches milestone_released_v1');
    assert(releasedOutbox?.payload?.isSimulated === true, 'isSimulated accurately resolved from payout transfer metadata');
    assert(releasedOutbox?.recipient_email === freelancerEmail, 'Recipient email resolved to freelancer');

    // Hold record for batch dispatch in Step 8
    if (releasedOutbox) {
      await supabase.from('email_outbox').update({ next_attempt_at: new Date(Date.now() + 3600000).toISOString() }).eq('id', releasedOutbox.id);
    }

    // -------------------------------------------------------------------
    // 7. Event E: Direct Messaging Deduplication, Throttling & Pre-flight
    // -------------------------------------------------------------------
    console.log('\n--- 7. Event E: Direct Messaging Throttling & Pre-flight Verification ---');

    // Create contract conversation (as authenticated client)
    const convId = runSql(`
      BEGIN;
      SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
      SELECT public.create_or_get_contract_conversation('${contractId}');
      COMMIT;
    `).split('\n').filter(Boolean).pop()?.trim() || '';
    conversationId = convId;
    assert(Boolean(conversationId), 'Created contract conversation');

    // Reset last_read_at for client to simulate offline recipient
    const pastTime = new Date(Date.now() - 3600000).toISOString();
    await supabase.from('conversation_participants').update({
      last_read_at: pastTime,
    }).eq('conversation_id', conversationId).eq('user_id', clientId);

    // Message 1 from Freelancer to Client
    const { data: msg1 } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: freelancerId,
      content: 'Hey client, initial architecture specifications are ready for review!',
      message_type: 'text',
    }).select('id, created_at').single();
    assert(Boolean(msg1), 'Inserted Message 1 from freelancer to client');

    // Check outbox for unread message notification
    const { data: msgOutbox1 } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('related_entity_id', conversationId)
      .eq('recipient_user_id', clientId)
      .eq('status', 'pending')
      .maybeSingle();

    assert(Boolean(msgOutbox1), 'Throttled unread message outbox record created for offline client');
    assert(msgOutbox1?.template_key === 'unread_message_v1', 'Template key is unread_message_v1');
    assert(msgOutbox1?.payload?.unreadCount === 1, 'Initial unreadCount is 1');
    assert(!msgOutbox1?.payload?.content && !msgOutbox1?.payload?.attachment, 'Zero message body or attachment data exposed in payload (Strict Privacy)');

    const initialNextAttempt = new Date(msgOutbox1!.next_attempt_at).getTime();
    const expectedWindowEnd = Date.now() + 15 * 60 * 1000;
    assert(Math.abs(initialNextAttempt - expectedWindowEnd) < 60000, 'next_attempt_at bounded to ~15 minutes in the future');

    // Message 2 & 3 in rapid succession (burst messaging)
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: freelancerId,
      content: 'Also, I updated the diagrams.',
      message_type: 'text',
    });
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: freelancerId,
      content: 'Let me know what you think!',
      message_type: 'text',
    });

    // Check outbox again: Must NOT have multiple pending records!
    const { data: pendingRows } = await supabase
      .from('email_outbox')
      .select('*')
      .eq('related_entity_id', conversationId)
      .eq('recipient_user_id', clientId)
      .eq('status', 'pending');

    assert(pendingRows?.length === 1, 'Burst messaging did NOT create multiple outbox records (Deduplicated within window)');
    assert(pendingRows?.[0]?.payload?.unreadCount === 3, 'Unread count incremented to 3');
    const updatedNextAttempt = new Date(pendingRows![0].next_attempt_at).getTime();
    assert(updatedNextAttempt === initialNextAttempt, 'next_attempt_at was NOT postponed (Bounded quiet period preserved)');

    // 7B. Test Suppression: Recipient opens conversation & marks read
    console.log('\n--- 7B. Testing Pre-Flight & Read-Time Suppression ---');
    try {
      runSql(`
        BEGIN;
        SET LOCAL request.jwt.claims = '{"sub": "${clientId}"}';
        SELECT public.mark_conversation_read('${conversationId}');
        COMMIT;
      `);
      assert(true, 'Executed mark_conversation_read with client context');
    } catch (e: unknown) {
      assert(false, 'mark_conversation_read failed', e instanceof Error ? e.message : String(e));
    }

    const { data: suppressedRow } = await supabase
      .from('email_outbox')
      .select('status, last_error')
      .eq('id', pendingRows![0].id)
      .single();

    assert(suppressedRow?.status === 'suppressed', 'Outbox record automatically transitioned to "suppressed" upon mark_conversation_read');
    assert(suppressedRow?.last_error?.includes('read'), 'Suppression reason recorded accurately');

    // 7C. Outbox Processor Pre-Flight Hook Test:
    // Create an unread message record that is ready to claim (next_attempt_at <= now())
    // but the recipient has already read up to the message timestamp.
    const preflightKey = `email:unread_msg:preflight:${runId}`;
    const { data: preflightOutbox } = await supabase.from('email_outbox').insert({
      event_type: 'unread_message',
      template_key: 'unread_message_v1',
      recipient_email: clientEmail,
      recipient_user_id: clientId,
      subject: 'New message from Freelancer on Workspace',
      payload: {
        recipientName: 'Client',
        senderName: 'Freelancer',
        conversationId,
        unreadCount: 1,
        lastMessageTimestamp: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
        accountState: 'existing_account',
      },
      related_entity_id: conversationId,
      idempotency_key: preflightKey,
      next_attempt_at: new Date(Date.now() - 1000).toISOString(), // Ready now
      status: 'pending',
    }).select('id').single();

    if (preflightOutbox) {
      // Set recipient last_read_at to NOW (> message timestamp)
      await supabase.from('conversation_participants').update({
        last_read_at: new Date().toISOString(),
      }).eq('conversation_id', conversationId).eq('user_id', clientId);

      // Run outbox processor batch
      const procResult = await processOutboxBatch({ batchSize: 10, workerId: 'test-preflight-worker' });
      const myItem = procResult.results.find(r => r.id === preflightOutbox.id);

      assert(myItem?.status === 'suppressed', 'Outbox processor pre-flight hook intercepted and suppressed message delivery');
      assert(procResult.suppressedCount >= 1, 'Batch result counted suppressed item in suppressedCount');

      const { data: finalRecord } = await supabase.from('email_outbox').select('status, last_error').eq('id', preflightOutbox.id).single();
      assert(finalRecord?.status === 'suppressed', 'Outbox record in database updated to "suppressed", never "sent"');
    }

    // -------------------------------------------------------------------
    // 8. Process Ready Outbox Records & Mailpit End-to-End Verification
    // -------------------------------------------------------------------
    console.log('\n--- 8. Dispatch Ready Outbox Records to Mailpit ---');

    // Advance next_attempt_at for remaining pending records (proposal_received, proposal_accepted, milestone_funded, milestone_released)
    await supabase.from('email_outbox')
      .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .in('idempotency_key', [
        `email:proposal_received:${proposalId}`,
        `email:proposal_accepted:${proposalId}`,
        `email:milestone_funded:${milestoneId}`,
        `email:milestone_released:${milestoneId}`,
      ]);

    const batchRes = await processOutboxBatch({ batchSize: 20, workerId: `e2e-worker-${runId}` });
    assert(batchRes.sentCount >= 4, `Outbox processor successfully sent ${batchRes.sentCount} business emails`);

    // Fetch Mailpit messages
    const mailpitMessages = await fetchMailpitMessages();
    const hasPropRec = mailpitMessages.some(m => m.Subject?.includes('New proposal received for "Distributed Cloud Engineer'));
    const hasPropAcc = mailpitMessages.some(m => m.Subject?.includes('proposal for "Distributed Cloud Engineer') && m.Subject?.includes('accepted'));
    const hasMilFund = mailpitMessages.some(m => m.Subject?.includes('Milestone Funded: "Milestone 1'));
    const hasMilRel = mailpitMessages.some(m => m.Subject?.includes('Payment Released: "Milestone 1'));

    assert(hasPropRec, 'Mailpit confirmed receipt of proposal_received email');
    assert(hasPropAcc, 'Mailpit confirmed receipt of proposal_accepted email');
    assert(hasMilFund, 'Mailpit confirmed receipt of milestone_funded email');
    assert(hasMilRel, 'Mailpit confirmed receipt of milestone_released email');

  } finally {
    // Cleanup test artifacts
    console.log('\n--- Cleanup Test Records ---');
    try {
      if (conversationId) {
        await supabase.from('messages').delete().eq('conversation_id', conversationId);
        await supabase.from('conversation_participants').delete().eq('conversation_id', conversationId);
        await supabase.from('message_notification_windows').delete().eq('conversation_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);
      }
      if (milestoneId) {
        await supabase.from('contract_milestones').delete().eq('id', milestoneId);
      }
      if (contractId) {
        await supabase.from('payout_transfers').delete().eq('contract_id', contractId);
        await supabase.from('payment_ledger').delete().eq('contract_id', contractId);
        await supabase.from('contracts').delete().eq('id', contractId);
      }
      if (proposalId) {
        await supabase.from('proposals').delete().eq('id', proposalId);
      }
      if (jobId) {
        await supabase.from('jobs').delete().eq('id', jobId);
      }
      if (clientId) {
        await supabase.from('email_outbox').delete().eq('recipient_user_id', clientId);
        await supabase.auth.admin.deleteUser(clientId);
      }
      if (freelancerId) {
        await supabase.from('email_outbox').delete().eq('recipient_user_id', freelancerId);
        await supabase.auth.admin.deleteUser(freelancerId);
      }
      // Delete any test outbox records matching runId
      await supabase.from('email_outbox').delete().like('idempotency_key', `%${runId}%`);
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }

  console.log('\n========================================================================');
  console.log(`STEP 2D.2 VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2DVerification().catch(err => {
  console.error('Fatal Step 2D.2 verification error:', err);
  process.exit(1);
});
