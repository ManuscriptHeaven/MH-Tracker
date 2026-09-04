import { useState } from 'react';
import { Crown, Briefcase, Palette, User, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import type { Profile, Role } from '../lib/types';
import { cn } from '../lib/utils';

interface DemoRoleSwitcherProps {
  currentRole: Role;
  currentProfile: Profile;
  onSwitchRole: (role: Role) => void;
}

const demoRoles: Array<{
  role: Role;
  name: string;
  label: string;
  badge: string;
  icon: typeof Crown;
  colorClass: string;
}> = [
  {
    role: 'admin',
    name: 'Tahir',
    label: 'Admin',
    badge: 'Full Access & Finance',
    icon: Crown,
    colorClass: 'text-amber-400',
  },
  {
    role: 'project_manager',
    name: 'Atia',
    label: 'Manager',
    badge: 'Operations & Timeline',
    icon: Briefcase,
    colorClass: 'text-blue-400',
  },
  {
    role: 'employee',
    name: 'Zain',
    label: 'Designer',
    badge: 'My Tasks & Proofs',
    icon: Palette,
    colorClass: 'text-emerald-400',
  },
  {
    role: 'client',
    name: 'Amelia',
    label: 'Client',
    badge: 'Portal & Approvals',
    icon: User,
    colorClass: 'text-purple-400',
  },
];

export function DemoRoleSwitcher({
  currentRole,
  currentProfile,
  onSwitchRole,
}: DemoRoleSwitcherProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const activeRoleConfig = demoRoles.find((r) => r.role === currentRole) || {
    role: currentRole,
    name: currentProfile.full_name,
    label: currentRole,
    badge: 'Current User',
    icon: User,
    colorClass: 'text-gold',
  };

  const ActiveIcon = activeRoleConfig.icon;

  if (!isExpanded) {
    return (
      <div className="no-print fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 rounded-full border border-gold/40 bg-ink/95 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur transition hover:scale-105 hover:border-gold hover:text-gold"
          title="Click to open Role Switcher for demo"
        >
          <Sparkles className="h-3.5 w-3.5 text-gold animate-pulse" />
          <span>Demo Role:</span>
          <span className="flex items-center gap-1 font-bold text-gold">
            <ActiveIcon className="h-3.5 w-3.5" />
            {activeRoleConfig.label} ({activeRoleConfig.name})
          </span>
          <ChevronUp className="h-3.5 w-3.5 opacity-60 ml-1" />
        </button>
      </div>
    );
  }

  return (
    <aside aria-label="Demo role switcher" className="no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-2xl px-2">
      <div className="rounded-2xl border border-gold/40 bg-ink/95 p-2 sm:p-2.5 text-white shadow-2xl backdrop-blur-md">
        {/* Header bar */}
        <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-medium text-white/70">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            <span className="font-semibold text-white tracking-wide uppercase text-[10px]">
              Live Demo Switcher
            </span>
            <span className="text-white/40">•</span>
            <span className="text-white/60 hidden sm:inline">1-Click Role Preview</span>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-white/60 transition hover:bg-white/10 hover:text-white"
            title="Minimize bar during presentation"
          >
            <span>Minimize</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {/* Role buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
          {demoRoles.map((item) => {
            const isSelected = currentRole === item.role;
            const Icon = item.icon;

            return (
              <button
                key={item.role}
                type="button"
                onClick={() => onSwitchRole(item.role)}
                className={cn(
                  'flex items-center gap-2 sm:gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all',
                  isSelected
                    ? 'bg-gold text-ink font-semibold shadow-md ring-2 ring-gold/60 scale-[1.02]'
                    : 'bg-white/10 text-white/90 hover:bg-white/15 hover:text-white'
                )}
              >
                <div
                  className={cn(
                    'grid h-7 w-7 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-lg text-sm font-bold',
                    isSelected
                      ? 'bg-ink text-gold'
                      : 'bg-white/10 text-gold'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className={cn('text-xs font-bold truncate', isSelected ? 'text-ink' : 'text-white')}>
                      {item.label}
                    </p>
                  </div>
                  <p className={cn('text-[10px] truncate', isSelected ? 'text-ink/80' : 'text-white/50')}>
                    {item.name}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
