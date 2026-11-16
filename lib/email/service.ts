import { NodemailerEmailAdapter } from './adapters/nodemailer-adapter';
import { ResendEmailAdapter, isTrustedResendAdapter } from './adapters/resend-adapter';
import type { EmailAdapter, SendEmailOptions, SendEmailResult, SupportedEmailProvider } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Unified email service cannot be executed on the client.');
}

/**
 * Resolves the active EmailAdapter based on strict environment policy.
 *
 * Production Security Rules:
 * 1. In production (NODE_ENV === 'production'):
 *    - MUST explicitly require EMAIL_PROVIDER=resend.
 *    - MUST require a valid RESEND_API_KEY.
 *    - Missing or invalid configuration fails closed immediately.
 *    - EMAIL_PROVIDER=test is strictly prohibited in production.
 *    - EMAIL_PROVIDER=mailpit is strictly prohibited in production.
 *    - NEVER silently converts a provider configuration error into successful delivery.
 *    - NEVER falls back to simulated/mock delivery.
 *
 * Non-Production Rules:
 * 2. In non-production (development / test):
 *    - Defaults to 'mailpit' (Nodemailer -> Mailpit local SMTP).
 *    - Allows explicit 'resend' if configured with valid keys.
 *    - Allows explicit 'test' adapter only in permitted non-production environments (test/development).
 */
export function getEmailAdapter(): EmailAdapter {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: Email adapter resolution cannot be executed on the client.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const rawProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const configuredProvider = rawProvider && rawProvider !== 'undefined' ? rawProvider : undefined;

  // -------------------------------------------------------------------------
  // Strict Production Enforcement (Fail Closed)
  // -------------------------------------------------------------------------
  if (isProduction) {
    if (configuredProvider === 'test') {
      throw new Error(
        'Security Violation: Prohibited EMAIL_PROVIDER="test" in production. ' +
        'Simulated email dispatch is strictly forbidden in production.'
      );
    }

    if (configuredProvider === 'mailpit') {
      throw new Error(
        'Security Violation: Prohibited EMAIL_PROVIDER="mailpit" in production. ' +
        'Mailpit is strictly reserved for local development.'
      );
    }

    if (configuredProvider !== 'resend') {
      throw new Error(
        `Configuration Violation: EMAIL_PROVIDER must be explicitly set to "resend" in production. ` +
        `Received: "${configuredProvider || 'undefined'}".`
      );
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey || !resendKey.trim() || resendKey.includes('your_resend_api_key')) {
      throw new Error(
        'Configuration Violation: Missing or invalid RESEND_API_KEY in production. ' +
        'Resend is mandatory for production email dispatch.'
      );
    }

    return new ResendEmailAdapter(resendKey.trim());
  }

  // -------------------------------------------------------------------------
  // Non-Production (Development / Testing)
  // -------------------------------------------------------------------------
  const provider = (configuredProvider || 'mailpit') as SupportedEmailProvider;

  switch (provider) {
    case 'mailpit':
      return new NodemailerEmailAdapter();

    case 'resend':
      return new ResendEmailAdapter();

    case 'test': {
      // Test adapters must only work in explicitly permitted non-production environments
      const isPermittedEnv =
        process.env.NODE_ENV === 'test' ||
        process.env.NODE_ENV === 'development' ||
        process.env.APP_ENV === 'test' ||
        process.env.ALLOW_TEST_EMAIL_ADAPTER === 'true';

      if (!isPermittedEnv) {
        throw new Error(
          'Security Violation: Test email adapter is only permitted in designated test/development environments.'
        );
      }

      // Internal in-memory test adapter for verified non-production testing
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
    }

    default:
      throw new Error(
        `Unsupported EMAIL_PROVIDER="${provider}". Supported providers are: "mailpit", "resend", "test".`
      );
  }
}

/**
 * Dispatches an email using the active environment adapter.
 * Production must never report simulated email delivery as successful.
 * Never logs credentials, recipient email addresses, or email payload contents.
 */
export async function sendEmail(
  options: SendEmailOptions,
  customAdapter?: EmailAdapter
): Promise<SendEmailResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: sendEmail() cannot be executed on the client.');
  }

  const isProduction = process.env.NODE_ENV === 'production';

  let adapter: EmailAdapter;

  if (isProduction) {
    // 1. Prevent arbitrary custom email adapters from being injected in production.
    // Do NOT trust adapter.name or result.provider as proof of provider authenticity.
    if (customAdapter) {
      if (!isTrustedResendAdapter(customAdapter)) {
        throw new Error(
          'Security Violation: Cannot inject arbitrary email adapter in production. ' +
          'Only genuine ResendEmailAdapter instances are permitted.'
        );
      }
      adapter = customAdapter;
    } else {
      adapter = getEmailAdapter();
    }

    // Double-check resolved adapter authenticity in production
    if (!isTrustedResendAdapter(adapter)) {
      throw new Error(
        'Security Violation: Production email delivery requires trusted ResendEmailAdapter instance.'
      );
    }
  } else {
    // In non-production environments (development / test):
    // Preserve local Mailpit and test adapter functionality
    adapter = customAdapter || getEmailAdapter();
  }

  const result = await adapter.sendEmail(options);

  // In production, verify provider authenticity and fail closed on simulated/unexpected results
  if (isProduction) {
    if (!result.success) {
      return result;
    }
    if (result.provider !== 'resend') {
      throw new Error(
        `Security Violation: Production reported email delivery via non-resend provider "${result.provider}". Failing closed.`
      );
    }
  }

  return result;
}
