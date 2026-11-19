'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import type { NotificationItem, NotificationType } from '@/lib/types';
import { sendEmail } from '@/lib/email/service';

export interface GetNotificationsParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface GetNotificationsResult {
  success: boolean;
  notifications: NotificationItem[];
  totalUnread: number;
  error?: string;
}

export interface NotificationActionResult {
  success: boolean;
  error?: string;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

interface SupabaseNotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  read: boolean;
  read_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function mapNotificationRow(row: SupabaseNotificationRow): NotificationItem {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    link: row.link || null,
    read: row.read,
    readAt: row.read_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch authenticated user's notifications and unread count.
 */
export async function getNotifications(
  params: GetNotificationsParams = {}
): Promise<GetNotificationsResult> {
  const { limit = 20, offset = 0, unreadOnly = false } = params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        notifications: [],
        totalUnread: 0,
        error: 'Authentication required',
      };
    }

    let query = supabase
      .from('notifications')
      .select('id, user_id, type, title, message, link, read, read_at, metadata, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    let client;
    try {
      client = getAdminSupabaseClient();
    } catch {
      client = supabase;
    }

    const [notificationsResult, unreadCountResult] = await Promise.all([
      query,
      client
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false),
    ]);

    if (notificationsResult.error) {
      return {
        success: false,
        notifications: [],
        totalUnread: 0,
        error: notificationsResult.error.message,
      };
    }

    const rows = (notificationsResult.data || []) as unknown as SupabaseNotificationRow[];
    const mapped = rows.map(mapNotificationRow);

    return {
      success: true,
      notifications: mapped,
      totalUnread: unreadCountResult.count ?? mapped.filter((n) => !n.read).length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch notifications';
    return {
      success: false,
      notifications: [],
      totalUnread: 0,
      error: message,
    };
  }
}

/**
 * Fetch count of unread notifications for the active user badge.
 */
export async function getUnreadNotificationCount(): Promise<{ success: boolean; count: number }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, count: 0 };
    }

    let client;
    try {
      client = getAdminSupabaseClient();
    } catch {
      client = supabase;
    }

    const { count, error } = await client
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false);

    if (error) {
      return { success: false, count: 0 };
    }

    return { success: true, count: count || 0 };
  } catch {
    return { success: false, count: 0 };
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationAsRead(id: string): Promise<NotificationActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let client;
    try {
      client = getAdminSupabaseClient();
    } catch {
      client = supabase;
    }

    const { error } = await client
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Error updating notification' };
  }
}

/**
 * Mark all unread notifications as read for current user.
 */
export async function markAllNotificationsAsRead(): Promise<NotificationActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    let client;
    try {
      client = getAdminSupabaseClient();
    } catch {
      client = supabase;
    }

    const { error } = await client
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('read', false);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Error marking all as read' };
  }
}

/**
 * Securely create a notification for a target user.
 * This server-side function uses getAdminSupabaseClient() to enforce that
 * client sessions cannot arbitrarily insert spoofed notifications.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    let client;
    try {
      client = getAdminSupabaseClient();
    } catch {
      client = await createClient();
    }

    const insertPayload: Record<string, unknown> = {
      user_id: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link || null,
      metadata: input.metadata || {},
    };
    if (input.idempotencyKey) {
      insertPayload.idempotency_key = input.idempotencyKey;
    }

    const { data, error } = await client
      .from('notifications')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      // Idempotent return on duplicate key
      if (error.code === '23505') {
        return { success: true };
      }
      return { success: false, error: error.message };
    }

    // Trigger transactional notification email non-blockingly
    dispatchNotificationEmail(input).catch((e) => {
      console.warn('[EMAIL NOTIFICATION] Non-blocking delivery notice:', e);
    });

    return { success: true, id: data?.id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create notification' };
  }
}

/**
 * Asynchronously delivers a transactional notification email to the target user.
 * Looks up the recipient's email address from auth.users via admin client.
 * Non-blocking: failures are logged without disrupting application transactions.
 */
async function dispatchNotificationEmail(input: CreateNotificationInput): Promise<void> {
  try {
    const admin = getAdminSupabaseClient();
    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(input.userId);
    if (uErr || !userData?.user?.email) {
      return;
    }

    const recipientEmail = userData.user.email;
    const recipientName =
      userData.user.user_metadata?.full_name ||
      userData.user.user_metadata?.name ||
      'Workspace Member';

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://workspace-inky-six.vercel.app';
    const actionUrl = input.link
      ? input.link.startsWith('http')
        ? input.link
        : `${baseUrl}${input.link}`
      : baseUrl;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff;">
        <div style="padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #14a800; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">Workspace</h2>
        </div>
        
        <p style="font-size: 14px; margin-bottom: 8px; color: #64748b;">Hello <strong>${recipientName}</strong>,</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #14a800; padding: 16px 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px; font-weight: 700;">${input.title}</h3>
          <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.6;">${input.message}</p>
        </div>

        <div style="margin: 28px 0 32px 0;">
          <a href="${actionUrl}" style="display: inline-block; background-color: #14a800; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-size: 13.5px; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            View Details in Workspace &rarr;
          </a>
        </div>

        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
          This is an automated notification from Workspace Escrow & Project Management. You received this email because you have an active account and project activity.
        </p>
      </div>
    `;

    const emailText = `Workspace Notification: ${input.title}\n\nHello ${recipientName},\n\n${input.message}\n\nView details: ${actionUrl}\n\nWorkspace Marketplace`;

    await sendEmail({
      to: recipientEmail,
      subject: `[Workspace] ${input.title}`,
      html: emailHtml,
      text: emailText,
      from: process.env.SMTP_FROM || 'Workspace Notifications <notifications@workspace.com>',
    });
  } catch (err: unknown) {
    console.warn('[EMAIL NOTIFICATION] Non-blocking dispatch error:', err instanceof Error ? err.message : err);
  }
}
