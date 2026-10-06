// Run AFTER a production build. Boots the packaged standalone server with the
// filesystem probe: create -> restart (verify) -> "redeploy" into a new release
// dir (verify with expected id/sha) -> verify fails if marker is changed.
// No database settings are provided; no database is touched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {cpSync,existsSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const source=resolve(process.argv[2]||'.next/standalone');
assert.ok(existsSync(join(source,'server.js')),'Build the production standalone artifact first');
const base=realpathSync(mkdtempSync(join(tmpdir(),'standalone-probe-')));
const stateDir=join(base,'.existing-tenant-state');
const port=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const waitFor=async(fn,t=60_000)=>{const end=Date.now()+t;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out');};
async function boot(entry,probe){
 const p=await port();let out='';
 const env={PATH:process.env.PATH||'',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',HOSTNAME:'127.0.0.1',PORT:String(p),EMAIL_ENABLED:'false',AI_ENABLED:'false',
  LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'standalone-test-only-secret-at-least-32-chars',BETTER_AUTH_URL:`http://127.0.0.1:${p}`,...probe};
 const c=spawn(process.execPath,[join(entry,'server.js')],{cwd:entry,env,stdio:['ignore','pipe','pipe']});
 c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>out+=b);
 await waitFor(async()=>{if(c.exitCode!==null)throw new Error(out);try{return (await fetch(`http://127.0.0.1:${p}/api/health`)).ok;}catch{return false;}});
 assert.equal((await fetch(`http://127.0.0.1:${p}/login`)).status,200,'app must serve normally');
 c.kill('SIGTERM');await once(c,'exit');return out;
}
try{
 const rel1=join(base,'hbuilds','r1','nodejs'),rel2=join(base,'hbuilds','r2','nodejs');
 cpSync(source,rel1,{recursive:true});cpSync(source,rel2,{recursive:true});
 const cur=join(base,'hbuilds','current');
 const envOn=(mode,extra={})=>({EXISTING_TENANT_STATE_PROBE:mode,EXISTING_TENANT_STATE_PROBE_DIR:stateDir,...extra});
 // 0. disabled by default: no folder, no log line
 let out=await boot(rel1,{});assert.ok(!out.includes('[state-probe]'));assert.equal(existsSync(stateDir),false);
 // 1. create
 out=await boot(rel1,envOn('create'));
 const m=out.match(/\[state-probe\] OK mode=create created=true id=(\S+) sha256=([0-9a-f]{64})/);assert.ok(m,out);
 const [,id,sha]=m;
 // 2. restart: verify the same marker
 out=await boot(rel1,envOn('verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_ID:id,EXISTING_TENANT_STATE_PROBE_EXPECT_SHA256:sha}));
 assert.match(out,new RegExp(`\\[state-probe\\] OK mode=verify created=false id=${id} sha256=${sha}`));
 // 3. redeploy: new release dir launched through a "current" symlink
 symlinkSync(join(base,'hbuilds','r2'),cur,'dir');
 out=await boot(join(cur,'nodejs'),envOn('verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_ID:id}));
 assert.match(out,new RegExp(`OK mode=verify created=false id=${id}`));
 // 4. unsafe dir inside the deployment is refused; app still serves
 out=await boot(rel2,{...envOn('create'),EXISTING_TENANT_STATE_PROBE_DIR:join(rel2,'state')});
 assert.match(out,/\[state-probe\] FAIL/);assert.equal(existsSync(join(rel2,'state')),false);
 // 5. verify fails (and does not recreate) when marker is missing or different
 const marker=join(stateDir,'infrastruct-state-probe.json');
 writeFileSync(marker,'{"kind":"infrastruct-state-probe","version":1,"id":"other"}\n');
 out=await boot(rel1,envOn('verify',{EXISTING_TENANT_STATE_PROBE_EXPECT_ID:id}));assert.match(out,/\[state-probe\] FAIL .*differs/);
 rmSync(marker);out=await boot(rel1,envOn('verify'));assert.match(out,/\[state-probe\] FAIL .*missing/);
 assert.deepEqual(readdirSync(stateDir),[]);
 console.log('PASS standalone state probe: disabled default, create, restart, redeploy-via-symlink, unsafe path, changed/missing marker');
}finally{rmSync(base,{recursive:true,force:true});}
