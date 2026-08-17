import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, FolderOpen, Plus } from 'lucide-react';
import { StatusBadge } from '../components/Badges';
import { ProjectTimelineCompact } from '../components/ProjectTimeline';
import { Button, Card, SelectField } from '../components/ui';
import { closedStatuses } from '../lib/constants';
import { isDueThisWeek, isDueToday, isOverdue, formatDate, deadlineClass, deadlineLabel } from '../lib/date';
import { firstName, initials, isClientRole } from '../lib/utils';
import { useCurrency } from '../lib/currency';
import type { Profile, Project } from '../lib/types';

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof FolderOpen;
  tone: string;
}) {
  return (
    <Card className="min-h-32">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-3 text-3xl font-bold text-ink">{value}</p>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-md ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

export function DashboardPage({
  projects,
  profiles,
  canViewPayments,
  canManageProjects,
  currentProfileId,
  onAddProject,
  onSelectProject,
}: {
  projects: Project[];
  profiles: Profile[];
  canViewPayments: boolean;
  canManageProjects: boolean;
  currentProfileId: string;
  onAddProject: () => void;
  onSelectProject: (project: Project) => void;
}) {
  const { formatMoney } = useCurrency();
  const [quickFilter, setQuickFilter] = useState<'all' | 'mine' | 'unassigned' | 'today' | 'overdue' | 'week' | 'revision' | 'review'>('all');
  const [assignedTo, setAssignedTo] = useState('all');
  const [status, setStatus] = useState('all');
  const [client, setClient] = useState('all');
  const [priority, setPriority] = useState('all');
  const allActiveProjects = projects
    .filter((project) => !closedStatuses.includes(project.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const isRevision = (project: Project) => ['In Revision', 'Revision Requested', 'Concept Revisions', 'Print Revisions'].includes(project.status) || project.stage_status === 'REVISION_ACTIVE';
  const isReview = (project: Project) => (['Client Review', 'Awaiting Concept Approval', 'Awaiting Print Approval', 'eBook Review'].includes(project.status) || project.stage_status === 'PAUSED_CLIENT_REVIEW') && project.stage_status !== 'REVISION_ACTIVE';
  const scopedProjects = useMemo(() => allActiveProjects.filter((project) =>
    (assignedTo === 'all' || project.assigned_to === assignedTo) &&
    (status === 'all' || project.status === status) &&
    (client === 'all' || project.client_name === client) &&
    (priority === 'all' || project.priority === priority),
  ), [allActiveProjects, assignedTo, status, client, priority]);
  const scopedAllProjects = useMemo(() => projects.filter((project) =>
    (assignedTo === 'all' || project.assigned_to === assignedTo) &&
    (status === 'all' || project.status === status) &&
    (client === 'all' || project.client_name === client) &&
    (priority === 'all' || project.priority === priority),
  ), [projects, assignedTo, status, client, priority]);
  const activeProjects = scopedProjects.filter((project) => {
    if (quickFilter === 'mine') return project.assigned_to === currentProfileId;
    if (quickFilter === 'unassigned') return !project.assigned_to;
    if (quickFilter === 'today') return isDueToday(project);
    if (quickFilter === 'overdue') return isOverdue(project);
    if (quickFilter === 'week') return isDueThisWeek(project);
    if (quickFilter === 'revision') return isRevision(project);
    if (quickFilter === 'review') return isReview(project);
    return true;
  });
  const overdueProjects = activeProjects.filter(isOverdue);
  const dueToday = activeProjects.filter(isDueToday);
  const dueThisWeek = activeProjects.filter(isDueThisWeek);
  const inRevision = activeProjects.filter(isRevision);
  const clientReview = activeProjects.filter(isReview);
  const deliveredThisMonth = scopedAllProjects.filter((project) => {
    const deliveryDate = project.delivery_date || project.final_delivery_date;
    if (!closedStatuses.includes(project.status) || !deliveryDate) {
      return false;
    }

    const delivered = new Date(`${deliveryDate}T12:00:00`);
    const now = new Date();
    return delivered.getMonth() === now.getMonth() && delivered.getFullYear() === now.getFullYear();
  });
  const pendingPayments = activeProjects.reduce((total, project) => total + Number(project.remaining_balance || 0), 0);
  const urgentProjects = activeProjects
    .filter((project) => project.priority === 'Urgent' || isOverdue(project) || isDueToday(project))
    .slice(0, 5);

  const workload = profiles.filter((profile) => !isClientRole(profile.role) && (assignedTo === 'all' || profile.id === assignedTo)).map((profile) => {
    const assigned = activeProjects.filter((project) => project.assigned_to === profile.id);
    return {
      profile,
      active: assigned.length,
      overdue: assigned.filter(isOverdue).length,
    };
  });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['all', 'All'], ['mine', 'My Projects'], ['unassigned', 'Unassigned'], ['today', 'Due Today'], ['overdue', 'Overdue'], ['week', 'This Week'], ['revision', 'In Revision'], ['review', 'Client Review'],
          ] as const).map(([id, label]) => {
            const count = id === 'all' ? scopedProjects.length : scopedProjects.filter((project) => id === 'mine' ? project.assigned_to === currentProfileId : id === 'unassigned' ? !project.assigned_to : id === 'today' ? isDueToday(project) : id === 'overdue' ? isOverdue(project) : id === 'week' ? isDueThisWeek(project) : id === 'revision' ? isRevision(project) : isReview(project)).length;
            return <Button key={id} type="button" variant={quickFilter === id ? 'primary' : 'secondary'} onClick={() => setQuickFilter(id)}>{label} ({count})</Button>;
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Assigned To" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="all">All Team Members</option>{profiles.filter((profile) => !isClientRole(profile.role)).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</SelectField>
          <SelectField label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All Statuses</option>{[...new Set(allActiveProjects.map((project) => project.status))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
          <SelectField label="Client" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">All Clients</option>{[...new Set(allActiveProjects.map((project) => project.client_name))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
          <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All Priorities</option>{[...new Set(allActiveProjects.map((project) => project.priority))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
        </div>
      </Card>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Projects" value={activeProjects.length} icon={FolderOpen} tone="bg-blue-50 text-info" />
        <StatCard label="Due Today" value={dueToday.length} icon={Clock3} tone="bg-orange-50 text-warning" />
        <StatCard label="Overdue" value={overdueProjects.length} icon={AlertTriangle} tone="bg-red-50 text-danger" />
        <StatCard label="Due This Week" value={dueThisWeek.length} icon={CalendarClock} tone="bg-amber-50 text-amber-700" />
        <StatCard label="In Revision" value={inRevision.length} icon={FolderOpen} tone="bg-orange-50 text-orange-700" />
        <StatCard label="Client Review" value={clientReview.length} icon={Clock3} tone="bg-cyan-50 text-cyan-700" />
        <StatCard
          label="Delivered This Month"
          value={deliveredThisMonth.length}
          icon={CheckCircle2}
          tone="bg-green-50 text-success"
        />
        {canViewPayments ? (
          <StatCard
            label="Pending Payments"
            value={formatMoney(pendingPayments, 'USD')}
            icon={CircleDollarSign}
            tone="bg-gold/20 text-ink"
          />
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold">Open Projects</h2>
              <p className="text-sm text-muted">
                Showing {activeProjects.length} matching open project{activeProjects.length === 1 ? '' : 's'}, newest first.
              </p>
            </div>
            {canManageProjects ? (
              <Button onClick={onAddProject}>
                <Plus className="h-4 w-4" />
                Add Project
              </Button>
            ) : null}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="border-b border-border pb-3">Project</th>
                  <th className="border-b border-border pb-3">Client</th>
                  <th className="border-b border-border pb-3">Assigned</th>
                  <th className="border-b border-border pb-3">Status</th>
                  <th className="border-b border-border pb-3">Timeline</th>
                  <th className="border-b border-border pb-3">Due</th>
                </tr>
              </thead>
              <tbody>
                {activeProjects.length ? activeProjects.map((project) => (
                  <tr
                    key={project.id}
                    className="cursor-pointer transition hover:bg-ivory"
                    onClick={() => onSelectProject(project)}
                  >
                    <td className="border-b border-border/70 py-3">
                      <p className="font-semibold">{project.project_title}</p>
                      <p className="text-xs text-muted">{project.project_number}</p>
                    </td>
                    <td className="border-b border-border/70 py-3">{project.client_name}</td>
                    <td className="border-b border-border/70 py-3">{profileName(profiles, project.assigned_to)}</td>
                    <td className="border-b border-border/70 py-3">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="border-b border-border/70 py-3">
                      <ProjectTimelineCompact project={project} />
                    </td>
                    <td className="border-b border-border/70 py-3">
                      <p className={deadlineClass(project)}>{deadlineLabel(project)}</p>
                      <p className="text-xs text-muted">{formatDate(project.due_date)}</p>
                    </td>
                  </tr>
                )) : <tr><td colSpan={6} className="py-8 text-center text-muted">No projects match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-2xl font-semibold">Urgent Projects</h2>
            <div className="mt-4 space-y-3">
              {urgentProjects.length ? (
                urgentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className="w-full rounded-md border border-border bg-white p-3 text-left transition hover:border-gold"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{project.project_title}</p>
                        <p className="text-sm text-muted">{project.client_name}</p>
                      </div>
                      <span className={`text-sm font-semibold ${deadlineClass(project)}`}>
                        {deadlineLabel(project)}
                      </span>
                    </div>
                    <div className="mt-3">
                      <ProjectTimelineCompact project={project} />
                    </div>
                  </button>
                ))
              ) : (
                <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                  No urgent projects right now.
                </p>
              )}
            </div>
          </Card>

          {canManageProjects ? (
            <Card>
              <h2 className="font-display text-2xl font-semibold">Workload</h2>
              <div className="mt-4 space-y-3">
                {workload.map(({ profile, active, overdue }) => (
                  <div key={profile.id} className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-gold/20 text-sm font-bold">
                      {initials(firstName(profile.full_name))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{firstName(profile.full_name)}</p>
                      <p className="text-xs text-muted">
                        {active} active | {overdue} overdue
                      </p>
                    </div>
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-ivory">
                      <div
                        className="h-full rounded-full bg-gold"
                        style={{ width: `${Math.min(active * 20, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
