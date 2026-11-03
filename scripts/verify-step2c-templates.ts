import fs from 'fs';
import http from 'http';
import path from 'path';
import { sendEmail } from '../lib/email/service';
import {
  escapeHtml,
  getAllTemplateKeys,
  hasTemplate,
  renderTemplate,
} from '../lib/email/templates';
import type {
  MilestoneFundedTemplateData,
  MilestoneReleasedTemplateData,
  ProposalAcceptedTemplateData,
  ProposalReceivedTemplateData,
  UnreadMessageTemplateData,
} from '../lib/email/templates/types';

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

async function runStep2CVerification() {
  console.log('========================================================================');
  console.log('STEP 2C: TRANSACTIONAL EMAIL TEMPLATES VERIFICATION SUITE');
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
  // 1. Registry & Key Audit
  // -------------------------------------------------------------------
  console.log('\n--- 1. Template Registry & Registration Audit ---');
  const allKeys = getAllTemplateKeys();
  assert(
    allKeys.includes('proposal_received_v1') &&
    allKeys.includes('proposal_accepted_v1') &&
    allKeys.includes('milestone_funded_v1') &&
    allKeys.includes('milestone_released_v1') &&
    allKeys.includes('unread_message_v1'),
    'All 5 template keys are registered in the registry'
  );
  assert(hasTemplate('proposal_received_v1'), 'hasTemplate() recognizes valid template key');
  assert(!hasTemplate('non_existent_key'), 'hasTemplate() correctly rejects unknown template key');

  // -------------------------------------------------------------------
  // 2. HTML & Text Rendering Verification
  // -------------------------------------------------------------------
  console.log('\n--- 2. HTML & Text Rendering Verification ---');

  // A. Proposal Received
  const propRecData: ProposalReceivedTemplateData = {
    clientName: 'Sarah Jenkins',
    freelancerName: 'Alex Rivera',
    jobTitle: 'Senior Full Stack Next.js Engineer',
    jobId: 'job-101',
    proposalId: 'prop-202',
    submissionDate: 'Nov 2, 2026',
    shortMessage: 'I have extensive experience with Next.js 16 and Supabase.',
  };
  const propRecRender = renderTemplate('proposal_received_v1', propRecData);
  assert(
    propRecRender.subject.includes('Senior Full Stack Next.js Engineer') &&
    propRecRender.html.includes('Alex Rivera') &&
    propRecRender.html.includes('job-101') &&
    propRecRender.html.includes('prop-202') &&
    propRecRender.text.includes('Alex Rivera'),
    'Template "proposal_received_v1" renders valid subject, HTML, and plain-text'
  );

  // B. Proposal Accepted
  const propAccData: ProposalAcceptedTemplateData = {
    freelancerName: 'David Chen',
    clientOrCompanyName: 'Acme Global Ventures',
    jobTitle: 'React Native Mobile Developer',
    contractId: 'contract-303',
    contractType: 'fixed',
    rateOrAmount: '$4,500.00',
    establishedDate: 'Nov 2, 2026',
  };
  const propAccRender = renderTemplate('proposal_accepted_v1', propAccData);
  assert(
    propAccRender.subject.includes('Congratulations') &&
    propAccRender.html.includes('Acme Global Ventures') &&
    propAccRender.html.includes('$4,500.00') &&
    propAccRender.html.includes('/contracts/contract-303') &&
    propAccRender.text.includes('Acme Global Ventures'),
    'Template "proposal_accepted_v1" renders valid subject, HTML, and plain-text'
  );

  // C. Milestone Funded (Simulated vs Live)
  const milestoneFundedData: MilestoneFundedTemplateData = {
    recipientName: 'Elena Rostova',
    milestoneTitle: 'Phase 1 Architecture & Database Schema',
    contractTitle: 'Fintech SaaS Platform',
    contractId: 'contract-404',
    amount: 1500,
    currency: 'USD',
    isSimulated: true,
  };
  const mFundedRender = renderTemplate('milestone_funded_v1', milestoneFundedData);
  assert(
    mFundedRender.subject.includes('Milestone Funded') &&
    mFundedRender.html.includes('$1,500.00') &&
    mFundedRender.html.includes('Simulated Escrow') &&
    mFundedRender.text.includes('SIMULATION NOTICE'),
    'Template "milestone_funded_v1" renders simulated payment disclaimer and escrow details'
  );

  // D. Milestone Released (Simulated vs Live)
  const milestoneReleasedData: MilestoneReleasedTemplateData = {
    recipientName: 'Marcus Vance',
    milestoneTitle: 'Phase 2 API Integration',
    contractTitle: 'Fintech SaaS Platform',
    contractId: 'contract-404',
    amount: 2000,
    currency: 'USD',
    isSimulated: true,
  };
  const mReleasedRender = renderTemplate('milestone_released_v1', milestoneReleasedData);
  assert(
    mReleasedRender.subject.includes('Payment Released') &&
    mReleasedRender.html.includes('$2,000.00') &&
    mReleasedRender.html.includes('Simulated Marketplace Ledger') &&
    mReleasedRender.text.includes('Simulated Marketplace Ledger'),
    'Template "milestone_released_v1" renders simulated ledger notice and release details'
  );

  // E. Unread Direct Message (Privacy Protected)
  const unreadMsgData: UnreadMessageTemplateData = {
    recipientName: 'Michael Scott',
    senderName: 'Jim Halpert',
    conversationId: 'conv-505',
    jobOrContractTitle: 'Paper Distribution Portal',
    unreadCount: 3,
  };
  const unreadRender = renderTemplate('unread_message_v1', unreadMsgData);
  assert(
    unreadRender.subject.includes('New message from Jim Halpert') &&
    unreadRender.html.includes('Jim Halpert') &&
    unreadRender.html.includes('/messages/conv-505') &&
    unreadRender.html.includes('3 unread messages') &&
    !unreadRender.html.includes('secret_private_chat_content') &&
    !unreadRender.html.includes('private_document.pdf'),
    'Template "unread_message_v1" preserves strict privacy without exposing message body or attachments'
  );

  // -------------------------------------------------------------------
  // 3. HTML Escaping & XSS Injection Protection
  // -------------------------------------------------------------------
  console.log('\n--- 3. HTML Injection & Escaping Protection ---');
  const maliciousInput = '<script>alert("xss")</script><img src=x onerror=alert(1)>"&\'';
  const escaped = escapeHtml(maliciousInput);
  assert(
    !escaped.includes('<script>') &&
    !escaped.includes('<img') &&
    escaped.includes('&lt;script&gt;') &&
    escaped.includes('&lt;img') &&
    escaped.includes('&quot;&amp;&#39;'),
    'escapeHtml() safely converts HTML tags, quotes, and ampersands to inert entity text'
  );

  const xssTestData: ProposalReceivedTemplateData = {
    clientName: 'Normal Client',
    freelancerName: '<script>alert("hacked")</script>',
    jobTitle: 'Safe Job"><b onmouseover="steal()">',
    jobId: 'job-xss',
    proposalId: 'prop-xss',
  };
  const xssRender = renderTemplate('proposal_received_v1', xssTestData);
  assert(
    !xssRender.html.includes('<script>') &&
    !xssRender.html.includes('<script alert') &&
    !xssRender.html.includes('<b onmouseover') &&
    xssRender.html.includes('&lt;script&gt;alert') &&
    xssRender.html.includes('&lt;b onmouseover='),
    'Rendered template output neutralizes HTML injection tags into inert text'
  );

  // -------------------------------------------------------------------
  // 4. Missing Required Fields Rejection
  // -------------------------------------------------------------------
  console.log('\n--- 4. Missing Required Fields Rejection ---');
  let missingClientRejected = false;
  try {
    renderTemplate('proposal_received_v1', {
      clientName: '',
      freelancerName: 'Bob',
      jobTitle: 'Job',
      jobId: 'j1',
      proposalId: 'p1',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Missing required field "clientName"')) {
      missingClientRejected = true;
    }
  }
  assert(missingClientRejected, 'Registry rejects template render when required field "clientName" is missing');

  let invalidAmountRejected = false;
  try {
    renderTemplate('milestone_funded_v1', {
      recipientName: 'Bob',
      milestoneTitle: 'Title',
      contractTitle: 'Contract',
      contractId: 'c1',
      amount: -50,
      currency: 'USD',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Missing or invalid required field "amount"')) {
      invalidAmountRejected = true;
    }
  }
  assert(invalidAmountRejected, 'Registry rejects template render when required field "amount" is negative or invalid');

  let unknownTemplateRejected = false;
  try {
    renderTemplate('unknown_fake_template', {});
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unknown or unregistered template_key')) {
      unknownTemplateRejected = true;
    }
  }
  assert(unknownTemplateRejected, 'Registry rejects unknown template keys with clear error');

  // -------------------------------------------------------------------
  // 5. Local Mailpit Dispatch Verification
  // -------------------------------------------------------------------
  console.log('\n--- 5. Local Mailpit Template Dispatch Verification ---');
  const testRunTimestamp = Date.now();
  const testRecipient = 'templates-test@workspace.local';

  // Dispatch all 5 templates to local Mailpit
  const dispatchPromises = [
    sendEmail({
      to: testRecipient,
      subject: `[Mailpit Preview 1] ${propRecRender.subject} (${testRunTimestamp})`,
      html: propRecRender.html,
      text: propRecRender.text,
    }),
    sendEmail({
      to: testRecipient,
      subject: `[Mailpit Preview 2] ${propAccRender.subject} (${testRunTimestamp})`,
      html: propAccRender.html,
      text: propAccRender.text,
    }),
    sendEmail({
      to: testRecipient,
      subject: `[Mailpit Preview 3] ${mFundedRender.subject} (${testRunTimestamp})`,
      html: mFundedRender.html,
      text: mFundedRender.text,
    }),
    sendEmail({
      to: testRecipient,
      subject: `[Mailpit Preview 4] ${mReleasedRender.subject} (${testRunTimestamp})`,
      html: mReleasedRender.html,
      text: mReleasedRender.text,
    }),
    sendEmail({
      to: testRecipient,
      subject: `[Mailpit Preview 5] ${unreadRender.subject} (${testRunTimestamp})`,
      html: unreadRender.html,
      text: unreadRender.text,
    }),
  ];

  const results = await Promise.all(dispatchPromises);
  const allDispatchedSuccessfully = results.every(r => r.success && r.provider === 'mailpit');
  assert(allDispatchedSuccessfully, 'All 5 transactional templates successfully dispatched via Nodemailer to Mailpit');

  // Query Mailpit API to verify message reception
  const messages = await fetchMailpitMessages();
  const foundPreview1 = messages.some(m => m.Subject?.includes(`[Mailpit Preview 1]`) && m.Subject.includes(String(testRunTimestamp)));
  const foundPreview2 = messages.some(m => m.Subject?.includes(`[Mailpit Preview 2]`) && m.Subject.includes(String(testRunTimestamp)));
  const foundPreview3 = messages.some(m => m.Subject?.includes(`[Mailpit Preview 3]`) && m.Subject.includes(String(testRunTimestamp)));
  const foundPreview4 = messages.some(m => m.Subject?.includes(`[Mailpit Preview 4]`) && m.Subject.includes(String(testRunTimestamp)));
  const foundPreview5 = messages.some(m => m.Subject?.includes(`[Mailpit Preview 5]`) && m.Subject.includes(String(testRunTimestamp)));

  assert(
    foundPreview1 && foundPreview2 && foundPreview3 && foundPreview4 && foundPreview5,
    'All 5 template emails confirmed received and parsed in Mailpit inbox'
  );

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`STEP 2C VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2CVerification().catch(err => {
  console.error('Fatal Step 2C verification error:', err);
  process.exit(1);
});
