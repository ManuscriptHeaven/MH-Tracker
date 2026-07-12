import { Copy, Download, Edit, Eye, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PaymentBadge, PriorityBadge, StatusBadge } from '../components/Badges';
import { Button, Card, EmptyState, IconButton, SelectField } from '../components/ui';
import { paymentStatuses, priorityOptions, serviceTypes, statusOptions } from '../lib/constants';
import { deadlineClass, deadlineLabel, formatDate } from '../lib/date';
import { currency, downloadTextFile, firstName, isClientRole, projectCsv } from '../lib/utils';
import type { PaymentStatus, Priority, Profile, Project, ProjectStatus } from '../lib/types';

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

export function ProjectsPage({
  title = 'Projects',
  projects,
  profiles,
  searchTerm,
  canManageAll,
  currentProfile,
  onSelectProject,
  onEditProject,
  onDeleteProject,
  onDuplicateProject,
  onUpdateProject,
  onAddProject,
  emptyTitle = 'No projects yet',
  emptyMessage = 'Create the first project to begin tracking deadlines, assignments, revisions, and payments.',
}: {
  title?: string;
  projects: Project[];
  profiles: Profile[];
  searchTerm: string;
  canManageAll: boolean;
  currentProfile: Profile;
  onSelectProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onDuplicateProject: (project: Project) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => void;
  onAddProject: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const canViewPayments = canManageAll;
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'all'>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = projects
    .filter((project) => {
      const matchesSearch =
        !normalizedSearch ||
        project.project_title.toLowerCase().includes(normalizedSearch) ||
        project.client_name.toLowerCase().includes(normalizedSearch) ||
        project.project_number.toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || project.priority === priorityFilter;
      const matchesPayment = !canViewPayments || paymentFilter === 'all' || project.payment_status === paymentFilter;
      const matchesService = serviceFilter === 'all' || project.service_type === serviceFilter;
      const matchesEmployee = employeeFilter === 'all' || project.assigned_to === employeeFilter;

      return matchesSearch && matchesStatus && matchesPriority && matchesPayment && matchesService && matchesEmployee;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function exportProjects() {
    downloadTextFile('manuscript-heaven-projects.csv', projectCsv(filtered), 'text/csv');
  }

  if (!filtered.length && projects.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        message={emptyMessage}
        action={
          canManageAll ? (
            <Button onClick={onAddProject}>
              <Edit className="h-4 w-4" />
              Add Project
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">
              {filtered.length} visible project{filtered.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <SelectField label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProjectStatus | 'all')}>
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
            <SelectField label="Employee" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
              <option value="all">All employees</option>
              {teamProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {firstName(profile.full_name)}
                </option>
              ))}
            </SelectField>
            <SelectField label="Priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as Priority | 'all')}>
              <option value="all">All priorities</option>
              {priorityOptions.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </SelectField>
            {canViewPayments ? (
              <SelectField label="Payment" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentStatus | 'all')}>
                <option value="all">All payments</option>
                {paymentStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </SelectField>
            ) : null}
            <SelectField label="Service" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
              <option value="all">All services</option>
              {serviceTypes.map((service) => (
                <option key={service}>{service}</option>
              ))}
            </SelectField>
            {canViewPayments ? (
              <Button type="button" variant="secondary" onClick={exportProjects}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-ivory text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Due Date</th>
                {canViewPayments ? <th className="px-4 py-3">Payment</th> : null}
                <th className="px-4 py-3">Quick Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr key={project.id} className="transition hover:bg-ivory/70">
                  <td className="border-t border-border px-4 py-3">
                    <button className="text-left" onClick={() => onSelectProject(project)}>
                      <p className="font-semibold text-ink">{project.project_title}</p>
                      <p className="text-xs text-muted">{project.project_number}</p>
                    </button>
                  </td>
                  <td className="border-t border-border px-4 py-3">{project.client_name}</td>
                  <td className="border-t border-border px-4 py-3">{profileName(profiles, project.assigned_to)}</td>
                  <td className="border-t border-border px-4 py-3">
                    <StatusBadge status={project.status} />
                  </td>
                  <td className="border-t border-border px-4 py-3">
                    <PriorityBadge priority={project.priority} />
                  </td>
                  <td className="border-t border-border px-4 py-3">
                    <p className={`font-semibold ${deadlineClass(project)}`}>{deadlineLabel(project)}</p>
                    <p className="text-xs text-muted">{formatDate(project.due_date)}</p>
                  </td>
                  {canViewPayments ? (
                    <td className="border-t border-border px-4 py-3">
                      <PaymentBadge status={project.payment_status} />
                      <p className="mt-1 text-xs text-muted">{currency(project.remaining_balance)} due</p>
                    </td>
                  ) : null}
                  <td className="border-t border-border px-4 py-3">
                    <select
                      value={project.status}
                      onChange={(event) =>
                        onUpdateProject(project.id, { status: event.target.value as ProjectStatus })
                      }
                      className="h-10 rounded-md border border-border bg-white px-2 text-xs"
                    >
                      {statusOptions.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border-t border-border px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <IconButton title="View project" onClick={() => onSelectProject(project)}>
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      {canManageAll ? (
                        <IconButton title="Edit project" onClick={() => onEditProject(project)}>
                          <Edit className="h-4 w-4" />
                        </IconButton>
                      ) : null}
                      {canManageAll ? (
                        <IconButton title="Duplicate project" onClick={() => onDuplicateProject(project)}>
                          <Copy className="h-4 w-4" />
                        </IconButton>
                      ) : null}
                      {currentProfile.role === 'admin' ? (
                        <IconButton title="Delete project" onClick={() => onDeleteProject(project)}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length ? (
          <div className="p-6">
            <EmptyState title="No matching projects" message="Try changing the search term or filters." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
