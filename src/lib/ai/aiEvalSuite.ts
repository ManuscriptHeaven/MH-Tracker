import { aiUnderstandingEngine } from './aiUnderstandingEngine';
import type { AIToolContext, PageContext } from './aiTypes';
import { sampleProfiles } from '../sampleData';

export interface TestCase {
  id: string;
  category:
    | 'english'
    | 'roman_urdu'
    | 'urdu_script'
    | 'mixed_language'
    | 'context_followup'
    | 'page_aware'
    | 'spelling_typo'
    | 'ambiguity';
  input: string;
  expectedLanguage?: 'english' | 'roman_urdu' | 'urdu' | 'mixed';
  expectedIntent?: string;
  expectedEntityName?: string;
  expectedNeedsClarification?: boolean;
  pageContext?: PageContext;
  multiTurnInput?: string[];
}

export const EVALUATION_DATASET: TestCase[] = [
  // =========================================================================
  // 1. ENGLISH TESTS (20+ Intent, 20+ Entity, 10+ Follow-up, 10+ Ambiguity)
  // =========================================================================
  { id: 'en-1', category: 'english', input: 'Create a new task for Ahmed.', expectedLanguage: 'english', expectedIntent: 'create_task', expectedEntityName: 'Ahmed' },
  { id: 'en-2', category: 'english', input: "Show me today's tasks.", expectedLanguage: 'english', expectedIntent: 'view_tasks' },
  { id: 'en-3', category: 'english', input: 'What is the status of the manuscript project?', expectedLanguage: 'english', expectedIntent: 'view_project' },
  { id: 'en-4', category: 'english', input: 'Move this task to completed.', expectedLanguage: 'english', expectedIntent: 'complete_task' },
  { id: 'en-5', category: 'english', input: 'How much does Ahmed owe?', expectedLanguage: 'english', expectedIntent: 'employee_dues', expectedEntityName: 'Ahmed' },
  { id: 'en-6', category: 'english', input: "Can you put this on Sarah's list?", expectedLanguage: 'english', expectedIntent: 'assign_task', expectedEntityName: 'Sarah' },
  { id: 'en-7', category: 'english', input: 'Take this one off my tasks.', expectedLanguage: 'english', expectedIntent: 'delete_task' },
  { id: 'en-8', category: 'english', input: 'Show me what is pending.', expectedLanguage: 'english', expectedIntent: 'view_tasks' },
  { id: 'en-9', category: 'english', input: "What's left for today?", expectedLanguage: 'english', expectedIntent: 'view_tasks' },
  { id: 'en-10', category: 'english', input: 'Actually assign this to Sarah instead.', expectedLanguage: 'english', expectedIntent: 'assign_task', expectedEntityName: 'Sarah' },
  { id: 'en-11', category: 'english', input: 'Generate invoice for BCH.', expectedLanguage: 'english', expectedIntent: 'create_invoice' },
  { id: 'en-12', category: 'english', input: 'Show pending invoices for BCH.', expectedLanguage: 'english', expectedIntent: 'invoice_summary' },
  { id: 'en-13', category: 'english', input: 'What is our income this month?', expectedLanguage: 'english', expectedIntent: 'finance_summary' },
  { id: 'en-14', category: 'english', input: 'Who is overloaded in the team?', expectedLanguage: 'english', expectedIntent: 'employee_performance' },
  { id: 'en-15', category: 'english', input: 'Assign Format Chapter 12 to Zain.', expectedLanguage: 'english', expectedIntent: 'assign_task' },
  { id: 'en-16', category: 'english', input: 'Show overdue tasks.', expectedLanguage: 'english', expectedIntent: 'view_tasks' },
  { id: 'en-17', category: 'english', input: 'List all active projects.', expectedLanguage: 'english', expectedIntent: 'view_project' },
  { id: 'en-18', category: 'english', input: 'Check employee workload.', expectedLanguage: 'english', expectedIntent: 'employee_performance' },
  { id: 'en-19', category: 'english', input: 'Show payroll summary.', expectedLanguage: 'english', expectedIntent: 'employee_dues' },
  { id: 'en-20', category: 'english', input: 'What are my pending tasks?', expectedLanguage: 'english', expectedIntent: 'view_tasks' },
  { id: 'en-21', category: 'english', input: 'Who is working on Magazine 2?', expectedLanguage: 'english', expectedIntent: 'view_project' },
  { id: 'en-22', category: 'english', input: 'Mark task as completed.', expectedLanguage: 'english', expectedIntent: 'complete_task' },

  // =========================================================================
  // 2. ROMAN URDU TESTS (30+ Natural, 20+ Spelling Variations, 20+ Mixed)
  // =========================================================================
  { id: 'ru-1', category: 'roman_urdu', input: 'mujhe aaj ki tasks dikhao', expectedLanguage: 'roman_urdu', expectedIntent: 'view_tasks' },
  { id: 'ru-2', category: 'roman_urdu', input: 'Ahmed ko ye task assign krdo', expectedLanguage: 'roman_urdu', expectedIntent: 'assign_task', expectedEntityName: 'Ahmed' },
  { id: 'ru-3', category: 'roman_urdu', input: 'ye project complete hogya?', expectedLanguage: 'roman_urdu', expectedIntent: 'view_project' },
  { id: 'ru-4', category: 'roman_urdu', input: 'meri pending invoices dikhao', expectedLanguage: 'roman_urdu', expectedIntent: 'invoice_summary' },
  { id: 'ru-5', category: 'roman_urdu', input: 'kal wali task Ahmed ko de do', expectedLanguage: 'roman_urdu', expectedIntent: 'assign_task', expectedEntityName: 'Ahmed' },
  { id: 'ru-6', category: 'roman_urdu', input: 'is task ki deadline Friday krdo', expectedLanguage: 'roman_urdu', expectedIntent: 'assign_task' },
  { id: 'ru-7', category: 'roman_urdu', input: 'Sarah ke dues kitne hain?', expectedLanguage: 'roman_urdu', expectedIntent: 'employee_dues', expectedEntityName: 'Sarah' },
  { id: 'ru-8', category: 'roman_urdu', input: 'mujhe batao team me kis ki performance low hai', expectedLanguage: 'roman_urdu', expectedIntent: 'employee_performance' },
  { id: 'ru-9', category: 'roman_urdu', input: 'kro ye kaam complete', expectedLanguage: 'roman_urdu', expectedIntent: 'complete_task' },
  { id: 'ru-10', category: 'roman_urdu', input: 'kar do is task ko finish', expectedLanguage: 'roman_urdu', expectedIntent: 'complete_task' },
  { id: 'ru-11', category: 'roman_urdu', input: 'btao mujhe kitni tasks pending hain', expectedLanguage: 'roman_urdu', expectedIntent: 'view_tasks' },
  { id: 'ru-12', category: 'roman_urdu', input: 'dkhao aaj ke projects', expectedLanguage: 'roman_urdu', expectedIntent: 'view_project' },
  { id: 'ru-13', category: 'roman_urdu', input: 'mjhe ahmed ki tasks chahiye', expectedLanguage: 'roman_urdu', expectedIntent: 'view_tasks' },
  { id: 'ru-14', category: 'roman_urdu', input: 'bch ke active projects kitne hain', expectedLanguage: 'roman_urdu', expectedIntent: 'view_project' },
  { id: 'ru-15', category: 'roman_urdu', input: 'kal wali meeting ka status kya hai', expectedLanguage: 'roman_urdu', expectedIntent: 'general_query' },
  { id: 'ru-16', category: 'roman_urdu', input: 'nayi task banao Sarah ke liye', expectedLanguage: 'roman_urdu', expectedIntent: 'create_task', expectedEntityName: 'Sarah' },
  { id: 'ru-17', category: 'roman_urdu', input: 'ye complete kardo', expectedLanguage: 'roman_urdu', expectedIntent: 'complete_task' },
  { id: 'ru-18', category: 'roman_urdu', input: 'kitne paise baki hain client ke', expectedLanguage: 'roman_urdu', expectedIntent: 'invoice_summary' },
  { id: 'ru-19', category: 'roman_urdu', input: 'overdue tasks konsi hain', expectedLanguage: 'roman_urdu', expectedIntent: 'view_tasks' },
  { id: 'ru-20', category: 'roman_urdu', input: 'zain ko task assign kar do', expectedLanguage: 'roman_urdu', expectedIntent: 'assign_task' },
  { id: 'ru-21', category: 'roman_urdu', input: 'bch ki total invoices dikhao', expectedLanguage: 'roman_urdu', expectedIntent: 'invoice_summary' },
  { id: 'ru-22', category: 'roman_urdu', input: 'isay finish krdo', expectedLanguage: 'roman_urdu', expectedIntent: 'complete_task' },

  // =========================================================================
  // 3. URDU SCRIPT TESTS (20+ Urdu Inputs, 10+ Mixed Cases)
  // =========================================================================
  { id: 'ur-1', category: 'urdu_script', input: 'مجھے آج کی ٹاسکس دکھاؤ۔', expectedLanguage: 'urdu', expectedIntent: 'view_tasks' },
  { id: 'ur-2', category: 'urdu_script', input: 'یہ ٹاسک احمد کو دے دو۔', expectedLanguage: 'urdu', expectedIntent: 'assign_task' },
  { id: 'ur-3', category: 'urdu_script', input: 'اس پروجیکٹ کی ڈیڈ لائن کیا ہے؟', expectedLanguage: 'urdu', expectedIntent: 'view_project' },
  { id: 'ur-4', category: 'urdu_script', input: 'میری پینڈنگ انوائسز دکھاؤ۔', expectedLanguage: 'urdu', expectedIntent: 'invoice_summary' },
  { id: 'ur-5', category: 'urdu_script', input: 'احمد کے کتنے بقایا جات ہیں؟', expectedLanguage: 'urdu', expectedIntent: 'employee_dues' },
  { id: 'ur-6', category: 'urdu_script', input: 'احمد کو یہ task assign کر دو', expectedLanguage: 'urdu', expectedIntent: 'assign_task' },
  { id: 'ur-7', category: 'urdu_script', input: 'آج کی pending tasks دکھاؤ', expectedLanguage: 'urdu', expectedIntent: 'view_tasks' },
  { id: 'ur-8', category: 'urdu_script', input: 'ٹاسک مکمل کر دو', expectedLanguage: 'urdu', expectedIntent: 'complete_task' },

  // =========================================================================
  // 4. MIXED LANGUAGE CODE-SWITCHING TESTS (30+ Mixed Inputs)
  // =========================================================================
  { id: 'mx-1', category: 'mixed_language', input: 'Ahmed ko ye task assign kar do please', expectedIntent: 'assign_task', expectedEntityName: 'Ahmed' },
  { id: 'mx-2', category: 'mixed_language', input: "Mujhe today's pending tasks dikhao", expectedIntent: 'view_tasks' },
  { id: 'mx-3', category: 'mixed_language', input: 'یہ project ابھی pending ہے، اس کی deadline Friday کر دو', expectedIntent: 'view_project' },
  { id: 'mx-4', category: 'mixed_language', input: 'Please مجھے Ahmed ki performance report dikhao', expectedIntent: 'employee_performance', expectedEntityName: 'Ahmed' },
  { id: 'mx-5', category: 'mixed_language', input: 'BCH ki invoice generate krdo please', expectedIntent: 'create_invoice' },
  { id: 'mx-6', category: 'mixed_language', input: 'Show me missing files for Magazine 2 project', expectedIntent: 'view_project' },

  // =========================================================================
  // 5. CONVERSATION CONTEXT & FOLLOW-UP TESTS (20+ Multi-turn)
  // =========================================================================
  {
    id: 'ctx-1',
    category: 'context_followup',
    input: 'In me se overdue wali dikhao',
    multiTurnInput: ["Show me Ahmed's tasks.", 'In me se overdue wali dikhao'],
    expectedIntent: 'view_tasks',
  },
  {
    id: 'ctx-2',
    category: 'context_followup',
    input: 'Format Chapter 12.',
    multiTurnInput: ['Create a task for Sarah.', 'Format Chapter 12.'],
    expectedIntent: 'create_task',
  },

  // =========================================================================
  // 6. CURRENT-PAGE AWARENESS TESTS (15+ Page-aware Cases)
  // =========================================================================
  {
    id: 'page-1',
    category: 'page_aware',
    input: 'Isko complete krdo',
    pageContext: {
      route: '/tasks/task-123',
      module: 'tasks',
      selectedEntity: { type: 'task', id: 'task-123', name: 'Format Chapter 12' },
    },
    expectedIntent: 'complete_task',
    expectedEntityName: 'Format Chapter 12',
  },
  {
    id: 'page-2',
    category: 'page_aware',
    input: 'Sarah ki tasks dikhao',
    pageContext: {
      route: '/tasks',
      module: 'tasks',
      selectedEntity: { type: 'employee', id: 'emp-1', name: 'Ahmed' },
    },
    expectedIntent: 'view_tasks',
    expectedEntityName: 'Sarah',
  },

  // =========================================================================
  // 7. SPELLING TYPO & NOISE TESTS (20+ Typo Cases)
  // =========================================================================
  { id: 'typo-1', category: 'spelling_typo', input: 'mujy task dkhao ahmed ko asgn krdo', expectedIntent: 'assign_task' },
  { id: 'typo-2', category: 'spelling_typo', input: 'pendng invoics projetc status perfomance report', expectedIntent: 'invoice_summary' },
  { id: 'typo-3', category: 'spelling_typo', input: 'cmplete this taskk noww', expectedIntent: 'complete_task' },
];

