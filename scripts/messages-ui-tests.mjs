import fs from 'node:fs';
import path from 'node:path';

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

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const app = read('src/App.tsx');
const login = read('src/pages/LoginPage.tsx');
const messages = read('src/pages/CommunicationPage.tsx');
const files = sourceFiles('src');

console.log('--- Messages UI / Demo Cleanup Static Tests ---');

assert(
  !app.includes('DemoRoleSwitcher') &&
    !app.includes('handleSwitchRole') &&
    !app.includes('onSwitchRole={'),
  'global demo role switcher is removed from the authenticated app shell',
);

const forbiddenDemoPresentation = ['Live Demo Switcher', '1-Click Role Preview', 'Demo Role:'];
const demoPresentationHits = files.flatMap((file) => {
  const content = read(file);
  return forbiddenDemoPresentation
    .filter((phrase) => content.includes(phrase))
    .map((phrase) => `${file}: ${phrase}`);
});
assert(
  demoPresentationHits.length === 0,
  'no floating/global demo presentation copy remains in application screens',
);

assert(
  login.includes('!isSupabaseConfigured ?') &&
    login.includes('Admin Demo Preview') &&
    !login.includes('1-Click Demo Showcase'),
  'production login hides demo access while local development keeps an admin-only preview',
);

assert(
  messages.includes('const [contextPanelOpen, setContextPanelOpen] = useState(false)'),
  'conversation info is an optional drawer instead of consuming chat width by default',
);

assert(
  messages.includes('<textarea') &&
    messages.includes('Shift+Enter for a new line') &&
    messages.includes('max-h-32'),
  'message composer supports real multiline messages with Enter/Shift+Enter behavior',
);

assert(
  messages.includes('w-80 xl:w-[21rem]') &&
    messages.includes('max-w-5xl') &&
    messages.includes('rounded-2xl'),
  'messages layout uses a wider conversation rail and focused readable chat column',
);

assert(
  messages.includes('>Inbox</h2>') &&
    messages.includes('All caught up') &&
    messages.includes('unread message'),
  'messages workspace exposes a concise inbox/unread summary',
);

assert(
  messages.includes("max-w-[78%] sm:max-w-[72%]") &&
    messages.includes('text-[13px] leading-6'),
  'message bubbles have improved width and readable typography',
);

assert(
  messages.includes('const canOpen =') &&
    messages.includes('disabled={!canOpen}') &&
    messages.includes("p.status === 'active' && p.role !== 'client'") &&
    messages.includes("p.status === 'active' && p.id !== currentProfile.id"),
  'compose and mention pickers prevent invalid or inactive messaging targets',
);

assert(
  messages.includes('for (const conversation of allConversations)') &&
    messages.includes("filterMode === 'all' || Boolean(conv && convPassesFilter(conv.id))") &&
    messages.includes('convMatchesSearch(c,') &&
    messages.includes('const searchMatches = conv'),
  'conversation unread filters and search behave consistently across client, DM, project, and channel lists',
);

assert(
  !messages.includes('Mute Notifications') &&
    !messages.includes('Search in Conversation'),
  'unimplemented conversation actions are not presented as working controls',
);

if (process.exitCode) {
  console.error('Messages UI / demo cleanup regression checks failed.');
} else {
  console.log('ALL MESSAGES UI / DEMO CLEANUP CHECKS PASSED.');
}
