import type { Project } from './types';

// project_status is the canonical lifecycle; older rows may not have it populated.
const CLOSED_LEGACY_STATUSES = new Set(['Completed', 'Cancelled', 'Archived', 'On Hold', 'Delivered']);

export function isActiveTaskProject(project: Project): boolean {
  if (project.project_status) return project.project_status === 'active';
  return !CLOSED_LEGACY_STATUSES.has(project.status);
}

export function activeTaskProjects(projects: Project[]): Project[] {
  return projects
    .filter(isActiveTaskProject)
    .sort((a, b) =>
      a.project_number.localeCompare(b.project_number, undefined, { numeric: true }) ||
      a.project_title.localeCompare(b.project_title));
}

export function searchTaskProjects(projects: Project[], query: string): Project[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return projects;
  return projects.filter((project) => {
    const text = [project.project_number, project.project_title, project.client_name]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
