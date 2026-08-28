import {
  Bell,
  CalendarDays,
  Camera,
  CheckSquare,
  CreditCard,
  Download,
  FolderKanban,
  Landmark,
  LogOut,
  MessageSquare,
  PackageCheck,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { roleLabels } from '../lib/constants';
import { firstName, initials, isClientRole, isManagerRole } from '../lib/utils';
import type { NotificationItem, Profile, TrackerData } from '../lib/types';
import type { ViewKey } from './Layout';
import { CurrencySelector } from './CurrencySelector';
import { UserAvatar } from './UserAvatar';
import { getUnreadMessagesInfo } from './MessageNotificationBell';

export function MobileMoreMenu({
  isOpen,
  onClose,
  activeView,
  setActiveView,
  currentProfile,
  data,
  notifications,
  canInstall,
  onInstall,
  onSignOut,
  onOpenAvatarModal,
}: {
  isOpen: boolean;
  onClose: () => void;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
  currentProfile: Profile;
  data: TrackerData;
  notifications: NotificationItem[];
  canInstall?: boolean;
  onInstall?: () => void;
  onSignOut: () => void;
  onOpenAvatarModal?: () => void;
}) {
  if (!isOpen) return null;

  const isClient = isClientRole(currentProfile.role);
  const isAdmin = currentProfile.role === 'admin';
  const isManager = isManagerRole(currentProfile.role);
  const unreadNotificationsCount = notifications.filter((n) => !n.is_read).length;
  const unreadMessagesInfo = getUnreadMessagesInfo(currentProfile, data);

  function handleNavigate(view: ViewKey) {
    setActiveView(view);
    onClose();
  }

  interface MenuItem {
    id: ViewKey;
    label: string;
    icon: typeof FolderKanban;
    show: boolean;
    badge?: number | null;
  }

  interface MenuSection {
    title: string;
    show: boolean;
    items: MenuItem[];
  }

  const sections: MenuSection[] = [
    {
      title: 'Projects & Deadlines',
      show: true,
      items: [
        { id: 'projects', label: 'All Projects', icon: FolderKanban, show: true },
        { id: 'delivered', label: 'Delivered Projects', icon: PackageCheck, show: !isClient },
        { id: 'calendar', label: 'Calendar & Deadlines', icon: CalendarDays, show: !isClient },
        { id: 'ai_assistant', label: 'AI Assistant', icon: Sparkles, show: isManager },
      ],
    },
    {
      title: 'Tasks & Team',
      show: !isClient,
      items: [
        { id: 'my_tasks', label: 'My Tasks', icon: CheckSquare, show: !isClient },
        { id: 'team_tasks', label: 'Team Tasks', icon: Users, show: isManager },
        { id: 'team', label: 'Team Members', icon: Users, show: isManager },
      ],
    },
    {
      title: 'Messages & Alerts',
      show: true,
      items: [
        {
          id: 'communication',
          label: 'Messages',
          icon: MessageSquare,
          show: true,
          badge: unreadMessagesInfo.totalUnreadCount > 0 ? unreadMessagesInfo.totalUnreadCount : null,
        },
        {
          id: 'notifications',
          label: 'Notifications',
          icon: Bell,
          show: true,
          badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null,
        },
      ],
    },
    {
      title: 'Finance & Management',
      show: isManager,
      items: [
        { id: 'payments', label: 'Payments', icon: CreditCard, show: isManager },
        { id: 'finance', label: 'Finance & Payroll', icon: Landmark, show: isAdmin },
        { id: 'clients', label: 'Client Access', icon: Users, show: isAdmin },
        { id: 'settings', label: 'Settings', icon: Settings, show: isAdmin },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-linen p-5 shadow-2xl transition-transform animate-in slide-in-from-bottom duration-200">
        {/* Header with user info */}
        <div className="flex items-center justify-between border-b border-border/80 pb-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAvatarModal?.();
            }}
            className="flex items-center gap-3 text-left group cursor-pointer"
            title="Click to change DP & update profile"
          >
            <div className="relative">
              <UserAvatar profile={currentProfile} size="lg" showRoleRing showStatusDot />
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-gold text-[10px] font-bold text-ink shadow-sm group-hover:scale-110 transition-transform">
                <Camera className="h-3 w-3" />
              </span>
            </div>
            <div>
              <p className="font-semibold text-ink leading-tight flex items-center gap-1.5">
                {currentProfile.full_name}
                <span className="text-[10px] font-medium text-gold">Edit DP</span>
              </p>
              <p className="text-xs text-muted mt-0.5">{roleLabels[currentProfile.role]}</p>
            </div>
          </button>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-ivory text-muted hover:text-ink active:scale-95"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Currency & Quick Tools */}
        <div className="my-4 flex items-center justify-between rounded-xl border border-border bg-white p-3 shadow-xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Global Currency</span>
          <CurrencySelector />
        </div>

        {/* PWA Install Button (if eligible) */}
        {canInstall ? (
          <button
            onClick={() => {
              onInstall?.();
              onClose();
            }}
            className="mb-4 flex w-full items-center justify-between rounded-xl border border-gold/40 bg-gold/15 p-3.5 text-left font-semibold text-ink transition hover:bg-gold/25 active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-ink">
                <Download className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-bold">Install MH Tracker</span>
                <span className="block text-xs font-normal text-muted">Add to Home Screen as App</span>
              </span>
            </span>
            <span className="rounded-md bg-gold px-2.5 py-1 text-xs font-bold text-ink">Install</span>
          </button>
        ) : null}

        {/* Navigation Items Grouped */}
        <div className="space-y-4">
          {sections
            .filter((sec) => sec.show)
            .map((section) => {
              const visibleItems = section.items.filter((item) => item.show);
              if (visibleItems.length === 0) return null;

              return (
                <div key={section.title} className="space-y-1.5">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{section.title}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeView === item.id;

                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(item.id)}
                          className={`flex items-center justify-between rounded-xl border p-3 text-left text-sm font-medium transition active:scale-[0.98] ${
                            active
                              ? 'border-gold bg-gold text-ink font-semibold shadow-xs'
                              : 'border-border bg-white text-charcoal hover:border-gold/60 hover:bg-ivory'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.badge ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                                active ? 'bg-ink text-white' : 'bg-gold text-ink'
                              }`}
                            >
                              {item.badge}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Sign Out Button */}
        <div className="mt-6 pt-4 border-t border-border">
          <button
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-danger transition hover:bg-red-100 active:scale-[0.99]"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

