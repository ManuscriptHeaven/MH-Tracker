import type { Profile } from './aiTypes';
import type { ActionToolName, TargetResource } from './aiActionTypes';
import { isAllowlistedAction, getActionDefinition } from './aiActionCatalog';
import { isClientRole, isManagerRole } from '../utils';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  errorCode?: 'ACTION_NOT_ALLOWED' | 'PERMISSION_DENIED';
}

export function checkActionPermission(
  profile: Profile,
  actionTool: ActionToolName,
  targetResource?: TargetResource,
): PermissionCheckResult {
  // 1. External Allowlist Guard
  if (!isAllowlistedAction(actionTool)) {
    return {
      allowed: false,
      reason: `Action "${actionTool}" is not on the Phase 3 authorized action allowlist.`,
      errorCode: 'ACTION_NOT_ALLOWED',
    };
  }

  const role = profile.role || 'employee';

  // 2. Admin Has Full Authorized Capability
  if (role === 'admin') {
    return { allowed: true };
  }

  // 3. Client Role Constraints (Strictly Limited)
  if (isClientRole(role)) {
    if (actionTool === 'create_reminder' || actionTool === 'add_note') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Client accounts cannot perform "${actionTool}". You may request changes through project notes or your project manager.`,
      errorCode: 'PERMISSION_DENIED',
    };
  }

  // 4. Employee & Manager Role Capabilities
  if (role === 'employee') {
    // Employees cannot create or update whole projects
    if (actionTool === 'create_project' || actionTool === 'update_project') {
      return {
        allowed: false,
        reason: 'Employees do not have permission to create or modify projects. Please contact an Admin or Manager.',
        errorCode: 'PERMISSION_DENIED',
      };
    }

    // Employees can create, update, assign tasks, create reminders, update calendar, and add notes
    if (
      actionTool === 'create_task' ||
      actionTool === 'update_task' ||
      actionTool === 'assign_task' ||
      actionTool === 'create_reminder' ||
      actionTool === 'update_calendar' ||
      actionTool === 'add_note'
    ) {
      return { allowed: true };
    }
  }

  if (isManagerRole(role)) {
    // Managers can perform all 8 allow-listed actions
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Your user role (${role}) is not authorized to execute ${actionTool}.`,
    errorCode: 'PERMISSION_DENIED',
  };
}

export function checkModuleAccess(moduleName: string, role: string): boolean {
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'employee') {
    if (moduleName === 'finance') return false;
    return true;
  }
  if (role === 'client') {
    if (moduleName === 'messages' || moduleName === 'employees') return false;
    return true;
  }
  return false;
}
