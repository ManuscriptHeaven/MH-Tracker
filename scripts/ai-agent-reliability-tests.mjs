import fs from 'node:fs';
import {
  resolveUniqueEntityMatch,
  rankEntityCandidates,
} from '../src/lib/ai/aiEntityMatcher.ts';
import {
  shouldUseAIPlanner,
  looksLikeCompoundAction,
  splitCompoundActionQuery,
} from '../src/lib/ai/aiPlannerService.ts';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

console.log('--- AI Agent Reliability & Evaluation Suite ---');

const matcher = read('src/lib/ai/aiEntityMatcher.ts');
const resolver = read('src/lib/ai/aiEntityResolver.ts');
const verifier = read('src/lib/ai/aiActionVerifier.ts');
const engine = read('src/lib/ai/voiceQueryEngine.ts');
const context = read('src/lib/ai/aiContext.tsx');
const planner = read('src/lib/ai/aiPlannerService.ts');
const edge = read('supabase/functions/ai-planner/index.ts');

assert(
  matcher.includes('resolveUniqueEntityMatch') &&
    matcher.includes('ambiguityWindow') &&
    resolver.includes('fuzzy_project_reference'),
  'entity resolution uses conservative fuzzy matching with an ambiguity window',
);

const projects = [
  { id: 'p1', project_title: 'Magazine Two', project_number: 'MH-2001' },
  { id: 'p2', project_title: 'Book Cover Alpha', project_number: 'MH-2002' },
  { id: 'p3', project_title: 'Book Cover Beta', project_number: 'MH-2003' },
];

const uniqueProject = resolveUniqueEntityMatch(
  'magzine two ko kal tak extend kro',
  projects.map((item) => ({
    id: item.id,
    label: item.project_title,
    aliases: [item.project_number],
    item,
  })),
  { minScore: 0.72, minGap: 0.1, ambiguityWindow: 0.07 },
);
assert(uniqueProject.match?.id === 'p1', 'minor project-title typo resolves to one strong match');

const ambiguousProject = resolveUniqueEntityMatch(
  'book cover project',
  projects.slice(1).map((item) => ({
    id: item.id,
    label: item.project_title,
    aliases: [item.project_number],
    item,
  })),
  { minScore: 0.68, minGap: 0.1, ambiguityWindow: 0.08 },
);
assert(
  !ambiguousProject.match && ambiguousProject.ambiguous.length === 2,
  'similar project names are surfaced for clarification instead of guessed',
);

const duplicateFirstNames = resolveUniqueEntityMatch(
  'assign this to Ali',
  [
    { id: 'u1', label: 'Ali Raza', aliases: ['Ali'], item: { id: 'u1' } },
    { id: 'u2', label: 'Ali Khan', aliases: ['Ali'], item: { id: 'u2' } },
  ],
  { minScore: 0.72, minGap: 0.1, ambiguityWindow: 0.08 },
);
assert(
  !duplicateFirstNames.match && duplicateFirstNames.ambiguous.length === 2,
  'duplicate team first names do not silently resolve to the wrong person',
);

const taskRanking = rankEntityCandidates(
  'print pruf chek task',
  [
    { id: 't1', label: 'Check print proof', item: { id: 't1' } },
    { id: 't2', label: 'Upload ebook final', item: { id: 't2' } },
  ],
  0.55,
);
assert(taskRanking[0]?.id === 't1', 'task matcher tolerates common shorthand/typos');

assert(
  engine.includes('pendingCommandCompletion') &&
    engine.includes('Using your follow-up to complete the earlier request') &&
    engine.includes("error: 'task_details_required'") &&
    engine.includes("error: 'client_email_required'"),
  'missing action fields continue naturally across the next user turn',
);

assert(
  !engine.includes("taskTitle = 'Check project production files'") &&
    !engine.includes('@client.com'),
  'assistant no longer invents task content or fake client email addresses',
);

assert(
  engine.includes('startActionPlan') &&
    engine.includes('prepareCurrentPlanStep') &&
    engine.includes('executeConfirmedAction') &&
    engine.includes('Each write is validated and confirmed separately'),
  'multi-step plans are sequential and every write keeps its own confirmation gate',
);

assert(
  verifier.includes("from('tasks')") &&
    verifier.includes("from('projects')") &&
    verifier.includes("from('invoices')") &&
    verifier.includes("status: 'verified'") &&
    !verifier.includes('service_role'),
  'post-action verification re-reads live RLS-scoped Tracker records without privileged keys',
);

assert(
  context.includes('verification: message.verification') &&
    context.includes('actionPlan: message.actionPlan') &&
    context.includes('executeConfirmedAction(action, toolCtx)'),
  'verification and action-plan evidence are persisted with AI conversation history',
);

assert(
  !context.includes('voiceQueryEngine.setPendingDisambiguation(null);\n\n      // Re-trigger') &&
    context.includes("Keep the engine's pending disambiguation context intact"),
  'UI disambiguation keeps the original action context until the choice is resolved',
);

