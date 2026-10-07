import { evaluateAttendancePresenceSample } from '../src/lib/attendancePresence.ts';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

console.log('--- Attendance Presence Policy Tests ---');

let sample = evaluateAttendancePresenceSample({
  lastWallMs: 1_000,
  lastMonotonicMs: 500,
  nowWallMs: 16_000,
  nowMonotonicMs: 15_500,
});
assert(sample.creditSeconds === 15 && sample.pauseReason === null, 'normal foreground runtime time is credited');

sample = evaluateAttendancePresenceSample({
  lastWallMs: 1_000,
  lastMonotonicMs: 500,
  nowWallMs: 61_000,
  nowMonotonicMs: 60_500,
});
assert(sample.creditSeconds === 60 && sample.pauseReason === null, 'background/minimized timer throttling remains creditable');

sample = evaluateAttendancePresenceSample({
  lastWallMs: 1_000,
  lastMonotonicMs: 500,
  nowWallMs: 601_000,
  nowMonotonicMs: 5_500,
});
assert(sample.creditSeconds === 0 && sample.pauseReason === 'sleep_detected', 'wall/monotonic clock divergence pauses likely sleep time');

sample = evaluateAttendancePresenceSample({
  lastWallMs: 1_000,
  lastMonotonicMs: 500,
  nowWallMs: 31_000,
  nowMonotonicMs: 30_500,
  screenLocked: true,
});
assert(sample.creditSeconds === 0 && sample.pauseReason === 'screen_locked', 'locked-screen intervals never earn attendance time');

sample = evaluateAttendancePresenceSample({
  lastWallMs: 1_000,
  lastMonotonicMs: 500,
  nowWallMs: 31_000,
  nowMonotonicMs: 30_500,
  pageAway: true,
});
assert(sample.creditSeconds === 0 && sample.pauseReason === 'page_away', 'back-forward-cache/navigation-away intervals never earn attendance time');

if (process.exitCode) {
  console.error('Attendance presence policy checks failed.');
} else {
  console.log('ALL ATTENDANCE PRESENCE POLICY CHECKS PASSED.');
}
