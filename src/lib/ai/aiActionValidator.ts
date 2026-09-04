import type { ActionToolName, TargetResource } from './aiActionTypes';
import type { AIToolContext } from './aiTypes';

export interface ValidationResult {
  valid: boolean;
  missingRequired: string[];
  invalidParameters: Record<string, string>;
  warnings: string[];
  conflictDetected?: boolean;
}

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = [
  'to do',
  'in progress',
  'in review',
  'done',
  'pending',
  'design concept in progress',
  'awaiting print approval',
  'print version in progress',
];

export function validateActionParameters(
  actionTool: ActionToolName,
  params: Record<string, any>,
  ctx: AIToolContext,
): ValidationResult {
  const missingRequired: string[] = [];
  const invalidParameters: Record<string, string> = {};
  const warnings: string[] = [];
  let conflictDetected = false;

  // 1. Check Required Parameters
  if (actionTool === 'create_task') {
    if (!params.title || typeof params.title !== 'string' || !params.title.trim()) {
      missingRequired.push('title');
    }
  } else if (actionTool === 'update_task') {
    if (!params.task_id && !params.taskId) {
      missingRequired.push('task_id');
    }
  } else if (actionTool === 'assign_task') {
    if (!params.task_id && !params.taskId) {
      missingRequired.push('task_id');
    }
    if (!params.assigned_to && !params.assignedTo && !params.assignee) {
      missingRequired.push('assigned_to');
    }
  } else if (actionTool === 'create_project') {
    if (!params.project_title && !params.projectTitle && !params.title) {
      missingRequired.push('project_title');
    }
  } else if (actionTool === 'update_project') {
    if (!params.project_id && !params.projectId) {
      missingRequired.push('project_id');
    }
  } else if (actionTool === 'create_reminder') {
    if (!params.title || typeof params.title !== 'string' || !params.title.trim()) {
      missingRequired.push('title');
    }
  } else if (actionTool === 'update_calendar') {
    if (!params.title && !params.event_id) {
      missingRequired.push('title');
    }
  } else if (actionTool === 'add_note') {
    if (!params.target_type && !params.targetType) missingRequired.push('target_type');
    if (!params.target_id && !params.targetId) missingRequired.push('target_id');
    if (!params.content && !params.note_content) missingRequired.push('content');
  }

  // 2. Validate Enum Values
  if (params.priority && typeof params.priority === 'string') {
    if (!VALID_PRIORITIES.includes(params.priority.toLowerCase())) {
      invalidParameters.priority = `Priority must be one of: Low, Medium, High, Urgent. Received "${params.priority}".`;
    }
  }

  if (params.status && typeof params.status === 'string') {
    if (!VALID_STATUSES.includes(params.status.toLowerCase())) {
      invalidParameters.status = `Status "${params.status}" is not a recognized workflow status.`;
    }
  }

  // 3. Duplicate Task Check (for create_task)
  if (actionTool === 'create_task' && params.title && ctx.data.tasks) {
    const existingTask = ctx.data.tasks.find(
      (t) =>
        t.title.toLowerCase() === params.title.toLowerCase() &&
        (params.project_id ? t.project_id === params.project_id : true),
    );
    if (existingTask) {
      warnings.push(
        `A task with the name "${params.title}" already exists under task ID #${existingTask.id.slice(0, 6)}.`,
      );
    }
  }

  // 4. Assignee Existence & Eligibility Check
  if (
    (actionTool === 'assign_task' || actionTool === 'create_task') &&
    (params.assigned_to || params.assignedTo || params.assignee)
  ) {
    const assigneeInput = (params.assigned_to || params.assignedTo || params.assignee) as string;
    const targetEmp = ctx.data.profiles.find(
      (p) =>
        p.id === assigneeInput ||
        p.full_name.toLowerCase().includes(assigneeInput.toLowerCase()) ||
        p.email.toLowerCase().includes(assigneeInput.toLowerCase()),
    );
    if (!targetEmp) {
      invalidParameters.assigned_to = `Could not find an active team member matching "${assigneeInput}".`;
    } else if (targetEmp.role === 'client') {
      invalidParameters.assigned_to = `Cannot assign tasks to client account "${targetEmp.full_name}".`;
    }
  }

  return {
    valid: missingRequired.length === 0 && Object.keys(invalidParameters).length === 0,
    missingRequired,
    invalidParameters,
    warnings,
    conflictDetected,
  };
}
