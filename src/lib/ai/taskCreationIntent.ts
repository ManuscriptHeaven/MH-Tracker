import type { AIToolContext, DisambiguationOption } from './aiTypes';
import type { Profile, Project } from '../types';
import { normalizeEntityText, resolveUniqueEntityMatch } from './aiEntityMatcher';
import { parseNaturalDate } from '../date';

export interface TaskCreationOverrides {
  employeeId?: string;
  projectId?: string;
}

export type TaskCreationResolution =
  | { kind: 'ready'; title: string; assignee: Profile; project?: Project; dueDate?: string }
  | { kind: 'clarify'; field: 'employee' | 'project'; message: string; options: DisambiguationOption[] }
  | { kind: 'error'; code: string; message: string };

export function isCreateTaskRequest(text: string): boolean {
  return /^(?:please\s+)?(?:create|add|make)\s+(?:(?:a|new)\s+)?task\b/i.test(text.trim());
}

export function isActiveTaskProject(project: Project): boolean {
  const lifecycle = String(project.project_status || '').toLowerCase();
  const status = String(project.status || '').toLowerCase();
  return (!lifecycle || lifecycle === 'active') &&
    !['completed', 'delivered', 'cancelled', 'archived', 'on hold'].includes(status);
}

export function isAssignableTeamMember(profile: Profile): boolean {
  return profile.role !== 'client' &&
    profile.status !== 'inactive' &&
    !['resigned', 'retired', 'terminated'].includes(String(profile.employment_condition || 'active'));
}

function consonantKey(input: string): string {
  return normalizeEntityText(input).replace(/[aeiou\s]/g, '');
}

function resolveAssignee(name: string, people: Profile[]) {
  const normalized = normalizeEntityText(name);
  const exact = people.filter((person) => {
    const fullName = normalizeEntityText(person.full_name);
    return normalized === fullName || normalized === fullName.split(' ')[0];
  });
  if (exact.length) return exact;

  // Common short speech transcription differences (Zen/Zain) may share
  // consonants. Only trust a unique result; never silently choose among people.
  if (normalized.length >= 3 && !normalized.includes(' ')) {
    const phonetic = people.filter((person) => {
      const first = normalizeEntityText(person.full_name).split(' ')[0];
      return first.length >= 3 &&
        consonantKey(first) === consonantKey(normalized) &&
        Math.abs(first.length - normalized.length) <= 2;
    });
    if (phonetic.length) return phonetic;
  }

  const fuzzy = resolveUniqueEntityMatch(
    name,
    people.map((person) => ({
      id: person.id,
      label: person.full_name,
      aliases: [person.full_name.split(' ')[0]],
      item: person,
    })),
    { minScore: 0.83, minGap: 0.12, ambiguityWindow: 0.08 },
  );
  return fuzzy.match ? [fuzzy.match.item] : fuzzy.ambiguous.map((item) => item.item);
}

function resolveProject(name: string, projects: Project[]) {
  const normalized = normalizeEntityText(name);
  // A comma after a partial title may be a speech correction:
  // "The Smart, The End of Smart" -> use the last exact, complete title.
  const fragments = name.split(/[,;]\s*/).map(normalizeEntityText).filter(Boolean);
  for (const fragment of [...fragments].reverse()) {
    const exact = projects.filter((project) =>
      normalizeEntityText(project.project_title) === fragment ||
      normalizeEntityText(project.project_number) === fragment);
    if (exact.length) return exact;
  }

  const contained = projects.filter((project) => {
    const title = normalizeEntityText(project.project_title);
    const number = normalizeEntityText(project.project_number);
    return (title.length >= 4 && normalized.includes(title)) ||
      (number.length >= 3 && normalized.includes(number));
  });
  if (contained.length) {
    const longest = Math.max(...contained.map((project) => normalizeEntityText(project.project_title).length));
    return contained.filter((project) => normalizeEntityText(project.project_title).length === longest);
  }

  const ranked = resolveUniqueEntityMatch(
    name,
    projects.map((project) => ({
      id: project.id,
      label: project.project_title,
      aliases: [project.project_number],
      item: project,
    })),
    { minScore: 0.83, minGap: 0.12, ambiguityWindow: 0.08 },
  );
  return ranked.match ? [ranked.match.item] : ranked.ambiguous.map((item) => item.item);
}

