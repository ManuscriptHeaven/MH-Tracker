import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql = read('supabase/migrations/20261023162654_social_facebook_delivery_foundation_20261023.sql');
const connectSource = read('supabase/functions/social-facebook-connect/index.ts');
const workerSource = read('supabase/functions/social-delivery-worker/index.ts');
const uiSource = read('src/components/social/FacebookPublishingPanel.tsx');
const app = read('src/pages/SocialStudioPage.tsx');

for (const keyword of [
  'social_facebook_connections','social_facebook_oauth_states',
  'social_facebook_token_refs','vault.create_secret','vault.decrypted_secrets',
  'social_server_facebook_token','social_server_disconnect_facebook',
  'social_delivery_jobs','social_enqueue_on_schedule',
  'social_server_claim_due','social_server_complete_delivery',
  'for update of j skip locked','STALE_UNCERTAIN_OUTCOME',
]) assert.ok(sql.includes(keyword), 'Missing secure Facebook feature: '+keyword);
assert.match(sql,/publish_enabled boolean not null default false/);
assert.match(sql,/owner_id=\(select auth\.uid\(\)\)/);
assert.match(sql,/social_jobs_admin_read/);
assert.match(sql,/status='queued' and j\.scheduled_at<=now\(\)/);
assert.match(sql,/p_owner is null or j\.owner_id=p_owner/);
assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\) is distinct from 'service_role'/);
assert.match(sql,/revoke all on public\.social_facebook_token_refs from anon,authenticated/);
assert.match(sql,/grant execute on function public\.social_server_facebook_token\(uuid\) to service_role/);
assert.match(workerSource,/manualFake \? callerId : null/);
assert.match(workerSource,/SOCIAL_ENABLE_LIVE_PUBLISH/);
assert.match(workerSource,/SOCIAL_PUBLISH_MODE/);
assert.match(workerSource,/PAGE_NOT_UNIQUELY_ENABLED/);
assert.match(workerSource,/FACEBOOK_NETWORK_OUTCOME_UNKNOWN/);
assert.match(workerSource,/getEnv\('SOCIAL_WORKER_SECRET'\)/);
assert.match(connectSource,/hashState\(state\)/);
assert.match(connectSource,/\.is\('consumed_at',null\)\.gt\('expires_at'/);
assert.match(connectSource,/META_OAUTH_REDIRECT_URI/);
assert.match(connectSource,/social_server_save_facebook_page/);
assert.match(connectSource,/pages_manage_posts/);
assert.match(connectSource,/service\.rpc\('social_server_disconnect_facebook'/);
assert.doesNotMatch(connectSource,/localStorage|sessionStorage|access_token:\s*chosen\.access_token\s*}/);
assert.match(uiSource,/Connect through Facebook/);
assert.match(uiSource,/Run due dry-run/);
assert.match(uiSource,/Never paste Page access tokens/);
assert.match(uiSource,/publish_enabled/);
assert.match(app,/<FacebookPublishingPanel/);

const transpile = source => ts.transpileModule(
  source.replace("import { createClient } from 'npm:@supabase/supabase-js@2.110.0';",
    'const createClient = globalThis.__createClient;'),
  { compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022} },
).outputText;

const OWNER='11111111-2222-4333-8444-555555555555';
const BRAND='99999999-2222-4333-8444-555555555555';
const TARGET='bbbbbbbb-2222-4333-8444-555555555555';
const REVISION='aaaaaaaa-2222-4333-8444-555555555555';
const JOB='cccccccc-2222-4333-8444-555555555555';
const LEASE='dddddddd-2222-4333-8444-555555555555';