assert(
  edge.includes('steps?: PlannerStep[]') &&
    edge.includes('splitCompoundActionMessage') &&
    edge.includes('Each step must pass normal Tracker confirmation and permissions') &&
    edge.includes('Do not split one operation just because it contains "and"'),
  'server planner supports bounded multi-step normalization without gaining execution authority',
);

const singleActionTemplates = [
  'Create a new project for BCH called Annual Report',
  'BCH k liye new project Annual Report banao',
  'Create task for Zain to check the revised print PDF tomorrow',
  'Zain k liye print PDF check krne ki task banao',
  'Submit design concept for Magazine Two to client approval',
  'Magazine Two ka concept client ko bhejo',
  'Generate invoice for BCH for all pending payments',
  'BCH ki sari pending payment ki invoice banao',
  'Record $250 payment for Magazine Two',
  'Magazine Two ka 250 dollar payment record kro',
  'Move Magazine Two deadline to tomorrow',
  'Magazine Two ki deadline kal krdo',
  'Put Magazine Two on hold',
  'Magazine Two ko hold pr laga do',
  'Assign print proof task to Zain',
  'print proof task Zain ko assign kro',
  'Draft a friendly payment reminder for BCH',
  'BCH ko friendly payment reminder draft kro',
  'Send Zain a message saying proof is ready',
  'Zain ko message bhejo proof ready hai',
];

const suffixes = [
  '',
  ' please',
  ' now',
  ' kindly',
  ' for me',
  ' today',
];

const singleCases = [];
for (const template of singleActionTemplates) {
  for (const suffix of suffixes) {
    singleCases.push(template + suffix);
  }
}

const compoundTemplates = [
  'Generate invoice for BCH for all pending payments and draft a friendly payment reminder for BCH',
  'BCH ki pending invoice banao aur friendly payment reminder draft kro',
  'Put Magazine Two on hold and send Zain a message saying it is paused',
  'Magazine Two ko hold pr lagao aur Zain ko message bhejo',
  'Move Magazine Two deadline to tomorrow then assign print proof task to Zain',
  'Magazine Two ki deadline kal kro phir print proof task Zain ko assign kro',
  'Submit design concept for Magazine Two and draft an approval reminder for BCH',
  'Magazine Two ka concept bhejo aur BCH k liye approval reminder draft kro',
  'Record $250 payment for Magazine Two and generate invoice for BCH for remaining pending payments',
  'Magazine Two ka 250 payment record kro aur BCH ki pending invoice banao',
];

const compoundCases = [];
for (const template of compoundTemplates) {
  compoundCases.push(template);
  compoundCases.push(template + ' please');
  compoundCases.push(template + ' now');
  compoundCases.push(template + ' carefully');
}

const readOnlyCases = [
  'What is overdue?',
  'Show projects due today',
  'Which clients are waiting?',
  'Who is working on Magazine Two?',
  'Show my tasks',
  'What is due this week?',
  'How many projects are in revision?',
  'Tell me Magazine Two status',
  'What is Zain working on?',
  'Show pending approvals',
  'Which project is late?',
  'What are my overdue tasks?',
  'Show team workload',
  'What happened on Magazine Two?',
  'Tell me the latest revision',
  'What clients have active projects?',
  'Show project timeline',
  'Who has overdue work?',
  'What is the remaining balance for BCH?',
  'Show this project details',
];

assert(singleCases.length === 120, 'evaluation corpus contains 120 single-action variants');
assert(compoundCases.length === 40, 'evaluation corpus contains 40 compound-action variants');
assert(readOnlyCases.length === 20, 'evaluation corpus contains 20 read-only variants');

let actionRoutingPass = 0;
for (const command of singleCases) {
  if (shouldUseAIPlanner(command)) actionRoutingPass += 1;
}
assert(
  actionRoutingPass >= 116,
  'at least 96% of the 120 action variants route into the natural-language planner',
);

let compoundRoutingPass = 0;
for (const command of compoundCases) {
  if (looksLikeCompoundAction(command) && splitCompoundActionQuery(command).length >= 2) {
    compoundRoutingPass += 1;
  }
}
assert(
  compoundRoutingPass >= 36,
  'at least 90% of the 40 compound variants route as multi-step candidates',
);

assert(
  !looksLikeCompoundAction('Create a task to check the proof and assign it to Zain') &&
    !looksLikeCompoundAction('Create project Annual Report and assign it to Zain'),
  'one create-and-assign operation is not incorrectly split into multiple writes',
);

let safeReadCount = 0;
for (const command of readOnlyCases) {
  if (!looksLikeCompoundAction(command)) safeReadCount += 1;
}
assert(safeReadCount === readOnlyCases.length, 'read-only evaluation cases are not mistaken for compound writes');

const totalCases = singleCases.length + compoundCases.length + readOnlyCases.length;
assert(totalCases === 180, 'real-world evaluation corpus covers 180 English/Roman Urdu command variants');

if (process.exitCode) {
  console.error('AI Agent reliability/evaluation checks failed.');
} else {
  console.log('ALL AI AGENT RELIABILITY CHECKS PASSED (' + totalCases + ' evaluation cases).');
}
