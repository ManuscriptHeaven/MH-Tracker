import type { AIToolContext, AIToolName, AIToolResult } from './aiTypes';
import type { Project, Task, Profile, Role } from '../types';
import { daysUntil, formatDate, isClosed, isDueToday, isDueThisWeek, isOverdue, todayInput } from '../date';
import { isClientRole, isManagerRole } from '../utils';
import { isClientApprovalStage } from '../timeline';

// ==========================================
// Helper Utilities for Secure Data Access
// ==========================================

function sanitizeClientFacing(text: string): string {
  return text.replace(/\b(internal|cost|payroll|salary|profit|margin)\b/gi, '').trim();
}

function findMatchingProjects(query: string, projects: Project[]): Project[] {
  const q = query.toLowerCase().trim();
  if (!q) return projects;

  // Exact match on project number or title
  const exact = projects.filter(
    (p) => p.project_number.toLowerCase() === q || p.project_title.toLowerCase() === q,
  );
  if (exact.length > 0) return exact;

  // Partial match on title, project_number, or client_name
  return projects.filter(
    (p) =>
      p.project_title.toLowerCase().includes(q) ||
      p.project_number.toLowerCase().includes(q) ||
      p.client_name.toLowerCase().includes(q),
  );
}

function findMatchingEmployee(query: string, profiles: Profile[]): Profile | undefined {
  const q = query.toLowerCase().trim();
  const teamProfiles = profiles.filter((p) => p.role !== 'client');

  // Exact match first
  let match = teamProfiles.find(
    (p) => p.full_name.toLowerCase() === q || p.id.toLowerCase() === q || p.email.toLowerCase() === q,
  );
  if (match) return match;

  // First name match
  match = teamProfiles.find((p) => {
    const first = p.full_name.split(' ')[0].toLowerCase();
    return first === q || q.includes(first);
  });
  if (match) return match;

  // Partial match
  return teamProfiles.find((p) => p.full_name.toLowerCase().includes(q));
}

