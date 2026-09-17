import { isClosed, todayInput } from '../date';
import type { Project, Task } from '../types';

export interface BasicAgentSnapshot {
  projects: Project[];
  tasks: Task[];
}

export interface BasicAgentReply {
  text: string;
  intent: 'help' | 'project_summary' | 'overdue_projects' | 'due_today_projects' | 'task_summary' | 'overdue_tasks' | 'due_today_tasks' | 'read_only' | 'unsupported';
}

const READ_ONLY_MESSAGE = 'Basic Agent v1 is read-only. I can summarize visible projects and tasks, but I cannot create, change, delete, assign, send, or record anything.';
const HELP_MESSAGE = 'Basic Agent v1 can answer: “Summarize projects”, “Which projects are overdue?”, “Which projects are due today?”, “Summarize tasks”, “Which tasks are overdue?”, and “Which tasks are due today?”. Answers use only the projects and tasks visible to you. It cannot make changes.';

function describeItems(items: string[], noun: string): string {
  if (items.length === 0) return `No ${noun}.`;
  const first = items.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n');
  return `${items.length} ${noun}${items.length > 5 ? ' (showing the first 5)' : ''}:\n${first}`;
}

/** A deliberately bounded, read-only first agent. No model, network call, or mutation tool is involved. */
export function runBasicAgent(query: string, snapshot: BasicAgentSnapshot, today = todayInput()): BasicAgentReply {
  const text = query.trim().toLowerCase();
  if (!text || text.length > 500) {
    return { intent: 'unsupported', text: 'Please ask a shorter question about your visible projects or tasks.' };
  }

  // A write request never falls through to a read answer, even if it also mentions a supported topic.
  if (/\b(create|add|edit|update|change|delete|remove|assign|reassign|send|record|approve|mark|move|put|generate|pay|complete)\b/i.test(text)) {
    return { intent: 'read_only', text: READ_ONLY_MESSAGE };
  }

  const projects = snapshot.projects || [];
  const tasks = snapshot.tasks || [];
  const activeProjects = projects.filter((project) => !isClosed(project));
  const openTasks = tasks.filter((task) => task.status !== 'Done');
  const asksTasks = /\b(tasks?|to.dos?)\b/.test(text);
  const asksProjects = /\b(projects?|books?)\b/.test(text);
  const asksOverdue = /\b(overdue|late|past due)\b/.test(text);
  const asksToday = /\b(today|due now)\b/.test(text);

  if (/\b(help|hello|hi|what can you do)\b/.test(text)) {
    return { intent: 'help', text: HELP_MESSAGE };
  }
  if (asksTasks && asksOverdue) {
    const overdue = openTasks.filter((task) => task.due_date && task.due_date.slice(0, 10) < today);
    return { intent: 'overdue_tasks', text: describeItems(overdue.map((task) => `${task.title} — due ${task.due_date!.slice(0, 10)}`), 'overdue tasks') };
  }
  if (asksTasks && asksToday) {
    const due = openTasks.filter((task) => task.due_date?.slice(0, 10) === today);
    return { intent: 'due_today_tasks', text: describeItems(due.map((task) => task.title), 'tasks due today') };
  }
  if (asksTasks) {
    return { intent: 'task_summary', text: `You can see ${tasks.length} tasks: ${openTasks.length} open and ${tasks.length - openTasks.length} done.` };
  }
  if (asksProjects && asksOverdue) {
    const overdue = activeProjects.filter((project) => project.due_date && project.due_date.slice(0, 10) < today);
    return { intent: 'overdue_projects', text: describeItems(overdue.map((project) => `${project.project_title} — due ${project.due_date?.slice(0, 10) || 'not set'}`), 'overdue projects') };
  }
  if (asksProjects && asksToday) {
    const due = activeProjects.filter((project) => project.due_date?.slice(0, 10) === today);
    return { intent: 'due_today_projects', text: describeItems(due.map((project) => project.project_title), 'projects due today') };
  }
  if (asksProjects) {
    return { intent: 'project_summary', text: `You can see ${projects.length} projects: ${activeProjects.length} active and ${projects.length - activeProjects.length} closed.` };
  }
  return { intent: 'unsupported', text: `I can't answer that reliably in Basic Agent v1. ${HELP_MESSAGE}` };
}
