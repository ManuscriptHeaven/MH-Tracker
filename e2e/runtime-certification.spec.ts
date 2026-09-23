import crypto from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.API_URL || process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const appUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';

const host = supabaseUrl ? new URL(supabaseUrl).hostname : '';
if (!supabaseUrl || !anonKey || !serviceKey || (host !== '127.0.0.1' && host !== 'localhost')) {
  throw new Error('Browser runtime certification requires LOCAL Supabase only.');
}

const runId = crypto.randomUUID().slice(0, 8);
const password = 'LocalBrowser-' + runId + '-Aa1!';
const adminEmail = 'browser-admin-' + runId + '@example.test';
const employeeEmail = 'browser-team-' + runId + '@example.test';
const clientEmail = 'browser-client-' + runId + '@example.test';
const adminId = crypto.randomUUID();
const employeeId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function expectData<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>, label: string): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(label + ': ' + result.error.message);
  return result.data;
}

async function createTeamUser(id: string, email: string, fullName: string, role: 'admin' | 'employee') {
  await expectData(service.from('team_members').insert({ full_name: fullName, email, role, status: 'active' }), 'insert team member');
  await expectData(service.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  }), 'create team auth user');
}

async function createClientUser() {
  await expectData(service.auth.admin.createUser({
    id: clientId,
    email: clientEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Browser Client' },
  }), 'create client auth user');
}

async function authenticatedClient(email: string): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await expectData(client.auth.signInWithPassword({ email, password }), 'sign in fixture API user');
  return client;
}

