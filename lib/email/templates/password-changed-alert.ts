import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { PasswordChangedAlertTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderPasswordChangedAlertTemplate(data: PasswordChangedAlertTemplateData): RenderedEmail {
  if (!data.email || !data.email.trim()) {
    throw new Error('Template Error [password_changed_alert_v1]: Missing required field "email".');
  }

  const recipientName = data.recipientName?.trim() || data.email.split('@')[0];
  const changedAt = data.changedAt || new Date().toUTCString();
  const subject = 'Security Alert: Your Workspace password was changed';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      This email confirms that the password for your Workspace account (<strong>${escapeHtml(data.email)}</strong>) was successfully updated.
    </p>
    <p style="margin: 0;">
      All existing sessions across your devices have been signed out for security. You can now log in using your newly set password.
    </p>
  `;

  const ipRow = data.changedIp
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">IP Address:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(data.changedIp)}</td>
      </tr>
    `
    : '';

  const deviceRow = data.changedDevice
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Device / Browser:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(data.changedDevice)}</td>
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
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Time Changed:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(changedAt)}</td>
      </tr>
      ${ipRow}
      ${deviceRow}
    </table>
  `;

  const contentText = `Security Alert: Your Workspace password was changed\n\nHello ${recipientName},\n\nThe password for your Workspace account (${data.email}) was updated on ${changedAt}.\n\nIf you did NOT make this change, please contact security support immediately.`;

  let detailsText = `Account Email: ${data.email}\nTime Changed: ${changedAt}`;
  if (data.changedIp) detailsText += `\nIP Address: ${data.changedIp}`;
  if (data.changedDevice) detailsText += `\nDevice: ${data.changedDevice}`;

  const ctaUrl = buildAppUrl('/login');
  const helperNotice = 'IMPORTANT: If you did not make this change, someone else may have gained unauthorized access to your email or account. Contact support immediately to secure your account.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Password Successfully Changed',
    badgeText: 'Security Notice',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'Log In to Workspace',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

