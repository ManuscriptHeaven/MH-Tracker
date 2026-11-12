// Browser smoke test against the demo build (no Supabase keys).
// Opens every main screen as the demo admin and fails on any page crash,
// uncaught error or error boundary. Run: pnpm test:e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.E2E_PORT || 4179);
const BASE = `http://127.0.0.1:${PORT}`;

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed. Run: pnpm add -D playwright && npx playwright install chromium');
  process.exit(2);
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('Preview server did not start. Run "pnpm build" first.');
}

const screens = [
  ['Dashboard', null],
  ['AI Assistant', null],
  ['Social Media Studio', null],
  ['All Projects', 'Projects'],
  ['Calendar', 'Projects'],
  ['My Tasks', 'Tasks'],
  ['Attendance', null],
  ['Messages', null],
  ['Notifications', null],
  ['Payments', 'Finance'],
  ['Finance & Payroll', 'Finance'],
  ['Team', 'Management'],
  ['Clients', 'Management'],
  ['Settings', 'Management'],
];

const failures = [];
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Admin Demo', { exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard' }).first().waitFor({ timeout: 15000 });
  console.log('PASS: demo admin can sign in');

  const brokenImages = await page.evaluate(() =>
    Array.from(document.images)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute('src')?.slice(0, 80)),
  );
  if (brokenImages.length) failures.push(`broken images on the dashboard: ${brokenImages.join(', ')}`);
  else console.log('PASS: dashboard images load');

  for (const [label, group] of screens) {
    const before = errors.length;
    const name = new RegExp(`^${label.replace(/[&]/g, '\\$&')}( \\d+)?$`);
    let link = page.getByRole('button', { name }).first();
    if (group && !(await link.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: group, exact: true }).first().click();
    }
    link = page.getByRole('button', { name }).first();
    await link.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await sleep(400);
    const crashed = await page.getByText(/something went wrong/i).first().isVisible().catch(() => false);
    const stillLoading = await page.getByRole('status').filter({ hasText: 'Loading…' }).isVisible().catch(() => false);
    if (crashed || stillLoading || errors.length > before) {
      failures.push(`${label}: ${crashed ? 'error boundary shown' : stillLoading ? 'page never finished loading' : errors.slice(before).join(' | ')}`);
      console.log(`FAIL: ${label}`);
    } else {
      console.log(`PASS: ${label} opens without errors`);
    }
  }
} catch (error) {
  failures.push(`smoke run aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.error('\nBrowser smoke test failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nBrowser smoke test passed.');
