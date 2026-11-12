import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const requireFromVite = createRequire(import.meta.resolve('vite'));
const { build } = requireFromVite('esbuild');

// Use the project's existing Vite compiler to run TS tests without adding a runner.
await mkdir('.test-output', { recursive: true });
const entries = process.argv.slice(2);
for (const entry of entries.length ? entries : ['scripts/ai-dashboard-v2-tests.mjs']) {
  const outfile = path.resolve('.test-output', path.basename(entry).replace(/\.[^.]+$/, '.mjs'));
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    define: { 'import.meta.env': '{}' },
    logLevel: 'warning',
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
