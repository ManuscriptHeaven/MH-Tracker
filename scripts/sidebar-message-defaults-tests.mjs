import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const layout = fs.readFileSync('src/components/Layout.tsx', 'utf8');
const messages = fs.readFileSync('src/pages/CommunicationPage.tsx', 'utf8');

console.log('--- Collapsible Sidebar + New Message Defaults ---');

assert(
  layout.includes('const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false)') &&
    layout.includes("desktopSidebarOpen ? 'translate-x-0' : '-translate-x-full'") &&
    layout.includes("title={desktopSidebarOpen ? 'Close sidebar' : 'Open sidebar'}"),
  'desktop sidebar is closed by default and can be opened from the header',
);

assert(
  layout.includes('projects_group: false') &&
    layout.includes('tasks_group: false') &&
    layout.includes('finance_group: false') &&
    layout.includes('management_group: false'),
  'all nested sidebar groups are collapsed by default',
);

assert(
  !layout.includes('getGroupForView(activeView)') &&
    !layout.includes('setActiveView(entry.children[0].id)'),
  'active pages do not force groups open and expanding a group does not navigate',
);

assert(
  layout.includes('<main className="pb-24 lg:pb-0">') &&
    !layout.includes('lg:ml-72'),
  'main workspace stays full width while desktop sidebar is closed',
);

assert(
  messages.includes('const [showNewMsg, setShowNewMsg] = useState(() => !isClient)') &&
    !messages.includes('Auto-select first conversation') &&
    !messages.includes('setActiveConversationId(allConversations[0].id)'),
  'Messages opens in New Message state instead of the previous/first chat',
);

assert(
  messages.includes('const [dmsCollapsed, setDmsCollapsed] = useState(true)') &&
    messages.includes('const [projectsCollapsed, setProjectsCollapsed] = useState(true)') &&
    messages.includes('const [channelsCollapsed, setChannelsCollapsed] = useState(true)'),
  'message sidebar sections are collapsed by default',
);

assert(
  messages.includes("Previous chats stay closed until you choose one.") &&
    messages.includes('Compose New Message'),
  'empty Messages workspace clearly presents a fresh compose action',
);

assert(
  messages.includes('setShowNewMsg(false);\n    setActiveConversationId(jumpToConversationId)'),
  'notification deep links close the composer and open the requested conversation',
);

if (process.exitCode) {
  console.error('Sidebar / New Message regression checks failed.');
} else {
  console.log('ALL SIDEBAR / NEW MESSAGE CHECKS PASSED.');
}
