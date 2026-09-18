import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const tracker = fs.readFileSync(new URL('../src/lib/useTracker.ts', import.meta.url), 'utf8');

assert.match(
  app,
  /if \(tracker\.isInitializing\) \{/,
  'App should block dashboard rendering for the full Supabase startup hydration window.',
);

assert.doesNotMatch(
  app,
  /tracker\.isInitializing && !tracker\.currentProfile/,
  'Cached profiles must not bypass the startup loading screen.',
);

assert.match(
  app,
  /Loading your projects\.\.\./,
  'Startup loader should explain that project data is loading.',
);

assert.match(
  tracker,
  /useState<boolean>\(\(\) => Boolean\(supabase\)\)/,
  'Supabase startup must begin in the initializing state even when a cached profile exists.',
);

assert.match(
  tracker,
  /if \(!supabase \|\| initialMode === 'demo'\) return sampleData;/,
  'Sample data should only be used as the fresh-start fallback for demo mode.',
);

assert.match(
  tracker,
  /return createEmptyTrackerData\(initialProfile\);/,
  'A fresh Supabase startup should use an empty workspace until live data arrives.',
);

console.log('startup-loading-tests: ok');
