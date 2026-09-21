import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const login = fs.readFileSync('src/pages/LoginPage.tsx', 'utf8');
const settings = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');
const team = fs.readFileSync('src/pages/TeamPage.tsx', 'utf8');
const constants = fs.readFileSync('src/lib/constants.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

console.log('--- Admin Demo + Team Role Labels Regression Tests ---');

assert(
  login.includes('!isSupabaseConfigured ?') &&
  login.includes('Admin Demo Preview') &&
  !login.includes("role: 'employee' as Role") &&
  !login.includes("role: 'client' as Role"),
  'production login no longer exposes employee/client demo accounts',
);

assert(
  settings.includes("currentProfile?.role === 'admin'") &&
  settings.includes('onEnterAdminDemo') &&
  settings.includes('Team members do not see demo access') &&
  app.includes("onEnterAdminDemo={() => tracker.loginDemo('admin')}"),
  'authenticated Admin settings is the only production entry point to demo mode',
);

assert(
  constants.includes("project_manager: 'Manager'") &&
  constants.includes("employee: 'Book Formatter'") &&
  constants.includes("junior_assistant: 'Team Member'"),
  'role labels use Manager, Book Formatter and Team Member terminology',
);

assert(
  team.includes('Add Team Member') &&
  team.includes('Add New Team Member') &&
  team.includes('<option value="employee">Book Formatter</option>') &&
  team.includes('<option value="project_manager">Manager</option>') &&
  team.includes('<option value="junior_assistant">Team Member</option>'),
  'team management uses the new role names consistently',
);

if (process.exitCode) {
  console.error('Admin demo / team role label checks failed.');
} else {
  console.log('ALL ADMIN DEMO / TEAM ROLE LABEL CHECKS PASSED.');
}
