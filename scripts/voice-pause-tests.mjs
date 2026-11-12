import assert from 'node:assert/strict';
import { voiceService as voice } from '../src/lib/ai/voiceService.ts';

const realSet = globalThis.setTimeout,
  realClear = globalThis.clearTimeout;
let now = 0,
  id = 0;
const timers = new Map();
globalThis.setTimeout = (fn, delay = 0) => {
  const key = ++id;
  timers.set(key, { at: now + delay, fn });
  return key;
};
globalThis.clearTimeout = (key) => timers.delete(key);
function tick(ms) {
  const end = now + ms;
  while (true) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
  }
  now = end;
}
const recognizers = [];
class Recognition {
  constructor() {
    recognizers.push(this);
  }
  start() {
    this.onstart?.();
  }
  abort() {
    this.onend?.();
  }
}
globalThis.window = { SpeechRecognition: Recognition };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
});
const events = [],
  errors = [];
voice.onTranscript = (text, final) => events.push({ text, final });
voice.onError = (text) => errors.push(text);
const final = (rec, text) =>
  rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
try {
  await voice.startListening();
  const first = recognizers.at(-1);
  final(first, 'Create a task for Zain');
  tick(1500);
  assert.equal(events.filter((e) => e.final).length, 0);
  first.onend();
  tick(100);
  const second = recognizers.at(-1);
  assert.notEqual(second, first, 'Recognition reopens within the same speaking session');
  second.onspeechstart();
  tick(3000);
  assert.equal(
    events.filter((e) => e.final).length,
    0,
    'Ongoing speech cancels the pause deadline',
  );
  final(second, 'to prepare the ebook tomorrow');
  second.onspeechend();
  tick(2499);
  assert.equal(events.filter((e) => e.final).length, 0);
  tick(1);
  assert.deepEqual(
    events.filter((e) => e.final),
    [{ text: 'Create a task for Zain to prepare the ebook tomorrow', final: true }],
  );
  tick(10000);
  assert.equal(events.filter((e) => e.final).length, 1, 'A request is submitted once');
  console.log(
    'PASS short pauses and browser end events combine phrases into one request after 2.5 seconds',
  );

  await voice.startListening();
  const stopped = recognizers.at(-1);
  final(stopped, 'confirm');
  stopped.onend();
  voice.stopListening();
  const count = recognizers.length;
  tick(10000);
  final(stopped, 'late command');
  assert.equal(recognizers.length, count);
  assert.equal(events.filter((e) => e.final).length, 1);
  console.log(
    'PASS Stop cancels buffered speech, delayed submission, restart, and stale callbacks',
  );

  await voice.startListening();
  const broken = recognizers.at(-1);
  final(broken, 'do not submit a partial request');
  broken.onerror({ error: 'network' });
  tick(10000);
  assert.equal(events.filter((e) => e.final).length, 1);
  assert.equal(errors.length, 1);
  console.log(
    'PASS microphone/service errors cancel pending speech without submitting a partial command',
  );
} finally {
  voice.stopListening();
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
  delete globalThis.window;
}
