import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voiceService } from '../src/lib/ai/voiceService.ts';

const read = (path) => readFileSync(path, 'utf8');
const context = read('src/lib/ai/aiContext.tsx');
const page = read('src/pages/AIAssistantPage.tsx');
const button = read('src/components/ai/AIChatButton.tsx');
const app = read('src/App.tsx');
const settings = read('src/components/ai/AISettingsSection.tsx');

assert.match(context, /wakeWordEnabled: false/, 'background wake word defaults off');
assert.doesNotMatch(context, /wakeWordService\.startListening\(/, 'no always-listening wake loop');
assert.match(context, /wakeWordService\.stopListening\(\)/, 'legacy wake listener is stopped');
assert.match(context, /void voiceService\.startListening\(settingsRef\.current\.voiceLanguage\)/, 'floating click wakes voice only on demand');
assert.match(context, /if \(isOpen\)\s*\{\s*closeChat\(\)/, 'second button click sleeps and releases voice');
assert.match(context, /isOpenRef\.current \|\| activeViewRef\.current === 'ai_assistant'/, 'background results cannot speak after sleep');
assert.doesNotMatch(page, /toggleWakeWordListener|Hey James On/, 'command center does not expose always-on toggle');
assert.match(page, /Click to Speak/, 'command center communicates manual microphone activation');
assert.match(page, /stopVoice\(\);\s*stopSpeaking\(\)/, 'navigating away stops voice');
assert.match(button, /Wake Assistant/, 'floating button is discoverable');
assert.doesNotMatch(app, /<AIDailyPopup\s*\/>/, 'assistant does not automatically interrupt workspace');
assert.doesNotMatch(settings, /handleToggle\('wakeWordEnabled'\)/, 'cannot accidentally turn on background listening');

// Runtime regression: closing while the browser permission prompt is pending
// must not open a microphone afterward.
let starts = 0;
let aborts = 0;
let permissionResolve;
let pendingPermission = new Promise((resolve) => { permissionResolve = resolve; });
const fakeStream = { getTracks: () => [{ stop() {} }] };

class FakeSpeechRecognition {
  start() { starts++; this.onstart?.(); }
  abort() { aborts++; this.onend?.(); }
}
globalThis.window = { SpeechRecognition: FakeSpeechRecognition };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: () => pendingPermission } },
});
const firstStart = voiceService.startListening('en-US');
voiceService.stopListening();
permissionResolve(fakeStream);
await firstStart;
assert.equal(starts, 0, 'closed assistant never starts after mic permission resolves');

globalThis.navigator.mediaDevices.getUserMedia = () => Promise.resolve(fakeStream);
await voiceService.startListening('en-US');
assert.equal(starts, 1, 'one explicit start activates one speech session');
voiceService.stopListening();
assert.equal(aborts, 1, 'closing aborts active recognition');
assert.equal(starts, 1, 'microphone is not automatically restarted');

console.log('AI click-to-wake behavior and cancellation checks passed.');
