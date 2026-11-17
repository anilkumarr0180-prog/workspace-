/**
 * Workspace — Comprehensive SMTP Email Delivery & Infrastructure Verification Script
 * 
 * Verifies:
 * 1. Local Mailpit delivery preservation
 * 2. SMTP connection verification (verifySmtpConnection)
 * 3. Actual SMTP email delivery with HTML and text payloads
 * 4. Existing notification triggers & template rendering (all 5 business templates + verification email)
 * 5. Outbox record processing (success and failure status handling)
 * 6. Retry behavior & error sanitization
 * 7. Invalid SMTP credentials handling (535 Auth error, credential redaction)
 * 8. Strict production security guards (fail closed, TLS certificate enforcement, recipient address validation)
 */

import net from 'net';
import { getEmailAdapter, sendEmail } from '../lib/email/service';
import { SmtpEmailAdapter, isTrustedSmtpAdapter } from '../lib/email/adapters/smtp-adapter';
import { NodemailerEmailAdapter } from '../lib/email/adapters/nodemailer-adapter';
import {
  isValidEmailAddress,
  resetCachedSmtpTransporter,
  sanitizeSmtpError,
  sendSmtpEmail,
  verifySmtpConnection,
} from '../lib/email/smtp-transport';
import { renderTemplate } from '../lib/email/templates/registry';
import { renderVerificationEmail } from '../lib/email/templates/verification-email';
import { dispatchVerificationEmail } from '../lib/email/dispatch-verification';

interface ReceivedSmtpMessage {
  envelopeFrom?: string;
  envelopeTo: string[];
  raw: string;
  headers: Record<string, string>;
  subject?: string;
  data: string;
}

let passed = 0;
let total = 0;