function findMatchingClient(query: string, projects: Project[], profiles: Profile[]): string | undefined {
  const q = query.toLowerCase().trim();
  const clientNames = Array.from(new Set(projects.map((p) => p.client_name).filter(Boolean)));

  // Exact match
  let match = clientNames.find((name) => name.toLowerCase() === q);
  if (match) return match;

  // Partial match
  match = clientNames.find((name) => name.toLowerCase().includes(q) || q.includes(name.toLowerCase()));
  if (match) return match;

  // Client profiles match
  const clientProfile = profiles.find(
    (p) => isClientRole(p.role) && (p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
  );
  return clientProfile?.full_name;
}

// ==========================================
// 18 Controlled Read-Only Query Functions
// ==========================================

export async function get_project_summary(ctx: AIToolContext): Promise<AIToolResult> {
  const projects = ctx.visibleProjects;
  const active = projects.filter((p) => !isClosed(p));
  const overdue = projects.filter((p) => isOverdue(p));
  const dueToday = projects.filter((p) => isDueToday(p));
  const dueThisWeek = projects.filter((p) => isDueThisWeek(p));
  const inRevision = projects.filter(
    (p) =>
      p.status === 'In Revision' ||
      p.current_stage === 'Concept Revisions' ||
      p.current_stage === 'Print Revisions',
  );
  const awaitingApproval = projects.filter(
    (p) => p.status === 'Awaiting Client Approval' || isClientApprovalStage(p.current_stage),
  );
  const completed = projects.filter((p) => isClosed(p));

  const spoken = `You have ${active.length} active project${active.length === 1 ? '' : 's'}: ${overdue.length} overdue, ${dueToday.length} due today, ${inRevision.length} in revision, and ${awaitingApproval.length} awaiting client approval.`;

  let display = `### Project Summary\n\n`;
  display += `• **Active Projects:** ${active.length}\n`;
  display += `• **Overdue:** ${overdue.length}\n`;
  display += `• **Due Today:** ${dueToday.length}\n`;
  display += `• **Due This Week:** ${dueThisWeek.length}\n`;
  display += `• **In Revision:** ${inRevision.length}\n`;
  display += `• **Awaiting Client Approval:** ${awaitingApproval.length}\n`;
  display += `• **Completed / Delivered:** ${completed.length}\n`;

  return {
    success: true,
    toolName: 'get_project_summary',
    spokenText: spoken,
    displayText: display,
    count: active.length,
    data: {
      activeCount: active.length,
      overdueCount: overdue.length,
      dueTodayCount: dueToday.length,
      dueThisWeekCount: dueThisWeek.length,
      inRevisionCount: inRevision.length,
      awaitingApprovalCount: awaitingApproval.length,
      completedCount: completed.length,
    },
    entities: {
      projects: active,
    },
  };
}

export async function get_overdue_projects(ctx: AIToolContext, clientNameFilter?: string): Promise<AIToolResult> {
  let overdue = ctx.visibleProjects.filter((p) => isOverdue(p));

  if (clientNameFilter) {
    const q = clientNameFilter.toLowerCase();
    overdue = overdue.filter((p) => p.client_name.toLowerCase().includes(q));
  }

  if (overdue.length === 0) {
    const text = clientNameFilter
      ? `I don't see any overdue projects for ${clientNameFilter}.`
      : `I don't see any overdue projects. Everything is currently on schedule!`;
    return {
      success: true,
      toolName: 'get_overdue_projects',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  // Group by client
  const clientCounts: Record<string, number> = {};
  const clientProjects: Record<string, Project[]> = {};
  overdue.forEach((p) => {
    const c = p.client_name || 'Unassigned Client';
    clientCounts[c] = (clientCounts[c] || 0) + 1;
    if (!clientProjects[c]) clientProjects[c] = [];
    clientProjects[c].push(p);
  });

  const clientEntries = Object.entries(clientCounts);
  let spokenBreakdown = '';
  if (clientEntries.length === 1) {
    const [client, count] = clientEntries[0];
    const projectNames = clientProjects[client].map((p) => p.project_title).join(', ');
    spokenBreakdown = `${client} has ${count} overdue project${count === 1 ? '' : 's'}: ${projectNames}.`;
  } else {
    const breakdownList = clientEntries.map(([client, count]) => `${client} has ${count}`);
    spokenBreakdown = breakdownList.slice(0, -1).join(', ') + (breakdownList.length > 1 ? ', and ' : '') + breakdownList.slice(-1);
  }

  const spoken = clientNameFilter
    ? `You have ${overdue.length} overdue project${overdue.length === 1 ? '' : 's'} for ${clientNameFilter}: ${overdue.map((p) => p.project_title).join(', ')}.`
    : `You have ${overdue.length} overdue project${overdue.length === 1 ? '' : 's'}: ${spokenBreakdown}.`;

  let display = `### Overdue Projects (${overdue.length})\n\n`;
  for (const [client, projs] of Object.entries(clientProjects)) {
    display += `**${client}** (${projs.length}):\n`;
    projs.forEach((p) => {
      const days = Math.abs(daysUntil(p.due_date));
      display += `• **${p.project_title}** (${p.project_number}) — *${p.current_stage || p.status}* — ${days} day${days === 1 ? '' : 's'} overdue (Due: ${formatDate(p.due_date)})\n`;
    });
    display += `\n`;
  }

  return {
    success: true,
    toolName: 'get_overdue_projects',
    spokenText: spoken,
    displayText: display.trim(),
    count: overdue.length,
    entities: {
      projects: overdue,
      clients: Object.keys(clientCounts),
    },
  };
}

export async function get_due_today_projects(ctx: AIToolContext): Promise<AIToolResult> {
  const dueToday = ctx.visibleProjects.filter((p) => isDueToday(p));

  if (dueToday.length === 0) {
    const text = 'No projects are due today.';
    return {
      success: true,
      toolName: 'get_due_today_projects',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const projectTitles = dueToday.map((p) => `${p.project_title} for ${p.client_name}`).join(', ');
  const spoken = `You have ${dueToday.length} project${dueToday.length === 1 ? '' : 's'} due today: ${projectTitles}.`;

  let display = `### Projects Due Today (${dueToday.length})\n\n`;
  dueToday.forEach((p) => {
    display += `• **${p.project_title}** (${p.project_number}) — Client: **${p.client_name}** — Stage: *${p.current_stage || p.status}*\n`;
  });

  return {
    success: true,
    toolName: 'get_due_today_projects',
    spokenText: spoken,
    displayText: display.trim(),
    count: dueToday.length,
    entities: { projects: dueToday },
  };
}

export async function get_due_this_week_projects(ctx: AIToolContext): Promise<AIToolResult> {
  const dueThisWeek = ctx.visibleProjects.filter((p) => isDueThisWeek(p));

  if (dueThisWeek.length === 0) {
    const text = 'No projects are due this week.';
    return {
      success: true,
      toolName: 'get_due_this_week_projects',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `You have ${dueThisWeek.length} project${dueThisWeek.length === 1 ? '' : 's'} due within the next 7 days.`;

  let display = `### Projects Due This Week (${dueThisWeek.length})\n\n`;
  dueThisWeek.forEach((p) => {
    const days = daysUntil(p.due_date);
    const leftText = days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
    display += `• **${p.project_title}** (${p.client_name}) — Due ${formatDate(p.due_date)} (*${leftText}*) — Stage: *${p.current_stage || p.status}*\n`;
  });

  return {
    success: true,
    toolName: 'get_due_this_week_projects',
    spokenText: spoken,
    displayText: display.trim(),
    count: dueThisWeek.length,
    entities: { projects: dueThisWeek },
  };
}

export async function get_projects_by_client(clientQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  const clientName = findMatchingClient(clientQuery, ctx.visibleProjects, ctx.data.profiles) || clientQuery;

  // RBAC check: Client can only view their own projects
  if (isClientRole(ctx.currentProfile.role)) {
    const myName = (ctx.currentProfile.full_name || '').toLowerCase();
    if (!myName.includes(clientName.toLowerCase()) && !clientName.toLowerCase().includes(myName)) {
      return {
        success: false,
        toolName: 'get_projects_by_client',
        error: 'permission_denied',
        spokenText: "I can't access that information with your current permissions.",
        displayText: "🔒 I can't access other clients' information with your current permissions.",
      };
    }
  }

  const clientProjects = ctx.visibleProjects.filter(
    (p) => p.client_name.toLowerCase().includes(clientName.toLowerCase()) || clientName.toLowerCase().includes(p.client_name.toLowerCase()),
  );

  if (clientProjects.length === 0) {
    const text = `I don't see any projects for client "${clientName}".`;
    return {
      success: true,
      toolName: 'get_projects_by_client',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const active = clientProjects.filter((p) => !isClosed(p));
  const spoken = active.length > 0
    ? `${clientName} has ${active.length} active project${active.length === 1 ? '' : 's'}: ${active.map((p) => p.project_title).join(', ')}.`
    : `${clientName} has ${clientProjects.length} completed project${clientProjects.length === 1 ? '' : 's'}.`;

  let display = `### Projects for ${clientName} (${clientProjects.length})\n\n`;
  clientProjects.forEach((p) => {
    display += `• **${p.project_title}** (${p.project_number}) — Status: **${p.status}** | Stage: *${p.current_stage || 'N/A'}* | Due: ${formatDate(p.due_date)}\n`;
  });

  return {
    success: true,
    toolName: 'get_projects_by_client',
    spokenText: spoken,
    displayText: display.trim(),
    count: clientProjects.length,
    entities: {
      projects: clientProjects,
      clients: [clientName],
    },
  };
}

export async function get_projects_by_employee(employeeQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  // RBAC check: Clients cannot query internal employee assignments
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'get_projects_by_employee',
      error: 'permission_denied',
      spokenText: "I can't access internal team assignments with your client permissions.",
      displayText: "🔒 Internal team assignments are restricted for client accounts.",
    };
  }

  const employee = findMatchingEmployee(employeeQuery, ctx.data.profiles);
  const employeeName = employee?.full_name || employeeQuery;

  const empProjects = ctx.visibleProjects.filter((p) => {
    if (employee) return p.assigned_to === employee.id;
    return p.assigned_to?.toLowerCase() === employeeQuery.toLowerCase();
  });

  const active = empProjects.filter((p) => !isClosed(p));

  if (active.length === 0) {
    const text = `${employeeName} currently has no active projects assigned.`;
    return {
      success: true,
      toolName: 'get_projects_by_employee',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `${employeeName} currently has ${active.length} active project${active.length === 1 ? '' : 's'}: ${active.map((p) => p.project_title).join(', ')}.`;

  let display = `### Projects Assigned to ${employeeName} (${active.length} Active)\n\n`;
  active.forEach((p) => {
    const isOver = isOverdue(p);
    display += `• **${p.project_title}** (${p.client_name}) — Stage: *${p.current_stage || p.status}* — Due: ${formatDate(p.due_date)}${isOver ? ' ⚠️ **(Overdue)**' : ''}\n`;
  });

  return {
    success: true,
    toolName: 'get_projects_by_employee',
    spokenText: spoken,
    displayText: display.trim(),
    count: active.length,
    entities: {
      projects: active,
      employees: [employeeName],
    },
  };
}

export async function get_projects_by_status(statusOrStage: string, ctx: AIToolContext): Promise<AIToolResult> {
  const q = statusOrStage.toLowerCase().trim();

  const matching = ctx.visibleProjects.filter((p) => {
    const st = (p.status || '').toLowerCase();
    const stage = (p.current_stage || '').toLowerCase();
    return st.includes(q) || stage.includes(q) || q.includes(st) || q.includes(stage);
  });

  if (matching.length === 0) {
    const text = `I don't see any projects in status "${statusOrStage}".`;
    return {
      success: true,
      toolName: 'get_projects_by_status',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `There are ${matching.length} project${matching.length === 1 ? '' : 's'} with status or stage "${statusOrStage}": ${matching.map((p) => p.project_title).join(', ')}.`;

  let display = `### Projects in "${statusOrStage}" (${matching.length})\n\n`;
  matching.forEach((p) => {
    display += `• **${p.project_title}** (${p.client_name}) — Stage: *${p.current_stage || p.status}* — Due: ${formatDate(p.due_date)}\n`;
  });

  return {
    success: true,
    toolName: 'get_projects_by_status',
    spokenText: spoken,
    displayText: display.trim(),
    count: matching.length,
    entities: { projects: matching },
  };
}

export async function get_pending_approvals(ctx: AIToolContext): Promise<AIToolResult> {
  const pending = ctx.visibleProjects.filter(
    (p) =>
      p.status === 'Awaiting Client Approval' ||
      isClientApprovalStage(p.current_stage) ||
      p.waiting_on === 'Client',
  );

  if (pending.length === 0) {
    const text = 'No projects are currently awaiting client approval.';
    return {
      success: true,
      toolName: 'get_pending_approvals',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `There are ${pending.length} project${pending.length === 1 ? '' : 's'} waiting for client approval: ${pending.map((p) => `${p.project_title} for ${p.client_name}`).join(', ')}.`;

  let display = `### Projects Awaiting Client Approval (${pending.length})\n\n`;
  pending.forEach((p) => {
    display += `• **${p.project_title}** (${p.project_number}) — Client: **${p.client_name}** — Milestone: *${p.current_stage || 'Approval Needed'}*\n`;
  });

  return {
    success: true,
    toolName: 'get_pending_approvals',
    spokenText: spoken,
    displayText: display.trim(),
    count: pending.length,
    entities: { projects: pending },
  };
}

export async function get_projects_in_revision(ctx: AIToolContext): Promise<AIToolResult> {
  const inRevision = ctx.visibleProjects.filter(
    (p) =>
      p.status === 'In Revision' ||
      p.current_stage === 'Concept Revisions' ||
      p.current_stage === 'Print Revisions' ||
      ctx.data.revisionRequests.some((r) => r.project_id === p.id && r.status !== 'Approved' && r.status !== 'Completed'),
  );

  if (inRevision.length === 0) {
    const text = 'No projects are currently in revision.';
    return {
      success: true,
      toolName: 'get_projects_in_revision',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `You have ${inRevision.length} project${inRevision.length === 1 ? '' : 's'} currently in revision: ${inRevision.map((p) => `${p.project_title} for ${p.client_name}`).join(', ')}.`;

  let display = `### Projects in Revision (${inRevision.length})\n\n`;
  inRevision.forEach((p) => {
    const revCount = ctx.data.revisionRequests.filter((r) => r.project_id === p.id).length;
    display += `• **${p.project_title}** (${p.client_name}) — Stage: *${p.current_stage || p.status}* ${revCount > 0 ? `(${revCount} revision request${revCount === 1 ? '' : 's'})` : ''}\n`;
  });

  return {
    success: true,
    toolName: 'get_projects_in_revision',
    spokenText: spoken,
    displayText: display.trim(),
    count: inRevision.length,
    entities: { projects: inRevision },
  };
}

export async function get_project_details(projectQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  const matches = findMatchingProjects(projectQuery, ctx.visibleProjects);

  if (matches.length === 0) {
    const text = `I couldn't find a project matching "${projectQuery}".`;
    return {
      success: true,
      toolName: 'get_project_details',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const project = matches[0];
  const isClient = isClientRole(ctx.currentProfile.role);

  const assignedProfile = ctx.data.profiles.find((p) => p.id === project.assigned_to);
  const assignedName = assignedProfile ? assignedProfile.full_name : 'Unassigned';

  const overdue = isOverdue(project);
  const days = daysUntil(project.due_date);
  const deadlineText = days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? 'Due today' : `Due in ${days} days`;

  const spoken = `${project.project_title} for ${project.client_name} is currently in the ${project.current_stage || project.status} stage, with status ${project.status}, and is ${deadlineText}. ${!isClient && assignedName !== 'Unassigned' ? `Assigned to ${assignedName}.` : ''}`;

  let display = `### ${project.project_title} (${project.project_number})\n\n`;
  display += `• **Client:** ${project.client_name}\n`;
  display += `• **Status:** ${project.status}${overdue ? ' ⚠️ **(Overdue)**' : ''}\n`;
  display += `• **Current Stage:** ${project.current_stage || 'Files Received'}\n`;
  display += `• **Due Date:** ${formatDate(project.due_date)} (*${deadlineText}*)\n`;
  display += `• **Service Type:** ${project.service_type || 'Print + eBook'}\n`;
  display += `• **Page Count:** ${project.page_count || 0} pages | Word count: ${project.word_count || 0}\n`;

  if (!isClient) {
    display += `• **Assigned Designer:** ${assignedName}\n`;
    if (project.internal_notes) {
      display += `• **Internal Notes:** ${project.internal_notes}\n`;
    }
  }

  if (project.proof_pdf_link) {
    display += `• **Proof PDF:** Available\n`;
  }

  return {
    success: true,
    toolName: 'get_project_details',
    spokenText: spoken,
    displayText: display.trim(),
    count: 1,
    data: project,
    entities: {
      projects: [project],
      clients: [project.client_name],
      employees: assignedProfile ? [assignedProfile.full_name] : [],
    },
  };
}

export async function get_project_timeline(projectQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  const matches = findMatchingProjects(projectQuery, ctx.visibleProjects);
  if (matches.length === 0) {
    const text = `I couldn't find a project timeline for "${projectQuery}".`;
    return {
      success: true,
      toolName: 'get_project_timeline',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const p = matches[0];
  const spoken = `${p.project_title} is currently at stage ${p.current_stage || 'Files Received'}, waiting on ${p.waiting_on || 'Manuscript Heaven'}. Progress is at ${p.progress_percentage || 0} percent.`;

  let display = `### 8-Stage Timeline for ${p.project_title}\n\n`;
  display += `**Current Stage:** ${p.current_stage || 'Files Received'} (${p.progress_percentage || 0}% Complete)\n`;
  display += `**Waiting On:** ${p.waiting_on || 'Manuscript Heaven'}\n\n`;

  display += `1. **Files Received:** ${p.files_received_date ? formatDate(p.files_received_date) : 'Pending'}\n`;
  display += `2. **Design Concept:** Due ${p.design_concept_due_date ? formatDate(p.design_concept_due_date) : 'TBD'}\n`;
  display += `3. **Concept Approval:** ${p.design_concept_approval_date ? `Approved on ${formatDate(p.design_concept_approval_date)}` : 'Pending'}\n`;
  display += `4. **Print Version:** Due ${p.print_version_due_date ? formatDate(p.print_version_due_date) : 'TBD'}\n`;
  display += `5. **Print Approval:** ${p.print_version_approval_date ? `Approved on ${formatDate(p.print_version_approval_date)}` : 'Pending'}\n`;
  display += `6. **Ebook Version:** Due ${p.ebook_due_date ? formatDate(p.ebook_due_date) : 'TBD'}\n`;
  display += `7. **Ebook Approval:** ${p.ebook_approval_date ? `Approved on ${formatDate(p.ebook_approval_date)}` : 'Pending'}\n`;
  display += `8. **Final Delivery:** Due ${formatDate(p.due_date)}\n`;

  return {
    success: true,
    toolName: 'get_project_timeline',
    spokenText: spoken,
    displayText: display.trim(),
    count: 1,
    data: p,
    entities: { projects: [p] },
  };
}

export async function get_project_revisions(projectQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  const matches = findMatchingProjects(projectQuery, ctx.visibleProjects);
  if (matches.length === 0) {
    const text = `I couldn't find revisions for project "${projectQuery}".`;
    return {
      success: true,
      toolName: 'get_project_revisions',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const project = matches[0];
  const requests = ctx.data.revisionRequests.filter((r) => r.project_id === project.id);
  const notes = ctx.data.revisionNotes.filter((n) => n.project_id === project.id);

  const totalRevs = requests.length || notes.length;
  if (totalRevs === 0) {
    const text = `${project.project_title} has had no revisions requested so far.`;
    return {
      success: true,
      toolName: 'get_project_revisions',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [project] },
    };
  }

  const latestReq = requests[requests.length - 1];
  const latestNote = notes[notes.length - 1];

  const latestInstructions = latestReq?.instructions || latestNote?.note || 'General revision requested';
  const latestStatus = latestReq?.status || latestNote?.status || 'In Progress';

  const spoken = `${project.project_title} has had ${totalRevs} revision${totalRevs === 1 ? '' : 's'}. The latest revision status is ${latestStatus}, with notes: "${latestInstructions.slice(0, 100)}".`;

  let display = `### Revisions for ${project.project_title} (${totalRevs} Total)\n\n`;
  if (requests.length > 0) {
    requests.forEach((r, idx) => {
      display += `**Revision #${idx + 1}: ${r.title || 'Revision Request'}**\n`;
      display += `• **Status:** ${r.status} | Priority: ${r.priority}\n`;
      display += `• **Submitted:** ${formatDate(r.submitted_at || r.created_at)}\n`;
      display += `• **Instructions:** ${r.instructions}\n`;
      if (r.team_response) {
        display += `• **Team Response:** ${r.team_response}\n`;
      }
      display += `\n`;
    });
  } else {
    notes.forEach((n) => {
      display += `• **Revision #${n.revision_number}:** ${n.note} — Status: *${n.status}* (${formatDate(n.created_at)})\n`;
    });
  }

  return {
    success: true,
    toolName: 'get_project_revisions',
    spokenText: spoken,
    displayText: display.trim(),
    count: totalRevs,
    data: { requests, notes },
    entities: { projects: [project] },
  };
}

export async function get_tasks_summary(
  filterType: 'overdue' | 'today' | 'my_tasks' | 'all' | string,
  ctx: AIToolContext,
): Promise<AIToolResult> {
  // RBAC check: Clients have no access to internal tasks
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'get_tasks_summary',
      error: 'permission_denied',
      spokenText: "I can't access task management with client permissions.",
      displayText: "🔒 Tasks are restricted for client accounts.",
    };
  }

  const isEmployee = !isManagerRole(ctx.currentProfile.role);
  let taskPool = isEmployee ? ctx.visibleTasks : ctx.data.tasks;

  const now = todayInput();
  let tasks = taskPool.filter((t) => t.status !== 'Done');

  let title = 'Active Tasks';
  if (filterType === 'overdue') {
    tasks = tasks.filter((t) => t.due_date && t.due_date < now);
    title = 'Overdue Tasks';
  } else if (filterType === 'today') {
    tasks = tasks.filter((t) => t.due_date && t.due_date === now);
    title = 'Tasks Due Today';
  } else if (filterType === 'my_tasks') {
    tasks = ctx.visibleTasks.filter((t) => t.status !== 'Done');
    title = 'Your Tasks';
  } else if (filterType && filterType !== 'all') {
    const emp = findMatchingEmployee(filterType, ctx.data.profiles);
    if (emp) {
      tasks = tasks.filter((t) => t.assigned_to === emp.id);
      title = `Tasks for ${emp.full_name}`;
    }
  }

  if (tasks.length === 0) {
    const text = `I don't see any ${title.toLowerCase()}.`;
    return {
      success: true,
      toolName: 'get_tasks_summary',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const spoken = `You have ${tasks.length} ${title.toLowerCase()}: ${tasks.slice(0, 5).map((t) => t.title).join(', ')}${tasks.length > 5 ? ', and more' : ''}.`;

  let display = `### ${title} (${tasks.length})\n\n`;
  tasks.forEach((t) => {
    const assignee = ctx.data.profiles.find((p) => p.id === t.assigned_to);
    display += `• **${t.title}** — Priority: ${t.priority} — Due: ${t.due_date ? formatDate(t.due_date) : 'No deadline'} ${assignee ? `(${assignee.full_name})` : ''}\n`;
  });

  return {
    success: true,
    toolName: 'get_tasks_summary',
    spokenText: spoken,
    displayText: display.trim(),
    count: tasks.length,
    data: tasks,
  };
}

export async function get_employee_workload(employeeQuery: string | undefined, ctx: AIToolContext): Promise<AIToolResult> {
  // RBAC check
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'get_employee_workload',
      error: 'permission_denied',
      spokenText: "I can't access team workload with client permissions.",
      displayText: "🔒 Team workload data is restricted.",
    };
  }

  const teamProfiles = ctx.data.profiles.filter((p) => p.role !== 'client');
  const activeProjects = ctx.visibleProjects.filter((p) => !isClosed(p));

  // If specific employee queried
  if (employeeQuery) {
    const emp = findMatchingEmployee(employeeQuery, teamProfiles);
    const empName = emp ? emp.full_name : employeeQuery;
    const empProjects = activeProjects.filter((p) => (emp ? p.assigned_to === emp.id : false));
    const empTasks = ctx.data.tasks.filter((t) => (emp ? t.assigned_to === emp.id && t.status !== 'Done' : false));

    const spoken = `${empName} currently has ${empProjects.length} active project${empProjects.length === 1 ? '' : 's'} and ${empTasks.length} pending task${empTasks.length === 1 ? '' : 's'}.`;

    let display = `### Workload for ${empName}\n\n`;
    display += `• **Active Projects:** ${empProjects.length}\n`;
    display += `• **Pending Tasks:** ${empTasks.length}\n\n`;
    if (empProjects.length > 0) {
      display += `**Projects:**\n`;
      empProjects.forEach((p) => {
        display += `• ${p.project_title} (${p.current_stage || p.status})\n`;
      });
    }

    return {
      success: true,
      toolName: 'get_employee_workload',
      spokenText: spoken,
      displayText: display.trim(),
      count: empProjects.length,
      entities: { employees: [empName], projects: empProjects },
    };
  }

  // General workload overview: Who has the most active projects?
  const workloadMap: Record<string, { profile: Profile; projects: Project[]; taskCount: number }> = {};
  teamProfiles.forEach((p) => {
    workloadMap[p.id] = {
      profile: p,
      projects: activeProjects.filter((proj) => proj.assigned_to === p.id),
      taskCount: ctx.data.tasks.filter((t) => t.assigned_to === p.id && t.status !== 'Done').length,
    };
  });

  const sorted = Object.values(workloadMap).sort((a, b) => b.projects.length - a.projects.length);
  const topEmployee = sorted[0];

  const spoken = topEmployee
    ? `${topEmployee.profile.full_name} has the most active projects with ${topEmployee.projects.length} project${topEmployee.projects.length === 1 ? '' : 's'}.${sorted[1] ? ` ${sorted[1].profile.full_name} has ${sorted[1].projects.length}.` : ''}`
    : 'No active employee assignments found.';

  let display = `### Team Workload Breakdown\n\n`;
  sorted.forEach(({ profile, projects, taskCount }) => {
    display += `• **${profile.full_name}** (${profile.role}): **${projects.length}** active projects, **${taskCount}** active tasks\n`;
  });

  return {
    success: true,
    toolName: 'get_employee_workload',
    spokenText: spoken,
    displayText: display.trim(),
    count: teamProfiles.length,
    data: sorted,
  };
}

export async function get_client_summary(clientQuery: string | undefined, ctx: AIToolContext): Promise<AIToolResult> {
  const isClient = isClientRole(ctx.currentProfile.role);

  if (isClient) {
    return get_projects_by_client(ctx.currentProfile.full_name || '', ctx);
  }

  if (clientQuery) {
    return get_projects_by_client(clientQuery, ctx);
  }

  // Overview of all clients
  const activeProjects = ctx.visibleProjects.filter((p) => !isClosed(p));
  const clientCounts: Record<string, number> = {};
  activeProjects.forEach((p) => {
    const c = p.client_name || 'Other';
    clientCounts[c] = (clientCounts[c] || 0) + 1;
  });

  const entries = Object.entries(clientCounts).sort((a, b) => b[1] - a[1]);
  const spoken = `You currently have ${entries.length} active clients with projects. ${entries.slice(0, 3).map(([c, count]) => `${c} has ${count}`).join(', ')}.`;

  let display = `### Client Summary (${entries.length} Active Clients)\n\n`;
  entries.forEach(([client, count]) => {
    display += `• **${client}:** ${count} active project${count === 1 ? '' : 's'}\n`;
  });

  return {
    success: true,
    toolName: 'get_client_summary',
    spokenText: spoken,
    displayText: display.trim(),
    count: entries.length,
    entities: { clients: entries.map((e) => e[0]) },
  };
}

export async function get_client_receivables(clientQuery: string | undefined, ctx: AIToolContext): Promise<AIToolResult> {
  // RBAC check: Admin only (or client checking own balance)
  const isClient = isClientRole(ctx.currentProfile.role);
  const isAdmin = ctx.currentProfile.role === 'admin';

  if (!isAdmin && !isClient) {
    return {
      success: false,
      toolName: 'get_client_receivables',
      error: 'permission_denied',
      spokenText: "I can't access financial receivables with your current permissions.",
      displayText: "🔒 Client receivables are restricted to Admin accounts.",
    };
  }

  const projects = ctx.visibleProjects;

  if (isClient || clientQuery) {
    const targetClient = isClient ? ctx.currentProfile.full_name : findMatchingClient(clientQuery || '', projects, ctx.data.profiles);
    const clientProjects = projects.filter((p) => p.client_name.toLowerCase().includes((targetClient || '').toLowerCase()));
    const totalRemaining = clientProjects.reduce((acc, p) => acc + (p.remaining_balance || 0), 0);
    const formatted = ctx.formatMoney(totalRemaining);

    const spoken = totalRemaining > 0
      ? `${targetClient} currently has an outstanding balance of ${formatted}.`
      : `${targetClient} has no outstanding balance. All accounts are settled.`;

    let display = `### Receivables for ${targetClient}\n\n`;
    display += `• **Outstanding Balance:** **${formatted}**\n\n`;
    clientProjects.forEach((p) => {
      if (p.remaining_balance > 0) {
        display += `• **${p.project_title}:** Balance ${ctx.formatMoney(p.remaining_balance)} (Total: ${ctx.formatMoney(p.total_price)})\n`;
      }
    });

    return {
      success: true,
      toolName: 'get_client_receivables',
      spokenText: spoken,
      displayText: display.trim(),
      count: clientProjects.length,
    };
  }

  // Admin view across all clients
  const clientBalances: Record<string, number> = {};
  let grandTotal = 0;

  projects.forEach((p) => {
    const bal = p.remaining_balance || 0;
    if (bal > 0) {
      const c = p.client_name || 'Unknown Client';
      clientBalances[c] = (clientBalances[c] || 0) + bal;
      grandTotal += bal;
    }
  });

  const sorted = Object.entries(clientBalances).sort((a, b) => b[1] - a[1]);
  const formattedTotal = ctx.formatMoney(grandTotal);

  if (sorted.length === 0) {
    const text = 'There are no outstanding receivables. All client balances are fully paid.';
    return {
      success: true,
      toolName: 'get_client_receivables',
      spokenText: text,
      displayText: text,
      count: 0,
    };
  }

  const topClient = sorted[0];
  const spoken = `Clients currently owe us a total of ${formattedTotal}. ${topClient[0]} owes the most with ${ctx.formatMoney(topClient[1])}.`;

  let display = `### Client Receivables Breakdown\n\n`;
  display += `**Total Outstanding:** **${formattedTotal}**\n\n`;
  sorted.forEach(([client, bal]) => {
    display += `• **${client}:** ${ctx.formatMoney(bal)}\n`;
  });

  return {
    success: true,
    toolName: 'get_client_receivables',
    spokenText: spoken,
    displayText: display.trim(),
    count: sorted.length,
    data: { grandTotal, clientBalances },
  };
}

export async function get_finance_summary(monthQuery: string | undefined, ctx: AIToolContext): Promise<AIToolResult> {
  // RBAC check: Admin only
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'get_finance_summary',
      error: 'permission_denied',
      spokenText: "I can't access company financial summaries with your current permissions.",
      displayText: "🔒 Company finance summaries are restricted to Admin accounts.",
    };
  }

  const txs = ctx.data.financeTransactions || [];
  const currentMonthStr = todayInput().slice(0, 7); // e.g. "2026-08"

  const monthTxs = txs.filter((t) => (t.transaction_date || '').startsWith(currentMonthStr));
  let income = 0;
  let expenses = 0;

  monthTxs.forEach((t) => {
    const amount = Number(t.amount || 0);
    const converted = ctx.convertMoney(amount, t.currency || 'USD');
    if (t.type === 'income') {
      income += converted;
    } else {
      expenses += converted;
    }
  });

  const netProfit = income - expenses;
  const formattedIncome = ctx.formatMoney(income, ctx.displayCurrency);
  const formattedExpenses = ctx.formatMoney(expenses, ctx.displayCurrency);
  const formattedNet = ctx.formatMoney(netProfit, ctx.displayCurrency);

  const spoken = `Our income this month is ${formattedIncome}, with expenses of ${formattedExpenses}, resulting in a net profit of ${formattedNet}.`;

  let display = `### Financial Summary for This Month\n\n`;
  display += `• **Total Income:** **${formattedIncome}**\n`;
  display += `• **Total Expenses:** **${formattedExpenses}**\n`;
  display += `• **Net Profit:** **${formattedNet}**\n`;
  display += `• **Transactions Count:** ${monthTxs.length}\n`;

  return {
    success: true,
    toolName: 'get_finance_summary',
    spokenText: spoken,
    displayText: display.trim(),
    data: { income, expenses, netProfit },
  };
}

export async function get_payroll_summary(employeeQuery: string | undefined, ctx: AIToolContext): Promise<AIToolResult> {
  // RBAC check: Admin only
  if (ctx.currentProfile.role !== 'admin') {
    return {
      success: false,
      toolName: 'get_payroll_summary',
      error: 'permission_denied',
      spokenText: "I can't access payroll and compensation data with your current permissions.",
      displayText: "🔒 Payroll and compensation information is restricted to Admin accounts.",
    };
  }

  const compList = ctx.data.employeeCompensation || [];
  const ledger = ctx.data.employeeLedger || [];
  const profiles = ctx.data.profiles.filter((p) => p.role !== 'client');

  if (employeeQuery) {
    const emp = findMatchingEmployee(employeeQuery, profiles);
    if (!emp) {
      const text = `I couldn't find employee compensation data for "${employeeQuery}".`;
      return { success: true, toolName: 'get_payroll_summary', spokenText: text, displayText: text };
    }

    const comp = compList.find((c) => c.employee_id === emp.id);
    const empLedger = ledger.filter((l) => l.employee_id === emp.id);
    const totalPaid = empLedger
      .filter((l) => l.entry_type === 'Payment' || l.entry_type === 'Salary')
      .reduce((sum, l) => sum + (l.amount || 0), 0);

    const salaryFormatted = comp ? ctx.formatMoney(comp.monthly_salary, comp.default_currency || 'USD') : 'Not configured';
    const paidFormatted = ctx.formatMoney(totalPaid);

    const spoken = `${emp.full_name}'s monthly salary is ${salaryFormatted}. Total payments recorded to date are ${paidFormatted}.`;

    let display = `### Payroll Record for ${emp.full_name}\n\n`;
    display += `• **Monthly Salary:** ${salaryFormatted}\n`;
    display += `• **Salary Type:** ${comp?.salary_type || 'Monthly'}\n`;
    display += `• **Total Paid Recorded:** ${paidFormatted}\n`;
    display += `• **Ledger Entries:** ${empLedger.length}\n`;

    return {
      success: true,
      toolName: 'get_payroll_summary',
      spokenText: spoken,
      displayText: display.trim(),
      entities: { employees: [emp.full_name] },
    };
  }

  // Overall payroll
  let totalMonthlySalary = 0;
  compList.forEach((c) => {
    totalMonthlySalary += ctx.convertMoney(c.monthly_salary || 0, c.default_currency || 'USD');
  });

  const formattedTotal = ctx.formatMoney(totalMonthlySalary, ctx.displayCurrency);
  const spoken = `Our total monthly team payroll obligation is approximately ${formattedTotal} across ${compList.length} configured team members.`;

  let display = `### Team Payroll Overview\n\n`;
  display += `• **Total Monthly Obligation:** **${formattedTotal}**\n`;
  display += `• **Configured Employees:** ${compList.length}\n\n`;
  compList.forEach((c) => {
    const p = profiles.find((prof) => prof.id === c.employee_id);
    if (p) {
      display += `• **${p.full_name}:** ${ctx.formatMoney(c.monthly_salary, c.default_currency || 'USD')} / month\n`;
    }
  });

  return {
    success: true,
    toolName: 'get_payroll_summary',
    spokenText: spoken,
    displayText: display.trim(),
    data: { totalMonthlySalary, count: compList.length },
  };
}

export async function get_project_activity(projectQuery: string, ctx: AIToolContext): Promise<AIToolResult> {
  const matches = findMatchingProjects(projectQuery, ctx.visibleProjects);
  if (matches.length === 0) {
    const text = `I couldn't find activity logs for "${projectQuery}".`;
    return {
      success: true,
      toolName: 'get_project_activity',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [] },
    };
  }

  const p = matches[0];
  const isClient = isClientRole(ctx.currentProfile.role);
  const logs = ctx.data.activityLogs.filter((a) => a.project_id === p.id);

  if (logs.length === 0) {
    const text = `No recent activity logs found for ${p.project_title}.`;
    return {
      success: true,
      toolName: 'get_project_activity',
      spokenText: text,
      displayText: text,
      count: 0,
      entities: { projects: [p] },
    };
  }

  const latestLog = logs[0];
  const spoken = `The most recent activity on ${p.project_title} was: ${latestLog.action || latestLog.description || 'Status update'}.`;

  let display = `### Recent Activity on ${p.project_title}\n\n`;
  logs.slice(0, 5).forEach((log) => {
    display += `• **${log.action}** — ${formatDate(log.created_at)} ${!isClient && log.internal_note ? `*(Note: ${log.internal_note})*` : ''}\n`;
  });

  return {
    success: true,
    toolName: 'get_project_activity',
    spokenText: spoken,
    displayText: display.trim(),
    count: logs.length,
    entities: { projects: [p] },
  };
}
