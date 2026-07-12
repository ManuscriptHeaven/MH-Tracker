import { Mail, Phone } from 'lucide-react';
import { RoleBadge } from '../components/Badges';
import { Card } from '../components/ui';
import { isOverdue } from '../lib/date';
import { firstName, initials, isClientRole } from '../lib/utils';
import type { Profile, Project } from '../lib/types';

export function TeamPage({
  profiles,
  projects,
}: {
  profiles: Profile[];
  projects: Project[];
}) {
  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {teamProfiles.map((profile) => {
        const assigned = projects.filter((project) => project.assigned_to === profile.id);
        const active = assigned.filter((project) => project.status !== 'Delivered' && project.status !== 'Cancelled');
        const overdue = active.filter(isOverdue);
        const displayName = firstName(profile.full_name);

        return (
          <Card key={profile.id}>
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-gold/20 text-lg font-bold">
                {initials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-xl font-semibold">{displayName}</h3>
                <div className="mt-2">
                  <RoleBadge role={profile.role} />
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-ivory p-3">
                <p className="text-2xl font-bold">{active.length}</p>
                <p className="text-xs text-muted">Active</p>
              </div>
              <div className="rounded-md bg-ivory p-3">
                <p className="text-2xl font-bold text-danger">{overdue.length}</p>
                <p className="text-xs text-muted">Overdue</p>
              </div>
              <div className="rounded-md bg-ivory p-3">
                <p className="text-2xl font-bold">{assigned.length}</p>
                <p className="text-xs text-muted">Total</p>
              </div>
            </div>

            <div className="mt-5 space-y-2 text-sm text-muted">
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {profile.email}
              </p>
              {profile.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  {profile.phone}
                </p>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