export function resolveTaskCreation(
  rawQuery: string,
  ctx: Pick<AIToolContext, 'currentProfile' | 'data' | 'visibleProjects'>,
  overrides: TaskCreationOverrides = {},
): TaskCreationResolution {
  let instruction = rawQuery.trim().replace(
    /^(?:please\s+)?(?:create|add|make)\s+(?:(?:a|new)\s+)?task\b\s*[:,-]?\s*/i,
    '',
  );

  let requestedAssignee: string | undefined;
  const forTo = instruction.match(/^(?:for|assigned\s+to)\s+(.+?)\s+to\s+(.+)$/i);
  const forColon = instruction.match(/^(?:for|assigned\s+to)\s+(.+?)\s*[:,-]\s*(.+)$/i);
  const assigneeClause = forTo || forColon;
  if (assigneeClause) {
    requestedAssignee = assigneeClause[1].trim();
    instruction = assigneeClause[2].trim();
  } else if (/^(?:for|assigned\s+to)\s+/i.test(instruction)) {
    return {
      kind: 'error',
      code: 'task_details_required',
      message: 'Please say the employee name followed by the task, for example: "for Zain to update the e-book cover".',
    };
  }

  let requestedProject: string | undefined;
  const projectMatch = instruction.match(
    /\s+(?:for|under|in|linked\s+to|associated\s+with)\s+(?:the\s+)?project(?:\s+(?:named|called|titled))?\s*[:\-]?\s+(.+)$/i,
  );
  if (projectMatch) {
    requestedProject = projectMatch[1].replace(/[.!?]+$/, '').trim();
    instruction = instruction.slice(0, projectMatch.index).trim();
  } else if (/\b(?:for|under|in)\s+(?:the\s+)?project\b/i.test(instruction)) {
    return { kind: 'error', code: 'project_required', message: 'Please tell me which active project this task belongs to.' };
  }

  // Due dates are optional. Do not inadvertently strip "update" or project names.
  let dueDate: string | undefined;
  const dueMatch = instruction.match(/\s+(?:(?:due\s+|by\s+|on\s+))?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*$/i);
  if (dueMatch) {
    dueDate = parseNaturalDate(dueMatch[1]) || undefined;
    instruction = instruction.slice(0, dueMatch.index).trim();
  }

  // Clean up the original spoken instruction; avoid moving an entire project
  // label into the task title or including the employee name as a prefix.
  const title = instruction.replace(/^(?:to\s+|[:,-]\s*)/i, '').replace(/[.!?]+$/, '').trim();
  if (title.length < 3) {
    return { kind: 'error', code: 'task_details_required', message: 'What work should the employee do? Please provide a task title.' };
  }

  const people = ctx.data.profiles.filter(isAssignableTeamMember);
  let assignee: Profile | undefined;
  if (overrides.employeeId) {
    assignee = people.find((person) => person.id === overrides.employeeId);
    if (!assignee) return { kind: 'error', code: 'employee_not_found', message: 'The selected team member is not available for task assignments.' };
  } else if (requestedAssignee) {
    const matches = resolveAssignee(requestedAssignee, people);
    if (matches.length > 1) {
      return {
        kind: 'clarify',
        field: 'employee',
        message: `I found multiple team members matching "${requestedAssignee}". Which person should receive this task?`,
        options: matches.slice(0, 6).map((person) => ({ id: person.id, title: person.full_name, subtitle: person.role, type: 'employee' as const })),
      };
    }
    if (!matches.length) {
      return { kind: 'error', code: 'employee_not_found', message: `I couldn't identify "${requestedAssignee}" as an active team member. Please give the correct employee name.` };
    }
    assignee = matches[0];
  } else {
    assignee = people.find((person) => person.id === ctx.currentProfile.id);
  }

  if (!assignee) {
    return { kind: 'error', code: 'employee_not_found', message: 'I could not identify a valid team member for this task.' };
  }

  const activeProjects = ctx.visibleProjects.filter(isActiveTaskProject);
  let project: Project | undefined;
  if (overrides.projectId) {
    project = activeProjects.find((p) => p.id === overrides.projectId);
    if (!project) return { kind: 'error', code: 'project_not_found', message: 'The selected project is no longer active or visible.' };
  } else if (requestedProject) {
    const matches = resolveProject(requestedProject, activeProjects);
    if (matches.length > 1) {
      return {
        kind: 'clarify',
        field: 'project',
        message: `Multiple active projects match "${requestedProject}". Which one do you mean?`,
        options: matches.slice(0, 6).map((p) => ({
          id: p.id, title: p.project_title, subtitle: `${p.project_number} · ${p.client_name}`, type: 'project' as const,
        })),
      };
    }
    if (!matches.length) {
      return { kind: 'error', code: 'project_not_found', message: `I couldn't find an active project matching "${requestedProject}". No task has been created.` };
    }
    project = matches[0];
  }

  return { kind: 'ready', title, assignee, project, dueDate };
}
