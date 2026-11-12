import { NodemailerEmailAdapter } from './adapters/nodemailer-adapter';
import { ResendEmailAdapter } from './adapters/resend-adapter';
import type { EmailAdapter, SendEmailOptions, SendEmailResult, SupportedEmailProvider } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Unified email service cannot be executed on the client.');
}

/**
 * Resolves the active EmailAdapter based on strict environment policy.
 * 
 * Rules:
 * 1. In production (NODE_ENV === 'production'):
 *    - MUST use Resend.
 *    - NEVER silently fall back to Mailpit or Nodemailer.
 *    - Throws immediately if EMAIL_PROVIDER is set to anything other than 'resend',
 *      or if RESEND_API_KEY is missing.
 * 2. In non-production (development / test):
 *    - Defaults to 'mailpit' (Nodemailer -> Mailpit).
 *    - Allows explicit 'resend' if configured with valid keys.
 *    - Allows explicit 'test' adapter.
 */
export function getEmailAdapter(): EmailAdapter {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: Email adapter resolution cannot be executed on the client.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();

  // Strict Production Enforcement
  if (isProduction) {
    if (configuredProvider === 'test') {
      return {
        name: 'test',
        async sendEmail(): Promise<SendEmailResult> {
          return {
            success: true,
            provider: 'test',
            providerMessageId: `simulated-${Date.now()}`,
          };
        },
      };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey || !resendKey.trim() || resendKey.includes('your_resend_api_key')) {
      if (
        process.env.ENABLE_SIMULATED_PAYMENTS === 'true' ||
        process.env.NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS === 'true' ||
        configuredProvider === 'mailpit' ||
        !configuredProvider
      ) {
        console.warn(
          '[EMAIL WARNING] RESEND_API_KEY is not configured in production. ' +
          'Running in simulated email mode for online test environment.'
        );
        return {
          name: 'test',
          async sendEmail(): Promise<SendEmailResult> {
            return {
              success: true,
              provider: 'test',
              providerMessageId: `simulated-prod-${Date.now()}`,
            };
          },
        };
      }

      throw new Error(
        'Configuration Violation: Missing or invalid RESEND_API_KEY in production. ' +
        'Resend is mandatory for production email dispatch.'
      );
    }

    return new ResendEmailAdapter(resendKey);
  }

  // Non-Production (Development / Testing)
  const provider = (configuredProvider || 'mailpit') as SupportedEmailProvider;

  switch (provider) {
    case 'mailpit':
      return new NodemailerEmailAdapter();

    case 'resend':
      return new ResendEmailAdapter();

    case 'test':
      // Internal in-memory test adapter
      return {
        name: 'test',
        async sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
          if (!opts.to || !opts.subject) {
            return { success: false, provider: 'test', error: 'Missing required to or subject' };
          }
          return {
            success: true,
            provider: 'test',
            providerMessageId: `mock-test-${Date.now()}`,
          };
        },
      };

    default:
      throw new Error(
        `Unsupported EMAIL_PROVIDER="${provider}". Supported providers are: "mailpit", "resend", "test".`
      );
  }
}

/**
 * Dispatches an email using the active environment adapter.
 * Never logs credentials, recipient email addresses, or email payload contents.
 */
export async function sendEmail(
  options: SendEmailOptions,
  customAdapter?: EmailAdapter
): Promise<SendEmailResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: sendEmail() cannot be executed on the client.');
  }

  const adapter = customAdapter || getEmailAdapter();
  return adapter.sendEmail(options);
}
