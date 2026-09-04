import type { IntentResult, AIToolContext } from './aiTypes';
import type { CrossModuleQueryPlan, CrossModuleWriteProposal, CrossModuleDomain } from './aiCrossModuleTypes';
import { isAllowlistedAction } from './aiActionCatalog';
import type { ActionToolName } from './aiActionTypes';
import type { RiskLevel } from './aiApprovalTypes';

export class CrossModulePlanner {
  private static instance: CrossModulePlanner;

  public static getInstance(): CrossModulePlanner {
    if (!CrossModulePlanner.instance) {
      CrossModulePlanner.instance = new CrossModulePlanner();
    }
    return CrossModulePlanner.instance;
  }

  public isCrossModuleQuery(userMessage: string, intent: IntentResult): boolean {
    const text = userMessage.toLowerCase();
    const isMultiModuleText =
      (text.includes('client') && (text.includes('invoice') || text.includes('project') || text.includes('task') || text.includes('due') || text.includes('message'))) ||
      (text.includes('task') && (text.includes('invoice') || text.includes('calendar') || text.includes('message') || text.includes('project'))) ||
      (text.includes('employee') && (text.includes('task') || text.includes('invoice') || text.includes('performance') || text.includes('message') || text.includes('payroll') || text.includes('due'))) ||
      (text.includes('payroll') && (text.includes('message') || text.includes('task') || text.includes('due'))) ||
      (text.includes('overdue') && (text.includes('invoices') || text.includes('tasks'))) ||
      text.includes('cross') ||
      text.includes('join') ||
      text.includes('dono') ||
      text.includes('donon') ||
      text.includes('saaray');

    return intent.name === 'cross_module_query' || isMultiModuleText;
  }

  public buildQueryPlan(userMessage: string, intent: IntentResult): CrossModuleQueryPlan {
    const text = userMessage.toLowerCase();
    const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    let primaryModule: CrossModuleDomain = 'projects';
    const secondaryModules: CrossModuleDomain[] = [];

    if (text.includes('client')) {
      primaryModule = 'clients';
      if (text.includes('invoice')) secondaryModules.push('finance');
      if (text.includes('project')) secondaryModules.push('projects');
      if (text.includes('task')) secondaryModules.push('tasks');
    } else if (text.includes('employee') || text.includes('hamza') || text.includes('worker')) {
      primaryModule = 'employees';
      secondaryModules.push('tasks');
      if (text.includes('invoice')) secondaryModules.push('finance');
    } else if (text.includes('task')) {
      primaryModule = 'tasks';
      if (text.includes('project')) secondaryModules.push('projects');
      if (text.includes('calendar')) secondaryModules.push('calendar');
    }

    return {
      planId,
      requestId: `req-${Date.now()}`,
      timestamp,
      intentCategory: intent.category,
      description: `Cross-module analytical query connecting ${primaryModule} with ${secondaryModules.join(', ')}`,
      primaryModule,
      secondaryModules,
      steps: [
        {
          stepId: 'step-1',
          tool: `search_${primaryModule}`,
          module: primaryModule,
          params: { query: userMessage },
        },
        ...secondaryModules.map((mod, idx) => ({
          stepId: `step-${idx + 2}`,
          tool: `search_${mod}`,
          module: mod,
          params: { query: userMessage },
          dependsOn: ['step-1'],
          joinKey: primaryModule === 'clients' ? 'client_id' : 'project_id',
        })),
      ],
      isWritePlan: false,
      estimatedComplexity: secondaryModules.length > 1 ? 'high' : 'medium',
    };
  }

  public buildMultiStepWriteProposal(
    userMessage: string,
    toolCtx: AIToolContext,
  ): CrossModuleWriteProposal | null {
    const text = userMessage.toLowerCase();

    // Check if prompt asks for multi-step write (e.g., "Mark invoice INV-1048 paid and update project status to completed")
    const isMultiWrite =
      (text.includes('invoice') && text.includes('task')) ||
      (text.includes('invoice') && text.includes('project')) ||
      (text.includes('task') && text.includes('reminder')) ||
      (text.includes('reassign') && text.includes('calendar'));

    if (!isMultiWrite) return null;

    const proposalId = `cm-prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const affectedModules: CrossModuleDomain[] = ['finance', 'tasks', 'projects'];
    const overallRiskLevel: RiskLevel = 'high';

    return {
      proposalId,
      requestId: `req-${Date.now()}`,
      createdAt,
      expiresAt,
      overallRiskLevel,
      affectedModules,
      steps: [
        {
          actionTool: 'update_project',
          module: 'projects',
          targetResource: { type: 'project', id: 'proj-1', name: 'Selected Project' },
          parameters: { project_id: 'proj-1', status: 'Completed' },
          proposedChanges: { status: { from: 'In Progress', to: 'Completed' } },
          riskLevel: 'high',
        },
        {
          actionTool: 'update_task',
          module: 'tasks',
          targetResource: { type: 'task', id: 'task-1', name: 'Selected Task' },
          parameters: { task_id: 'task-1', status: 'Done' },
          proposedChanges: { status: { from: 'To Do', to: 'Done' } },
          riskLevel: 'medium',
        },
      ],
      summaryMessage: 'Execute multi-module action: Update project status and sync associated tasks.',
      requiresApproval: true,
    };
  }
}
