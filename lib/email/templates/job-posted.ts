import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { JobPostedTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderJobPostedTemplate(data: JobPostedTemplateData): RenderedEmail {
  if (!data.clientName || !data.clientName.trim()) {
    throw new Error('Template Error [job_posted_v1]: Missing required field "clientName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [job_posted_v1]: Missing required field "jobTitle".');
  }
  if (!data.jobId || !data.jobId.trim()) {
    throw new Error('Template Error [job_posted_v1]: Missing required field "jobId".');
  }

  const subject = `Your job posting "${data.jobTitle}" is now live on Workspace`;
  const postedDate = data.postedDate || new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const projectTypeDisplay = data.projectType === 'hourly' ? 'Hourly Project' : 'Fixed-Price Project';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.clientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      Your job listing <strong>${escapeHtml(data.jobTitle)}</strong> has been successfully published on Workspace! Qualified freelancers and specialists are already discovering your posting.
    </p>
    <p style="margin: 0;">
      You will receive instant email updates whenever specialists submit proposals for your review.
    </p>
  `;

  const categoryRow = data.category
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Category:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.category)}</td>
      </tr>
    `
    : '';

  const budgetRow = data.budget
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Budget / Rate:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">${escapeHtml(data.budget)}</td>
      </tr>
    `
    : '';

  const skillsRow = data.skills && data.skills.length > 0
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Required Skills:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #334155;">${escapeHtml(data.skills.slice(0, 5).join(', '))}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Job Title:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.jobTitle)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Project Type:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(projectTypeDisplay)}</td>
      </tr>
      ${categoryRow}
      ${budgetRow}
      ${skillsRow}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Published Date:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(postedDate)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.clientName},\n\nYour job listing "${data.jobTitle}" has been successfully published on Workspace! Qualified freelancers are now reviewing your project.\n\nYou will receive updates as proposals are submitted.`;

  let detailsText = `Job Title: ${data.jobTitle}\nProject Type: ${projectTypeDisplay}`;
  if (data.category) detailsText += `\nCategory: ${data.category}`;
  if (data.budget) detailsText += `\nBudget: ${data.budget}`;
  if (data.skills?.length) detailsText += `\nSkills: ${data.skills.slice(0, 5).join(', ')}`;
  detailsText += `\nPublished: ${postedDate}`;

  const ctaUrl = buildAppUrl(`/client`);
  const helperNotice = 'You can manage incoming proposals, shortlist candidates, schedule interviews, and finalize contracts from your client dashboard.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Job Successfully Published',
    badgeText: 'Job Live',
    badgeColor: 'emerald',
    contentHtml,
    contentText,
    detailsHtml,
    detailsText,
    ctaButton: {
      text: 'View Job & Proposals',
      url: ctaUrl,
    },
    helperHtml: escapeHtml(helperNotice),
    helperText: helperNotice,
  });

  return { subject, html, text };
}

