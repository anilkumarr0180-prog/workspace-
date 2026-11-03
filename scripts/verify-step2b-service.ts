import fs from 'fs';
import http from 'http';
import path from 'path';
import { Resend } from 'resend';
import { ResendEmailAdapter } from '../lib/email/adapters/resend-adapter';
import { processOutboxBatch } from '../lib/email/outbox-processor';
import { getEmailAdapter, sendEmail } from '../lib/email/service';
import type { EmailAdapter, SendEmailOptions, SendEmailResult } from '../lib/email/types';
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

async function runStep2BVerification() {
  console.log('========================================================================');
  console.log('STEP 2B: UNIFIED DUAL-ENVIRONMENT EMAIL SERVICE VERIFICATION');
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
  // 1. Local Development Email Dispatch (Nodemailer -> Mailpit)
  // -------------------------------------------------------------------
  console.log('\n--- 1. Local Mailpit Dispatch & Verification ---');
  const testSubject = `Step 2B Verification ${Date.now()}`;
  const testRecipient = 'verify-step2b@workspace.local';

  const localResult = await sendEmail({
    to: testRecipient,
    subject: testSubject,
    text: 'Test plain text content for Step 2B',
    html: '<p>Test <strong>HTML</strong> content for Step 2B</p>',
  });

  assert(
    localResult.success === true && localResult.provider === 'mailpit' && !!localResult.providerMessageId,
    'sendEmail() dispatched email via Mailpit provider and returned providerMessageId',
    JSON.stringify(localResult)
  );

  // Poll Mailpit API to confirm receipt
  let mailpitFound = false;
  try {
    const messages = await fetchMailpitMessages();
    const match = messages.find((m: MailpitMessageSummary) => m.Subject === testSubject);
    if (match) {
      mailpitFound = true;
    }
  } catch (err: unknown) {
    console.error('Mailpit fetch error:', err);
  }
  assert(mailpitFound, 'Email was confirmed present in Mailpit API inbox');

  // -------------------------------------------------------------------
  // 2. Strict Environment Isolation & Production Mode Enforcement
  // -------------------------------------------------------------------
  console.log('\n--- 2. Production Environment Isolation & Fallback Prevention ---');
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProvider = process.env.EMAIL_PROVIDER;
  const originalResendKey = process.env.RESEND_API_KEY;

  try {
    // Test: In production, EMAIL_PROVIDER=mailpit is strictly rejected
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'mailpit';

    let prodMailpitRejected = false;
    try {
      getEmailAdapter();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Prohibited EMAIL_PROVIDER="mailpit" in production')) {
        prodMailpitRejected = true;
      }
    }
    assert(prodMailpitRejected, 'Production mode explicitly prohibits EMAIL_PROVIDER="mailpit"');

    // Test: In production, missing RESEND_API_KEY throws immediately
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;

    let missingResendKeyRejected = false;
    try {
      getEmailAdapter();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Missing or invalid RESEND_API_KEY in production')) {
        missingResendKeyRejected = true;
      }
    }
    assert(missingResendKeyRejected, 'Production mode requires RESEND_API_KEY and never falls back silently');

    // Test: In development, unsupported provider throws
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'sendgrid_unsupported';

    let unsupportedRejected = false;
    try {
      getEmailAdapter();
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unsupported EMAIL_PROVIDER="sendgrid_unsupported"')) {
        unsupportedRejected = true;
      }
    }
    assert(unsupportedRejected, 'Unsupported provider names are rejected with clear error');
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    process.env.EMAIL_PROVIDER = originalProvider;
    process.env.RESEND_API_KEY = originalResendKey;
  }

  // -------------------------------------------------------------------
  // 3. Mocked Resend Adapter Verification
  // -------------------------------------------------------------------
  console.log('\n--- 3. Mocked Resend Adapter Verification ---');
  interface MockResendPayload {
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
  }
  let capturedResendPayload: MockResendPayload | null = null;

  // Create a mock Resend client that simulates successful dispatch without hitting real API
  const mockResendSuccess = {
    emails: {
      send: async (payload: MockResendPayload) => {
        capturedResendPayload = payload;
        return {
          data: { id: 're_mock_test_msg_98765' },
          error: null,
        };
      },
    },
  } as unknown as Resend;

  const resendSuccessAdapter = new ResendEmailAdapter('re_dummy_test_key_for_mocking_only', mockResendSuccess);
  const resendResult = await resendSuccessAdapter.sendEmail({
    to: 'customer@client.com',
    subject: 'Proposal Accepted Notification',
    text: 'Your proposal was accepted!',
    html: '<p>Your proposal was accepted!</p>',
  });

  assert(
    resendResult.success === true &&
    resendResult.provider === 'resend' &&
    resendResult.providerMessageId === 're_mock_test_msg_98765',
    'ResendEmailAdapter correctly parses success response and returns providerMessageId'
  );

  const verifiedPayload = capturedResendPayload as MockResendPayload | null;
  assert(
    verifiedPayload?.to?.[0] === 'customer@client.com' &&
    verifiedPayload?.subject === 'Proposal Accepted Notification' &&
    verifiedPayload?.text === 'Your proposal was accepted!' &&
    verifiedPayload?.html === '<p>Your proposal was accepted!</p>',
    'ResendEmailAdapter correctly constructed all Resend API request fields'
  );

  // Test Resend error response handling
  const mockResendFailure = {
    emails: {
      send: async () => ({
        data: null,
        error: { message: 'Domain not verified. You can only send to your own registered email address.' },
      }),
    },
  } as unknown as Resend;

  const resendFailureAdapter = new ResendEmailAdapter('re_dummy_test_key_for_mocking_only', mockResendFailure);
  const resendFailResult = await resendFailureAdapter.sendEmail({
    to: 'unverified@example.com',
    subject: 'Test Subject',
    text: 'Test content',
  });

  assert(
    resendFailResult.success === false &&
    resendFailResult.provider === 'resend' &&
    Boolean(resendFailResult.error?.includes('Domain not verified')),
    'ResendEmailAdapter cleanly catches and surfaces Resend API errors without throwing'
  );

  // -------------------------------------------------------------------
  // 4. Outbox Integration & Batch Processing
  // -------------------------------------------------------------------
  console.log('\n--- 4. Outbox Integration & Batch Processing ---');
  const supabase = getAdminSupabaseClient();

  // Purge any preexisting test rows in outbox
  await supabase.from('email_outbox').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const itemSuccessKey = `ob_success_${Date.now()}`;
  const itemFailKey = `ob_fail_${Date.now()}`;

  // Insert two outbox records:
  // Item 1: normal deliverable email
  // Item 2: designed to fail via failing custom adapter
  const { data: insertedRecords, error: insertError } = await supabase
    .from('email_outbox')
    .insert([
      {
        event_type: 'proposal_shortlisted',
        template_key: 'proposal_shortlisted_v1',
        recipient_email: 'freelancer-ok@workspace.local',
        subject: 'Your proposal was shortlisted!',
        payload: { text: 'Congratulations, your proposal was shortlisted for review.' },
        idempotency_key: itemSuccessKey,
        status: 'pending',
      },
      {
        event_type: 'proposal_shortlisted',
        template_key: 'proposal_shortlisted_v1',
        recipient_email: 'freelancer-fail@workspace.local',
        subject: 'Failing Delivery Test',
        payload: { text: 'This item is destined to simulate provider failure.' },
        idempotency_key: itemFailKey,
        status: 'pending',
      },
    ])
    .select();

  assert(
    insertError === null && insertedRecords?.length === 2,
    'Enqueued 2 test records into public.email_outbox via service_role'
  );

  // Define a hybrid test adapter: succeeds for freelancer-ok, fails for freelancer-fail
  const hybridAdapter: EmailAdapter = {
    name: 'test',
    async sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
      const recipient = Array.isArray(opts.to) ? opts.to[0] : opts.to;
      if (recipient.includes('fail')) {
        return {
          success: false,
          provider: 'test',
          error: 'Simulated 503 Provider Gateway Timeout',
        };
      }
      return {
        success: true,
        provider: 'test',
        providerMessageId: `msg_accepted_${Date.now()}`,
      };
    },
  };

  // Process batch
  const batchResult = await processOutboxBatch(
    { batchSize: 10, workerId: 'test-batch-worker', retryDelaySeconds: 30 },
    hybridAdapter
  );

  assert(
    batchResult.claimedCount === 2 &&
    batchResult.sentCount === 1 &&
    batchResult.failedCount === 1,
    'processOutboxBatch processed batch: 1 sent, 1 failed, failure did not halt the batch'
  );

  // Verify database record states
  const { data: dbRecords } = await supabase
    .from('email_outbox')
    .select('*')
    .in('idempotency_key', [itemSuccessKey, itemFailKey]);

  const successDbRecord = dbRecords?.find(r => r.idempotency_key === itemSuccessKey);
  const failDbRecord = dbRecords?.find(r => r.idempotency_key === itemFailKey);

  assert(
    successDbRecord?.status === 'sent' &&
    successDbRecord?.provider === 'test' &&
    !!successDbRecord?.provider_message_id &&
    successDbRecord?.locked_at === null &&
    successDbRecord?.locked_by === null,
    'Successful outbox record transitioned to status=sent with provider details and locks released'
  );

  assert(
    failDbRecord?.status === 'failed' &&
    failDbRecord?.attempts === 1 &&
    failDbRecord?.last_error?.includes('Simulated 503 Provider Gateway Timeout') &&
    failDbRecord?.locked_at === null &&
    failDbRecord?.locked_by === null,
    'Failed outbox record transitioned to status=failed with attempts=1, sanitized error, and locks released'
  );

  // Clean up test rows
  await supabase.from('email_outbox').delete().in('idempotency_key', [itemSuccessKey, itemFailKey]);
  const { count: finalCount } = await supabase.from('email_outbox').select('*', { count: 'exact', head: true });
  assert(finalCount === 0, 'Cleaned up all outbox test rows; table is clean');

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`STEP 2B VERIFICATION COMPLETE: ${passed}/${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStep2BVerification().catch(err => {
  console.error('Step 2B verification failed with fatal error:', err);
  process.exit(1);
});
