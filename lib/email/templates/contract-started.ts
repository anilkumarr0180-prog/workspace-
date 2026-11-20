import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { ContractStartedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderContractStartedTemplate(data: ContractStartedTemplateData): RenderedEmail {
  if (!data.recipientName || !data.recipientName.trim()) {
    throw new Error('Template Error [contract_started_v1]: Missing required field "recipientName".');
  }
  if (!data.counterpartName || !data.counterpartName.trim()) {
    throw new Error('Template Error [contract_started_v1]: Missing required field "counterpartName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [contract_started_v1]: Missing required field "jobTitle".');
  }
  if (!data.contractId || !data.contractId.trim()) {
    throw new Error('Template Error [contract_started_v1]: Missing required field "contractId".');
  }

  const isClient = data.role === 'client';
  const subject = `Contract Active: Collaboration begun for "${data.jobTitle}"`;
  const contractTypeDisplay = data.contractType === 'hourly' ? 'Hourly Contract' : 'Fixed-Price Contract';
  const establishedDate = data.establishedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contentHtml = isClient
    ? `
      <p style="margin: 0 0 16px 0;">
        Hello <strong>${escapeHtml(data.recipientName)}</strong>,
      </p>
      <p style="margin: 0 0 16px 0;">
        Great news! <strong>${escapeHtml(data.counterpartName)}</strong> has accepted your contract offer for <strong>${escapeHtml(data.jobTitle)}</strong>.
      </p>
      <p style="margin: 0;">
        Your contract is now officially active. You can fund project milestones into secure escrow, review timesheets, and track deliverable progress in your contract workspace.
      </p>
    `
    : `
      <p style="margin: 0 0 16px 0;">
        Hello <strong>${escapeHtml(data.recipientName)}</strong>,
      </p>
      <p style="margin: 0 0 16px 0;">
        Your contract with <strong>${escapeHtml(data.counterpartName)}</strong> for <strong>${escapeHtml(data.jobTitle)}</strong> is now active!
      </p>
      <p style="margin: 0;">
        You can now track work, log hours or milestone submissions, and collaborate securely in your contract room.
      </p>
    `;

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">${isClient ? 'Specialist' : 'Client'}:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.counterpartName)}</td>
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
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Agreed Rate:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">${escapeHtml(data.rateOrAmount)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Activated:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(establishedDate)}</td>
      </tr>
    </table>
  `;

  const contentText = isClient
    ? `Hello ${data.recipientName},\n\nGreat news! ${data.counterpartName} has accepted your contract offer for "${data.jobTitle}".\n\nContract Type: ${contractTypeDisplay}\nRate: ${data.rateOrAmount}\nActivated: ${establishedDate}`
    : `Hello ${data.recipientName},\n\nYour contract with ${data.counterpartName} for "${data.jobTitle}" is now active!\n\nContract Type: ${contractTypeDisplay}\nRate: ${data.rateOrAmount}\nActivated: ${establishedDate}`;

  const detailsText = `${isClient ? 'Specialist' : 'Client'}: ${data.counterpartName}\nProject: ${data.jobTitle}\nType: ${contractTypeDisplay}\nRate: ${data.rateOrAmount}\nActivated: ${establishedDate}`;

  const ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
  const helperNotice = 'Remember: Workspace Payment Protection covers all payments funded into milestone escrow or logged through the work diary.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Contract Activated',
    badgeText: 'Contract Active',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'Open Contract Workspace',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

