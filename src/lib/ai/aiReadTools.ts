import type { AIToolContext, AIToolResult, ReadQueryPlan } from './aiTypes';
import { formatDate, isOverdue, daysUntil, isClosed, todayInput } from '../date';
import { isClientRole, isManagerRole } from '../utils';
import { checkReadPermission, sanitizeUntrustedData } from './aiSecurityBoundary';

/**
 * 1. Messages Read Tools
 */
export async function get_messages(
  senderQuery: string | undefined,
  keywordQuery: string | undefined,
  unreadOnly: boolean,
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const perm = checkReadPermission(ctx.currentProfile, 'messages');
  if (!perm.allowed) {
    return {
      success: false,
      toolName: 'get_messages',
      error: 'permission_denied',
      spokenText: "I can't access messages with your current permissions.",
      displayText: `🔒 ${perm.reason}`,
    };
  }

  const allMessages = ctx.data.messages || [];
  const currentUserId = ctx.currentProfile.id;

  // Filter messages accessible to current user (as sender or member of conversation or client)
  let accessible = allMessages;
  if (isClientRole(ctx.currentProfile.role)) {
    accessible = allMessages.filter(
      (m: any) => m.sender_id === currentUserId || m.recipient_id === currentUserId,
    );
  }

  if (senderQuery) {
    const q = senderQuery.toLowerCase();
    const sender = ctx.data.profiles.find(
      (p) => p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
    if (sender) {
      accessible = accessible.filter((m: any) => m.sender_id === sender.id || m.recipient_id === sender.id);
    }
  }

  if (keywordQuery) {
    const kw = keywordQuery.toLowerCase();
    accessible = accessible.filter((m: any) => ((m.body || m.message || '') as string).toLowerCase().includes(kw));
  }

  if (unreadOnly) {
    accessible = accessible.filter((m: any) => m.is_read === false && m.recipient_id === currentUserId);
  }

  if (accessible.length === 0) {
    const text = senderQuery
      ? `I couldn't find any messages from or to "${senderQuery}".`
      : keywordQuery
      ? `No messages found containing "${keywordQuery}".`
      : 'You have no new or matching messages.';
    return {
      success: true,
      toolName: 'get_messages',
      spokenText: text,
      displayText: text,
      count: 0,
      data: [],
    };
  }

  const latest = accessible.slice(0, 5);
  const latestBody = (latest[0] as any).body || (latest[0] as any).message || '';
  const spoken = `Found ${accessible.length} matching message${accessible.length === 1 ? '' : 's'}. Latest from ${ctx.data.profiles.find((p) => p.id === latest[0].sender_id)?.full_name || 'Team'}: "${sanitizeUntrustedData(latestBody).slice(0, 80)}".`;

  let display = `### Messages (${accessible.length})\n\n`;
  latest.forEach((m: any) => {
    const senderName = ctx.data.profiles.find((p) => p.id === m.sender_id)?.full_name || 'Team Member';
    const bodyStr = m.body || m.message || '';
    display += `• **${senderName}:** "${sanitizeUntrustedData(bodyStr)}" — *${formatDate(m.created_at)}*\n`;
  });

  return {
    success: true,
    toolName: 'get_messages',
    spokenText: spoken,
    displayText: display.trim(),
    count: accessible.length,
    data: accessible,
  };
}

/**
 * 2. Calendar Read Tools
 */
export async function get_calendar_events(
  dateFilter: 'today' | 'tomorrow' | 'this_week' | string | undefined,
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const perm = checkReadPermission(ctx.currentProfile, 'calendar');
  if (!perm.allowed) {
    return {
      success: false,
      toolName: 'get_calendar_events',
      error: 'permission_denied',
      spokenText: "I can't access the calendar with your current permissions.",
      displayText: `🔒 ${perm.reason}`,
    };
  }

  const todayStr = todayInput();
  const visibleProjects = ctx.visibleProjects;
  const visibleTasks = ctx.visibleTasks;

  let upcomingMilestones: Array<{ title: string; type: string; date: string; client: string }> = [];

  // Project deadlines as calendar events
  visibleProjects.forEach((p) => {
    if (p.due_date && !isClosed(p)) {
      upcomingMilestones.push({
        title: `Project Delivery: ${p.project_title}`,
        type: 'Project Deadline',
        date: p.due_date,
        client: p.client_name,
      });
    }
  });

  // Task due dates
  visibleTasks.forEach((t) => {
    if (t.due_date && t.status !== 'Done') {
      const proj = visibleProjects.find((p) => p.id === t.project_id);
      upcomingMilestones.push({
        title: `Task Due: ${t.title}`,
        type: 'Task Deadline',
        date: t.due_date,
        client: proj?.client_name || 'Internal',
      });
    }
  });

  // Filter by date
  if (dateFilter === 'today' || dateFilter === 'aaj') {
    upcomingMilestones = upcomingMilestones.filter((m) => m.date === todayStr);
  } else if (dateFilter === 'tomorrow' || dateFilter === 'kal') {
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    const tomStr = tom.toISOString().slice(0, 10);
    upcomingMilestones = upcomingMilestones.filter((m) => m.date === tomStr);
  }

  if (upcomingMilestones.length === 0) {
    const label = dateFilter ? dateFilter : 'today';
    const text = `You have no scheduled meetings or deadlines for ${label}.`;
    return {
      success: true,
      toolName: 'get_calendar_events',
      spokenText: text,
      displayText: text,
      count: 0,
    };
  }

  const spoken = `You have ${upcomingMilestones.length} event${upcomingMilestones.length === 1 ? '' : 's'} scheduled: ${upcomingMilestones.slice(0, 3).map((m) => m.title).join(', ')}.`;

  let display = `### Calendar Events & Deadlines (${upcomingMilestones.length})\n\n`;
  upcomingMilestones.forEach((m) => {
    display += `• **${m.title}** (${m.type}) — Date: ${formatDate(m.date)} | Client: **${m.client}**\n`;
  });

  return {
    success: true,
    toolName: 'get_calendar_events',
    spokenText: spoken,
    displayText: display.trim(),
    count: upcomingMilestones.length,
    data: upcomingMilestones,
  };
}

/**
 * 3. Employee Comparison & Performance Read Tool
 */
export async function compare_employees(
  emp1Query: string,
  emp2Query: string,
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const perm = checkReadPermission(ctx.currentProfile, 'employees');
  if (!perm.allowed) {
    return {
      success: false,
      toolName: 'compare_employees',
      error: 'permission_denied',
      spokenText: "I can't access employee metrics for comparison with your current permissions.",
      displayText: `🔒 ${perm.reason}`,
    };
  }

  const profiles = ctx.data.profiles.filter((p) => p.role !== 'client');
  const emp1 = profiles.find((p) => p.full_name.toLowerCase().includes(emp1Query.toLowerCase()));
  const emp2 = profiles.find((p) => p.full_name.toLowerCase().includes(emp2Query.toLowerCase()));

  const name1 = emp1?.full_name || emp1Query;
  const name2 = emp2?.full_name || emp2Query;

  const tasks1 = ctx.data.tasks.filter((t) => (emp1 ? t.assigned_to === emp1.id : false));
  const tasks2 = ctx.data.tasks.filter((t) => (emp2 ? t.assigned_to === emp2.id : false));

  const completed1 = tasks1.filter((t) => t.status === 'Done').length;
  const completed2 = tasks2.filter((t) => t.status === 'Done').length;

  const pending1 = tasks1.filter((t) => t.status !== 'Done').length;
  const pending2 = tasks2.filter((t) => t.status !== 'Done').length;

  const overdue1 = tasks1.filter((t) => t.due_date && daysUntil(t.due_date) < 0 && t.status !== 'Done').length;
  const overdue2 = tasks2.filter((t) => t.due_date && daysUntil(t.due_date) < 0 && t.status !== 'Done').length;

  const spoken = `Comparing ${name1} and ${name2}: ${name1} has ${pending1} pending and ${completed1} completed tasks. ${name2} has ${pending2} pending and ${completed2} completed tasks.`;

  let display = `### Employee Performance Comparison\n\n`;
  display += `| Metric | **${name1}** | **${name2}** |\n`;
  display += `| :--- | :---: | :---: |\n`;
  display += `| **Active Pending Tasks** | ${pending1} | ${pending2} |\n`;
  display += `| **Completed Tasks** | ${completed1} | ${completed2} |\n`;
  display += `| **Overdue Tasks** | ${overdue1} | ${overdue2} |\n`;
  display += `| **Total Tasks** | ${tasks1.length} | ${tasks2.length} |\n`;

  return {
    success: true,
    toolName: 'compare_employees',
    spokenText: spoken,
    displayText: display.trim(),
    data: {
      subject1: { name: name1, pending: pending1, completed: completed1, overdue: overdue1 },
      subject2: { name: name2, pending: pending2, completed: completed2, overdue: overdue2 },
    },
  };
}

/**
 * 4. Multi-Currency Finance Outstanding Read Tool
 */
export async function get_outstanding_amounts(ctx: AIToolContext): Promise<AIToolResult> {
  const perm = checkReadPermission(ctx.currentProfile, 'finance');
  if (!perm.allowed) {
    return {
      success: false,
      toolName: 'get_outstanding_amounts',
      error: 'permission_denied',
      spokenText: "I can't access financial balances with your current permissions.",
      displayText: `🔒 ${perm.reason}`,
    };
  }

  const projects = ctx.visibleProjects;
  const currencyTotals: Record<string, number> = {};

  projects.forEach((p) => {
    const bal = p.remaining_balance || 0;
    if (bal > 0) {
      const curr = (p as any).currency || 'USD';
      currencyTotals[curr] = (currencyTotals[curr] || 0) + bal;
    }
  });

  const currencyEntries = Object.entries(currencyTotals);
  if (currencyEntries.length === 0) {
    const text = 'There are no outstanding balances. All accounts are settled.';
    return {
      success: true,
      toolName: 'get_outstanding_amounts',
      spokenText: text,
      displayText: text,
      count: 0,
    };
  }

  const spokenParts = currencyEntries.map(
    ([curr, amount]) => `${ctx.formatMoney(amount, curr as any)} ${curr}`,
  );
  const spoken = `Total outstanding balance is ${spokenParts.join(' and ')}. I have kept the currencies distinct.`;

  let display = `### Outstanding Balances by Currency\n\n`;
  currencyEntries.forEach(([curr, amount]) => {
    display += `• **${curr}:** ${ctx.formatMoney(amount, curr as any)}\n`;
  });

  return {
    success: true,
    toolName: 'get_outstanding_amounts',
    spokenText: spoken,
    displayText: display.trim(),
    data: currencyTotals,
  };
}

/**
 * 5. Cross-Module Multi-Resource Reader
 */
export async function run_cross_module_query(
  plan: ReadQueryPlan,
  ctx: AIToolContext,
): Promise<AIToolResult> {
  const secondary = plan.secondaryResources;

  // Cross-Module Scenario 1: Clients with Overdue Invoices + Active Projects
  if (plan.filters.isOverdue && plan.secondaryResources.includes('clients')) {
    const overdueProjects = ctx.visibleProjects.filter((p) => isOverdue(p) || (p.remaining_balance > 0));
    const clientSet = Array.from(new Set(overdueProjects.map((p) => p.client_name)));

    const spoken = `Found ${clientSet.length} client${clientSet.length === 1 ? '' : 's'} with overdue projects or outstanding balances: ${clientSet.slice(0, 3).join(', ')}.`;

    let display = `### Cross-Module Query: Clients with Overdue Items (${clientSet.length})\n\n`;
    clientSet.forEach((client) => {
      const projs = overdueProjects.filter((p) => p.client_name === client);
      const totalBal = projs.reduce((sum, p) => sum + (p.remaining_balance || 0), 0);
      display += `• **${client}:** ${projs.length} active/overdue projects | Outstanding: **${ctx.formatMoney(totalBal)}**\n`;
    });

    return {
      success: true,
      toolName: 'run_cross_module_query',
      spokenText: spoken,
      displayText: display.trim(),
      count: clientSet.length,
      data: { clients: clientSet, projects: overdueProjects },
    };
  }

  // Fallback to project summary if generic cross-module
  const projects = ctx.visibleProjects.filter((p) => !isClosed(p));
  const text = `Found ${projects.length} active project${projects.length === 1 ? '' : 's'} matching your cross-module query context.`;

  return {
    success: true,
    toolName: 'run_cross_module_query',
    spokenText: text,
    displayText: `### Cross-Module Insights\n\n${text}`,
    count: projects.length,
    entities: { projects },
  };
}
