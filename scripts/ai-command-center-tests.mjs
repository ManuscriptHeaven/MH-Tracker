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

const page = read('src/pages/AIAssistantPage.tsx');
const panel = read('src/components/ai/AIChatPanel.tsx');
const message = read('src/components/ai/AIChatMessage.tsx');
const context = read('src/lib/ai/aiContext.tsx');
const service = read('src/lib/ai/aiService.ts');
const tools = read('src/lib/ai/secureTools.ts');
const actions = read('src/lib/ai/safeActionTools.ts');
const engine = read('src/lib/ai/voiceQueryEngine.ts');
const app = read('src/App.tsx');

console.log('--- AI Command Center Static Tests ---');

assert(
  page.includes('AI Command Center') &&
    page.includes('Conversation History') &&
    page.includes('Live Workspace Intelligence'),
  'full AI page is a business command center with saved chat history',
);

assert(
  page.includes('currentProfile: Profile') &&
    page.includes('firstName(currentProfile.full_name)') &&
    !page.includes('Welcome back, Tahir'),
  'AI page uses the signed-in profile instead of a hard-coded user name',
);

assert(
  page.includes('<textarea') &&
    page.includes('Shift+Enter') &&
    page.includes('Quick Commands') &&
    page.includes('write actions require confirmation'),
  'AI page has a responsive multiline composer and confirmation-aware quick commands',
);

assert(
  panel.includes('<textarea') &&
    panel.includes('Start fresh chat') &&
    panel.includes('Writes require confirmation') &&
    !panel.includes('Phase 2 Safe Actions'),
  'floating assistant panel matches the current safe-action UX and supports multiline input',
);

assert(
  !message.includes('dangerouslySetInnerHTML') &&
    message.includes('SafeMessageContent') &&
    message.includes('renderInlineMarkdown'),
  'assistant content is rendered through safe React elements instead of raw HTML injection',
);

assert(
  service.includes('async createConversation(') &&
    service.includes('async saveMessage(') &&
    service.includes('async touchConversation(') &&
    service.includes('dismissed_date:'),
  'AI service persists conversations/messages and uses the correct daily-dismissal schema',
);

assert(
  context.includes('aiService.loadConversations') &&
    context.includes('aiService.loadMessages') &&
    context.includes('aiService.createConversation') &&
    context.includes('aiService.saveMessage'),
  'AI context loads and persists conversation history',
);

const metadataStart = context.indexOf('function persistentMessageMetadata');
const metadataEnd = context.indexOf('function suggestedFollowUpsForResult', metadataStart);
const metadataBlock =
  metadataStart >= 0 && metadataEnd > metadataStart
    ? context.slice(metadataStart, metadataEnd)
    : '';
assert(
  metadataBlock.length > 0 &&
    !metadataBlock.includes('pendingAction:') &&
    !metadataBlock.includes('disambiguation:'),
  'persisted historical metadata excludes stale pending actions and disambiguation state',
);

assert(
  tools.includes('Order Revenue') &&
    tools.includes('Revenue Less Expenses') &&
    tools.includes("transaction.type === 'expense'") &&
    tools.includes('monthOrders.reduce') &&
    !tools.includes("if (t.type === 'income')"),
  'finance read intelligence uses automatic order revenue plus operating expenses',
);

assert(
  engine.includes("toolName: 'record_project_payment'") &&
    engine.includes("error: 'manual_income_disabled'") &&
    engine.includes('Client payments must be applied to a specific project'),
  'AI finance actions route client payments to project balances and block manual revenue entry',
);

assert(
  actions.includes('execute_record_project_payment') &&
    actions.includes('payment_exceeds_balance') &&
    actions.includes('advance_paid: newPaid') &&
    actions.includes('Order revenue is unchanged'),
  'project-payment execution validates balance, updates paid state, and avoids revenue double-counting',
);

assert(
  app.includes('<AIAssistantPage projects={visibleProjects} currentProfile={tracker.currentProfile} />'),
  'App passes the signed-in profile to the AI command center',
);

if (process.exitCode) {
  console.error('AI Command Center regression checks failed.');
} else {
  console.log('ALL AI COMMAND CENTER CHECKS PASSED.');
}
