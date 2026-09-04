import type {
  AIToolContext,
  AIToolName,
  AIToolResult,
  AIActionPreview,
  ConversationMemory,
  DisambiguationOption,
  ToolExecutionLog,
} from './aiTypes';
import * as tools from './secureTools';
import * as safeActions from './safeActionTools';
import type { ProjectStatus } from '../types';
import { isClientRole, isManagerRole, firstName } from '../utils';
import { formatDate, parseNaturalDate, todayInput, addDays } from '../date';
import { aiUnderstandingEngine } from './aiUnderstandingEngine';
import { buildPageContext } from './aiPageContext';

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

  public setPendingAction(action: AIActionPreview | null): void {
    this.memory.pendingAction = action;
  }

  public setPendingDisambiguation(options: DisambiguationOption[] | null, context?: any): void {
    this.memory.pendingDisambiguation = options;
    this.memory.pendingDisambiguationContext = context || null;
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

    // ==========================================
    // 0. HANDLE PENDING CONFIRMATION (Voice / Text)
    // ==========================================
    if (this.memory.pendingAction) {
      const isAffirmative = /\b(yes|yes do it|confirm|go ahead|do that|do it|okay|ok|sure|proceed|yep|yeah)\b/i.test(lower);
      const isNegative = /\b(no|cancel|don't do it|dont do it|stop|never mind|nevermind|abort)\b/i.test(lower);

      if (isAffirmative) {
        const action = this.memory.pendingAction;
        this.memory.pendingAction = null;
        const result = await this.executeAction(action, ctx);
        this.logExecution(ctx, q, action.toolName, result.success, result.error);
        return result;
      }

      if (isNegative) {
        const action = this.memory.pendingAction;
        this.memory.pendingAction = null;
        const result: AIToolResult = {
          success: true,
          toolName: action.toolName,
          spokenText: 'Action cancelled.',
          displayText: '🛑 **Action cancelled.** No changes were made.',
        };
        this.logExecution(ctx, q, action.toolName, true);
        return result;
      }
    }

    // ==========================================
    // 0B. HANDLE PENDING DISAMBIGUATION (Selection)
    // ==========================================
    if (this.memory.pendingDisambiguation && this.memory.pendingDisambiguation.length > 0) {
      const selected = this.matchDisambiguationOption(lower, this.memory.pendingDisambiguation);
      if (selected) {
        const options = this.memory.pendingDisambiguation;
        const context = this.memory.pendingDisambiguationContext;
        this.memory.pendingDisambiguation = null;
        this.memory.pendingDisambiguationContext = null;

        const resolvedResult = await this.resolveDisambiguationSelection(selected, context, ctx);
        if (resolvedResult) {
          this.updateMemory(resolvedResult, q);
          this.logExecution(ctx, q, resolvedResult.toolName, resolvedResult.success, resolvedResult.error);
          return resolvedResult;
        }
      }
    }

    // ==========================================
    // PHASE 1: AI UNDERSTANDING ENGINE PIPELINE
    // ==========================================
    const pageCtx = buildPageContext(
      typeof window !== 'undefined' ? window.location.pathname : '/',
      (ctx as any).activeView || 'dashboard',
      (ctx as any).selectedProject || null,
      ctx,
    );

    const understanding = aiUnderstandingEngine.processMessage(q, ctx, pageCtx);

    // Smart Clarification Check
    if (understanding.needsClarification && understanding.clarificationQuestion) {
      const result: AIToolResult = {
        success: true,
        toolName: 'get_tasks_summary',
        spokenText: understanding.clarificationQuestion,
        displayText: understanding.clarificationQuestion,
        disambiguation: understanding.ambiguities[0]?.options || [],
      };
      this.logExecution(ctx, q, 'get_tasks_summary', true);
      return result;
    }

    // ==========================================
    // 1. FOLLOW-UP & ANAPHORA CONTEXT RESOLUTION
    // ==========================================
    const contextualResult = await this.resolveFollowUp(lower, q, ctx);
    if (contextualResult) {
      this.updateMemory(contextualResult, q);
      this.logExecution(ctx, q, contextualResult.toolName, contextualResult.success, contextualResult.error);
      return contextualResult;
    }

    // ==========================================
    // 2. WRITE & SAFE ACTIONS INTENT DETECTION
    // ==========================================
    const writeIntent = await this.detectWriteIntent(lower, q, ctx);
    if (writeIntent) {
      this.updateMemory(writeIntent, q);
      this.logExecution(ctx, q, writeIntent.toolName, writeIntent.success, writeIntent.error);
      return writeIntent;
    }

    // ==========================================
    // 3. READ INTENTS (PHASE 1 QUERIES)
    // ==========================================
    let result: AIToolResult;

    // --- TASKS ---
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
    else if (lower.includes('overdue') && !lower.includes('task')) {
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
      !lower.includes('for ') &&
      !lower.includes('on ')
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
      const firstNameStr = ctx.currentProfile.full_name.split(' ')[0];
      const spoken = `Hi ${firstNameStr}! I'm your Manuscript Heaven business voice assistant. I can answer questions or safely perform actions like assigning tasks, updating statuses, or recording finance data.`;
      const display = `### Hi ${firstNameStr} 👋\n\nI'm your **MH AI Assistant (Phase 2: Safe Actions & Voice)**.\n\n• 🎙 **Voice Commands & Actions:** *"Assign QAI revision to Zain"*, *"Put Book 2 on hold"*, *"Create a task for Zain"*...\n• ⏰ **Deadlines & Overdue:** *"How many projects are overdue?"*, *"What's due today?"*\n• 👥 **Team & Workload:** *"What is Zain working on?"*, *"Who has the most projects?"*\n• 💰 **Finance & Approvals:** *"Record a $100 payment from BCH"*, *"How much do clients owe us?"*`;
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
  // WRITE INTENT PARSER & ACTION PREVIEW GENERATOR
  // ==========================================

  private async detectWriteIntent(lower: string, q: string, ctx: AIToolContext): Promise<AIToolResult | null> {
    // ----------------------------------------------------
    // 00. INVOICE GENERATION INTENT
    // e.g. "Generate invoice for BCH for all pending payments", "Create invoice for BCH", "Invoice BCH"
    // ----------------------------------------------------
    if (
      (lower.includes('invoice') || lower.includes('generate bill') || lower.includes('bill client')) &&
      (lower.includes('generate') ||
        lower.includes('create') ||
        lower.includes('make') ||
        lower.includes('send') ||
        lower.includes('for all pending') ||
        lower.includes('pending payment') ||
        lower.includes('outstanding') ||
        lower.startsWith('invoice ') ||
        lower.startsWith('bill '))
    ) {
      const clientName = this.extractClientFromQuery(lower, ctx);
      if (!clientName) {
        // Fallback matching: extract word after "for" or "to"
        const match = q.match(/(?:invoice|bill|for)\s+(?:client\s+)?([a-zA-Z0-9\s]+?)(?:\s+for\s+all|\s+for\s+pending|\s+pending|\s*$)/i);
        const candidate = match ? match[1].trim() : '';
        if (candidate && candidate.toLowerCase() !== 'all' && candidate.toLowerCase() !== 'client') {
          return safeActions.execute_generate_client_invoice({ clientName: candidate }, ctx);
        }

        return {
          success: false,
          toolName: 'generate_client_invoice',
          spokenText: 'Which client would you like me to generate an invoice for?',
          displayText: '❓ Please specify which client to generate the invoice for.',
        };
      }

      return safeActions.execute_generate_client_invoice({ clientName }, ctx);
    }

    // ----------------------------------------------------
    // 0. CREATE PROJECT INTENT
    // e.g. "Add a new project named as Good One Client BCH", "Create a project called Good One for BCH", "New project Good One for BCH"
    // ----------------------------------------------------
    if (
      (lower.startsWith('add a new project') ||
        lower.startsWith('add new project') ||
        lower.startsWith('add a project') ||
        lower.startsWith('add project') ||
        lower.startsWith('create a new project') ||
        lower.startsWith('create new project') ||
        lower.startsWith('create a project') ||
        lower.startsWith('create project') ||
        lower.startsWith('new project') ||
        lower.startsWith('start a new project') ||
        lower.startsWith('start project')) &&
      !lower.includes('task') &&
      !lower.includes('note') &&
      !lower.includes('revision')
    ) {
      if (isClientRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'create_project',
          error: 'permission_denied',
          spokenText: "I can't create projects with client permissions.",
          displayText: '🔒 Project creation is restricted for client accounts.',
        };
      }

      // Extract client name
      let clientName = this.extractClientFromQuery(lower, ctx) || '';
      if (!clientName) {
        const clientMatch = q.match(/(?:for\s+client|client|for)\s+[:\-]?\s*([a-zA-Z0-9\s]+?)(?:\s+(?:due|with|priced|genre|service)|\s*$)/i);
        if (clientMatch && clientMatch[1]) {
          clientName = clientMatch[1].trim();
        }
      }
      if (!clientName) clientName = 'Manuscript Client';

      // Extract project title
      let projectTitle = '';
      const namedAsMatch = q.match(/(?:named\s+as|named|called|title|titled)\s+[:\-]?\s*([^,\n]+?)(?:\s+(?:for\s+)?client|\s+client|\s+due|\s+with|\s+priced|\s*$)/i);
      if (namedAsMatch && namedAsMatch[1]) {
        projectTitle = namedAsMatch[1].trim();
      } else {
        // Match "create project <title> for [client] <client>"
        const inlineTitleMatch = q.match(/^(?:add|create|start|new)\s+(?:a\s+)?(?:new\s+)?project\s+[:\-]?\s*([a-zA-Z0-9\s]+?)(?:\s+(?:for\s+client|client|for)\s+([a-zA-Z0-9\s]+))/i);
        if (inlineTitleMatch && inlineTitleMatch[1]) {
          projectTitle = inlineTitleMatch[1].trim();
        } else {
          projectTitle = q
            .replace(/^(?:add|create|start|new)\s+(?:a\s+)?(?:new\s+)?project\s*(?:named\s+as|called|named|title|:\s*)?/i, '')
            .replace(/(?:for\s+client|client|for)\s+[a-zA-Z0-9\s]+$/i, '')
            .trim();
        }
      }

      // Clean up common noise
      projectTitle = projectTitle.replace(/^(?:named\s+as|called|named|title)\s+/i, '').trim();

      if (!projectTitle || projectTitle.length < 2) {
        projectTitle = `New Project for ${clientName}`;
      }

      // Extract price if specified (e.g. "$500", "500 dollars")
      const priceMatch = lower.match(/(?:\$|rs\.?|usd)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:dollars|\$|usd|total)?/i);
      const totalPrice = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

      // Extract due date if specified
      const dateMatch = lower.match(/(?:due\s+|by\s+|on\s+)?(tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\b[a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b)/i);
      const dueDate = dateMatch ? parseNaturalDate(dateMatch[1]) : addDays(14);

      // Extract assignee if specified
      const targetEmp = this.extractEmployeeFromQuery(lower, ctx);
      const targetEmpProfile = targetEmp ? ctx.data.profiles.find((p) => p.full_name === targetEmp) : null;

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'create_project',
        category: 'high_risk',
        title: 'Create New Project',
        description: `Create new project "${projectTitle}" for client ${clientName}`,
        targetType: 'project',
        targetTitle: projectTitle,
        clientName: clientName,
        changes: [
          { field: 'title', label: 'Project Title', newValue: projectTitle },
          { field: 'client', label: 'Client', newValue: clientName },
          { field: 'service', label: 'Service Type', newValue: 'Print + eBook' },
          ...(dueDate ? [{ field: 'due_date', label: 'Due Date', newValue: formatDate(dueDate) }] : []),
          ...(totalPrice ? [{ field: 'price', label: 'Total Price', newValue: ctx.formatMoney(totalPrice) }] : []),
          ...(targetEmpProfile ? [{ field: 'assigned_to', label: 'Assigned To', newValue: targetEmpProfile.full_name }] : []),
        ],
        payload: {
          projectTitle,
          clientName,
          serviceType: 'Print + eBook',
          totalPrice,
          dueDate,
          assignedToId: targetEmpProfile?.id,
        },
        confirmButtonText: 'Create Project',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Create new project "${projectTitle}" for client ${clientName}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'create_project',
        spokenText: preview.spokenPrompt,
        displayText: `I will create the new project **"${projectTitle}"** for client **${clientName}**${dueDate ? ` (Due: **${formatDate(dueDate)}**)` : ''}.\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // 0B. DUPLICATE PROJECT
    // ----------------------------------------------------
    if (lower.startsWith('duplicate project') || lower.startsWith('clone project') || lower.startsWith('copy project')) {
      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);
      if (!matchedProject) {
        return {
          success: false,
          toolName: 'duplicate_project',
          error: 'project_not_found',
          spokenText: "I couldn't find the project to duplicate.",
          displayText: '❌ Project not found.',
        };
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'duplicate_project',
        category: 'high_risk',
        title: 'Duplicate Project',
        description: `Create duplicate copy of ${matchedProject.project_title}`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        clientName: matchedProject.client_name,
        changes: [
          { field: 'original', label: 'Original Project', newValue: matchedProject.project_title },
          { field: 'new', label: 'New Project Title', newValue: `${matchedProject.project_title} (Copy)` },
        ],
        payload: { projectId: matchedProject.id },
        confirmButtonText: 'Duplicate Project',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Duplicate project ${matchedProject.project_title}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'duplicate_project',
        spokenText: preview.spokenPrompt,
        displayText: `Duplicate **${matchedProject.project_title}** (${matchedProject.project_number})?\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // 0C. DELETE PROJECT / DELETE TASK
    // ----------------------------------------------------
    if ((lower.startsWith('delete project') || lower.startsWith('remove project')) && !lower.includes('task')) {
      if (ctx.currentProfile.role !== 'admin') {
        return {
          success: false,
          toolName: 'delete_project',
          error: 'permission_denied',
          spokenText: 'Only administrators can delete projects.',
          displayText: '🔒 Only administrators can delete projects.',
        };
      }

      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);
      if (!matchedProject) {
        return {
          success: false,
          toolName: 'delete_project',
          error: 'project_not_found',
          spokenText: "I couldn't find the project to delete.",
          displayText: '❌ Project not found.',
        };
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'delete_project',
        category: 'destructive',
        requiresStrongConfirmation: true,
        title: 'Delete Project Permanently',
        description: `Permanently delete ${matchedProject.project_title} (${matchedProject.project_number})`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        clientName: matchedProject.client_name,
        changes: [
          { field: 'project', label: 'Project', oldValue: matchedProject.project_title, newValue: 'PERMANENT DELETION' },
        ],
        payload: { projectId: matchedProject.id },
        confirmButtonText: 'Yes, Delete Project',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Warning: This will permanently delete project ${matchedProject.project_title}. Are you absolutely sure?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'delete_project',
        spokenText: preview.spokenPrompt,
        displayText: `⚠️ **Warning:** You are about to permanently delete **${matchedProject.project_title}** (${matchedProject.project_number}).\n\nAre you sure?`,
        pendingAction: preview,
      };
    }

    if (lower.startsWith('delete task') || lower.startsWith('remove task')) {
      const cleanTaskName = lower.replace(/^(?:delete|remove)\s+task\s+/i, '').trim();
      const matchedTask = ctx.visibleTasks.find((t) => t.title.toLowerCase().includes(cleanTaskName) || cleanTaskName.includes(t.title.toLowerCase()));

      if (!matchedTask) {
        return {
          success: false,
          toolName: 'delete_task',
          error: 'task_not_found',
          spokenText: "I couldn't find the task to delete.",
          displayText: '❌ Task not found.',
        };
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'delete_task',
        category: 'destructive',
        title: 'Delete Task',
        description: `Delete task "${matchedTask.title}"`,
        targetType: 'task',
        targetId: matchedTask.id,
        targetTitle: matchedTask.title,
        changes: [{ field: 'task', label: 'Task', oldValue: matchedTask.title, newValue: 'DELETED' }],
        payload: { taskId: matchedTask.id },
        confirmButtonText: 'Yes, Delete Task',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Delete task "${matchedTask.title}"? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'delete_task',
        spokenText: preview.spokenPrompt,
        displayText: `Delete task **"${matchedTask.title}"**?\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // A. REVISION REASSIGNMENT & ACTIONS
    // e.g. "Assign QAI Reformatting revision to Zain", "Give QAI revision to Zain", "Put Zain on the QAI revision"
    // ----------------------------------------------------
    if (
      lower.includes('revision') &&
      (lower.includes('assign') || lower.includes('give') || lower.includes('put ') || lower.includes('change')) &&
      this.containsEmployeeName(lower, ctx)
    ) {
      if (isClientRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'reassign_revision',
          error: 'permission_denied',
          spokenText: "I can't reassign revisions with client permissions.",
          displayText: "🔒 Revision assignments are restricted for client accounts.",
        };
      }

      const targetEmp = this.extractEmployeeFromQuery(lower, ctx);
      const targetEmpProfile = ctx.data.profiles.find((p) => p.full_name === targetEmp);
      const targetEmpName = targetEmpProfile ? firstName(targetEmpProfile.full_name) : 'the team member';

      // Find project associated with revision
      let matchedProject = this.findProjectInQueryOrMemory(lower, ctx);

      // Find matching revision request
      let matchedRevision = matchedProject
        ? ctx.data.revisionRequests.find((r) => r.project_id === matchedProject?.id)
        : ctx.data.revisionRequests[0];

      // If specific revision number mentioned, e.g. "revision #4"
      const revNumMatch = lower.match(/revision\s*(?:#|number\s*)?(\d+)/i);
      const revNum = revNumMatch ? revNumMatch[1] : '1';

      if (!matchedRevision && ctx.data.revisionRequests.length > 0) {
        matchedRevision = ctx.data.revisionRequests[0];
        matchedProject = ctx.data.projects.find((p) => p.id === matchedRevision?.project_id) || matchedProject;
      }

      if (!matchedRevision || !matchedProject || !targetEmpProfile) {
        return {
          success: false,
          toolName: 'reassign_revision',
          error: 'record_not_found',
          spokenText: "I couldn't identify the revision and employee to reassign to.",
          displayText: "❌ Please specify the project or revision and the team member.",
        };
      }

      const oldAssignee = ctx.data.profiles.find((p) => p.id === matchedRevision.assigned_to);
      const oldAssigneeName = oldAssignee ? oldAssignee.full_name : 'Unassigned';

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'reassign_revision',
        category: 'safe_write',
        title: 'Reassign Revision',
        description: `Reassign ${matchedProject.project_title} Revision #${revNum} to ${targetEmpProfile.full_name}`,
        targetType: 'revision',
        targetId: matchedRevision.id,
        targetTitle: `${matchedProject.project_title} (Revision #${revNum})`,
        clientName: matchedProject.client_name,
        assignedToName: targetEmpProfile.full_name,
        changes: [
          { field: 'project', label: 'Project', newValue: matchedProject.project_title },
          { field: 'revision', label: 'Revision', newValue: `Revision #${revNum}` },
          { field: 'assigned_to', label: 'Assignee', oldValue: oldAssigneeName, newValue: targetEmpProfile.full_name },
        ],
        payload: {
          requestId: matchedRevision.id,
          employeeId: targetEmpProfile.id,
        },
        confirmButtonText: 'Confirm Reassignment',
        cancelButtonText: 'Cancel',
        spokenPrompt: `${matchedProject.project_title} Revision #${revNum} is currently assigned to ${oldAssigneeName}. Should I reassign it to ${targetEmpName}?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'reassign_revision',
        spokenText: preview.spokenPrompt,
        displayText: `I found **${matchedProject.project_title} Revision #${revNum}** (currently assigned to ${oldAssigneeName}).\n\nWould you like me to reassign it to **${targetEmpProfile.full_name}**?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // B. CREATE TASK
    // e.g. "Create a task for Zain to check the revised print PDF tomorrow"
    // ----------------------------------------------------
    if (lower.startsWith('create a task') || lower.startsWith('create task') || lower.startsWith('add a task') || lower.startsWith('add task')) {
      if (isClientRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'create_task',
          error: 'permission_denied',
          spokenText: "I can't create tasks with client permissions.",
          displayText: "🔒 Task creation is restricted for client accounts.",
        };
      }

      // Extract Assignee
      const targetEmp = this.extractEmployeeFromQuery(lower, ctx);
      const targetEmpProfile = targetEmp ? ctx.data.profiles.find((p) => p.full_name === targetEmp) : ctx.currentProfile;
      const targetEmpName = targetEmpProfile ? firstName(targetEmpProfile.full_name) : 'you';

      // Extract Project (if mentioned or in memory)
      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);

      // Extract Date (e.g. tomorrow, Friday, Aug 30)
      const dateMatch = lower.match(/(?:due\s+|by\s+|on\s+)?(tomorrow|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\b\w+\s+\d{1,2}\b)/i);
      const dueDate = dateMatch ? parseNaturalDate(dateMatch[1]) : null;

      // Extract Task Title
      let taskTitle = q
        .replace(/^create\s+(a\s+)?task\s+(for\s+[a-zA-Z\s]+?\s+to\s+|for\s+[a-zA-Z\s]+?:\s*|to\s+|:\s*)/i, '')
        .replace(/\s+(tomorrow|today|by\s+[a-zA-Z0-9\s]+|due\s+[a-zA-Z0-9\s]+)\s*$/i, '')
        .trim();

      if (!taskTitle || taskTitle.length < 3) {
        taskTitle = 'Check project production files';
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'create_task',
        category: 'safe_write',
        title: 'Create Task',
        description: `Create new task assigned to ${targetEmpProfile?.full_name}`,
        targetType: 'task',
        targetTitle: taskTitle,
        assignedToName: targetEmpProfile?.full_name,
        changes: [
          { field: 'title', label: 'Task Title', newValue: taskTitle },
          { field: 'assigned_to', label: 'Assigned To', newValue: targetEmpProfile?.full_name || 'Self' },
          ...(matchedProject ? [{ field: 'project', label: 'Project', newValue: matchedProject.project_title }] : []),
          ...(dueDate ? [{ field: 'due_date', label: 'Due Date', newValue: formatDate(dueDate) }] : []),
        ],
        payload: {
          title: taskTitle,
          assignedToId: targetEmpProfile?.id || ctx.currentProfile.id,
          projectId: matchedProject?.id,
          dueDate: dueDate || undefined,
          priority: 'Normal',
        },
        confirmButtonText: 'Create Task',
        cancelButtonText: 'Cancel',
        spokenPrompt: `I'll create this task for ${targetEmpName}${matchedProject ? ` under ${matchedProject.project_title}` : ''}${dueDate ? `, due ${formatDate(dueDate)}` : ''}. Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'create_task',
        spokenText: preview.spokenPrompt,
        displayText: `I'll create the task **"${taskTitle}"** for **${targetEmpProfile?.full_name}**${matchedProject ? ` under *${matchedProject.project_title}*` : ''}${dueDate ? ` (Due: **${formatDate(dueDate)}**)` : ''}.`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // C. TASK STATUS (e.g. "Mark my QAI task as complete", "Mark print QC task complete", "Put this task on hold")
    // ----------------------------------------------------
    if (
      (lower.includes('mark') || lower.includes('set') || lower.includes('change')) &&
      (lower.includes('task') || lower.includes('tasks')) &&
      (lower.includes('complete') || lower.includes('done') || lower.includes('in progress') || lower.includes('on hold') || lower.includes('to do'))
    ) {
      if (isClientRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'update_task_status',
          error: 'permission_denied',
          spokenText: "I can't update tasks with client permissions.",
          displayText: "🔒 Task updates are restricted for client accounts.",
        };
      }

      const targetStatus = lower.includes('complete') || lower.includes('done')
        ? 'Done'
        : lower.includes('in progress')
          ? 'In Progress'
          : lower.includes('on hold')
            ? 'On Hold'
            : 'To Do';

      // Disambiguation check on matching tasks
      const matchingTasks = this.findMatchingTasks(q, ctx);

      if (matchingTasks.length === 0) {
        return {
          success: false,
          toolName: 'update_task_status',
          error: 'task_not_found',
          spokenText: "I couldn't find any task matching your description.",
          displayText: "❌ No matching task found.",
        };
      }

      if (matchingTasks.length > 1) {
        const options: DisambiguationOption[] = matchingTasks.map((t) => {
          const proj = ctx.data.projects.find((p) => p.id === t.project_id);
          return {
            id: t.id,
            title: t.title,
            subtitle: proj ? `Project: ${proj.project_title}` : `Status: ${t.status}`,
            type: 'task',
            data: { status: targetStatus },
          };
        });

        this.setPendingDisambiguation(options, { originalQuery: q, intentType: 'update_task_status', targetPayload: { status: targetStatus } });

        return {
          success: true,
          toolName: 'update_task_status',
          spokenText: `I found ${matchingTasks.length} tasks. Which one would you like to update?`,
          displayText: `I found **${matchingTasks.length} tasks** matching your request. Which one do you mean?`,
          disambiguation: options,
        };
      }

      const task = matchingTasks[0];
      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'update_task_status',
        category: 'safe_write',
        title: 'Update Task Status',
        description: `Change task "${task.title}" status to ${targetStatus}`,
        targetType: 'task',
        targetId: task.id,
        targetTitle: task.title,
        changes: [
          { field: 'status', label: 'Status', oldValue: task.status, newValue: targetStatus },
        ],
        payload: { taskId: task.id, status: targetStatus },
        confirmButtonText: `Mark as ${targetStatus}`,
        cancelButtonText: 'Cancel',
        spokenPrompt: `Mark task "${task.title}" as ${targetStatus}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'update_task_status',
        spokenText: preview.spokenPrompt,
        displayText: `Should I mark task **"${task.title}"** from *${task.status}* to **${targetStatus}**?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // D. PROJECT STATUS & STAGE ACTIONS
    // e.g. "Put Project BCH to Print Approval", "Put QAI Reformatting on hold", "Resume Book 2", "Move Book 2 to In Revision", "Change status for project BCH to Print approval", "Set project BCH to Print Approval"
    // ----------------------------------------------------
    const isProjectStatusIntent =
      !lower.includes('task') &&
      (((lower.includes('on hold') ||
        lower.includes('pause') ||
        lower.includes('resume') ||
        lower.includes('in revision') ||
        lower.includes('print approval') ||
        lower.includes('concept approval') ||
        lower.includes('ebook approval') ||
        lower.includes('approval') ||
        lower.includes('print version') ||
        lower.includes('design concept') ||
        lower.includes('ebook version') ||
        lower.includes('final delivery') ||
        lower.includes('completed') ||
        lower.includes('complete') ||
        lower.includes('mark complete') ||
        lower.includes('in progress')) &&
        (lower.includes('put ') ||
          lower.includes('move ') ||
          lower.includes('set ') ||
          lower.includes('change status') ||
          lower.includes('advance ') ||
          lower.includes('mark '))) ||
        (lower.includes('change') &&
          lower.includes('status') &&
          (lower.includes('project') || this.containsProjectName(lower, ctx) || this.containsClientName(lower, ctx))));

    if (isProjectStatusIntent) {
      if (!isManagerRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'update_project_status',
          error: 'permission_denied',
          spokenText: 'Only managers and admins can change project statuses.',
          displayText: '🔒 Only managers and admins can change project statuses.',
        };
      }

      let targetStage: string | undefined = undefined;
      let targetStatus: ProjectStatus = 'In Progress';

      if (lower.includes('print approval')) {
        targetStage = 'Print Approval';
        targetStatus = 'Awaiting Client Approval';
      } else if (lower.includes('concept approval')) {
        targetStage = 'Concept Approval';
        targetStatus = 'Awaiting Client Approval';
      } else if (lower.includes('ebook approval')) {
        targetStage = 'eBook Approval';
        targetStatus = 'Awaiting Client Approval';
      } else if (
        lower.includes('awaiting approval') ||
        lower.includes('client approval') ||
        (lower.includes('approval') && (lower.includes('put') || lower.includes('move') || lower.includes('to')))
      ) {
        targetStage = 'Print Approval';
        targetStatus = 'Awaiting Client Approval';
      } else if (lower.includes('files received')) {
        targetStage = 'Files Received';
        targetStatus = 'Active';
      } else if (lower.includes('design concept')) {
        targetStage = 'Design Concept';
        targetStatus = 'In Progress';
      } else if (lower.includes('print version')) {
        targetStage = 'Print Version';
        targetStatus = 'In Progress';
      } else if (lower.includes('ebook version')) {
        targetStage = 'eBook Version';
        targetStatus = 'In Progress';
      } else if (lower.includes('final delivery')) {
        targetStage = 'Final Delivery';
        targetStatus = 'Final Delivery';
      } else if (lower.includes('on hold') || lower.includes('pause')) {
        targetStatus = 'On Hold';
      } else if (lower.includes('resume') || lower.includes('in progress')) {
        targetStatus = 'In Progress';
      } else if (lower.includes('in revision') || lower.includes('revision')) {
        targetStatus = 'In Revision';
      } else if (lower.includes('completed') || lower.includes('complete') || lower.includes('delivered')) {
        targetStatus = 'Completed';
      }

      let matchedProject = this.findProjectInQueryOrMemory(lower, ctx);

      // If no project title matched directly, check if query references a client name (e.g. "put Project BCH to...")
      if (!matchedProject) {
        const clientName = this.extractClientFromQuery(lower, ctx);
        if (clientName) {
          const clientProjects = ctx.data.projects.filter(
            (p) => p.client_name.toLowerCase() === clientName.toLowerCase(),
          );

          if (clientProjects.length === 1) {
            matchedProject = clientProjects[0];
          } else if (clientProjects.length > 1) {
            const options: DisambiguationOption[] = clientProjects.map((p) => ({
              id: p.id,
              title: p.project_title,
              subtitle: `${p.project_number} • Stage: ${p.current_stage || p.status}`,
              type: 'project',
              data: { projectId: p.id, status: targetStatus, currentStage: targetStage },
            }));

            this.setPendingDisambiguation(options, {
              originalQuery: q,
              intentType: 'update_project_status',
              targetPayload: { status: targetStatus, currentStage: targetStage },
            });

            return {
              success: true,
              toolName: 'update_project_status',
              spokenText: `I found ${clientProjects.length} projects for ${clientName}. Which one would you like to move to ${targetStage || targetStatus}?`,
              displayText: `I found **${clientProjects.length} projects for ${clientName}**. Which one would you like to move to **${targetStage || targetStatus}**?`,
              disambiguation: options,
            };
          }
        }
      }

      if (!matchedProject) {
        return {
          success: false,
          toolName: 'update_project_status',
          error: 'project_not_found',
          spokenText: "I couldn't find the project to change status for.",
          displayText: '❌ Project not found.',
        };
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'update_project_status',
        category: 'high_risk',
        title: 'Change Project Status / Stage',
        description: `Change ${matchedProject.project_title} to ${targetStage || targetStatus}`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        clientName: matchedProject.client_name,
        changes: [
          { field: 'project', label: 'Project', newValue: matchedProject.project_title },
          ...(targetStage ? [{ field: 'stage', label: 'Stage', oldValue: matchedProject.current_stage || 'None', newValue: targetStage }] : []),
          { field: 'status', label: 'Status', oldValue: matchedProject.status, newValue: targetStatus },
        ],
        payload: { projectId: matchedProject.id, status: targetStatus, currentStage: targetStage },
        confirmButtonText: `Set to ${targetStage || targetStatus}`,
        cancelButtonText: 'Cancel',
        spokenPrompt: `Move ${matchedProject.project_title} to ${targetStage || targetStatus}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'update_project_status',
        spokenText: preview.spokenPrompt,
        displayText: `Move **${matchedProject.project_title}** to **${targetStage || targetStatus}**?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // E. PROJECT DEADLINE (e.g. "Move QAI Reformatting deadline to August 30", "Set Book 2 due date to Friday")
    // ----------------------------------------------------
    if (
      (lower.includes('deadline') || lower.includes('due date')) &&
      (lower.includes('move') || lower.includes('set') || lower.includes('change') || lower.includes('extend')) &&
      !lower.includes('task')
    ) {
      if (!isManagerRole(ctx.currentProfile.role)) {
        return {
          success: false,
          toolName: 'update_project_due_date',
          error: 'permission_denied',
          spokenText: "Only managers and admins can change project deadlines.",
          displayText: "🔒 Only managers and admins can change project deadlines.",
        };
      }

      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);
      if (!matchedProject) {
        return {
          success: false,
          toolName: 'update_project_due_date',
          error: 'project_not_found',
          spokenText: "I couldn't find the project to change deadline for.",
          displayText: "❌ Project not found.",
        };
      }

      const dateMatch = lower.match(/(?:to\s+|on\s+)?(tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\b[a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b)/i);
      const parsedDueDate = dateMatch ? parseNaturalDate(dateMatch[1]) : null;

      if (!parsedDueDate) {
        return {
          success: false,
          toolName: 'update_project_due_date',
          error: 'invalid_date',
          spokenText: "I couldn't understand the new deadline date.",
          displayText: "❌ Could not parse new due date.",
        };
      }

      const oldDate = matchedProject.due_date ? formatDate(matchedProject.due_date) : 'None';
      const newDate = formatDate(parsedDueDate);

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'update_project_due_date',
        category: 'high_risk',
        title: 'Update Project Deadline',
        description: `Change deadline for ${matchedProject.project_title} to ${newDate}`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        clientName: matchedProject.client_name,
        changes: [
          { field: 'due_date', label: 'Due Date', oldValue: oldDate, newValue: newDate },
        ],
        payload: { projectId: matchedProject.id, dueDate: parsedDueDate },
        confirmButtonText: 'Change Deadline',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Should I change the deadline for ${matchedProject.project_title} from ${oldDate} to ${newDate}?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'update_project_due_date',
        spokenText: preview.spokenPrompt,
        displayText: `### Change Project Deadline\n\n• **Project:** ${matchedProject.project_title}\n• **Current Due Date:** ${oldDate}\n• **New Due Date:** **${newDate}**\n\nShould I change the project deadline?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // F. MILESTONE APPROVAL (e.g. "Approve QAI's print version", "Approve design concept for Book 2")
    // ----------------------------------------------------
    if (lower.startsWith('approve ') && (lower.includes('concept') || lower.includes('print') || lower.includes('ebook') || lower.includes('version'))) {
      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);
      if (!matchedProject) {
        return {
          success: false,
          toolName: 'approve_project_milestone',
          error: 'project_not_found',
          spokenText: "I couldn't find the project to approve.",
          displayText: "❌ Project not found.",
        };
      }

      const milestone: 'concept' | 'print' | 'ebook' = lower.includes('concept')
        ? 'concept'
        : lower.includes('ebook')
          ? 'ebook'
          : 'print';

      const milestoneLabel = milestone === 'concept' ? 'Design Concept' : milestone === 'print' ? 'Print Version' : 'eBook Version';

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'approve_project_milestone',
        category: 'high_risk',
        title: `Approve ${milestoneLabel}`,
        description: `Approve ${milestoneLabel} milestone for ${matchedProject.project_title}`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        clientName: matchedProject.client_name,
        changes: [
          { field: 'stage', label: 'Milestone', oldValue: 'Pending Review', newValue: `Approved (${milestoneLabel})` },
        ],
        payload: { projectId: matchedProject.id, milestone },
        confirmButtonText: `Approve ${milestoneLabel}`,
        cancelButtonText: 'Cancel',
        spokenPrompt: `You are about to approve the ${milestoneLabel} for ${matchedProject.project_title}. Continue?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'approve_project_milestone',
        spokenText: preview.spokenPrompt,
        displayText: `You are about to approve the **${milestoneLabel}** for **${matchedProject.project_title}** on behalf of ${ctx.currentProfile.full_name}.\n\nContinue?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // G. FINANCE & EXPENSE / INCOME ACTIONS
    // e.g. "Record a $100 payment from BCH", "Add a Rs. 5,000 office expense", "Record $300 income"
    // ----------------------------------------------------
    if (
      (lower.includes('record') || lower.includes('add')) &&
      (lower.includes('expense') || lower.includes('income') || lower.includes('payment')) &&
      !lower.includes('salary') &&
      !lower.includes('advance') &&
      !lower.includes('deduction')
    ) {
      if (ctx.currentProfile.role !== 'admin') {
        return {
          success: false,
          toolName: 'record_income',
          error: 'permission_denied',
          spokenText: "Only administrators can record financial transactions.",
          displayText: "🔒 Financial records are restricted to administrators.",
        };
      }

      const amountMatch = lower.match(/(?:\$|rs\.?|usd|pkr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
      const rawAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 100;
      const currency = lower.includes('rs') || lower.includes('pkr') ? 'PKR' : 'USD';
      const isExpense = lower.includes('expense') || lower.includes('spent');
      const categoryMatch = lower.match(/(?:for|category)\s+([a-zA-Z\s]+)/i);
      const category = categoryMatch ? categoryMatch[1].trim() : isExpense ? 'Office' : 'Client Payment';

      const amountFormatted = ctx.formatMoney(rawAmount, currency);

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: isExpense ? 'record_expense' : 'record_income',
        category: 'high_risk',
        title: isExpense ? 'Record Expense' : 'Record Income',
        description: `Record ${amountFormatted} ${isExpense ? 'expense' : 'income'} entry`,
        targetType: 'finance',
        targetTitle: `${isExpense ? 'Expense' : 'Income'}: ${category}`,
        changes: [
          { field: 'type', label: 'Type', newValue: isExpense ? 'Expense' : 'Income' },
          { field: 'amount', label: 'Amount', newValue: amountFormatted },
          { field: 'category', label: 'Category', newValue: category },
          { field: 'date', label: 'Date', newValue: formatDate(todayInput()) },
        ],
        payload: {
          amount: rawAmount,
          currency,
          category,
          transactionDate: todayInput(),
        },
        confirmButtonText: isExpense ? 'Save Expense' : 'Save Income',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Record ${isExpense ? 'expense' : 'income'} of ${amountFormatted} for ${category}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: isExpense ? 'record_expense' : 'record_income',
        spokenText: preview.spokenPrompt,
        displayText: `### Record ${isExpense ? 'Expense' : 'Income'}\n\n• **Amount:** **${amountFormatted}**\n• **Category:** ${category}\n• **Date:** ${formatDate(todayInput())}\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // H. PAYROLL ACTIONS (e.g. "Record Zain's salary payment of $500", "Add a $100 advance for Hamza")
    // ----------------------------------------------------
    if (
      (lower.includes('salary') || lower.includes('advance') || lower.includes('deduction') || lower.includes('payroll')) &&
      (lower.includes('record') || lower.includes('add') || lower.includes('pay'))
    ) {
      if (ctx.currentProfile.role !== 'admin') {
        return {
          success: false,
          toolName: 'record_payroll_payment',
          error: 'permission_denied',
          spokenText: "You don't have permission to change payroll information.",
          displayText: "🔒 Payroll modifications are restricted to administrators.",
        };
      }

      const targetEmp = this.extractEmployeeFromQuery(lower, ctx);
      const targetEmpProfile = targetEmp ? ctx.data.profiles.find((p) => p.full_name === targetEmp) : null;

      if (!targetEmpProfile) {
        return {
          success: false,
          toolName: 'record_payroll_payment',
          error: 'employee_not_found',
          spokenText: "I couldn't identify the employee for this payroll entry.",
          displayText: "❌ Please specify the employee name.",
        };
      }

      const amountMatch = lower.match(/(?:\$|rs\.?|usd|pkr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
      const rawAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 500;
      const currency = lower.includes('rs') || lower.includes('pkr') ? 'PKR' : 'USD';
      const isAdvance = lower.includes('advance');
      const isDeduction = lower.includes('deduction');
      const entryType: 'Salary' | 'Advance' | 'Deduction' = isAdvance ? 'Advance' : isDeduction ? 'Deduction' : 'Salary';

      const toolName: AIToolName = isAdvance ? 'add_payroll_advance' : isDeduction ? 'add_payroll_deduction' : 'record_payroll_payment';

      const amountFormatted = ctx.formatMoney(rawAmount, currency);

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName,
        category: 'high_risk',
        title: `Record Payroll ${entryType}`,
        description: `Record ${amountFormatted} ${entryType.toLowerCase()} for ${targetEmpProfile.full_name}`,
        targetType: 'payroll',
        targetId: targetEmpProfile.id,
        targetTitle: targetEmpProfile.full_name,
        assignedToName: targetEmpProfile.full_name,
        changes: [
          { field: 'employee', label: 'Employee', newValue: targetEmpProfile.full_name },
          { field: 'entry_type', label: 'Entry Type', newValue: entryType },
          { field: 'amount', label: 'Amount', newValue: amountFormatted },
          { field: 'date', label: 'Date', newValue: formatDate(todayInput()) },
        ],
        payload: {
          employeeId: targetEmpProfile.id,
          amount: rawAmount,
          currency,
          salaryMonth: todayInput().slice(0, 7),
        },
        confirmButtonText: `Save ${entryType}`,
        cancelButtonText: 'Cancel',
        spokenPrompt: `Record ${entryType.toLowerCase()} of ${amountFormatted} for ${firstName(targetEmpProfile.full_name)}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName,
        spokenText: preview.spokenPrompt,
        displayText: `### Record Payroll ${entryType}\n\n• **Employee:** **${targetEmpProfile.full_name}**\n• **Amount:** **${amountFormatted}**\n• **Type:** ${entryType}\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // I. PROJECT NOTES (e.g. "Add a note to QAI Reformatting: VIP client requested extra proofs")
    // ----------------------------------------------------
    if (lower.includes('note') && (lower.includes('add') || lower.includes('write')) && (lower.includes('to ') || lower.includes('for '))) {
      const matchedProject = this.findProjectInQueryOrMemory(lower, ctx);
      if (!matchedProject) {
        return {
          success: false,
          toolName: 'add_project_note',
          error: 'project_not_found',
          spokenText: "I couldn't identify the project to add a note to.",
          displayText: "❌ Project not found.",
        };
      }

      const noteText = q.replace(/^.*?note\s+(?:to|for)\s+[a-zA-Z0-9\s]+?:\s*/i, '').trim();
      const isInternal = lower.includes('internal');

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'add_project_note',
        category: 'safe_write',
        title: 'Add Project Note',
        description: `Add ${isInternal ? 'internal' : 'general'} note to ${matchedProject.project_title}`,
        targetType: 'project',
        targetId: matchedProject.id,
        targetTitle: matchedProject.project_title,
        changes: [
          { field: 'project', label: 'Project', newValue: matchedProject.project_title },
          { field: 'note', label: 'Note', newValue: noteText },
        ],
        payload: {
          projectId: matchedProject.id,
          noteType: isInternal ? 'internal' : 'general',
          note: noteText,
        },
        confirmButtonText: 'Add Note',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Add this note to ${matchedProject.project_title}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'add_project_note',
        spokenText: preview.spokenPrompt,
        displayText: `Add note to **${matchedProject.project_title}**:\n\n> "${noteText}"\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // J. COMMUNICATION (e.g. "Send Zain a message saying the revision is due tomorrow")
    // ----------------------------------------------------
    if (lower.startsWith('send ') && (lower.includes('message') || lower.includes('reminder') || lower.includes('saying'))) {
      const targetEmp = this.extractEmployeeFromQuery(lower, ctx);
      const targetEmpProfile = targetEmp ? ctx.data.profiles.find((p) => p.full_name === targetEmp) : null;

      const messageBody = q.replace(/^send\s+[a-zA-Z\s]+?\s+(?:a\s+)?(?:message|reminder)\s+(?:saying\s+|that\s+|:\s*)?/i, '').trim();

      if (!targetEmpProfile) {
        return {
          success: false,
          toolName: 'send_internal_message',
          error: 'recipient_not_found',
          spokenText: "I couldn't identify the recipient for this message.",
          displayText: "❌ Recipient not found.",
        };
      }

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'send_internal_message',
        category: 'high_risk',
        title: 'Send Message',
        description: `Send internal message to ${targetEmpProfile.full_name}`,
        targetType: 'message',
        targetId: targetEmpProfile.id,
        targetTitle: targetEmpProfile.full_name,
        assignedToName: targetEmpProfile.full_name,
        changes: [
          { field: 'to', label: 'To', newValue: targetEmpProfile.full_name },
          { field: 'message', label: 'Message', newValue: messageBody },
        ],
        payload: {
          recipientId: targetEmpProfile.id,
          body: messageBody,
        },
        confirmButtonText: 'Send Message',
        cancelButtonText: 'Cancel',
        spokenPrompt: `I've prepared this message for ${firstName(targetEmpProfile.full_name)}: "${messageBody}". Send it?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'send_internal_message',
        spokenText: preview.spokenPrompt,
        displayText: `I've prepared this message for **${targetEmpProfile.full_name}**:\n\n> "${messageBody}"\n\nSend it?`,
        pendingAction: preview,
      };
    }

    // ----------------------------------------------------
    // K. INVITE / ADD CLIENT (e.g. "Invite client John Doe with email john@gmail.com")
    // ----------------------------------------------------
    if (lower.startsWith('invite client') || lower.startsWith('add client')) {
      if (ctx.currentProfile.role !== 'admin') {
        return {
          success: false,
          toolName: 'invite_client',
          error: 'permission_denied',
          spokenText: 'Only administrators can invite or add clients.',
          displayText: '🔒 Client management is restricted to administrators.',
        };
      }

      const emailMatch = q.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const email = emailMatch ? emailMatch[1] : '';
      let clientName = q
        .replace(/^(?:invite\s+client|add\s+client)\s+/i, '')
        .replace(/(?:with\s+)?email\s+[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, '')
        .trim();

      if (!clientName) clientName = 'New Client';

      const preview: AIActionPreview = {
        actionId: `act-${Date.now()}`,
        toolName: 'invite_client',
        category: 'high_risk',
        title: 'Invite Client',
        description: `Add client access for ${clientName}`,
        targetType: 'message',
        targetTitle: clientName,
        changes: [
          { field: 'name', label: 'Client Name', newValue: clientName },
          { field: 'email', label: 'Email', newValue: email || 'No email provided' },
        ],
        payload: {
          full_name: clientName,
          email: email || `${clientName.toLowerCase().replace(/\s+/g, '')}@client.com`,
          project_ids: [],
        },
        confirmButtonText: 'Invite Client',
        cancelButtonText: 'Cancel',
        spokenPrompt: `Invite client ${clientName}${email ? ` at ${email}` : ''}? Confirm?`,
      };

      this.memory.pendingAction = preview;

      return {
        success: true,
        toolName: 'invite_client',
        spokenText: preview.spokenPrompt,
        displayText: `Invite client **${clientName}**${email ? ` (${email})` : ''}?\n\nConfirm?`,
        pendingAction: preview,
      };
    }

    return null;
  }

  // ==========================================
  // ACTION EXECUTION DISPATCHER
  // ==========================================

  public async executeAction(action: AIActionPreview, ctx: AIToolContext): Promise<AIToolResult> {
    switch (action.toolName) {
      case 'create_project':
        return safeActions.execute_create_project(action.payload as any, ctx);
      case 'duplicate_project':
        return safeActions.execute_duplicate_project(action.payload as any, ctx);
      case 'create_task':
        return safeActions.execute_create_task(action.payload as any, ctx);
      case 'update_task_status':
        return safeActions.execute_update_task_status(action.payload as any, ctx);
      case 'assign_task':
        return safeActions.execute_assign_task(action.payload as any, ctx);
      case 'update_task_due_date':
        return safeActions.execute_update_task_due_date(action.payload as any, ctx);
      case 'delete_task':
        return safeActions.execute_delete_task(action.payload as any, ctx);
      case 'update_project_status':
        return safeActions.execute_update_project_status(action.payload as any, ctx);
      case 'update_project_due_date':
        return safeActions.execute_update_project_due_date(action.payload as any, ctx);
      case 'assign_project':
        return safeActions.execute_assign_project(action.payload as any, ctx);
      case 'delete_project':
        return safeActions.execute_delete_project(action.payload as any, ctx);
      case 'reassign_revision':
        return safeActions.execute_reassign_revision(action.payload as any, ctx);
      case 'update_revision_status':
        return safeActions.execute_update_revision_status(action.payload as any, ctx);
      case 'add_project_note':
        return safeActions.execute_add_project_note(action.payload as any, ctx);
      case 'approve_project_milestone':
        return safeActions.execute_approve_project_milestone(action.payload as any, ctx);
      case 'invite_client':
        return safeActions.execute_invite_client(action.payload as any, ctx);
      case 'record_income':
        return safeActions.execute_record_income(action.payload as any, ctx);
      case 'record_expense':
        return safeActions.execute_record_expense(action.payload as any, ctx);
      case 'record_payroll_payment':
        return safeActions.execute_record_payroll_payment(action.payload as any, ctx);
      case 'add_payroll_advance':
        return safeActions.execute_add_payroll_advance(action.payload as any, ctx);
      case 'add_payroll_deduction':
        return safeActions.execute_add_payroll_deduction(action.payload as any, ctx);
      case 'send_internal_message':
        return safeActions.execute_send_internal_message(action.payload as any, ctx);
      case 'send_client_message':
        return safeActions.execute_send_client_message(action.payload as any, ctx);
      case 'generate_client_invoice':
        return safeActions.execute_generate_client_invoice(action.payload as any, ctx);
      default:
        return {
          success: false,
          toolName: action.toolName,
          error: 'unknown_tool',
          spokenText: "I couldn't execute that action.",
          displayText: `❌ Unknown action: ${action.toolName}`,
        };
    }
  }

  // ==========================================
  // DISAMBIGUATION HELPERS
  // ==========================================

  private matchDisambiguationOption(query: string, options: DisambiguationOption[]): DisambiguationOption | undefined {
    const q = query.trim().toLowerCase();
    // Match by number (e.g. "1", "#1", "first")
    if (q === '1' || q === '#1' || q === 'first' || q === 'first one') return options[0];
    if (q === '2' || q === '#2' || q === 'second' || q === 'second one') return options[1];
    if (q === '3' || q === '#3' || q === 'third' || q === 'third one') return options[2];
    if (q === '4' || q === '#4' || q === 'fourth') return options[3];

    // Match by title substring
    return options.find((opt) => opt.title.toLowerCase().includes(q) || q.includes(opt.title.toLowerCase()));
  }

  private async resolveDisambiguationSelection(
    selected: DisambiguationOption,
    context: any,
    ctx: AIToolContext,
  ): Promise<AIToolResult | null> {
    if (selected.type === 'task' && context?.intentType === 'update_task_status') {
      const task = ctx.data.tasks.find((t) => t.id === selected.id);
      if (task) {
        const targetStatus = selected.data?.status || 'Done';
        const preview: AIActionPreview = {
          actionId: `act-${Date.now()}`,
          toolName: 'update_task_status',
          category: 'safe_write',
          title: 'Update Task Status',
          description: `Change task "${task.title}" status to ${targetStatus}`,
          targetType: 'task',
          targetId: task.id,
          targetTitle: task.title,
          changes: [{ field: 'status', label: 'Status', oldValue: task.status, newValue: targetStatus }],
          payload: { taskId: task.id, status: targetStatus },
          confirmButtonText: `Mark as ${targetStatus}`,
          cancelButtonText: 'Cancel',
          spokenPrompt: `Mark task "${task.title}" as ${targetStatus}? Confirm?`,
        };

        this.memory.pendingAction = preview;

        return {
          success: true,
          toolName: 'update_task_status',
          spokenText: preview.spokenPrompt,
          displayText: `Should I mark task **"${task.title}"** from *${task.status}* to **${targetStatus}**?`,
          pendingAction: preview,
        };
      }
    }

    if (selected.type === 'project' && context?.intentType === 'update_project_status') {
      const project = ctx.data.projects.find((p) => p.id === selected.id);
      if (project) {
        const targetStatus = selected.data?.status || 'In Progress';
        const targetStage = selected.data?.currentStage;
        const targetLabel = targetStage || targetStatus;

        const preview: AIActionPreview = {
          actionId: `act-${Date.now()}`,
          toolName: 'update_project_status',
          category: 'high_risk',
          title: 'Change Project Status / Stage',
          description: `Change ${project.project_title} to ${targetLabel}`,
          targetType: 'project',
          targetId: project.id,
          targetTitle: project.project_title,
          clientName: project.client_name,
          changes: [
            { field: 'project', label: 'Project', newValue: project.project_title },
            ...(targetStage ? [{ field: 'stage', label: 'Stage', oldValue: project.current_stage || 'None', newValue: targetStage }] : []),
            { field: 'status', label: 'Status', oldValue: project.status, newValue: targetStatus },
          ],
          payload: { projectId: project.id, status: targetStatus, currentStage: targetStage },
          confirmButtonText: `Set to ${targetLabel}`,
          cancelButtonText: 'Cancel',
          spokenPrompt: `Move ${project.project_title} to ${targetLabel}? Confirm?`,
        };

        this.memory.pendingAction = preview;

        return {
          success: true,
          toolName: 'update_project_status',
          spokenText: preview.spokenPrompt,
          displayText: `Move **${project.project_title}** to **${targetLabel}**?`,
          pendingAction: preview,
        };
      }
    }
    return null;
  }

  private findMatchingTasks(query: string, ctx: AIToolContext) {
    const cleanQuery = query
      .toLowerCase()
      .replace(/^mark\s+(my\s+|the\s+)?/i, '')
      .replace(/\s+(as\s+)?(complete|done|in progress|on hold|to do)\s*$/i, '')
      .replace(/\s+task\s*/i, ' ')
      .trim();

    return ctx.visibleTasks.filter((t) => {
      const titleLower = t.title.toLowerCase();
      return titleLower.includes(cleanQuery) || cleanQuery.includes(titleLower);
    });
  }

  // ==========================================
  // CONTEXT & MULTI-TURN RESOLUTION
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
          spokenText: 'There were no projects in your previous query.',
          displayText: 'There were no projects in your previous query.',
        };
      }

      const clientCounts: Record<string, number> = {};
      mem.lastProjects.forEach((p) => {
        const c = p.client_name || 'Other';
        clientCounts[c] = (clientCounts[c] || 0) + 1;
      });

      const entries = Object.entries(clientCounts);
      const breakdown = entries.map(([c, count]) => `${c} has ${count}`).join(', ');
      const spoken = entries.length === 1 ? `All ${mem.lastProjects.length} are for ${entries[0][0]}.` : `${breakdown}.`;

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
          spokenText: 'There were no projects in your previous query.',
          displayText: 'There were no projects in your previous query.',
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

    if (result.entities?.projects && result.entities.projects.length > 0) {
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
  // ENTITY EXTRACTION HELPERS
  // ==========================================

  private findProjectInQueryOrMemory(query: string, ctx: AIToolContext) {
    const qLower = query.toLowerCase();

    // Match in query
    for (const p of ctx.visibleProjects) {
      if (qLower.includes(p.project_title.toLowerCase()) || qLower.includes(p.project_number.toLowerCase())) {
        return p;
      }
    }

    // Match from memory if only 1 project in previous turn
    if (this.memory.lastProjects && this.memory.lastProjects.length === 1) {
      return this.memory.lastProjects[0];
    }

    return null;
  }

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
