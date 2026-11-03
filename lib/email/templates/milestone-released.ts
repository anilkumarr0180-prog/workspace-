import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml, formatCurrency } from './common/utils';
import type { MilestoneReleasedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderMilestoneReleasedTemplate(data: MilestoneReleasedTemplateData): RenderedEmail {
  if (!data.recipientName || !data.recipientName.trim()) {
    throw new Error('Template Error [milestone_released_v1]: Missing required field "recipientName".');
  }
  if (!data.milestoneTitle || !data.milestoneTitle.trim()) {
    throw new Error('Template Error [milestone_released_v1]: Missing required field "milestoneTitle".');
  }
  if (!data.contractTitle || !data.contractTitle.trim()) {
    throw new Error('Template Error [milestone_released_v1]: Missing required field "contractTitle".');
  }
  if (!data.contractId || !data.contractId.trim()) {
    throw new Error('Template Error [milestone_released_v1]: Missing required field "contractId".');
  }
  if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) {
    throw new Error('Template Error [milestone_released_v1]: Missing or invalid required field "amount".');
  }

  const isSimulated = data.isSimulated ?? false;
  const formattedAmount = formatCurrency(data.amount, data.currency);
  const subject = `Payment Released: "${data.milestoneTitle}" (${(data.currency || 'INR').toUpperCase()} ${data.amount})`;
  const releaseDate = data.releasedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      Work on milestone <strong>${escapeHtml(data.milestoneTitle)}</strong> has been approved, and escrow funds of <strong>${escapeHtml(formattedAmount)}</strong> have been released.
    </p>
    <p style="margin: 0;">
      ${isSimulated
        ? 'This payout has been credited to your simulated freelancer ledger balance.'
        : 'The funds have been credited to the freelancer account balance according to the contract agreement.'}
    </p>
  `;

  const simulationRow = isSimulated
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #b45309;">Settlement Rail:</td>
        <td style="padding: 4px 0; font-size: 13px; font-weight: 600; color: #b45309;">Simulated Marketplace Ledger</td>
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
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Released Amount:</td>
        <td style="padding: 4px 0; font-size: 15px; font-weight: 700; color: #059669;">${escapeHtml(formattedAmount)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Date Released:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(releaseDate)}</td>
      </tr>
      ${simulationRow}
    </table>
  `;

  const contentText = `Hello ${data.recipientName},\n\nWork on milestone "${data.milestoneTitle}" has been approved, and escrow funds of ${formattedAmount} have been released.\n${isSimulated ? 'This payout has been credited to your simulated freelancer ledger balance.' : 'The funds have been credited to the account balance.'}`;

  let detailsText = `Milestone: ${data.milestoneTitle}\nContract: ${data.contractTitle}\nReleased Amount: ${formattedAmount}\nDate Released: ${releaseDate}`;
  if (isSimulated) {
    detailsText += `\nSettlement Rail: Simulated Marketplace Ledger`;
  }

  const accountState = data.accountState || 'unknown';

  let ctaText: string;
  let ctaUrl: string;
  let helperNotice: string;

  if (accountState === 'existing_account') {
    ctaText = 'View Contract & Ledger';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This release operation was recorded on the simulated ledger. It does not represent an actual banking wire or completed cash transfer.'
      : 'You can review full transaction history and download invoices in the billing dashboard.';
  } else if (accountState === 'no_account') {
    ctaText = 'Join Workspace to View Payment Details';
    ctaUrl = buildAppUrl('/signup');
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This release was recorded on the simulated ledger and does not represent an actual banking wire. Registration does not automatically withdraw funds; sign in to view payment records.'
      : 'Registration on Workspace does not automatically disburse funds. Identity verification and payout method setup are required before funds can be withdrawn.';
  } else {
    ctaText = 'Continue to Workspace';
    ctaUrl = buildAppUrl(`/contracts/${data.contractId}`);
    helperNotice = isSimulated
      ? 'SIMULATION NOTICE: This release operation was recorded on the simulated ledger. It does not represent an actual banking wire or completed cash transfer.'
      : 'Access your contract workspace on Workspace to review payment and billing records.';
  }

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Milestone Approved & Escrow Released',
    badgeText: isSimulated ? 'Simulated Release' : 'Payment Released',
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
