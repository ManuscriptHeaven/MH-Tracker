import { startAttendanceTabLeadership, attendanceLockName } from '../src/lib/attendanceTabLeadership.ts';
import fs from 'node:fs';

function assert(ok, label) {
  if (!ok) {
    console.error('✗ FAIL: ' + label);
    process.exitCode = 1;
  } else {
    console.log('✓ PASS: ' + label);
  }
}

console.log('--- Attendance Multi-tab Ownership Tests ---');
assert(attendanceLockName('u', 's1') !== attendanceLockName('u', 's2'),
  'different sessions have different lock names');
assert(attendanceLockName('u1', 's') !== attendanceLockName('u2', 's'),
  'different actors have different lock names');

let first = false, second = false, third = false;
const stateQueue = [];
const lockState = new Map();
const manager = {
  request(name, options, callback) {
    return new Promise((resolve, reject) => {
      const start = () => {
        if (options.signal.aborted) { resolve(); return; }
        if (lockState.has(name)) {
          stateQueue.push(start);
          return;
        }
        lockState.set(name, true);
        Promise.resolve(callback())
          .then(resolve, reject)
          .finally(() => {
            lockState.delete(name);
            stateQueue.splice(0).forEach((fn) => queueMicrotask(fn));
          });
      };
      start();
    });
  },
};

const a = startAttendanceTabLeadership('u', 's1', (x) => { first = x; }, manager);
const b = startAttendanceTabLeadership('u', 's1', (x) => { second = x; }, manager);
await new Promise((r) => setTimeout(r, 0));
assert(first && !second, 'only the first same-session tab is allowed to count');
a.stop();
await new Promise((r) => setTimeout(r, 0));
assert(!first && second, 'closing primary tab transfers timer ownership');
b.stop();
await new Promise((r) => setTimeout(r, 0));
assert(!second, 'closing the final tab stops ownership');

const thirdTab = startAttendanceTabLeadership('u', 's2', (x) => { third = x; }, manager);
await new Promise((r) => setTimeout(r, 0));
assert(third, 'different sessions have independent browser locks');
thirdTab.stop();

let unsupportedChange = true;
const unavailable = startAttendanceTabLeadership('u','s3',(x)=>{unsupportedChange=x;},undefined);
assert(!unavailable.supported && !unsupportedChange,
  'missing Web Locks support fails closed instead of double crediting');

// Explicit handoff preserves exclusive ownership and flushes the old tab
// before another tab may record or upload any time.
const activeChannels = new Map();
const makeChannel = (name) => {
  const listeners = new Set();
  const peers = activeChannels.get(name) || new Set();
  const channel = {
    postMessage(message) {
      for (const peer of peers) if (peer !== channel) {
        queueMicrotask(() => { for (const callback of peer.listeners) callback({data: message}); });
      }
    },
    addEventListener(event, cb) { if (event === 'message') listeners.add(cb); },
    removeEventListener(event, cb) { if (event === 'message') listeners.delete(cb); },
    close() { peers.delete(channel); },
    listeners,
  };
  peers.add(channel);
  activeChannels.set(name, peers);
  return channel;
};
let owner = false;
let requester = false;
let flushCompleted = false;
let simultaneousOwners = false;
let releaseFlush;
const flushed = new Promise((resolve) => { releaseFlush = resolve; });
const primary = startAttendanceTabLeadership('t1', 'handoff1', (state) => {
  owner = state; if (owner && requester) simultaneousOwners = true;
}, manager, {createChannel: makeChannel, onTransferRequested: async () => {
  await flushed;
  flushCompleted = true;
}});
const secondary = startAttendanceTabLeadership('t1', 'handoff1', (state) => {
  requester = state; if (owner && requester) simultaneousOwners = true;
}, manager, {createChannel: makeChannel});
await new Promise((r) => setTimeout(r, 0));
assert(owner && !requester, 'handoff starts with only the original leader recording');
assert(!primary.requestTakeover() && secondary.requestTakeover(),
  'only a waiting tab may request a cooperative transfer');
await new Promise((r) => setTimeout(r, 0));
assert(owner && !requester && !flushCompleted,
  'the original leader keeps exclusive ownership until its attendance sync finishes');
releaseFlush();
await new Promise((r) => setTimeout(r, 0));
assert(flushCompleted && !owner && requester && !simultaneousOwners,
  'handoff transfers lock after flush without simultaneous attendance owners');
assert(!secondary.requestTakeover(), 'current leader does not request unnecessary transfer');
primary.stop();
secondary.stop();

const tracker = fs.readFileSync('src/lib/useTracker.ts', 'utf8');
const ui = fs.readFileSync('src/pages/AttendancePage.tsx','utf8');
assert(tracker.includes('!runtime.isLeader') &&
       tracker.includes('startAttendanceTabLeadership(') &&
       tracker.includes('leadership?.stop()') &&
       tracker.includes('claimSessionLeadership()') &&
       tracker.includes('ownershipGeneration') &&
       tracker.includes('attendanceTabRole') &&
       tracker.includes('requestAttendanceTakeover') &&
       tracker.includes('onTransferRequested: async () => {'),
  'attendance runtime restricts local accrual and sync to the elected tab');
assert(ui.includes('Another tab owns tracking') &&
       ui.includes('Use This Tab · Transfer Tracking') &&
       ui.includes('Verification unavailable') &&
       ui.includes("attendanceTabRole === 'secondary'"),
  'secondary and unsupported browser states are disclosed in attendance UI');

if (process.exitCode) console.error('Attendance multi-tab tests FAILED.');
else console.log('ALL ATTENDANCE MULTI-TAB TESTS PASSED.');
