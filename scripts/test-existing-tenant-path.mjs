// Hosted additive import into an EXISTING tenant: proven on disposable local fixtures only (never the real database). The fixture database carries
// the live database's NAME on purpose, so the test shows that only the explicit allow-list path can touch such a target (staging mode keeps
// refusing it, see test-staging-path.mjs). A populated owner tenant (own client, project, login, company profile) and a second tenant are
// preserved. The hosted flow is exercised through scripts/start.mjs (no shell, no npm), including SIGKILL interruptions and restarts.
//   npm run build   then   MYSQL_DATABASE=existing_tenant_path_test node scripts/test-existing-tenant-path.mjs
import {spawn,spawnSync} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
import {SESSION_TABLES} from './demo/import-guards.mjs';
import {databaseFingerprint,evaluateExistingTenantAllowlist,evaluateBackupEvidence} from './demo/existing-tenant.mjs';
import {quiesce} from './demo/quiesce.mjs';
import {importLockName} from '../lib/platform/maintenance-policy.mjs';
import {CHILD_ENV_KEYS} from './existing-tenant-load.mjs';
import {loaderLockName} from './demo/loader-lock.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
if(!['127.0.0.1','localhost','::1'].includes(process.env.MYSQL_HOST)||process.env.NODE_ENV==='production')throw new Error('Fixture tests require a disposable loopback MySQL service and a non-production test driver');
const standalone=process.env.EXISTING_TENANT_TEST_STANDALONE_ROOT;
if(standalone&&(!standalone.startsWith(tmpdir()+'/standalone-mysql-')||!existsSync(join(standalone,'server.js'))||process.env.MYSQL_HOST!=='127.0.0.1'))throw new Error('Standalone tests require a copied temp artifact and loopback MySQL');
const productScript=file=>standalone&&['scripts/import-demo-tenant.mjs','scripts/existing-tenant-verify.mjs'].includes(file)?join(standalone,file):resolve(file);
let pass=0,fail=0;const check=(s,ok,d='')=>{if(ok)pass++;else fail++;console.log(`${ok?'PASS':'FAIL'}    ${s}${d?' — '+String(d).replace(/\s+/g,' ').slice(0,220):''}`);return ok;};
const sha=x=>createHash('sha256').update(x).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'existing-tenant-test-'));
const LIVE_NAME='u840559204_infra_test';    // a disposable LOCAL fixture that merely carries the live database's name
const P0=Number(process.env.PORT||3210),P1=P0+1;
const password='Owner-Password-Strong-42!';
const db=await connect();
const mysqlEnv=database=>({PATH:process.env.PATH,HOME:process.env.HOME,MYSQL_HOST:process.env.MYSQL_HOST,MYSQL_PORT:process.env.MYSQL_PORT,MYSQL_DATABASE:database,MYSQL_USER:process.env.MYSQL_USER,MYSQL_PASSWORD:process.env.MYSQL_PASSWORD});
const fixtures=[];const procs=[];
const makeDb=async name=>{await db.query('DROP DATABASE IF EXISTS `'+name+'`');await db.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');fixtures.push(name);};
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const count=async(t,name,org)=>Number((await q('SELECT COUNT(*) n FROM `'+name+'`.`'+t+'`'+(org?' WHERE organisation_id=?':''),org?[org]:[]))[0].n);
const world=async name=>{const [t]=await db.query('SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY 1',[name]);const h=createHash('sha256');for(const {n} of t){if(SESSION_TABLES.has(n))continue;h.update(n+JSON.stringify((await db.query('SELECT * FROM `'+name+'`.`'+n+'`'))[0]));}return h.digest('hex');};
const rowsDigest=async(name,sql,p)=>sha(JSON.stringify((await db.query(sql.replaceAll('{db}','`'+name+'`'),p))[0]));
const out=r=>(r.stdout||'')+(r.stderr||'');
const run=(file,env,args=[],timeout=120000)=>spawnSync(process.execPath,[productScript(file),...args],{cwd:standalone&&file==='scripts/import-demo-tenant.mjs'?standalone:process.cwd(),env,encoding:'utf8',timeout});
const startApp=async(port,env)=>{const args=standalone?[join(standalone,'server.js')]:['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'];const c=spawn(process.execPath,args,{cwd:standalone||process.cwd(),env:{...env,PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'ignore'});procs.push(c);for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).ok)return c;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}throw new Error('app did not start');};
const call=(cookie,origin)=>async(path,method='GET',body)=>{const r=await fetch(origin+path,{method,headers:{origin,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
const signup=async(origin,name,email)=>{let r;for(let a=0;a<8;a++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}if(!r.ok)throw new Error('sign-up '+r.status);return r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');};

// a populated database: an owner tenant (login, company profile, own client and project) and another tenant (own project and work area)
async function populated(name,tag){
 await makeDb(name);const env=mysqlEnv(name);
 const m=run('scripts/migrate.mjs',env);if(m.status!==0)throw new Error(out(m));
 const appEnv={...env,NODE_ENV:'production',BETTER_AUTH_SECRET:'existing-tenant-secret-with-at-least-32-chars!',BETTER_AUTH_URL:`http://127.0.0.1:${P0}`,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake'};
 const app=await startApp(P0,appEnv),origin=`http://127.0.0.1:${P0}`;
 const emailA=`owner-${tag}@owner-co.example.invalid`,emailB=`other-${tag}@other-co.example.invalid`;
 const ca=await signup(origin,'Owner Admin',emailA),cb=await signup(origin,'Other Admin',emailB);
 const [[ua]]=await db.query('SELECT id,organisation_id FROM `'+name+'`.users WHERE email=?',[emailA]);const [[ub]]=await db.query('SELECT id,organisation_id FROM `'+name+'`.users WHERE email=?',[emailB]);
 await db.query('UPDATE `'+name+'`.users SET role=? WHERE id IN (?,?)',['admin',ua.id,ub.id]);
 const t=new Date().toISOString();for(const o of [ua.organisation_id,ub.organisation_id]){await db.query('INSERT INTO `'+name+'`.organisation_profiles (organisation_id,legal_name,created_at,updated_at,onboarding_completed_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE onboarding_completed_at=VALUES(onboarding_completed_at),legal_name=VALUES(legal_name)',[o,o===ua.organisation_id?'Owner Own Company Pty Ltd':'Other Tenant Pty Ltd',t,t,t]);}
 const a=call(ca,origin),b=call(cb,origin);
 const cl=await a('/api/platform/clients','POST',{action:'create',client:{name:'Owner Own Client Pty Ltd',clientCode:'OWN-1',contactName:'Owner Contact',email:'contact@own-client.example.invalid'}});
 const pa=await a('/api/projects','POST',{name:'Owner Own Project (pre-existing)'});const pb=await b('/api/projects','POST',{name:'Other Tenant Project'});
 const ring=[[0,0],[40,0],[40,40],[0,40]].map(([x,y])=>({lat:-33.9+y/111194.9,lng:151.2+x/92400}));
 const wa=await b('/api/projects/work-areas','POST',{projectId:pb.body.projectId,name:'Other tenant area',kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:null,sequence:null,notes:null,ring});
 app.kill();procs.splice(procs.indexOf(app),1);await new Promise(r=>setTimeout(r,1500));
 if(![200,201].includes(cl.status)||![200,201].includes(pa.status)||![200,201].includes(pb.status)||wa.status!==201)throw new Error('fixture setup failed '+[cl.status,pa.status,pb.status,wa.status]);
 return {name,env,org:ua.organisation_id,orgB:ub.organisation_id,emailA,ownerUser:ua.id,otherUser:ub.id,cookieA:ca};
}
const preserved=async f=>({
 owner:await rowsDigest(f.name,'SELECT * FROM {db}.clients WHERE organisation_id=? AND client_code=? ORDER BY id',[f.org,'OWN-1'])+await rowsDigest(f.name,'SELECT id,name,status,revision FROM {db}.jobs WHERE organisation_id=? AND name LIKE ? ORDER BY id',[f.org,'Owner Own%']),
 login:await rowsDigest(f.name,'SELECT * FROM {db}.auth_user ORDER BY id',[])+await rowsDigest(f.name,'SELECT * FROM {db}.auth_account ORDER BY id',[])+await rowsDigest(f.name,'SELECT * FROM {db}.users WHERE id IN (?,?) ORDER BY id',[f.ownerUser,f.otherUser])+await rowsDigest(f.name,'SELECT * FROM {db}.organisation_profiles ORDER BY organisation_id',[]),
 other:await rowsDigest(f.name,'SELECT * FROM {db}.jobs WHERE organisation_id=? ORDER BY id',[f.orgB])+await rowsDigest(f.name,'SELECT * FROM {db}.project_work_areas WHERE organisation_id=? ORDER BY id',[f.orgB]),
});
const mkAllow=(f,over={},mode=0o600)=>{const file=join(dir,'allow-'+Math.random().toString(36).slice(2)+'.json');const body={environment:'existing-tenant-additive',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:f.name,user:process.env.MYSQL_USER,appUrl:'https://existing.example.invalid',organisationId:f.org,adminEmail:f.emailA,...over};const txt=JSON.stringify(body);writeFileSync(file,txt);chmodSync(file,mode);return {file,txt};};
const evidenceFor=async(f,over={})=>({takenAt:new Date().toISOString(),database:f.name,organisationId:f.org,restoreVerified:true,restoredInto:'scratch fixture (test)',operator:'test operator',fingerprint:await databaseFingerprint(await connectTo(f.name)),...over});
const conns=[];const connectTo=async name=>{const prev=process.env.MYSQL_DATABASE;process.env.MYSQL_DATABASE=name;try{const c=await connect();conns.push(c);return c;}finally{process.env.MYSQL_DATABASE=prev;}};
const writeEv=(obj,mode=0o600)=>{const file=join(dir,'ev-'+Math.random().toString(36).slice(2)+'.json');writeFileSync(file,JSON.stringify(obj));chmodSync(file,mode);return file;};
const lockName=(name,org)=>'demo_import_'+createHash('sha256').update(name+'|'+org).digest('hex').slice(0,40);

// the hosted flow: scripts/start.mjs with environment variables only
const startCmd=(env,port=P1)=>{const c=spawn(process.execPath,[standalone?join(standalone,'server.js'):'scripts/start.mjs'],{cwd:standalone||process.cwd(),env:{...env,PORT:String(port),HOSTNAME:'127.0.0.1',...(standalone?{EXISTING_TENANT_RUNTIME_ENABLE:'true'}:{})},stdio:['ignore','pipe','pipe'],detached:true});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);procs.push(c);return {c,get log(){return log;}};};
const killGroup=async h=>{try{process.kill(-h.c.pid,'SIGKILL');}catch{/* gone */}const i=procs.indexOf(h.c);if(i>=0)procs.splice(i,1);await new Promise(r=>setTimeout(r,2500));};
const waitFor=async(fn,ms=300000)=>{for(let i=0;i<ms/400;i++){if(await fn())return true;await new Promise(r=>setTimeout(r,400));}return false;};
// capture servers: the hosted app is given REAL-LOOKING integration settings that point here; any email or object-storage traffic would be counted
const captured={smtp:0,s3:0};
const smtpCap=netServer(sock=>{captured.smtp++;sock.on('error',()=>{});sock.end('421 not accepting mail\r\n');});await new Promise(r=>smtpCap.listen(0,'127.0.0.1',r));
const s3Cap=httpServer((req,res)=>{captured.s3++;res.statusCode=503;res.end('no');});await new Promise(r=>s3Cap.listen(0,'127.0.0.1',r));
const soon=ms=>new Date(Date.now()+ms).toISOString();
const hostedEnv=(f,a,over={})=>({...f.env,NODE_ENV:'production',BETTER_AUTH_SECRET:'existing-tenant-secret-with-at-least-32-chars!',BETTER_AUTH_URL:'https://existing.example.invalid',LOCATION_PROVIDER:'fake',
 // the freeze: this very app refuses every request while the loader fingerprints, plans and applies
 MAINTENANCE_UNTIL:soon(2*3600e3),
 // everything an operator's real app would carry, LIVE (email enabled): the loader must not pass any of it on, and the maintenance gate must keep the app from using it
 EMAIL_ENABLED:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtpCap.address().port),SMTP_SECURE:'false',SMTP_USER:'u',SMTP_PASSWORD:'p',MAIL_FROM:'m@example.invalid',AI_API_KEY:'k',BILLING_PROVIDER:'b',ABR_GUID:'g',GOOGLE_MAPS_BROWSER_KEY:'k',R2_ENDPOINT:'http://127.0.0.1:'+s3Cap.address().port,R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x',
 EXISTING_TENANT_ALLOWLIST_JSON:a.txt,EXISTING_TENANT_CONFIRM_SHA256:sha(a.txt),EXISTING_TENANT_STATE_DIR:join(dir,'state-'+f.name),...over});
const finished=(h,mode,ms)=>waitFor(()=>new RegExp(`${mode} finished with exit code`).test(h.log),ms);
const exitOk=(h,mode)=>new RegExp(`${mode} finished with exit code 0`).test(h.log);
const planHash=h=>/planHash: ([0-9a-f]{64})/.exec(h.log)?.[1];

try{
 // ------------------------------------------------------------------ pure checks
 check('the loader child receives only database settings and the run\'s own values: no email, SMS, billing, AI, ABR, map, storage or operator settings',CHILD_ENV_KEYS.every(k=>!/SMTP|MAIL|AI_|OPENAI|BILLING|ABR|TWILIO|SMS|GOOGLE|R2_|PLATFORM_OPERATOR|STAGING/.test(k)),CHILD_ENV_KEYS.join(','));

 // ------------------------------------------------------------------ scenario 1: refusals, full flow, preservation, repeat
 const f=await populated(LIVE_NAME,'a');
 const base0=await preserved(f);const w0=await world(f.name);
 const allow=mkAllow(f);
 const importer=(args,over={},env0={})=>run('scripts/import-demo-tenant.mjs',{...f.env,DEMO_SEED_EMAIL:f.emailA,DEMO_SEED_PASSWORD:password,EXISTING_TENANT_CONFIRM_SHA256:sha(allow.txt),...env0,...over},args,180000);
 const ORG=['--organisation-id',f.org];
 const dry=importer([...ORG,'--existing-tenant-allowlist',allow.file]);const plan=/planHash: ([0-9a-f]{64})/.exec(out(dry))?.[1];
 check('dry run against the exactly named existing tenant works, reports no conflicts, and changes nothing',dry.status===0&&Boolean(plan)&&!/CONFLICT|BLOCKER/.test(out(dry))&&(await world(f.name))===w0,out(dry).slice(-150));
 const baseline=join(dir,'s1-baseline.json');
 const goodEv=writeEv(await evidenceFor(f));
 const applyArgs=(ev=goodEv,extra=[])=>[...ORG,'--existing-tenant-allowlist',allow.file,'--apply','--plan-hash',plan,'--baseline',baseline,...(ev?['--backup-evidence',ev]:[]),...extra];
 const refuse=async(label,args,over,env0,code,re)=>{const x=importer(args,over,env0);check(`refused before any write: ${label}`,x.status===code&&re.test(out(x))&&(await world(f.name))===w0&&!existsSync(baseline),`${x.status} ${out(x).replace(/\s+/g,' ').slice(0,120)}`);};
 await refuse('no confirmation hash',applyArgs(),{EXISTING_TENANT_CONFIRM_SHA256:''},{},2,/SHA-256/);
 await refuse('a wrong confirmation hash',applyArgs(),{EXISTING_TENANT_CONFIRM_SHA256:'f'.repeat(64)},{},2,/SHA-256/);
 await refuse('a different database than the allow-list names',applyArgs(),{MYSQL_DATABASE:'some_other_db'},{},2,/MYSQL_DATABASE/);
 await refuse('a different organisation id on the command line',[...applyArgs()].map(x=>x===f.org?'other-org-id':x),{},{},2,/allow-listed organisation/);
 await refuse('a different administrator email',applyArgs(),{DEMO_SEED_EMAIL:'someone@example.invalid'},{},2,/administrator/);
 await refuse('staging mode switched on (mutually exclusive)',applyArgs(),{STAGING_DEMO_MODE:'true'},{},2,/mutually exclusive/);
 await refuse('both allow-list flags together',[...applyArgs(),'--staging-allowlist',allow.file],{},{},2,/mutually exclusive/);
 await refuse('an allow-list file other users can read',[...applyArgs()].map(x=>x===allow.file?mkAllow(f,{},0o644).file:x),{},{},2,/accessible by other users|SHA-256/);
 {const plain=mkAllow(f,{appUrl:'http://plain.example.invalid'});await refuse('a plain-http app URL in the allow-list',applyArgs(null).map(x=>x===allow.file?plain.file:x),{EXISTING_TENANT_CONFIRM_SHA256:sha(plain.txt)},{},2,/https/);}
 await refuse('a missing --backup-evidence on the first apply',applyArgs(null),{},{},3,/--backup-evidence is required/);
 await refuse('a wrong plan hash',[...applyArgs()].map(x=>x===plan?'0'.repeat(64):x),{},{},3,/plan-hash/);
 await refuse('an integration configured in the importer\'s own environment (SMTP)',applyArgs(),{SMTP_HOST:'smtp.example.invalid'},{},2,/SMTP_HOST/);
 await refuse('--backup-evidence without an allow-list',[...ORG,'--backup-evidence',goodEv],{},{},2,/only meaningful/);
 for(const [label,over,re] of [['a stale backup (49 h old)',{takenAt:new Date(Date.now()-49*3600e3).toISOString()},/older than/],['a backup dated in the future',{takenAt:new Date(Date.now()+3600e3).toISOString()},/future/],['no restore attestation',{restoreVerified:false},/restoreVerified/],['a backup of a different database',{database:'another_db'},/different database/],['a backup of a different organisation',{organisationId:'other-org'},/different organisation/],['a fingerprint that does not match the database',{fingerprint:'a'.repeat(64)},/changed since the backup/],['an unknown evidence key',{extra:1},/unknown/],['no operator named',{operator:''},/operator/]]){
  await refuse(label,applyArgs(writeEv(await evidenceFor(f,over))),{},{},3,re);}
 await refuse('backup evidence readable by other users',applyArgs(writeEv(await evidenceFor(f),0o644)),{},{},3,/accessible by other users/);
 {const c=await connectTo(f.name);const [[l]]=await c.query('SELECT GET_LOCK(?,0) a',[lockName(f.name,f.org)]);
  const x=importer(applyArgs());check('refused before any write: another import holds the database lock',Number(l.a)===1&&x.status===3&&/another import/.test(out(x))&&(await world(f.name))===w0,out(x).replace(/\s+/g,' ').slice(0,100));await c.query('SELECT RELEASE_LOCK(?)',[lockName(f.name,f.org)]);}
 {const fp0=await databaseFingerprint(await connectTo(f.name));const evOld=writeEv(await evidenceFor(f,{fingerprint:fp0}));
  await db.query('UPDATE `'+f.name+'`.jobs SET name=? WHERE organisation_id=? AND name=?',['Other Tenant Project (edited after backup)',f.orgB,'Other Tenant Project']);
  const w1=await world(f.name);const x=importer(applyArgs(evOld));
  check('refused before any write: the database was written to after the backup was fingerprinted (the freeze is enforced)',x.status===3&&/changed since the backup/.test(out(x))&&(await world(f.name))===w1,`${x.status}`);
  await db.query('UPDATE `'+f.name+'`.jobs SET name=? WHERE organisation_id=? AND name=?',['Other Tenant Project',f.orgB,'Other Tenant Project (edited after backup)']);}


 // ------------------------------------------------------------------ the freeze and the integrations of the HOSTED app (not only the importer's temporary app)
 {const c=await populated('etr_ctrl_test','d'),aC=mkAllow(c);const origin=`http://127.0.0.1:${P1}`,api1=call(c.cookieA,origin);
  const ctrlEnv=over=>hostedEnv(c,aC,{BETTER_AUTH_URL:origin,MAINTENANCE_UNTIL:'',...over});
  const up=async()=>{try{return (await fetch(origin+'/login')).ok;}catch{return false;}};
  // control: WITHOUT maintenance the same app writes and talks to its integrations (proves the checks below can fail)
  let x=startCmd(ctrlEnv({}));await waitFor(up,120000);
  const before=await count('jobs',c.name,c.org);const created=await api1('/api/projects','POST',{name:'Control project'});
  const smtp0=captured.smtp;await fetch(origin+'/api/auth/request-password-reset',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({email:c.emailA,redirectTo:origin+'/reset'})}).catch(()=>{});
  await new Promise(r=>setTimeout(r,1500));const s30=captured.s3;
  const up1=new FormData();up1.set('file',new Blob(['x'],{type:'text/plain'}),'control.txt');await fetch(origin+'/api/delivery/documents',{method:'POST',headers:{origin,cookie:c.cookieA},body:up1}).catch(()=>{});await new Promise(r=>setTimeout(r,1500));
  check('control (no maintenance): the app accepts an authenticated write, tries to send email and tries to use object storage — so the checks below can fail',[200,201].includes(created.status)&&(await count('jobs',c.name,c.org))===before+1&&captured.smtp>smtp0&&captured.s3>s30,`write=${created.status} smtp+${captured.smtp-smtp0} s3+${captured.s3-s30}`);
  await killGroup(x);
  // maintenance on: the SAME app refuses everything and touches nothing
  const w1=await world(c.name),smtp1=captured.smtp,s31=captured.s3;
  x=startCmd(ctrlEnv({MAINTENANCE_UNTIL:soon(2*3600e3)}));await waitFor(()=>fetch(origin+'/api/health').then(r=>r.ok,()=>false),120000);
  const hit=async(path,init={})=>fetch(origin+path,{redirect:'manual',...init,headers:{origin,cookie:c.cookieA,'Content-Type':'application/json',...(init.headers||{})}}).then(r=>r.status,()=>0);
  const fd=new FormData();fd.set('file',new Blob(['x'],{type:'text/plain'}),'m.txt');
  const results=[await hit('/'),await hit('/login'),await hit('/api/auth/get-session'),await hit('/api/auth/sign-in/email',{method:'POST',body:JSON.stringify({email:c.emailA,password})}),await hit('/api/auth/request-password-reset',{method:'POST',body:JSON.stringify({email:c.emailA,redirectTo:origin+'/reset'})}),await hit('/api/projects',{method:'POST',body:JSON.stringify({name:'Blocked project'})}),await hit('/api/projects/work-areas?projectId=x'),await hit('/api/billing',{method:'POST',body:'{}'}),await fetch(origin+'/api/delivery/documents',{method:'POST',headers:{origin,cookie:c.cookieA},body:fd}).then(r=>r.status,()=>0),await hit('/api/anything-else',{method:'PUT',body:'{}'}),await hit('/api/anything-else',{method:'DELETE'})];
  const health=await fetch(origin+'/api/health').then(r=>r.json());const page=await fetch(origin+'/').then(async r=>({s:r.status,ra:r.headers.get('retry-after'),t:await r.text()}));
  check('maintenance: every page, auth, API, webhook-style and upload request (reads and writes) gets a 503; only GET /api/health answers',results.every(v=>v===503)&&health.ok===true&&health.maintenance.active===true,results.join(','));
  check('maintenance: the 503 page names the end time, sends Retry-After and tells the administrator how to end it early',page.s===503&&Number(page.ra)>=30&&/MAINTENANCE_UNTIL/.test(page.t)&&new RegExp(health.maintenance.until.slice(0,16)).test(page.t));
  check('maintenance: the app wrote nothing, sent no email and used no object storage while blocked (data identical, SMTP and storage capture servers saw nothing new)',(await world(c.name))===w1&&captured.smtp===smtp1&&captured.s3===s31,`smtp+${captured.smtp-smtp1} s3+${captured.s3-s31}`);
  await killGroup(x);
  // it ends by itself, and a stale/invalid value never locks the site
  x=startCmd(ctrlEnv({MAINTENANCE_UNTIL:soon(-60e3)}));await waitFor(up,120000);
  check('maintenance ends by itself: with MAINTENANCE_UNTIL already past the app serves normally again',await hit('/api/auth/get-session')!==503);await killGroup(x);
  x=startCmd(ctrlEnv({MAINTENANCE_UNTIL:'next tuesday'}));await waitFor(up,120000);
  check('an invalid MAINTENANCE_UNTIL does not lock the site (recovery by correcting or removing the variable)',await hit('/api/auth/get-session')!==503);await killGroup(x);
  // the loader refuses to fingerprint, plan or apply unless the freeze is in force and long enough
  const w2=await world(c.name);
  for(const [label,over,re] of [['no maintenance window',{MAINTENANCE_UNTIL:''},/not set/],['an expired window',{MAINTENANCE_UNTIL:soon(-60e3)},/ended/],['an invalid window',{MAINTENANCE_UNTIL:'soon'},/valid/],['a window with under 5 minutes left',{MAINTENANCE_UNTIL:soon(120e3)},/less than \d+ minutes/],['an unbounded window (13 hours)',{MAINTENANCE_UNTIL:soon(13*3600e3)},/more than 12 hours/]])
   for(const mode of ['fingerprint','plan','apply']){x=startCmd(hostedEnv(c,aC,{...over,EXISTING_TENANT_LOAD:mode,EXISTING_TENANT_PLAN_HASH:'a'.repeat(64),DEMO_SEED_PASSWORD:password,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:'{}'}));await waitFor(()=>/finished|nothing was done/.test(x.log)||(/refused/.test(x.log)&&re.test(x.log)),60000);   // a refusal is several lines (relayed one by one in the standalone host): wait until the reason line this case asserts on has arrived, not just the first 'refused'   
    check(`the loader refuses ${mode} with ${label}: the freeze is not in force, nothing is connected or written`,/write freeze is not in force/.test(x.log)&&re.test(x.log)&&!/finished with exit code 0/.test(x.log),x.log.replace(/\s+/g,' ').slice(-120));await killGroup(x);}
  check('after all those refusals the control database is unchanged',(await world(c.name))===w2);

  // ---- THE EXPIRY SAFETY CASE: MAINTENANCE_UNTIL passes while an apply can still mutate (its importer session holds the advisory lock).
  // The window ending must NOT reopen the app for normal writes until that session is gone — including a delayed termination.
  {const lock=importLockName(c.name,c.org),holder=await connectTo(c.name);
   x=startCmd(hostedEnv(c,aC,{BETTER_AUTH_URL:origin,MAINTENANCE_UNTIL:soon(35e3),EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:'a'.repeat(64),DEMO_SEED_PASSWORD:password}));   // the loader itself refuses (window < 15 min): nothing is imported
   await waitFor(()=>fetch(origin+'/api/health').then(r=>r.ok,()=>false),120000);
   const [[got]]=await holder.query('SELECT GET_LOCK(?,0) a',[lock]);                                    // an "importer" session that is alive and may still mutate
   await new Promise(r=>setTimeout(r,1500));                                                              // the fence caches its answer for up to 1 s
   const health0=await fetch(origin+'/api/health').then(r=>r.json());
   check('expiry case (setup): the apply configuration is detected, the window is open-ended-closed (maintenance active) and the importer lock is held',Number(got.a)===1&&health0.maintenance.active===true&&health0.import.configured===true&&health0.import.inFlight===true,JSON.stringify(health0));
   const wEx=await world(c.name);
   const ended=await waitFor(async()=>(await fetch(origin+'/api/health').then(r=>r.json(),()=>null))?.maintenance?.active===false,90000);
   const afterExpiry=[await hit('/'),await hit('/api/auth/get-session'),await hit('/api/projects',{method:'POST',body:JSON.stringify({name:'Written after expiry'})})];
   const h1=await fetch(origin+'/api/health').then(r=>r.json()),pg=await fetch(origin+'/').then(async r=>({s:r.status,t:await r.text()}));
   check('expiry case: MAINTENANCE_UNTIL has PASSED but the importer session is still alive: every request — including an authenticated write — is still refused with 503, and the page says an import is finishing',ended&&afterExpiry.every(v=>v===503)&&h1.maintenance.active===false&&h1.import.inFlight===true&&/import that started during the maintenance window/.test(pg.t),`${ended} ${afterExpiry.join(',')}`);
   await new Promise(r=>setTimeout(r,7000));                                                              // delayed termination: the importer lingers well past the window
   const late=[await hit('/api/auth/get-session'),await hit('/api/projects',{method:'POST',body:JSON.stringify({name:'Written during delayed termination'})})];
   check('expiry case: during a DELAYED termination (7 s past the window) normal writes still do not resume and no row changed',late.every(v=>v===503)&&(await world(c.name))===wEx,late.join(','));
   await holder.query('SELECT RELEASE_LOCK(?)',[lock]);                                                   // the importer session is finally gone
   const reopened=await waitFor(async()=>(await hit('/api/auth/get-session'))!==503,8000);
   const jobsBefore=await count('jobs',c.name,c.org),w=await api1('/api/projects','POST',{name:'Written after the importer stopped'});
   check('expiry case: only once the importer session has ended does the app reopen (within seconds, no restart needed) and normal writes resume',reopened&&[200,201].includes(w.status)&&(await count('jobs',c.name,c.org))===jobsBefore+1,`reopened=${reopened} write=${w.status}`);
   await killGroup(x);}
 }
 const capBase={...captured};

 // ------------------------------------------------------------------ scenario 1b: the hosted flow through scripts/start.mjs (no shell, no npm)
 const stateOf=x=>join(dir,'state-'+x);
 let h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'fingerprint'}));
 await waitFor(()=>/fingerprint: [0-9a-f]{64}/.test(h.log),90000);
 const fp=/fingerprint: ([0-9a-f]{64})/.exec(h.log)?.[1];
 check('hosted flow: the fingerprint step (read-only) prints the value for the backup evidence, equal to the database\'s fingerprint, while the app is in maintenance (only /api/health answers)',fp===await databaseFingerprint(await connectTo(f.name))&&(await fetch(`http://127.0.0.1:${P1}/api/health`).then(r=>r.ok,()=>false))&&(await fetch(`http://127.0.0.1:${P1}/login`).then(r=>r.status,()=>0))===503,fp);
 await killGroup(h);
 const ownerBefore=await count('clients',f.name,f.org),ownerJobsBefore=await count('jobs',f.name,f.org),otherAreasBefore=await count('project_work_areas',f.name,f.orgB);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'plan'}));await finished(h,'plan',120000);const ph=planHash(h);
 check('hosted flow: the plan run prints the plan, its hash and no conflicts against the populated owner tenant, and writes nothing',exitOk(h,'plan')&&Boolean(ph)&&!/CONFLICT|BLOCKER/.test(h.log)&&(await world(f.name))===w0,h.log.slice(-160));
 await killGroup(h);
 // app-check: read-only proof that the importer's private app really accepts TCP connections, run through the real loader, the real Next app and the log relay
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'app-check'}));await finished(h,'app-check',150000);
 check('hosted flow: app-check proves the private app and a bare node child accept connections (the transport probe picks loopback TCP here; a real tcp LISTEN on 127.0.0.1 is read from /proc), writes nothing and signs nobody in',
  exitOk(h,'app-check')&&/RESULT: PASS/.test(h.log)&&/private app over http:\/\/127\.0\.0\.1:\d+: TCP connected; GET \/ HTTP \d{3}/.test(h.log)&&/bare node child on 127\.0\.0\.1:\d+: .*TCP connected/.test(h.log)&&!/sign-in|Pre-import baseline/.test(h.log)&&(await world(f.name))===w0,h.log.replace(/\s+/g,' ').slice(-260));
 await killGroup(h);
 const evJson=JSON.stringify(await evidenceFor(f,{fingerprint:fp}));
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:evJson}));
 await waitFor(()=>/apply needs DEMO_SEED_PASSWORD/.test(h.log),60000);
 check('hosted flow: apply without the one-run administrator password is refused and nothing changes',!exitOk(h,'apply')&&/DEMO_SEED_PASSWORD/.test(h.log)&&(await world(f.name))===w0);
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,DEMO_SEED_PASSWORD:password}));
 await waitFor(()=>/the first apply needs EXISTING_TENANT_BACKUP_EVIDENCE_JSON/.test(h.log),60000);
 check('hosted flow: the first apply without backup evidence is refused and nothing changes',!exitOk(h,'apply')&&/BACKUP_EVIDENCE/.test(h.log)&&(await world(f.name))===w0);
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:evJson,DEMO_SEED_PASSWORD:password}));
 if(standalone){
  // Freeze a real import mid-flight without modifying product code. A second
  // runtime must lose the loader mutex BEFORE quiescence can kill that query.
  const owner=async name=>(await db.query('SELECT IS_USED_LOCK(?) id',[name]))[0][0].id;
  check('standalone concurrency setup: real loader and importer own their MySQL locks',await waitFor(async()=>Boolean(await owner(loaderLockName(f.name)))&&Boolean(await owner(lockName(f.name,f.org))),60000),h.log.slice(-200));
  const blocked=await connectTo(f.name);await blocked.query('LOCK TABLES project_work_areas WRITE');
  try{
   const before=await owner(lockName(f.name,f.org));
   const contender=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'plan'}),P1+1);
   await waitFor(()=>/another loader\/import is running/.test(contender.log),30000);
   check('standalone concurrency: second runtime refuses before quiescence and leaves the live importer lock intact',Boolean(before)&&await owner(lockName(f.name,f.org))===before&&/another loader\/import is running/.test(contender.log)&&!/database quiescence/.test(contender.log),contender.log.slice(-240));
   await killGroup(contender);
  }finally{await blocked.query('UNLOCK TABLES');}
 }
 const done=await finished(h,'apply',600000);
 const n={areas:await count('project_work_areas',f.name,f.org),points:await count('project_work_points',f.name,f.org),links:await count('shift_work_areas',f.name,f.org),shifts:await count('shifts',f.name,f.org),jobs:await count('jobs',f.name,f.org),users:await count('users',f.name,f.org)};
 check('hosted flow: with the reviewed hash, evidence and the one-run password the full demo company is ADDED to the existing owner tenant (SMTP/AI/billing/R2 settings were present in the app\'s environment and were not passed on)',done&&exitOk(h,'apply')&&n.areas===20&&n.points===3&&n.links===27&&n.shifts===17&&n.jobs===ownerJobsBefore+3&&n.users===6&&/Backup evidence accepted/.test(h.log)&&/import deadline: /.test(h.log)&&/database quiescence after the importer stopped: killed 0 active session\(s\), 0 still active/.test(h.log),JSON.stringify(n)+h.log.slice(-120));
 check('preservation: the owner\'s own client and project, login, memberships, company profile and the other tenant are byte-for-byte unchanged; the importer itself reported 0 changed and 0 removed rows',JSON.stringify(await preserved(f))===JSON.stringify(base0)&&/Existing rows changed: 0; removed: 0/.test(h.log)&&(await count('clients',f.name,f.org))===ownerBefore+4&&(await count('project_work_areas',f.name,f.orgB))===otherAreasBefore&&(await count('shift_work_areas',f.name,f.orgB))===0,'');
 check('the other tenant received nothing and the owner\'s login and company profile are untouched (two logins, two profiles)',(await count('auth_user',f.name))===2&&(await count('organisation_profiles',f.name))===2);
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'verify'}));await finished(h,'verify',120000);
 check('hosted flow: the read-only verifier passes',exitOk(h,'verify')&&/verified/.test(h.log),h.log.slice(-120));
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'plan'}));await finished(h,'plan',120000);const ph2=planHash(h);
 check('repeat: with the demo already added a fresh plan finds nothing to create',/create 0/.test(h.log)&&exitOk(h,'plan'),'');
 await killGroup(h);
 const rowsA=JSON.stringify([await count('project_work_areas',f.name,f.org),await count('shifts',f.name,f.org),await count('jobs',f.name,f.org),await count('workers',f.name,f.org),await count('plant',f.name,f.org),await count('users',f.name,f.org)]);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph2,DEMO_SEED_PASSWORD:password}));await finished(h,'apply',600000);
 check('repeat: applying again succeeds and creates no duplicates',exitOk(h,'apply')&&JSON.stringify([await count('project_work_areas',f.name,f.org),await count('shifts',f.name,f.org),await count('jobs',f.name,f.org),await count('workers',f.name,f.org),await count('plant',f.name,f.org),await count('users',f.name,f.org)])===rowsA&&JSON.stringify(await preserved(f))===JSON.stringify(base0),h.log.slice(-120));
 await killGroup(h);

 // ------------------------------------------------------------------ scenarios 2 and 3: interruption and restart (the host kills the app mid-load)
 const interrupt=async(g,allowG,tag)=>{
  // Test-only database barrier: reads/fingerprints remain unchanged, but the first
  // work-area INSERT cannot race past the SIGKILL polling point. Install before
  // the backup fingerprint/plan and remove only after killed sessions are quiet.
  const barrier=await connectTo(g.name),barrierName='test_interrupt_'+sha(g.name).slice(0,32);
  const [[held]]=await barrier.query('SELECT GET_LOCK(?,0) a',[barrierName]);
  if(Number(held.a)!==1)throw new Error('Could not acquire interruption fixture barrier');
  await barrier.query("CREATE TRIGGER test_interrupt_gate BEFORE INSERT ON project_work_areas FOR EACH ROW SET @test_interrupt_gate = GET_LOCK('"+barrierName+"',120)");
  try{
  const fpG=await databaseFingerprint(await connectTo(g.name)),ev=JSON.stringify(await evidenceFor(g,{fingerprint:fpG}));
  let x=startCmd(hostedEnv(g,allowG,{EXISTING_TENANT_LOAD:'plan'}));await finished(x,'plan',120000);const phG=planHash(x);await killGroup(x);
  const applyEnv=(over={})=>hostedEnv(g,allowG,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:phG,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:ev,DEMO_SEED_PASSWORD:password,...over});
  x=startCmd(applyEnv());
  const killed=new Promise(r=>x.c.once('exit',(_code,signal)=>r(signal)));
  const underway=await waitFor(async()=>(await count('shifts',g.name,g.org))>0,300000);
  if(standalone&&tag==='b'){
   const [[owner]]=await db.query('SELECT IS_USED_LOCK(?) id',[loaderLockName(g.name)]);
   if(!owner.id)throw new Error('Expected a live standalone loader mutex owner');
   await db.query('KILL '+Number(owner.id));
   check('standalone recovery: loss of the real MySQL mutex session stops the loader',await waitFor(()=>/loader lock connection lost/.test(x.log),10000),x.log.slice(-200));
  }
  await killGroup(x);                                                          // SIGKILL the whole process group: the host restarted the app
  check('interruption: the actual hosted process exits from SIGKILL ('+tag+')',await killed==='SIGKILL');
  const lockFree=await waitFor(async()=>{const c=await connectTo(g.name);const [[l]]=await c.query('SELECT GET_LOCK(?,0) a',[lockName(g.name,g.org)]);if(Number(l.a)){await c.query('SELECT RELEASE_LOCK(?)',[lockName(g.name,g.org)]);return true;}return false;},30000);
  const partial={areas:await count('project_work_areas',g.name,g.org),shifts:await count('shifts',g.name,g.org),jobs:await count('jobs',g.name,g.org)};
  return {phG,applyEnv,underway,lockFree,partial,state:stateOf(g.name)};
  }finally{
   const quiet=await quiesce(await connectTo(g.name));
   if(quiet.remaining)throw new Error('Interrupted fixture still has active sessions');
   await barrier.query('SELECT RELEASE_LOCK(?)',[barrierName]);
   await barrier.query('DROP TRIGGER test_interrupt_gate');
  }
 };
 const expectFull=async g=>({areas:await count('project_work_areas',g.name,g.org),links:await count('shift_work_areas',g.name,g.org),shifts:await count('shifts',g.name,g.org),users:await count('users',g.name,g.org)});
 {const g=await populated('etr_resume_test','b'),aG=mkAllow(g),baseG=await preserved(g);
  const it=await interrupt(g,aG,'b');
  check('interruption: killing the whole app process group mid-apply leaves a partial import, a baseline and its evidence marker, and releases the database lock',it.underway&&it.partial.areas<20&&it.lockFree&&existsSync(join(it.state,'baseline.json'))&&existsSync(join(it.state,'baseline.json.evidence-ok')),JSON.stringify(it.partial));
  let x=startCmd(it.applyEnv());await finished(x,'apply',300000);const after1=await expectFull(g);
  check('restart: the host restarting the app with the same apply settings is refused safely (the plan changed because an import was interrupted): nothing is duplicated or changed',!exitOk(x,'apply')&&/plan-hash does not match/.test(x.log)&&after1.areas===it.partial.areas&&after1.shifts===it.partial.shifts,x.log.slice(-160));
  await killGroup(x);
  x=startCmd(hostedEnv(g,aG,{EXISTING_TENANT_LOAD:'plan'}));await finished(x,'plan',120000);const phNew=planHash(x);
  check('resume: a fresh plan (using the saved baseline) is produced and accepted for review',exitOk(x,'plan')&&Boolean(phNew)&&phNew!==it.phG&&!/CONFLICT|BLOCKER/.test(x.log),x.log.slice(-160));
  await killGroup(x);
  x=startCmd(it.applyEnv({EXISTING_TENANT_PLAN_HASH:phNew}));await finished(x,'apply',600000);const full=await expectFull(g);
  check('resume: the reviewed new hash finishes the import (the stale backup evidence is not needed because the baseline was created under it); 20 areas, 27 links, 17 shifts; 0 existing rows changed',exitOk(x,'apply')&&full.areas===20&&full.links===27&&full.shifts===17&&full.users===6&&/Resuming/.test(x.log)&&/Existing rows changed: 0; removed: 0/.test(x.log),JSON.stringify(full));
  check('resume: owner records, login, company profile and the other tenant are byte-for-byte unchanged after the interrupted-then-resumed import',JSON.stringify(await preserved(g))===JSON.stringify(baseG),'');
  await killGroup(x);
  x=startCmd(hostedEnv(g,aG,{EXISTING_TENANT_LOAD:'verify'}));await finished(x,'verify',120000);
  check('resume: verification passes and a second restart with the old apply settings still does nothing harmful',exitOk(x,'verify'),x.log.slice(-100));await killGroup(x);
  x=startCmd(it.applyEnv({EXISTING_TENANT_PLAN_HASH:phNew}));await finished(x,'apply',300000);
  check('restart after completion: the old apply settings left on are refused and change nothing',!exitOk(x,'apply')&&JSON.stringify(await expectFull(g))===JSON.stringify(full)&&JSON.stringify(await preserved(g))===JSON.stringify(baseG),'');await killGroup(x);}
 {const g=await populated('etr_lost_test','c'),aG=mkAllow(g),baseG=await preserved(g);
  const it=await interrupt(g,aG,'c');
  check('interruption (scenario 3): partial import, baseline and marker present',it.underway&&it.partial.areas<20&&existsSync(join(it.state,'baseline.json.evidence-ok')),JSON.stringify(it.partial));
  const keep=await expectFull(g);
  rmSync(join(it.state,'baseline.json.evidence-ok'));
  let x=startCmd(hostedEnv(g,aG,{EXISTING_TENANT_LOAD:'plan'}));await finished(x,'plan',120000);const phN=planHash(x);await killGroup(x);
  x=startCmd(it.applyEnv({EXISTING_TENANT_PLAN_HASH:phN}));await finished(x,'apply',300000);
  check('a baseline without its evidence marker is refused (it was not created under verified backup evidence): nothing changes',!exitOk(x,'apply')&&/not created under verified backup evidence/.test(x.log)&&JSON.stringify(await expectFull(g))===JSON.stringify(keep),x.log.slice(-140));await killGroup(x);
  rmSync(join(it.state,'baseline.json'));
  x=startCmd(hostedEnv(g,aG,{EXISTING_TENANT_LOAD:'plan'}));await finished(x,'plan',120000);const phL=planHash(x);const planRefused=!exitOk(x,'plan');await killGroup(x);
  x=startCmd(it.applyEnv({EXISTING_TENANT_PLAN_HASH:phL||'0'.repeat(64)}));await finished(x,'apply',300000);
  check('a LOST baseline after an interruption is never guessed around: the resume is refused (conflicts or changed-since-backup) and nothing is duplicated or modified; recovery is the restore of the backup',!exitOk(x,'apply')&&JSON.stringify(await expectFull(g))===JSON.stringify(keep)&&JSON.stringify(await preserved(g))===JSON.stringify(baseG),`plan refused=${planRefused} `+x.log.replace(/\s+/g,' ').slice(-170));await killGroup(x);}

 // ------------------------------------------------------------------ the importer's own deadline: nothing mutates after it, even with a request in flight; delayed sessions are cleared; resume works
 {const g=await populated('etr_deadline_test','e'),aG=mkAllow(g),baseG=await preserved(g);
  // Install the write barrier before fingerprint/plan: polling for shifts and
  // THEN locking this table can let the first area commit before the lock lands.
  const L=await connectTo(g.name),deadlineBarrier='test_deadline_'+sha(g.name).slice(0,32);
  const [[held]]=await L.query('SELECT GET_LOCK(?,0) a',[deadlineBarrier]);
  if(Number(held.a)!==1)throw new Error('Could not acquire deadline fixture barrier');
  await L.query("CREATE TRIGGER test_deadline_gate BEFORE INSERT ON project_work_areas FOR EACH ROW SET @test_deadline_gate = GET_LOCK('"+deadlineBarrier+"',120)");
  const evG=writeEv(await evidenceFor(g));
  const envG={...g.env,DEMO_SEED_EMAIL:g.emailA,DEMO_SEED_PASSWORD:password,EXISTING_TENANT_CONFIRM_SHA256:sha(aG.txt)};
  const imp=(args,t=240000)=>run('scripts/import-demo-tenant.mjs',envG,['--organisation-id',g.org,'--existing-tenant-allowlist',aG.file,...args],t);
  const bad=imp(['--apply','--plan-hash','x','--baseline',join(dir,'x.json'),'--backup-evidence',evG,'--deadline-ms','1']);
  check('deadline: a deadline that is already in the past is refused before anything happens',bad.status===2&&/future epoch/.test(out(bad)));
  const phG=/planHash: ([0-9a-f]{64})/.exec(out(imp([])))?.[1],baselineG=join(dir,'g-baseline.json');
  const deadline=Date.now()+32000;
  const child=spawn(process.execPath,[productScript('scripts/import-demo-tenant.mjs'),'--organisation-id',g.org,'--existing-tenant-allowlist',aG.file,'--apply','--plan-hash',phG,'--baseline',baselineG,'--backup-evidence',evG,'--deadline-ms',String(deadline)],{cwd:standalone||process.cwd(),env:{...process.env,...envG},stdio:['ignore','pipe','pipe']});
  let cout='';child.stdout.on('data',b=>cout+=b);child.stderr.on('data',b=>cout+=b);
  const exited=new Promise(r=>child.on('exit',c=>r(c)));
  // The trigger leaves the first work-area mutation in flight until quiescence
  // kills it. No work area can slip through before polling sees the shifts.
  await waitFor(async()=>(await count('shifts',g.name,g.org))>0,120000);
  const waiting=async()=>Number((await db.query("SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE DB=? AND COMMAND<>'Sleep' AND ID<>CONNECTION_ID() AND ID<>?",[g.name,L.threadId]))[0][0].n);
  const blockedSeen=await waitFor(async()=>(await waiting())>0,60000);
  const code=await Promise.race([exited,new Promise(r=>setTimeout(()=>r('timeout'),120000))]);
  const stoppedAt=Date.now();
  const stillWaiting=await waiting();                                                 // the importer is gone but its write is STILL queued on the server
  check('deadline: an import blocked on an in-flight write is stopped by its watchdog at the deadline (exit 75, resumable), not left running past the window it was protecting',blockedSeen&&code===75&&stoppedAt<deadline+16000&&/Deadline watchdog|maintenance deadline/.test(cout),`blocked=${blockedSeen} exit=${code} stopped ${stoppedAt-deadline} ms after the deadline`);
  const Yq=await connectTo(g.name);const qz0=await quiesce(Yq);                       // what the hosted loader does as soon as the importer has stopped
  await L.query('SELECT RELEASE_LOCK(?)',[deadlineBarrier]);await L.query('DROP TRIGGER test_deadline_gate');await new Promise(r=>setTimeout(r,4000));
  const [[lastAudit]]=await db.query('SELECT MAX(created_at) m FROM `'+g.name+'`.audit_log WHERE organisation_id=?',[g.org]);
  const areasAfter=await count('project_work_areas',g.name,g.org),activeAfter=await waiting()+0;
  check('delayed termination: after the importer exited its in-flight write was still queued in the database; quiescence killed it, and once the lock was released NOTHING was written (no work area, no application write later than 5 s after the deadline, no active session)',stillWaiting>=1&&qz0.killed>=1&&qz0.remaining===0&&areasAfter===0&&String(lastAudit.m)<new Date(deadline+5000).toISOString()&&activeAfter===0,`waiting-after-exit=${stillWaiting} ${JSON.stringify(qz0)} areas=${areasAfter} lastAudit=${lastAudit.m} deadline=${new Date(deadline).toISOString()} active=${activeAfter}`);
  const dry2=imp(['--baseline',baselineG,'--baseline-sha256',createHash('sha256').update(readFileSync(baselineG)).digest('hex')]);const ph2=/planHash: ([0-9a-f]{64})/.exec(out(dry2))?.[1];
  const r2=imp(['--apply','--plan-hash',ph2,'--baseline',baselineG,'--baseline-sha256',createHash('sha256').update(readFileSync(baselineG)).digest('hex')]);
  const fullG={areas:await count('project_work_areas',g.name,g.org),links:await count('shift_work_areas',g.name,g.org),shifts:await count('shifts',g.name,g.org)};
  check('deadline: after extending the window the import RESUMES from the saved baseline and completes; every pre-existing owner, login and other-tenant row is unchanged',r2.status===0&&fullG.areas===20&&fullG.links===27&&fullG.shifts===17&&JSON.stringify(await preserved(g))===JSON.stringify(baseG)&&/Existing rows changed: 0; removed: 0/.test(out(r2)),`exit ${r2.status} ${JSON.stringify(fullG)}`);
  // a session of a dead importer that is STILL executing a mutation on the server is cleared before the freeze is allowed to lapse
  const X=await connectTo(g.name),Y=await connectTo(g.name),Z=await connectTo(g.name);
  await X.query('START TRANSACTION');await X.query("INSERT INTO organisations (id,name,created_at) VALUES ('inflight-org','in flight',?)",[new Date().toISOString()]);
  const running=X.query('SELECT SLEEP(60)').then(()=>'finished',e=>'killed');
  await new Promise(r=>setTimeout(r,800));
  const qz=await quiesce(Y);const verdict=await Promise.race([running,new Promise(r=>setTimeout(()=>r('still running'),5000))]);
  const [[ghost]]=await db.query("SELECT COUNT(*) n FROM `"+g.name+"`.organisations WHERE id='inflight-org'");const [[zOk]]=await Z.query('SELECT 1 AS one');
  check('delayed termination: quiescence kills a lingering in-flight transaction (it rolls back; the row never appears), reports it, leaves idle sessions alone and ends with no active session',qz.killed>=1&&qz.remaining===0&&verdict==='killed'&&Number(ghost.n)===0&&Number(zOk.one)===1,JSON.stringify(qz)+verdict);
 }
 check('throughout every fingerprint, plan, apply, interruption, restart, resume and verify the HOSTED app (live-looking SMTP and storage settings, email enabled) contacted no integration',captured.smtp===capBase.smtp&&captured.s3===capBase.s3,`smtp+${captured.smtp-capBase.smtp} s3+${captured.s3-capBase.s3}`);
}catch(e){fail++;console.log('FAIL    aborted — '+(e?.stack||e));}
finally{smtpCap.close();s3Cap.close();for(const p of procs)try{process.kill(-p.pid,'SIGKILL');}catch{try{p.kill();}catch{/* gone */}}for(const c of conns)await c.end().catch(()=>{});for(const n of fixtures)await db.query('DROP DATABASE IF EXISTS `'+n+'`').catch(()=>{});await db.end();rmSync(dir,{recursive:true,force:true});}
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
