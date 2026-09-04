import type { AIActionPlan, ActionToolName, ConfirmationToken, TargetResource, ProposedChanges } from './aiActionTypes';
import { getActionDefinition, isAllowlistedAction } from './aiActionCatalog';
import { ConfirmationEngine } from './aiConfirmationEngine';
import type { IntentResult, ExtractedEntity, ResolvedDate, PageContext, AIToolContext } from './aiTypes';

const confirmationEngine = ConfirmationEngine.getInstance();

export interface ActionPlanBuildResult {
  isAction: boolean;
  actionPlan?: AIActionPlan;
  confirmationToken?: ConfirmationToken;
  cancellationDetected?: boolean;
}

export function buildActionPlan(
  userMessage: string,
  intent: IntentResult,
  resolvedEntities: Array<any>,
  resolvedDates: ResolvedDate[],
  toolCtx: AIToolContext,
  pageCtx?: PageContext,
): ActionPlanBuildResult {
  // Check for explicit cancellation request first
  if (confirmationEngine.isCancellationRequest(userMessage)) {
    const cancelledToken = confirmationEngine.cancelPendingToken(toolCtx.currentProfile.id);
    return {
      isAction: true,
      cancellationDetected: true,
      confirmationToken: cancelledToken,
    };
  }

  // Map intent to allowlisted action tool
  let actionTool: ActionToolName | undefined;
  if (intent.name === 'create_task') actionTool = 'create_task';
  else if (intent.name === 'update_task') actionTool = 'update_task';
  else if (intent.name === 'assign_task') actionTool = 'assign_task';
  else if (intent.name === 'create_project') actionTool = 'create_project';
  else if (intent.name === 'update_project') actionTool = 'update_project';
  else if (intent.name === 'create_reminder') actionTool = 'create_reminder';
  else if (intent.name === 'update_calendar') actionTool = 'update_calendar';
  else if (intent.name === 'add_note') actionTool = 'add_note';

  if (!actionTool || !isAllowlistedAction(actionTool)) {
    return { isAction: false };
  }

  const def = getActionDefinition(actionTool);
  const parameters: Record<string, any> = {};
  const missingRequiredParams: string[] = [];
  const proposedChanges: ProposedChanges = {};

  let targetResource: TargetResource = { type: 'task' };

  // 1. Extract Task & Entity parameters
  const taskEntity = resolvedEntities.find((e) => e.type === 'task') || (pageCtx?.selectedEntity?.type === 'task' ? pageCtx.selectedEntity : undefined);
  const projectEntity = resolvedEntities.find((e) => e.type === 'project') || (pageCtx?.selectedEntity?.type === 'project' ? pageCtx.selectedEntity : undefined);
  const employeeEntity = resolvedEntities.find((e) => e.type === 'employee' || e.type === 'person');

  // Extract explicit quotes or titles from message
  const quotedMatch = userMessage.match(/["'“](.*?)["'”]/);
  const extractedTitle = quotedMatch ? quotedMatch[1] : undefined;

  if (actionTool === 'create_task') {
    parameters.title = extractedTitle || taskEntity?.name || userMessage.replace(/(create|banao|nayi|task|add|for|ko)/gi, '').trim() || 'New Task';
    if (employeeEntity) parameters.assigned_to = employeeEntity.id;
    if (projectEntity) parameters.project_id = projectEntity.id;
    if (resolvedDates.length > 0) parameters.due_date = resolvedDates[0].resolvedDate;

    if (!parameters.title) missingRequiredParams.push('title');

    proposedChanges.title = { to: parameters.title };
    if (parameters.assigned_to) proposedChanges.assigned_to = { to: employeeEntity?.name || parameters.assigned_to };
    if (parameters.due_date) proposedChanges.due_date = { to: parameters.due_date };
    targetResource = { type: 'task', name: parameters.title };

  } else if (actionTool === 'update_task') {
    const taskId = taskEntity?.id || pageCtx?.selectedEntity?.id || toolCtx.visibleTasks[0]?.id;
    if (taskId) parameters.task_id = taskId;
    else missingRequiredParams.push('task_id');

    if (extractedTitle) parameters.title = extractedTitle;
    if (resolvedDates.length > 0) parameters.due_date = resolvedDates[0].resolvedDate;
    if (employeeEntity) parameters.assigned_to = employeeEntity.id;

    if (userMessage.toLowerCase().includes('high priority')) parameters.priority = 'High';
    if (userMessage.toLowerCase().includes('urgent')) parameters.priority = 'Urgent';

    targetResource = { type: 'task', id: taskId, name: taskEntity?.name || 'Selected Task' };
    if (parameters.due_date) proposedChanges.due_date = { to: parameters.due_date };
    if (parameters.title) proposedChanges.title = { to: parameters.title };

  } else if (actionTool === 'assign_task') {
    const taskId = taskEntity?.id || pageCtx?.selectedEntity?.id || toolCtx.visibleTasks[0]?.id;
    if (taskId) parameters.task_id = taskId;
    else missingRequiredParams.push('task_id');

    if (employeeEntity) parameters.assigned_to = employeeEntity.id;
    else missingRequiredParams.push('assigned_to');

    targetResource = { type: 'task', id: taskId, name: taskEntity?.name || 'Selected Task' };
    proposedChanges.assigned_to = { to: employeeEntity?.name || parameters.assigned_to };

  } else if (actionTool === 'create_project') {
    parameters.project_title = extractedTitle || userMessage.replace(/(create|banao|naya|project|for|with)/gi, '').trim() || 'New Project';
    if (resolvedDates.length > 0) parameters.due_date = resolvedDates[0].resolvedDate;

    if (!parameters.project_title) missingRequiredParams.push('project_title');
    targetResource = { type: 'project', name: parameters.project_title };
    proposedChanges.project_title = { to: parameters.project_title };
    if (parameters.due_date) proposedChanges.due_date = { to: parameters.due_date };

  } else if (actionTool === 'update_project') {
    const projId = projectEntity?.id || pageCtx?.selectedEntity?.id || toolCtx.visibleProjects[0]?.id;
    if (projId) parameters.project_id = projId;
    else missingRequiredParams.push('project_id');

    if (resolvedDates.length > 0) parameters.due_date = resolvedDates[0].resolvedDate;
    if (extractedTitle) parameters.project_title = extractedTitle;

    targetResource = { type: 'project', id: projId, name: projectEntity?.name || 'Selected Project' };
    if (parameters.due_date) proposedChanges.due_date = { to: parameters.due_date };

  } else if (actionTool === 'create_reminder') {
    parameters.title = extractedTitle || userMessage.replace(/(remind|me|kal|tomorrow|reminder|banao|set)/gi, '').trim() || 'Reminder';
    if (resolvedDates.length > 0) parameters.reminder_date = resolvedDates[0].resolvedDate;

    targetResource = { type: 'reminder', name: parameters.title };
    proposedChanges.title = { to: parameters.title };

  } else if (actionTool === 'update_calendar') {
    parameters.title = extractedTitle || 'Meeting / Event';
    if (resolvedDates.length > 0) parameters.event_date = resolvedDates[0].resolvedDate;

    targetResource = { type: 'calendar_event', name: parameters.title };
    proposedChanges.title = { to: parameters.title };
    if (parameters.event_date) proposedChanges.event_date = { to: parameters.event_date };

  } else if (actionTool === 'add_note') {
    const content = extractedTitle || userMessage.replace(/(add|note|pe|is|karo|likho)/gi, '').trim();
    parameters.content = content;

    if (projectEntity) {
      parameters.target_type = 'project';
      parameters.target_id = projectEntity.id;
    } else if (taskEntity) {
      parameters.target_type = 'task';
      parameters.target_id = taskEntity.id;
    } else {
      parameters.target_type = (pageCtx as any)?.pageType === 'projects' ? 'project' : 'task';
      parameters.target_id = pageCtx?.selectedEntity?.id || 'proj-1';
    }

    if (!parameters.content) missingRequiredParams.push('content');
    targetResource = { type: 'note', name: `Note for ${parameters.target_type}` };
    proposedChanges.content = { to: content };
  }

  const actionId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const actionPlan: AIActionPlan = {
    actionId,
    requestId: `req-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actionTool,
    targetResource,
    parameters,
    riskLevel: def.riskLevel,
    requiresConfirmation: def.requiresConfirmation,
    missingRequiredParams,
    proposedChanges,
  };

  // Generate confirmation token if confirmation required
  let confirmationToken: ConfirmationToken | undefined;
  if (actionPlan.requiresConfirmation && missingRequiredParams.length === 0) {
    confirmationToken = confirmationEngine.createConfirmationToken(
      actionPlan,
      toolCtx.currentProfile.id,
      userMessage,
    );
  }

  return {
    isAction: true,
    actionPlan,
    confirmationToken,
  };
}
