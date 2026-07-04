import {
  Bell,
  CalendarDays,
  CheckSquare,
  CreditCard,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  Repeat2,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { roleLabels } from '../lib/constants';
import { initials, cn, firstName, isManagerRole } from '../lib/utils';
import type { NotificationItem, Profile } from '../lib/types';
import { Button, IconButton } from './ui';
import { NotificationBell } from './NotificationBell';

export type ViewKey =
  | 'dashboard'
  | 'projects'
  | 'my_tasks'
  | 'calendar'
  | 'revisions'
  | 'notifications'
  | 'team'
  | 'delivered'
  | 'payments'
  | 'settings';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'my_tasks', label: 'My Tasks', icon: CheckSquare },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'revisions', label: 'Revisions', icon: Repeat2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'team', label: 'Team', icon: Users, managersOnly: true },
  { id: 'delivered', label: 'Delivered', icon: PackageCheck },
  { id: 'payments', label: 'Payments', icon: CreditCard, managersOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

export function Layout({
  children,
  activeView,
  setActiveView,
  currentProfile,
  notifications,
  searchTerm,
  setSearchTerm,
  onAddProject,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onViewNotifications,
  onOpenNotificationProject,
  onSignOut,
}: {
  children: React.ReactNode;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
  currentProfile: Profile;
  notifications: NotificationItem[];
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  onAddProject: () => void;
  onMarkNotificationRead: (notificationId: string) => void;
  onMarkAllNotificationsRead: () => void;
  onViewNotifications: () => void;
  onOpenNotificationProject: (projectId: string) => void;
  onSignOut: () => void;
}) {
  const canAddProject = isManagerRole(currentProfile.role);
  const canManageAll = isManagerRole(currentProfile.role);
  const displayName = firstName(currentProfile.full_name);
  const visibleNavItems = navItems.filter((item) => !('managersOnly' in item) || !item.managersOnly || canManageAll);

  return (
    <div className="min-h-screen bg-linen text-ink">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-72 border-r border-border bg-ink text-white lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-white/10 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-md border border-gold/50 bg-gold text-ink font-display text-xl font-bold">
                MH
              </div>
              <div>
                <p className="font-display text-xl font-semibold">Manuscript Heaven</p>
                <p className="text-xs uppercase tracking-[0.24em] text-gold">Project Tracker</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-4 py-5">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition',
                    active ? 'bg-gold text-ink' : 'text-white/75 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 p-4">
            <div className="flex items-center gap-3 rounded-lg bg-white/10 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gold text-sm font-bold text-ink">
                {initials(displayName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <p className="truncate text-xs text-white/60">{roleLabels[currentProfile.role]}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="pb-24 lg:ml-72 lg:pb-0">
        <header className="sticky top-0 z-20 border-b border-border bg-linen/95 px-4 py-4 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted">Welcome back, {displayName}</p>
                <h1 className="font-display text-2xl font-semibold text-ink md:text-3xl">
                  {navItems.find((item) => item.id === activeView)?.label}
                </h1>
              </div>
              <IconButton title="Open menu" className="lg:hidden">
                <Menu className="h-5 w-5" />
              </IconButton>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1 sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search projects or clients"
                  className="h-11 w-full rounded-md border border-border bg-white pl-10 pr-3 text-sm focus:border-gold"
                />
              </label>

              <div className="flex items-center gap-2">
                <NotificationBell
                  notifications={notifications}
                  onMarkRead={onMarkNotificationRead}
                  onMarkAllRead={onMarkAllNotificationsRead}
                  onViewAll={onViewNotifications}
                  onOpenProject={onOpenNotificationProject}
                />
                {canAddProject ? (
                  <Button onClick={onAddProject}>
                    <Plus className="h-4 w-4" />
                    Add Project
                  </Button>
                ) : null}
                <IconButton title="Sign out" onClick={onSignOut}>
                  <LogOut className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-8">{children}</div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-border bg-white px-2 py-2 shadow-[0_-8px_20px_rgba(26,26,26,0.08)] lg:hidden">
        {visibleNavItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'grid place-items-center gap-1 rounded-md px-1 py-2 text-[11px] font-semibold transition',
                active ? 'bg-gold/15 text-ink' : 'text-muted',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
