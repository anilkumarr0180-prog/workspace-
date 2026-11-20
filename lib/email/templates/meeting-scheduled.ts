import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { MeetingScheduledTemplateData, RenderedEmail } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderMeetingScheduledTemplate(data: MeetingScheduledTemplateData): RenderedEmail {
  if (!data.recipientName || !data.recipientName.trim()) {
    throw new Error('Template Error [meeting_scheduled_v1]: Missing required field "recipientName".');
  }
  if (!data.organizerName || !data.organizerName.trim()) {
    throw new Error('Template Error [meeting_scheduled_v1]: Missing required field "organizerName".');
  }
  if (!data.jobTitle || !data.jobTitle.trim()) {
    throw new Error('Template Error [meeting_scheduled_v1]: Missing required field "jobTitle".');
  }
  if (!data.meetingDate || !data.meetingDate.trim()) {
    throw new Error('Template Error [meeting_scheduled_v1]: Missing required field "meetingDate".');
  }

  const subject = `Meeting Scheduled: Consultation for "${data.jobTitle}"`;
  const timeDisplay = data.meetingTimezone
    ? `${data.meetingTime} (${data.meetingTimezone})`
    : data.meetingTime;

  const topicDisplay = data.meetingTopic?.trim() || 'Project Consultation & Scope Discussion';

  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      A project consultation meeting has been scheduled by <strong>${escapeHtml(data.organizerName)}</strong> regarding <strong>${escapeHtml(data.jobTitle)}</strong>.
    </p>
    <p style="margin: 0;">
      Please find the meeting details and instructions below. You can join directly via the link or coordinate through the project conversation thread.
    </p>
  `;

  const durationRow = data.durationMinutes
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Duration:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${data.durationMinutes} minutes</td>
      </tr>
    `
    : '';

  const linkRow = data.meetingLink
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Meeting Link:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669; word-break: break-all;">
          <a href="${escapeHtml(data.meetingLink)}" target="_blank" rel="noopener noreferrer" style="color: #059669; text-decoration: underline;">
            ${escapeHtml(data.meetingLink)}
          </a>
        </td>
      </tr>
    `
    : '';

  const notesRow = data.notes?.trim()
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Agenda / Notes:</td>
        <td style="padding: 4px 0; font-size: 13px; color: #475569; font-style: italic;">${escapeHtml(data.notes.trim())}</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Topic:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(topicDisplay)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Date & Time:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #d97706;">${escapeHtml(data.meetingDate)} at ${escapeHtml(timeDisplay)}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Platform:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(data.platform || 'Online Video Conference')}</td>
      </tr>
      ${durationRow}
      ${linkRow}
      ${notesRow}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">Project:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">${escapeHtml(data.jobTitle)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.recipientName},\n\nA project consultation meeting has been scheduled by ${data.organizerName} for "${data.jobTitle}".\n\nTopic: ${topicDisplay}\nDate: ${data.meetingDate}\nTime: ${timeDisplay}\nPlatform: ${data.platform || 'Online'}\n${data.meetingLink ? `Meeting Link: ${data.meetingLink}\n` : ''}`;

  let detailsText = `Topic: ${topicDisplay}\nDate: ${data.meetingDate}\nTime: ${timeDisplay}\nPlatform: ${data.platform || 'Online'}`;
  if (data.durationMinutes) detailsText += `\nDuration: ${data.durationMinutes} min`;
  if (data.meetingLink) detailsText += `\nLink: ${data.meetingLink}`;
  if (data.notes) detailsText += `\nNotes: ${data.notes}`;

  const ctaUrl = data.meetingLink?.startsWith('http')
    ? data.meetingLink
    : data.conversationId
    ? buildAppUrl(`/messages/${data.conversationId}`)
    : buildAppUrl('/messages');

  const ctaText = data.meetingLink?.startsWith('http') ? 'Join Meeting Online' : 'Open Workspace Conversation';
  const helperNotice = 'Make sure to test your microphone and camera before joining. You can discuss deliverables, ask questions, and align on timeline.';

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'Meeting Invitation',
    badgeText: 'Meeting Scheduled',
    badgeColor: 'amber',
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

