import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

type DeliveryJob = {
  id: string; owner_id: string; target_id: string; revision_id: string;
  scheduled_at: string; lease_id: string; status: string;
};
type Outcome = { status: 'simulated' | 'published' | 'blocked' | 'unknown' | 'cancelled';
  providerId?: string; error?: string };

function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

const getEnv = (key: string) => Deno.env.get(key) || '';
const graphVersion = 'v26.0';
const graphBase = 'https://graph.facebook.com/' + graphVersion;

async function graphPublish(
  pageId: string, token: string, caption: string,
  asset: { path: string; mime: string; owner: string; brand: string } | null,
  service: ReturnType<typeof createClient>,
): Promise<Outcome> {
  if (!/^[0-9]{3,30}$/.test(pageId) || !token || !caption.trim())
    return { status: 'blocked', error: 'INVALID_FACEBOOK_PAYLOAD' };

  const form = new FormData();
  form.append('access_token', token);
  const endpoint = asset ? 'photos' : 'feed';
  if (asset) {
    const { data, error } = await service.storage.from('social-artwork-private').download(asset.path);
    if (error || !data) return { status: 'blocked', error: 'PRIVATE_ASSET_UNAVAILABLE' };
    if (data.size > 8388608 || !['image/png','image/jpeg','image/webp'].includes(asset.mime))
      return { status: 'blocked', error: 'ASSET_FORMAT_INVALID' };
    form.append('source', new Blob([await data.arrayBuffer()], { type: asset.mime }), 'mh-artwork');
    form.append('message', caption);
  } else {
    form.append('message', caption);
  }

  // No automatic retries. A lost response can mean Facebook already received the post.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(graphBase + '/' + pageId + '/' + endpoint, {
      method: 'POST', body: form, signal: controller.signal,
    });
    if (!response.ok) {
      return { status: response.status >= 500 ? 'unknown' : 'blocked',
        error: response.status >= 500 ? 'FACEBOOK_RESPONSE_UNCERTAIN' : 'FACEBOOK_REJECTED' };
    }
    const payload = await response.json() as { id?: string; post_id?: string };
    const postId = payload.post_id || payload.id;
    return typeof postId === 'string' && postId.length > 2
      ? { status: 'published', providerId: postId }
      : { status: 'unknown', error: 'FACEBOOK_RESPONSE_MISSING_POST_ID' };
  } catch {
    return { status: 'unknown', error: 'FACEBOOK_NETWORK_OUTCOME_UNKNOWN' };
  } finally {
    clearTimeout(timeout);
  }
}

