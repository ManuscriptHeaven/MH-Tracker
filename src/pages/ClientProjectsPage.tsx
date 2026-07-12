import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PriorityBadge, StatusBadge } from '../components/Badges';
import { Button, Card, EmptyState } from '../components/ui';
import { activeClientProjectStatuses } from '../lib/constants';
import { formatDate } from '../lib/date';
import type { Project } from '../lib/types';

type ClientProjectFilter = 'all' | 'active' | 'completed' | 'cancelled' | 'archived';

const filterLabels: Record<ClientProjectFilter, string> = {
  all: 'All Projects',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

function latestProof(project: Project) {
  return (
    project.proof_pdf_link ||
    project.final_print_pdf_link ||
    project.final_ebook_link ||
    project.cover_file_link ||
    ''
  );
}

function projectMatchesFilter(project: Project, filter: ClientProjectFilter) {
  const status = project.status as string;

  if (filter === 'active') {
    return activeClientProjectStatuses.includes(project.status);
  }

  if (filter === 'completed') {
    return status === 'Delivered' || status === 'Completed';
  }

  if (filter === 'cancelled') {
    return status === 'Cancelled';
  }

  if (filter === 'archived') {
    return status === 'Archived' || status === 'On Hold';
  }

  return true;
}

export function ClientProjectsPage({
  projects,
  searchTerm,
}: {
  projects: Project[];
  searchTerm: string;
}) {
  const [filter, setFilter] = useState<ClientProjectFilter>('all');
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredProjects = useMemo(
    () =>
      projects
        .filter((project) => {
          const matchesFilter = projectMatchesFilter(project, filter);
          const matchesSearch =
            !normalizedSearch ||
            project.project_title.toLowerCase().includes(normalizedSearch) ||
            project.project_number.toLowerCase().includes(normalizedSearch) ||
            project.client_name.toLowerCase().includes(normalizedSearch);

          return matchesFilter && matchesSearch;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [filter, normalizedSearch, projects],
  );

  if (!projects.length) {
    return (
      <EmptyState
        title="No projects yet"
        message="Your project history will appear here after Manuscript Heaven grants access."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">Projects</h2>
            <p className="mt-1 text-sm text-muted">
              {filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'} shown
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as ClientProjectFilter[]).map((item) => (
              <Button
                key={item}
                type="button"
                variant={filter === item ? 'primary' : 'secondary'}
                onClick={() => setFilter(item)}
              >
                {filterLabels[item]}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4">
        {filteredProjects.map((project) => {
          const proof = latestProof(project);

          return (
            <Card key={project.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                      {project.project_number}
                    </span>
                    <StatusBadge status={project.status} />
                    <PriorityBadge priority={project.priority} />
                  </div>
                  <h3 className="mt-3 font-display text-2xl font-semibold">{project.project_title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {project.service_type} | Due {formatDate(project.due_date)}
                  </p>
                </div>

                <div className="rounded-md border border-border bg-ivory p-4 lg:w-80">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <FileText className="h-4 w-4 text-gold" />
                    Latest File
                  </div>
                  {proof ? (
                    <a href={proof} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold text-info">
                      Open shared file
                    </a>
                  ) : (
                    <p className="text-sm text-muted">No proof or delivery file has been shared yet.</p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!filteredProjects.length ? (
        <EmptyState title="No matching projects" message="Try a different project filter or search term." />
      ) : null}
    </div>
  );
}