function workerHarness({role='admin',due=true,liveFlags=true}={}) {
  let serve, externalCalls=0, claimArgs=null, completionArgs=null;
  const fakeJob={id:JOB,owner_id:OWNER,target_id:TARGET,revision_id:REVISION,
    scheduled_at:'2026-10-23T14:00:00Z',lease_id:LEASE,status:'processing'};
  const records={
    profiles:{role},
    social_post_targets:{id:TARGET,post_id:JOB,owner_id:OWNER,channel:'facebook',
      status:'scheduled',approved_revision_id:REVISION,scheduled_at:fakeJob.scheduled_at},
    social_post_revisions:{id:REVISION,post_id:JOB,owner_id:OWNER,caption:'Educational post',asset_id:null},
    social_posts:{id:JOB,brand_id:BRAND,owner_id:OWNER},
  };
  const service={
    from(table){return {select(){return this},eq(){return this},single:async()=>({
      data:records[table]||null,error:records[table]?null:{message:'not found'},
    })}},
    rpc:async(name,args)=>{
      if(name==='social_server_claim_due'){
        claimArgs=args;return {data:due?[fakeJob]:[],error:null};
      }
      if(name==='social_server_complete_delivery'){
        completionArgs=args;return {data:true,error:null};
      }
      throw Error('Unexpected RPC '+name);
    },
  };
  const caller={
    auth:{getUser:async()=>({data:{user:{id:OWNER}},error:null})},
    from:service.from,
  };
  const envs={
    SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'service-key',
    SUPABASE_ANON_KEY:'anon-key',
    SOCIAL_WORKER_SECRET:'safe-test-worker-secret',
    SOCIAL_PUBLISH_MODE:liveFlags?'facebook':'fake',
    SOCIAL_ENABLE_LIVE_PUBLISH:liveFlags?'true':'false',
  };
  const context={
    __createClient:(url,key)=>key==='service-key'?service:caller,
    Deno:{env:{get:key=>envs[key]},serve:fn=>{serve=fn}},
    fetch:async()=>{externalCalls++;throw Error('No Facebook network allowed in manual test');},
    Request,Response,FormData,Blob,TextEncoder,AbortController,setTimeout,clearTimeout,console,
    crypto:webcrypto,Uint8Array,
  };
  vm.runInNewContext(transpile(workerSource),context);
  const req=async({roleToken=true,secret=false,mode='simulate'}={})=>{
    const headers={'Content-Type':'application/json'};
    if(roleToken)headers.Authorization='Bearer user-jwt';
    if(secret)headers['x-worker-secret']='safe-test-worker-secret';
    return serve(new Request('https://example.supabase.co/functions/v1/social-delivery-worker',{
      method:'POST',headers,body:JSON.stringify({mode}),
    }));
  };
  return {req,stats:()=>({externalCalls,claimArgs,completionArgs})};
}

const noAuth=workerHarness();
assert.equal((await noAuth.req({roleToken:false})).status,401);
assert.equal(noAuth.stats().externalCalls,0);
const staff=workerHarness({role:'team_member'});
assert.equal((await staff.req()).status,403);
assert.equal(staff.stats().claimArgs,null);
const admin=workerHarness();
const worked=await admin.req();
assert.equal(worked.status,200);
const result=await worked.json();
assert.equal(result.mode,'fake');
assert.equal(result.simulated,1);
assert.equal(admin.stats().externalCalls,0);
assert.equal(admin.stats().claimArgs.p_owner,OWNER);
assert.equal(admin.stats().completionArgs.p_status,'simulated');
const privilegedMode=workerHarness();
assert.equal((await privilegedMode.req({mode:'scheduled-worker'})).status,403);
assert.equal(privilegedMode.stats().externalCalls,0);
const idle=workerHarness({due:false});
const emptyResponse=await idle.req();
assert.equal((await emptyResponse.json()).claimed,0);

