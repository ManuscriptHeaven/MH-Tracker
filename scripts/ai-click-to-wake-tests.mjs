import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voiceService } from '../src/lib/ai/voiceService.ts';

const read = (path) => readFileSync(path, 'utf8');
const context = read('src/lib/ai/aiContext.tsx');
const page = read('src/pages/AIAssistantPage.tsx');
const button = read('src/components/ai/AIChatButton.tsx');
const app = read('src/App.tsx');
const settings = read('src/components/ai/AISettingsSection.tsx');

assert.match(context, /wakeWordEnabled: false/, 'synced settings never turn the mic on');
assert.doesNotMatch(context, /wakeWordService\.startListening\(/, 'legacy always-on loop is gone');
assert.match(context, /enabled: parsed\.enabled === true/, 'hands-free is off unless explicitly switched on');
assert.match(context, /wakeWordService\.disable\(\)/, 'switching hands-free off releases the microphone');
assert.match(context, /wakeWordService\.pause\(\)/, 'wake listener pauses while a command is taken or answered');
assert.match(context, /void voiceService\.startListening\(settingsRef\.current\.voiceLanguage\)/, 'floating click wakes voice only on demand');
assert.match(context, /if \(isOpen\)\s*\{\s*closeChat\(\)/, 'second button click sleeps and releases voice');
assert.match(context, /isOpenRef\.current \|\| activeViewRef\.current === 'ai_assistant'/, 'background results cannot speak after sleep');
assert.match(page, /Tap to Speak/, 'command center keeps manual microphone activation');
assert.match(page, /stopVoice\(\);\s*stopSpeaking\(\)/, 'navigating away stops voice');
assert.match(button, /Wake Assistant/, 'floating button is discoverable');
assert.doesNotMatch(app, /<AIDailyPopup\s*\/>/, 'assistant does not automatically interrupt workspace');
assert.doesNotMatch(settings, /handleToggle\('wakeWordEnabled'\)/, 'cannot accidentally turn on background listening from settings sync');

// Wake phrase parsing
const { parseWakePhrase } = await import('../src/lib/ai/wakeWordService.ts');
assert.deepEqual(parseWakePhrase('Hey Nova, assign a task to Zain', 'Nova'), { command: 'assign a task to Zain' });
assert.deepEqual(parseWakePhrase('ok nova', 'Nova'), { command: '' });
assert.deepEqual(parseWakePhrase('hey noba create a task', 'Nova'), { command: 'create a task' }, 'one-letter mishearing tolerated');
assert.equal(parseWakePhrase('we will talk to nova later', 'Nova'), null, 'name in normal talk does not wake');
assert.equal(parseWakePhrase('hey zain how are you', 'Nova'), null);

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

// Hands-free runtime: wake -> pause (mic released) -> resume -> disable.
{
  const { wakeWordService } = await import('../src/lib/ai/wakeWordService.ts');
  const instances = [];
  class FakeContinuous {
    constructor() { this.started = 0; this.aborted = 0; instances.push(this); }
    start() { this.started++; }
    abort() { this.aborted++; }
  }
  globalThis.window = { SpeechRecognition: FakeContinuous };
  let woke = null;
  wakeWordService.onWake = (command) => { woke = command; };
  wakeWordService.enable('Nova', 'en-US');
  assert.equal(instances.length, 1, 'enabling starts one listener');
  assert.equal(wakeWordService.getIsListening(), true);
  const live = instances[0];
  live.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'what time is it' }], { isFinal: true })] });
  assert.equal(woke, null, 'ordinary speech is ignored');
  live.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'hey Nova assign a task to Zain' }], { isFinal: true })] });
  assert.equal(woke, 'assign a task to Zain', 'wake phrase hands over the command');
  assert.equal(live.aborted, 1, 'listener releases the mic while the command runs');
  assert.equal(wakeWordService.getIsListening(), false);
  wakeWordService.resume();
  assert.equal(instances.length, 2, 'listener resumes after the command');
  wakeWordService.disable();
  assert.equal(instances[1].aborted, 1, 'turning hands-free off releases the mic');
  wakeWordService.resume();
  assert.equal(instances.length, 2, 'resume does nothing once disabled');
  wakeWordService.onWake = undefined;
}

console.log('AI click-to-wake behavior and cancellation checks passed.');
