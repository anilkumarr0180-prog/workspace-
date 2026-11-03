import fs from 'fs';
import http from 'http';
import path from 'path';
import { processOutboxBatch } from '../lib/email/outbox-processor';
import { sendEmail } from '../lib/email/service';
import { renderTemplate } from '../lib/email/templates';
import type {
  MilestoneFundedTemplateData,
  ProposalAcceptedTemplateData,
  ProposalReceivedTemplateData,
  UnreadMessageTemplateData,
} from '../lib/email/templates/types';
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

interface MailpitMessageSummary {
  Subject?: string;
  ID?: string;
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

async function runStep2C1Verification() {
  console.log('========================================================================');
  console.log('STEP 2C.1: ACCOUNT-AWARE EMAIL TEMPLATES & ARCHITECTURE VERIFICATION');
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

  // -------------------------------------------------------------------
  // 1. Account States on Proposal Received
  // -------------------------------------------------------------------
  console.log('\n--- 1. Proposal Received Account-Aware CTAs ---');
  const basePropRec: ProposalReceivedTemplateData = {
    clientName: 'Acme Corp',
    freelancerName: 'Sarah Jenkins',
    jobTitle: 'Senior Frontend Architect',
    jobId: 'job-999',
    proposalId: 'prop-888',
  };

  const propRecExisting = renderTemplate('proposal_received_v1', { ...basePropRec, accountState: 'existing_account' });
  assert(
    propRecExisting.html.includes('Review Proposal &amp; Freelancer') &&
    propRecExisting.html.includes('/jobs/job-999?proposalId=prop-888'),
    'Proposal Received (existing_account) routes to direct job proposal review'
  );

  const propRecNoAccount = renderTemplate('proposal_received_v1', { ...basePropRec, accountState: 'no_account' });
  assert(
    propRecNoAccount.html.includes('Join Workspace to Review') &&
    propRecNoAccount.html.includes('/signup/client') &&
    propRecNoAccount.html.includes('Create a client account'),
    'Proposal Received (no_account) routes to client registration with contextual invitation'
  );

  const propRecUnknown = renderTemplate('proposal_received_v1', { ...basePropRec, accountState: 'unknown' });
  assert(
    propRecUnknown.html.includes('Continue to Workspace') &&
    propRecUnknown.html.includes('/jobs/job-999?proposalId=prop-888') &&
    !propRecUnknown.html.includes('Create a client account'),
    'Proposal Received (unknown) uses neutral "Continue to Workspace" phrasing'
  );

  // -------------------------------------------------------------------
  // 2. Account States on Proposal Accepted
  // -------------------------------------------------------------------
  console.log('\n--- 2. Proposal Accepted Account-Aware CTAs ---');
  const basePropAcc: ProposalAcceptedTemplateData = {
    freelancerName: 'David Kim',
    clientOrCompanyName: 'TechFlow Inc',
    jobTitle: 'Backend Engineer',
    contractId: 'contract-777',
    contractType: 'fixed',
  };

  const propAccExisting = renderTemplate('proposal_accepted_v1', { ...basePropAcc, accountState: 'existing_account' });
  assert(
    propAccExisting.html.includes('View Contract &amp; Begin Work') &&
    propAccExisting.html.includes('/contracts/contract-777'),
    'Proposal Accepted (existing_account) routes to active contract workspace'
  );

  const propAccNoAccount = renderTemplate('proposal_accepted_v1', { ...basePropAcc, accountState: 'no_account' });
  assert(
    propAccNoAccount.html.includes('Join Workspace to View Your Contract') &&
    propAccNoAccount.html.includes('/signup/freelancer'),
    'Proposal Accepted (no_account) routes to freelancer signup'
  );

  const propAccUnknown = renderTemplate('proposal_accepted_v1', { ...basePropAcc, accountState: 'unknown' });
  assert(
    propAccUnknown.html.includes('Continue to Workspace') &&
    propAccUnknown.html.includes('/contracts/contract-777'),
    'Proposal Accepted (unknown) uses neutral phrasing without assuming registration'
  );

  // -------------------------------------------------------------------
  // 3. Account States on Milestone Funded & Released
  // -------------------------------------------------------------------
  console.log('\n--- 3. Milestone Funded Account-Aware CTAs ---');
  const baseMilestone: MilestoneFundedTemplateData = {
    recipientName: 'Alex Lee',
    milestoneTitle: 'Database Migration',
    contractTitle: 'Fintech App',
    contractId: 'contract-666',
    amount: 1000,
    currency: 'USD',
  };

  const mFundedExisting = renderTemplate('milestone_funded_v1', { ...baseMilestone, accountState: 'existing_account' });
  assert(
    mFundedExisting.html.includes('View Contract &amp; Milestones') &&
    mFundedExisting.html.includes('/contracts/contract-666'),
    'Milestone Funded (existing_account) routes to contract details'
  );

  const mFundedNoAccount = renderTemplate('milestone_funded_v1', { ...baseMilestone, accountState: 'no_account' });
  assert(
    mFundedNoAccount.html.includes('Join Workspace to View Milestone') &&
    mFundedNoAccount.html.includes('/signup'),
    'Milestone Funded (no_account) routes to general signup'
  );

  // -------------------------------------------------------------------
  // 4. Account States on Unread Direct Message
  // -------------------------------------------------------------------
  console.log('\n--- 4. Unread Direct Message Account-Aware CTAs ---');
  const baseUnread: UnreadMessageTemplateData = {
    recipientName: 'Rachel Green',
    senderName: 'Ross Geller',
    conversationId: 'conv-111',
  };

  const unreadExisting = renderTemplate('unread_message_v1', { ...baseUnread, accountState: 'existing_account' });
  assert(
    unreadExisting.html.includes('Open Secure Inbox &amp; Reply') &&
    unreadExisting.html.includes('/messages/conv-111'),
    'Unread Message (existing_account) routes to secure conversation'
  );

  const unreadNoAccount = renderTemplate('unread_message_v1', { ...baseUnread, accountState: 'no_account' });
  assert(
    unreadNoAccount.html.includes('Join Workspace to Reply') &&
    unreadNoAccount.html.includes('/signup'),
    'Unread Message (no_account) invites recipient to create account to reply'
  );

  const unreadUnknown = renderTemplate('unread_message_v1', { ...baseUnread, accountState: 'unknown' });
  assert(
    unreadUnknown.html.includes('Continue to Conversation') &&
    unreadUnknown.html.includes('/messages/conv-111'),
    'Unread Message (unknown) uses neutral "Continue to Conversation"'
  );

  // -------------------------------------------------------------------
  // 5. Account Security Audit
  // -------------------------------------------------------------------
  console.log('\n--- 5. Account Invitation & Security Audit ---');
  const allRenderedHtml = [
    propRecExisting.html, propRecNoAccount.html, propRecUnknown.html,
    propAccExisting.html, propAccNoAccount.html, propAccUnknown.html,
    mFundedExisting.html, mFundedNoAccount.html,
    unreadExisting.html, unreadNoAccount.html, unreadUnknown.html,
  ].join('\n');

  assert(
    !allRenderedHtml.includes('password') &&
    !allRenderedHtml.includes('token=') &&
    !allRenderedHtml.includes('invitation_token') &&
    !allRenderedHtml.includes('temporary_secret'),
    'No passwords, invitation tokens, or credentials exist in any rendered template'
  );

  // -------------------------------------------------------------------
  // 6. Outbox Processor Coordination & Account State Resolution
  // -------------------------------------------------------------------
  console.log('\n--- 6. Outbox Processor Account Resolution ---');
  const supabase = getAdminSupabaseClient();

  // Clean table
  await supabase.from('email_outbox').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Insert 3 records with different account states:
  // 1. With linked recipient_user_id (existing_account)
  // 2. With explicit no_account in payload
  // 3. Without recipient_user_id and without accountState (resolves to unknown)
  const keyLinked = `acc_linked_${Date.now()}`;
  const keyExplicitNoAcc = `acc_noacc_${Date.now()}`;
  const keyUnknown = `acc_unk_${Date.now()}`;

  // Fetch an existing profile ID from database to test authentic recipient_user_id linkage
  const { data: profileSample } = await supabase.from('profiles').select('id, full_name').limit(1).single();
  const sampleUserId = profileSample?.id || null;

  await supabase.from('email_outbox').insert([
    {
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: 'client-existing@workspace.local',
      recipient_user_id: sampleUserId,
      subject: 'New proposal received',
      payload: { ...basePropRec, clientName: 'Existing Client' },
      idempotency_key: keyLinked,
      status: 'pending',
    },
    {
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: 'client-invited@workspace.local',
      recipient_user_id: null,
      subject: 'New proposal received',
      payload: { ...basePropRec, clientName: 'Prospective Client', accountState: 'no_account' },
      idempotency_key: keyExplicitNoAcc,
      status: 'pending',
    },
    {
      event_type: 'proposal_received',
      template_key: 'proposal_received_v1',
      recipient_email: 'client-unknown@workspace.local',
      recipient_user_id: null,
      subject: 'New proposal received',
      payload: { ...basePropRec, clientName: 'Unknown Client' },
      idempotency_key: keyUnknown,
      status: 'pending',
    },
  ]);

  // Capture dispatched emails
  const capturedEmails: Array<{ to: string; subject: string; html?: string }> = [];
  const captureAdapter = {
    name: 'test' as const,
    async sendEmail(opts: { to: string | string[]; subject: string; html?: string; text?: string }) {
      const recipient = Array.isArray(opts.to) ? opts.to[0] : opts.to;
      capturedEmails.push({ to: recipient, subject: opts.subject, html: opts.html });
      return { success: true, provider: 'test' as const, providerMessageId: `msg-${Date.now()}` };
    },
  };

  const batchRes = await processOutboxBatch({ batchSize: 10, workerId: 'step2c1-worker' }, captureAdapter);
  assert(batchRes.claimedCount === 3 && batchRes.sentCount === 3, 'Outbox processor successfully claimed and processed all 3 account-state test records');

  const linkedDispatched = capturedEmails.find(e => e.to.includes('client-existing'));
  const noAccDispatched = capturedEmails.find(e => e.to.includes('client-invited'));
  const unkDispatched = capturedEmails.find(e => e.to.includes('client-unknown'));

  assert(
    Boolean(linkedDispatched?.html?.includes('Review Proposal &amp; Freelancer')),
    'Outbox processor resolved recipient_user_id to existing_account CTA'
  );
  assert(
    Boolean(noAccDispatched?.html?.includes('Join Workspace to Review')),
    'Outbox processor respected explicit no_account payload CTA'
  );
  assert(
    Boolean(unkDispatched?.html?.includes('Continue to Workspace')),
    'Outbox processor defaulted unlinked recipient to neutral unknown CTA'
  );

  // Clean outbox
  await supabase.from('email_outbox').delete().in('idempotency_key', [keyLinked, keyExplicitNoAcc, keyUnknown]);
  const { count: finalCount } = await supabase.from('email_outbox').select('*', { count: 'exact', head: true });
  assert(finalCount === 0, 'Cleaned up all outbox test records');

  // -------------------------------------------------------------------
  // 7. Mailpit Preview Dispatch for Account States
  // -------------------------------------------------------------------
  console.log('\n--- 7. Mailpit Preview Dispatch ---');
  const mailpitTimestamp = Date.now();
  await sendEmail({
    to: 'account-state-preview@workspace.local',
    subject: `[Mailpit State Preview] Proposal Accepted (no_account) - ${mailpitTimestamp}`,
    html: propAccNoAccount.html,
    text: propAccNoAccount.text,
  });

  const mailpitMsgs = await fetchMailpitMessages();
  const foundStateMsg = mailpitMsgs.some(m => m.Subject?.includes(String(mailpitTimestamp)));
  assert(foundStateMsg, 'Account-aware email preview confirmed received in Mailpit');

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`STEP 2C.1 VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2C1Verification().catch(err => {
  console.error('Fatal Step 2C.1 error:', err);
  process.exit(1);
});