async function runJob(
  job: DeliveryJob,
  service: ReturnType<typeof createClient>,
  allowReal: boolean,
): Promise<Outcome> {
  const { data: target, error: targetError } = await service.from('social_post_targets')
    .select('id,post_id,owner_id,channel,status,approved_revision_id,scheduled_at')
    .eq('id', job.target_id).single();
  if (targetError || !target ||
      target.owner_id !== job.owner_id || target.channel !== 'facebook' ||
      target.status !== 'scheduled' ||
      target.approved_revision_id !== job.revision_id ||
      target.scheduled_at !== job.scheduled_at) {
    return { status: 'cancelled' };
  }
  const [revisionResult, postResult] = await Promise.all([
    service.from('social_post_revisions').select('id,post_id,owner_id,caption,asset_id')
      .eq('id', job.revision_id).single(),
    service.from('social_posts').select('id,brand_id,owner_id').eq('id', target.post_id).single(),
  ]);
  const revision = revisionResult.data, post = postResult.data;
  if (revisionResult.error || postResult.error || !revision || !post ||
      revision.post_id !== post.id || post.owner_id !== job.owner_id ||
      revision.owner_id !== job.owner_id) return { status: 'blocked', error: 'REVISION_MISMATCH' };

  let asset: { path: string; mime: string; owner: string; brand: string } | null = null;
  if (revision.asset_id) {
    const { data: artwork, error } = await service.from('social_assets')
      .select('storage_path,mime_type,owner_id,brand_id,rights_status')
      .eq('id', revision.asset_id).single();
    if (error || !artwork || artwork.rights_status !== 'cleared' ||
      artwork.owner_id !== job.owner_id || artwork.brand_id !== post.brand_id)
      return { status: 'blocked', error: 'ARTWORK_NOT_APPROVED' };
    asset = { path: artwork.storage_path, mime: artwork.mime_type,
      owner: artwork.owner_id, brand: artwork.brand_id };
  }

  if (!allowReal) return { status: 'simulated' };

  const { data: connections, error } = await service.from('social_facebook_connections')
    .select('id,page_id,status,publish_enabled')
    .eq('owner_id',job.owner_id).eq('brand_id',post.brand_id)
    .eq('status','connected').eq('publish_enabled',true).limit(2);
  if (error || !connections || connections.length !== 1)
    return { status: 'blocked', error: 'PAGE_NOT_UNIQUELY_ENABLED' };

  const connection = connections[0];
  const { data: token, error: tokenError } = await service.rpc('social_server_facebook_token',
    { p_connection: connection.id });
  if (tokenError || typeof token !== 'string' || token.length < 30)
    return { status: 'blocked', error: 'PAGE_TOKEN_UNAVAILABLE' };

  // Recheck schedule immediately before the external mutation. In-flight revocations
  // remain an inherently uncertain race, hence no automatic replay of leased jobs.
  const { data: check } = await service.from('social_post_targets')
    .select('status,approved_revision_id,scheduled_at').eq('id', job.target_id).single();
  if (!check || check.status !== 'scheduled' ||
      check.approved_revision_id !== job.revision_id ||
      check.scheduled_at !== job.scheduled_at) return { status: 'cancelled' };

  return graphPublish(connection.page_id, token, revision.caption, asset, service);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);

  const url = getEnv('SUPABASE_URL');
  const secretKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = getEnv('SUPABASE_ANON_KEY');
  if (!url || !secretKey || !anonKey)
    return json({ error: 'Worker infrastructure unavailable.' }, 503);

  const service = createClient(url, secretKey, { auth: { persistSession: false } });
  const workerSecret = getEnv('SOCIAL_WORKER_SECRET');
  const isWorker = safeEqual(request.headers.get('x-worker-secret') || '', workerSecret);
  const bearer = request.headers.get('Authorization');
  let manualFake = false;
  let callerId: string | null = null;

  if (!isWorker) {
    if (!bearer?.startsWith('Bearer ')) return json({ error: 'Sign in required.' }, 401);
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: bearer } } });
    const { data: { user }, error } = await caller.auth.getUser(bearer.slice(7));
    if (error || !user) return json({ error: 'Session expired.' }, 401);
    const { data: profile } = await caller.from('profiles').select('role').eq('id',user.id).single();
    if (profile?.role !== 'admin') return json({ error: 'Admin access required.' }, 403);
    manualFake = true; // Even if live publishing is enabled, UI test calls are always fake.
    callerId = user.id;
  }

  let mode: string;
  try {
    const data = await request.json() as Record<string,unknown>;
    mode = typeof data?.mode === 'string' ? data.mode : 'simulate';
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (mode !== 'simulate' && mode !== 'scheduled-worker')
    return json({ error: 'Invalid run mode.' }, 400);
  if (manualFake && mode !== 'simulate') return json({ error: 'Only dry-run available to admins.' }, 403);
  if (mode === 'scheduled-worker' && !isWorker) return json({ error: 'Worker identity required.' }, 403);

  const liveEnabled = !manualFake && isWorker && mode === 'scheduled-worker' &&
    getEnv('SOCIAL_PUBLISH_MODE') === 'facebook' &&
    getEnv('SOCIAL_ENABLE_LIVE_PUBLISH') === 'true';

  const { data: jobs, error: claimError } = await service.rpc('social_server_claim_due',
    { p_limit: 5, p_owner: manualFake ? callerId : null });
  if (claimError) return json({ error: 'Worker could not claim due jobs.' }, 503);

  const summary = { claimed: Array.isArray(jobs) ? jobs.length : 0,
    simulated: 0, published: 0, blocked: 0, unknown: 0, cancelled: 0 };
  for (const job of (jobs || []) as DeliveryJob[]) {
    let outcome: Outcome;
    try { outcome = await runJob(job,service,liveEnabled); }
    catch { outcome = { status: 'unknown', error: 'WORKER_OUTCOME_UNKNOWN' }; }

    // If confirmation cannot be persisted, leave lease in processing to time out
    // to 'unknown', never replay automatically.
    const { data: committed, error: completeError } = await service.rpc(
      'social_server_complete_delivery', {
        p_id: job.id,p_lease:job.lease_id,p_status:outcome.status,
        p_provider_id:outcome.providerId || null,p_error:outcome.error || null,
      });
    if (completeError || committed !== true) summary.unknown++;
    else summary[outcome.status]++;
  }
  return json({ ...summary, mode: liveEnabled ? 'facebook' : 'fake',
    note: liveEnabled ? 'Live Facebook delivery enabled by server and database gates.'
      : 'Fake provider only; no social media posts were published.' });
});