// Server-only Graph paths are present, but live publishing cannot be activated from the UI.
// OAuth callback mocks demonstrate one-time state, server-side Page token, and safe redirects.
function oauthHarness({role='admin',metaConfigured=true}={}) {
  let serve, savedHash=null, used=false, savedToken=null, graphCalls=0;
  const service={
    from(table){
      if(table!=='social_facebook_oauth_states')throw Error('Unexpected service table '+table);
      return {
        insert:async(data)=>{savedHash=data.state_hash;return {error:null}},
        update(){return this},eq(){return this},is(){return this},gt(){return this},select(){return this},
        maybeSingle:async()=> used?{data:null,error:null}:(
          used=true,{data:{owner_id:OWNER,brand_id:BRAND,expected_page_id:'123456789'},error:null}
        ),
      };
    },
    rpc:async(name,args)=>{
      assert.equal(name,'social_server_save_facebook_page');
      savedToken=args.p_page_token;
      return {data:'connected-record-id',error:null};
    },
  };
  const caller={
    auth:{getUser:async()=>({data:{user:{id:OWNER}},error:null})},
    from(table){
      return {select(){return this},eq(){return this},single:async()=>({
        data:table==='profiles'?{role}:table==='social_brands'?{id:BRAND}:null,
        error:null,
      })};
    },
  };
  const envs={
    SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_ANON_KEY:'anon-key',
    SUPABASE_SERVICE_ROLE_KEY:'service-key',
    META_APP_ID:metaConfigured?'123456':'',
    META_APP_SECRET:metaConfigured?'super-secret-value':'',
    SOCIAL_FB_RETURN_URL:'https://feature-social-test.mh-tracker.pages.dev',
    META_OAUTH_REDIRECT_URI:'https://example.supabase.co/functions/v1/social-facebook-connect',
  };
  const context={
    __createClient:(url,key)=>key==='service-key'?service:caller,
    Deno:{env:{get:key=>envs[key]},serve:fn=>{serve=fn}},
    fetch:async(url,opts)=>{
      graphCalls++;
      if(String(url).includes('/me/accounts')){
        return new Response(JSON.stringify({data:[{
          id:'123456789',name:'Manuscript Heaven',
          tasks:['CREATE_CONTENT'],access_token:'page-token-'+'x'.repeat(45),
        }]}),{status:200});
      }
      return new Response(JSON.stringify({access_token:'user-token-'+'x'.repeat(45)}),{status:200});
    },
    Request,Response,TextEncoder,Uint8Array,URL,URLSearchParams,crypto:webcrypto,console,
  };
  vm.runInNewContext(transpile(connectSource),context);
  const post=(body,authed=true)=>serve(new Request('https://example.supabase.co/functions/v1/social-facebook-connect',{
    method:'POST',
    headers:{'Content-Type':'application/json',...(authed?{Authorization:'Bearer user-jwt'}:{})},
    body:JSON.stringify(body),
  }));
  const callback=(state,code='sample-code')=>serve(new Request(
    'https://example.supabase.co/functions/v1/social-facebook-connect?'+new URLSearchParams({state,code}),
  ));
  return {post,callback,stats:()=>({savedHash,used,savedToken,graphCalls})};
}
const missingMeta=oauthHarness({metaConfigured:false});
assert.equal((await missingMeta.post({action:'start',brandId:BRAND})).status,503);
const oauthStaff=oauthHarness({role:'employee'});
assert.equal((await oauthStaff.post({action:'start',brandId:BRAND})).status,403);
const oauthAdmin=oauthHarness();
const initial=await oauthAdmin.post({action:'start',brandId:BRAND,pageId:'123456789'});
assert.equal(initial.status,200);
const authURL=(await initial.json()).authorizationUrl;
const decoded=new URL(authURL);
assert.equal(decoded.hostname,'www.facebook.com');
assert.ok(decoded.searchParams.get('scope').includes('pages_manage_posts'));
const state=decoded.searchParams.get('state');
assert.equal(typeof state,'string');
assert.equal(state.length,64);
assert.equal(oauthAdmin.stats().savedHash.length,64);
assert.notEqual(oauthAdmin.stats().savedHash,state);
const success=await oauthAdmin.callback(state);
assert.equal(success.status,303);
const destination=new URL(success.headers.get('Location'));
assert.equal(destination.hostname,'feature-social-test.mh-tracker.pages.dev');
assert.equal(destination.searchParams.get('social_fb'),'connected');
assert.ok(!destination.toString().includes('token'));
assert.ok(oauthAdmin.stats().savedToken.startsWith('page-token-'));
const replay=await oauthAdmin.callback(state);
assert.equal(new URL(replay.headers.get('Location')).searchParams.get('social_fb'),'expired_state');
console.log('Facebook OAuth state, fake-worker, admin isolation and no-publishing tests passed.');
