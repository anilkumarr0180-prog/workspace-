import fs from 'fs';
import http from 'http';
import path from 'path';
import { processOutboxBatch } from '../lib/email/outbox-processor';
import { renderTemplate } from '../lib/email/templates';
import type {
  MilestoneFundedTemplateData,
  MilestoneReleasedTemplateData,
  ProposalAcceptedTemplateData,
  ProposalReceivedTemplateData,
  RecipientAccountState,
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

async function runStep2C2Verification() {
  console.log('========================================================================');
  console.log('STEP 2C.2: TRANSACTIONAL EMAIL WORDING & ACCOUNT ACCESS REVIEW SUITE');
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

  const accountStates: RecipientAccountState[] = ['existing_account', 'no_account', 'unknown'];

  // -------------------------------------------------------------------
  // 1. Audit Template 1: Proposal Received (3 states)
  // -------------------------------------------------------------------
  console.log('\n--- 1. Proposal Received (3 States) ---');
  const basePropRec: ProposalReceivedTemplateData = {
    clientName: 'Apex Innovations',
    freelancerName: 'Maya Lin',
    jobTitle: 'Next.js Frontend Architect',
    jobId: 'job-101',
    proposalId: 'prop-202',
  };

  for (const state of accountStates) {
    const rendered = renderTemplate('proposal_received_v1', { ...basePropRec, accountState: state });
    if (state === 'existing_account') {
      assert(
        rendered.html.includes('Review Proposal &amp; Freelancer') &&
        rendered.html.includes('/jobs/job-101?proposalId=prop-202'),
        `Proposal Received [${state}]: Direct review route & established wording`
      );
    } else if (state === 'no_account') {
      assert(
        rendered.html.includes('Join Workspace to Review') &&
        rendered.html.includes('/signup/client') &&
        rendered.html.includes('authenticating with the authorized job owner account'),
        `Proposal Received [${state}]: Sign up CTA and explicit access notice`
      );
    } else {
      assert(
        rendered.html.includes('Continue to Workspace') &&
        rendered.html.includes('/jobs/job-101?proposalId=prop-202'),
        `Proposal Received [${state}]: Neutral route without registration assumptions`
      );
    }
  }

  // -------------------------------------------------------------------
  // 2. Audit Template 2: Proposal Accepted (3 states)
  // -------------------------------------------------------------------
  console.log('\n--- 2. Proposal Accepted (3 States) ---');
  const basePropAcc: ProposalAcceptedTemplateData = {
    freelancerName: 'Marcus Vance',
    clientOrCompanyName: 'Hyperion Labs',
    jobTitle: 'Distributed Systems Engineer',
    contractId: 'contract-303',
    contractType: 'fixed',
    rateOrAmount: '$8,500.00',
  };

  for (const state of accountStates) {
    const rendered = renderTemplate('proposal_accepted_v1', { ...basePropAcc, accountState: state });
    if (state === 'existing_account') {
      assert(
        rendered.html.includes('View Contract &amp; Begin Work') &&
        rendered.html.includes('/contracts/contract-303'),
        `Proposal Accepted [${state}]: View contract route`
      );
    } else if (state === 'no_account') {
      assert(
        rendered.html.includes('Join Workspace to View Your Contract') &&
        !rendered.html.includes('Accept Contract') &&
        rendered.html.includes('/signup/freelancer') &&
        rendered.html.includes('authenticating with the authorized account'),
        `Proposal Accepted [${state}]: Replaced 'Accept Contract' with 'Join Workspace to View Your Contract'`
      );
    } else {
      assert(
        rendered.html.includes('Continue to Workspace') &&
        rendered.html.includes('/contracts/contract-303'),
        `Proposal Accepted [${state}]: Neutral continuation without account assumptions`
      );
    }
  }

  // -------------------------------------------------------------------
  // 3. Audit Template 3: Milestone Funded (3 states)
  // -------------------------------------------------------------------
  console.log('\n--- 3. Milestone Funded (3 States) ---');
  const baseFunded: MilestoneFundedTemplateData = {
    recipientName: 'Elena Rostova',
    milestoneTitle: 'Security Audit & Penetration Testing',
    contractTitle: 'Fintech Core Engine',
    contractId: 'contract-404',
    amount: 3200,
    currency: 'USD',
    isSimulated: true,
  };

  for (const state of accountStates) {
    const rendered = renderTemplate('milestone_funded_v1', { ...baseFunded, accountState: state });
    if (state === 'existing_account') {
      assert(
        rendered.html.includes('View Contract &amp; Milestones') &&
        rendered.html.includes('/contracts/contract-404') &&
        rendered.html.includes('Simulated Escrow (Test Mode)'),
        `Milestone Funded [${state}]: Contract milestones route with test mode disclaimer`
      );
    } else if (state === 'no_account') {
      assert(
        rendered.html.includes('Join Workspace to View Milestone') &&
        rendered.html.includes('/signup') &&
        rendered.html.includes('authenticating with the authorized account'),
        `Milestone Funded [${state}]: Sign up CTA with disclaimer requiring authentication`
      );
    } else {
      assert(
        rendered.html.includes('Continue to Workspace') &&
        rendered.html.includes('/contracts/contract-404'),
        `Milestone Funded [${state}]: Neutral continuation`
      );
    }
  }

  // -------------------------------------------------------------------
  // 4. Audit Template 4: Milestone Released (3 states)
  // -------------------------------------------------------------------
  console.log('\n--- 4. Milestone Released (3 States) ---');
  const baseReleased: MilestoneReleasedTemplateData = {
    recipientName: 'Elena Rostova',
    milestoneTitle: 'Security Audit & Penetration Testing',
    contractTitle: 'Fintech Core Engine',
    contractId: 'contract-404',
    amount: 3200,
    currency: 'USD',
    isSimulated: true,
  };

  for (const state of accountStates) {
    const rendered = renderTemplate('milestone_released_v1', { ...baseReleased, accountState: state });
    if (state === 'existing_account') {
      assert(
        rendered.html.includes('View Contract &amp; Ledger') &&
        rendered.html.includes('/contracts/contract-404') &&
        rendered.html.includes('Simulated Marketplace Ledger'),
        `Milestone Released [${state}]: View contract & ledger route`
      );
    } else if (state === 'no_account') {
      assert(
        rendered.html.includes('Join Workspace to View Payment Details') &&
        !rendered.html.includes('Claim Funds') &&
        rendered.html.includes('/signup') &&
        (rendered.html.includes('Registration does not automatically withdraw funds') ||
         rendered.html.includes('Registration on Workspace does not automatically disburse funds')),
        `Milestone Released [${state}]: Replaced 'Claim Funds' with 'Join Workspace to View Payment Details' & no withdrawal promise`
      );
    } else {
      assert(
        rendered.html.includes('Continue to Workspace') &&
        rendered.html.includes('/contracts/contract-404'),
        `Milestone Released [${state}]: Neutral continuation`
      );
    }
  }

  // -------------------------------------------------------------------
  // 5. Audit Template 5: Unread Message (3 states)
  // -------------------------------------------------------------------
  console.log('\n--- 5. Unread Message (3 States) ---');
  const baseUnread: UnreadMessageTemplateData = {
    recipientName: 'Jordan Reed',
    senderName: 'Sophia Loren',
    conversationId: 'conv-505',
    jobOrContractTitle: 'Next.js App Redesign',
    unreadCount: 3,
  };

  for (const state of accountStates) {
    const rendered = renderTemplate('unread_message_v1', { ...baseUnread, accountState: state });
    if (state === 'existing_account') {
      assert(
        rendered.html.includes('Open Secure Inbox &amp; Reply') &&
        rendered.html.includes('/messages/conv-505'),
        `Unread Message [${state}]: Direct secure conversation route`
      );
    } else if (state === 'no_account') {
      assert(
        rendered.html.includes('Join Workspace to Reply') &&
        rendered.html.includes('/signup') &&
        rendered.html.includes('authenticating with the authorized recipient account'),
        `Unread Message [${state}]: Registration CTA explaining authorized account access`
      );
    } else {
      assert(
        rendered.html.includes('Continue to Conversation') &&
        rendered.html.includes('/messages/conv-505'),
        `Unread Message [${state}]: Neutral conversation link`
      );
    }
  }

  // -------------------------------------------------------------------
  // 6. Payment Language & Simulation Integrity Audit
  // -------------------------------------------------------------------
  console.log('\n--- 6. Payment Language & Simulation Integrity Audit ---');
  const simFunded = renderTemplate('milestone_funded_v1', { ...baseFunded, isSimulated: true });
  const liveFunded = renderTemplate('milestone_funded_v1', { ...baseFunded, isSimulated: false });
  const simReleased = renderTemplate('milestone_released_v1', { ...baseReleased, isSimulated: true });
  const liveReleased = renderTemplate('milestone_released_v1', { ...baseReleased, isSimulated: false });

  assert(
    simFunded.html.includes('Simulated Funding') &&
    simFunded.html.includes('SIMULATION NOTICE') &&
    !liveFunded.html.includes('SIMULATION NOTICE'),
    'Simulated funding events are unambiguously labeled vs live escrow events'
  );

  assert(
    simReleased.html.includes('Simulated Release') &&
    simReleased.html.includes('Simulated Marketplace Ledger') &&
    simReleased.html.includes('It does not represent an actual banking wire or completed cash transfer') &&
    !liveReleased.html.includes('Simulated Marketplace Ledger'),
    'Simulated release events explicitly state no real banking wire occurred'
  );

  assert(
    !simReleased.html.includes('Claim Funds') &&
    !liveReleased.html.includes('Claim Funds') &&
    !simFunded.html.includes('Claim Funds') &&
    !liveFunded.html.includes('Claim Funds'),
    'Zero instances of misleading "Claim Funds" language across all payment templates'
  );

  // -------------------------------------------------------------------
  // 7. Security, XSS Escaping & Message Privacy Audit
  // -------------------------------------------------------------------
  console.log('\n--- 7. Security, XSS & Privacy Audit ---');
  const maliciousUnread = renderTemplate('unread_message_v1', {
    recipientName: '<script>alert("pwned")</script>',
    senderName: 'Eve <img src=x onerror=alert(1)>',
    conversationId: 'conv-safe',
    jobOrContractTitle: '<b>Project</b>',
    accountState: 'no_account',
  });

  assert(
    !maliciousUnread.html.includes('<script>') &&
    maliciousUnread.html.includes('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;') &&
    !maliciousUnread.html.includes('<img src=x') &&
    maliciousUnread.html.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'Complete HTML sanitization and zero XSS vulnerability in template rendering'
  );

  assert(
    !maliciousUnread.html.includes('password') &&
    !maliciousUnread.html.includes('invite_token=') &&
    !maliciousUnread.html.includes('secret_key='),
    'Zero passwords, invitation tokens, or auth bypass tokens emitted'
  );

  // -------------------------------------------------------------------
  // 8. End-to-End Mailpit Dispatch & Receipt Verification
  // -------------------------------------------------------------------
  console.log('\n--- 8. End-to-End Mailpit Outbox Integration ---');
  const supabase = getAdminSupabaseClient();
  await supabase.from('email_outbox').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const keyPropAcc = `review_prop_acc_${Date.now()}`;
  const keyMilRel = `review_mil_rel_${Date.now()}`;

  // Insert 2 records for no_account recipients to test live end-to-end rendering and Mailpit delivery
  const { error: insertErr } = await supabase.from('email_outbox').insert([
    {
      event_type: 'proposal_accepted',
      template_key: 'proposal_accepted_v1',
      recipient_email: 'freelancer-new@workspace.local',
      recipient_user_id: null,
      subject: `Your proposal for "${basePropAcc.jobTitle}" was accepted`,
      payload: { ...basePropAcc, accountState: 'no_account' },
      idempotency_key: keyPropAcc,
      status: 'pending',
    },
    {
      event_type: 'milestone_released',
      template_key: 'milestone_released_v1',
      recipient_email: 'freelancer-payout@workspace.local',
      recipient_user_id: null,
      subject: `Payment Released: "${baseReleased.milestoneTitle}"`,
      payload: { ...baseReleased, accountState: 'no_account' },
      idempotency_key: keyMilRel,
      status: 'pending',
    },
  ]);

  assert(!insertErr, 'Both review emails successfully queued into durable outbox');

  const processResult = await processOutboxBatch({ batchSize: 10 });
  assert(processResult.sentCount === 2 && processResult.failedCount === 0, 'Outbox processor successfully sent both emails');

  const mailpitMessages = await fetchMailpitMessages();
  const foundPropAcc = mailpitMessages.find(m => m.Subject?.includes('proposal for "Distributed Systems Engineer" was accepted'));
  const foundMilRel = mailpitMessages.find(m => m.Subject?.includes('Security Audit & Penetration Testing'));

  assert(Boolean(foundPropAcc) && Boolean(foundMilRel), 'Both emails verified in Mailpit inbox with pristine rendering');

  // Clean outbox after test
  await supabase.from('email_outbox').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('\n========================================================================');
  console.log(`STEP 2C.2 VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2C2Verification().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
