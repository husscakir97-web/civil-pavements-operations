// Hosted additive import into an EXISTING tenant: proven on disposable local fixtures only (never the real database). The fixture database carries
// the live database's NAME on purpose, so the test shows that only the explicit allow-list path can touch such a target (staging mode keeps
// refusing it, see test-staging-path.mjs). A populated owner tenant (own client, project, login, company profile) and a second tenant are
// preserved. The hosted flow is exercised through scripts/start.mjs (no shell, no npm), including SIGKILL interruptions and restarts.
//   npm run build   then   MYSQL_DATABASE=existing_tenant_path_test node scripts/test-existing-tenant-path.mjs
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
import {SESSION_TABLES} from './demo/import-guards.mjs';
import {databaseFingerprint,evaluateExistingTenantAllowlist,evaluateBackupEvidence} from './demo/existing-tenant.mjs';
import {CHILD_ENV_KEYS} from './existing-tenant-load.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
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
const run=(file,env,args=[],timeout=120000)=>spawnSync(process.execPath,[file,...args],{env,encoding:'utf8',timeout});
const startApp=async(port,env)=>{const c=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env,stdio:'ignore'});procs.push(c);for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).ok)return c;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}throw new Error('app did not start');};
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
 return {name,env,org:ua.organisation_id,orgB:ub.organisation_id,emailA,ownerUser:ua.id,otherUser:ub.id};
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
const startCmd=(env,port=P1)=>{const c=spawn(process.execPath,['scripts/start.mjs'],{env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe'],detached:true});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);procs.push(c);return {c,get log(){return log;}};};
const killGroup=async h=>{try{process.kill(-h.c.pid,'SIGKILL');}catch{/* gone */}const i=procs.indexOf(h.c);if(i>=0)procs.splice(i,1);await new Promise(r=>setTimeout(r,2500));};
const waitFor=async(fn,ms=300000)=>{for(let i=0;i<ms/400;i++){if(await fn())return true;await new Promise(r=>setTimeout(r,400));}return false;};
const hostedEnv=(f,a,over={})=>({...f.env,NODE_ENV:'production',BETTER_AUTH_SECRET:'existing-tenant-secret-with-at-least-32-chars!',BETTER_AUTH_URL:'https://existing.example.invalid',EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',
 // everything an operator's real app would carry; the loader must NOT pass any of it on
 SMTP_HOST:'smtp.example.invalid',SMTP_USER:'u',SMTP_PASSWORD:'p',MAIL_FROM:'m@example.invalid',AI_API_KEY:'k',BILLING_PROVIDER:'b',ABR_GUID:'g',GOOGLE_MAPS_BROWSER_KEY:'k',R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x',
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

 // ------------------------------------------------------------------ scenario 1b: the hosted flow through scripts/start.mjs (no shell, no npm)
 const stateOf=x=>join(dir,'state-'+x);
 let h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'fingerprint'}));
 await waitFor(()=>/fingerprint: [0-9a-f]{64}/.test(h.log),90000);
 const fp=/fingerprint: ([0-9a-f]{64})/.exec(h.log)?.[1];
 check('hosted flow: the fingerprint step (read-only) prints the value for the backup evidence, equal to the database\'s fingerprint, while the app serves',fp===await databaseFingerprint(await connectTo(f.name))&&(await fetch(`http://127.0.0.1:${P1}/login`).then(r=>r.ok,()=>false)),fp);
 await killGroup(h);
 const ownerBefore=await count('clients',f.name,f.org),ownerJobsBefore=await count('jobs',f.name,f.org),otherAreasBefore=await count('project_work_areas',f.name,f.orgB);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'plan'}));await finished(h,'plan',120000);const ph=planHash(h);
 check('hosted flow: the plan run prints the plan, its hash and no conflicts against the populated owner tenant, and writes nothing',exitOk(h,'plan')&&Boolean(ph)&&!/CONFLICT|BLOCKER/.test(h.log)&&(await world(f.name))===w0,h.log.slice(-160));
 await killGroup(h);
 const evJson=JSON.stringify(await evidenceFor(f,{fingerprint:fp}));
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:evJson}));
 await finished(h,'apply',60000);
 check('hosted flow: apply without the one-run administrator password is refused and nothing changes',!exitOk(h,'apply')&&/DEMO_SEED_PASSWORD/.test(h.log)&&(await world(f.name))===w0);
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,DEMO_SEED_PASSWORD:password}));
 await finished(h,'apply',60000);
 check('hosted flow: the first apply without backup evidence is refused and nothing changes',!exitOk(h,'apply')&&/BACKUP_EVIDENCE/.test(h.log)&&(await world(f.name))===w0);
 await killGroup(h);
 h=startCmd(hostedEnv(f,allow,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:ph,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:evJson,DEMO_SEED_PASSWORD:password}));
 const done=await finished(h,'apply',600000);
 const n={areas:await count('project_work_areas',f.name,f.org),points:await count('project_work_points',f.name,f.org),links:await count('shift_work_areas',f.name,f.org),shifts:await count('shifts',f.name,f.org),jobs:await count('jobs',f.name,f.org),users:await count('users',f.name,f.org)};
 check('hosted flow: with the reviewed hash, evidence and the one-run password the full demo company is ADDED to the existing owner tenant (SMTP/AI/billing/R2 settings were present in the app\'s environment and were not passed on)',done&&exitOk(h,'apply')&&n.areas===20&&n.points===3&&n.links===27&&n.shifts===17&&n.jobs===ownerJobsBefore+3&&n.users===6&&/Backup evidence accepted/.test(h.log),JSON.stringify(n)+h.log.slice(-120));
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
  const fpG=await databaseFingerprint(await connectTo(g.name)),ev=JSON.stringify(await evidenceFor(g,{fingerprint:fpG}));
  let x=startCmd(hostedEnv(g,allowG,{EXISTING_TENANT_LOAD:'plan'}));await finished(x,'plan',120000);const phG=planHash(x);await killGroup(x);
  const applyEnv=(over={})=>hostedEnv(g,allowG,{EXISTING_TENANT_LOAD:'apply',EXISTING_TENANT_PLAN_HASH:phG,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:ev,DEMO_SEED_PASSWORD:password,...over});
  x=startCmd(applyEnv());
  const underway=await waitFor(async()=>(await count('shifts',g.name,g.org))>0,300000);
  await killGroup(x);                                                          // SIGKILL the whole process group: the host restarted the app
  const lockFree=await waitFor(async()=>{const c=await connectTo(g.name);const [[l]]=await c.query('SELECT GET_LOCK(?,0) a',[lockName(g.name,g.org)]);if(Number(l.a)){await c.query('SELECT RELEASE_LOCK(?)',[lockName(g.name,g.org)]);return true;}return false;},30000);
  const partial={areas:await count('project_work_areas',g.name,g.org),shifts:await count('shifts',g.name,g.org),jobs:await count('jobs',g.name,g.org)};
  return {phG,applyEnv,underway,lockFree,partial,state:stateOf(g.name)};
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
}catch(e){fail++;console.log('FAIL    aborted — '+(e?.stack||e));}
finally{for(const p of procs)try{process.kill(-p.pid,'SIGKILL');}catch{try{p.kill();}catch{/* gone */}}for(const c of conns)await c.end().catch(()=>{});for(const n of fixtures)await db.query('DROP DATABASE IF EXISTS `'+n+'`').catch(()=>{});await db.end();rmSync(dir,{recursive:true,force:true});}
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