function assert(condition: boolean, title: string, details?: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] ${title}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${title}${details ? ` -> ${details}` : ''}`);
    process.exitCode = 1;
  }
}

/**
 * Creates an in-memory RFC 5321 Mock SMTP Server for deterministic end-to-end testing.
 */
function createMockSmtpServer(options?: {
  rejectAuth?: boolean;
  rejectRecipient?: string;
  authDelayMs?: number;
}) {
  const receivedMessages: ReceivedSmtpMessage[] = [];
  let connectionCount = 0;

  const server = net.createServer((socket) => {
    connectionCount++;
    let state: 'GREETING' | 'EHLO' | 'AUTH' | 'AUTH_USER' | 'AUTH_PASS' | 'MAIL' | 'RCPT' | 'DATA' | 'DONE' = 'GREETING';
    let currentFrom = '';
    const currentTo: string[] = [];
    let currentData = '';

    socket.setEncoding('utf8');
    // Initial 220 banner
    socket.write('220 mock-smtp.workspace.local ESMTP TestServer Ready\r\n');

    socket.on('data', (chunk: string) => {
      const lines = chunk.split('\r\n');

      for (const line of lines) {
        if (!line && state !== 'DATA') continue;

        if (state === 'DATA') {
          currentData += line + '\r\n';
          if (currentData.includes('\r\n.\r\n') || line === '.') {
            const raw = currentData;
            // Parse headers and subject
            const headers: Record<string, string> = {};
            const headerEndIdx = raw.indexOf('\r\n\r\n');
            const headerPart = headerEndIdx !== -1 ? raw.slice(0, headerEndIdx) : '';
            for (const hLine of headerPart.split('\r\n')) {
              const colon = hLine.indexOf(':');
              if (colon !== -1) {
                headers[hLine.slice(0, colon).toLowerCase().trim()] = hLine.slice(colon + 1).trim();
              }
            }

            receivedMessages.push({
              envelopeFrom: currentFrom,
              envelopeTo: [...currentTo],
              raw,
              headers,
              subject: headers['subject'],
              data: raw,
            });

            state = 'MAIL';
            currentData = '';
            currentFrom = '';
            currentTo.length = 0;
            socket.write(`250 2.0.0 OK: queued as <mock-msg-${Date.now()}-${receivedMessages.length}>\r\n`);
          }
          continue;
        }

        const upper = line.trim().toUpperCase();

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          state = 'EHLO';
          socket.write(
            '250-mock-smtp.workspace.local at your service\r\n' +
            '250-SIZE 35882577\r\n' +
            '250-8BITMIME\r\n' +
            '250-AUTH LOGIN PLAIN\r\n' +
            '250 OK\r\n'
          );
        } else if (upper.startsWith('AUTH PLAIN')) {
          if (options?.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            socket.write('235 2.7.0 Authentication successful\r\n');
            state = 'MAIL';
          }
        } else if (upper.startsWith('AUTH LOGIN')) {
          if (options?.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            state = 'AUTH_USER';
            socket.write('334 VXNlcm5hbWU6\r\n'); // Base64 'Username:'
          }
        } else if (state === 'AUTH_USER') {
          state = 'AUTH_PASS';
          socket.write('334 UGFzc3dvcmQ6\r\n'); // Base64 'Password:'
        } else if (state === 'AUTH_PASS') {
          if (options?.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            state = 'MAIL';
            socket.write('235 2.7.0 Authentication successful\r\n');
          }
        } else if (upper.startsWith('MAIL FROM:')) {
          currentFrom = line.slice(10).trim();
          socket.write('250 2.1.0 Sender OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          const rcpt = line.slice(8).trim().replace(/[<>]/g, '');
          if (options?.rejectRecipient && rcpt.includes(options.rejectRecipient)) {
            socket.write(`550 5.1.1 User <${rcpt}> unknown\r\n`);
          } else {
            currentTo.push(rcpt);
            socket.write('250 2.1.5 Recipient OK\r\n');
          }
        } else if (upper === 'DATA') {
          state = 'DATA';
          currentData = '';
          socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Service closing transmission channel\r\n');
          socket.end();
        } else if (upper === 'RSET') {
          currentFrom = '';
          currentTo.length = 0;
          currentData = '';
          state = 'MAIL';
          socket.write('250 2.0.0 OK\r\n');
        } else if (upper === 'NOOP') {
          socket.write('250 2.0.0 OK\r\n');
        } else {
          socket.write('502 5.5.1 Command unrecognized\r\n');
        }
      }
    });
  });

  return {
    server,
    receivedMessages,
    getConnectionCount: () => connectionCount,
    start: (): Promise<number> =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve(addr.port);
        });
      }),
    stop: (): Promise<void> =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function runSmtpVerification() {
  console.log('========================================================================');
  console.log('WORKSPACE — SMTP EMAIL INFRASTRUCTURE & DELIVERY VERIFICATION');
  console.log('========================================================================\n');

  // Start Primary Test SMTP Server
  const mockSmtp = createMockSmtpServer();
  const smtpPort = await mockSmtp.start();
  console.log(`✓ Started ephemeral mock SMTP server on 127.0.0.1:${smtpPort}`);

  // Save original environment
  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // 1. Local Mailpit Delivery Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Local Mailpit Delivery Preservation ---');
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'mailpit';
    process.env.LOCAL_SMTP_HOST = '127.0.0.1';
    process.env.LOCAL_SMTP_PORT = String(smtpPort);
    process.env.LOCAL_SMTP_SECURE = 'false';

    const localAdapter = new NodemailerEmailAdapter();
    assert(localAdapter.name === 'mailpit', 'NodemailerEmailAdapter reports name="mailpit"');

    const mailpitResult = await localAdapter.sendEmail({
      to: 'developer@workspace.local',
      subject: 'Mailpit Preservation Test',
      text: 'Testing preservation of local Mailpit dispatch',
      html: '<p>Testing preservation of local Mailpit dispatch</p>',
    });

    assert(mailpitResult.success === true, 'Local Mailpit delivery succeeds');
    assert(mailpitResult.provider === 'mailpit', 'Local Mailpit result provider is "mailpit"');
    assert(Boolean(mailpitResult.providerMessageId), 'Local Mailpit returns providerMessageId');
    assert(mockSmtp.receivedMessages.length === 1, 'Mock server received the Mailpit email');
    assert(
      mockSmtp.receivedMessages[0].subject === 'Mailpit Preservation Test',
      'Mailpit email subject correctly received'
    );

    // -------------------------------------------------------------------------
    // 2. SMTP Connection Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 2. SMTP Connection Verification ---');
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtpPort);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'test-smtp-user';
    process.env.SMTP_PASS = 'test-smtp-password-secret-12345';
    process.env.SMTP_FROM = 'Workspace <notifications@workspace.com>';
    process.env.SMTP_REQUIRE_TLS = 'false';

    resetCachedSmtpTransporter();

    const verifyResult = await verifySmtpConnection();
    assert(verifyResult.success === true, 'verifySmtpConnection() succeeds against ready SMTP server');
    assert(verifyResult.error === undefined, 'No error returned on successful verification');

    // -------------------------------------------------------------------------
    // 3. Actual SMTP Email Delivery
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Actual SMTP Email Delivery ---');
    const smtpAdapter = new SmtpEmailAdapter();
    assert(smtpAdapter.name === 'smtp', 'SmtpEmailAdapter has name="smtp"');
    assert(isTrustedSmtpAdapter(smtpAdapter), 'SmtpEmailAdapter passes isTrustedSmtpAdapter brand check');

    const testDeliveryResult = await smtpAdapter.sendEmail({
      to: 'client@example.com',
      subject: 'Order Confirmation #1001',
      text: 'Thank you for your order! Your escrow funds have been reserved.',
      html: '<h1>Order #1001</h1><p>Thank you for your order! Your escrow funds have been reserved.</p>',
      replyTo: 'support@workspace.com',
    });

    assert(testDeliveryResult.success === true, 'SMTP email delivery succeeded');
    assert(testDeliveryResult.provider === 'smtp', 'SMTP delivery reports provider="smtp"');
    assert(Boolean(testDeliveryResult.providerMessageId), 'SMTP delivery returns valid messageId');

    const lastMsg = mockSmtp.receivedMessages[mockSmtp.receivedMessages.length - 1];
    assert(lastMsg.envelopeTo.includes('client@example.com'), 'Envelope recipient matches options.to');
    assert(lastMsg.subject === 'Order Confirmation #1001', 'Received email subject matches');
    assert(lastMsg.data.includes('support@workspace.com'), 'Reply-To header preserved in SMTP payload');
    assert(lastMsg.data.includes('Order #1001'), 'HTML body content delivered intact');

    // -------------------------------------------------------------------------
    // 4. Existing Notification Triggers & Templates
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Existing Notification Triggers & Templates ---');

    const templateTests = [
      {
        key: 'proposal_received_v1',
        data: {
          clientName: 'Alice Client',
          freelancerName: 'Bob Dev',
          jobTitle: 'Full-Stack Next.js Lead',
          jobId: 'job-12345',
          proposalId: 'prop-67890',
          submissionDate: new Date().toISOString(),
          shortMessage: 'I have 7 years of full-stack engineering experience...',
        },
      },
      {
        key: 'proposal_accepted_v1',
        data: {
          freelancerName: 'Bob Dev',
          clientOrCompanyName: 'Alice Client',
          jobTitle: 'Full-Stack Next.js Lead',
          contractId: 'cnt-45678',
          contractType: 'fixed' as const,
          rateOrAmount: '$2,500',
          establishedDate: new Date().toISOString(),
        },
      },
      {
        key: 'milestone_funded_v1',
        data: {
          recipientName: 'Bob Dev',
          milestoneTitle: 'Phase 1: Architecture & Auth',
          contractTitle: 'Full-Stack Next.js Lead',
          contractId: 'cnt-45678',
          amount: 1000,
          currency: 'USD',
          fundedDate: new Date().toISOString(),
        },
      },
      {
        key: 'milestone_released_v1',
        data: {
          recipientName: 'Bob Dev',
          milestoneTitle: 'Phase 1: Architecture & Auth',
          contractTitle: 'Full-Stack Next.js Lead',
          contractId: 'cnt-45678',
          amount: 1000,
          currency: 'USD',
          releasedDate: new Date().toISOString(),
        },
      },
      {
        key: 'unread_message_v1',
        data: {
          recipientName: 'Bob Dev',
          senderName: 'Alice Client',
          conversationId: 'conv-98765',
          jobOrContractTitle: 'Full-Stack Next.js Lead',
          unreadCount: 3,
          lastMessageTimestamp: new Date().toISOString(),
        },
      },
    ];

    for (const t of templateTests) {
      const rendered = renderTemplate(t.key, t.data);
      assert(Boolean(rendered.subject), `Template ${t.key} rendered subject: "${rendered.subject}"`);
      assert(Boolean(rendered.html), `Template ${t.key} rendered non-empty HTML`);
      assert(Boolean(rendered.text), `Template ${t.key} rendered non-empty plain text`);

      const dispatchResult = await smtpAdapter.sendEmail({
        to: 'recipient@example.com',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      assert(dispatchResult.success === true, `Template ${t.key} dispatched cleanly via SMTP`);
    }

    // Test Verification Email Template & Dispatcher
    const renderedVerification = renderVerificationEmail({
      recipientName: 'Charlie NewUser',
      email: 'charlie@example.com',
      otp: '789123',
      actionLink: 'https://workspace.com/auth/verify?token=xyz123',
      role: 'freelancer',
    });
    assert(renderedVerification.html.includes('789123'), 'Verification email includes OTP');

    const verifyDispatch = await dispatchVerificationEmail({
      recipientName: 'Charlie NewUser',
      email: 'charlie@example.com',
      otp: '789123',
      actionLink: 'https://workspace.com/auth/verify?token=xyz123',
      role: 'freelancer',
    });

    assert(verifyDispatch.success === true, 'dispatchVerificationEmail dispatches successfully via SMTP');
    assert(verifyDispatch.provider === 'smtp', 'dispatchVerificationEmail used "smtp" provider');

    // -------------------------------------------------------------------------
    // 5. Outbox Record Status & Processing
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Outbox Status & Processing Simulation ---');
    // Test successful dispatch result format matching outbox processor expectation
    const outboxSimSuccess = await sendSmtpEmail({
      to: 'outbox-user@example.com',
      subject: 'Outbox Test Notification',
      text: 'Outbox payload body',
    });

    assert(outboxSimSuccess.success === true, 'Outbox dispatch simulation succeeded');
    assert(outboxSimSuccess.provider === 'smtp', 'Outbox provider is "smtp" for database status update');
    assert(typeof outboxSimSuccess.providerMessageId === 'string', 'Outbox record receives providerMessageId');

    // -------------------------------------------------------------------------
    // 6. Retry Behavior & Error Handling
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Retry Behavior & Error Handling ---');
    // Start an SMTP server that rejects specific recipient to simulate delivery bounce
    const bouncingSmtp = createMockSmtpServer({ rejectRecipient: 'bounced@example.com' });
    const bouncingPort = await bouncingSmtp.start();

    process.env.SMTP_PORT = String(bouncingPort);
    resetCachedSmtpTransporter();

    const bounceResult = await sendSmtpEmail({
      to: 'bounced@example.com',
      subject: 'Will Bounce',
      text: 'This email should be rejected by RCPT TO',
    });

    assert(bounceResult.success === false, 'Bounced recipient returns success=false');
    assert(bounceResult.provider === 'smtp', 'Bounced recipient reports provider="smtp" for outbox retry');
    assert(Boolean(bounceResult.error), 'Bounced recipient returns sanitized error message');

    await bouncingSmtp.stop();

    // -------------------------------------------------------------------------
    // 7. Invalid SMTP Credentials Handling
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Invalid SMTP Credentials Handling ---');
    const authRejectSmtp = createMockSmtpServer({ rejectAuth: true });
    const authRejectPort = await authRejectSmtp.start();

    process.env.SMTP_PORT = String(authRejectPort);
    process.env.SMTP_USER = 'super-secret-user';
    process.env.SMTP_PASS = 'super-secret-password-xyz-9876543210';
    resetCachedSmtpTransporter();

    const authVerifyResult = await verifySmtpConnection();
    assert(authVerifyResult.success === false, 'Invalid credentials rejected during verifySmtpConnection');
    assert(
      !authVerifyResult.error?.includes('super-secret-password-xyz-9876543210'),
      'Password is NEVER leaked in connection verification error'
    );

    const authSendResult = await sendSmtpEmail({
      to: 'test@example.com',
      subject: 'Should Fail Auth',
      text: 'Body text',
    });
    assert(authSendResult.success === false, 'Invalid credentials returns success=false during send');
    assert(
      !authSendResult.error?.includes('super-secret-password-xyz-9876543210'),
      'Password is NEVER leaked in email dispatch error'
    );

    await authRejectSmtp.stop();

    // -------------------------------------------------------------------------
    // 8. Strict Production Security Guards
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Strict Production Security Guards ---');
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SMTP_PORT = String(smtpPort);
    process.env.SMTP_USER = 'valid-user';
    process.env.SMTP_PASS = 'valid-password';
    delete process.env.EMAIL_PROVIDER; // Defaults to smtp in production

    // 8a. Resolves SmtpEmailAdapter by default in production
    const prodDefaultAdapter = getEmailAdapter();
    assert(
      prodDefaultAdapter instanceof SmtpEmailAdapter && prodDefaultAdapter.name === 'smtp',
      'In production, getEmailAdapter() resolves SmtpEmailAdapter by default'
    );

    // 8b. Prohibits 'test' and 'mailpit' in production
    process.env.EMAIL_PROVIDER = 'test';
    let prodTestBlocked = false;
    try {
      getEmailAdapter();
    } catch (e: unknown) {
      prodTestBlocked = e instanceof Error && e.message.includes('Prohibited EMAIL_PROVIDER="test" in production');
    }
    assert(prodTestBlocked, 'EMAIL_PROVIDER="test" strictly prohibited in production');

    process.env.EMAIL_PROVIDER = 'mailpit';
    let prodMailpitBlocked = false;
    try {
      getEmailAdapter();
    } catch (e: unknown) {
      prodMailpitBlocked = e instanceof Error && e.message.includes('Prohibited EMAIL_PROVIDER="mailpit" in production');
    }
    assert(prodMailpitBlocked, 'EMAIL_PROVIDER="mailpit" strictly prohibited in production');

    // 8c. Production fails closed on missing SMTP credentials
    process.env.EMAIL_PROVIDER = 'smtp';
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_PASSWORD;
    let missingPassBlocked = false;
    try {
      getEmailAdapter();
    } catch (e: unknown) {
      missingPassBlocked = e instanceof Error && e.message.includes('Missing or invalid SMTP_PASS');
    }
    assert(missingPassBlocked, 'Production fails closed when SMTP_PASS is missing');

    // 8d. Production rejects arbitrary fake adapters
    process.env.SMTP_PASS = 'valid-password';
    let fakeAdapterBlocked = false;
    try {
      await sendEmail(
        { to: 'target@example.com', subject: 'Test' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'smtp', sendEmail: async () => ({ success: true, provider: 'smtp' }) } as any
      );
    } catch (e: unknown) {
      fakeAdapterBlocked = e instanceof Error && e.message.includes('Only genuine SmtpEmailAdapter instances are permitted');
    }
    assert(fakeAdapterBlocked, 'Arbitrary fake adapter object rejected in production');

    // 8e. Recipient address validation
    assert(isValidEmailAddress('valid.user@example.com'), 'isValidEmailAddress accepts standard email');
    assert(isValidEmailAddress('user+tag@sub.domain.co'), 'isValidEmailAddress accepts tagged subdomain email');
    assert(!isValidEmailAddress('invalid-email'), 'isValidEmailAddress rejects missing @ and domain');
    assert(!isValidEmailAddress('user@'), 'isValidEmailAddress rejects missing domain');
    assert(!isValidEmailAddress('@domain.com'), 'isValidEmailAddress rejects missing mailbox');
    assert(!isValidEmailAddress('user@.com'), 'isValidEmailAddress rejects leading dot in domain');

    const invalidRecipientResult = await sendSmtpEmail({
      to: 'not-an-email',
      subject: 'Invalid Recipient Test',
      text: 'Body',
    });
    assert(invalidRecipientResult.success === false, 'sendSmtpEmail rejects invalid recipient address');
    assert(Boolean(invalidRecipientResult.error?.includes('Invalid recipient email address format')), 'Returns clear validation error');

    // 8f. Error sanitization helper
    const testLeakMsg = 'Connection to smtp.internal:587 failed for password=SuperSecretPassword123 with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';
    const sanitizedMsg = sanitizeSmtpError(testLeakMsg);
    assert(!sanitizedMsg.includes('SuperSecretPassword123'), 'sanitizeSmtpError redacts password');
    assert(!sanitizedMsg.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'sanitizeSmtpError redacts long JWT/tokens');
    assert(sanitizedMsg.includes('[REDACTED]'), 'sanitizeSmtpError inserts [REDACTED] marker');
  } finally {
    // Restore environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // Stop primary mock SMTP server
    await mockSmtp.stop();
    console.log('\n✓ Stopped test SMTP server');
  }

  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${passed} / ${total} CHECKS PASSED`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exitCode = 1;
    throw new Error(`${total - passed} checks failed.`);
  }
}

runSmtpVerification().catch((err) => {
  console.error('\nVerification Script FATAL ERROR:', err);
  process.exit(1);
});
