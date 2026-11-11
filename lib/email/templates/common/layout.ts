import { escapeHtml } from './utils';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email template layout cannot be loaded in the browser.');
}

export interface EmailLayoutOptions {
  title: string;
  previewText?: string;
  heading: string;
  badgeText?: string;
  badgeColor?: 'emerald' | 'amber' | 'blue' | 'slate';
  contentHtml: string;
  contentText: string;
  ctaButton?: {
    text: string;
    url: string;
  };
  detailsHtml?: string;
  detailsText?: string;
  helperHtml?: string;
  helperText?: string;
  currentYear?: number;
}

export interface RenderedEmailLayout {
  html: string;
  text: string;
}

export function renderEmailLayout(options: EmailLayoutOptions): RenderedEmailLayout {
  const currentYear = options.currentYear || new Date().getFullYear();
  const safeTitle = escapeHtml(options.title);
  const safeHeading = escapeHtml(options.heading);
  const safePreview = escapeHtml(options.previewText || options.title);
  const safeBadgeText = options.badgeText ? escapeHtml(options.badgeText) : '';

  // Badge background and text colors
  let badgeBg = '#ecfdf5';
  let badgeColor = '#059669';
  let badgeBorder = '#a7f3d0';

  if (options.badgeColor === 'amber') {
    badgeBg = '#fffbeb';
    badgeColor = '#d97706';
    badgeBorder = '#fde68a';
  } else if (options.badgeColor === 'blue') {
    badgeBg = '#eff6ff';
    badgeColor = '#2563eb';
    badgeBorder = '#bfdbfe';
  } else if (options.badgeColor === 'slate') {
    badgeBg = '#f1f5f9';
    badgeColor = '#475569';
    badgeBorder = '#cbd5e1';
  }

  // HTML CTA Button
  const ctaButtonHtml = options.ctaButton
    ? `
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 28px 0 20px 0;">
        <tr>
          <td align="center" bgcolor="#059669" style="border-radius: 8px;">
            <a href="${escapeHtml(options.ctaButton.url)}" target="_blank" rel="noopener noreferrer" style="font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-weight: 600; color: #ffffff; text-decoration: none; padding: 13px 26px; border-radius: 8px; display: inline-block; background-color: #059669; border: 1px solid #047857; letter-spacing: 0.2px;">
              ${escapeHtml(options.ctaButton.text)} &rarr;
            </a>
          </td>
        </tr>
      </table>
      <p style="margin: 0 0 20px 0; font-size: 12px; line-height: 18px; color: #94a3b8; word-break: break-all;">
        If the button does not open, visit this link directly:<br/>
        <a href="${escapeHtml(options.ctaButton.url)}" target="_blank" rel="noopener noreferrer" style="color: #059669; text-decoration: underline;">
          ${escapeHtml(options.ctaButton.url)}
        </a>
      </p>
    `
    : '';

  // Badge HTML
  const badgeHtml = safeBadgeText
    ? `
      <div style="margin-bottom: 16px;">
        <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 6px; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">
          ${safeBadgeText}
        </span>
      </div>
    `
    : '';

  // Details box HTML
  const detailsBoxHtml = options.detailsHtml
    ? `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
        ${options.detailsHtml}
      </div>
    `
    : '';

  // Helper notice HTML
  const helperNoticeHtml = options.helperHtml
    ? `
      <div style="margin: 20px 0; padding: 12px 16px; background-color: #f1f5f9; border-left: 3px solid #64748b; border-radius: 0 6px 6px 0; font-size: 13px; line-height: 20px; color: #475569;">
        ${options.helperHtml}
      </div>
    `
    : '';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${safeTitle}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; margin: 0 !important; }
      .email-body { padding: 24px 18px !important; }
      .email-header { padding: 24px 18px 16px 18px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <!-- Preview Text Spacing Trick -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
    ${safePreview}
  </div>

  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f8fafc" role="presentation" style="table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 32px 12px 48px 12px;">
        <!-- Email Container -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" role="presentation" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);">
          
          <!-- Header -->
          <tr>
            <td class="email-header" align="left" style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9; background-color: #ffffff;">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align: middle;">
                    <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #059669 0%, #10b981 100%); text-align: center; line-height: 32px; font-weight: 800; color: #ffffff; font-size: 18px; display: inline-block;">
                      W
                    </div>
                  </td>
                  <td style="padding-left: 10px; vertical-align: middle;">
                    <span style="font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #0f172a; text-decoration: none;">
                      Work<span style="color: #059669;">space</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td class="email-body" style="padding: 32px; text-align: left;">
              ${badgeHtml}
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; line-height: 28px; color: #0f172a; letter-spacing: -0.3px;">
                ${safeHeading}
              </h1>

              <div style="font-size: 15px; line-height: 24px; color: #334155;">
                ${options.contentHtml}
              </div>

              ${detailsBoxHtml}
              ${ctaButtonHtml}
              ${helperNoticeHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px 28px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: left; font-size: 12px; line-height: 18px; color: #64748b;">
              <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">
                Workspace Marketplace Notifications
              </p>
              <p style="margin: 0 0 8px 0;">
                You received this transactional email notification regarding activity on your Workspace account. This is an essential service communication and cannot be unsubscribed from.
              </p>
              <p style="margin: 0; color: #94a3b8;">
                &copy; ${currentYear} Workspace Inc. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Construct structured plain text
  let text = `========================================================================\n`;
  text += `WORKSPACE — FREELANCE MARKETPLACE\n`;
  text += `========================================================================\n\n`;

  if (options.badgeText) {
    text += `[${options.badgeText.toUpperCase()}]\n\n`;
  }

  text += `${options.heading.toUpperCase()}\n\n`;
  text += `${options.contentText}\n\n`;

  if (options.detailsText) {
    text += `------------------------------------------------------------------------\n`;
    text += `${options.detailsText}\n`;
    text += `------------------------------------------------------------------------\n\n`;
  }

  if (options.ctaButton) {
    text += `ACTION REQUIRED / VIEW DETAILS:\n`;
    text += `${options.ctaButton.text}: ${options.ctaButton.url}\n\n`;
  }

  if (options.helperText) {
    text += `NOTE: ${options.helperText}\n\n`;
  }

  text += `========================================================================\n`;
  text += `You received this transactional notification regarding your Workspace account.\n`;
  text += `(c) ${currentYear} Workspace Inc. All rights reserved.\n`;
  text += `========================================================================\n`;

  return { html, text };
}
