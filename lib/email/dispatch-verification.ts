import { Resend } from 'resend';
import { renderVerificationEmail, VerificationEmailData } from './templates/verification-email';
import { NodemailerEmailAdapter } from './adapters/nodemailer-adapter';

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
 * Gracefully attempts Resend first, then local SMTP/Nodemailer, and fails safely without blocking signup.
 */
export async function dispatchVerificationEmail(
  data: VerificationEmailData
): Promise<DispatchVerificationResult> {
  const rendered = renderVerificationEmail(data);
  const recipient = data.email.trim();

  // 1. Try Resend if RESEND_API_KEY is configured
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const hasResend =
    resendApiKey &&
    !resendApiKey.includes('your_resend_api_key') &&
    resendApiKey.length > 5;

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

      // If domain verification failed on custom domain (e.g. notifications@workspace.com not verified on free tier Resend),
      // gracefully retry with Resend's default onboarding sender: onboarding@resend.dev
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
        console.log(
          `[VerificationEmail] Verification email dispatched successfully via Resend (ID: ${response.data.id}) to ${recipient}`
        );
        return {
          success: true,
          provider: 'resend',
          id: response.data.id,
        };
      }

      if (response.error) {
        console.warn(
          `[VerificationEmail] Resend delivery notice: ${response.error.message}`
        );
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

  // 2. Try standard SMTP if SMTP_HOST is configured (works in any environment: SendGrid, Brevo, AWS SES, Gmail, etc.)
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost && !smtpHost.includes('your_smtp_host')) {
    try {
      const nodemailer = await import('nodemailer');
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const secure = process.env.SMTP_SECURE === 'true' || port === 465;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });

      const smtpFrom =
        process.env.SMTP_FROM ||
        process.env.RESEND_FROM_EMAIL ||
        'Workspace <notifications@workspace.com>';

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipient,
        subject: 'Verify your Workspace account',
        html: rendered.html,
        text: rendered.text,
      });

      if (info?.messageId) {
        console.log(
          `[VerificationEmail] Verification email dispatched successfully via SMTP (${smtpHost}) to ${recipient}`
        );
        return {
          success: true,
          provider: 'smtp',
          id: info.messageId,
        };
      }
    } catch (smtpErr: unknown) {
      const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      console.warn(`[VerificationEmail] SMTP exception: ${msg}`);
    }
  }

  // 3. In non-production or when local SMTP is configured, try Nodemailer (Mailpit)
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    try {
      const adapter = new NodemailerEmailAdapter();
      const result = await adapter.sendEmail({
        to: recipient,
        subject: 'Verify your Workspace account',
        html: rendered.html,
        text: rendered.text,
        from: process.env.LOCAL_EMAIL_FROM || 'Workspace <no-reply@workspace.local>',
      });

      if (result.success) {
        console.log(
          `[VerificationEmail] Verification email dispatched locally via Nodemailer to ${recipient}`
        );
        return {
          success: true,
          provider: 'nodemailer',
          id: result.providerMessageId,
        };
      }
    } catch (localErr: unknown) {
      const msg = localErr instanceof Error ? localErr.message : String(localErr);
      console.warn(`[VerificationEmail] Local SMTP attempt notice: ${msg}`);
    }
  }

  // 3. Fallback / unconfigured SMTP notice
  console.warn(
    `[VerificationEmail] Live email service not configured for ${recipient}. OTP: ${data.otp}`
  );

  return {
    success: false,
    provider: 'none',
    error: 'Live SMTP provider unconfigured or pending domain verification.',
  };
}

