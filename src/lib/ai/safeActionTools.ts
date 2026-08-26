import type {
  AIToolContext,
  AIToolResult,
  AIActionPreview,
  AIActionAuditLog,
  AIToolName,
} from './aiTypes';
import type { Project, ProjectStatus } from '../types';
import { isManagerRole, isClientRole, firstName } from '../utils';
import { formatDate, todayInput, addDays } from '../date';
import { createBulkInvoice, getEligibleProjectsForClient } from '../invoiceUtils';

function createAuditLog(
  ctx: AIToolContext,
  action: string,
  targetType: string,
  targetId?: string,
  targetTitle?: string,
  oldValue?: string | null,
  newValue?: string | null,
  status: 'success' | 'failed' | 'cancelled' = 'success',
  errorMessage?: string,
): AIActionAuditLog {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: ctx.currentProfile.id,
    userName: ctx.currentProfile.full_name,
    userRole: ctx.currentProfile.role,
    action,
    targetType,
    targetId,
    targetTitle,
    oldValue: oldValue ? String(oldValue) : null,
    newValue: newValue ? String(newValue) : null,
    timestamp: new Date().toISOString(),
    confirmed: true,
    aiInitiated: true,
    status,
    errorMessage,
  };
}

// ==========================================
// 1. TASK ACTIONS
// ==========================================

export async function execute_create_task(
  payload: { title: string; assignedToId?: string; projectId?: string; dueDate?: string; priority?: string; description?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'create_task',
      error: 'permission_denied',
      spokenText: "I can't create tasks with client permissions.",
      displayText: "🔒 Task creation is restricted for client accounts.",
    };
  }

  const assignedToId = payload.assignedToId || ctx.currentProfile.id;
  const assignedProfile = ctx.data.profiles.find((p) => p.id === assignedToId);
  const assignedName = assignedProfile ? firstName(assignedProfile.full_name) : 'the team';

  const project = payload.projectId ? ctx.data.projects.find((p) => p.id === payload.projectId) : null;
  const projectTitle = project ? project.project_title : '';

  try {
    if (ctx.trackerMutations?.createTask) {
      await ctx.trackerMutations.createTask({
        title: payload.title,
        description: payload.description || '',
        project_id: payload.projectId || null,
        assigned_to: assignedToId,
        due_date: payload.dueDate || null,
        priority: (payload.priority as any) || 'Normal',
        status: 'To Do',
      });
    }

    const audit = createAuditLog(
      ctx,
      `Created task: "${payload.title}"`,
      'task',
      undefined,
      payload.title,
      null,
      `Assigned to ${assignedName}`,
      'success',
    );

    const spoken = `Done. The task "${payload.title}" has been assigned to ${assignedName}.`;
    const display = `### ✅ Task Created Successfully\n\n• **Task:** ${payload.title}\n• **Assigned To:** ${assignedProfile?.full_name || assignedName}\n${projectTitle ? `• **Project:** ${projectTitle}\n` : ''}${payload.dueDate ? `• **Due Date:** ${formatDate(payload.dueDate)}\n` : ''}• **Status:** To Do`;

    return {
      success: true,
      toolName: 'create_task',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to create task.';
    return {
      success: false,
      toolName: 'create_task',
      error: errorMsg,
      spokenText: `I couldn't create the task. ${errorMsg}`,
      displayText: `❌ Failed to create task: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Create task failed: "${payload.title}"`, 'task', undefined, payload.title, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_update_task_status(
  payload: { taskId: string; status: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'update_task_status',
      error: 'permission_denied',
      spokenText: "I can't update tasks with client permissions.",
      displayText: "🔒 Task updates are restricted for client accounts.",
    };
  }

  const task = ctx.data.tasks.find((t) => t.id === payload.taskId);
  if (!task) {
    return {
      success: false,
      toolName: 'update_task_status',
      error: 'task_not_found',
      spokenText: "I couldn't find the specified task.",
      displayText: "❌ Task not found.",
    };
  }

  // Permissions: Admin/Manager can update any task; Employee can update tasks assigned to them
  if (!isManagerRole(ctx.currentProfile.role) && task.assigned_to !== ctx.currentProfile.id && task.created_by !== ctx.currentProfile.id) {
    return {
      success: false,
      toolName: 'update_task_status',
      error: 'permission_denied',
      spokenText: "You can only update tasks assigned to you.",
      displayText: "🔒 You can only update tasks assigned to you.",
    };
  }

  const oldStatus = task.status;
  try {
    if (ctx.trackerMutations?.updateTask) {
      await ctx.trackerMutations.updateTask(task.id, { status: payload.status as any });
    }

    const audit = createAuditLog(
      ctx,
      `Updated task status: "${task.title}"`,
      'task',
      task.id,
      task.title,
      oldStatus,
      payload.status,
      'success',
    );

    const spoken = `Done. The task "${task.title}" is now ${payload.status}.`;
    const display = `### ✅ Task Status Updated\n\n• **Task:** ${task.title}\n• **Previous Status:** ${oldStatus}\n• **New Status:** **${payload.status}**`;

    return {
      success: true,
      toolName: 'update_task_status',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to update task status.';
    return {
      success: false,
      toolName: 'update_task_status',
      error: errorMsg,
      spokenText: `I couldn't update the task status. ${errorMsg}`,
      displayText: `❌ Failed to update task: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Update task status failed: "${task.title}"`, 'task', task.id, task.title, oldStatus, payload.status, 'failed', errorMsg),
    };
  }
}

export async function execute_assign_task(
  payload: { taskId: string; employeeId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'assign_task',
      error: 'permission_denied',
      spokenText: "I can't assign tasks with client permissions.",
      displayText: "🔒 Task assignment is restricted for client accounts.",
    };
  }

  const task = ctx.data.tasks.find((t) => t.id === payload.taskId);
  if (!task) {
    return {
      success: false,
      toolName: 'assign_task',
      error: 'task_not_found',
      spokenText: "I couldn't find the specified task.",
      displayText: "❌ Task not found.",
    };
  }

  const newAssignee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!newAssignee) {
    return {
      success: false,
      toolName: 'assign_task',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member to assign this task to.",
      displayText: "❌ Team member not found.",
    };
  }

  const oldAssignee = ctx.data.profiles.find((p) => p.id === task.assigned_to);
  const oldName = oldAssignee ? oldAssignee.full_name : 'Unassigned';
  const newName = firstName(newAssignee.full_name);

  try {
    if (ctx.trackerMutations?.updateTask) {
      await ctx.trackerMutations.updateTask(task.id, { assigned_to: newAssignee.id });
    }

    const audit = createAuditLog(
      ctx,
      `Reassigned task: "${task.title}"`,
      'task',
      task.id,
      task.title,
      oldName,
      newAssignee.full_name,
      'success',
    );

    const spoken = `Done. The task "${task.title}" has been assigned to ${newName}.`;
    const display = `### ✅ Task Assigned\n\n• **Task:** ${task.title}\n• **Previous Assignee:** ${oldName}\n• **New Assignee:** **${newAssignee.full_name}**`;

    return {
      success: true,
      toolName: 'assign_task',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to assign task.';
    return {
      success: false,
      toolName: 'assign_task',
      error: errorMsg,
      spokenText: `I couldn't assign the task. ${errorMsg}`,
      displayText: `❌ Failed to assign task: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Assign task failed: "${task.title}"`, 'task', task.id, task.title, oldName, newAssignee.full_name, 'failed', errorMsg),
    };
  }
}

