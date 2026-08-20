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
  const [quickFilter, setQuickFilter] = useState<'all' | 'mine' | 'in_progress' | 'awaiting_approval' | 'revision' | 'today' | 'overdue' | 'completed'>('all');
  const [assignedTo, setAssignedTo] = useState('all');
  const [status, setStatus] = useState('all');
  const [client, setClient] = useState('all');
  const [priority, setPriority] = useState('all');

  const allActiveProjects = projects
    .filter((project) => !closedStatuses.includes(project.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const isRevision = (project: Project) => project.status === 'In Revision' || project.stage_status === 'REVISION_ACTIVE';
  const isAwaitingApproval = (project: Project) => (project.status === 'Awaiting Client Approval' || project.stage_status === 'PAUSED_CLIENT_REVIEW') && project.stage_status !== 'REVISION_ACTIVE';
  const isInProgress = (project: Project) => project.status === 'In Progress' || project.status === 'Active' || project.status === 'Final Delivery';
  const isCompleted = (project: Project) => project.status === 'Completed' || project.status === 'Delivered';

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

  const activeProjects = scopedAllProjects.filter((project) => {
    if (quickFilter === 'completed') return isCompleted(project);
    if (closedStatuses.includes(project.status)) return false;
    if (quickFilter === 'mine') return project.assigned_to === currentProfileId;
    if (quickFilter === 'in_progress') return isInProgress(project);
    if (quickFilter === 'awaiting_approval') return isAwaitingApproval(project);
    if (quickFilter === 'revision') return isRevision(project);
    if (quickFilter === 'today') return isDueToday(project);
    if (quickFilter === 'overdue') return isOverdue(project);
    return true;
  });

  const inProgressProjects = scopedProjects.filter(isInProgress);
  const awaitingApprovalProjects = scopedProjects.filter(isAwaitingApproval);
  const inRevisionProjects = scopedProjects.filter(isRevision);
  const overdueProjects = scopedProjects.filter(isOverdue);
  const dueTodayProjects = scopedProjects.filter(isDueToday);
  const completedProjects = scopedAllProjects.filter(isCompleted);

  const pendingPayments = scopedProjects.reduce((total, project) => total + Number(project.remaining_balance || 0), 0);
  const urgentProjects = scopedProjects
    .filter((project) => project.priority === 'Urgent' || isOverdue(project) || isDueToday(project))
    .slice(0, 5);

  const workload = profiles.filter((profile) => !isClientRole(profile.role) && (assignedTo === 'all' || profile.id === assignedTo)).map((profile) => {
    const assigned = scopedProjects.filter((project) => project.assigned_to === profile.id);
    return {
      profile,
      active: assigned.length,
      overdue: assigned.filter(isOverdue).length,
    };
  });

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {([
            ['all', 'Active Projects', scopedProjects.length],
            ['in_progress', 'In Progress', inProgressProjects.length],
            ['awaiting_approval', 'Awaiting Client Approval', awaitingApprovalProjects.length],
            ['revision', 'In Revision', inRevisionProjects.length],
            ['today', 'Due Today', dueTodayProjects.length],
            ['overdue', 'Overdue', overdueProjects.length],
            ['completed', 'Completed', completedProjects.length],
            ['mine', 'My Projects', scopedProjects.filter((p) => p.assigned_to === currentProfileId).length],
          ] as const).map(([id, label, count]) => {
            return <Button key={id} type="button" variant={quickFilter === id ? 'primary' : 'secondary'} onClick={() => setQuickFilter(id as typeof quickFilter)} className="shrink-0 text-xs sm:text-sm py-1.5 px-3">{label} ({count})</Button>;
          })}
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Assigned To" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="all">All Team Members</option>{profiles.filter((profile) => !isClientRole(profile.role)).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</SelectField>
          <SelectField label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All Statuses</option>{[...new Set(scopedAllProjects.map((project) => project.status))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
          <SelectField label="Client" value={client} onChange={(event) => setClient(event.target.value)}><option value="all">All Clients</option>{[...new Set(scopedAllProjects.map((project) => project.client_name))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
          <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All Priorities</option>{[...new Set(scopedAllProjects.map((project) => project.priority))].map((item) => <option key={item} value={item}>{item}</option>)}</SelectField>
        </div>
      </Card>
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Active Projects" value={scopedProjects.length} icon={FolderOpen} tone="bg-blue-50 text-info" />
        <StatCard label="In Progress" value={inProgressProjects.length} icon={FolderOpen} tone="bg-amber-50 text-amber-800" />
        <StatCard label="Awaiting Client Approval" value={awaitingApprovalProjects.length} icon={Clock3} tone="bg-purple-50 text-purple-700" />
        <StatCard label="In Revision" value={inRevisionProjects.length} icon={FolderOpen} tone="bg-orange-50 text-orange-700" />
        <StatCard label="Due Today" value={dueTodayProjects.length} icon={Clock3} tone="bg-orange-50 text-warning" />
        <StatCard label="Overdue" value={overdueProjects.length} icon={AlertTriangle} tone="bg-red-50 text-danger" />
        <StatCard
          label="Completed"
          value={completedProjects.length}
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
        <Card className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-semibold">Open Projects</h2>
              <p className="text-xs sm:text-sm text-muted">
                Showing {activeProjects.length} matching open project{activeProjects.length === 1 ? '' : 's'}, newest first.
              </p>
            </div>
            {canManageProjects ? (
              <Button onClick={onAddProject} className="self-start sm:self-auto text-xs py-2 px-3">
                <Plus className="h-4 w-4" />
                Add Project
              </Button>
            ) : null}
          </div>

          <div className="mt-5 hidden md:block overflow-x-auto">
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

          <div className="mt-4 block md:hidden space-y-3">
            {activeProjects.length ? (
              activeProjects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-xl border border-border bg-white p-4 shadow-xs space-y-3 transition hover:border-gold/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-ink text-base truncate">{project.project_title}</h3>
                      <p className="text-xs text-muted mt-0.5">{project.project_number} · {project.client_name}</p>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/60">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">Assigned</p>
                      <p className="font-medium text-ink mt-0.5">{profileName(profiles, project.assigned_to)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">Due</p>
                      <p className={`text-xs font-semibold mt-0.5 ${deadlineClass(project)}`}>
                        {deadlineLabel(project)}
                      </p>
                    </div>
                  </div>

                  <div className="pt-1">
                    <ProjectTimelineCompact project={project} />
                  </div>

                  <div className="pt-2 border-t border-border/60 flex items-center justify-end">
                    <Button
                      type="button"
                      onClick={() => onSelectProject(project)}
                      className="w-full text-xs py-2"
                    >
                      Open Project
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
                No projects match these filters.
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-4 sm:p-6">
            <h2 className="font-display text-xl sm:text-2xl font-semibold">Urgent Projects</h2>
            <div className="mt-4 space-y-3">
              {urgentProjects.length ? (
                urgentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className="w-full rounded-xl border border-border bg-white p-3.5 text-left transition hover:border-gold shadow-xs active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{project.project_title}</p>
                        <p className="text-xs text-muted">{project.client_name}</p>
                      </div>
                      <span className={`text-xs font-semibold ${deadlineClass(project)}`}>
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
            <Card className="p-4 sm:p-6">
              <h2 className="font-display text-xl sm:text-2xl font-semibold">Workload</h2>
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
