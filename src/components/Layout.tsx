import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Camera,
  CheckSquare,
  ChevronDown,
  CreditCard,
  Download,
  Landmark,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { roleLabels } from '../lib/constants';
import { initials, cn, firstName, isClientRole, isManagerRole } from '../lib/utils';
import type { NotificationItem, Profile, TrackerData } from '../lib/types';
import { Button, IconButton } from './ui';
import { NotificationBell } from './NotificationBell';
import { MessageNotificationBell, getUnreadMessagesInfo } from './MessageNotificationBell';
import { CurrencySelector } from './CurrencySelector';
import { MobileMoreMenu } from './MobileMoreMenu';
import { ManuscriptHeavenLogo } from './ManuscriptHeavenLogo';
import { UserAvatar } from './UserAvatar';
import { AvatarUploadModal } from './AvatarUploadModal';
import { usePwaInstall } from '../lib/pwa';
import { isSoundEnabled, setSoundEnabled, playNotificationSound } from '../lib/sound';

export type ViewKey =
  | 'dashboard'
  | 'ai_assistant'
  | 'projects'
  | 'my_tasks'
  | 'team_tasks'
  | 'communication'
  | 'calendar'
  | 'notifications'
  | 'team'
  | 'clients'
  | 'delivered'
  | 'payments'
  | 'finance'
  | 'settings';

const viewHeaderTitles: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  ai_assistant: 'AI Assistant',
  projects: 'Projects Overview',
  delivered: 'Delivered Projects',
  calendar: 'Calendar & Deadlines',
  my_tasks: 'My Tasks',
  team_tasks: 'Team Tasks',
  communication: 'Communication',
  notifications: 'Notifications',
  team: 'Team Management',
  clients: 'Client Access',
  payments: 'Payments Overview',
  finance: 'Finance & Payroll',
  settings: 'System Settings',
};

interface NavSingleItem {
  id: ViewKey;
  label: string;
  icon: typeof Home;
  type: 'single';
  managersOnly?: boolean;
  adminOnly?: boolean;
}

interface NavChildItem {
  id: ViewKey;
  label: string;
  icon: typeof Home;
  managersOnly?: boolean;
  adminOnly?: boolean;
}

interface NavGroupItem {
  id: string;
  label: string;
  icon: typeof Home;
  type: 'group';
  managersOnly?: boolean;
  adminOnly?: boolean;
  children: NavChildItem[];
}

type NavEntry = NavSingleItem | NavGroupItem;