async function login(page: Page, email: string) {
  await page.goto(appUrl);
  await page.getByLabel('Email or First Name').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

async function openSidebarGroup(page: Page, group: string, child: string) {
  const groupButton = page.getByRole('button', { name: group, exact: true }).first();
  await groupButton.click();
  await page.getByRole('button', { name: child, exact: true }).click();
}

async function createApprovalProject(admin: SupabaseClient) {
  const now = new Date().toISOString();
  const project = await expectData(admin.from('projects').insert({
    client_profile_id: clientId,
    client_name: 'Browser Client',
    client_email: clientEmail,
    project_title: 'Browser Approval ' + runId,
    service_type: 'Print Formatting',
    assigned_to: employeeId,
    project_manager: adminId,
    created_by: adminId,
    project_status: 'active',
    workflow_stage_key: 'files_received',
    workflow_stage_status_key: 'pending',
    workflow_waiting_on_key: 'none',
    workflow_version: 0,
    requires_print: true,
    requires_ebook: false,
    service_capability_status: 'confirmed',
    capabilities_resolved_by: adminId,
    capabilities_resolved_at: now,
    status: 'New',
    current_stage: 'Files Received',
    stage_status: 'PENDING',
    waiting_on: 'None',
    timeline_status: 'Paused',
    progress_percentage: 0,
    production_seconds_total: 0,
    client_wait_seconds_total: 0,
    revision_count: 0,
    workflow_template_key: 'book-formatting',
  }).select('id,workflow_version,workflow_stage_key,workflow_stage_status_key').single(), 'create approval project');

  let state = project;
  await expectData(admin.rpc('workflow_advance_stage', {
    p_project_id: project.id,
    p_expected_workflow_version: state.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Browser runtime: start files',
  }), 'start files stage');
  state = await expectData(admin.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key')
    .eq('id', project.id).single(), 'reload files state');

  await expectData(admin.rpc('workflow_advance_stage', {
    p_project_id: project.id,
    p_expected_workflow_version: state.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Browser runtime: advance design',
  }), 'advance design');
  state = await expectData(admin.from('projects').select('workflow_version,workflow_stage_key,workflow_stage_status_key')
    .eq('id', project.id).single(), 'reload design state');

  await expectData(admin.rpc('workflow_submit_stage_for_approval', {
    p_project_id: project.id,
    p_expected_workflow_version: state.workflow_version,
    p_idempotency_key: crypto.randomUUID(),
    p_note: 'Browser runtime: submit concept',
  }), 'submit concept');
  return project.id;
}

test.beforeAll(async () => {
  await createTeamUser(adminId, adminEmail, 'Browser Admin', 'admin');
  await createTeamUser(employeeId, employeeEmail, 'Browser Team', 'employee');
  await createClientUser();
});

test('admin task reaches employee live, files work, Kanban renders, attendance pauses', async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const employeeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminPage = await adminContext.newPage();
  const employeePage = await employeeContext.newPage();

  await login(employeePage, employeeEmail);
  await openSidebarGroup(employeePage, 'Tasks', 'My Tasks');
  await expect(employeePage.getByRole('heading', { name: 'My Tasks' })).toBeVisible();

  await login(adminPage, adminEmail);
  await openSidebarGroup(adminPage, 'Tasks', 'Team Tasks');
  await expect(adminPage.getByRole('heading', { name: 'Team Tasks' })).toBeVisible();

  const title = 'Browser realtime task ' + runId;
  await adminPage.getByRole('button', { name: 'Add Task', exact: true }).first().click();
  await adminPage.getByLabel('Task Title').fill(title);
  await adminPage.getByLabel('Assign To').selectOption({ label: 'Browser' });
  await adminPage.getByRole('button', { name: 'Create Task', exact: true }).click();
  await expect(adminPage.getByText(title, { exact: true })).toBeVisible({ timeout: 10000 });

  // No reload: employee must receive the insert from Supabase Realtime.
  await expect(employeePage.getByText(title, { exact: true })).toBeVisible({ timeout: 10000 });

  const employeeTaskCard = employeePage.getByText(title, { exact: true }).locator('..').locator('..').locator('..');
  await employeePage.getByRole('button', { name: 'Details' }).first().click();
  await expect(employeePage.getByText('Task files', { exact: true })).toBeVisible();
  await employeePage.locator('input[type="file"]').setInputFiles({
    name: 'runtime-browser.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('browser file ' + runId),
  });
  await employeePage.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(employeePage.getByText('runtime-browser.txt', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(employeePage.getByText('Version 1', { exact: false })).toBeVisible();
  await employeePage.getByRole('button', { name: /close/i }).first().click().catch(() => undefined);
  void employeeTaskCard;

  await adminPage.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(adminPage.getByText(title, { exact: true })).toBeVisible();
  await expect(adminPage.getByText('To Do', { exact: true }).first()).toBeVisible();

  await employeePage.getByRole('button', { name: 'Attendance', exact: true }).click();
  await employeePage.getByRole('button', { name: 'Clock In', exact: true }).click();
  const active = await expectData(service.from('attendance_sessions').select('id')
    .eq('user_id', employeeId).eq('status', 'active').single(), 'load browser attendance session');
  await expectData(service.from('attendance_sessions').update({
    verified_seconds: 11,
    last_app_heartbeat_at: new Date(Date.now() - 120000).toISOString(),
  }).eq('id', active.id), 'make browser attendance stale');

  await employeePage.reload();
  await employeePage.getByRole('button', { name: 'Attendance', exact: true }).click();
  await expect(employeePage.getByText('App presence is paused.', { exact: true })).toBeVisible({ timeout: 10000 });
  await employeePage.getByRole('button', { name: 'Clock Out', exact: true }).click();

  await adminContext.close();
  await employeeContext.close();
});

test('client approves canonical design concept through confirmation UI', async ({ page }) => {
  const admin = await authenticatedClient(adminEmail);
  const projectId = await createApprovalProject(admin);

  await login(page, clientEmail);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Browser Approval ' + runId, { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText('Browser Approval ' + runId, { exact: true }).click();

  await page.getByRole('button', { name: 'Approve Design Concept', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Approve Design Concept' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve Design Concept', exact: true }).click();
  await expect(page.getByText('Design concept approved successfully!', { exact: true })).toBeVisible({ timeout: 10000 });

  const state = await expectData(service.from('projects').select('workflow_stage_key,workflow_stage_status_key')
    .eq('id', projectId).single(), 'verify browser client approval state');
  expect(state.workflow_stage_key).toBe('print_version');
  expect(state.workflow_stage_status_key).toBe('active');
});
