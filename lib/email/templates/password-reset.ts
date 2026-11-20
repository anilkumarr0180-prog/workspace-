import { renderEmailLayout } from './common/layout';
import { escapeHtml } from './common/utils';
import type { PasswordResetTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderPasswordResetTemplate(data: PasswordResetTemplateData): RenderedEmail {
  if (!data.email || !data.email.trim()) {
    throw new Error('Template Error [password_reset_v1]: Missing required field "email".');
  }
  if (!data.actionUrl || !data.actionUrl.trim()) {
    throw new Error('Template Error [password_reset_v1]: Missing required field "actionUrl".');
  }

  const recipientName = data.recipientName?.trim() || data.email.split('@')[0];
  const expiresIn = data.expiresInMinutes || 15;
  const subject = 'Reset your Workspace password';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      We received a request to reset the password for your Workspace account (<strong>${escapeHtml(data.email)}</strong>).
    </p>
    <p style="margin: 0;">
      Click the button below to choose a new password. For your security, this password reset link will expire in <strong>${expiresIn} minutes</strong>.
    </p>
  `;

  const ipRow = data.requestedIp
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Request IP:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(data.requestedIp)}</td>
      </tr>
    `
    : '';

  const deviceRow = data.requestedDevice
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Device / Browser:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(data.requestedDevice)}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Account Email:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.email)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Link Validity:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #d97706;">Expires in ${expiresIn} minutes</td>
      </tr>
      ${ipRow}
      ${deviceRow}
    </table>
  `;

  const contentText = `Hello ${recipientName},\n\nWe received a request to reset the password for your Workspace account (${data.email}).\n\nReset your password here: ${data.actionUrl}\n\nThis link will expire in ${expiresIn} minutes. If you did not make this request, you can safely ignore this email; your password will remain unchanged.`;

  let detailsText = `Account Email: ${data.email}\nValidity: ${expiresIn} minutes`;
  if (data.requestedIp) detailsText += `\nRequest IP: ${data.requestedIp}`;
  if (data.requestedDevice) detailsText += `\nDevice: ${data.requestedDevice}`;

  const helperNotice = 'If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized access to your account.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Reset Your Password',
    badgeText: 'Security Notice',
    badgeColor: 'amber',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'Reset Password Now',
      url: data.actionUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

