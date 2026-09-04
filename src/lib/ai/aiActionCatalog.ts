import type { ActionToolName, ActionRiskLevel } from './aiActionTypes';

export interface ActionDefinition {
  actionTool: ActionToolName;
  description: string;
  mutatesData: true;
  riskLevel: ActionRiskLevel;
  requiresConfirmation: boolean;
  requiredCapabilities: string[];
  requiredParams: string[];
  optionalParams: string[];
}

/**
 * Phase 3 Central Action Allowlist & Risk Policy Catalog.
 * Un-listed actions are strictly forbidden by security guardrails.
 */
export const ACTION_CATALOG: Record<ActionToolName, ActionDefinition> = {
  create_task: {
    actionTool: 'create_task',
    description: 'Create a new task in MH Tracker',
    mutatesData: true,
    riskLevel: 'medium',
    requiresConfirmation: true,
    requiredCapabilities: ['tasks.create'],
    requiredParams: ['title'],
    optionalParams: ['assigned_to', 'project_id', 'due_date', 'priority', 'status', 'description'],
  },
  update_task: {
    actionTool: 'update_task',
    description: 'Update existing task properties (title, deadline, status, priority)',
    mutatesData: true,
    riskLevel: 'medium',
    requiresConfirmation: true,
    requiredCapabilities: ['tasks.update'],
    requiredParams: ['task_id'],
    optionalParams: ['title', 'due_date', 'status', 'priority', 'project_id', 'description'],
  },
  assign_task: {
    actionTool: 'assign_task',
    description: 'Assign or reassign a task to a team member',
    mutatesData: true,
    riskLevel: 'medium',
    requiresConfirmation: true,
    requiredCapabilities: ['tasks.assign'],
    requiredParams: ['task_id', 'assigned_to'],
    optionalParams: [],
  },
  create_project: {
    actionTool: 'create_project',
    description: 'Create a new project record',
    mutatesData: true,
    riskLevel: 'high',
    requiresConfirmation: true,
    requiredCapabilities: ['projects.create'],
    requiredParams: ['project_title'],
    optionalParams: ['client_id', 'client_name', 'due_date', 'priority', 'status', 'description'],
  },
  update_project: {
    actionTool: 'update_project',
    description: 'Update existing project details',
    mutatesData: true,
    riskLevel: 'high',
    requiresConfirmation: true,
    requiredCapabilities: ['projects.update'],
    requiredParams: ['project_id'],
    optionalParams: ['project_title', 'due_date', 'status', 'priority', 'client_id'],
  },
  create_reminder: {
    actionTool: 'create_reminder',
    description: 'Create a personal or contextual reminder',
    mutatesData: true,
    riskLevel: 'low',
    requiresConfirmation: false,
    requiredCapabilities: ['reminders.create'],
    requiredParams: ['title'],
    optionalParams: ['reminder_date', 'reminder_time', 'related_entity_id'],
  },
  update_calendar: {
    actionTool: 'update_calendar',
    description: 'Create or update calendar event schedule',
    mutatesData: true,
    riskLevel: 'high',
    requiresConfirmation: true,
    requiredCapabilities: ['calendar.update'],
    requiredParams: ['title'],
    optionalParams: ['event_id', 'event_date', 'start_time', 'end_time', 'description', 'project_id'],
  },
  add_note: {
    actionTool: 'add_note',
    description: 'Add a note to a project, task, or client',
    mutatesData: true,
    riskLevel: 'medium',
    requiresConfirmation: true,
    requiredCapabilities: ['notes.create'],
    requiredParams: ['target_type', 'target_id', 'content'],
    optionalParams: [],
  },
};

export const ALLOWED_ACTION_TOOLS: ActionToolName[] = Object.keys(ACTION_CATALOG) as ActionToolName[];

export function isAllowlistedAction(actionName: string): actionName is ActionToolName {
  return ALLOWED_ACTION_TOOLS.includes(actionName as ActionToolName);
}

export function getActionDefinition(actionTool: ActionToolName): ActionDefinition {
  return ACTION_CATALOG[actionTool];
}
