import type { ActionAuditLogEntry, ActionResult, ProposedChanges, ActionToolName } from './aiActionTypes';
import type { AIToolContext } from './aiTypes';

export class ActionHistoryManager {
  private static instance: ActionHistoryManager;
  private auditLogs: ActionAuditLogEntry[] = [];
  private undoableActions: Map<string, { actionTool: ActionToolName; resourceId?: string; beforeAfter: ProposedChanges }> = new Map();

  public static getInstance(): ActionHistoryManager {
    if (!ActionHistoryManager.instance) {
      ActionHistoryManager.instance = new ActionHistoryManager();
    }
    return ActionHistoryManager.instance;
  }

  public logAction(entry: ActionAuditLogEntry): void {
    this.auditLogs.unshift(entry);
    if (entry.executed && entry.resultStatus === 'SUCCESS') {
      this.undoableActions.set(entry.actionId, {
        actionTool: entry.actionTool,
        resourceId: entry.targetResourceId,
        beforeAfter: entry.beforeAfter,
      });
    }
  }

  public getLogs(userId?: string): ActionAuditLogEntry[] {
    if (userId) {
      return this.auditLogs.filter((log) => log.userId === userId);
    }
    return this.auditLogs;
  }

  public canUndo(actionId: string): boolean {
    return this.undoableActions.has(actionId);
  }

  public undoAction(actionId: string, ctx: AIToolContext): ActionResult {
    const undoData = this.undoableActions.get(actionId);
    if (!undoData) {
      return {
        success: false,
        actionId,
        actionTool: 'update_task',
        spokenText: "I couldn't find a record for that action to undo.",
        displayText: "⚠️ Undo unavailable or action already reverted.",
        errorCode: 'RESOURCE_NOT_FOUND',
      };
    }

    const { actionTool, resourceId, beforeAfter } = undoData;
    let spoken = `Action reversed successfully.`;
    let display = `### Action Undone\n\n`;

    if (actionTool === 'create_task' && resourceId && ctx.data.tasks) {
      const idx = ctx.data.tasks.findIndex((t) => t.id === resourceId);
      if (idx !== -1) {
        ctx.data.tasks.splice(idx, 1);
        spoken = `Task creation undone. The task has been removed.`;
        display += `• Task **#${resourceId.slice(0, 6)}** removed.`;
      }
    } else if (actionTool === 'update_task' && resourceId && ctx.data.tasks) {
      const task = ctx.data.tasks.find((t) => t.id === resourceId);
      if (task) {
        Object.entries(beforeAfter).forEach(([field, val]) => {
          if (val.from !== undefined) {
            (task as any)[field] = val.from;
          }
        });
        spoken = `Task update reverted to previous state.`;
        display += `• Restored task **"${task.title}"** to original properties.`;
      }
    } else if (actionTool === 'assign_task' && resourceId && ctx.data.tasks) {
      const task = ctx.data.tasks.find((t) => t.id === resourceId);
      if (task) {
        const oldAssignee = beforeAfter.assigned_to?.from || null;
        task.assigned_to = oldAssignee;
        spoken = `Task assignment undone.`;
        display += `• Reverted assignee for **"${task.title}"**.`;
      }
    } else if (actionTool === 'create_project' && resourceId && ctx.visibleProjects) {
      const idx = ctx.visibleProjects.findIndex((p) => p.id === resourceId);
      if (idx !== -1) {
        ctx.visibleProjects.splice(idx, 1);
        spoken = `Project creation undone.`;
        display += `• Project **#${resourceId.slice(0, 6)}** removed.`;
      }
    } else {
      spoken = `Reverted change for ${actionTool}.`;
      display += `• Successfully rolled back recent changes.`;
    }

    this.undoableActions.delete(actionId);

    return {
      success: true,
      actionId,
      actionTool,
      spokenText: spoken,
      displayText: display,
      undoAvailable: false,
    };
  }

  public clear(): void {
    this.auditLogs = [];
    this.undoableActions.clear();
  }
}
