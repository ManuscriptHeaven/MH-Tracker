import type { ActionResult, ActionToolName, ConfirmationToken, TargetResource, ProposedChanges } from './aiActionTypes';
import type { AIToolContext } from './aiTypes';
import { checkActionPermission } from './aiPermissionEngine';
import { validateActionParameters } from './aiActionValidator';
import { ConfirmationEngine } from './aiConfirmationEngine';
import { ActionHistoryManager } from './aiActionHistory';
import { formatDate } from '../date';
import { sanitizeUntrustedData } from './aiSecurityBoundary';

const confirmationEngine = ConfirmationEngine.getInstance();
const historyManager = ActionHistoryManager.getInstance();

export async function executeActionTool(
  actionTool: ActionToolName,
  parameters: Record<string, any>,
  ctx: AIToolContext,
  token?: ConfirmationToken,
): Promise<ActionResult> {
  const requestId = `req-${Date.now()}`;
  const actionId = token?.actionPlan.actionId || `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 1. Permission Check Outside LLM
  const perm = checkActionPermission(ctx.currentProfile, actionTool);
  if (!perm.allowed) {
    const errResult: ActionResult = {
      success: false,
      actionId,
      actionTool,
      spokenText: `Permission denied. ${perm.reason}`,
      displayText: `🔒 **Permission Denied**: ${perm.reason}`,
      errorCode: 'PERMISSION_DENIED',
      failureReason: perm.reason,
    };
    historyManager.logAction({
      actionId,
      requestId,
      userId: ctx.currentProfile.id,
      userRole: ctx.currentProfile.role,
      timestamp: new Date().toISOString(),
      actionTool,
      targetResourceType: actionTool.split('_')[1] || 'resource',
      parameters,
      beforeAfter: {},
      authorized: false,
      confirmed: false,
      executed: false,
      resultStatus: 'DENIED',
      failureReason: perm.reason,
    });
    return errResult;
  }

  // 2. Parameter Validation
  const val = validateActionParameters(actionTool, parameters, ctx);
  if (!val.valid) {
    const errorMsg = val.missingRequired.length > 0
      ? `Missing required parameter(s): ${val.missingRequired.join(', ')}.`
      : Object.values(val.invalidParameters).join(' ');

    historyManager.logAction({
      actionId,
      requestId,
      userId: ctx.currentProfile.id,
      userRole: ctx.currentProfile.role,
      timestamp: new Date().toISOString(),
      actionTool,
      targetResourceType: actionTool.split('_')[1] || 'resource',
      parameters,
      beforeAfter: {},
      authorized: true,
      confirmed: false,
      executed: false,
      resultStatus: 'VALIDATION_ERROR',
      failureReason: errorMsg,
    });

    return {
      success: false,
      actionId,
      actionTool,
      spokenText: errorMsg,
      displayText: `⚠️ **Validation Error**: ${errorMsg}`,
      errorCode: 'VALIDATION_ERROR',
      failureReason: errorMsg,
    };
  }

  // 3. Confirmation Token Verification (If Confirmation Token Passed)
  if (token) {
    const tokenVal = confirmationEngine.validateToken(token, parameters, ctx.currentProfile.id);
    if (!tokenVal.valid) {
      return {
        success: false,
        actionId,
        actionTool,
        spokenText: tokenVal.reason || 'Invalid confirmation token.',
        displayText: `⚠️ **Confirmation Error**: ${tokenVal.reason}`,
        errorCode: tokenVal.errorCode,
        failureReason: tokenVal.reason,
      };
    }
  }

  // 4. Execution Router
  switch (actionTool) {
    case 'create_task':
      return executeCreateTask(actionId, requestId, parameters, ctx);
    case 'update_task':
      return executeUpdateTask(actionId, requestId, parameters, ctx);
    case 'assign_task':
      return executeAssignTask(actionId, requestId, parameters, ctx);
    case 'create_project':
      return executeCreateProject(actionId, requestId, parameters, ctx);
    case 'update_project':
      return executeUpdateProject(actionId, requestId, parameters, ctx);
    case 'create_reminder':
      return executeCreateReminder(actionId, requestId, parameters, ctx);
    case 'update_calendar':
      return executeUpdateCalendar(actionId, requestId, parameters, ctx);
    case 'add_note':
      return executeAddNote(actionId, requestId, parameters, ctx);
    default:
      return {
        success: false,
        actionId,
        actionTool,
        spokenText: `Action ${actionTool} is not implemented.`,
        displayText: `⚠️ Action ${actionTool} not supported.`,
        errorCode: 'ACTION_NOT_ALLOWED',
      };
  }
}

// ---------------------------------------------------------------------------
// 1. CREATE TASK EXECUTOR
// ---------------------------------------------------------------------------
function executeCreateTask(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const newTaskId = `task-${Date.now()}`;
  const title = sanitizeUntrustedData(params.title);
  const assignedToId = params.assigned_to || params.assignedTo || params.assignee || null;
  const projectId = params.project_id || params.projectId || (ctx.visibleProjects[0]?.id || 'proj-1');
  const dueDate = params.due_date || params.dueDate || null;
  const priority = params.priority || 'Medium';
  const status = params.status || 'To Do';

  const newTask: any = {
    id: newTaskId,
    project_id: projectId,
    title,
    assigned_to: assignedToId,
    due_date: dueDate,
    priority,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!ctx.data.tasks) ctx.data.tasks = [];
  ctx.data.tasks.push(newTask);

  // POST-ACTION VERIFICATION: Check that task exists in store
  const verified = ctx.data.tasks.find((t) => t.id === newTaskId);
  if (!verified) {
    return {
      success: false,
      actionId,
      actionTool: 'create_task',
      spokenText: "Task creation failed during persistence verification.",
      displayText: "❌ Failed to save task.",
      errorCode: 'EXECUTION_FAILED',
    };
  }

  const assigneeName = assignedToId
    ? ctx.data.profiles.find((p) => p.id === assignedToId)?.full_name || 'Team Member'
    : 'Unassigned';
  const projectTitle = ctx.visibleProjects.find((p) => p.id === projectId)?.project_title || 'Project';

  const spoken = `Task "${title}" created successfully for ${assigneeName}${dueDate ? `, due ${formatDate(dueDate)}` : ''}.`;
  const display = `### ✅ Task Created Successfully\n\n• **Title:** ${title}\n• **Assigned To:** ${assigneeName}\n• **Project:** ${projectTitle}\n• **Priority:** ${priority}\n• **Due Date:** ${dueDate ? formatDate(dueDate) : 'Not set'}`;

  const changes: ProposedChanges = {
    title: { to: title },
    assigned_to: { to: assignedToId },
    due_date: { to: dueDate },
    status: { to: status },
  };

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'create_task',
    targetResourceType: 'task',
    targetResourceId: newTaskId,
    parameters: params,
    beforeAfter: changes,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'create_task',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'task', id: newTaskId, name: title },
    changes,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 2. UPDATE TASK EXECUTOR
