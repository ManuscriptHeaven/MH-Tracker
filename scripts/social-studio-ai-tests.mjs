import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const edge = read('supabase/functions/social-draft/index.ts');
const page = read('src/pages/SocialStudioPage.tsx');
const migration = read('supabase/migrations/20261023003000_social_studio_ai_revision_briefs.sql');
const layout = read('src/components/Layout.tsx');

for (const value of ['social_create_rich_draft', 'social_append_rich_revision',
  'social_revision_image_brief_length', 'social_revision_content_origin', 'security invoker']) {
  assert.ok(migration.includes(value), 'Missing DB guard: ' + value);
}
assert.match(page, /AI Content Generator/);
assert.match(page, /Save approved brief/);
assert.match(page, /Generate AI Content/);
assert.match(page, /Use in draft editor/);
assert.match(page, /social_create_rich_draft/);
assert.match(page, /social_append_rich_revision/);
assert.match(layout, /social_studio.*adminOnly: true/);
assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(edge, /service_role/);
assert.doesNotMatch(edge, /\.insert\(|\.update\(|\.rpc\(/);
assert.match(edge, /profile\?\.role !== 'admin'/);
assert.match(edge, /eq\('owner_id', user.id\)/);
assert.match(edge, /GEMINI_API_KEY/);
assert.match(edge, /outputSchema/);
assert.match(edge, /getUser/);
assert.match(edge, /Too many generations/);

const transpiled = ts.transpileModule(
  edge.replace("import { createClient } from 'npm:@supabase/supabase-js@2.110.0';",
    'const createClient = globalThis.__createClient;'),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;

const goodGenerated = {
  caption: 'A clean chapter opener helps readers find their place and navigate a book.',
  hashtags: ['#BookDesign', '#Typesetting', '#ManuscriptHeaven'],
  imageBrief: 'A 1080x1350 typographic comparison of a chapter-opening page.',
  variants: {
    facebook: 'Good book formatting helps a reader focus on the story and ideas.',
    instagram: 'Book formatting matters. Here is how chapter openers should look.',
    linkedin: 'Editorial production benefits from clear and consistent running headers.',
  },
  reviewNotes: 'Review all standards or factual claims with an experienced formatter.',
};
const UUID = '33333333-4444-4555-8666-777777777777';

function makeHarness({ isAdmin = true, allowBrand = true, hasKey = true } = {}) {
  let handler;
  let modelCalls = 0;
  let writes = 0;
  const chain = {
    select() { return this; },
    eq() { return this; },
    async single() { return { data: null, error: null }; },
    insert() { writes++; throw Error('Unexpected DB write'); },
    update() { writes++; throw Error('Unexpected DB write'); },
    rpc() { writes++; throw Error('Unexpected RPC'); },
  };
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: UUID } }, error: null }) },
    from(table) {
      return {
        ...chain,
        async single() {
          if (table === 'profiles') return { data: { role: isAdmin ? 'admin' : 'client' }, error: null };
          if (table === 'social_brands') return allowBrand
            ? { data: { name: 'Manuscript Heaven', brief: 'Approved brand guidance' }, error: null }
            : { data: null, error: { message: 'not available' } };
          return { data: null, error: { message: 'unknown table' } };
        },
      };
    },
  });
  const context = {
    __createClient: createClient,
    Deno: {
      serve(fn) { handler = fn; },
      env: { get(name) {
        if (name === 'SUPABASE_URL') return 'https://example.supabase.co';
        if (name === 'SUPABASE_ANON_KEY') return 'safe-key';
        if (name === 'GEMINI_API_KEY') return hasKey ? 'fake-secret' : '';
        return '';
      } },
    },
    Request, Response, AbortController, setTimeout, clearTimeout, console,
    fetch: async () => {
      modelCalls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodGenerated) }] } }] }),
        { status: 200 });
    },
  };
  vm.runInNewContext(transpiled, context);
  return { call: async (body, headers = { Authorization: 'Bearer test-user-jwt' }) => {
    const request = new Request('https://example.supabase.co/functions/v1/social-draft', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handler(request);
  }, getWrites: () => writes, getModelCalls: () => modelCalls };
}

const payload = { brandId: UUID, topic: 'Chapter opening design best practices', platform: 'facebook' };

const unauthorized = makeHarness();
assert.equal((await unauthorized.call(payload, {})).status, 401);
assert.equal(unauthorized.getModelCalls(), 0);

const client = makeHarness({ isAdmin: false });
assert.equal((await client.call(payload)).status, 403);
assert.equal(client.getModelCalls(), 0);

const foreignBrand = makeHarness({ allowBrand: false });
assert.equal((await foreignBrand.call(payload)).status, 403);
assert.equal(foreignBrand.getModelCalls(), 0);

const badInput = makeHarness();
assert.equal((await badInput.call({ ...payload, topic: '' })).status, 400);
assert.equal(badInput.getModelCalls(), 0);

const noKey = makeHarness({ hasKey: false });
assert.equal((await noKey.call(payload)).status, 503);
assert.equal(noKey.getModelCalls(), 0);

const valid = makeHarness();
const response = await valid.call(payload);
assert.equal(response.status, 200);
const data = await response.json();
assert.equal(data.variants.facebook, goodGenerated.variants.facebook);
assert.deepEqual(data.hashtags, goodGenerated.hashtags);
assert.equal(data.imageBrief, goodGenerated.imageBrief);
assert.equal(valid.getModelCalls(), 1);
assert.equal(valid.getWrites(), 0);

console.log('Social Studio AI security, validation and draft-only tests passed.');
