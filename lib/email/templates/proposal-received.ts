import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ProposalReceivedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderProposalReceivedTemplate(data: ProposalReceivedTemplateData): RenderedEmail {
  // Validate mandatory fields
  if (!data.clientName || !data.clientName.trim()) {
    throw new Error('Template Error [proposal_received_v1]: Missing required field "clientName".');
  }
  if (!data.freelancerName || !data.freelancerName.trim()) {
    throw new Error('Template Error [proposal_received_v1]: Missing required field "freelancerName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [proposal_received_v1]: Missing required field "jobTitle".');
  }
  if (!data.jobId || !data.jobId.trim()) {
    throw new Error('Template Error [proposal_received_v1]: Missing required field "jobId".');
  }
  if (!data.proposalId || !data.proposalId.trim()) {
    throw new Error('Template Error [proposal_received_v1]: Missing required field "proposalId".');
  }

  const subject = `New proposal received for "${data.jobTitle}"`;
  const submissionDate = data.submissionDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.clientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      A new proposal has been submitted for your job posting <strong>${escapeHtml(data.jobTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      ${escapeHtml(data.shortMessage || 'Review the freelancer profile, proposed rate, and cover letter to shortlist or start a conversation.')}
    </p>
  `;

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Freelancer:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.freelancerName)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Job Title:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Submitted Date:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(submissionDate)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.clientName},\n\nA new proposal has been submitted for your job posting "${data.jobTitle}".\n${data.shortMessage || 'Review the freelancer profile, proposed rate, and cover letter to shortlist or start a conversation.'}`;

  const detailsText = `Freelancer: ${data.freelancerName}\nJob Title: ${data.jobTitle}\nSubmitted Date: ${submissionDate}`;

  const accountState = data.accountState || 'unknown';

  let ctaText: string;
  let ctaUrl: string;
  let helperNotice: string;

  if (accountState === 'existing_account') {
    ctaText = 'Review Proposal & Freelancer';
    ctaUrl = buildAppUrl(`/jobs/${data.jobId}?proposalId=${data.proposalId}`);
    helperNotice = 'Log in to your client dashboard to review full candidate details, shortlist, or initiate an interview.';
  } else if (accountState === 'no_account') {
    ctaText = 'Join Workspace to Review';
    ctaUrl = buildAppUrl('/signup/client');
    helperNotice = 'You received this notification because a proposal was submitted for your project. Create a client account to get started on Workspace. Note: Viewing proposal submissions requires authenticating with the authorized job owner account.';
  } else {
    ctaText = 'Continue to Workspace';
    ctaUrl = buildAppUrl(`/jobs/${data.jobId}?proposalId=${data.proposalId}`);
    helperNotice = 'Access your job posting on Workspace to review candidate submissions.';
  }

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'New Proposal Received',
    badgeText: 'New Proposal',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: ctaText,
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}
