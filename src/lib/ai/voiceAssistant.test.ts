import { voiceQueryEngine } from './voiceQueryEngine';
import { sampleProfiles } from '../sampleData';
import type { TrackerData, Project } from '../types';
import type { AIToolContext } from './aiTypes';
import { todayInput, addDays } from '../date';

export async function runVoiceAssistantTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING MH TRACKER AI VOICE ASSISTANT TEST SUITE');
  console.log('====================================================');

  const adminProfile = sampleProfiles.find((p) => p.role === 'admin')!;
  const managerProfile = sampleProfiles.find((p) => p.role === 'project_manager')!;
  const employeeProfile = sampleProfiles.find((p) => p.role === 'employee')!;
  const clientProfile = sampleProfiles.find((p) => p.role === 'client')!;

  const testProjects: Project[] = [
    {
      id: 'proj-1',
      project_number: 'MH-1001',
      client_name: 'Amelia Carter',
      client_email: 'amelia@example.com',
      project_title: 'The Quiet Atlas',
      service_type: 'Print + eBook',
      genre: 'Memoir',
      trim_size: '6 x 9',
      page_count: 280,
      word_count: 70000,
      image_count: 10,
      platform: 'KDP',
      assigned_to: employeeProfile.id,
      project_manager: managerProfile.id,
      priority: 'High',
      start_date: '2026-07-01',
      due_date: '2026-08-01', // Overdue
      internal_deadline: '2026-07-28',
      delivery_date: null,
      status: 'In Progress',
      general_notes: '',
      internal_notes: 'VIP author',
      client_instructions: 'Standard formatting',
      qa_notes: '',
      delivery_notes: '',
      source_file_link: '',
      drive_folder_link: '',
      client_brief_link: '',
      proof_pdf_link: 'https://example.com/proof.pdf',
      final_print_pdf_link: '',
      final_ebook_link: '',
      cover_file_link: '',
      other_links: '',
      total_price: 1500,
      advance_paid: 1000,
      remaining_balance: 500,
      payment_status: 'Partially Paid',
      payment_date: null,
      payment_notes: '',
      current_stage: 'Print Version',
      progress_percentage: 60,
      waiting_on: 'Manuscript Heaven',
      created_by: adminProfile.id,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    },
    {
      id: 'proj-2',
      project_number: 'MH-1002',
      client_name: 'BCH',
      client_email: 'bch@example.com',
      project_title: 'Magazine 2',
      service_type: 'Magazine',
      genre: 'Business',
      trim_size: '8.5 x 11',
      page_count: 64,
      word_count: 20000,
      image_count: 40,
      platform: 'IngramSpark',
      assigned_to: employeeProfile.id,
      project_manager: managerProfile.id,
      priority: 'Urgent',
      start_date: '2026-07-15',
      due_date: '2026-08-10', // Overdue
      internal_deadline: '2026-08-08',
      delivery_date: null,
      status: 'In Progress',
      general_notes: '',
      internal_notes: '',
      client_instructions: '',
      qa_notes: '',
      delivery_notes: '',
      source_file_link: '',
      drive_folder_link: '',
      client_brief_link: '',
      proof_pdf_link: '',
      final_print_pdf_link: '',
      final_ebook_link: '',
      cover_file_link: '',
      other_links: '',
      total_price: 2000,
      advance_paid: 1000,
      remaining_balance: 1000,
      payment_status: 'Partially Paid',
      payment_date: null,
      payment_notes: '',
      current_stage: 'Design Concept',
      progress_percentage: 40,
      waiting_on: 'Manuscript Heaven',
      created_by: adminProfile.id,
      created_at: '2026-07-15T00:00:00Z',
      updated_at: '2026-08-10T00:00:00Z',
    },
    {
      id: 'proj-3',
      project_number: 'MH-1003',
      client_name: 'Noah Brooks',
      client_email: 'noah@example.com',
      project_title: 'The Little Star Bakery',
      service_type: 'Children Book',
      genre: 'Fiction',
      trim_size: '8.5 x 8.5',
      page_count: 32,
      word_count: 1500,
      image_count: 25,
      platform: 'KDP',
      assigned_to: adminProfile.id,
      project_manager: managerProfile.id,
      priority: 'Normal',
      start_date: '2026-08-01',
      due_date: todayInput(), // Due today
      internal_deadline: todayInput(),
      delivery_date: null,
      status: 'Awaiting Client Approval',
      general_notes: '',
      internal_notes: '',
      client_instructions: '',
      qa_notes: '',
      delivery_notes: '',
      source_file_link: '',
      drive_folder_link: '',
      client_brief_link: '',
      proof_pdf_link: '',
      final_print_pdf_link: '',
      final_ebook_link: '',
      cover_file_link: '',
      other_links: '',
      total_price: 800,
      advance_paid: 800,
      remaining_balance: 0,
      payment_status: 'Fully Paid',
      payment_date: '2026-08-01',
      payment_notes: '',
      current_stage: 'Concept Approval',
      progress_percentage: 50,
      waiting_on: 'Client',
      created_by: adminProfile.id,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-15T00:00:00Z',
    },
    {
      id: 'proj-4',
      project_number: 'MH-1004',
      client_name: 'Lena White',
      client_email: 'lena@example.com',
      project_title: 'Founder Notes Workbook',
      service_type: 'Workbook',
      genre: 'Non-Fiction',
      trim_size: '7 x 10',
      page_count: 120,
      word_count: 30000,
      image_count: 15,
      platform: 'KDP',
      assigned_to: 'hamza-designer',
      project_manager: managerProfile.id,
      priority: 'Normal',
      start_date: '2026-08-10',
      due_date: addDays(4), // Due this week
      internal_deadline: addDays(3),
      delivery_date: null,
      status: 'In Revision',
      general_notes: '',
      internal_notes: '',
      client_instructions: '',
      qa_notes: '',
      delivery_notes: '',
      source_file_link: '',
      drive_folder_link: '',
      client_brief_link: '',
      proof_pdf_link: '',
      final_print_pdf_link: '',
      final_ebook_link: '',
      cover_file_link: '',
      other_links: '',
      total_price: 1200,
      advance_paid: 600,
      remaining_balance: 600,
      payment_status: 'Partially Paid',
      payment_date: null,
      payment_notes: '',
      current_stage: 'Concept Revisions',
      progress_percentage: 30,
      waiting_on: 'Manuscript Heaven',
      created_by: adminProfile.id,
      created_at: '2026-08-10T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    },
  ];

  const mockData: TrackerData = {
    profiles: sampleProfiles,
    projects: testProjects,
    revisionNotes: [],
    projectNotes: [],
    activityLogs: [],
    notifications: [],
    clientProjectAccess: [],
    tasks: [
      {
        id: 'task-1',
        title: 'Review proof files for The Quiet Atlas',
        description: 'Check layout and fonts',
        project_id: 'proj-1',
        assigned_to: employeeProfile.id,
        created_by: adminProfile.id,
        status: 'To Do',
        priority: 'High',
        due_date: '2026-08-01', // Overdue
        completed_at: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'task-2',
        title: 'Prepare ePub conversion',
        description: 'Verify TOC and navigation',
        project_id: 'proj-1',
        assigned_to: adminProfile.id,
        created_by: adminProfile.id,
        status: 'In Progress',
        priority: 'Normal',
        due_date: todayInput(), // Due today
        completed_at: null,
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      },
    ],
    revisionRequests: [
      {
        id: 'rev-1',
        project_id: 'proj-4',
        client_id: 'lena-client',
        title: 'Fix heading margins',
        description: 'Heading spacing',
        instructions: 'Please increase spacing above H1',
        team_response: 'Updated',
        priority: 'Normal',
        status: 'In Progress',
        assigned_to: 'hamza-designer',
        submitted_at: '2026-08-20T10:00:00Z',
        completed_at: null,
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:00:00Z',
      },
    ],
    revisionItems: [],
    revisionAttachments: [],
    revisionActivity: [],
    employeeCompensation: [
      {
        employee_id: employeeProfile.id,
        monthly_salary: 1500,
        per_project_rate: 150,
        salary_type: 'Monthly',
        default_currency: 'USD',
        joining_date: '2025-01-01',
        responsibilities: 'Book formatting & ePub conversion',
        performance_rating: 5,
        updated_at: '2026-08-01T00:00:00Z',
      },
    ],
    employeeLedger: [
      {
        id: 'ledger-1',
        employee_id: employeeProfile.id,
        entry_type: 'Salary',
        amount: 1500,
        currency: 'USD',
        salary_month: '2026-07',
        payment_method: 'Bank Transfer',
        project_id: null,
        notes: 'July Salary',
        paid_at: '2026-08-01T00:00:00Z',
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
    financeTransactions: [
      {
        id: 'tx-1',
        type: 'income',
        category: 'Book Formatting',
        description: 'Payment for The Quiet Atlas',
        amount: 2500,
        currency: 'USD',
        exchange_rate: 277.5,
        amount_pkr: 693750,
        transaction_date: todayInput(),
        payment_method: 'Bank Wire',
        created_by: adminProfile.id,
        created_at: '2026-08-20T00:00:00Z',
      },
      {
        id: 'tx-2',
        type: 'expense',
        category: 'Software',
        description: 'Adobe InDesign Suite license',
        amount: 300,
        currency: 'USD',
        exchange_rate: 277.5,
        amount_pkr: 83250,
        transaction_date: todayInput(),
        payment_method: 'Credit Card',
        created_by: adminProfile.id,
        created_at: '2026-08-20T00:00:00Z',
      },
    ],
  };

  const createAdminCtx = (currency: 'USD' | 'PKR' = 'USD'): AIToolContext => ({
    currentProfile: adminProfile,
    data: mockData,
    visibleProjects: testProjects,
    visibleTasks: mockData.tasks,
    displayCurrency: currency,
    exchangeRate: 277.5,
    formatMoney: (amount: number | null | undefined) => (currency === 'USD' ? `$${Number(amount || 0).toLocaleString('en-US')}` : `Rs. ${Math.round(Number(amount || 0) * (currency === 'PKR' ? 1 : 277.5)).toLocaleString('en-US')} PKR`),
    convertMoney: (amount: number | null | undefined, from = 'USD', to = currency) => (from === to ? Number(amount || 0) : to === 'PKR' ? Number(amount || 0) * 277.5 : Number(amount || 0) / 277.5),
  });

  const createEmployeeCtx = (): AIToolContext => ({
    currentProfile: employeeProfile,
    data: mockData,
    visibleProjects: testProjects.filter((p) => p.assigned_to === employeeProfile.id),
    visibleTasks: mockData.tasks.filter((t) => t.assigned_to === employeeProfile.id),
    displayCurrency: 'USD',
    exchangeRate: 277.5,
    formatMoney: (amount: number | null | undefined) => `$${Number(amount || 0).toLocaleString('en-US')}`,
    convertMoney: (amount: number | null | undefined) => Number(amount || 0),
  });

  const createClientCtx = (): AIToolContext => ({
    currentProfile: clientProfile,
    data: mockData,
    visibleProjects: testProjects.filter((p) => p.client_name.toLowerCase().includes('amelia')),
    visibleTasks: [],
    displayCurrency: 'USD',
    exchangeRate: 277.5,
    formatMoney: (amount: number | null | undefined) => `$${Number(amount || 0).toLocaleString('en-US')}`,
    convertMoney: (amount: number | null | undefined) => Number(amount || 0),
  });

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
    }
  }

  // TEST 1: Overdue projects query
  voiceQueryEngine.clearMemory();
  const res1 = await voiceQueryEngine.processQuery('How many projects are overdue?', createAdminCtx());
  assert(res1.success && res1.count === 2, 'Test 1: How many projects are overdue?');
  console.log(`   Assistant: "${res1.spokenText}"`);

  // TEST 2: Multi-turn Follow-up 1 ("Which clients?")
  const res2 = await voiceQueryEngine.processQuery('Which clients?', createAdminCtx());
  assert(res2.success && (res2.spokenText.includes('Amelia') && res2.spokenText.includes('BCH')), 'Test 2: Follow-up "Which clients?"');
  console.log(`   Assistant: "${res2.spokenText}"`);

  // TEST 3: Multi-turn Follow-up 2 ("What are the Amelia ones?")
  const res3 = await voiceQueryEngine.processQuery('What are the Amelia ones?', createAdminCtx());
  assert(res3.success && res3.spokenText.includes('The Quiet Atlas'), 'Test 3: Follow-up "What are the Amelia ones?"');
  console.log(`   Assistant: "${res3.spokenText}"`);

  // TEST 4: Due today query
  const res4 = await voiceQueryEngine.processQuery("What's due today?", createAdminCtx());
  assert(res4.success && res4.count === 1, "Test 4: What's due today?");
  console.log(`   Assistant: "${res4.spokenText}"`);

  // TEST 5: Due this week query
  const res5 = await voiceQueryEngine.processQuery("What's due this week?", createAdminCtx());
  assert(res5.success && res5.count! >= 1, "Test 5: What's due this week?");
  console.log(`   Assistant: "${res5.spokenText}"`);

  // TEST 6: Projects waiting for client approval
  const res6 = await voiceQueryEngine.processQuery('How many projects are waiting for client approval?', createAdminCtx());
  assert(res6.success && res6.spokenText.includes('The Little Star Bakery'), 'Test 6: Pending client approvals');
  console.log(`   Assistant: "${res6.spokenText}"`);

  // TEST 7: Projects in revision
  const res7 = await voiceQueryEngine.processQuery('How many are in revision?', createAdminCtx());
  assert(res7.success && res7.count! >= 1, 'Test 7: Projects in revision');
  console.log(`   Assistant: "${res7.spokenText}"`);

  // TEST 8: Specific project query
  const res8 = await voiceQueryEngine.processQuery('What is The Quiet Atlas status?', createAdminCtx());
  assert(res8.success && res8.spokenText.includes('The Quiet Atlas'), 'Test 8: Specific project details query');
  console.log(`   Assistant: "${res8.spokenText}"`);

  // TEST 9: Employee projects query (Zain)
  const res9 = await voiceQueryEngine.processQuery('How many projects does Zain have?', createAdminCtx());
  assert(res9.success && res9.spokenText.includes('Zain') && res9.count === 2, 'Test 9: How many projects does Zain have?');
  console.log(`   Assistant: "${res9.spokenText}"`);

  // TEST 10: Employee workload ranking
  const res10 = await voiceQueryEngine.processQuery('Which employee has the most active projects?', createAdminCtx());
  assert(res10.success && res10.spokenText.length > 0, 'Test 10: Which employee has the most active projects?');
  console.log(`   Assistant: "${res10.spokenText}"`);

  // TEST 11: Overdue tasks query
  const res11 = await voiceQueryEngine.processQuery('How many tasks are overdue?', createAdminCtx());
  assert(res11.success && res11.spokenText.includes('overdue task'), 'Test 11: How many tasks are overdue?');
  console.log(`   Assistant: "${res11.spokenText}"`);

  // TEST 12: My tasks query (authenticated context)
  const res12Admin = await voiceQueryEngine.processQuery('What are my tasks?', createAdminCtx());
  const res12Emp = await voiceQueryEngine.processQuery('What are my tasks?', createEmployeeCtx());
  assert(res12Admin.success && res12Emp.success, 'Test 12: Authenticated user "What are my tasks?"');
  console.log(`   Admin tasks: "${res12Admin.spokenText}"`);
  console.log(`   Employee tasks: "${res12Emp.spokenText}"`);

  // TEST 13: Finance income query (Admin authorized)
  const res13 = await voiceQueryEngine.processQuery("What's our income this month?", createAdminCtx());
  assert(res13.success && res13.spokenText.includes('income'), 'Test 13: Income this month (Admin)');
  console.log(`   Assistant: "${res13.spokenText}"`);

  // TEST 14: Client receivables query (Admin authorized)
  const res14 = await voiceQueryEngine.processQuery('How much are clients currently owing us?', createAdminCtx());
  assert(res14.success && (res14.spokenText.includes('owe') || res14.spokenText.includes('balance')), 'Test 14: Client receivables (Admin)');
  console.log(`   Assistant: "${res14.spokenText}"`);

  // TEST 15: Currency awareness (PKR conversion)
  const res15PKR = await voiceQueryEngine.processQuery("What's our income this month?", createAdminCtx('PKR'));
  assert(res15PKR.success && res15PKR.spokenText.includes('Rs.'), 'Test 15: Currency formatting (PKR)');
  console.log(`   Assistant (PKR): "${res15PKR.spokenText}"`);

  // TEST 16: RBAC Security — Employee accessing company finance -> Denied
  const res16 = await voiceQueryEngine.processQuery("What's our income this month?", createEmployeeCtx());
  assert(!res16.success && res16.error === 'permission_denied', 'Test 16: RBAC - Employee denied company financials');
  console.log(`   Assistant (Denied): "${res16.spokenText}"`);

  // TEST 17: RBAC Security — Employee accessing company payroll -> Denied
  const res17 = await voiceQueryEngine.processQuery("What's the payroll outstanding this month?", createEmployeeCtx());
  assert(!res17.success && res17.error === 'permission_denied', 'Test 17: RBAC - Employee denied payroll summary');
  console.log(`   Assistant (Denied): "${res17.spokenText}"`);

  // TEST 18: RBAC Security — Client accessing team tasks -> Denied
  const res18 = await voiceQueryEngine.processQuery('How many tasks are overdue?', createClientCtx());
  assert(!res18.success && res18.error === 'permission_denied', 'Test 18: RBAC - Client denied internal tasks');
  console.log(`   Assistant (Denied): "${res18.spokenText}"`);

  // TEST 19: RBAC Security — Client accessing other clients' projects -> Denied
  const res19 = await voiceQueryEngine.processQuery('What projects does BCH have?', createClientCtx());
  assert(!res19.success && res19.error === 'permission_denied', 'Test 19: RBAC - Client denied other clients data');
  console.log(`   Assistant (Denied): "${res19.spokenText}"`);

  // TEST 20: Revisions Multi-turn Follow-up ("How many are in revision?" -> "Which ones?")
  voiceQueryEngine.clearMemory();
  const res20a = await voiceQueryEngine.processQuery('How many are in revision?', createAdminCtx());
  const res20b = await voiceQueryEngine.processQuery('Which ones?', createAdminCtx());
  assert(res20a.success && res20b.success && res20b.spokenText.includes('Founder Notes Workbook'), 'Test 20: Revisions follow-up "Which ones?"');
  console.log(`   Assistant: "${res20b.spokenText}"`);

  // TEST 21: Who is working on [Project]
  const res21 = await voiceQueryEngine.processQuery('Who is working on The Quiet Atlas?', createAdminCtx());
  assert(res21.success && res21.spokenText.includes('Zain'), 'Test 21: Who is working on The Quiet Atlas?');
  console.log(`   Assistant: "${res21.spokenText}"`);

  // TEST 22: Specific Client Receivables
  const res22 = await voiceQueryEngine.processQuery('How much does BCH owe us?', createAdminCtx());
  assert(res22.success && res22.spokenText.includes('$1,000'), 'Test 22: How much does BCH owe us?');
  console.log(`   Assistant: "${res22.spokenText}"`);

  // TEST 23: Specific project revisions query
  const res23 = await voiceQueryEngine.processQuery('What are the latest revisions on Founder Notes Workbook?', createAdminCtx());
  assert(res23.success && res23.spokenText.includes('revision'), 'Test 23: Latest revisions on Founder Notes Workbook');
  console.log(`   Assistant: "${res23.spokenText}"`);

  // TEST 24: Team Payroll Obligation
  const res24 = await voiceQueryEngine.processQuery('How much do we owe the team?', createAdminCtx());
  assert(res24.success && res24.spokenText.includes('payroll obligation'), 'Test 24: How much do we owe the team?');
  console.log(`   Assistant: "${res24.spokenText}"`);

  console.log('====================================================');
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  if (passed === total) {
    console.log('🎉 ALL VOICE ASSISTANT TESTS PASSED SUCCESSFULLY!');
  } else {
    throw new Error(`${total - passed} tests failed!`);
  }
}
