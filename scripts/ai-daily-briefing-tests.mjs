import { buildDailyBriefing } from '../src/lib/ai/dailyBriefing.ts';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

function dateInput(date) {
  return date.toISOString().slice(0, 10);
}

function daysFromNow(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateInput(date);
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const admin = {
  id: 'admin-1',
  full_name: 'Tahir Admin',
  role: 'admin',
  status: 'active',
};

const manager = {
  id: 'manager-1',
  full_name: 'Maya Manager',
  role: 'project_manager',
  status: 'active',
};

const employee = {
  id: 'employee-1',
  full_name: 'Zain Employee',
  role: 'employee',
  status: 'active',
};

const overdueProject = {
  id: 'project-overdue',
  project_number: 'MH-2001',
  project_title: 'Late Atlas',
  client_name: 'BCH',
  client_email: 'client@example.com',
  status: 'In Progress',
  project_status: 'active',
  stage_status: 'ACTIVE',
  current_stage: 'Print Version',
  waiting_on: 'Team',
  assigned_to: employee.id,
  due_date: daysFromNow(-5),
  updated_at: isoDaysAgo(1),
  created_at: new Date().toISOString(),
  total_price: 1200,
  advance_paid: 400,
  remaining_balance: 800,
  invoiced: false,
};

const approvalProject = {
  id: 'project-approval',
  project_number: 'MH-2002',
  project_title: 'Approval Book',
  client_name: 'Client Two',
  client_email: 'two@example.com',
  status: 'Awaiting Client Approval',
  project_status: 'active',
  stage_status: 'PAUSED_CLIENT_REVIEW',
  current_stage: 'Print Approval',
  waiting_on: 'Client',
  assigned_to: employee.id,
  due_date: daysFromNow(3),
  updated_at: isoDaysAgo(6),
  created_at: new Date().toISOString(),
  total_price: 600,
  advance_paid: 600,
  remaining_balance: 0,
  invoiced: true,
};

const cancelledProject = {
  id: 'project-cancelled',
  project_number: 'MH-2003',
  project_title: 'Cancelled Work',
  client_name: 'Client Three',
  status: 'Cancelled',
  project_status: 'cancelled',
  due_date: daysFromNow(-10),
  updated_at: isoDaysAgo(10),
  created_at: new Date().toISOString(),
  total_price: 9999,
  advance_paid: 0,
  remaining_balance: 9999,
};

const overdueTask = {
  id: 'task-overdue',
  title: 'Send print proof',
  description: '',
  project_id: overdueProject.id,
  assigned_to: employee.id,
  created_by: admin.id,
  status: 'In Progress',
  priority: 'Urgent',
  start_date: daysFromNow(-3),
  due_date: daysFromNow(-1),
  parent_task_id: null,
  estimated_minutes: null,
  actual_minutes: null,
  blocked_reason: null,
  sort_order: 0,
  task_type: 'General',
  visibility: 'team',
  archived_at: null,
  completed_at: null,
  created_at: isoDaysAgo(3),
  updated_at: isoDaysAgo(1),
};

const data = {
  profiles: [admin, manager, employee],
  projects: [overdueProject, approvalProject, cancelledProject],
  tasks: [overdueTask],
  notifications: [],
  conversationMembers: [
    {
      id: 'member-1',
      conversation_id: 'conv-1',
      user_id: admin.id,
      last_read_at: isoDaysAgo(2),
      created_at: isoDaysAgo(10),
    },
  ],
  messages: [
    {
      id: 'message-1',
      conversation_id: 'conv-1',
      sender_id: employee.id,
      body: 'Need your review',
      created_at: isoDaysAgo(1),
      updated_at: isoDaysAgo(1),
    },
  ],
  invoices: [
    {
      id: 'invoice-v1',
      logical_invoice_id: 'invoice-logical',
      version_number: 1,
      invoice_number: 'INV-1',
      client_name: 'BCH',
      client_email: 'client@example.com',
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      month_label: 'Current',
      created_at: isoDaysAgo(3),
      due_date: daysFromNow(7),
      items: [],
      subtotal: 1200,
      total_paid: 400,
      total_due: 800,
      status: 'Sent',
    },
    {
      id: 'invoice-v2',
      logical_invoice_id: 'invoice-logical',
      version_number: 2,
      invoice_number: 'INV-1',
      client_name: 'BCH',
      client_email: 'client@example.com',
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      month_label: 'Current',
      created_at: isoDaysAgo(1),
      due_date: daysFromNow(7),
      items: [],
      subtotal: 1200,
      total_paid: 400,
      total_due: 800,
      status: 'Sent',
    },
  ],
  financeTransactions: [],
  revisionNotes: [],
  projectNotes: [],
  activityLogs: [],
  clientProjectAccess: [],
  taskAssignees: [],
  taskComments: [],
  taskChecklistItems: [],
  taskDependencies: [],
  revisionRequests: [],
  revisionItems: [],
  revisionAttachments: [],
  revisionActivity: [],
  employeeCompensation: [],
  employeeLedger: [],
  conversationMembers: [
    {
      id: 'member-1',
      conversation_id: 'conv-1',
      user_id: admin.id,
      last_read_at: isoDaysAgo(2),
      created_at: isoDaysAgo(10),
    },
  ],
  conversations: [],
  messages: [
    {
      id: 'message-1',
      conversation_id: 'conv-1',
      sender_id: employee.id,
      body: 'Need your review',
      created_at: isoDaysAgo(1),
      updated_at: isoDaysAgo(1),
    },
  ],
  messageAttachments: [],
  messageReactions: [],
  messageMentions: [],
};

console.log('--- AI Daily Briefing Behavioral Tests ---');

const adminSummary = buildDailyBriefing({
  data,
  visibleProjects: data.projects,
  visibleTasks: data.tasks,
  currentProfile: admin,
});

assert(adminSummary.financeVisible === true, 'admin receives finance briefing data');
assert(adminSummary.pendingProjects.count === 2, 'cancelled projects are excluded from active workload');
assert(adminSummary.overdueProjects.count === 1, 'overdue projects are detected');
assert(adminSummary.awaitingApprovals.count === 1, 'client approval waits are detected');
assert(adminSummary.overdueTasks.count === 1, 'overdue tasks are detected');
assert(adminSummary.unreadMessages === 1, 'unread communication count is derived from membership read time');
assert(adminSummary.receivables === 800, 'receivables use project outstanding balances');
assert(adminSummary.pendingInvoices.count === 1, 'invoice revisions count once using the latest version');
assert(adminSummary.pendingInvoices.totalAmount === 800, 'latest invoice due amount is used');
assert(
  adminSummary.revenueSummary.thisMonth === 1800,
  'current-month order revenue is derived from active project order values',
);
assert(
  adminSummary.proactiveInsights.some((item) => item.type === 'late_project'),
  'daily briefing includes overdue-project insight',
);
assert(
  adminSummary.proactiveInsights.some((item) => item.type === 'approval_stall'),
  'daily briefing identifies stalled client approvals',
);
assert(
  adminSummary.proactiveInsights.some((item) => item.type === 'missing_invoice'),
  'admin briefing identifies uninvoiced outstanding balances',
);
assert(
  adminSummary.recommendedActions.some((item) => item.id === 'prioritize-overdue'),
  'daily briefing recommends prioritizing overdue work',
);
assert(
  adminSummary.recommendedActions.some((item) => item.id === 'review-receivables'),
  'admin briefing recommends receivables review',
);

const managerSummary = buildDailyBriefing({
  data,
  visibleProjects: data.projects,
  visibleTasks: data.tasks,
  currentProfile: manager,
});

assert(managerSummary.financeVisible === false, 'non-admin manager briefing hides finance metrics');
assert(managerSummary.receivables === 0, 'non-admin briefing does not expose receivables');
assert(
  !managerSummary.proactiveInsights.some((item) => item.type === 'missing_invoice'),
  'non-admin briefing does not expose invoice/receivable alert details',
);

if (process.exitCode) {
  console.error('AI Daily Briefing behavioral checks failed.');
} else {
  console.log('ALL AI DAILY BRIEFING BEHAVIORAL CHECKS PASSED.');
}
