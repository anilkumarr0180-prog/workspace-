import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml, formatCurrency } from './common/utils';
import type { MilestoneFundedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderMilestoneFundedTemplate(data: MilestoneFundedTemplateData): RenderedEmail {
  if (!data.recipientName || !data.recipientName.trim()) {
    throw new Error('Template Error [milestone_funded_v1]: Missing required field "recipientName".');
  }
  if (!data.milestoneTitle || !data.milestoneTitle.trim()) {
    throw new Error('Template Error [milestone_funded_v1]: Missing required field "milestoneTitle".');
  }
  if (!data.contractTitle || !data.contractTitle.trim()) {
    throw new Error('Template Error [milestone_funded_v1]: Missing required field "contractTitle".');
  }
  if (!data.contractId || !data.contractId.trim()) {
    throw new Error('Template Error [milestone_funded_v1]: Missing required field "contractId".');
  }
  if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) {
    throw new Error('Template Error [milestone_funded_v1]: Missing or invalid required field "amount".');
  }

  const isSimulated = data.isSimulated ?? false;
  const formattedAmount = formatCurrency(data.amount, data.currency);
  const subject = `Milestone Funded: "${data.milestoneTitle}" on "${data.contractTitle}"`;
  const eventDate = data.fundedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      A project milestone has been funded into escrow for <strong>${escapeHtml(data.contractTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      ${isSimulated
        ? 'This milestone has been funded on the development/simulated payment rail. You can proceed with project deliverables.'
        : 'Funds are securely deposited in escrow and will be released upon milestone completion and client review.'}
    </p>
  `;

  const simulationRow = isSimulated
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #b45309;">Payment Mode:</td>
        <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #b45309;">Simulated Escrow (Test Mode)</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Milestone:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.milestoneTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Contract / Project:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.contractTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Escrow Amount:</td>
        <td style="padding: 4px 0; font-size: 15px; font-weight: 700; color: #059669;">${escapeHtml(formattedAmount)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Date Funded:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(eventDate)}</td>
      </tr>
      ${simulationRow}
    </table>
  `;

  const contentText = `Hello ${data.recipientName},\n\nA project milestone has been funded into escrow for "${data.contractTitle}".\n${isSimulated ? 'This milestone has been funded on the development/simulated payment rail.' : 'Funds are securely held in escrow.'}`;

  let detailsText = `Milestone: ${data.milestoneTitle}\nContract: ${data.contractTitle}\nEscrow Amount: ${formattedAmount}\nDate Funded: ${eventDate}`;
  if (isSimulated) {
    detailsText += `\nPayment Mode: Simulated Escrow (Test Mode)`;
  }

  const accountState = data.accountState || 'unknown';

  let ctaText: string;
  let ctaUrl: string;
  let helperNotice: string;

  if (accountState === 'existing_account') {
    ctaText = 'View Contract & Milestones';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This funding event was processed in sandbox/test mode. No real fiat funds were withdrawn from a live financial institution.'
      : 'Funds remain held securely in escrow until deliverables are submitted and approved.';
  } else if (accountState === 'no_account') {
    ctaText = 'Join Workspace to View Milestone';
    ctaUrl = buildAppUrl('/signup');
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This funding event was processed in sandbox/test mode. Create an account to get started; viewing milestone details requires authenticating with the authorized account.'
      : 'Funds remain held securely in escrow until deliverables are submitted and approved. Note: Viewing milestone details requires authenticating with the authorized account.';
  } else {
    ctaText = 'Continue to Workspace';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This funding event was processed in sandbox/test mode. No real fiat funds were withdrawn from a live financial institution.'
      : 'Access your contract workspace on Workspace to review milestones and submit deliverables.';
  }

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Milestone Funded into Escrow',
    badgeText: isSimulated ? 'Simulated Funding' : 'Escrow Funded',
    badgeColor: isSimulated ? 'amber' : 'emerald',
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
