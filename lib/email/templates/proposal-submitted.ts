import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ProposalSubmittedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderProposalSubmittedTemplate(data: ProposalSubmittedTemplateData): RenderedEmail {
  if (!data.freelancerName || !data.freelancerName.trim()) {
    throw new Error('Template Error [proposal_submitted_v1]: Missing required field "freelancerName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [proposal_submitted_v1]: Missing required field "jobTitle".');
  }
  if (!data.proposalId || !data.proposalId.trim()) {
    throw new Error('Template Error [proposal_submitted_v1]: Missing required field "proposalId".');
  }

  const subject = `Your proposal for "${data.jobTitle}" has been submitted`;
  const submittedDate = data.submittedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const rateTypeDisplay = data.rateType === 'hourly' ? 'Hourly Bid' : 'Fixed-Price Bid';
  const bidDisplay = typeof data.bidAmount === 'number'
    ? `$${data.bidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(data.bidAmount);

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.freelancerName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      Your proposal for <strong>${escapeHtml(data.jobTitle)}</strong> has been successfully delivered to the client.
    </p>
    <p style="margin: 0;">
      The client has been notified and can now review your profile, cover letter, and proposed terms. You will receive an email as soon as the client reviews your proposal or starts a conversation.
    </p>
  `;

  const deliveryRow = data.deliveryDays
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Estimated Delivery:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${data.deliveryDays} days</td>
      </tr>
    `
    : '';

  const clientRow = data.clientName
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Client:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(data.clientName)}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Job Title:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      ${clientRow}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Your Proposed Bid:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">${escapeHtml(bidDisplay)} (${escapeHtml(rateTypeDisplay)})</td>
      </tr>
      ${deliveryRow}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Submitted On:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(submittedDate)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.freelancerName},\n\nYour proposal for "${data.jobTitle}" has been submitted to the client.\n\nYour Proposed Bid: ${bidDisplay} (${rateTypeDisplay})\nSubmitted On: ${submittedDate}`;

  let detailsText = `Job Title: ${data.jobTitle}\nProposed Bid: ${bidDisplay} (${rateTypeDisplay})`;
  if (data.deliveryDays) detailsText += `\nEstimated Delivery: ${data.deliveryDays} days`;
  detailsText += `\nSubmitted On: ${submittedDate}`;

  const ctaUrl = buildAppUrl(`/freelancer`);
  const helperNotice = 'Track the status of all your active bids, conversations, and offers in your Freelancer Dashboard.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Proposal Submitted',
    badgeText: 'Application Sent',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'View Proposal in Dashboard',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

