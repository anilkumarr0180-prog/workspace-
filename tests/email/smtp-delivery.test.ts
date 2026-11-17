import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SmtpEmailAdapter, isTrustedSmtpAdapter } from '@/lib/email/adapters/smtp-adapter';
import { NodemailerEmailAdapter } from '@/lib/email/adapters/nodemailer-adapter';
import {
  isValidEmailAddress,
  resetCachedSmtpTransporter,
  sanitizeSmtpError,
  sendSmtpEmail,
  verifySmtpConnection,
} from '@/lib/email/smtp-transport';
import { renderTemplate } from '@/lib/email/templates/registry';
import { renderVerificationEmail } from '@/lib/email/templates/verification-email';

function createMockSmtpServer(options?: { rejectAuth?: boolean }) {
  const receivedMessages: Array<{
    envelopeFrom: string;
    envelopeTo: string[];
    raw: string;
    subject?: string;
  }> = [];

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let state = 'INIT';
    let currentFrom = '';
    const currentTo: string[] = [];
    let currentData = '';

    socket.write('220 mock-smtp.workspace.local ESMTP Mock Ready\r\n');

    socket.on('data', (chunk: string) => {
      const lines = chunk.split('\r\n');
      for (const line of lines) {
        if (!line && state !== 'DATA') continue;

        if (state === 'DATA') {
          currentData += line + '\r\n';
          if (currentData.includes('\r\n.\r\n') || line === '.') {
            const raw = currentData;
            const subjectMatch = raw.match(/^subject:\s*(.*)$/im);
            receivedMessages.push({
              envelopeFrom: currentFrom,
              envelopeTo: [...currentTo],
              raw,
              subject: subjectMatch ? subjectMatch[1].trim() : undefined,
            });
            state = 'MAIL';
            currentData = '';
            currentFrom = '';
            currentTo.length = 0;
            socket.write('250 2.0.0 OK: queued\r\n');
          }
          continue;
        }

        const upper = line.trim().toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write(
            '250-mock-smtp.workspace.local\r\n' +
            '250-AUTH LOGIN PLAIN\r\n' +
            '250-8BITMIME\r\n' +
            '250 OK\r\n'
          );
        } else if (upper.startsWith('AUTH PLAIN')) {
          if (options?.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            socket.write('235 2.7.0 Authentication successful\r\n');
          }
        } else if (upper.startsWith('AUTH LOGIN')) {
          if (options?.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            state = 'AUTH_USER';
            socket.write('334 VXNlcm5hbWU6\r\n');
          }
        } else if (state === 'AUTH_USER') {
          state = 'AUTH_PASS';
          socket.write('334 UGFzc3dvcmQ6\r\n');
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
          currentTo.push(line.slice(8).trim().replace(/[<>]/g, ''));
          socket.write('250 2.1.5 Recipient OK\r\n');
        } else if (upper === 'DATA') {
          state = 'DATA';
          currentData = '';
          socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Service closing transmission channel\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  return {
    server,
    receivedMessages,
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

test('1. Local Mailpit adapter preservation', async () => {
  const mockSmtp = createMockSmtpServer();
  const port = await mockSmtp.start();

  const origEnv = { ...process.env };
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'mailpit';
    process.env.LOCAL_SMTP_HOST = '127.0.0.1';
    process.env.LOCAL_SMTP_PORT = String(port);
    process.env.LOCAL_SMTP_SECURE = 'false';

    const adapter = new NodemailerEmailAdapter();
    assert.equal(adapter.name, 'mailpit');

    const result = await adapter.sendEmail({
      to: 'local-dev@workspace.local',
      subject: 'Mailpit Delivery Test',
      text: 'Preserving local Mailpit dispatch',
    });

    assert.equal(result.success, true);
    assert.equal(result.provider, 'mailpit');
    assert.ok(result.providerMessageId);
    assert.equal(mockSmtp.receivedMessages.length, 1);
    assert.equal(mockSmtp.receivedMessages[0].subject, 'Mailpit Delivery Test');
  } finally {
    process.env = origEnv;
    await mockSmtp.stop();
  }
});

test('2. SMTP connection verification', async () => {
  const mockSmtp = createMockSmtpServer();
  const port = await mockSmtp.start();

  const origEnv = { ...process.env };
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_REQUIRE_TLS = 'false';
    resetCachedSmtpTransporter();

    const verifyRes = await verifySmtpConnection();
    assert.equal(verifyRes.success, true);
    assert.equal(verifyRes.error, undefined);
  } finally {
    process.env = origEnv;
    await mockSmtp.stop();
  }
});

test('3. Actual SMTP email delivery with HTML and text', async () => {
  const mockSmtp = createMockSmtpServer();
  const port = await mockSmtp.start();

  const origEnv = { ...process.env };
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_FROM = 'Workspace <notifications@workspace.com>';
    process.env.SMTP_REQUIRE_TLS = 'false';
    resetCachedSmtpTransporter();

    const adapter = new SmtpEmailAdapter();
    assert.equal(adapter.name, 'smtp');
    assert.equal(isTrustedSmtpAdapter(adapter), true);

    const result = await adapter.sendEmail({
      to: 'client@example.com',
      subject: 'Invoice #1024 Available',
      text: 'Please find your invoice attached.',
      html: '<p>Please find your invoice attached.</p>',
    });

    assert.equal(result.success, true);
    assert.equal(result.provider, 'smtp');
    assert.ok(result.providerMessageId);

    assert.equal(mockSmtp.receivedMessages.length, 1);
    const msg = mockSmtp.receivedMessages[0];
    assert.deepEqual(msg.envelopeTo, ['client@example.com']);
    assert.equal(msg.subject, 'Invoice #1024 Available');
    assert.ok(msg.raw.includes('Invoice #1024 Available'));
  } finally {
    process.env = origEnv;
    await mockSmtp.stop();
  }
});

test('4. Existing notification templates dispatch via SMTP', async () => {
  const mockSmtp = createMockSmtpServer();
  const port = await mockSmtp.start();

  const origEnv = { ...process.env };
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_REQUIRE_TLS = 'false';
    resetCachedSmtpTransporter();

    const adapter = new SmtpEmailAdapter();

    // proposal_received_v1
    const pReceived = renderTemplate('proposal_received_v1', {
      clientName: 'Alice',
      freelancerName: 'Bob',
      jobTitle: 'Backend Dev',
      jobId: 'j-1',
      proposalId: 'p-1',
    });
    const res1 = await adapter.sendEmail({ to: 'alice@example.com', subject: pReceived.subject, html: pReceived.html, text: pReceived.text });
    assert.equal(res1.success, true);

    // milestone_funded_v1
    const mFunded = renderTemplate('milestone_funded_v1', {
      recipientName: 'Bob',
      milestoneTitle: 'M1',
      contractTitle: 'Job 1',
      contractId: 'c-1',
      amount: 500,
      currency: 'USD',
    });
    const res2 = await adapter.sendEmail({ to: 'bob@example.com', subject: mFunded.subject, html: mFunded.html, text: mFunded.text });
    assert.equal(res2.success, true);

    // verification email
    const vEmail = renderVerificationEmail({
      recipientName: 'Alice',
      email: 'alice@example.com',
      otp: '654321',
      actionLink: 'https://workspace.com/auth/verify',
      role: 'client',
    });
    const res3 = await adapter.sendEmail({ to: 'alice@example.com', subject: 'Verify', html: vEmail.html, text: vEmail.text });
    assert.equal(res3.success, true);

    assert.equal(mockSmtp.receivedMessages.length, 3);
  } finally {
    process.env = origEnv;
    await mockSmtp.stop();
  }
});

test('5. Invalid SMTP credentials reject and redact sensitive tokens', async () => {
  const mockSmtp = createMockSmtpServer({ rejectAuth: true });
  const port = await mockSmtp.start();

  const origEnv = { ...process.env };
  try {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'admin';
    process.env.SMTP_PASS = 'TopSecretPassword987654321';
    process.env.SMTP_REQUIRE_TLS = 'false';
    resetCachedSmtpTransporter();

    const verifyRes = await verifySmtpConnection();
    assert.equal(verifyRes.success, false);
    assert.ok(verifyRes.error);
    assert.equal(verifyRes.error.includes('TopSecretPassword987654321'), false);

    const sendRes = await sendSmtpEmail({
      to: 'client@example.com',
      subject: 'Test',
      text: 'Test body',
    });
    assert.equal(sendRes.success, false);
    assert.equal(sendRes.error?.includes('TopSecretPassword987654321'), false);
  } finally {
    process.env = origEnv;
    await mockSmtp.stop();
  }
});

test('6. Production security and recipient address validation', async () => {
  assert.equal(isValidEmailAddress('dev@workspace.com'), true);
  assert.equal(isValidEmailAddress('notanemail'), false);
  assert.equal(isValidEmailAddress('user@'), false);

  const failRecipient = await sendSmtpEmail({
    to: 'invalid-email',
    subject: 'Subject',
    text: 'Body',
  });
  assert.equal(failRecipient.success, false);
  assert.ok(failRecipient.error?.includes('Invalid recipient email address'));

  const sanitized = sanitizeSmtpError('Error at pass: TopSecretPass1234567890 token=eyJhbGciOiJIUzI1NiJ9.abc');
  assert.equal(sanitized.includes('TopSecretPass1234567890'), false);
  assert.ok(sanitized.includes('[REDACTED]'));
});
