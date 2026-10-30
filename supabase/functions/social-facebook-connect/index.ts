import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const env = (k: string) => Deno.env.get(k) || '';
const graph = 'https://graph.facebook.com/v26.0';
const validUuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const validPage = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9]{3,30}$/.test(s);

async function hashState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

const redirect = (base: string, result: string): Response => {
  // The URL is configured by the operator, never taken from the callback/request.
  const next = new URL(base);
  next.searchParams.set('social_fb',result);
  return new Response(null,{status:303,headers:{
    'Location':next.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
  }});
};

async function graphToken(endpoint: string, values: Record<string,string>) {
  const form = new URLSearchParams(values);
  const response = await fetch(graph + '/' + endpoint,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:form,
  });
  if (!response.ok) return null;
  const data = await response.json() as { access_token?: string };
  return typeof data.access_token==='string' ? data.access_token : null;
}

Deno.serve(async (request: Request) => {
  if (request.method==='OPTIONS') return new Response('ok',{headers:cors});
  if (!['POST','GET'].includes(request.method)) return answer({error:'Unsupported method.'},405);

  const projectUrl = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const appId = env('META_APP_ID');
  const appSecret = env('META_APP_SECRET');
  const returnUrl = env('SOCIAL_FB_RETURN_URL');
  const redirectUri = projectUrl + '/functions/v1/social-facebook-connect';

  if (!projectUrl || !anonKey || !serviceKey || !appId || !appSecret || !returnUrl ||
     env('META_OAUTH_REDIRECT_URI')!==redirectUri) {
    return answer({error:'Facebook Login is not configured. Meta App ID/Secret and approved redirect settings are required.'},503);
  }
  try {
    const u = new URL(returnUrl);
    if (u.protocol!=='https:' || u.username || u.password || u.hash) {
      return answer({error:'OAuth return URL is not configured securely.'},503);
    }
  } catch { return answer({error:'OAuth return URL is invalid.'},503); }

  const service = createClient(projectUrl,serviceKey,{auth:{persistSession:false}});

  if (request.method==='GET') {
    // Meta returns a code and unguessable state only. Never accept a target URL from query params.
    const query = new URL(request.url).searchParams;
    if (query.has('error')) return redirect(returnUrl,'denied');
    const code=query.get('code'),state=query.get('state');
    if (!code || code.length>1800 || !state || state.length<30 || state.length>160)
      return redirect(returnUrl,'invalid_callback');

    const stateHash=await hashState(state);
    // Atomic one-time state claim. A second callback cannot reuse it.
    const {data:flow,error:flowError}=await service.from('social_facebook_oauth_states')
      .update({consumed_at:new Date().toISOString()}).eq('state_hash',stateHash)
      .is('consumed_at',null).gt('expires_at',new Date().toISOString())
      .select('owner_id,brand_id,expected_page_id').maybeSingle();
    if (flowError || !flow) return redirect(returnUrl,'expired_state');

    const userToken=await graphToken('oauth/access_token',{
      client_id:appId,client_secret:appSecret,redirect_uri:redirectUri,code,
    });
    if (!userToken) return redirect(returnUrl,'token_exchange_failed');
    const longToken=await graphToken('oauth/access_token',{
      grant_type:'fb_exchange_token',client_id:appId,client_secret:appSecret,
      fb_exchange_token:userToken,
    });
    if (!longToken) return redirect(returnUrl,'long_lived_token_failed');

    const pagesResponse=await fetch(graph+'/me/accounts?fields=id,name,access_token,tasks&limit=100',{
      headers:{'Authorization':'Bearer '+longToken},method:'GET',
    });
    if (!pagesResponse.ok) return redirect(returnUrl,'page_permissions_missing');
    const pageData=await pagesResponse.json() as {
      data?: {id?:string;name?:string;access_token?:string;tasks?:string[]}[];
    };
    // Static failure categories only: never expose Graph responses or tokens.
    if (!Array.isArray(pageData.data) || pageData.data.length===0)
      return redirect(returnUrl,'no_pages_returned');
    const pages=(pageData.data||[]).filter(p=>validPage(p.id) &&
      typeof p.name==='string' && typeof p.access_token==='string' &&
      (!p.tasks || p.tasks.includes('CREATE_CONTENT')));
    if (!pages.length) return redirect(returnUrl,'page_content_access_missing');
    const chosen=flow.expected_page_id
      ? pages.find(p=>p.id===flow.expected_page_id)
      : pages.length===1 ? pages[0] : null;
    if (!chosen) return redirect(returnUrl,flow.expected_page_id?'selected_page_not_returned':'page_id_required');

    const {data:connection,error:connectError}=await service.rpc('social_server_save_facebook_page',{
      p_owner:flow.owner_id,p_brand:flow.brand_id,p_page_id:chosen.id,
      p_page_name:chosen.name,p_page_token:chosen.access_token,
    });
    if (connectError || !connection) return redirect(returnUrl,'connection_save_failed');
    // Publish flag is ALWAYS false after OAuth. Real delivery requires a separate release gate.
    return redirect(returnUrl,'connected');
  }

  const bearer=request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ')) return answer({error:'Sign in required.'},401);
  const caller=createClient(projectUrl,anonKey,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:userError}=await caller.auth.getUser(bearer.slice(7));
  if (userError || !user) return answer({error:'Session expired.'},401);
  const {data:profile,error:roleError}=await caller.from('profiles').select('role')
    .eq('id',user.id).single();
  if (roleError || profile?.role!=='admin') return answer({error:'Admin access required.'},403);

  let payload: Record<string,unknown>;
  try {
    const raw=await request.text();
    if (raw.length>2500) return answer({error:'Request too large.'},413);
    payload=JSON.parse(raw);
    if (!payload || Array.isArray(payload) || typeof payload!=='object')
      throw Error('invalid');
  } catch { return answer({error:'Invalid JSON request.'},400); }

  if (payload.action==='disconnect') {
    if (!validUuid(payload.connectionId)) return answer({error:'Invalid connection ID.'},400);
    const {data:existing}=await caller.from('social_facebook_connections')
      .select('id').eq('id',payload.connectionId).eq('owner_id',user.id).single();
    if (!existing) return answer({error:'Connection inaccessible.'},403);
    const {data:done,error:disconnectError}=await service.rpc('social_server_disconnect_facebook',{
      p_connection:payload.connectionId,p_owner:user.id,
    });
    if (disconnectError || done!==true) return answer({error:'Disconnect failed.'},502);
    return answer({disconnected:true});
  }
  if (payload.action!=='start' || !validUuid(payload.brandId) ||
      !(payload.pageId==null || payload.pageId==='' || validPage(payload.pageId))) {
    return answer({error:'Select a brand and optionally specify a numeric Facebook Page ID.'},400);
  }
  const {data:brand,error:brandError}=await caller.from('social_brands')
    .select('id').eq('id',payload.brandId).eq('owner_id',user.id).single();
  if (brandError || !brand) return answer({error:'Brand inaccessible.'},403);

  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const state=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const stateHash=await hashState(state);
  const {error:storeError}=await service.from('social_facebook_oauth_states').insert({
    state_hash:stateHash,owner_id:user.id,brand_id:payload.brandId,
    expected_page_id:payload.pageId||null,
  });
  if (storeError) return answer({error:'Secure OAuth state could not be created.'},502);
  const oauth=new URL('https://www.facebook.com/v26.0/dialog/oauth');
  oauth.searchParams.set('client_id',appId);
  oauth.searchParams.set('redirect_uri',redirectUri);
  oauth.searchParams.set('response_type','code');
  oauth.searchParams.set('scope','pages_show_list,pages_read_engagement,pages_manage_posts');
  oauth.searchParams.set('state',state);
  return answer({authorizationUrl:oauth.toString(),note:'Publishing stays disabled after connection until release certification.'});
});

