import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ProposalUnderReviewTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderProposalUnderReviewTemplate(data: ProposalUnderReviewTemplateData): RenderedEmail {
  if (!data.freelancerName || !data.freelancerName.trim()) {
    throw new Error('Template Error [proposal_under_review_v1]: Missing required field "freelancerName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [proposal_under_review_v1]: Missing required field "jobTitle".');
  }

  const clientName = data.clientName?.trim() || 'The client';
  const subject = `Good news! Your proposal for "${data.jobTitle}" is under review`;
  const reviewDate = data.reviewedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.freelancerName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      <strong>${escapeHtml(clientName)}</strong> is currently reviewing your proposal for <strong>${escapeHtml(data.jobTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      Your submission has moved to the candidate review stage. Make sure your profile, portfolio samples, and message notifications are active in case the client requests a consultation meeting or sends a direct message.
    </p>
  `;

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Job Title:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Client:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(clientName)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Current Status:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #2563eb;">Under Active Review</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Review Date:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(reviewDate)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.freelancerName},\n\nGood news! ${clientName} is currently reviewing your proposal for "${data.jobTitle}".\n\nStatus: Under Active Review\nDate: ${reviewDate}`;
  const detailsText = `Job Title: ${data.jobTitle}\nClient: ${clientName}\nStatus: Under Active Review\nDate: ${reviewDate}`;

  const ctaUrl = buildAppUrl(`/freelancer`);
  const helperNotice = 'Clients usually reach out with questions, request a consultation call, or extend an offer when reviewing candidates.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Proposal Under Review',
    badgeText: 'Under Review',
    badgeColor: 'blue',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'View Proposal in Workspace',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

