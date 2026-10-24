import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AIAssistantPage.tsx', 'utf8');
const messages = readFileSync('src/components/ai/AIChatMessage.tsx', 'utf8');
const context = readFileSync('src/lib/ai/aiContext.tsx', 'utf8');

assert.match(page, /AI Assistant Dashboard V2/, 'V2 shell is present');
for (const required of ['Quick Commands', 'Voice Command Center', 'Live transcript', 'AI Assistant V2 workspace', 'Conversation History', 'Workspace Intelligence &amp; Briefing']) {
  assert.ok(page.includes(required), 'V2 includes ' + required);
}
assert.ok(
  page.indexOf('Left: role-aware commands') < page.indexOf('Center: manual, state-driven voice experience') &&
  page.indexOf('Center: manual, state-driven voice experience') < page.indexOf('Right: persistent conversation'),
  'V2 preserves left commands, center voice, right chat structure',
);
assert.match(page, /xl:grid-cols-\[250px_minmax\(290px,0\.82fr\)_minmax\(360px,1\.18fr\)\]/, 'desktop three-panel grid exists');
assert.match(page, /fixed inset-0 z-\[80\]/, 'small screens have a commands drawer backdrop');
assert.match(page, /const assistantState = voiceError/, 'voice state responds to errors');
assert.match(page, /isListening[\s\S]*isSpeaking[\s\S]*isProcessing/, 'listening, speaking, processing states are represented');
assert.match(page, /onClick=\{handleVoiceToggle\}/, 'microphone remains a direct user action');
assert.match(page, /stopVoice\(\);\s*stopSpeaking\(\)/, 'manual stop and navigation stop both voice paths');
assert.doesNotMatch(page, /toggleWakeWordListener|Hey James On/, 'no always-on wake affordance');
assert.match(page, /messageScrollRef\.current/, 'chat scroll stays scoped to messages');
assert.doesNotMatch(page, /scrollIntoView/, 'conversation scroll does not jump the entire page');
assert.match(page, /<AIChatMessage\s+dark/, 'V2 chat renders with dark bubbles');
assert.match(messages, /dark\?: boolean/, 'dark appearance is optional for existing floating chat');
assert.match(messages, /AIActionPreviewCard/, 'action confirmations still use existing preview component');
assert.match(context, /aiService\.loadConversations/, 'existing saved conversation service is preserved');
console.log('AI Assistant Dashboard V2 layout, safety, responsive and conversation checks passed.');