// ---------------------------------------------------------------------------
function executeUpdateTask(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const taskId = params.task_id || params.taskId;
  const task = (ctx.data.tasks || []).find((t) => t.id === taskId);

  if (!task) {
    return {
      success: false,
      actionId,
      actionTool: 'update_task',
      spokenText: `Could not find task with ID ${taskId}.`,
      displayText: `⚠️ Task not found.`,
      errorCode: 'RESOURCE_NOT_FOUND',
    };
  }

  const beforeAfter: ProposedChanges = {};

  if (params.title && params.title !== task.title) {
    beforeAfter.title = { from: task.title, to: sanitizeUntrustedData(params.title) };
    task.title = sanitizeUntrustedData(params.title);
  }

  if (params.due_date && params.due_date !== task.due_date) {
    beforeAfter.due_date = { from: task.due_date, to: params.due_date };
    task.due_date = params.due_date;
  }

  if (params.status && params.status !== task.status) {
    beforeAfter.status = { from: task.status, to: params.status };
    task.status = params.status;
  }

  if (params.priority && params.priority !== task.priority) {
    beforeAfter.priority = { from: task.priority, to: params.priority };
    task.priority = params.priority;
  }

  task.updated_at = new Date().toISOString();

  const spoken = `Updated task "${task.title}". ${Object.keys(beforeAfter).map((k) => `${k} updated to ${beforeAfter[k].to}`).join(', ')}.`;
  let display = `### ✅ Task Updated\n\n**Task:** "${task.title}"\n`;
  Object.entries(beforeAfter).forEach(([field, val]) => {
    display += `• **${field}:** ${val.from || 'None'} ➔ **${val.to}**\n`;
  });

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'update_task',
    targetResourceType: 'task',
    targetResourceId: task.id,
    parameters: params,
    beforeAfter,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'update_task',
    spokenText: spoken,
    displayText: display.trim(),
    resource: { type: 'task', id: task.id, name: task.title },
    changes: beforeAfter,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 3. ASSIGN TASK EXECUTOR
// ---------------------------------------------------------------------------
function executeAssignTask(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const taskId = params.task_id || params.taskId;
  const assigneeInput = params.assigned_to || params.assignedTo || params.assignee;
  const task = (ctx.data.tasks || []).find((t) => t.id === taskId);

  if (!task) {
    return {
      success: false,
      actionId,
      actionTool: 'assign_task',
      spokenText: `Could not find task to assign.`,
      displayText: `⚠️ Task not found.`,
      errorCode: 'RESOURCE_NOT_FOUND',
    };
  }

  const targetEmp = ctx.data.profiles.find(
    (p) =>
      p.id === assigneeInput ||
      p.full_name.toLowerCase().includes(String(assigneeInput).toLowerCase()) ||
      p.email.toLowerCase().includes(String(assigneeInput).toLowerCase()),
  );

  if (!targetEmp) {
    return {
      success: false,
      actionId,
      actionTool: 'assign_task',
      spokenText: `Could not find active team member matching "${assigneeInput}".`,
      displayText: `⚠️ Assignee not found.`,
      errorCode: 'RESOURCE_NOT_FOUND',
    };
  }

  const beforeAfter: ProposedChanges = {
    assigned_to: { from: task.assigned_to, to: targetEmp.id },
  };

  task.assigned_to = targetEmp.id;
  task.updated_at = new Date().toISOString();

  const spoken = `Task "${task.title}" is now assigned to ${targetEmp.full_name}.`;
  const display = `### ✅ Task Reassigned\n\n• **Task:** "${task.title}"\n• **New Assignee:** ${targetEmp.full_name}`;

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'assign_task',
    targetResourceType: 'task',
    targetResourceId: task.id,
    parameters: params,
    beforeAfter,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'assign_task',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'task', id: task.id, name: task.title },
    changes: beforeAfter,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 4. CREATE PROJECT EXECUTOR
// ---------------------------------------------------------------------------
function executeCreateProject(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const newProjId = `proj-${Date.now()}`;
  const title = sanitizeUntrustedData(params.project_title || params.projectTitle || params.title);
  const clientName = sanitizeUntrustedData(params.client_name || params.clientName || 'Standard Client');
  const dueDate = params.due_date || params.dueDate || null;
  const status = params.status || 'Design Concept in Progress';

  const newProject: any = {
    id: newProjId,
    project_number: `MH-${1050 + ctx.visibleProjects.length}`,
    project_title: title,
    client_name: clientName,
    client_email: `${clientName.toLowerCase().replace(/\s+/g, '')}@example.com`,
    due_date: dueDate,
    status,
    progress_percentage: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  ctx.visibleProjects.push(newProject);

  const spoken = `Project "${title}" created successfully for ${clientName}${dueDate ? `, due ${formatDate(dueDate)}` : ''}.`;
  const display = `### ✅ Project Created\n\n• **Title:** ${title}\n• **Project ID:** ${newProject.project_number}\n• **Client:** ${clientName}\n• **Status:** ${status}\n• **Due Date:** ${dueDate ? formatDate(dueDate) : 'Not set'}`;

  const changes: ProposedChanges = {
    project_title: { to: title },
    client_name: { to: clientName },
    due_date: { to: dueDate },
  };

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'create_project',
    targetResourceType: 'project',
    targetResourceId: newProjId,
    parameters: params,
    beforeAfter: changes,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'create_project',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'project', id: newProjId, name: title },
    changes,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 5. UPDATE PROJECT EXECUTOR
// ---------------------------------------------------------------------------
function executeUpdateProject(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const projId = params.project_id || params.projectId;
  const project = ctx.visibleProjects.find((p) => p.id === projId);

  if (!project) {
    return {
      success: false,
      actionId,
      actionTool: 'update_project',
      spokenText: `Could not find project to update.`,
      displayText: `⚠️ Project not found.`,
      errorCode: 'RESOURCE_NOT_FOUND',
    };
  }

  const beforeAfter: ProposedChanges = {};

  if (params.project_title && params.project_title !== project.project_title) {
    beforeAfter.project_title = { from: project.project_title, to: sanitizeUntrustedData(params.project_title) };
    project.project_title = sanitizeUntrustedData(params.project_title);
  }

  if (params.due_date && params.due_date !== project.due_date) {
    beforeAfter.due_date = { from: project.due_date, to: params.due_date };
    project.due_date = params.due_date;
  }

  if (params.status && params.status !== project.status) {
    beforeAfter.status = { from: project.status, to: params.status };
    project.status = params.status;
  }

  project.updated_at = new Date().toISOString();

  const spoken = `Project "${project.project_title}" updated successfully.`;
  let display = `### ✅ Project Updated\n\n**Project:** "${project.project_title}"\n`;
  Object.entries(beforeAfter).forEach(([field, val]) => {
    display += `• **${field}:** ${val.from || 'None'} ➔ **${val.to}**\n`;
  });

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'update_project',
    targetResourceType: 'project',
    targetResourceId: project.id,
    parameters: params,
    beforeAfter,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'update_project',
    spokenText: spoken,
    displayText: display.trim(),
    resource: { type: 'project', id: project.id, name: project.project_title },
    changes: beforeAfter,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 6. CREATE REMINDER EXECUTOR
// ---------------------------------------------------------------------------
function executeCreateReminder(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const remId = `rem-${Date.now()}`;
  const title = sanitizeUntrustedData(params.title);
  const remDate = params.reminder_date || params.date || new Date().toISOString().slice(0, 10);
  const remTime = params.reminder_time || params.time || '10:00 AM';

  const spoken = `Reminder created for ${formatDate(remDate)} at ${remTime}: "${title}".`;
  const display = `### ⏰ Reminder Created\n\n• **Reminder:** ${title}\n• **Date:** ${formatDate(remDate)}\n• **Time:** ${remTime}`;

  const changes: ProposedChanges = {
    title: { to: title },
    reminder_date: { to: remDate },
    reminder_time: { to: remTime },
  };

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'create_reminder',
    targetResourceType: 'reminder',
    targetResourceId: remId,
    parameters: params,
    beforeAfter: changes,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'create_reminder',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'reminder', id: remId, name: title },
    changes,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 7. UPDATE CALENDAR EXECUTOR
// ---------------------------------------------------------------------------
function executeUpdateCalendar(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const eventId = params.event_id || `cal-${Date.now()}`;
  const title = sanitizeUntrustedData(params.title || 'Meeting');
  const eventDate = params.event_date || params.date || new Date().toISOString().slice(0, 10);
  const startTime = params.start_time || '03:00 PM';
  const endTime = params.end_time || '04:00 PM';

  const spoken = `Calendar updated: "${title}" scheduled for ${formatDate(eventDate)} from ${startTime} to ${endTime}.`;
  const display = `### 📅 Calendar Schedule Updated\n\n• **Event:** ${title}\n• **Date:** ${formatDate(eventDate)}\n• **Time:** ${startTime} – ${endTime}`;

  const changes: ProposedChanges = {
    title: { to: title },
    event_date: { to: eventDate },
    start_time: { to: startTime },
    end_time: { to: endTime },
  };

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'update_calendar',
    targetResourceType: 'calendar_event',
    targetResourceId: eventId,
    parameters: params,
    beforeAfter: changes,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'update_calendar',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'calendar_event', id: eventId, name: title },
    changes,
    undoAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// 8. ADD NOTE EXECUTOR
// ---------------------------------------------------------------------------
function executeAddNote(
  actionId: string,
  requestId: string,
  params: Record<string, any>,
  ctx: AIToolContext,
): ActionResult {
  const noteId = `note-${Date.now()}`;
  const targetType = params.target_type || params.targetType || 'project';
  const targetId = params.target_id || params.targetId || (ctx.visibleProjects[0]?.id || 'proj-1');
  const content = sanitizeUntrustedData(params.content || params.note_content || '');

  const spoken = `Note added to ${targetType}: "${content.slice(0, 60)}...".`;
  const display = `### 📝 Note Added\n\n• **Target:** ${targetType.toUpperCase()} #${targetId.slice(0, 6)}\n• **Content:** "${content}"`;

  const changes: ProposedChanges = {
    content: { to: content },
    target_type: { to: targetType },
    target_id: { to: targetId },
  };

  historyManager.logAction({
    actionId,
    requestId,
    userId: ctx.currentProfile.id,
    userRole: ctx.currentProfile.role,
    timestamp: new Date().toISOString(),
    actionTool: 'add_note',
    targetResourceType: 'note',
    targetResourceId: noteId,
    parameters: params,
    beforeAfter: changes,
    authorized: true,
    confirmed: true,
    executed: true,
    resultStatus: 'SUCCESS',
  });

  return {
    success: true,
    actionId,
    actionTool: 'add_note',
    spokenText: spoken,
    displayText: display,
    resource: { type: 'note', id: noteId },
    changes,
    undoAvailable: true,
  };
}
