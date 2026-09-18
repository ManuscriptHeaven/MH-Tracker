import { prepareClientCommunication } from '../src/lib/ai/clientCommunication.ts';
import { execute_send_client_message } from '../src/lib/ai/safeActionTools.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const admin = {
  id: 'admin-1',
  full_name: 'Tahir Admin',
  email: 'admin@example.com',
  role: 'admin',
  status: 'active',
  created_at: new Date().toISOString(),
};

const employee = {
  id: 'employee-1',
  full_name: 'Zain Employee',
  email: 'zain@example.com',
  role: 'employee',
  status: 'active',
  created_at: new Date().toISOString(),
};

const project = {
  id: 'project-1',
  project_number: 'MH-2001',
  client_profile_id: 'client-1',
  client_name: 'BCH',
  client_email: 'bch@example.com',
  project_title: 'Magazine 2',
  service_type: 'Magazine',
  genre: '',
  trim_size: '',
  page_count: 40,
  word_count: 10000,
  image_count: 20,
  platform: 'KDP',
  assigned_to: employee.id,
  project_manager: admin.id,
  priority: 'High',
  start_date: '2026-09-01',
  due_date: '2026-09-30',
  internal_deadline: '2026-09-28',
  delivery_date: null,
  status: 'Awaiting Client Approval',
  project_status: 'active',
  general_notes: '',
  internal_notes: '',
  client_instructions: 'Please send the missing cover image and author bio',
  client_action_required: 'the missing cover image and author bio',
  qa_notes: '',
  delivery_notes: '',
  source_file_link: '',
  drive_folder_link: 'https://drive.example.com/project',
  client_brief_link: '',
  proof_pdf_link: 'https://example.com/proof.pdf',
  final_print_pdf_link: 'https://example.com/final-print.pdf',
  final_ebook_link: 'https://example.com/final.epub',
  cover_file_link: '',
  other_links: '',
  total_price: 1200,
  advance_paid: 700,
  remaining_balance: 500,
  payment_status: 'Partially Paid',
  payment_date: null,
  payment_notes: '',
  current_stage: 'Print Approval',
  waiting_on: 'Client',
  created_by: admin.id,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
};

const secondProject = {
  ...project,
  id: 'project-2',
  project_number: 'MH-2002',
  project_title: 'BCH Annual Report',
};

const revision = {
  id: 'revision-1',
  project_id: project.id,
  client_id: 'client-1',
  title: 'Round 2',
  description: '',
  instructions: 'Update pages 3 and 9',
  team_response: null,
  priority: 'Normal',
  status: 'Submitted',
  stage_key: 'print_version',
  revision_round: 2,
  canonical_status: 'SUBMITTED',
  parent_revision_request_id: null,
  assigned_to: employee.id,
  submitted_at: '2026-09-17T00:00:00Z',
  completed_at: null,
  created_at: '2026-09-17T00:00:00Z',
  updated_at: '2026-09-17T00:00:00Z',
};

let sendCalls = [];
let conversationCalls = [];

function makeCtx(options = {}) {
  const projects = options.projects || [project];
  return {
    currentProfile: options.profile || admin,
    data: {
      profiles: [admin, employee],
      projects,
      revisionNotes: [],
      projectNotes: [],
      activityLogs: [],
      notifications: [],
      clientProjectAccess:
        options.withAccess === false
          ? []
          : [{ id: 'access-1', client_id: 'client-1', project_id: project.id, created_at: new Date().toISOString() }],
      tasks: [],
      taskAssignees: [],
      taskComments: [],
      taskChecklistItems: [],
      taskDependencies: [],
      revisionRequests: [revision],
      revisionItems: [],
      revisionAttachments: [],
      revisionActivity: [],
      employeeCompensation: [],
      employeeLedger: [],
      financeTransactions: [],
      financeBudgets: [],
      invoices: [],
      conversations: [],
      conversationMembers: [],
      messages: [],
      messageAttachments: [],
      messageReactions: [],
      messageMentions: [],
    },
    visibleProjects: projects,
    visibleTasks: [],
    displayCurrency: 'USD',
    exchangeRate: 1,
    formatMoney: (amount) => '$' + Number(amount || 0).toLocaleString('en-US'),
    convertMoney: (amount) => Number(amount || 0),
    trackerMutations: {
      getOrCreateProjectConversation: async (projectId, isInternal) => {
        conversationCalls.push({ projectId, isInternal });
        return { id: 'client-conversation-1', project_id: projectId, type: 'project_client' };
      },
      sendMessage: async (conversationId, body) => {
        const row = { id: 'message-' + (sendCalls.length + 1), conversationId, body };
        sendCalls.push(row);
        return row;
      },
    },
  };
}

