import { Resend } from 'resend';
import { renderVerificationEmail } from './templates/verification-email';
import type { VerificationEmailData } from './templates/verification-email';
import { NodemailerEmailAdapter } from './adapters/nodemailer-adapter';
import { SmtpEmailAdapter } from './adapters/smtp-adapter';
import { sanitizeSmtpError } from './smtp-transport';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: dispatchVerificationEmail cannot be executed on the client.');
}

export interface DispatchVerificationResult {
  success: boolean;
  provider?: string;
  error?: string;
  id?: string;
}

/**
 * Dispatches a branded verification email containing the 6-digit OTP code and direct activation link.
 * Prioritizes Nodemailer SMTP for production delivery, falls back to Resend if configured,
 * and preserves local Mailpit for development/test.
 * Fails safely without leaking credentials, authentication tokens, or OTP codes into logs.
 */
export async function dispatchVerificationEmail(
  data: VerificationEmailData
): Promise<DispatchVerificationResult> {
  const rendered = renderVerificationEmail(data);
  const recipient = data.email.trim();

  // 1. Primary: Try Nodemailer SMTP if SMTP_HOST is configured
  const smtpHost = process.env.SMTP_HOST?.trim();
  const hasSmtp = Boolean(smtpHost && !smtpHost.includes('your_smtp_host') && smtpHost.length > 2);

  if (hasSmtp) {
    try {
      const smtpAdapter = new SmtpEmailAdapter();
      const result = await smtpAdapter.sendEmail({
        to: recipient,
        subject: 'Verify your Workspace account',
        html: rendered.html,
        text: rendered.text,
      });

      if (result.success) {
        return {
          success: true,
          provider: 'smtp',
          id: result.providerMessageId,
        };
      }

      console.warn(`[VerificationEmail] SMTP delivery notice: ${sanitizeSmtpError(result.error)}`);
    } catch (smtpErr: unknown) {
      console.warn(`[VerificationEmail] SMTP exception: ${sanitizeSmtpError(smtpErr)}`);
    }
  }

  // 2. Secondary / Legacy: Try Resend if RESEND_API_KEY is configured
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const hasResend = Boolean(
    resendApiKey &&
    !resendApiKey.includes('your_resend_api_key') &&
    resendApiKey.length > 5
  );

  if (hasResend) {
    try {
      const resend = new Resend(resendApiKey);
      const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
      const primaryFrom = configuredFrom || 'Workspace <notifications@workspace.com>';

      const sendPayload = {
        from: primaryFrom,
        to: recipient,
        subject: 'Verify your Workspace account',
        html: rendered.html,
        text: rendered.text,
      };

      let response = await resend.emails.send(sendPayload);

      // If domain verification failed on custom domain, retry via Resend default onboarding sender
      if (
        response.error &&
        response.error.message &&
        (response.error.message.toLowerCase().includes('domain') ||
          response.error.message.toLowerCase().includes('verify'))
      ) {
        console.warn(
          `[VerificationEmail] Primary sender domain unverified (${primaryFrom}). Retrying via onboarding@resend.dev...`
        );
        response = await resend.emails.send({
          ...sendPayload,
          from: 'Workspace <onboarding@resend.dev>',
        });
      }

      if (response.data?.id) {
        return {
          success: true,
          provider: 'resend',
          id: response.data.id,
        };
      }

      if (response.error) {
        console.warn(`[VerificationEmail] Resend delivery notice: ${response.error.message}`);
        return {
          success: false,
          provider: 'resend',
          error: response.error.message,
        };
      }
    } catch (resendErr: unknown) {
      const msg = resendErr instanceof Error ? resendErr.message : String(resendErr);
      console.warn(`[VerificationEmail] Resend exception: ${msg}`);
    }
  }

  // 3. Local Development / Test: Try Nodemailer (Mailpit)
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    try {
      const localAdapter = new NodemailerEmailAdapter();
      const result = await localAdapter.sendEmail({
        to: recipient,
        subject: 'Verify your Workspace account',
        html: rendered.html,
        text: rendered.text,
        from: process.env.LOCAL_EMAIL_FROM || 'Workspace <no-reply@workspace.local>',
      });

      if (result.success) {
        return {
          success: true,
          provider: 'mailpit',
          id: result.providerMessageId,
        };
      }
    } catch (localErr: unknown) {
      const msg = localErr instanceof Error ? localErr.message : String(localErr);
      console.warn(`[VerificationEmail] Local SMTP attempt notice: ${msg}`);
    }
  }

  // 4. Safe fallback notice (NEVER log raw OTP codes or sensitive credentials)
  console.warn(
    `[VerificationEmail] Live email service not configured or failed delivery for verification recipient.`
  );

  return {
    success: false,
    provider: 'none',
    error: 'Live SMTP provider unconfigured or delivery failed.',
  };
}
