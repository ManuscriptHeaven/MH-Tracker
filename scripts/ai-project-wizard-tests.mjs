import fs from 'node:fs';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ PASS: ${message}`);
}

const wizard = read('src/lib/ai/projectCreationWizard.ts');
const engine = read('src/lib/ai/voiceQueryEngine.ts');
const actions = read('src/lib/ai/safeActionTools.ts');
const types = read('src/lib/ai/aiTypes.ts');
const page = read('src/pages/AIAssistantPage.tsx');

console.log('--- AI Project Creation Wizard Static Tests ---');

assert(
  types.includes('ProjectCreationMemoryDraft') &&
    types.includes('pendingProjectCreation'),
  'conversation memory stores guided project creation state',
);

assert(
  wizard.includes("!draft.projectTitle ? 'projectTitle'") &&
    wizard.includes("!draft.clientName ? 'clientName'") &&
    wizard.includes("!draft.serviceType ? 'serviceType'") &&
    wizard.includes("'totalPrice'") &&
    wizard.includes("!draft.dueDate ? 'dueDate'"),
  'wizard requires title, client, service, total price and due date before preview',
);

assert(
  wizard.includes('Still needed:') &&
    wizard.includes('Optional fields: assignee, project manager, priority, start date, client email, advance paid, and notes.'),
  'wizard clearly asks for missing core fields and documents optional metadata',
);

assert(
  wizard.includes("return { requiresPrint: true, requiresEbook: true }") &&
    wizard.includes("return { requiresPrint: false, requiresEbook: true }") &&
    wizard.includes("return { requiresPrint: true, requiresEbook: false }"),
  'service type resolves canonical Print/eBook capability flags',
);

assert(
  engine.includes('runProjectCreationWizard') &&
    engine.includes('HANDLE PROJECT CREATION WIZARD') &&
    engine.includes('this.memory.pendingProjectCreation'),
  'voice engine continues project setup across multiple chat turns',
);

assert(
  actions.includes('requires_print: payload.requiresPrint') &&
    actions.includes('requires_ebook: payload.requiresEbook') &&
    actions.includes("priority: payload.priority || 'Normal'") &&
    actions.includes('internal_deadline: dueDate'),
  'confirmed AI creation sends a canonical project payload to the tracker',
);

assert(
  !actions.includes("@client.com") &&
    actions.includes("knownClientProject?.client_email || ''"),
  'project creation reuses known client email and never invents a fake client address',
);

assert(
  actions.includes("if (!isManagerRole(ctx.currentProfile.role))") &&
    actions.includes("error: 'project_fields_required'") &&
    actions.includes("error: 'project_capabilities_required'"),
  'project execution independently enforces role, required fields and capabilities',
);

assert(
  page.includes("label: 'New Project'") &&
    page.includes("query: 'Create a new project'"),
  'AI Command Center exposes a New Project wizard shortcut for managers',
);

if (process.exitCode) {
  console.error('AI Project Creation Wizard checks failed.');
} else {
  console.log('ALL AI PROJECT CREATION WIZARD CHECKS PASSED.');
}
