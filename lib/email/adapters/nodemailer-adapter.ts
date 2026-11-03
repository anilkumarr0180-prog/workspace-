import { sendLocalEmail } from '../local-transporter';
import type { EmailAdapter, SendEmailOptions, SendEmailResult } from '../types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: NodemailerEmailAdapter cannot be executed on the client.');
}

/**
 * Local Nodemailer adapter routing transactional emails to Mailpit SMTP.
 * Strictly used in development and test environments.
 */
export class NodemailerEmailAdapter implements EmailAdapter {
  readonly name = 'mailpit' as const;

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: NodemailerEmailAdapter cannot be executed on the client.');
    }

    try {
      const res = await sendLocalEmail({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        from: options.from,
      });

      if (!res.success) {
        return {
          success: false,
          provider: this.name,
          error: res.error || 'Nodemailer failed to dispatch email to local SMTP.',
        };
      }

      return {
        success: true,
        provider: this.name,
        providerMessageId: res.messageId,
      };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Unknown Nodemailer error';
      // Sanitize any sensitive tokens or stack traces
      const sanitized = rawMsg.replace(/([a-zA-Z0-9_\-\.]{20,})/g, '[REDACTED]');
      return {
        success: false,
        provider: this.name,
        error: sanitized,
      };
    }
  }
}