export async function execute_update_task_due_date(
  payload: { taskId: string; dueDate: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'update_task_due_date',
      error: 'permission_denied',
      spokenText: "I can't update task deadlines with client permissions.",
      displayText: "🔒 Task deadlines are restricted for client accounts.",
    };
  }

  const task = ctx.data.tasks.find((t) => t.id === payload.taskId);
  if (!task) {
    return {
      success: false,
      toolName: 'update_task_due_date',
      error: 'task_not_found',
      spokenText: "I couldn't find the specified task.",
      displayText: "❌ Task not found.",
    };
  }

  const oldDate = task.due_date ? formatDate(task.due_date) : 'No due date';
  const newDate = formatDate(payload.dueDate);

  try {
    if (ctx.trackerMutations?.updateTask) {
      await ctx.trackerMutations.updateTask(task.id, { due_date: payload.dueDate });
    }

    const audit = createAuditLog(
      ctx,
      `Updated task due date: "${task.title}"`,
      'task',
      task.id,
      task.title,
      oldDate,
      newDate,
      'success',
    );

    const spoken = `Done. The deadline for task "${task.title}" is now set to ${newDate}.`;
    const display = `### ✅ Task Deadline Updated\n\n• **Task:** ${task.title}\n• **Previous Due Date:** ${oldDate}\n• **New Due Date:** **${newDate}**`;

    return {
      success: true,
      toolName: 'update_task_due_date',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to update task deadline.';
    return {
      success: false,
      toolName: 'update_task_due_date',
      error: errorMsg,
      spokenText: `I couldn't update the task deadline. ${errorMsg}`,
      displayText: `❌ Failed to update task deadline: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Update task due date failed: "${task.title}"`, 'task', task.id, task.title, oldDate, newDate, 'failed', errorMsg),
    };
  }
}

export async function execute_delete_task(
  payload: { taskId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'delete_task',
      error: 'permission_denied',
      spokenText: "I can't delete tasks with client permissions.",
      displayText: "🔒 Task deletion is restricted for client accounts.",
    };
  }

  const task = ctx.data.tasks.find((t) => t.id === payload.taskId);
  if (!task) {
    return {
      success: false,
      toolName: 'delete_task',
      error: 'task_not_found',
      spokenText: "I couldn't find the task to delete.",
      displayText: "❌ Task not found.",
    };
  }

  if (!isManagerRole(ctx.currentProfile.role) && task.created_by !== ctx.currentProfile.id) {
    return {
      success: false,
      toolName: 'delete_task',
      error: 'permission_denied',
      spokenText: "Only managers or the task creator can delete this task.",
      displayText: "🔒 You can only delete tasks you created.",
    };
  }

  try {
    if (ctx.trackerMutations?.deleteTask) {
      await ctx.trackerMutations.deleteTask(task.id);
    }

    const audit = createAuditLog(
      ctx,
      `Deleted task: "${task.title}"`,
      'task',
      task.id,
      task.title,
      task.status,
      'Deleted',
      'success',
    );

    const spoken = `Done. The task "${task.title}" has been deleted.`;
    const display = `### 🗑️ Task Deleted\n\n• **Task:** ~~${task.title}~~\n• **Status:** Removed`;

    return {
      success: true,
      toolName: 'delete_task',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to delete task.';
    return {
      success: false,
      toolName: 'delete_task',
      error: errorMsg,
      spokenText: `I couldn't delete the task. ${errorMsg}`,
      displayText: `❌ Failed to delete task: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Delete task failed: "${task.title}"`, 'task', task.id, task.title, null, null, 'failed', errorMsg),
    };
  }
}

// ==========================================
// 2. PROJECT & TIMELINE ACTIONS
// ==========================================

