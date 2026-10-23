import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const migration = read('supabase/migrations/20261023204000_social_artwork_private_library.sql');
const edge = read('supabase/functions/social-artwork/index.ts');
const library = read('src/components/social/SocialArtworkLibrary.tsx');
const studio = read('src/pages/SocialStudioPage.tsx');

for(const name of [
  "social-artwork-private", "public.social_assets", "social_asset_admin_read",
  "social_asset_admin_insert", "social_asset_admin_update",
  "social_artwork_private_read", "social_artwork_private_insert",
  "social_asset_storage_check", "social_asset_permission_revoked",
  "social_revision_asset_check", "social_claim_image_generation",
  "social_create_media_draft", "social_append_media_revision",
]) assert.ok(migration.includes(name), 'Missing database security capability: '+name);
assert.match(migration,/file_size_limit, allowed_mime_types/);
assert.match(migration,/8388608/);
assert.equal((migration.match(/\$\$/g) || []).length, 18, 'All 9 PL/pgSQL functions need paired dollar delimiters');
assert.doesNotMatch(migration,/as \$\n|end \$;/,'Single-dollar delimiters are invalid SQL');
assert.match(migration,/old.rights_status='cleared' and new.rights_status <> 'cleared'/);
assert.match(migration,/t\.approved_revision_id=r\.id/);
assert.match(migration,/a\.rights_status <> 'cleared'/);
assert.match(migration,/p_asset_id uuid/);
assert.match(migration,/security invoker/);
assert.doesNotMatch(migration,/security definer/);
assert.match(library,/createSignedUrl\(asset\.storage_path, 120\)/);
assert.doesNotMatch(library,/getPublicUrl/);
assert.match(library,/Upload artwork/);
assert.match(library,/Clear rights/);
assert.match(library,/withdrawAsset/);
assert.match(studio,/social_create_media_draft/);
assert.match(studio,/social_append_media_revision/);
assert.match(studio,/onRightsChanged/);
assert.match(studio,/Private unpublished image attached to this draft/);
assert.doesNotMatch(edge,/SUPABASE_SERVICE_ROLE_KEY|service_role|social_post_targets|facebook\.com|instagram\.com/);
assert.match(edge,/social_claim_image_generation/);
assert.match(edge,/social_assets/);
assert.match(edge,/gemini-2\.5-flash-image/);

const edgeJs = ts.transpileModule(
  edge.replace("import { createClient } from 'npm:@supabase/supabase-js@2.110.0';",
    'const createClient = globalThis.__createClient;'),
  {compilerOptions: {module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}},
).outputText;
const id='11111111-2222-4333-8444-555555555555';
const owner='66666666-7777-4888-8999-000000000000';
const imageData=Buffer.from('pretend png bytes for mocked generator response; 123456').toString('base64');

function harness({role='admin',brand=true,hasKey=true,quotaError=null,hasImage=true}={}) {
  let handler,providerCalls=0,uploads=0,metadata=0,claims=0,postWrites=0;
  let lastUpload, lastMetadata;
  const sdk={
    auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
    from(table){
      return {
        select(){return this},eq(){return this},
        async single(){
          if(table==='profiles')return {data:{role},error:null};
          if(table==='social_brands')return brand
            ? {data:{name:'Manuscript Heaven',brief:'Public services: book formatting, print PDF and EPUB.'},error:null}
            : {data:null,error:{message:'Not found'}};
          return {data:null,error:{message:'Unexpected query'}};
        },
        async insert(record){
          if(table==='social_assets'){metadata++;lastMetadata=record;return {error:null};}
          postWrites++;return {error:{message:'Unexpected insert'}};
        },
      };
    },
    async rpc(name){
      assert.equal(name,'social_claim_image_generation');claims++;
      return {error:quotaError};
    },
    storage:{from(bucket){
      assert.equal(bucket,'social-artwork-private');
      return {
        async upload(path,bytes,options){
          uploads++;lastUpload={path,bytes,options};return {error:null};
        },
        async remove(){return {error:null};},
      };
    }},
  };
  const sandbox={
    __createClient:()=>sdk,
    Deno:{serve(fn){handler=fn},env:{get(name){
      if(name==='SUPABASE_URL')return 'https://example.supabase.co';
      if(name==='SUPABASE_ANON_KEY')return 'safe-publishable-key';
      if(name==='GEMINI_API_KEY')return hasKey?'fake-private-key':'';
      return undefined;
    }}},
    fetch:async()=>{
      providerCalls++;
      return new Response(JSON.stringify({
        candidates:[{content:{parts:hasImage
          ? [{inlineData:{mimeType:'image/png',data:imageData}}]
          : [{text:'no image'}]}}]
      }),{status:200});
    },
    atob,crypto,Request,Response,AbortController,setTimeout,clearTimeout,console,Uint8Array,
  };
  vm.runInNewContext(edgeJs,sandbox);
  return {
    call:async(body,auth=true)=>handler(new Request('https://example.supabase.co/functions/v1/social-artwork',{
      method:'POST',headers:auth?{Authorization:'Bearer user-token','Content-Type':'application/json'}:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
    })),
    stats:()=>({providerCalls,uploads,metadata,claims,postWrites,lastUpload,lastMetadata}),
  };
}
const payload={brandId:id,visualBrief:'Create a cream and gold educational 4:5 typography comparison.'};
const unauthorized=harness();
assert.equal((await unauthorized.call(payload,false)).status,401);
assert.equal(unauthorized.stats().providerCalls,0);
const client=harness({role:'employee'});
assert.equal((await client.call(payload)).status,403);
assert.equal(client.stats().claims,0);
const foreign=harness({brand:false});
assert.equal((await foreign.call(payload)).status,403);
assert.equal(foreign.stats().providerCalls,0);
const invalid=harness();
assert.equal((await invalid.call({...payload,visualBrief:'tiny'})).status,400);
assert.equal(invalid.stats().claims,0);
const missingKey=harness({hasKey:false});
assert.equal((await missingKey.call(payload)).status,503);
assert.equal(missingKey.stats().claims,0);
const quota=harness({quotaError:{message:'Artwork generation limit reached'}});
assert.equal((await quota.call(payload)).status,429);
assert.equal(quota.stats().providerCalls,0);
const empty=harness({hasImage:false});
assert.equal((await empty.call(payload)).status,502);
assert.equal(empty.stats().uploads,0);
const valid=harness();
const response=await valid.call(payload);
assert.equal(response.status,200);
const data=await response.json();
assert.match(data.assetId,/^[0-9a-f-]{36}$/);
const stats=valid.stats();
assert.equal(stats.providerCalls,1);
assert.equal(stats.claims,1);
assert.equal(stats.uploads,1);
assert.equal(stats.metadata,1);
assert.equal(stats.postWrites,0);
assert.ok(stats.lastUpload.path.startsWith(owner+'/'+id+'/'));
assert.equal(stats.lastUpload.options.contentType,'image/png');
assert.equal(stats.lastMetadata.rights_status,'pending');
assert.equal(stats.lastMetadata.permission_basis,'ai_generated');
console.log('Social private artwork safety, JWT roles, quota, metadata and mock AI generation tests passed.');
