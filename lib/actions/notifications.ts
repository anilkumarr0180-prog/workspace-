'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { NotificationItem, NotificationType } from '@/lib/types';

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

    const [notificationsResult, unreadCountResult] = await Promise.all([
      query,
      supabase
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

    const { count, error } = await supabase
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

    const { error } = await supabase
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

    const { error } = await supabase
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
    const admin = getAdminSupabaseClient();
    const { data, error } = await admin
      .from('notifications')
      .insert({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link || null,
        metadata: input.metadata || {},
      })
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create notification' };
  }
}
