import type { PageContext, ResolvedEntity, AIToolContext } from './aiTypes';

/**
 * Builds live PageContext from current router/app state and user permissions.
 */
export function buildPageContext(
  currentRoute: string,
  activeView: string,
  selectedEntity: any | null,
  toolCtx: AIToolContext,
): PageContext {
  const currentProfile = toolCtx.currentProfile;
  const role = currentProfile?.role || 'employee';

  let module: PageContext['module'] = 'dashboard';
  if (activeView === 'projects') module = 'projects';
  else if (activeView === 'my_tasks' || activeView === 'tasks') module = 'tasks';
  else if (activeView === 'calendar') module = 'calendar';
  else if (activeView === 'notifications') module = 'notifications';
  else if (activeView === 'team') module = 'team';
  else if (activeView === 'clients') module = 'clients';
  else if (activeView === 'delivered') module = 'delivered';
  else if (activeView === 'payments') module = 'payments';
  else if (activeView === 'finance') module = 'finance';
  else if (activeView === 'settings') module = 'settings';

  let entityContext: PageContext['selectedEntity'] = undefined;
  if (selectedEntity) {
    if (selectedEntity.project_title) {
      entityContext = {
        type: 'project',
        id: selectedEntity.id,
        name: selectedEntity.project_title,
        data: selectedEntity,
      };
    } else if (selectedEntity.task_title) {
      entityContext = {
        type: 'task',
        id: selectedEntity.id,
        name: selectedEntity.task_title,
        data: selectedEntity,
      };
    } else if (selectedEntity.full_name) {
      entityContext = {
        type: selectedEntity.role === 'client' ? 'client' : 'employee',
        id: selectedEntity.id,
        name: selectedEntity.full_name,
        data: selectedEntity,
      };
    }
  }

  return {
    route: currentRoute || `/${module}`,
    module,
    view: activeView,
    selectedEntity: entityContext,
    visibleEntities: {
      projectIds: (toolCtx.visibleProjects || []).map((p) => p.id),
      taskIds: (toolCtx.visibleTasks || []).map((t) => t.id),
      employeeIds: (toolCtx.data.profiles || []).map((p) => p.id),
    },
    userPermissions: {
      canManageAll: role === 'admin' || role === 'project_manager' || role === 'manager',
      role,
      isAdmin: role === 'admin',
      isManager: role === 'project_manager' || role === 'manager',
      isClient: role === 'client',
    },
  };
}

/**
 * Apply Context Priority Hierarchy:
 * 1. Explicit user statement
 * 2. Current selected entity
 * 3. Current page/module
 * 4. Conversation memory
 */
export function applyContextHierarchy(
  explicitEntities: ResolvedEntity[],
  pageContext: PageContext,
): ResolvedEntity[] {
  const finalEntities = [...explicitEntities];

  const hasExplicitEmployee = explicitEntities.some(
    (e) => (e.type === 'employee' || e.type === 'client') && e.matchedField !== 'conversation_memory',
  );
  const hasExplicitProject = explicitEntities.some(
    (e) => e.type === 'project' && e.matchedField !== 'conversation_memory',
  );
  const hasExplicitTask = explicitEntities.some(
    (e) => e.type === 'task' && e.matchedField !== 'conversation_memory',
  );

  // If user explicitly named a different employee (e.g., "Sarah ki tasks dikhao" while viewing Ahmed),
  // explicit user statement takes absolute priority!
  if (pageContext.selectedEntity && !hasExplicitEmployee && !hasExplicitProject && !hasExplicitTask) {
    const sel = pageContext.selectedEntity;
    finalEntities.push({
      type: sel.type as any,
      id: sel.id,
      name: sel.name,
      matchScore: 0.95,
      matchedField: 'page_context_selected',
      originalValue: sel.name,
      objectData: sel.data,
    });
  }

  return finalEntities;
}
