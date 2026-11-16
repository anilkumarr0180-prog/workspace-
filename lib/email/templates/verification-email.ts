import { renderEmailLayout } from './common/layout';
import { escapeHtml } from './common/utils';
import type { RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export interface VerificationEmailData {
  recipientName: string;
  email: string;
  otp: string;
  actionLink: string;
  role?: 'client' | 'freelancer';
}

export function renderVerificationEmail(data: VerificationEmailData): RenderedEmail {
  const safeName = escapeHtml(data.recipientName || 'there');
  const safeOtp = escapeHtml(data.otp);
  const safeEmail = escapeHtml(data.email);
  const isClient = data.role === 'client';

  const roleText = isClient
    ? 'hire exceptional independent professionals and build your business'
    : 'find high-impact work, collaborate with global clients, and build your career';

  const contentHtml = `
    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; color: #1e293b;">
      Hello <strong>${safeName}</strong>,
    </p>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 24px; color: #334155;">
      Welcome to <strong>Workspace</strong>! You are just one step away from joining our marketplace to ${roleText}.
    </p>
    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 24px; color: #334155;">
      Please use the 6-digit verification code below to verify your email address (<strong>${safeEmail}</strong>) and activate your account:
    </p>

    <!-- Prominent OTP Code Box -->
    <div style="margin: 28px 0; padding: 24px 20px; background-color: #f0fdf4; border: 2px dashed #10b981; border-radius: 12px; text-align: center;">
      <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #047857;">
        Your 6-Digit Verification Code
      </p>
      <div style="font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #065f46; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, monospace; margin: 10px 0;">
        ${safeOtp}
      </div>
      <p style="margin: 8px 0 0 0; font-size: 13px; color: #059669; font-weight: 500;">
        Enter this code in your browser to complete verification. Valid for 1 hour.
      </p>
    </div>

    <p style="margin: 24px 0 12px 0; font-size: 14px; line-height: 22px; color: #475569;">
      Alternatively, you can verify your account immediately by clicking the button below:
    </p>
  `;

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Account Email:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${safeEmail}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Account Type:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">
          ${isClient ? 'Client (Hiring Talent)' : 'Freelancer (Finding Work)'}
        </td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Code Validity:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">60 minutes</td>
      </tr>
    </table>
  `;

  const contentText = [
    `Hello ${data.recipientName || 'there'},`,
    '',
    `Welcome to Workspace! Please verify your email address (${data.email}) to activate your account.`,
    '',
    `YOUR 6-DIGIT VERIFICATION CODE:`,
    `${data.otp}`,
    '',
    `Enter this code on the verification screen, or click the direct activation link below:`,
    `${data.actionLink}`,
    '',
    `This verification code will expire in 60 minutes.`,
  ].join('\n');

  const subject = 'Verify your Workspace account';

  const layout = renderEmailLayout({
    title: subject,
    previewText: `Your Workspace verification code is ${data.otp}`,
    heading: 'Verify your email address',
    badgeText: 'Account Verification',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    ctaButton: {
      text: 'Verify Email & Activate Account',
      url: data.actionLink,
    },
    detailsHtml,
    detailsText: `Account: ${data.email} | Type: ${isClient ? 'Client' : 'Freelancer'} | Code: ${data.otp}`,
    helperHtml:
      'If you did not create an account on Workspace, please ignore this email. Your email address will not be activated without this verification.',
    helperText:
      'If you did not sign up for Workspace, you can safely disregard this message.',
  });

  return {
    subject,
    html: layout.html,
    text: layout.text,
  };
}
