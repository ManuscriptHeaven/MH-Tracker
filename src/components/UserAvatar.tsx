import React, { useState } from 'react';
import { cn, initials } from '../lib/utils';
import type { Role } from '../lib/types';

interface UserAvatarProps {
  profile?: {
    id?: string;
    full_name?: string;
    avatar_url?: string | null;
    role?: Role | string;
    email?: string;
  } | null;
  name?: string;
  avatarUrl?: string | null;
  role?: Role | string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showRoleRing?: boolean;
  showStatusDot?: boolean;
  isOnline?: boolean;
  className?: string;
}

// Curated high-resolution professional avatars for team members & default profiles
export const DEFAULT_TEAM_AVATARS: Record<string, string> = {
  // Admin & Founders
  tahir: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  admin: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  
  // Project Managers
  manager: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
  sara: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
  
  // Designers & Formatters (Employees)
  zain: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  hamza: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
  ali: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
  
  // Clients
  bch: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
  amelia: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
  lena: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  noah: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
};

export function getDefaultAvatarByNameOrRole(name?: string, role?: string): string | null {
  if (!name && !role) return null;
  const n = (name || '').toLowerCase();
  
  for (const [key, url] of Object.entries(DEFAULT_TEAM_AVATARS)) {
    if (n.includes(key)) {
      return url;
    }
  }

  if (role === 'admin') return DEFAULT_TEAM_AVATARS.admin;
  if (role === 'manager' || role === 'project_manager') return DEFAULT_TEAM_AVATARS.manager;
  if (role === 'employee' || role === 'junior_assistant') return DEFAULT_TEAM_AVATARS.zain;
  if (role === 'client') return DEFAULT_TEAM_AVATARS.amelia;

  return null;
}

export function UserAvatar({
  profile,
  name,
  avatarUrl,
  role,
  size = 'md',
  showRoleRing = false,
  showStatusDot = false,
  isOnline = true,
  className,
}: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);

  const displayName = profile?.full_name || name || 'User';
  const userRole = profile?.role || role || 'employee';
  
  // Determine effective avatar image URL
  const explicitUrl = profile?.avatar_url || avatarUrl;
  const fallbackUrl = getDefaultAvatarByNameOrRole(displayName, userRole);
  const effectiveImageUrl = !imageError ? (explicitUrl || fallbackUrl) : null;

  const sizeClasses = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm font-bold',
    lg: 'h-12 w-12 text-base font-bold',
    xl: 'h-16 w-16 text-lg font-bold',
    '2xl': 'h-24 w-24 text-2xl font-bold',
  };

  const roleRingClasses = {
    admin: 'ring-2 ring-gold border-2 border-background',
    manager: 'ring-2 ring-amber-500 border-2 border-background',
    project_manager: 'ring-2 ring-amber-500 border-2 border-background',
    employee: 'ring-2 ring-blue-500 border-2 border-background',
    junior_assistant: 'ring-2 ring-cyan-500 border-2 border-background',
    client: 'ring-2 ring-purple-500 border-2 border-background',
  };

  return (
    <div className="relative inline-flex flex-shrink-0">
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full overflow-hidden transition-transform duration-200 select-none shadow-sm',
          sizeClasses[size],
          showRoleRing && roleRingClasses[userRole as keyof typeof roleRingClasses],
          !effectiveImageUrl && 'bg-gradient-to-tr from-ink via-charcoal to-ink text-gold border border-gold/40',
          className,
        )}
      >
        {effectiveImageUrl ? (
          <img
            src={effectiveImageUrl}
            alt={displayName}
            onError={() => setImageError(true)}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span>{initials(displayName)}</span>
        )}
      </div>

      {showStatusDot && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-background',
            size === 'xs' || size === 'sm' ? 'h-2 w-2' : 'h-3 w-3',
            isOnline ? 'bg-emerald-500' : 'bg-muted-foreground',
          )}
        />
      )}
    </div>
  );
}