const navStructure: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, type: 'single' },
  { id: 'ai_assistant', label: 'AI Assistant', icon: Sparkles, type: 'single', managersOnly: true },
  {
    id: 'projects_group',
    label: 'Projects',
    icon: FolderKanban,
    type: 'group',
    children: [
      { id: 'projects', label: 'All Projects', icon: FolderKanban },
      { id: 'delivered', label: 'Delivered', icon: PackageCheck },
      { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    id: 'tasks_group',
    label: 'Tasks',
    icon: CheckSquare,
    type: 'group',
    children: [
      { id: 'my_tasks', label: 'My Tasks', icon: CheckSquare },
      { id: 'team_tasks', label: 'Team Tasks', icon: Users, managersOnly: true },
    ],
  },
  { id: 'communication', label: 'Communication', icon: MessageSquare, type: 'single' },
  { id: 'notifications', label: 'Notifications', icon: Bell, type: 'single' },
  {
    id: 'finance_group',
    label: 'Finance',
    icon: Landmark,
    type: 'group',
    managersOnly: true,
    children: [
      { id: 'payments', label: 'Payments', icon: CreditCard, managersOnly: true },
      { id: 'finance', label: 'Finance & Payroll', icon: Landmark, adminOnly: true },
    ],
  },
  {
    id: 'management_group',
    label: 'Management',
    icon: Settings,
    type: 'group',
    managersOnly: true,
    children: [
      { id: 'team', label: 'Team', icon: Users, managersOnly: true },
      { id: 'clients', label: 'Clients', icon: Users, adminOnly: true },
      { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

function getGroupForView(view: ViewKey): string | null {
  if (['projects', 'delivered', 'calendar'].includes(view)) return 'projects_group';
  if (['my_tasks', 'team_tasks'].includes(view)) return 'tasks_group';
  if (['payments', 'finance'].includes(view)) return 'finance_group';
  if (['team', 'clients', 'settings'].includes(view)) return 'management_group';
  return null;
}

export function Layout({
  children,
  activeView,
  setActiveView,
  currentProfile,
  data,
  notifications,
  searchTerm,
  setSearchTerm,
  onAddProject,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onMarkConversationRead,
  onViewNotifications,
  onOpenNotificationProject,
  onSignOut,
  onUpdateProfile,
  onOpenConversation,
}: {
  children: React.ReactNode;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
  currentProfile: Profile;
  data: TrackerData;
  notifications: NotificationItem[];
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  onAddProject: () => void;
  onMarkNotificationRead: (notificationId: string) => void;
  onMarkAllNotificationsRead: () => void;
  onMarkConversationRead: (conversationId: string) => void;
  onViewNotifications: () => void;
  onOpenNotificationProject: (projectId: string) => void;
  onSignOut: () => void;
  onUpdateProfile?: (
    profileId: string,
    updates: { full_name?: string; avatar_url?: string | null; phone?: string | null }
  ) => Promise<string | void>;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [soundActive, setSoundActive] = useState<boolean>(() => isSoundEnabled());
  const { canInstall, promptInstall } = usePwaInstall();
  const canAddProject = isManagerRole(currentProfile.role) && (activeView === 'dashboard' || activeView === 'projects');
  const canManageAll = isManagerRole(currentProfile.role);
  const isClient = isClientRole(currentProfile.role);
  const displayName = firstName(currentProfile.full_name);
  const unreadMessagesInfo = getUnreadMessagesInfo(currentProfile, data);
  const unreadNotificationsCount = notifications.filter((n) => !n.is_read).length;

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => ({
    projects_group: true,
    tasks_group: true,
    finance_group: true,
    management_group: true,
  }));

  useEffect(() => {
    const activeGroup = getGroupForView(activeView);
    if (activeGroup) {
      setExpandedGroups((prev) => ({ ...prev, [activeGroup]: true }));
    }
  }, [activeView]);

  const visibleNavEntries = useMemo(() => {
    if (isClient) {
      return [
        { id: 'dashboard' as ViewKey, label: 'Dashboard', icon: Home, type: 'single' as const },
        { id: 'projects' as ViewKey, label: 'Projects', icon: FolderKanban, type: 'single' as const },
        { id: 'communication' as ViewKey, label: 'Communication', icon: MessageSquare, type: 'single' as const },
        { id: 'notifications' as ViewKey, label: 'Notifications', icon: Bell, type: 'single' as const },
      ];
    }

    return navStructure
      .map((entry) => {
        if (entry.type === 'single') {
          if (entry.adminOnly && currentProfile.role !== 'admin') return null;
          if (entry.managersOnly && !canManageAll) return null;
          return entry;
        }

        if (entry.adminOnly && currentProfile.role !== 'admin') return null;
        if (entry.managersOnly && !canManageAll) return null;

        const validChildren = entry.children.filter((child) => {
          if (child.adminOnly && currentProfile.role !== 'admin') return false;
          if (child.managersOnly && !canManageAll) return false;
          return true;
        });

        if (validChildren.length === 0) return null;

        return {
          ...entry,
          children: validChildren,
        };
      })
      .filter(Boolean) as NavEntry[];
  }, [isClient, currentProfile.role, canManageAll]);

  // Mobile Bottom Navigation Items
  const mobileNavItems: Array<{ id: ViewKey; label: string; icon: typeof Home; badge?: number }> = isClient
    ? [
        { id: 'dashboard', label: 'Home', icon: Home },
        { id: 'projects', label: 'Projects', icon: FolderKanban },
        {
          id: 'communication',
          label: 'Messages',
          icon: MessageSquare,
          badge: unreadMessagesInfo.totalUnreadCount > 0 ? unreadMessagesInfo.totalUnreadCount : undefined,
        },
        {
          id: 'notifications',
          label: 'Alerts',
          icon: Bell,
          badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
        },
      ]
    : [
        { id: 'dashboard', label: 'Home', icon: Home },
        { id: 'projects', label: 'Projects', icon: FolderKanban },
        { id: 'my_tasks', label: 'Tasks', icon: CheckSquare },
        canManageAll
          ? { id: 'team', label: 'Team', icon: Users }
          : {
              id: 'communication',
              label: 'Chat',
              icon: MessageSquare,
              badge: unreadMessagesInfo.totalUnreadCount > 0 ? unreadMessagesInfo.totalUnreadCount : undefined,
            },
      ];

  const isMoreActive = !mobileNavItems.some((item) => item.id === activeView);

  return (
    <div className="min-h-screen bg-linen text-ink">
      <aside className="no-print fixed left-0 top-0 z-30 hidden h-screen w-72 border-r border-border bg-ink text-white lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-white/10 p-6">
            <ManuscriptHeavenLogo variant="full" darkTheme />
          </div>

          <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-5">
            {visibleNavEntries.map((entry) => {
              if (entry.type === 'single') {
                const Icon = entry.icon;
                const active = activeView === entry.id;
                const isComm = entry.id === 'communication';

                return (
                  <button
                    key={entry.id}
                    onClick={() => setActiveView(entry.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-medium transition',
                      active ? 'bg-gold text-ink font-semibold shadow-xs' : 'text-white/75 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {entry.label}
                    </span>
                    {isComm && unreadMessagesInfo.totalUnreadCount > 0 ? (
                      <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-ink">
                        {unreadMessagesInfo.totalUnreadCount}
                      </span>
                    ) : null}
                  </button>
                );
              }

              const GroupIcon = entry.icon;
              const isExpanded = !!expandedGroups[entry.id];
              const isGroupActive = entry.children.some((child) => child.id === activeView);

              return (
                <div key={entry.id} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      const nextExpanded = !isExpanded;
                      setExpandedGroups((prev) => ({ ...prev, [entry.id]: nextExpanded }));
                      if (nextExpanded && !isGroupActive && entry.children.length > 0) {
                        setActiveView(entry.children[0].id);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-medium transition',
                      isGroupActive
                        ? 'bg-white/15 text-white font-semibold'
                        : 'text-white/75 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <GroupIcon className={cn('h-4 w-4', isGroupActive ? 'text-gold' : 'text-white/70')} />
                      {entry.label}
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 text-white/50 transition-transform duration-200',
                        isExpanded ? 'rotate-180 text-gold' : 'rotate-0',
                      )}
                    />
                  </button>

                  {isExpanded && (
                    <div className="ml-4 my-1 space-y-1 border-l border-white/15 pl-3">
                      {entry.children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = activeView === child.id;

                        return (
                          <button
                            key={child.id}
                            onClick={() => setActiveView(child.id)}
                            className={cn(
                              'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium transition',
                              childActive
                                ? 'bg-gold text-ink font-semibold shadow-xs'
                                : 'text-white/70 hover:bg-white/10 hover:text-white',
                            )}
                          >
                            <span className="flex items-center gap-2.5">
                              <ChildIcon className="h-3.5 w-3.5" />
                              {child.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {canInstall ? (
            <div className="px-4 pb-2">
              <button
                onClick={promptInstall}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/15 py-2.5 text-xs font-semibold text-gold transition hover:bg-gold/25"
              >
                <Download className="h-4 w-4" />
                Install MH Tracker
              </button>
            </div>
          ) : null}

          <div className="border-t border-white/10 p-4">
            <button
              type="button"
              onClick={() => setIsAvatarModalOpen(true)}
              className="flex w-full items-center gap-3 rounded-lg bg-white/10 p-3 text-left transition hover:bg-white/15 group relative"
              title="Click to update Display Picture & Profile"
            >
              <div className="relative">
                <UserAvatar profile={currentProfile} size="md" showRoleRing showStatusDot />
                <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-gold text-[9px] font-bold text-ink shadow-sm group-hover:scale-110 transition-transform">
                  <Camera className="h-2.5 w-2.5" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold flex items-center justify-between">
                  {displayName}
                  <span className="text-[10px] text-gold font-normal opacity-0 group-hover:opacity-100 transition-opacity">Edit DP</span>
                </p>
                <p className="truncate text-xs text-white/60">{roleLabels[currentProfile.role]}</p>
              </div>
            </button>
          </div>
        </div>
      </aside>

      <main className="pb-24 lg:ml-72 lg:pb-0">
        <header className="no-print sticky top-0 z-20 border-b border-border bg-linen/95 px-3 py-3 backdrop-blur sm:px-4 sm:py-4 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted">Welcome back, {displayName}</p>
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-semibold text-ink">
                  {viewHeaderTitles[activeView] || 'MH Tracker'}
                </h1>
              </div>
              <IconButton title="Open menu" onClick={() => setMobileMenuOpen(true)} className="lg:hidden">
                <Menu className="h-5 w-5" />
              </IconButton>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1 sm:w-72 lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={isClient ? 'Search your projects' : 'Search projects or clients'}
                  className="h-10 sm:h-11 w-full rounded-md border border-border bg-white pl-10 pr-3 text-xs sm:text-sm focus:border-gold"
                />
              </label>

              <div className="flex items-center justify-between sm:justify-end gap-1.5 sm:gap-2">
                <IconButton
                  title={soundActive ? 'Sound & Voice Alerts: Enabled (Click to mute)' : 'Sound & Voice Alerts: Muted (Click to unmute)'}
                  onClick={() => {
                    const next = !soundActive;
                    setSoundActive(next);
                    setSoundEnabled(next);
                    if (next) playNotificationSound();
                  }}
                  className={cn('transition', soundActive ? 'text-gold hover:text-gold/80' : 'text-muted/60 hover:text-muted')}
                >
                  {soundActive ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </IconButton>
                <CurrencySelector />
                <MessageNotificationBell
                  currentProfile={currentProfile}
                  data={data}
                  onMarkRead={onMarkConversationRead}
                  onOpenConversation={(conversationId) => {
                    if (onOpenConversation) {
                      onOpenConversation(conversationId);
                    } else {
                      setActiveView('communication');
                    }
                  }}
                  onViewAllMessages={() => {
                    setActiveView('communication');
                  }}
                />
                <NotificationBell
                  notifications={notifications}
                  onMarkRead={onMarkNotificationRead}
                  onMarkAllRead={onMarkAllNotificationsRead}
                  onViewAll={onViewNotifications}
                  onOpenProject={onOpenNotificationProject}
                />
                {canAddProject ? (
                  <Button onClick={onAddProject} className="text-xs sm:text-sm py-2 px-3">
                    <Plus className="h-4 w-4" />
                    <span className="hidden xs:inline sm:inline">Add Project</span>
                  </Button>
                ) : null}
                <IconButton title="Sign out" onClick={onSignOut} className="hidden sm:inline-flex">
                  <LogOut className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </header>

        <div className="p-3 sm:p-4 lg:p-8">{children}</div>
      </main>

      {/* Mobile Bottom Navigation Bar (5 Items: 4 Quick Views + More) */}
      <nav
        className="no-print fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-border bg-white/95 backdrop-blur-md px-1 py-1.5 shadow-[0_-6px_20px_rgba(26,26,26,0.06)] lg:hidden"
        style={{ paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold transition active:scale-95',
                active ? 'bg-gold/20 text-ink font-bold' : 'text-muted hover:text-ink',
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate text-[10px] leading-tight">{item.label}</span>
              {item.badge ? (
                <span className="absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-ink">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}

        {/* 5th Button: More Menu */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold transition active:scale-95',
            isMoreActive ? 'bg-gold/20 text-ink font-bold' : 'text-muted hover:text-ink',
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="max-w-full truncate text-[10px] leading-tight">More</span>
          {unreadNotificationsCount > 0 && !isClient ? (
            <span className="absolute top-1 right-2 flex h-2 w-2 rounded-full bg-gold animate-ping" />
          ) : null}
        </button>
      </nav>

      {/* Slide-Up More Menu Sheet */}
      <MobileMoreMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeView={activeView}
        setActiveView={setActiveView}
        currentProfile={currentProfile}
        data={data}
        notifications={notifications}
        canInstall={canInstall}
        onInstall={promptInstall}
        onSignOut={onSignOut}
        onOpenAvatarModal={() => setIsAvatarModalOpen(true)}
      />

      {/* Avatar & Profile Upload Modal */}
      <AvatarUploadModal
        isOpen={isAvatarModalOpen}
        onClose={() => setIsAvatarModalOpen(false)}
        profile={currentProfile}
        onSaveProfile={onUpdateProfile || (async () => {})}
      />
    </div>
  );
}