console.log('--- AI Smart Client Communication Tests ---');

const approval = prepareClientCommunication(
  'Draft a professional approval reminder message for MH-2001',
  makeCtx(),
);
assert(
  approval?.success &&
    approval.pendingAction?.toolName === 'send_client_message' &&
    approval.pendingAction.payload.tone === 'professional' &&
    approval.pendingAction.payload.body.includes('Print Approval') &&
    approval.displayText.includes('Nothing will be sent until you confirm.'),
  'approval reminder uses live project stage and requires confirmation',
);

const payment = prepareClientCommunication(
  'Prepare a firm payment reminder message for MH-2001',
  makeCtx(),
);
assert(
  payment?.success &&
    payment.pendingAction?.payload.body.includes('$500') &&
    payment.pendingAction?.payload.tone === 'firm',
  'payment reminder uses exact project outstanding balance and requested tone',
);

const files = prepareClientCommunication(
  'Write a friendly files required message for MH-2001',
  makeCtx(),
);
assert(
  files?.success &&
    files.pendingAction?.payload.body.includes('missing cover image and author bio'),
  'files-required draft uses client action context instead of generic copy',
);

const revisionAck = prepareClientCommunication(
  'Draft revision received message for MH-2001',
  makeCtx(),
);
assert(
  revisionAck?.success &&
    revisionAck.pendingAction?.payload.body.includes('revision round 2'),
  'revision acknowledgement uses latest revision round',
);

const emailDraft = prepareClientCommunication(
  'Draft a friendly final delivery email for MH-2001',
  makeCtx(),
);
assert(
  emailDraft?.success &&
    !emailDraft.pendingAction &&
    emailDraft.displayText.includes('Email delivery is not connected') &&
    emailDraft.displayText.includes('final-print.pdf') &&
    emailDraft.displayText.includes('final.epub'),
  'email request produces contextual email draft but never falsely sends',
);

const ambiguous = prepareClientCommunication(
  'Send an approval reminder message to BCH',
  makeCtx({ projects: [project, secondProject] }),
);
assert(
  !ambiguous?.success &&
    ambiguous?.error === 'project_required' &&
    ambiguous.displayText.includes('MH-2001') &&
    ambiguous.displayText.includes('MH-2002'),
  'multiple client projects require explicit project selection instead of guessing',
);

const denied = prepareClientCommunication(
  'Draft a payment reminder message for MH-2001',
  makeCtx({ profile: employee }),
);
assert(
  !denied?.success && denied?.error === 'permission_denied',
  'employee cannot prepare AI client-facing communication',
);

sendCalls = [];
conversationCalls = [];
const sent = await execute_send_client_message(
  approval.pendingAction.payload,
  makeCtx(),
);
assert(
  sent.success &&
    sendCalls.length === 1 &&
    conversationCalls.length === 1 &&
    conversationCalls[0].projectId === project.id &&
    conversationCalls[0].isInternal === false &&
    sendCalls[0].conversationId === 'client-conversation-1',
  'confirmed client message uses the real project_client conversation and sends once',
);

sendCalls = [];
conversationCalls = [];
const noAccess = await execute_send_client_message(
  approval.pendingAction.payload,
  makeCtx({ withAccess: false }),
);
assert(
  !noAccess.success &&
    noAccess.error === 'client_portal_access_required' &&
    sendCalls.length === 0 &&
    conversationCalls.length === 0,
  'message is not sent when project has no client portal access recipient',
);

sendCalls = [];
conversationCalls = [];
voiceQueryEngine.clearMemory();
const preview = await voiceQueryEngine.processQuery(
  'Draft a professional payment reminder message for MH-2001',
  makeCtx(),
);
assert(
  preview.success && preview.pendingAction && sendCalls.length === 0,
  'voice flow creates preview without sending',
);

const redraft = await voiceQueryEngine.processQuery('make it friendly', makeCtx());
assert(
  redraft.success &&
    redraft.pendingAction?.payload.tone === 'friendly' &&
    sendCalls.length === 0,
  'tone can be changed while message remains unsent',
);

const confirmed = await voiceQueryEngine.processQuery('Yes', makeCtx());
assert(
  confirmed.success && sendCalls.length === 1,
  'separate confirmation is required before actual client send',
);

if (process.exitCode) {
  console.error('AI Smart Client Communication checks failed.');
} else {
  console.log('ALL AI SMART CLIENT COMMUNICATION CHECKS PASSED.');
}
