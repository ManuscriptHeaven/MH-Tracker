import type { AIToolContext } from './aiTypes';
import type { CrossModuleDomain, FederatedResult, JoinedRecord, CrossModuleQueryPlan } from './aiCrossModuleTypes';
import { checkModuleAccess } from './aiPermissionEngine';

export class CrossModuleAggregator {
  private static instance: CrossModuleAggregator;

  public static getInstance(): CrossModuleAggregator {
    if (!CrossModuleAggregator.instance) {
      CrossModuleAggregator.instance = new CrossModuleAggregator();
    }
    return CrossModuleAggregator.instance;
  }

  public executePlan(
    plan: CrossModuleQueryPlan,
    ctx: AIToolContext,
  ): FederatedResult {
    const startTime = Date.now();
    const userRole = ctx.currentProfile.role || 'employee';

    const records: JoinedRecord[] = [];
    const moduleCounts: Record<CrossModuleDomain, number> = {
      projects: 0,
      tasks: 0,
      employees: 0,
      clients: 0,
      finance: 0,
      messages: 0,
      calendar: 0,
    };
    let permissionMaskedCount = 0;

    // Check RBAC permissions for involved modules
    const allowedModules: Record<CrossModuleDomain, boolean> = {
      projects: checkModuleAccess('projects', userRole),
      tasks: checkModuleAccess('tasks', userRole),
      employees: checkModuleAccess('employees', userRole),
      clients: checkModuleAccess('clients', userRole),
      finance: checkModuleAccess('finance', userRole),
      messages: checkModuleAccess('messages', userRole),
      calendar: checkModuleAccess('calendar', userRole),
    };

    // 1. Join Clients with Active Projects & Overdue Invoices
    if (plan.primaryModule === 'clients' || plan.secondaryModules.includes('clients')) {
      const clients = ctx.data.profiles.filter((p) => p.role === 'client');
      for (const client of clients) {
        if (!allowedModules.clients) {
          permissionMaskedCount++;
          continue;
        }

        const clientProjects = ctx.visibleProjects.filter((p) => p.client_name === client.full_name || p.client_email === client.email);
        const clientInvoices = ((ctx.data as any).invoices || []).filter((inv: any) => inv.client_id === client.id || inv.client_name === client.full_name);

        if (clientProjects.length > 0 || clientInvoices.length > 0) {
          moduleCounts.clients++;
          if (allowedModules.projects) moduleCounts.projects += clientProjects.length;
          if (allowedModules.finance) moduleCounts.finance += clientInvoices.length;

          records.push({
            primaryId: client.id,
            primaryModule: 'clients',
            title: client.full_name,
            subtitle: `Company: ${(client as any).company || 'N/A'} | Email: ${client.email}`,
            status: client.status || 'Active',
            relatedModuleData: {
              projects: allowedModules.projects ? clientProjects : [],
              invoices: allowedModules.finance ? clientInvoices : [],
            },
            deepLink: `/clients?id=${client.id}`,
          });
        }
      }
    }

    // 2. Join Employee Overdue Tasks & Related Client Invoices
    if (plan.primaryModule === 'employees' || plan.secondaryModules.includes('tasks')) {
      const employees = ctx.data.profiles.filter((p) => p.role === 'employee' || p.role === 'admin' || p.role === 'manager');
      for (const emp of employees) {
        if (!allowedModules.employees) {
          permissionMaskedCount++;
          continue;
        }

        const empTasks = ctx.visibleTasks.filter((t) => t.assigned_to === emp.id || t.assigned_to === emp.full_name);
        const relatedProjectIds = Array.from(new Set(empTasks.map((t) => t.project_id).filter(Boolean)));
        const relatedInvoices = allowedModules.finance
          ? ((ctx.data as any).invoices || []).filter((inv: any) => relatedProjectIds.includes(inv.project_id))
          : [];

        if (empTasks.length > 0) {
          moduleCounts.employees++;
          if (allowedModules.tasks) moduleCounts.tasks += empTasks.length;
          if (allowedModules.finance) moduleCounts.finance += relatedInvoices.length;

          records.push({
            primaryId: emp.id,
            primaryModule: 'employees',
            title: emp.full_name,
            subtitle: `Role: ${emp.role} | Active Tasks: ${empTasks.length}`,
            status: 'Active',
            relatedModuleData: {
              tasks: allowedModules.tasks ? empTasks : [],
              invoices: relatedInvoices,
            },
            deepLink: `/team?id=${emp.id}`,
          });
        }
      }
    }

    // Fallback join for Projects & Tasks if no specific primary matched
    if (records.length === 0 && allowedModules.projects) {
      for (const proj of ctx.visibleProjects) {
        const projTasks = allowedModules.tasks ? ctx.visibleTasks.filter((t) => t.project_id === proj.id) : [];
        moduleCounts.projects++;
        moduleCounts.tasks += projTasks.length;

        records.push({
          primaryId: proj.id,
          primaryModule: 'projects',
          title: proj.project_title,
          subtitle: `Client: ${proj.client_name || 'N/A'} | Number: ${proj.project_number}`,
          status: proj.status,
          date: proj.due_date,
          relatedModuleData: {
            tasks: projTasks,
          },
          deepLink: `/projects?id=${proj.id}`,
        });
      }
    }

    const latencyMs = Date.now() - startTime;

    return {
      planId: plan.planId,
      executedAt: new Date().toISOString(),
      totalRecordsFound: records.length,
      records,
      moduleCounts,
      permissionMaskedCount,
      latencyMs,
      fromCache: false,
    };
  }
}
