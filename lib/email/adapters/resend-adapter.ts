import { Resend } from 'resend';
import type { EmailAdapter, SendEmailOptions, SendEmailResult } from '../types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: ResendEmailAdapter cannot be executed on the client.');
}

/**
 * Production Resend adapter communicating with Resend REST API.
 * Strictly used in production environments with verified API keys.
 */
export class ResendEmailAdapter implements EmailAdapter {
  readonly name = 'resend' as const;
  private client: Resend;
  private defaultFrom: string;

  constructor(apiKey?: string, injectedClient?: Resend) {
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: ResendEmailAdapter cannot be executed on the client.');
    }

    if (injectedClient) {
      this.client = injectedClient;
      this.defaultFrom = process.env.RESEND_FROM_EMAIL || 'Workspace <notifications@workspace.com>';
      return;
    }

    const key = apiKey || process.env.RESEND_API_KEY;
    if (!key || !key.trim() || key.includes('your_resend_api_key')) {
      throw new Error(
        'Configuration Error: Missing or invalid RESEND_API_KEY. Resend adapter cannot initialize without a valid API key.'
      );
    }

    this.defaultFrom = process.env.RESEND_FROM_EMAIL || 'Workspace <notifications@workspace.com>';
    this.client = new Resend(key.trim());
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: ResendEmailAdapter cannot be executed on the client.');
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length === 0 || !recipients[0]) {
      return {
        success: false,
        provider: this.name,
        error: 'Recipient "to" address is required.',
      };
    }

    if (!options.subject || !options.subject.trim()) {
      return {
        success: false,
        provider: this.name,
        error: 'Email subject is required.',
      };
    }

    if (!options.text && !options.html) {
      return {
        success: false,
        provider: this.name,
        error: 'Email body (text or html) is required.',
      };
    }

    try {
      const payload: Parameters<typeof this.client.emails.send>[0] = {
        from: options.from || this.defaultFrom,
        to: recipients,
        subject: options.subject,
        ...(options.html ? { html: options.html } : {}),
        ...(options.text ? { text: options.text } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      } as Parameters<typeof this.client.emails.send>[0];

      const response = await this.client.emails.send(payload);

      if (response.error) {
        // Sanitize Resend error to remove any potential keys or PII
        const errorMsg = response.error.message || 'Resend API returned delivery error';
        const sanitized = errorMsg.replace(/([a-zA-Z0-9_\-\.]{24,})/g, '[REDACTED]');
        return {
          success: false,
          provider: this.name,
          error: sanitized,
        };
      }

      if (!response.data || !response.data.id) {
        return {
          success: false,
          provider: this.name,
          error: 'Resend API succeeded without returning a provider message ID.',
        };
      }

      return {
        success: true,
        provider: this.name,
        providerMessageId: response.data.id,
      };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Unknown Resend error';
      const sanitized = rawMsg.replace(/([a-zA-Z0-9_\-\.]{24,})/g, '[REDACTED]');
      return {
        success: false,
        provider: this.name,
        error: sanitized,
      };
    }
  }
}
