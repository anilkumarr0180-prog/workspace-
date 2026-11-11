import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions, SentMessageInfo, Address } from 'nodemailer';

// Strictly enforce server-only environment
if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Local email transport cannot be executed in the browser.');
}

export interface SendLocalEmailInput {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

export interface SendLocalEmailResult {
  success: boolean;
  messageId?: string;
  accepted?: (string | Address)[];
  rejected?: (string | Address)[];
  response?: string;
  error?: string;
}

let cachedTransporter: Transporter<SentMessageInfo> | null = null;

/**
 * Creates or retrieves the cached Nodemailer SMTP transporter for local Mailpit testing.
 * Reuses the existing connection rather than opening a new socket for every email.
 */
export function getLocalTransporter(): Transporter<SentMessageInfo> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: Local email transport cannot be executed in the browser.');
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  const host = process.env.LOCAL_SMTP_HOST || '127.0.0.1';
  const port = parseInt(process.env.LOCAL_SMTP_PORT || '54325', 10);
  const secure = process.env.LOCAL_SMTP_SECURE === 'true';

  if (!host || isNaN(port) || port <= 0) {
    throw new Error(`Invalid local SMTP configuration: host="${host}", port="${port}"`);
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ignoreTLS: true,
  });

  return cachedTransporter;
}

/**
 * Verifies TCP/SMTP connection readiness to Mailpit.
 */
export async function verifyLocalSmtpConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = getLocalTransporter();
    await transporter.verify();
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'SMTP verification failed',
    };
  }
}

/**
 * Sends an email through local Mailpit SMTP.
 * Sanitized: Never logs sensitive recipient data or email body content.
 */
export async function sendLocalEmail(input: SendLocalEmailInput): Promise<SendLocalEmailResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: Local email transport cannot be executed in the browser.');
  }

  if (!input.to || (Array.isArray(input.to) && input.to.length === 0)) {
    return { success: false, error: 'Recipient "to" address is required.' };
  }

  if (!input.subject || !input.subject.trim()) {
    return { success: false, error: 'Email subject is required.' };
  }

  if (!input.text && !input.html) {
    return { success: false, error: 'Email body (text or html) is required.' };
  }

  try {
    const transporter = getLocalTransporter();
    const defaultFrom = process.env.LOCAL_EMAIL_FROM || 'Workspace <no-reply@workspace.local>';

    const mailOptions: SendMailOptions = {
      from: input.from || defaultFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    };

    const info = await transporter.sendMail(mailOptions);

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send local email via SMTP';
    return {
      success: false,
      error: message,
    };
  }
}
