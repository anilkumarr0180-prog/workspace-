import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ContractOfferTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderContractOfferTemplate(data: ContractOfferTemplateData): RenderedEmail {
  if (!data.freelancerName || !data.freelancerName.trim()) {
    throw new Error('Template Error [contract_offer_v1]: Missing required field "freelancerName".');
  }
  if (!data.clientName || !data.clientName.trim()) {
    throw new Error('Template Error [contract_offer_v1]: Missing required field "clientName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [contract_offer_v1]: Missing required field "jobTitle".');
  }
  if (!data.contractId || !data.contractId.trim()) {
    throw new Error('Template Error [contract_offer_v1]: Missing required field "contractId".');
  }

  const subject = `Offer Received: New contract terms proposed for "${data.jobTitle}"`;
  const contractTypeDisplay = data.contractType === 'hourly' ? 'Hourly Contract' : 'Fixed-Price Contract';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.freelancerName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      Congratulations! <strong>${escapeHtml(data.clientName)}</strong> has sent you an official contract offer for <strong>${escapeHtml(data.jobTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      Please review the agreed rate, scope, and timeline. You can accept the offer directly to begin work under Workspace payment protection.
    </p>
  `;

  const messageRow = data.offerMessage?.trim()
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Client Message:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155; font-style: italic;">&ldquo;${escapeHtml(data.offerMessage.trim())}&rdquo;</td>
      </tr>
    `
    : '';

  const expiryRow = data.expiresAt
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Offer Expiration:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #e11d48; font-weight: 500;">${escapeHtml(data.expiresAt)}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Client:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.clientName)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Project:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Contract Type:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(contractTypeDisplay)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Agreed Rate / Price:</td>
        <td style="padding: 4px 0; font-size: 15px; font-weight: 700; color: #059669;">${escapeHtml(data.rateOrAmount)}</td>
      </tr>
      ${messageRow}
      ${expiryRow}
    </table>
  `;

  const contentText = `Hello ${data.freelancerName},\n\nCongratulations! ${data.clientName} has sent you a contract offer for "${data.jobTitle}".\n\nContract Type: ${contractTypeDisplay}\nRate / Price: ${data.rateOrAmount}\n${data.offerMessage ? `Client Message: "${data.offerMessage}"\n` : ''}`;

  let detailsText = `Client: ${data.clientName}\nProject: ${data.jobTitle}\nContract Type: ${contractTypeDisplay}\nRate / Price: ${data.rateOrAmount}`;
  if (data.offerMessage) detailsText += `\nMessage: ${data.offerMessage}`;

  const ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
  const helperNotice = 'Accepting this offer establishes an active contract. Only perform work and deliver files through Workspace to maintain full escrow protection.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Contract Offer Received',
    badgeText: 'Offer Pending',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'Review & Accept Offer',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