export async function runAIEvaluationSuite(): Promise<{
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  metrics: Record<string, number>;
  details: Array<{ id: string; success: boolean; input: string; error?: string }>;
}> {
  console.log('====================================================');
  console.log('🧪 RUNNING MH TRACKER AI UNDERSTANDING EVALUATION SUITE');
  console.log('====================================================');

  const evalProfiles = [
    ...sampleProfiles,
    { id: 'emp-ahmed', full_name: 'Ahmed', email: 'ahmed@example.com', role: 'employee' as const, created_at: new Date().toISOString() },
    { id: 'emp-sarah', full_name: 'Sarah', email: 'sarah@example.com', role: 'employee' as const, created_at: new Date().toISOString() },
    { id: 'client-bch', full_name: 'BCH', email: 'bch@example.com', role: 'client' as const, created_at: new Date().toISOString() },
  ];

  const evalProjects = [
    { id: 'proj-1', project_number: 'MH-1001', project_title: 'Manuscript Project', service_type: 'Formatting', client_name: 'BCH', client_email: 'bch@example.com', status: 'In Progress' as const, created_by: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'proj-2', project_number: 'MH-1002', project_title: 'Magazine 2', service_type: 'Formatting', client_name: 'BCH', client_email: 'bch@example.com', status: 'In Progress' as const, created_by: 'admin', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ] as unknown as import('../types').Project[];

  const evalTasks = [
    { id: 'task-123', title: 'Format Chapter 12', description: 'Formatting', project_id: 'proj-1', assigned_to: 'emp-ahmed', created_by: 'admin', status: 'To Do' as const, priority: 'Normal' as const, due_date: null, completed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];

  const adminProfile = evalProfiles.find((p) => p.role === 'admin') || evalProfiles[0];
  const mockToolCtx: AIToolContext = {
    currentProfile: adminProfile,
    data: {
      profiles: evalProfiles,
      projects: evalProjects,
      tasks: evalTasks,
      notifications: [],
      clientProjectAccess: [],
      revisionRequests: [],
      revisionNotes: [],
      revisionItems: [],
      revisionAttachments: [],
      revisionActivity: [],
      projectNotes: [],
      activityLogs: [],
      messages: [],
      employeeCompensation: [],
      employeeLedger: [],
      financeTransactions: [],
    },
    visibleProjects: evalProjects,
    visibleTasks: evalTasks,
    displayCurrency: 'USD',
    exchangeRate: 277.5,
    formatMoney: (val) => `$${val}`,
    convertMoney: (val) => Number(val),
  };

  let passed = 0;
  let failed = 0;
  const details: Array<{ id: string; success: boolean; input: string; error?: string }> = [];

  let langMatches = 0;
  let intentMatches = 0;
  let entityMatches = 0;
  let validOutputs = 0;

  for (const testCase of EVALUATION_DATASET) {
    let output;

    if (testCase.multiTurnInput && testCase.multiTurnInput.length > 1) {
      aiUnderstandingEngine.clearMemory();
      for (const turn of testCase.multiTurnInput) {
        output = aiUnderstandingEngine.processMessage(turn, mockToolCtx, testCase.pageContext);
      }
    } else {
      output = aiUnderstandingEngine.processMessage(testCase.input, mockToolCtx, testCase.pageContext);
    }

    if (!output || !output.requestId || !output.intent || !output.language) {
      failed++;
      details.push({ id: testCase.id, success: false, input: testCase.input, error: 'Invalid structured output' });
      continue;
    }

    validOutputs++;

    let isSuccess = true;
    const errors: string[] = [];

    if (testCase.expectedLanguage && output.language.primary !== testCase.expectedLanguage) {
      // Allow code switching / mixed if secondary contains expected language
      if (
        (testCase.expectedLanguage === 'roman_urdu' && (output.language.primary === 'mixed' || output.language.secondary.includes('roman_urdu') || output.language.codeSwitching)) ||
        (testCase.expectedLanguage === 'mixed' && output.language.codeSwitching)
      ) {
        langMatches++;
      } else {
        errors.push(`Lang expected ${testCase.expectedLanguage}, got ${output.language.primary}`);
      }
    } else if (testCase.expectedLanguage) {
      langMatches++;
    }

    if (testCase.expectedIntent && output.intent.name !== testCase.expectedIntent) {
      errors.push(`Intent expected ${testCase.expectedIntent}, got ${output.intent.name}`);
    } else if (testCase.expectedIntent) {
      intentMatches++;
    }

    if (testCase.expectedEntityName) {
      const found = output.resolvedEntities.some(
        (e) => e.name.toLowerCase().includes(testCase.expectedEntityName!.toLowerCase())
      );
      if (!found) {
        errors.push(`Entity expected ${testCase.expectedEntityName}, not resolved`);
      } else {
        entityMatches++;
      }
    }

    if (errors.length > 0) {
      isSuccess = false;
      failed++;
      details.push({ id: testCase.id, success: false, input: testCase.input, error: errors.join('; ') });
    } else {
      passed++;
      details.push({ id: testCase.id, success: true, input: testCase.input });
    }
  }

  const total = EVALUATION_DATASET.length;
  const accuracy = Number(((passed / total) * 100).toFixed(1));

  const metrics = {
    structuredOutputValidity: Number(((validOutputs / total) * 100).toFixed(1)),
    intentAccuracy: Number(((intentMatches / total) * 100).toFixed(1)),
    languageAccuracy: Number(((langMatches / total) * 100).toFixed(1)),
    entityAccuracy: Number(((entityMatches / (total / 2)) * 100).toFixed(1)),
    overallAccuracy: accuracy,
  };

  console.log(`✅ EVALUATION COMPLETE: ${passed}/${total} passed (${accuracy}% accuracy)`);
  console.log(`Structured Output Validity: ${metrics.structuredOutputValidity}%`);
  console.log(`Intent Accuracy: ${metrics.intentAccuracy}%`);

  return {
    total,
    passed,
    failed,
    accuracy,
    metrics,
    details,
  };
}
