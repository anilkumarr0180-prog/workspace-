import { renderEmailLayout } from './common/layout';
import { buildAppUrl, escapeHtml } from './common/utils';
import type { RenderedEmail, UnreadMessageTemplateData } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email templates cannot be loaded in the browser.');
}

export function renderUnreadMessageTemplate(data: UnreadMessageTemplateData): RenderedEmail {
  if (!data.recipientName || !data.recipientName.trim()) {
    throw new Error('Template Error [unread_message_v1]: Missing required field "recipientName".');
  }
  if (!data.senderName || !data.senderName.trim()) {
    throw new Error('Template Error [unread_message_v1]: Missing required field "senderName".');
  }
  if (!data.conversationId || !data.conversationId.trim()) {
    throw new Error('Template Error [unread_message_v1]: Missing required field "conversationId".');
  }

  const subject = `New message from ${data.senderName} on Workspace`;
  const messageTime = data.lastMessageTimestamp || new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Strict Privacy: Never include message body or attachments in email notifications
  const contentHtml = `
    <p style="margin: 0 0 16px 0;">
      Hello <strong>${escapeHtml(data.recipientName)}</strong>,
    </p>
    <p style="margin: 0 0 16px 0;">
      You have a new unread message from <strong>${escapeHtml(data.senderName)}</strong> regarding your ongoing communication on Workspace.
    </p>
    <p style="margin: 0;">
      To protect your privacy and ensure secure collaboration, message contents and attachments are only accessible within your Workspace inbox.
    </p>
  `;

  const contextRow = data.jobOrContractTitle
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Regarding:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 500; color: #0f172a;">${escapeHtml(data.jobOrContractTitle)}</td>
      </tr>
    `
    : '';

  const unreadCountRow = data.unreadCount && data.unreadCount > 1
    ? `
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Unread Count:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #059669;">${data.unreadCount} unread messages</td>
      </tr>
    `
    : '';

  const detailsHtml = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b; width: 140px;">From:</td>
        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(data.senderName)}</td>
      </tr>
      ${contextRow}
      ${unreadCountRow}
      <tr>
        <td style="padding: 4px 0; font-size: 13px; color: #64748b;">Received:</td>
        <td style="padding: 4px 0; font-size: 14px; color: #334155;">Today at ${escapeHtml(messageTime)}</td>
      </tr>
    </table>
  `;

  const contentText = `Hello ${data.recipientName},\n\nYou have a new unread message from ${data.senderName} on Workspace.\n\nTo protect your privacy and ensure secure collaboration, message contents and attachments are only accessible within your Workspace inbox.`;

  let detailsText = `From: ${data.senderName}`;
  if (data.jobOrContractTitle) {
    detailsText += `\nRegarding: ${data.jobOrContractTitle}`;
  }
  if (data.unreadCount && data.unreadCount > 1) {
    detailsText += `\nUnread Count: ${data.unreadCount} messages`;
  }
  detailsText += `\nReceived: Today at ${messageTime}`;

  const accountState = data.accountState || 'unknown';

  let ctaText: string;
  let ctaUrl: string;
  let helperNotice: string;

  if (accountState === 'existing_account') {
    ctaText = 'Open Secure Inbox & Reply';
    ctaUrl = buildAppUrl(`/messages/${data.conversationId}`);
    helperNotice = 'To adjust notification frequency or quiet hours, visit your account notification settings.';
  } else if (accountState === 'no_account') {
    ctaText = 'Join Workspace to Reply';
    ctaUrl = buildAppUrl('/signup');
    helperNotice = `You received a direct communication from ${data.senderName} on Workspace. Create an account to get started. Note: Accessing messages and conversations requires authenticating with the authorized recipient account.`;
  } else {
    ctaText = 'Continue to Conversation';
    ctaUrl = buildAppUrl(`/messages/${data.conversationId}`);
    helperNotice = 'To protect your privacy, message content is secured inside your Workspace account.';
  }

  const { html, text } = renderEmailLayout({
    title: subject,
    heading: 'New Message Received',
    badgeText: 'Direct Message',
    badgeColor: 'blue',
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
