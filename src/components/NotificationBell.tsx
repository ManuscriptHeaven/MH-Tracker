import { Bell, Check, CheckCheck, Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import type { NotificationItem } from '../lib/types';
import { Button, IconButton } from './ui';

function timeAgo(value: string) {
  const createdAt = new Date(value).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(Math.floor((now - createdAt) / 60000), 0);

  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function NotificationBell({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onViewAll,
  onOpenProject,
}: {
  notifications: NotificationItem[];
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onViewAll: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const latestNotifications = useMemo(() => notifications.slice(0, 5), [notifications]);

  function openNotification(notification: NotificationItem) {
    if (!notification.is_read) {
      onMarkRead(notification.id);
    }

    if (notification.project_id) {
      onOpenProject(notification.project_id);
      setIsOpen(false);
    }
  }

  return (
    <div className="relative">
      <IconButton
        title={`${unreadCount} unread notifications`}
        className="relative"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </IconButton>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="font-display text-lg font-semibold text-ink">Notifications</p>
              <p className="text-xs text-muted">{unreadCount} unread</p>
            </div>
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={!unreadCount}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted transition hover:bg-ivory hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {latestNotifications.length ? (
              latestNotifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={cn(
                    'grid w-full grid-cols-[auto_1fr_auto] gap-3 border-b border-border/70 px-4 py-3 text-left transition last:border-b-0 hover:bg-ivory',
                    !notification.is_read && 'bg-gold/10',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 h-2.5 w-2.5 rounded-full',
                      notification.is_read ? 'bg-border' : 'bg-gold',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{notification.title}</span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted">{notification.message}</span>
                    <span className="mt-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                      {timeAgo(notification.created_at)}
                    </span>
                  </span>
                  {!notification.is_read ? <Check className="mt-1 h-4 w-4 text-gold" /> : null}
                </button>
              ))
            ) : (
              <div className="grid place-items-center gap-2 px-4 py-8 text-center text-sm text-muted">
                <Inbox className="h-8 w-8 text-border" />
                <p>No notifications yet.</p>
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                onViewAll();
                setIsOpen(false);
              }}
            >
              View all notifications
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
