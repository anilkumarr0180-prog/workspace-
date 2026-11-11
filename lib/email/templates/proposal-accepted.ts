import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ProposalAcceptedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderProposalAcceptedTemplate(data: ProposalAcceptedTemplateData): RenderedEmail {
  if (!data.freelancerName || !data.freelancerName.trim()) {
    throw new Error('Template Error [proposal_accepted_v1]: Missing required field "freelancerName".');
  }
  if (!data.clientOrCompanyName || !data.clientOrCompanyName.trim()) {
    throw new Error('Template Error [proposal_accepted_v1]: Missing required field "clientOrCompanyName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [proposal_accepted_v1]: Missing required field "jobTitle".');
  }
  if (!data.contractId || !data.contractId.trim()) {
    throw new Error('Template Error [proposal_accepted_v1]: Missing required field "contractId".');
  }

  const subject = `Congratulations! Your proposal for "${data.jobTitle}" was accepted`;
  const establishedDate = data.establishedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contractTypeDisplay = data.contractType === 'hourly' ? 'Hourly Contract' : 'Fixed-Price Contract';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hi <strong>${escapeHtml(data.freelancerName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      Great news! <strong>${escapeHtml(data.clientOrCompanyName)}</strong> has accepted your proposal and established a new contract for <strong>${escapeHtml(data.jobTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      Your workspace is now active. You can review the contract terms, check milestone status, and communicate directly with your client.
    </p>
  `;

  const rateRowHtml = data.rateOrAmount
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Rate / Budget:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">${escapeHtml(data.rateOrAmount)}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Client / Company:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.clientOrCompanyName)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Project:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Contract Type:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(contractTypeDisplay)}</td>
      </tr>
      ${rateRowHtml}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Established:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(establishedDate)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hi ${data.freelancerName},\n\nGreat news! ${data.clientOrCompanyName} has accepted your proposal and established a new contract for "${data.jobTitle}".\n\nYour workspace is now active. You can review the contract terms, check milestone status, and communicate directly with your client.`;

  let detailsText = `Client / Company: ${data.clientOrCompanyName}\nProject: ${data.jobTitle}\nContract Type: ${contractTypeDisplay}`;
  if (data.rateOrAmount) {
    detailsText += `\nRate / Budget: ${data.rateOrAmount}`;
  }
  detailsText += `\nEstablished: ${establishedDate}`;

  const accountState = data.accountState || 'unknown';

  let ctaText: string;
  let ctaUrl: string;
  let helperNotice: string;

  if (accountState === 'existing_account') {
    ctaText = 'View Contract & Begin Work';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = 'Always keep communication and milestone submissions within Workspace to remain protected under payment terms.';
  } else if (accountState === 'no_account') {
    ctaText = 'Join Workspace to View Your Contract';
    ctaUrl = buildAppUrl('/signup/freelancer');
    helperNotice = `Your proposal was accepted by ${data.clientOrCompanyName}. Create an account to get started on Workspace. Note: Viewing contract details and milestones requires authenticating with the authorized account.`;
  } else {
    ctaText = 'Continue to Workspace';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = 'Access your contract workspace on Workspace to review terms and milestones.';
  }

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Proposal Accepted & Contract Created',
    badgeText: 'Contract Active',
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
