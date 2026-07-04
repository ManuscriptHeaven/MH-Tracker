import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, EmptyState, IconButton, Button } from '../components/ui';
import { formatDate } from '../lib/date';
import { cn } from '../lib/utils';
import type { NotificationItem, Project } from '../lib/types';

type FilterKey = 'all' | 'unread' | 'read';

function projectTitle(projects: Project[], projectId?: string | null) {
  if (!projectId) {
    return null;
  }

  return projects.find((project) => project.id === projectId)?.project_title || null;
}

export function NotificationsPage({
  notifications,
  projects,
  onMarkRead,
  onMarkAllRead,
  onOpenProject,
}: {
  notifications: NotificationItem[];
  projects: Project[];
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      if (filter === 'unread') {
        return !notification.is_read;
      }

      if (filter === 'read') {
        return notification.is_read;
      }

      return true;
    });
  }, [filter, notifications]);

  if (!notifications.length) {
    return (
      <EmptyState
        title="No notifications"
        message="Project updates and assignments will appear here as your team works."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-gold" />
              <h2 className="font-display text-2xl font-semibold">Notifications</h2>
            </div>
            <p className="mt-1 text-sm text-muted">
              {unreadCount} unread of {notifications.length} total
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'unread', 'read'] as FilterKey[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm font-semibold capitalize transition',
                  filter === item
                    ? 'border-gold bg-gold text-ink'
                    : 'border-border bg-white text-muted hover:border-gold hover:text-ink',
                )}
              >
                {item}
              </button>
            ))}
            <Button type="button" variant="secondary" onClick={onMarkAllRead} disabled={!unreadCount}>
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {filteredNotifications.map((notification) => {
          const relatedProjectTitle = projectTitle(projects, notification.project_id);

          return (
            <Card
              key={notification.id}
              className={cn(
                'border-l-4',
                notification.is_read ? 'border-l-border' : 'border-l-gold bg-gold/5',
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        notification.is_read ? 'bg-border' : 'bg-gold',
                      )}
                    />
                    <h3 className="truncate text-base font-semibold text-ink">{notification.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">{notification.message}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                    <span>{formatDate(notification.created_at.slice(0, 10))}</span>
                    {relatedProjectTitle ? <span>| {relatedProjectTitle}</span> : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {!notification.is_read ? (
                    <IconButton title="Mark as read" onClick={() => onMarkRead(notification.id)}>
                      <Check className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                  {notification.project_id ? (
                    <IconButton
                      title="Open project"
                      onClick={() => {
                        if (!notification.is_read) {
                          onMarkRead(notification.id);
                        }

                        onOpenProject(notification.project_id as string);
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}

        {!filteredNotifications.length ? (
          <EmptyState title="Nothing in this view" message="Change the filter to see other notifications." />
        ) : null}
      </div>
    </div>
  );
}