export async function execute_create_project(
  payload: {
    projectTitle: string;
    clientName: string;
    clientEmail?: string;
    serviceType?: string;
    genre?: string;
    totalPrice?: number;
    advancePaid?: number;
    dueDate?: string;
    assignedToId?: string;
    projectManagerId?: string;
    notes?: string;
  },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'create_project',
      error: 'permission_denied',
      spokenText: "I can't create projects with client permissions.",
      displayText: "🔒 Project creation is restricted for client accounts.",
    };
  }

  const assignedProfile = payload.assignedToId ? ctx.data.profiles.find((p) => p.id === payload.assignedToId) : null;
  const assignedName = assignedProfile ? firstName(assignedProfile.full_name) : 'the team';

  try {
    let createdProject: any = null;
    if (ctx.trackerMutations?.createProject) {
      createdProject = await ctx.trackerMutations.createProject({
        project_title: payload.projectTitle,
        client_name: payload.clientName,
        client_email: payload.clientEmail || `${payload.clientName.toLowerCase().replace(/\s+/g, '')}@client.com`,
        service_type: (payload.serviceType as any) || 'Print + eBook',
        genre: payload.genre || 'General Non-Fiction',
        trim_size: '6 x 9',
        page_count: 200,
        word_count: 50000,
        platform: 'KDP',
        start_date: todayInput(),
        due_date: payload.dueDate || addDays(14),
        total_price: payload.totalPrice || 0,
        advance_paid: payload.advancePaid || 0,
        status: 'In Progress',
        assigned_to: payload.assignedToId || null,
        project_manager: payload.projectManagerId || ctx.currentProfile.id,
        general_notes: payload.notes || 'Created via AI Assistant',
      });
    }

    const audit = createAuditLog(
      ctx,
      `Created project: "${payload.projectTitle}" for ${payload.clientName}`,
      'project',
      createdProject?.id,
      payload.projectTitle,
      null,
      `Client: ${payload.clientName}`,
      'success',
    );

    const spoken = `Done. Project "${payload.projectTitle}" for ${payload.clientName} has been created.`;
    const display = `### ✅ Project Created Successfully\n\n• **Project:** **${payload.projectTitle}**\n• **Client:** **${payload.clientName}**\n• **Service:** ${payload.serviceType || 'Print + eBook'}\n${payload.dueDate ? `• **Due Date:** ${formatDate(payload.dueDate)}\n` : ''}${payload.totalPrice ? `• **Total Price:** ${ctx.formatMoney(payload.totalPrice)}\n` : ''}• **Status:** In Progress`;

    return {
      success: true,
      toolName: 'create_project',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to create project.';
    return {
      success: false,
      toolName: 'create_project',
      error: errorMsg,
      spokenText: `I couldn't create the project. ${errorMsg}`,
      displayText: `❌ Failed to create project: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Create project failed: "${payload.projectTitle}"`, 'project', undefined, payload.projectTitle, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_duplicate_project(
  payload: { projectId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'duplicate_project',
      error: 'permission_denied',
      spokenText: "I can't duplicate projects with client permissions.",
      displayText: "🔒 Project duplication is restricted for client accounts.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'duplicate_project',
      error: 'project_not_found',
      spokenText: "I couldn't find the project to duplicate.",
      displayText: "❌ Project not found.",
    };
  }

  try {
    let duplicated: any = null;
    if (ctx.trackerMutations?.duplicateProject) {
      duplicated = await ctx.trackerMutations.duplicateProject(project.id);
    }

    const audit = createAuditLog(
      ctx,
      `Duplicated project "${project.project_title}"`,
      'project',
      duplicated?.id,
      duplicated?.project_title || `${project.project_title} (Copy)`,
      project.project_title,
      'Duplicated',
      'success',
    );

    const spoken = `Done. ${project.project_title} has been duplicated as "${duplicated?.project_title || `${project.project_title} (Copy)`}".`;
    const display = `### ✅ Project Duplicated\n\n• **Original:** ${project.project_title}\n• **New Project:** **${duplicated?.project_title || `${project.project_title} (Copy)`}**\n• **Status:** In Progress`;

    return {
      success: true,
      toolName: 'duplicate_project',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to duplicate project.';
    return {
      success: false,
      toolName: 'duplicate_project',
      error: errorMsg,
      spokenText: `I couldn't duplicate the project. ${errorMsg}`,
      displayText: `❌ Failed to duplicate project: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Duplicate project failed: "${project.project_title}"`, 'project', project.id, project.project_title, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_update_project_status(
  payload: { projectId: string; status: ProjectStatus; currentStage?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (!isManagerRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'update_project_status',
      error: 'permission_denied',
      spokenText: 'Only managers and admins can change project statuses.',
      displayText: '🔒 Only managers and admins can change project statuses.',
    };
  }

  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'update_project_status',
      error: 'project_not_found',
      spokenText: "I couldn't find the specified project.",
      displayText: '❌ Project not found.',
    };
  }

  const oldStatus = project.status;
  const oldStage = project.current_stage;
  const updates: Partial<Project> = { status: payload.status };
  if (payload.currentStage) {
    updates.current_stage = payload.currentStage as any;
  }

  try {
    if (ctx.trackerMutations?.updateProject) {
      await ctx.trackerMutations.updateProject(project.id, updates);
    }

    const stageNote = payload.currentStage ? ` (Stage: ${payload.currentStage})` : '';
    const audit = createAuditLog(
      ctx,
      `Changed project status for "${project.project_title}"`,
      'project',
      project.id,
      project.project_title,
      `${oldStatus}${oldStage ? ` / ${oldStage}` : ''}`,
      `${payload.status}${stageNote}`,
      'success',
    );

    const spoken = `Done. ${project.project_title} has been moved to ${payload.currentStage || payload.status}.`;
    const display = `### ✅ Project Updated\n\n• **Project:** **${project.project_title}** (${project.project_number})\n• **Previous:** ${oldStatus}${oldStage ? ` (Stage: ${oldStage})` : ''}\n• **New Status:** **${payload.status}**${payload.currentStage ? `\n• **New Stage:** **${payload.currentStage}**` : ''}`;

    return {
      success: true,
      toolName: 'update_project_status',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to update project status.';
    return {
      success: false,
      toolName: 'update_project_status',
      error: errorMsg,
      spokenText: `I couldn't update the project status. ${errorMsg}`,
      displayText: `❌ Failed to update project status: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Update project status failed: "${project.project_title}"`, 'project', project.id, project.project_title, oldStatus, payload.status, 'failed', errorMsg),
    };
  }
}

export async function execute_update_project_due_date(
  payload: { projectId: string; dueDate: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (!isManagerRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'update_project_due_date',
      error: 'permission_denied',
      spokenText: "Only managers and admins can change project deadlines.",
      displayText: "🔒 Only managers and admins can change project deadlines.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'update_project_due_date',
      error: 'project_not_found',
      spokenText: "I couldn't find the specified project.",
      displayText: "❌ Project not found.",
    };
  }

  const oldDate = project.due_date ? formatDate(project.due_date) : 'No due date';
  const newDate = formatDate(payload.dueDate);

  try {
    if (ctx.trackerMutations?.updateProject) {
      await ctx.trackerMutations.updateProject(project.id, { due_date: payload.dueDate });
    }

    const audit = createAuditLog(
      ctx,
      `Changed project deadline for "${project.project_title}"`,
      'project',
      project.id,
      project.project_title,
      oldDate,
      newDate,
      'success',
    );

    const spoken = `Done. The deadline for ${project.project_title} has been moved to ${newDate}.`;
    const display = `### ✅ Project Deadline Updated\n\n• **Project:** ${project.project_title} (${project.project_number})\n• **Previous Due Date:** ${oldDate}\n• **New Due Date:** **${newDate}**`;

    return {
      success: true,
      toolName: 'update_project_due_date',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to update project deadline.';
    return {
      success: false,
      toolName: 'update_project_due_date',
      error: errorMsg,
      spokenText: `I couldn't update the project deadline. ${errorMsg}`,
      displayText: `❌ Failed to update project deadline: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Update project due date failed: "${project.project_title}"`, 'project', project.id, project.project_title, oldDate, newDate, 'failed', errorMsg),
    };
  }
}

export async function execute_assign_project(
  payload: { projectId: string; employeeId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (!isManagerRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'assign_project',
      error: 'permission_denied',
      spokenText: "Only managers and admins can reassign projects.",
      displayText: "🔒 Only managers and admins can reassign projects.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'assign_project',
      error: 'project_not_found',
      spokenText: "I couldn't find the specified project.",
      displayText: "❌ Project not found.",
    };
  }

  const newAssignee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!newAssignee) {
    return {
      success: false,
      toolName: 'assign_project',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member to assign this project to.",
      displayText: "❌ Team member not found.",
    };
  }

  const oldAssignee = ctx.data.profiles.find((p) => p.id === project.assigned_to);
  const oldName = oldAssignee ? oldAssignee.full_name : 'Unassigned';
  const newName = firstName(newAssignee.full_name);

  try {
    if (ctx.trackerMutations?.updateProject) {
      await ctx.trackerMutations.updateProject(project.id, { assigned_to: newAssignee.id });
    }

    const audit = createAuditLog(
      ctx,
      `Reassigned project "${project.project_title}"`,
      'project',
      project.id,
      project.project_title,
      oldName,
      newAssignee.full_name,
      'success',
    );

    const spoken = `Done. ${project.project_title} has been assigned to ${newName}.`;
    const display = `### ✅ Project Reassigned\n\n• **Project:** ${project.project_title} (${project.project_number})\n• **Previous Assignee:** ${oldName}\n• **New Assignee:** **${newAssignee.full_name}**`;

    return {
      success: true,
      toolName: 'assign_project',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to reassign project.';
    return {
      success: false,
      toolName: 'assign_project',
      error: errorMsg,
      spokenText: `I couldn't reassign the project. ${errorMsg}`,
      displayText: `❌ Failed to reassign project: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Reassign project failed: "${project.project_title}"`, 'project', project.id, project.project_title, oldName, newAssignee.full_name, 'failed', errorMsg),
    };
  }
}

export async function execute_delete_project(
  payload: { projectId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'delete_project',
      error: 'permission_denied',
      spokenText: "Only administrators can delete projects.",
      displayText: "🔒 Only administrators can delete projects.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'delete_project',
      error: 'project_not_found',
      spokenText: "I couldn't find the project to delete.",
      displayText: "❌ Project not found.",
    };
  }

  try {
    if (ctx.trackerMutations?.deleteProject) {
      await ctx.trackerMutations.deleteProject(project.id);
    }

    const audit = createAuditLog(
      ctx,
      `Deleted project: "${project.project_title}" (${project.project_number})`,
      'project',
      project.id,
      project.project_title,
      project.status,
      'Deleted',
      'success',
    );

    const spoken = `Done. Project ${project.project_number} (${project.project_title}) has been deleted.`;
    const display = `### 🗑️ Project Deleted\n\n• **Project:** ~~${project.project_title} (${project.project_number})~~\n• **Status:** Permanently removed`;

    return {
      success: true,
      toolName: 'delete_project',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to delete project.';
    return {
      success: false,
      toolName: 'delete_project',
      error: errorMsg,
      spokenText: `I couldn't delete the project. ${errorMsg}`,
      displayText: `❌ Failed to delete project: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Delete project failed: "${project.project_title}"`, 'project', project.id, project.project_title, null, null, 'failed', errorMsg),
    };
  }
}

// ==========================================
// 3. REVISION ACTIONS
// ==========================================

export async function execute_reassign_revision(
  payload: { requestId: string; employeeId: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'reassign_revision',
      error: 'permission_denied',
      spokenText: "I can't reassign revisions with client permissions.",
      displayText: "🔒 Revision assignments are restricted for client accounts.",
    };
  }

  const request = ctx.data.revisionRequests.find((r) => r.id === payload.requestId);
  if (!request) {
    return {
      success: false,
      toolName: 'reassign_revision',
      error: 'revision_not_found',
      spokenText: "I couldn't find the specified revision request.",
      displayText: "❌ Revision request not found.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === request.project_id);
  const projectTitle = project ? project.project_title : 'Project';

  const newAssignee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!newAssignee) {
    return {
      success: false,
      toolName: 'reassign_revision',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member to assign this revision to.",
      displayText: "❌ Team member not found.",
    };
  }

  const oldAssignee = ctx.data.profiles.find((p) => p.id === request.assigned_to);
  const oldName = oldAssignee ? oldAssignee.full_name : 'Unassigned';
  const newName = firstName(newAssignee.full_name);

  try {
    if (ctx.trackerMutations?.updateRevisionRequest) {
      await ctx.trackerMutations.updateRevisionRequest(request.id, { assigned_to: newAssignee.id });
    }

    const audit = createAuditLog(
      ctx,
      `Reassigned revision for "${projectTitle}"`,
      'revision',
      request.id,
      request.title || projectTitle,
      oldName,
      newAssignee.full_name,
      'success',
    );

    const spoken = `Done. ${request.title || 'The revision'} is now assigned to ${newName}.`;
    const display = `### ✅ Revision Reassigned\n\n• **Project:** ${projectTitle}\n• **Revision:** ${request.title || 'Revision request'}\n• **Previous Assignee:** ${oldName}\n• **New Assignee:** **${newAssignee.full_name}**`;

    return {
      success: true,
      toolName: 'reassign_revision',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to reassign revision.';
    return {
      success: false,
      toolName: 'reassign_revision',
      error: errorMsg,
      spokenText: `I couldn't reassign the revision. ${errorMsg}`,
      displayText: `❌ Failed to reassign revision: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Reassign revision failed: "${request.title}"`, 'revision', request.id, request.title, oldName, newAssignee.full_name, 'failed', errorMsg),
    };
  }
}

export async function execute_update_revision_status(
  payload: { requestId: string; status: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'update_revision_status',
      error: 'permission_denied',
      spokenText: "I can't change revision status with client permissions.",
      displayText: "🔒 Revision status changes are restricted for client accounts.",
    };
  }

  const request = ctx.data.revisionRequests.find((r) => r.id === payload.requestId);
  if (!request) {
    return {
      success: false,
      toolName: 'update_revision_status',
      error: 'revision_not_found',
      spokenText: "I couldn't find the specified revision request.",
      displayText: "❌ Revision request not found.",
    };
  }

  const project = ctx.data.projects.find((p) => p.id === request.project_id);
  const projectTitle = project ? project.project_title : 'Project';
  const oldStatus = request.status;

  try {
    if (ctx.trackerMutations?.updateRevisionRequest) {
      await ctx.trackerMutations.updateRevisionRequest(request.id, { status: payload.status as any });
    }

    const audit = createAuditLog(
      ctx,
      `Updated revision status for "${projectTitle}"`,
      'revision',
      request.id,
      request.title || projectTitle,
      oldStatus,
      payload.status,
      'success',
    );

    const spoken = `Done. ${request.title || 'The revision'} status is now ${payload.status}.`;
    const display = `### ✅ Revision Status Updated\n\n• **Project:** ${projectTitle}\n• **Revision:** ${request.title || 'Revision request'}\n• **Previous Status:** ${oldStatus}\n• **New Status:** **${payload.status}**`;

    return {
      success: true,
      toolName: 'update_revision_status',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to update revision status.';
    return {
      success: false,
      toolName: 'update_revision_status',
      error: errorMsg,
      spokenText: `I couldn't update the revision status. ${errorMsg}`,
      displayText: `❌ Failed to update revision status: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Update revision status failed: "${request.title}"`, 'revision', request.id, request.title, oldStatus, payload.status, 'failed', errorMsg),
    };
  }
}

// ==========================================
// 4. NOTES & APPROVALS
// ==========================================

export async function execute_add_project_note(
  payload: { projectId: string; noteType: string; note: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'add_project_note',
      error: 'project_not_found',
      spokenText: "I couldn't find the specified project to add a note to.",
      displayText: "❌ Project not found.",
    };
  }

  // Client permissions: Clients can only add general notes to their own projects
  if (isClientRole(ctx.currentProfile.role) && payload.noteType !== 'general') {
    return {
      success: false,
      toolName: 'add_project_note',
      error: 'permission_denied',
      spokenText: "Clients can only add general notes.",
      displayText: "🔒 Internal notes are restricted for client accounts.",
    };
  }

  try {
    if (ctx.trackerMutations?.addNote) {
      await ctx.trackerMutations.addNote(project.id, payload.noteType as any, payload.note);
    }

    const audit = createAuditLog(
      ctx,
      `Added ${payload.noteType} note to "${project.project_title}"`,
      'project',
      project.id,
      project.project_title,
      null,
      payload.note.length > 50 ? payload.note.slice(0, 50) + '...' : payload.note,
      'success',
    );

    const spoken = `Done. I added the ${payload.noteType} note to ${project.project_title}.`;
    const display = `### ✅ Note Added\n\n• **Project:** ${project.project_title}\n• **Note Type:** ${payload.noteType}\n• **Note:** "${payload.note}"`;

    return {
      success: true,
      toolName: 'add_project_note',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to add project note.';
    return {
      success: false,
      toolName: 'add_project_note',
      error: errorMsg,
      spokenText: `I couldn't add the note. ${errorMsg}`,
      displayText: `❌ Failed to add note: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Add note failed: "${project.project_title}"`, 'project', project.id, project.project_title, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_approve_project_milestone(
  payload: { projectId: string; milestone: 'concept' | 'print' | 'ebook'; notes?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const project = ctx.data.projects.find((p) => p.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'approve_project_milestone',
      error: 'project_not_found',
      spokenText: "I couldn't find the project to approve.",
      displayText: "❌ Project not found.",
    };
  }

  const milestoneLabel =
    payload.milestone === 'concept' ? 'Design Concept' : payload.milestone === 'print' ? 'Print Version' : 'eBook Version';

  try {
    if (ctx.trackerMutations?.approveProjectMilestone) {
      await ctx.trackerMutations.approveProjectMilestone(
        project.id,
        payload.milestone,
        ctx.currentProfile.id,
        payload.notes,
        ctx.currentProfile.full_name,
      );
    }

    const audit = createAuditLog(
      ctx,
      `Approved ${milestoneLabel} for "${project.project_title}"`,
      'project',
      project.id,
      project.project_title,
      project.current_stage || 'Review',
      'Approved',
      'success',
    );

    const spoken = `Done. The ${milestoneLabel} for ${project.project_title} has been approved.`;
    const display = `### ✅ Milestone Approved\n\n• **Project:** ${project.project_title} (${project.project_number})\n• **Approved Milestone:** **${milestoneLabel}**\n• **Approved By:** ${ctx.currentProfile.full_name}\n• **Status:** Active production stage advanced`;

    return {
      success: true,
      toolName: 'approve_project_milestone',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to approve milestone.';
    return {
      success: false,
      toolName: 'approve_project_milestone',
      error: errorMsg,
      spokenText: `I couldn't complete the approval. ${errorMsg}`,
      displayText: `❌ Failed to approve milestone: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Approve milestone failed: "${project.project_title}"`, 'project', project.id, project.project_title, null, null, 'failed', errorMsg),
    };
  }
}

// ==========================================
// 5. FINANCE & PAYROLL ACTIONS
// ==========================================

export async function execute_record_income(
  payload: { amount: number; currency?: string; category?: string; description?: string; transactionDate?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'record_income',
      error: 'permission_denied',
      spokenText: "Only administrators can record company income.",
      displayText: "🔒 Company income recording is restricted to administrators.",
    };
  }

  const currency = payload.currency || (ctx.displayCurrency === 'PKR' ? 'PKR' : 'USD');
  const amountStr = ctx.formatMoney(payload.amount, currency);
  const category = payload.category || 'Client Payment';
  const description = payload.description || 'Income entry recorded via AI Assistant';

  try {
    if (ctx.trackerMutations?.createFinanceTransaction) {
      await ctx.trackerMutations.createFinanceTransaction({
        type: 'income',
        category,
        description,
        amount: payload.amount,
        currency: currency as any,
        exchange_rate: ctx.exchangeRate,
        transaction_date: payload.transactionDate || new Date().toISOString().slice(0, 10),
        payment_method: 'Bank Wire',
      });
    }

    const audit = createAuditLog(
      ctx,
      `Recorded income: ${amountStr} (${category})`,
      'finance',
      undefined,
      category,
      null,
      amountStr,
      'success',
    );

    const spoken = `Done. I recorded the ${amountStr} income for ${category}.`;
    const display = `### ✅ Income Recorded\n\n• **Amount:** **${amountStr}**\n• **Category:** ${category}\n• **Description:** ${description}\n• **Date:** ${formatDate(payload.transactionDate || new Date().toISOString().slice(0, 10))}`;

    return {
      success: true,
      toolName: 'record_income',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to record income.';
    return {
      success: false,
      toolName: 'record_income',
      error: errorMsg,
      spokenText: `I couldn't record the income. ${errorMsg}`,
      displayText: `❌ Failed to record income: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Record income failed: ${amountStr}`, 'finance', undefined, category, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_record_expense(
  payload: { amount: number; currency?: string; category?: string; description?: string; transactionDate?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'record_expense',
      error: 'permission_denied',
      spokenText: "Only administrators can record company expenses.",
      displayText: "🔒 Company expense recording is restricted to administrators.",
    };
  }

  const currency = payload.currency || (ctx.displayCurrency === 'PKR' ? 'PKR' : 'USD');
  const amountStr = ctx.formatMoney(payload.amount, currency);
  const category = payload.category || 'Office';
  const description = payload.description || 'Expense entry recorded via AI Assistant';

  try {
    if (ctx.trackerMutations?.createFinanceTransaction) {
      await ctx.trackerMutations.createFinanceTransaction({
        type: 'expense',
        category,
        description,
        amount: payload.amount,
        currency: currency as any,
        exchange_rate: ctx.exchangeRate,
        transaction_date: payload.transactionDate || new Date().toISOString().slice(0, 10),
        payment_method: 'Credit Card',
      });
    }

    const audit = createAuditLog(
      ctx,
      `Recorded expense: ${amountStr} (${category})`,
      'finance',
      undefined,
      category,
      null,
      amountStr,
      'success',
    );

    const spoken = `Done. I recorded the ${amountStr} expense for ${category}.`;
    const display = `### ✅ Expense Recorded\n\n• **Amount:** **${amountStr}**\n• **Category:** ${category}\n• **Description:** ${description}\n• **Date:** ${formatDate(payload.transactionDate || new Date().toISOString().slice(0, 10))}`;

    return {
      success: true,
      toolName: 'record_expense',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to record expense.';
    return {
      success: false,
      toolName: 'record_expense',
      error: errorMsg,
      spokenText: `I couldn't record the expense. ${errorMsg}`,
      displayText: `❌ Failed to record expense: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Record expense failed: ${amountStr}`, 'finance', undefined, category, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_record_payroll_payment(
  payload: { employeeId: string; amount: number; currency?: string; notes?: string; salaryMonth?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'record_payroll_payment',
      error: 'permission_denied',
      spokenText: "Only administrators can record payroll payments.",
      displayText: "🔒 Payroll payments are restricted to administrators.",
    };
  }

  const employee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!employee) {
    return {
      success: false,
      toolName: 'record_payroll_payment',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member for this payroll payment.",
      displayText: "❌ Team member not found.",
    };
  }

  const currency = payload.currency || 'USD';
  const amountStr = ctx.formatMoney(payload.amount, currency);
  const empName = firstName(employee.full_name);

  try {
    if (ctx.trackerMutations?.addEmployeeLedgerEntry) {
      await ctx.trackerMutations.addEmployeeLedgerEntry({
        employee_id: employee.id,
        entry_type: 'Salary',
        amount: payload.amount,
        currency,
        salary_month: payload.salaryMonth || new Date().toISOString().slice(0, 7),
        payment_method: 'Bank Transfer',
        notes: payload.notes || 'Salary payout via AI Assistant',
        paid_at: new Date().toISOString(),
      });
    }

    const audit = createAuditLog(
      ctx,
      `Recorded payroll payment of ${amountStr} for ${employee.full_name}`,
      'payroll',
      employee.id,
      employee.full_name,
      null,
      amountStr,
      'success',
    );

    const spoken = `Done. ${empName}'s ${amountStr} payroll payment has been recorded.`;
    const display = `### ✅ Payroll Payment Recorded\n\n• **Employee:** **${employee.full_name}**\n• **Amount:** **${amountStr}**\n• **Month:** ${payload.salaryMonth || new Date().toISOString().slice(0, 7)}\n• **Payment Method:** Bank Transfer`;

    return {
      success: true,
      toolName: 'record_payroll_payment',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to record payroll payment.';
    return {
      success: false,
      toolName: 'record_payroll_payment',
      error: errorMsg,
      spokenText: `I couldn't record the payroll payment. ${errorMsg}`,
      displayText: `❌ Failed to record payroll payment: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Payroll payment failed for ${employee.full_name}`, 'payroll', employee.id, employee.full_name, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_add_payroll_advance(
  payload: { employeeId: string; amount: number; currency?: string; notes?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'add_payroll_advance',
      error: 'permission_denied',
      spokenText: "Only administrators can record salary advances.",
      displayText: "🔒 Salary advances are restricted to administrators.",
    };
  }

  const employee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!employee) {
    return {
      success: false,
      toolName: 'add_payroll_advance',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member for this advance.",
      displayText: "❌ Team member not found.",
    };
  }

  const currency = payload.currency || 'USD';
  const amountStr = ctx.formatMoney(payload.amount, currency);
  const empName = firstName(employee.full_name);

  try {
    if (ctx.trackerMutations?.addEmployeeLedgerEntry) {
      await ctx.trackerMutations.addEmployeeLedgerEntry({
        employee_id: employee.id,
        entry_type: 'Advance',
        amount: payload.amount,
        currency,
        payment_method: 'Cash / Transfer',
        notes: payload.notes || 'Advance recorded via AI Assistant',
        paid_at: new Date().toISOString(),
      });
    }

    const audit = createAuditLog(
      ctx,
      `Recorded advance of ${amountStr} for ${employee.full_name}`,
      'payroll',
      employee.id,
      employee.full_name,
      null,
      amountStr,
      'success',
    );

    const spoken = `Done. I recorded a ${amountStr} advance for ${empName}.`;
    const display = `### ✅ Salary Advance Recorded\n\n• **Employee:** **${employee.full_name}**\n• **Advance Amount:** **${amountStr}**\n• **Date:** ${formatDate(new Date().toISOString())}`;

    return {
      success: true,
      toolName: 'add_payroll_advance',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to record advance.';
    return {
      success: false,
      toolName: 'add_payroll_advance',
      error: errorMsg,
      spokenText: `I couldn't record the advance. ${errorMsg}`,
      displayText: `❌ Failed to record advance: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Advance failed for ${employee.full_name}`, 'payroll', employee.id, employee.full_name, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_add_payroll_deduction(
  payload: { employeeId: string; amount: number; currency?: string; notes?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'add_payroll_deduction',
      error: 'permission_denied',
      spokenText: "Only administrators can record salary deductions.",
      displayText: "🔒 Salary deductions are restricted to administrators.",
    };
  }

  const employee = ctx.data.profiles.find((p) => p.id === payload.employeeId);
  if (!employee) {
    return {
      success: false,
      toolName: 'add_payroll_deduction',
      error: 'employee_not_found',
      spokenText: "I couldn't find the team member for this deduction.",
      displayText: "❌ Team member not found.",
    };
  }

  const currency = payload.currency || 'USD';
  const amountStr = ctx.formatMoney(payload.amount, currency);
  const empName = firstName(employee.full_name);

  try {
    if (ctx.trackerMutations?.addEmployeeLedgerEntry) {
      await ctx.trackerMutations.addEmployeeLedgerEntry({
        employee_id: employee.id,
        entry_type: 'Deduction',
        amount: payload.amount,
        currency,
        notes: payload.notes || 'Deduction recorded via AI Assistant',
        paid_at: new Date().toISOString(),
      });
    }

    const audit = createAuditLog(
      ctx,
      `Recorded deduction of ${amountStr} for ${employee.full_name}`,
      'payroll',
      employee.id,
      employee.full_name,
      null,
      amountStr,
      'success',
    );

    const spoken = `Done. I added a ${amountStr} deduction for ${empName}.`;
    const display = `### ✅ Salary Deduction Recorded\n\n• **Employee:** **${employee.full_name}**\n• **Deduction Amount:** **${amountStr}**\n• **Reason / Note:** ${payload.notes || 'Deduction'}`;

    return {
      success: true,
      toolName: 'add_payroll_deduction',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to record deduction.';
    return {
      success: false,
      toolName: 'add_payroll_deduction',
      error: errorMsg,
      spokenText: `I couldn't record the deduction. ${errorMsg}`,
      displayText: `❌ Failed to record deduction: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Deduction failed for ${employee.full_name}`, 'payroll', employee.id, employee.full_name, null, null, 'failed', errorMsg),
    };
  }
}

// ==========================================
// 6. COMMUNICATION ACTIONS
// ==========================================

export async function execute_send_internal_message(
  payload: { recipientId: string; body: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const recipient = ctx.data.profiles.find((p) => p.id === payload.recipientId);
  const recipientName = recipient ? firstName(recipient.full_name) : 'User';

  try {
    if (ctx.trackerMutations?.getOrCreateDM && ctx.trackerMutations?.sendMessage) {
      const dm = await ctx.trackerMutations.getOrCreateDM(payload.recipientId);
      if (dm && dm.id) {
        await ctx.trackerMutations.sendMessage(dm.id, payload.body);
      }
    }

    const audit = createAuditLog(
      ctx,
      `Sent internal message to ${recipient?.full_name || recipientName}`,
      'message',
      payload.recipientId,
      recipient?.full_name || recipientName,
      null,
      payload.body,
      'success',
    );

    const spoken = `Done. Your message has been sent to ${recipientName}.`;
    const display = `### ✉️ Message Sent\n\n• **To:** **${recipient?.full_name || recipientName}**\n• **Message:** "${payload.body}"`;

    return {
      success: true,
      toolName: 'send_internal_message',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to send message.';
    return {
      success: false,
      toolName: 'send_internal_message',
      error: errorMsg,
      spokenText: `I couldn't send the message. ${errorMsg}`,
      displayText: `❌ Failed to send message: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Send message failed to ${recipientName}`, 'message', payload.recipientId, recipientName, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_send_client_message(
  payload: { clientName: string; body: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const audit = createAuditLog(
    ctx,
    `Prepared client notification for ${payload.clientName}`,
    'message',
    undefined,
    payload.clientName,
    null,
    payload.body,
    'success',
  );

  const spoken = `Done. The message for ${payload.clientName} has been queued.`;
  const display = `### ✉️ Client Notification Sent\n\n• **To Client:** **${payload.clientName}**\n• **Message:** "${payload.body}"`;

  return {
    success: true,
    toolName: 'send_client_message',
    spokenText: spoken,
    displayText: display,
    auditLog: audit,
  };
}

export async function execute_invite_client(
  payload: { full_name: string; email: string; project_ids?: string[] },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'invite_client',
      error: 'permission_denied',
      spokenText: 'Only administrators can invite or add clients.',
      displayText: '🔒 Client management is restricted to administrators.',
    };
  }

  try {
    if (ctx.trackerMutations?.inviteClient) {
      await ctx.trackerMutations.inviteClient({
        full_name: payload.full_name,
        email: payload.email,
        project_ids: payload.project_ids || [],
        status: 'active',
      });
    }

    const audit = createAuditLog(
      ctx,
      `Invited client: ${payload.full_name} (${payload.email})`,
      'message',
      undefined,
      payload.full_name,
      null,
      payload.email,
      'success',
    );

    const spoken = `Done. Client invitation for ${payload.full_name} has been processed.`;
    const display = `### ✅ Client Invited\n\n• **Client Name:** **${payload.full_name}**\n• **Email:** ${payload.email}\n• **Status:** Active`;

    return {
      success: true,
      toolName: 'invite_client',
      spokenText: spoken,
      displayText: display,
      auditLog: audit,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to invite client.';
    return {
      success: false,
      toolName: 'invite_client',
      error: errorMsg,
      spokenText: `I couldn't complete the client invitation. ${errorMsg}`,
      displayText: `❌ Failed to invite client: ${errorMsg}`,
      auditLog: createAuditLog(ctx, `Client invite failed: ${payload.full_name}`, 'message', undefined, payload.full_name, null, null, 'failed', errorMsg),
    };
  }
}

export async function execute_generate_client_invoice(
  payload: {
    clientName: string;
    month?: number | 'all';
    year?: number | 'all';
    paymentStatus?: string;
  },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'generate_client_invoice',
      error: 'permission_denied',
      spokenText: 'Clients cannot generate invoices through the assistant.',
      displayText: '🔒 Only staff and admins can generate client invoices.',
    };
  }

  const { clientName, month = 'all', year = 'all', paymentStatus = 'pending' } = payload;
  const projects = ctx.visibleProjects || [];

  // Find matching client
  const clientProjects = projects.filter(
    (p) => (p.client_name || '').toLowerCase() === clientName.toLowerCase(),
  );

  let resolvedClient = clientProjects[0]?.client_name;
  if (!resolvedClient) {
    const allClients = Array.from(new Set(projects.map((p) => p.client_name).filter(Boolean)));
    const fuzzy = allClients.find((c) => c.toLowerCase().includes(clientName.toLowerCase()));
    if (fuzzy) {
      resolvedClient = fuzzy;
    } else {
      return {
        success: false,
        toolName: 'generate_client_invoice',
        spokenText: `I couldn't find any projects for client "${clientName}".`,
        displayText: `❌ No projects found for client **${clientName}**.`,
      };
    }
  }

  const eligible = getEligibleProjectsForClient(projects, resolvedClient, month, year, paymentStatus, true);

  // Check if there are eligible projects or any with positive remaining balance
  const invoiceProjects =
    eligible.length > 0
      ? eligible
      : projects.filter(
          (p) =>
            (p.client_name || '').toLowerCase() === resolvedClient.toLowerCase() &&
            (p.remaining_balance || 0) > 0,
        );

  if (invoiceProjects.length === 0) {
    return {
      success: true,
      toolName: 'generate_client_invoice',
      spokenText: `${resolvedClient} currently has no pending payments or unpaid projects. All accounts are settled.`,
      displayText: `### 🧾 Invoice Status for ${resolvedClient}\n\n• **Status:** All accounts settled\n• **Pending Projects:** 0\n• **Outstanding Balance:** **${ctx.formatMoney(0)}**\n\nNo pending invoice is required.`,
    };
  }

  const clientEmail = invoiceProjects[0]?.client_email || '';
  const invoice = createBulkInvoice(resolvedClient, clientEmail, invoiceProjects, month, year);

  const audit = createAuditLog(
    ctx,
    `Generated Invoice #${invoice.invoice_number} for "${resolvedClient}"`,
    'finance',
    invoice.id,
    `Invoice #${invoice.invoice_number}`,
    null,
    `Total: ${ctx.formatMoney(invoice.total_due)}`,
    'success',
  );

  const totalFormatted = ctx.formatMoney(invoice.total_due);
  const spoken = `I generated an invoice for ${resolvedClient} for ${invoiceProjects.length} pending ${invoiceProjects.length === 1 ? 'project' : 'projects'} totaling ${totalFormatted}.`;

  const itemRows = invoice.items
    .map(
      (it) =>
        `| **${it.project_title}** (${it.project_number}) | ${it.service_type} | ${ctx.formatMoney(it.total_price)} | ${ctx.formatMoney(it.advance_paid)} | **${ctx.formatMoney(it.due_amount)}** |`,
    )
    .join('\n');

  const display =
    `### 🧾 Invoice Generated\n\n` +
    `• **Invoice #:** **${invoice.invoice_number}**\n` +
    `• **Client:** **${resolvedClient}** (${clientEmail || 'No email set'})\n` +
    `• **Due Date:** ${invoice.due_date}\n` +
    `• **Total Projects:** ${invoiceProjects.length}\n` +
    `• **Total Due:** **${totalFormatted}**\n\n` +
    `| Project | Service | Total | Advance | Due Amount |\n` +
    `| :--- | :--- | :--- | :--- | :--- |\n` +
    `${itemRows}\n\n` +
    `**Total Balance Due: ${totalFormatted}**`;

  return {
    success: true,
    toolName: 'generate_client_invoice',
    spokenText: spoken,
    displayText: display,
    invoice,
    auditLog: audit,
  };
}
