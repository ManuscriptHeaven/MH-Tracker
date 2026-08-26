import type { AIToolContext, AIToolName, AIToolResult, ConversationMemory, ToolExecutionLog } from './aiTypes';
import * as tools from './secureTools';
import { isClientRole } from '../utils';

export class VoiceQueryEngine {
  private static instance: VoiceQueryEngine;
  private memory: ConversationMemory = {};
  private executionLogs: ToolExecutionLog[] = [];

  public static getInstance(): VoiceQueryEngine {
    if (!VoiceQueryEngine.instance) {
      VoiceQueryEngine.instance = new VoiceQueryEngine();
    }
    return VoiceQueryEngine.instance;
  }

  public getMemory(): ConversationMemory {
    return this.memory;
  }

  public clearMemory(): void {
    this.memory = {};
  }

  public getLogs(): ToolExecutionLog[] {
    return this.executionLogs;
  }

  private logExecution(ctx: AIToolContext, question: string, tool: AIToolName, success: boolean, error?: string): void {
    const log: ToolExecutionLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: ctx.currentProfile.id,
      userRole: ctx.currentProfile.role,
      question,
      toolUsed: tool,
      timestamp: new Date().toISOString(),
      success,
      error,
    };
    this.executionLogs.unshift(log);
    if (this.executionLogs.length > 100) {
      this.executionLogs.pop();
    }
  }

  public async processQuery(rawQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
    const q = rawQuery.trim();
    const lower = q.toLowerCase();

    // 1. Follow-up & Anaphora Context Resolution
    const contextualResult = await this.resolveFollowUp(lower, q, ctx);
    if (contextualResult) {
      this.updateMemory(contextualResult, q);
      this.logExecution(ctx, q, contextualResult.toolName, contextualResult.success, contextualResult.error);
      return contextualResult;
    }

    // 2. Direct Intent Routing
    let result: AIToolResult;

    // --- TASKS (Must check before generic 'overdue' or 'due today') ---
    if (lower.includes('task') || lower.includes('tasks')) {
      if (lower.includes('overdue')) {
        result = await tools.get_tasks_summary('overdue', ctx);
      } else if (lower.includes('today')) {
        result = await tools.get_tasks_summary('today', ctx);
      } else if (lower.includes('my task') || lower.includes('assigned to me') || lower.includes('what are my') || lower.includes('my tasks')) {
        result = await tools.get_tasks_summary('my_tasks', ctx);
      } else {
        const empName = this.extractEmployeeFromQuery(lower, ctx);
        result = await tools.get_tasks_summary(empName || 'all', ctx);
      }
    }
    // --- OVERDUE PROJECTS ---
    else if (
      lower.includes('overdue') &&
      !lower.includes('task')
    ) {
      const clientMatch = this.extractClientFromQuery(lower, ctx);
      result = await tools.get_overdue_projects(ctx, clientMatch);
    }
    // --- DUE TODAY PROJECTS ---
    else if (
      (lower.includes('due today') || lower.includes('due for today') || lower.includes("what's due today") || lower.includes('what is due today')) &&
      !lower.includes('task')
    ) {
      result = await tools.get_due_today_projects(ctx);
    }
    // --- DUE THIS WEEK / UPCOMING ---
    else if (
      (lower.includes('due this week') || lower.includes('due next') || lower.includes('due tomorrow') || lower.includes('upcoming due')) &&
      !lower.includes('task')
    ) {
      result = await tools.get_due_this_week_projects(ctx);
    }
    // --- PENDING CLIENT APPROVALS ---
    else if (
      lower.includes('approval') ||
      lower.includes('waiting for approval') ||
      lower.includes('awaiting approval') ||
      lower.includes('pending approval') ||
      lower.includes('waiting for client')
    ) {
      result = await tools.get_pending_approvals(ctx);
    }
    // --- PROJECTS IN REVISION ---
    else if (
      (lower.includes('in revision') || lower.includes('revisions in progress') || lower.includes('how many revisions') || lower.includes('which projects have revisions')) &&
      !lower.includes('for ') && !lower.includes('on ')
    ) {
      result = await tools.get_projects_in_revision(ctx);
    }
    // --- SPECIFIC PROJECT REVISIONS ---
    else if (
      (lower.includes('revision') || lower.includes('revisions') || lower.includes('change') || lower.includes('feedback')) &&
      (lower.includes('on ') || lower.includes('for ') || lower.includes('latest') || lower.includes('what did'))
    ) {
      const projName = this.extractProjectFromQuery(q, ctx);
      result = await tools.get_project_revisions(projName || q, ctx);
    }
    // --- SPECIFIC PROJECT TIMELINE / STAGE ---
    else if (
      (lower.includes('timeline') || lower.includes('stage') || lower.includes('milestone') || lower.includes('progress')) &&
      (lower.includes('for ') || lower.includes('of ') || lower.includes('on '))
    ) {
      const projName = this.extractProjectFromQuery(q, ctx);
      result = await tools.get_project_timeline(projName || q, ctx);
    }
    // --- SPECIFIC PROJECT STATUS / WHO IS WORKING ON IT ---
    else if (
      (lower.includes('status') || lower.includes('who is working on') || lower.includes('who is assigned to') || lower.includes('tell me about') || lower.includes('what happened with')) &&
      this.containsProjectName(lower, ctx)
    ) {
      const projName = this.extractProjectFromQuery(q, ctx);
      if (lower.includes('what happened') || lower.includes('activity') || lower.includes('recent update')) {
        result = await tools.get_project_activity(projName || q, ctx);
      } else {
        result = await tools.get_project_details(projName || q, ctx);
      }
    }
    // --- EMPLOYEE WORKLOAD & ASSIGNED PROJECTS (e.g. "How many projects does Zain have?") ---
    else if (
      this.containsEmployeeName(lower, ctx) &&
      (lower.includes('project') || lower.includes('working on') || lower.includes('assigned') || lower.includes('have') || lower.includes('has'))
    ) {
      const empName = this.extractEmployeeFromQuery(lower, ctx);
      result = await tools.get_projects_by_employee(empName || q, ctx);
    }
    // --- WHO HAS MOST PROJECTS / OVERLOADED ---
    else if (
      lower.includes('most active projects') ||
      lower.includes('most projects') ||
      lower.includes('who is overloaded') ||
      lower.includes('employee workload') ||
      lower.includes('team workload') ||
      lower.includes('who has the most')
    ) {
      result = await tools.get_employee_workload(undefined, ctx);
    }
    // --- CLIENT SPECIFIC PROJECTS (e.g. "How many active projects does BCH have?", "What projects does Shara have?") ---
    else if (
      this.isClientProjectQuery(lower) ||
      (this.containsClientName(lower, ctx) && (lower.includes('project') || lower.includes('have') || lower.includes('has') || lower.includes('status')))
    ) {
      const clientName = this.extractClientFromQuery(lower, ctx) || this.extractClientPattern(lower);
      result = await tools.get_projects_by_client(clientName || q, ctx);
    }
    // --- PAYROLL / TEAM SALARIES / OWE TEAM ---
    else if (
      lower.includes('payroll') ||
      lower.includes('salary') ||
      lower.includes('owe the team') ||
      lower.includes('owe team') ||
      lower.includes('owe staff') ||
      lower.includes('paid to') ||
      lower.includes('how much did we pay')
    ) {
      const empName = this.extractEmployeeFromQuery(lower, ctx);
      result = await tools.get_payroll_summary(empName, ctx);
    }
    // --- CLIENT RECEIVABLES & OUTSTANDING BALANCES ---
    else if (
      lower.includes('owe') ||
      lower.includes('owing') ||
      lower.includes('receivable') ||
      lower.includes('outstanding balance') ||
      lower.includes('due amount') ||
      lower.includes('largest balance')
    ) {
      const clientName = this.extractClientFromQuery(lower, ctx);
      result = await tools.get_client_receivables(clientName, ctx);
    }
    // --- FINANCE / INCOME / EXPENSES / NET PROFIT ---
    else if (
      lower.includes('income') ||
      lower.includes('revenue') ||
      lower.includes('net profit') ||
      lower.includes('profit') ||
      lower.includes('spent this month') ||
      lower.includes('expenses') ||
      lower.includes('financial summary') ||
      lower.includes('how much have we spent')
    ) {
      result = await tools.get_finance_summary(undefined, ctx);
    }
    // --- OVERALL SUMMARY / DEFAULT ---
    else if (
      lower.includes('summary') ||
      lower.includes('overview') ||
      lower.includes('how are we doing') ||
      lower.includes('status of projects') ||
      lower.includes('active projects') ||
      lower.includes('total projects')
    ) {
      result = await tools.get_project_summary(ctx);
    }
    // --- GREETINGS / BOT IDENTITY ---
    else if (/\b(hi|hello|hey|who are you|what can you do|help)\b/i.test(lower)) {
      const firstName = ctx.currentProfile.full_name.split(' ')[0];
      const spoken = `Hi ${firstName}! I'm your Manuscript Heaven business voice assistant. You can ask me about overdue projects, due dates, team workload, client balances, or revisions.`;
      const display = `### Hi ${firstName} 👋\n\nI'm your **MH AI Voice Assistant**. Ask me anything about:\n\n• ⏰ **Deadlines & Overdue:** *"How many projects are overdue?"*, *"What is due today?"*\n• 📁 **Projects & Revisions:** *"What's QAI Reformatting's status?"*, *"How many are in revision?"*\n• 👥 **Team & Tasks:** *"What is Zain working on?"*, *"What are my tasks?"*\n• 💰 **Finance & Clients:** *"How much do clients owe us?"*, *"What's our income this month?"*`;
      result = {
        success: true,
        toolName: 'get_project_summary',
        spokenText: spoken,
        displayText: display,
      };
    }
    // --- FALLBACK GENERAL MATCH ---
    else {
      const proj = this.extractProjectFromQuery(q, ctx);
      if (proj) {
        result = await tools.get_project_details(proj, ctx);
      } else {
        result = await tools.get_project_summary(ctx);
      }
    }

    this.updateMemory(result, q);
    this.logExecution(ctx, q, result.toolName, result.success, result.error);
    return result;
  }

  // ==========================================
  // Context & Multi-Turn Resolution
  // ==========================================

  private async resolveFollowUp(lower: string, raw: string, ctx: AIToolContext): Promise<AIToolResult | null> {
    const mem = this.memory;

    // Follow-up 1A: "Which clients?" / "Who are they for?"
    if (
      lower === 'which clients?' ||
      lower === 'which clients' ||
      lower === 'who are they for' ||
      lower === 'who are they for?' ||
      lower === 'tell me the clients' ||
      lower === 'what clients' ||
      lower === 'what clients?'
    ) {
      if (!mem.lastProjects || mem.lastProjects.length === 0) {
        return {
          success: true,
          toolName: mem.lastToolUsed || 'get_project_summary',
          spokenText: "There were no projects in your previous query.",
          displayText: "There were no projects in your previous query.",
        };
      }

      const clientCounts: Record<string, number> = {};
      mem.lastProjects.forEach((p) => {
        const c = p.client_name || 'Other';
        clientCounts[c] = (clientCounts[c] || 0) + 1;
      });

      const entries = Object.entries(clientCounts);
      const breakdown = entries.map(([c, count]) => `${c} has ${count}`).join(', ');
      const spoken = entries.length === 1
        ? `All ${mem.lastProjects.length} are for ${entries[0][0]}.`
        : `${breakdown}.`;

      let display = `### Client Breakdown (${mem.lastProjects.length} Projects)\n\n`;
      for (const [c, count] of entries) {
        display += `• **${c}:** ${count} project${count === 1 ? '' : 's'}\n`;
      }

      return {
        success: true,
        toolName: mem.lastToolUsed || 'get_overdue_projects',
        spokenText: spoken,
        displayText: display.trim(),
        entities: {
          projects: mem.lastProjects,
          clients: Object.keys(clientCounts),
        },
      };
    }

    // Follow-up 1B: "Which ones?" / "What are they?" / "Which projects?"
    if (
      lower === 'which ones?' ||
      lower === 'which ones' ||
      lower === 'what are they?' ||
      lower === 'what are they' ||
      lower === 'which projects?' ||
      lower === 'which projects'
    ) {
      if (!mem.lastProjects || mem.lastProjects.length === 0) {
        return {
          success: true,
          toolName: mem.lastToolUsed || 'get_project_summary',
          spokenText: "There were no projects in your previous query.",
          displayText: "There were no projects in your previous query.",
        };
      }

      const titles = mem.lastProjects.map((p) => `${p.project_title} for ${p.client_name}`);
      const titleList = titles.slice(0, -1).join(', ') + (titles.length > 1 ? ', and ' : '') + titles.slice(-1);
      const spoken = `They are ${titleList}.`;

      let display = `### Projects (${mem.lastProjects.length})\n\n`;
      mem.lastProjects.forEach((p) => {
        display += `• **${p.project_title}** (${p.client_name}) — Stage: *${p.current_stage || p.status}*\n`;
      });

      return {
        success: true,
        toolName: mem.lastToolUsed || 'get_project_summary',
        spokenText: spoken,
        displayText: display.trim(),
        entities: {
          projects: mem.lastProjects,
        },
      };
    }

    // Follow-up 2: "What are the BCH ones?" / "What are the Amelia ones?" / "Which ones are for BCH?"
    if (
      (lower.includes('ones') || lower.startsWith('what are the') || lower.startsWith('which are the') || lower.includes('are they')) &&
      mem.lastProjects &&
      mem.lastProjects.length > 0
    ) {
      const targetClient = this.extractClientFromQuery(lower, ctx) || this.extractClientPattern(lower);
      if (targetClient) {
        // RBAC check for client user
        if (isClientRole(ctx.currentProfile.role)) {
          const myName = (ctx.currentProfile.full_name || '').toLowerCase();
          if (!myName.includes(targetClient.toLowerCase()) && !targetClient.toLowerCase().includes(myName)) {
            return {
              success: false,
              toolName: 'get_projects_by_client',
              error: 'permission_denied',
              spokenText: "I can't access that information with your current permissions.",
              displayText: "🔒 I can't access other clients' information with your current permissions.",
            };
          }
        }

        const filtered = mem.lastProjects.filter(
          (p) => p.client_name.toLowerCase().includes(targetClient.toLowerCase()) || targetClient.toLowerCase().includes(p.client_name.toLowerCase()),
        );

        if (filtered.length > 0) {
          const titles = filtered.map((p) => p.project_title);
          const titleList = titles.slice(0, -1).join(', ') + (titles.length > 1 ? ', and ' : '') + titles.slice(-1);
          const spoken = `They are ${titleList}.`;

          let display = `### ${targetClient} Projects (${filtered.length})\n\n`;
          filtered.forEach((p) => {
            display += `• **${p.project_title}** (${p.project_number}) — Stage: *${p.current_stage || p.status}* — Due: ${p.due_date ? p.due_date.slice(0, 10) : 'TBD'}\n`;
          });

          return {
            success: true,
            toolName: 'get_overdue_projects',
            spokenText: spoken,
            displayText: display.trim(),
            count: filtered.length,
            entities: { projects: filtered, clients: [targetClient] },
          };
        }
      }
    }

    // Follow-up 3: "What about Hamza?" / "What about Zain?" / "How about [Employee]?"
    if (lower.startsWith('what about ') || lower.startsWith('how about ') || lower.startsWith('and ')) {
      const empName = this.extractEmployeeFromQuery(lower, ctx);
      if (empName) {
        return tools.get_projects_by_employee(empName, ctx);
      }
      const clientName = this.extractClientFromQuery(lower, ctx);
      if (clientName) {
        return tools.get_projects_by_client(clientName, ctx);
      }
    }

    // Follow-up 4: "Who is working on it?" / "What is its status?" referring to single last project
    if (
      (lower.includes('who is working on it') || lower.includes('what is its status') || lower.includes("what's its status")) &&
      mem.lastProjects &&
      mem.lastProjects.length === 1
    ) {
      return tools.get_project_details(mem.lastProjects[0].project_title, ctx);
    }

    return null;
  }

  private updateMemory(result: AIToolResult, query: string): void {
    this.memory.lastToolUsed = result.toolName;
    this.memory.lastQueryTime = new Date().toISOString();

    if (result.entities?.projects) {
      this.memory.lastProjects = result.entities.projects;
    }
    if (result.entities?.clients && result.entities.clients.length > 0) {
      this.memory.lastClientName = result.entities.clients[0];
    }
    if (result.entities?.employees && result.entities.employees.length > 0) {
      this.memory.lastEmployeeName = result.entities.employees[0];
    }
  }

  // ==========================================
  // Entity Extraction Helpers
  // ==========================================

  private isClientProjectQuery(query: string): boolean {
    return (
      query.includes('projects does') ||
      query.includes('projects do') ||
      query.includes('projects for') ||
      query.includes('projects of') ||
      query.includes('active projects does')
    );
  }

  private extractClientPattern(query: string): string | undefined {
    const match = query.match(/(?:projects?\s+(?:does|do|for|of|has)\s+([a-z0-9\s]+?)(?:\s+have|\s+has|\?|$))/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return undefined;
  }

  private containsEmployeeName(query: string, ctx: AIToolContext): boolean {
    const teamProfiles = ctx.data.profiles.filter((p) => p.role !== 'client');
    return teamProfiles.some((p) => {
      const first = p.full_name.split(' ')[0].toLowerCase();
      return query.includes(first) || query.includes(p.full_name.toLowerCase());
    });
  }

  private extractEmployeeFromQuery(query: string, ctx: AIToolContext): string | undefined {
    const teamProfiles = ctx.data.profiles.filter((p) => p.role !== 'client');
    for (const p of teamProfiles) {
      const first = p.full_name.split(' ')[0].toLowerCase();
      if (query.includes(first) || query.includes(p.full_name.toLowerCase())) {
        return p.full_name;
      }
    }
    return undefined;
  }

  private containsClientName(query: string, ctx: AIToolContext): boolean {
    const clientNames = Array.from(new Set(ctx.visibleProjects.map((p) => p.client_name).filter(Boolean)));
    return clientNames.some((c) => query.includes(c.toLowerCase()) || c.toLowerCase().includes(query));
  }

  private extractClientFromQuery(query: string, ctx: AIToolContext): string | undefined {
    const clientNames = Array.from(new Set(ctx.visibleProjects.map((p) => p.client_name).filter(Boolean)));
    for (const c of clientNames) {
      if (query.includes(c.toLowerCase())) {
        return c;
      }
    }
    // Also check client profiles
    const clientProfiles = ctx.data.profiles.filter((p) => isClientRole(p.role));
    for (const p of clientProfiles) {
      const first = p.full_name.split(' ')[0].toLowerCase();
      if (query.includes(first) || query.includes(p.full_name.toLowerCase())) {
        return p.full_name;
      }
    }
    return undefined;
  }

  private containsProjectName(query: string, ctx: AIToolContext): boolean {
    return ctx.visibleProjects.some((p) => {
      const titleLower = p.project_title.toLowerCase();
      const numLower = p.project_number.toLowerCase();
      return query.includes(titleLower) || query.includes(numLower);
    });
  }

  private extractProjectFromQuery(query: string, ctx: AIToolContext): string | undefined {
    const qLower = query.toLowerCase();
    for (const p of ctx.visibleProjects) {
      if (qLower.includes(p.project_title.toLowerCase()) || qLower.includes(p.project_number.toLowerCase())) {
        return p.project_title;
      }
    }

    // Try stripping common query preambles
    const stripped = query
      .replace(/^(what is|what's|how is|who is working on|tell me about|status of|status for|revisions for|revisions on|latest revision on)\s+/i, '')
      .replace(/\s+(status|timeline|progress|revisions|due date)\s*$/i, '')
      .trim();

    if (stripped.length > 2) {
      return stripped;
    }

    return undefined;
  }
}

export const voiceQueryEngine = VoiceQueryEngine.getInstance();
