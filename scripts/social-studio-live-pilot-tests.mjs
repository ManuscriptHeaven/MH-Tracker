import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261022201131_social_studio_admin_pilot_20261023.sql');
const page = read('src/pages/SocialStudioPage.tsx');
const app = read('src/App.tsx');
const layout = read('src/components/Layout.tsx');
const mobile = read('src/components/MobileMoreMenu.tsx');

for (const table of ['social_brands','social_posts','social_post_revisions','social_post_targets']) {
  assert.match(sql, new RegExp('create table public\\.' + table + '\\b'));
  assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
  assert.match(sql, new RegExp('owner_id = \\(select auth\\.uid\\(\\)\\)'));
}
assert.match(sql, /phase6_app_actor_class\(\)/);
assert.match(sql, /create trigger social_revision_invalidate/);
assert.match(sql, /create trigger social_revision_immutable/);
assert.match(sql, /create trigger social_target_transition/);
assert.match(sql, /security invoker/);
assert.match(sql, /social_create_draft/);
assert.match(sql, /social_append_revision/);
assert.doesNotMatch(sql, /security definer/i);
assert.match(page, /not automatically published/);
assert.match(page, /social_create_media_draft/);
assert.match(page, /social_append_media_revision/);
assert.match(page, /status: 'in_review'/);
assert.match(page, /status: 'approved'/);
assert.match(page, /status: 'scheduled'/);
assert.match(app, /currentProfile\.role === 'admin'/);
assert.match(app, /SocialStudioPage/);
assert.match(layout, /social_studio/);
assert.match(layout, /adminOnly: true/);
assert.match(mobile, /social_studio.*show: isAdmin/);
console.log('Social Studio pilot static safety checks passed.');
