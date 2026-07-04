import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { errorMessage } from './utils';
import type { NotificationItem } from './types';

type NotificationRow = Partial<NotificationItem> & {
  id: string;
  user_id?: string | null;
};

function normalizeNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    recipient_id: row.recipient_id || row.user_id || '',
    project_id: row.project_id || null,
    type: row.type || 'general',
    title: row.title || 'Notification',
    message: row.message || '',
    is_read: Boolean(row.is_read),
    created_at: row.created_at || new Date().toISOString(),
  };
}

function isMissingRecipientColumn(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return message.includes('recipient_id') || message.includes("column notifications.recipient_id");
}

function isMissingNotificationsTable(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return message.includes('notifications') && (message.includes('does not exist') || message.includes('schema cache'));
}

export async function fetchNotifications(userId: string) {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false });

  if (!error) {
    return ((data || []) as NotificationRow[]).map(normalizeNotification);
  }

  if (isMissingNotificationsTable(error)) {
    return [];
  }

  if (!isMissingRecipientColumn(error)) {
    throw error;
  }

  const fallback = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (fallback.error) {
    if (isMissingNotificationsTable(fallback.error)) {
      return [];
    }

    throw fallback.error;
  }

  return ((fallback.data || []) as NotificationRow[]).map(normalizeNotification);
}

export async function markNotificationAsRead(notificationId: string) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);

  if (error && !isMissingNotificationsTable(error)) {
    throw error;
  }
}

export async function markAllNotificationsAsRead(userId: string) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);

  if (!error || isMissingNotificationsTable(error)) {
    return;
  }

  if (!isMissingRecipientColumn(error)) {
    throw error;
  }

  const fallback = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (fallback.error && !isMissingNotificationsTable(fallback.error)) {
    throw fallback.error;
  }
}

export function subscribeToNotifications({
  userId,
  onInserted,
  onUpdated,
}: {
  userId: string;
  onInserted: (notification: NotificationItem) => void;
  onUpdated: (notification: NotificationItem) => void;
}): RealtimeChannel | null {
  if (!supabase) {
    return null;
  }

  return supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => onInserted(normalizeNotification(payload.new as NotificationRow)),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => onUpdated(normalizeNotification(payload.new as NotificationRow)),
    )
    .subscribe();
}
