import type { Transporter, SentMessageInfo } from 'nodemailer';
import { getSmtpConfig, sendSmtpEmail, verifySmtpConnection } from '../smtp-transport';
import type { EmailAdapter, SendEmailOptions, SendEmailResult } from '../types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: SmtpEmailAdapter cannot be executed on the client.');
}

/**
 * Unique symbol brand confirming adapter authenticity.
 * Prevents arbitrary object literals or mock classes from impersonating the trusted SMTP adapter.
 */
export const TRUSTED_SMTP_BRAND = Symbol.for('workspace.email.trusted_smtp_adapter.v1');

/**
 * Production Nodemailer SMTP adapter communicating with authenticated SMTP relays
 * (e.g. AWS SES, SendGrid, Brevo, Postmark, Google Workspace, Mailgun).
 * Strictly used in production environments and configurable for preview/testing.
 */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = 'smtp' as const;
  readonly [TRUSTED_SMTP_BRAND] = true;
  private injectedTransporter?: Transporter<SentMessageInfo>;

  constructor(injectedTransporter?: Transporter<SentMessageInfo>) {
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: SmtpEmailAdapter cannot be executed on the client.');
    }

    if (injectedTransporter) {
      this.injectedTransporter = injectedTransporter;
      return;
    }

    // Validate SMTP configuration upon initialization
    getSmtpConfig();
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: SmtpEmailAdapter cannot be executed on the client.');
    }
    return sendSmtpEmail(options, this.injectedTransporter);
  }

  async verifyConnection(): Promise<{ success: boolean; error?: string }> {
    return verifySmtpConnection(this.injectedTransporter);
  }
}

/**
 * Validates whether an object is genuinely the application's trusted SmtpEmailAdapter.
 * Cannot be impersonated by arbitrary objects or mock classes claiming name="smtp".
 */
export function isTrustedSmtpAdapter(adapter: unknown): adapter is SmtpEmailAdapter {
  if (!adapter || typeof adapter !== 'object') {
    return false;
  }
  return (
    adapter instanceof SmtpEmailAdapter &&
    (adapter as unknown as Record<symbol, unknown>)[TRUSTED_SMTP_BRAND] === true
  );
}

