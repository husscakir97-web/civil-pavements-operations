// Staging demonstration path (NOT activated anywhere): app-side staging mode (closed sign-up, fail-closed configuration) and the importer's
// explicit allow-list mode, proven on a disposable local database. The database here ends in _test only because THIS HARNESS refuses anything
// else; the staging path itself never relies on the name (see the pure cases below, which use non-_test names).
//   npm run build   then   MYSQL_DATABASE=staging_path_test node scripts/test-staging-path.mjs
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {connect} from './mysql-config.mjs';
import {evaluateAllowlist} from './demo/staging-allowlist.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const require=createRequire(import.meta.url);
let pass=0,fail=0;const check=(s,ok,d='')=>{if(ok)pass++;else fail++;console.log(`${ok?'PASS':'FAIL'}    ${s}${d?' — '+String(d).slice(0,200):''}`);};
const load=file=>{const m={exports:{}};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','module',code)(m.exports,require,m);return m.exports;};

// ------------------------------------------------------------------ pure: app-side staging mode
const st=await import('../lib/platform/staging-policy.mjs');
const stTs=load('lib/platform/staging.ts');   // the app's TypeScript copy
const good={STAGING_DEMO_MODE:'true',STAGING_DEMO_DATABASE:'stg_demo',STAGING_DEMO_URL:'https://demo.example.invalid',STAGING_DEMO_ADMIN_EMAIL:'owner@example.invalid',MYSQL_DATABASE:'stg_demo',BETTER_AUTH_URL:'https://demo.example.invalid',EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake'};
check('staging mode is off by default and then changes nothing',!st.stagingActive({})&&st.stagingProblems({}).length>0&&st.stagingSignupDecision('anyone@x.invalid',5,{}).allowed&&(()=>{st.assertStagingSafe({});return true;})());
check('a correct allow-listed configuration has no problems (a database name without _test is fine)',st.stagingProblems(good).length===0,JSON.stringify(st.stagingProblems(good)));
for(const [label,over,re] of [
 ['database differs from the allow-listed one',{MYSQL_DATABASE:'other_db'},/STAGING_DEMO_DATABASE/],
 ['public URL differs from the allow-listed one',{BETTER_AUTH_URL:'https://elsewhere.example.invalid'},/STAGING_DEMO_URL/],
 ['the known live database (u840559204_infra_test) despite its _test suffix',{MYSQL_DATABASE:'u840559204_infra_test',STAGING_DEMO_DATABASE:'u840559204_infra_test'},/protected live database/],
 ['the other recorded production database name',{MYSQL_DATABASE:'u840559204_infrastruct',STAGING_DEMO_DATABASE:'u840559204_infrastruct'},/protected live database/],
 ['a live database named in any letter case',{MYSQL_DATABASE:'U840559204_Infra_Test',STAGING_DEMO_DATABASE:'U840559204_Infra_Test'},/protected live database/],
 ['an operator-listed protected database',{STAGING_REFUSE_DATABASES:'stg_demo'},/protected live database/],
 ['the known live app URL',{STAGING_DEMO_URL:'https://darkgray-buffalo-804670.hostingersite.com',BETTER_AUTH_URL:'https://darkgray-buffalo-804670.hostingersite.com'},/protected live address/],
 ['another host on the live name prefixes (darkgray-/navajowhite-)',{STAGING_DEMO_URL:'https://navajowhite-example-1.hostingersite.com',BETTER_AUTH_URL:'https://navajowhite-example-1.hostingersite.com'},/protected live address/],
 ['an operator-listed protected URL',{STAGING_REFUSE_URLS:'https://demo.example.invalid'},/protected live address/],
 ['an unparseable URL',{STAGING_DEMO_URL:'not a url',BETTER_AUTH_URL:'not a url'},/protected live address|https/],
 ['no staging target named at all',{STAGING_DEMO_DATABASE:'',STAGING_DEMO_URL:''},/STAGING_DEMO_DATABASE/],
 ['no administrator email',{STAGING_DEMO_ADMIN_EMAIL:''},/ADMIN_EMAIL/],
 ['email enabled',{EMAIL_ENABLED:'true'},/EMAIL_ENABLED/],['AI enabled',{AI_ENABLED:'true'},/AI_ENABLED/],
 ['a real map provider',{LOCATION_PROVIDER:'google'},/LOCATION_PROVIDER/],['no provider setting at all',{LOCATION_PROVIDER:''},/LOCATION_PROVIDER/],
 ['SMTP configured',{SMTP_HOST:'smtp.example.invalid'},/SMTP_HOST/],['object storage configured',{R2_BUCKET_NAME:'b'},/R2_BUCKET_NAME/],
 ['billing configured',{BILLING_PROVIDER:'x'},/BILLING_PROVIDER/],['ABR configured',{ABR_GUID:'g'},/ABR_GUID/],['an AI key present',{AI_API_KEY:'k'},/AI_API_KEY/],
 ['Google Maps key present',{GOOGLE_MAPS_BROWSER_KEY:'k'},/GOOGLE_MAPS/]]){
 const p=st.stagingProblems({...good,...over}).join('|');let threw=false;try{st.assertStagingSafe({...good,...over});}catch{threw=true;}
 check(`staging mode refuses: ${label}`,re.test(p)&&threw,p);}
check('sign-up: only the allow-listed administrator, only while no user exists, case-insensitive',st.stagingSignupDecision('OWNER@example.invalid',0,good).allowed&&!st.stagingSignupDecision('owner@example.invalid',1,good).allowed&&!st.stagingSignupDecision('stranger@example.invalid',0,good).allowed);
{const cfg=load('next.config.ts').default;process.env.STAGING_DEMO_MODE='true';const on=await cfg.headers();delete process.env.STAGING_DEMO_MODE;const off=await cfg.headers();
 check('staging builds send X-Robots-Tag noindex; other builds send nothing extra',/noindex/.test(JSON.stringify(on))&&off.length===0);}


// the two copies (app TypeScript, scripts plain JS) must agree on every environment: a matrix over each decisive variable
{const base0=good,vals={STAGING_DEMO_MODE:['true','false',''],MYSQL_DATABASE:['stg_demo','u840559204_infra_test','U840559204_INFRASTRUCT','other'],STAGING_DEMO_DATABASE:['stg_demo','u840559204_infra_test','','other'],BETTER_AUTH_URL:['https://demo.example.invalid','https://darkgray-buffalo-804670.hostingersite.com','https://navajowhite-x.hostingersite.com','not a url','http://127.0.0.1:3000'],STAGING_DEMO_URL:['https://demo.example.invalid','https://darkgray-buffalo-804670.hostingersite.com','','http://127.0.0.1:3000'],EMAIL_ENABLED:['false','true',''],LOCATION_PROVIDER:['fake','none','google',''],R2_BUCKET_NAME:['','b'],SMTP_HOST:['','h'],AI_ENABLED:['','true'],STAGING_REFUSE_DATABASES:['','stg_demo'],STAGING_REFUSE_URLS:['','https://demo.example.invalid']};
 let agree=true,cases=0;
 for(const [k,vs] of Object.entries(vals))for(const v of vs){const env={...base0,[k]:v};cases++;
  const a=JSON.stringify([st.stagingActive(env),st.stagingProblems(env),st.stagingSignupDecision('OWNER@example.invalid',0,env),st.stagingSignupDecision('x@y.invalid',2,env)]),b=JSON.stringify([stTs.stagingActive(env),stTs.stagingProblems(env),stTs.stagingSignupDecision('OWNER@example.invalid',0,env),stTs.stagingSignupDecision('x@y.invalid',2,env)]);
  if(a!==b){agree=false;console.log('DIVERGED',k,v);}}
 check(`the app's TypeScript policy and the scripts' JS policy agree on ${cases} environments, and list the same protected targets`,agree&&JSON.stringify(st.PROTECTED_DATABASES)===JSON.stringify(stTs.PROTECTED_DATABASES)&&JSON.stringify(st.PROTECTED_HOSTS)===JSON.stringify(stTs.PROTECTED_HOSTS)&&JSON.stringify(st.PROTECTED_HOST_PREFIXES)===JSON.stringify(stTs.PROTECTED_HOST_PREFIXES));}

// ------------------------------------------------------------------ pure: importer allow-list
const dir=mkdtempSync(join(tmpdir(),'staging-path-'));
const mkList=(over={},mode=0o600)=>{const f=join(dir,'allow-'+Math.random().toString(36).slice(2)+'.json');const body={environment:'staging-demo',host:'db.example.invalid',port:3306,database:'stg_demo',user:'stg_user',appUrl:'https://demo.example.invalid',adminEmail:'owner@example.invalid',...over};writeFileSync(f,JSON.stringify(body));chmodSync(f,mode);return f;};
const shaOf=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const envFor=(f,over={})=>({MYSQL_HOST:'db.example.invalid',MYSQL_PORT:'3306',MYSQL_DATABASE:'stg_demo',MYSQL_USER:'stg_user',DEMO_SEED_EMAIL:'owner@example.invalid',STAGING_DEMO_CONFIRM_SHA256:shaOf(f),...over});
{const f=mkList();check('allow-list: an exact, hash-confirmed match passes (non-_test database, remote host)',evaluateAllowlist(f,envFor(f)).problems.length===0,evaluateAllowlist(f,envFor(f)).problems.join('|'));
 const cases=[
  ['no confirmation hash',f,envFor(f,{STAGING_DEMO_CONFIRM_SHA256:undefined}),/SHA-256/],['wrong confirmation hash',f,envFor(f,{STAGING_DEMO_CONFIRM_SHA256:'0'.repeat(64)}),/SHA-256/],
  ['different host',f,envFor(f,{MYSQL_HOST:'db2.example.invalid'}),/host/],['different port',f,envFor(f,{MYSQL_PORT:'3307'}),/port/],['different database',f,envFor(f,{MYSQL_DATABASE:'u840559204_infra_test'}),/MYSQL_DATABASE/],['different user',f,envFor(f,{MYSQL_USER:'someone'}),/user/],
  ['a different administrator',f,envFor(f,{DEMO_SEED_EMAIL:'other@example.invalid'}),/administrator/]];
 for(const [label,file,env,re] of cases){const r=evaluateAllowlist(file,env);check(`allow-list refuses: ${label}`,r.problems.length>0&&re.test(r.problems.join('|')),r.problems.join('|'));}
 for(const [label,over,re] of [['the known live database despite a _test suffix',{database:'u840559204_infra_test'},/protected live database/],['the other recorded production database',{database:'u840559204_infrastruct'},/protected live database/],['an operator-listed protected database',{database:'stg_demo',refuseDatabases:['stg_demo']},/protected live database/],['the live app URL',{appUrl:'https://darkgray-buffalo-804670.hostingersite.com'},/protected live address/],['a wildcard',{database:'stg_%'},/wildcard/],['a plain-http public URL',{appUrl:'http://demo.example.invalid'},/https/],['the wrong environment',{environment:'production'},/environment/],['an unknown key',{allowEverything:true},/unknown/],['a non-integer port',{port:'3306'},/port/]]){
  const g=mkList(over);const r=evaluateAllowlist(g,envFor(g,{MYSQL_DATABASE:over.database||'stg_demo'}));check(`allow-list refuses: file names ${label}`,r.problems.length>0&&re.test(r.problems.join('|')),r.problems.join('|'));}
 const loose=mkList({},0o666);check('allow-list refuses a file other users can write',/writable/.test(evaluateAllowlist(loose,envFor(loose)).problems.join('|')));
 check('allow-list refuses a missing file',/cannot be read/.test(evaluateAllowlist(join(dir,'nope.json'),{}).problems.join('|')));
 const bad=join(dir,'bad.json');writeFileSync(bad,'{nope');chmodSync(bad,0o600);check('allow-list refuses invalid JSON',/valid JSON/.test(evaluateAllowlist(bad,envFor(bad)).problems.join('|')));}

// ------------------------------------------------------------------ integration: disposable local fixtures only (never a real database)
const PORT=Number(process.env.PORT||3197),base=`http://127.0.0.1:${PORT}`,BAD_PORT=PORT+1;
const dbName=process.env.MYSQL_DATABASE,ADMIN='stage-owner@example.invalid',password='Staging-Admin-Password-Strong-42!';
const LIVE_LOOKALIKE='u840559204_infra_test';   // a disposable LOCAL fixture that merely carries the live database's name; the real database is never contacted
const db=await connect();
const [[u]]=await db.query('SELECT COUNT(*) n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(u.n))throw new Error('Refusing: the disposable database already has users.');
const mysqlEnv=(database=dbName)=>({PATH:process.env.PATH,HOME:process.env.HOME,MYSQL_HOST:process.env.MYSQL_HOST,MYSQL_PORT:process.env.MYSQL_PORT,MYSQL_DATABASE:database,MYSQL_USER:process.env.MYSQL_USER,MYSQL_PASSWORD:process.env.MYSQL_PASSWORD});
const stagingEnv=(port,over={},database=dbName)=>({...mysqlEnv(database),NODE_ENV:'production',BETTER_AUTH_SECRET:'staging-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:`http://127.0.0.1:${port}`,STAGING_DEMO_MODE:'true',STAGING_DEMO_DATABASE:database,STAGING_DEMO_URL:`http://127.0.0.1:${port}`,STAGING_DEMO_ADMIN_EMAIL:ADMIN,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',...over});
const fixtures=[];
const makeDb=async name=>{await db.query('DROP DATABASE IF EXISTS `'+name+'`');await db.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');fixtures.push(name);};
const tableCount=async name=>Number((await db.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[name]))[0][0].n);
const worldDigest=async name=>{const [t]=await db.query('SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY 1',[name]);const h=createHash('sha256');for(const {n} of t){const [rows]=await db.query('SELECT * FROM `'+name+'`.`'+n+'`');h.update(n+JSON.stringify(rows));}return h.digest('hex');};
const run=(file,env,args=[],timeout=60000)=>spawnSync(process.execPath,[file,...args],{env,encoding:'utf8',timeout});
const out=r=>(r.stdout||'')+(r.stderr||'');
const servers=[];const start=async(port,env)=>{const s=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env,stdio:'ignore'});servers.push(s);for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).ok)return;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}throw new Error('server did not start');};
const signup=async(origin,email)=>{let r;for(let a=0;a<8;a++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Demo Owner',email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}return r;};
const count=async(t,name=dbName)=>Number((await db.query('SELECT COUNT(*) n FROM `'+name+'`.`'+t+'`'))[0][0].n);
try{
 // ---- the restrictions run BEFORE any migration / bootstrap write: every entry point that migrates or connects is refused on empty fixtures, which stay empty
 {const names={live:LIVE_LOOKALIKE,url:'stg_refuse_url_test',target:'stg_no_target_test'};for(const n of Object.values(names))await makeDb(n);
  const cases=[
   ['migrate.mjs (the step npm start runs)','scripts/migrate.mjs',stagingEnv(PORT,{},names.live),names.live,/protected live database/],
   ['migrate-on-build.mjs (the prebuild hook npm run build runs)','scripts/migrate-on-build.mjs',stagingEnv(PORT,{},names.live),names.live,/protected live database/],
   ['start.mjs (npm start itself: it must refuse before migrating or serving)','scripts/start.mjs',stagingEnv(PORT,{},names.live),names.live,/protected live database/],
   ['migrate.mjs with the live app URL',"scripts/migrate.mjs",stagingEnv(PORT,{STAGING_DEMO_URL:'https://darkgray-buffalo-804670.hostingersite.com',BETTER_AUTH_URL:'https://darkgray-buffalo-804670.hostingersite.com'},names.url),names.url,/protected live address/],
   ['migrate-on-build.mjs with no independent staging target named','scripts/migrate-on-build.mjs',stagingEnv(PORT,{STAGING_DEMO_DATABASE:'',STAGING_DEMO_URL:''},names.target),names.target,/STAGING_DEMO_DATABASE/],
   ['migrate.mjs with an integration configured','scripts/migrate.mjs',stagingEnv(PORT,{SMTP_HOST:'smtp.example.invalid'},names.target),names.target,/SMTP_HOST/],
   ['the platform-knowledge importer','scripts/import-platform-knowledge.mjs',stagingEnv(PORT,{},names.live),names.live,/protected live database/]];
  for(const [label,file,env,target,re] of cases){const r=run(file,env,file.endsWith('knowledge.mjs')?['knowledge/platform/example.synthetic.json']:[],20000);
   check(`before any write: ${label} is refused and leaves the fixture empty`,r.status!==0&&re.test(out(r))&&(await tableCount(target))===0,`${r.status} tables=${await tableCount(target)} ${out(r).slice(0,100).replace(/\s+/g,' ')}`);}
  // the same refusal on a POPULATED look-alike: nothing changes
  const m=run('scripts/migrate.mjs',mysqlEnv(names.live),[],120000);const t=new Date().toISOString();
  await db.query('INSERT INTO `'+names.live+'`.organisations (id,name,created_at) VALUES (?,?,?)',['live-like-org','Fixture standing in for the live company',t]);
  const before=await worldDigest(names.live);
  const app=run('scripts/migrate.mjs',stagingEnv(PORT,{},names.live),[],30000);
  const allowLive=join(dir,'live-allow.json');writeFileSync(allowLive,JSON.stringify({environment:'staging-demo',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:names.live,user:process.env.MYSQL_USER,appUrl:'https://demo.example.invalid',adminEmail:ADMIN}));chmodSync(allowLive,0o600);
  const imp=run('scripts/import-demo-tenant.mjs',{...process.env,...mysqlEnv(names.live),DEMO_SEED_EMAIL:ADMIN,DEMO_SEED_PASSWORD:password,STAGING_DEMO_CONFIRM_SHA256:shaOf(allowLive),EMAIL_ENABLED:'false'},['--organisation-id','live-like-org','--apply','--plan-hash','x','--baseline',join(dir,'live-baseline.json'),'--staging-allowlist',allowLive],60000);
  const dry=run('scripts/import-demo-tenant.mjs',{...process.env,...mysqlEnv(names.live),DEMO_SEED_EMAIL:ADMIN,STAGING_DEMO_CONFIRM_SHA256:shaOf(allowLive)},['--organisation-id','live-like-org','--staging-allowlist',allowLive],60000);
  check('a migrated fixture carrying the live database name: staging-mode start, the importer apply (allow-list naming it) and the importer dry run are all refused and every row of every table is unchanged',m.status===0&&app.status!==0&&imp.status===2&&dry.status===2&&/protected live database/.test(out(imp))&&(await worldDigest(names.live))===before,`${app.status}/${imp.status}/${dry.status}`);
 }

 // ---- the real staging flow on a fresh fixture: app + importer bound to the SAME allow-listed database
 await makeDb(dbName+'_x').catch(()=>{});
 const mig=run('scripts/migrate.mjs',mysqlEnv(),[],120000);if(mig.status!==0)throw new Error(out(mig));
 await start(BAD_PORT,stagingEnv(BAD_PORT,{R2_BUCKET_NAME:'a-real-bucket'}));
 let r=await signup(`http://127.0.0.1:${BAD_PORT}`,ADMIN);
 check('app: staging mode with an integration configured refuses to run authentication (sign-up fails, no user created)',r.status>=400&&(await count('users'))===0&&(await count('auth_user'))===0,String(r.status));
 servers.pop().kill();
 await start(PORT,stagingEnv(PORT));
 r=await signup(base,'stranger@example.invalid');
 check('app: a stranger cannot register on the staging app',r.status>=400&&(await count('auth_user'))===0,String(r.status));
 r=await signup(base,ADMIN);
 const [[admin]]=await db.query('SELECT id,organisation_id,role FROM users WHERE email=?',[ADMIN]);
 check('app: the allow-listed administrator can register once and becomes administrator of a new organisation',r.ok&&admin?.role==='admin'&&Boolean(admin.organisation_id),String(r.status));
 r=await signup(base,ADMIN);const r2=await signup(base,'second@example.invalid');
 check('app: after that, sign-up is closed (same email again and a new email are both refused)',r.status>=400&&r2.status>=400&&(await count('auth_user'))===1,`${r.status}/${r2.status}`);
 const t=new Date().toISOString();await db.query('INSERT INTO organisation_profiles (organisation_id,created_at,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)',[admin.organisation_id,t,t]);await db.query('UPDATE organisation_profiles SET onboarding_completed_at=? WHERE organisation_id=?',[t,admin.organisation_id]);
 const si=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:ADMIN,password})});
 check('app: the administrator can sign in',si.ok);
 servers.pop().kill();

 const allow=join(dir,'real-allow.json');writeFileSync(allow,JSON.stringify({environment:'staging-demo',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:dbName,user:process.env.MYSQL_USER,appUrl:'https://demo.example.invalid',adminEmail:ADMIN}));chmodSync(allow,0o600);
 const baseline=join(dir,'baseline.json'),sha=shaOf(allow);
 const env={...process.env,DEMO_SEED_EMAIL:ADMIN,DEMO_SEED_PASSWORD:password,STAGING_DEMO_CONFIRM_SHA256:sha,EMAIL_ENABLED:'false',R2_ENDPOINT:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET_NAME:''};
 const imp=(args,over={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs',...args],{env:{...env,...over},encoding:'utf8',timeout:1500000});
 const text=out;const hashOf=x=>/planHash: ([0-9a-f]{64})/.exec(text(x))?.[1];
 const ORG=admin.organisation_id,ALLOW=['--staging-allowlist',allow];
 const dry=imp(['--organisation-id',ORG,...ALLOW]);const plan=hashOf(dry);
 check('importer: dry run against the allow-listed database works',dry.status===0&&Boolean(plan),text(dry).slice(-160));
 const before=await count('project_work_areas');
 const applyArgs=['--organisation-id',ORG,'--apply','--plan-hash',plan,'--baseline',baseline,...ALLOW];
 for(const [label,over,re] of [
  ['no confirmation hash',{STAGING_DEMO_CONFIRM_SHA256:''},/SHA-256/],['a wrong confirmation hash',{STAGING_DEMO_CONFIRM_SHA256:'f'.repeat(64)},/SHA-256/],
  ['an integration configured (SMTP)',{SMTP_HOST:'smtp.example.invalid'},/SMTP_HOST/],['email enabled',{EMAIL_ENABLED:'true'},/EMAIL_ENABLED/],
  ['a different administrator email',{DEMO_SEED_EMAIL:'x@example.invalid'},/administrator/],
  ['a different database than the allow-list names',{MYSQL_DATABASE:dbName+'_x'},/MYSQL_DATABASE/]]){
  const x=imp(applyArgs,over);check(`importer apply refused: ${label} (nothing changed)`,x.status===2&&re.test(text(x))&&(await count('project_work_areas'))===before,text(x).slice(-140));}
 await db.query("INSERT INTO organisations (id,name,created_at) VALUES ('other-org','Another tenant',?)",[t]);
 {const x=imp(applyArgs);check('importer apply refused when the staging database holds a second organisation',x.status===3&&/exactly one organisation/.test(text(x))&&(await count('project_work_areas'))===before,text(x).slice(-200));}
 await db.query("DELETE FROM organisations WHERE id='other-org'");
 await db.query("INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES ('stranger-login','S','stranger@example.invalid',0,?,?)",[new Date(),new Date()]).catch(()=>{});
 {const x=imp(applyArgs);const had=Number((await db.query("SELECT COUNT(*) n FROM auth_user WHERE id='stranger-login'"))[0][0].n);check('importer apply refused when a second login exists',had===0||(x.status===3&&/exactly one login/.test(text(x))),text(x).slice(-160));await db.query("DELETE FROM auth_user WHERE id='stranger-login'");}

 // interrupted first apply, then resume, then repeat, then verify
 const child=spawn(process.execPath,['scripts/import-demo-tenant.mjs',...applyArgs],{env,stdio:'ignore'});let exited=false;child.on('exit',()=>{exited=true;});
 for(let i=0;i<400&&!exited&&(await count('shifts'))===0;i++)await new Promise(r=>setTimeout(r,100));const killedMidRun=!exited;try{child.kill('SIGKILL');}catch{/* gone */}await new Promise(r=>setTimeout(r,3000));
 const partial={areas:await count('project_work_areas'),users:await count('users')};
 const bsha=createHash('sha256').update(readFileSync(baseline)).digest('hex'),WB=['--baseline',baseline,'--baseline-sha256',bsha];
 check('an apply killed part-way (before it finished) has written a baseline and only part of the dataset',killedMidRun&&partial.areas<20,JSON.stringify(partial));
 const dryR=imp(['--organisation-id',ORG,'--out',join(dir,'pr.json'),...WB,...ALLOW]);
 check('resume: the dry run is accepted although some demonstration team members already exist (the one-user prerequisite counts only the administrator, the dataset\'s five members and one login)',dryR.status===0&&Boolean(hashOf(dryR)),text(dryR).slice(-200));
 const resumed=imp(['--organisation-id',ORG,'--apply','--plan-hash',hashOf(dryR)||'x',...WB,...ALLOW]);
 check('resume: the interrupted import finishes on the same allow-listed database',resumed.status===0,text(resumed).slice(-240));
 const n={areas:await count('project_work_areas'),points:await count('project_work_points'),links:await count('shift_work_areas'),shifts:await count('shifts'),orgs:await count('organisations'),users:await count('users'),logins:await count('auth_user')};
 check('the full demo company is loaded: 20 work areas, 3 work points, 27 shift links, 17 shifts, one organisation, the administrator plus five team members, still ONE login',n.areas===20&&n.points===3&&n.links===27&&n.shifts===17&&n.orgs===1&&n.users===6&&n.logins===1,JSON.stringify(n));
 const dry2=imp(['--organisation-id',ORG,'--out',join(dir,'p2.json'),...WB,...ALLOW]);
 check('repeat: with the members now present, a fresh dry run finds nothing left to create',dry2.status===0&&/create 0/.test(text(dry2)),text(dry2).slice(-120));
 const rows1=JSON.stringify(await Promise.all(['project_work_areas','shifts','jobs','workers','plant','users','clients'].map(t=>count(t))));
 const again=imp(['--organisation-id',ORG,'--apply','--plan-hash',hashOf(dry2)||'x',...WB,...ALLOW]);
 check('repeat: applying again succeeds and creates no duplicates',again.status===0&&JSON.stringify(await Promise.all(['project_work_areas','shifts','jobs','workers','plant','users','clients'].map(t=>count(t))))===rows1,text(again).slice(-160));
 const ver=run('scripts/staging-verify.mjs',{...env},['--organisation-id',ORG,...ALLOW],120000);
 check('verification: the read-only staging verifier passes after the import (members and one login accepted)',ver.status===0&&/verified/.test(text(ver)),text(ver).slice(-200));
 const verBad=run('scripts/staging-verify.mjs',{...env,MYSQL_DATABASE:dbName+'_x'},['--organisation-id',ORG,...ALLOW],60000);
 check('verification: refused when pointed at a database the allow-list does not name',verBad.status===2,String(verBad.status));

 // both writers are bound to the same allow-listed database and nothing external is reachable
 const {isolatedAppEnv}=await import('./demo/import-app.mjs');const ie=isolatedAppEnv({...mysqlEnv(),SMTP_HOST:'x',AI_API_KEY:'k',BILLING_PROVIDER:'b'},'http://127.0.0.1:1');
 check('binding: the importer\'s own app receives exactly the allow-listed database and no integration (email/AI off, fake locations, no SMTP/AI/billing values carried over)',ie.MYSQL_DATABASE===dbName&&ie.EMAIL_ENABLED==='false'&&ie.AI_ENABLED==='false'&&ie.LOCATION_PROVIDER==='fake'&&!ie.SMTP_HOST&&!ie.AI_API_KEY&&!ie.BILLING_PROVIDER);
 const probs=st.stagingProblems(stagingEnv(PORT));
 check('binding: the hosted app\'s staging environment names the same database as the allow-list file',probs.length===0&&stagingEnv(PORT).STAGING_DEMO_DATABASE===JSON.parse(readFileSync(allow,'utf8')).database);

 // ---- managed-hosting path: no shell, no npm. Everything runs from the app's own start command (scripts/start.mjs), controlled by environment variables only.
 {const Y=dbName+'_y',P2=PORT+2,o2=`http://127.0.0.1:${P2}`;await makeDb(Y);
  const startCmd=(env)=>{const c=spawn(process.execPath,['scripts/start.mjs'],{env:{...env,PORT:String(P2)},stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);servers.push(c);return {c,get log(){return log;}};};
  const waitFor=async(fn,ms=240000)=>{for(let i=0;i<ms/500;i++){if(await fn())return true;await new Promise(r=>setTimeout(r,500));}return false;};
  const up=async()=>{try{return (await fetch(o2+'/login')).ok;}catch{return false;}};
  const stop=async h=>{h.c.kill();servers.splice(servers.indexOf(h.c),1);await new Promise(r=>setTimeout(r,1500));};
  const baseEnv=stagingEnv(P2,{},Y);
  let h=startCmd(baseEnv);
  check('managed start: scripts/start.mjs (what the host runs) migrates the staging database and serves',await waitFor(up)&&(await tableCount(Y))>50);
  const rr=await signup(o2,ADMIN);const [[adm]]=await db.query('SELECT organisation_id FROM `'+Y+'`.users WHERE email=?',[ADMIN]);
  check('managed start: the administrator registers once on that app',rr.ok&&Boolean(adm?.organisation_id));
  const t2=new Date().toISOString();await db.query('INSERT INTO `'+Y+'`.organisation_profiles (organisation_id,created_at,updated_at,onboarding_completed_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE onboarding_completed_at=VALUES(onboarding_completed_at)',[adm.organisation_id,t2,t2,t2]);
  await stop(h);
  const allowJson=JSON.stringify({environment:'staging-demo',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:Y,user:process.env.MYSQL_USER,appUrl:o2,adminEmail:ADMIN});
  const loadEnv=over=>({...baseEnv,STAGING_DEMO_ALLOWLIST_JSON:allowJson,STAGING_DEMO_CONFIRM_SHA256:createHash('sha256').update(allowJson).digest('hex'),...over});
  const stateDir=join(dir,'state');
  const countY=t=>count(t,Y);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'plan'}));
  const planned=await waitFor(()=>/plan finished with exit code/.test(h.log));const ph=/planHash: ([0-9a-f]{64})/.exec(h.log)?.[1];
  check('managed load (plan): the plan and its hash are printed to the runtime log, nothing is written, and the app serves meanwhile',planned&&Boolean(ph)&&/exit code 0/.test(h.log)&&await up()&&(await countY('project_work_areas'))===0&&(await countY('shifts'))===0,h.log.slice(-200));
  await stop(h);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'apply',STAGING_DEMO_PLAN_HASH:'a'.repeat(64),DEMO_SEED_PASSWORD:password,STAGING_DEMO_STATE_DIR:stateDir}));
  await waitFor(()=>/apply finished with exit code/.test(h.log));
  check('managed load (apply): a plan hash that was not reviewed is refused and nothing changes',!/exit code 0/.test(h.log)&&(await countY('project_work_areas'))===0&&(await countY('shifts'))===0,h.log.slice(-200));
  await stop(h);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'apply',STAGING_DEMO_PLAN_HASH:ph,STAGING_DEMO_STATE_DIR:stateDir}));
  await waitFor(()=>/apply needs DEMO_SEED_PASSWORD/.test(h.log),30000);
  check('managed load (apply): refused without the administrator password (set only for the run), nothing changes',/DEMO_SEED_PASSWORD/.test(h.log)&&(await countY('shifts'))===0);
  await stop(h);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'apply',STAGING_DEMO_PLAN_HASH:ph,DEMO_SEED_PASSWORD:password,STAGING_DEMO_STATE_DIR:stateDir}));
  const applied=await waitFor(()=>/apply finished with exit code/.test(h.log),600000);
  const nY={areas:await countY('project_work_areas'),links:await countY('shift_work_areas'),shifts:await countY('shifts'),users:await countY('users'),logins:await countY('auth_user')};
  check('managed load (apply): with the reviewed hash and the one-run password the full demo company is loaded from inside the app process (NODE_ENV=production accepted only on the allow-list path)',applied&&/exit code 0/.test(h.log)&&nY.areas===20&&nY.links===27&&nY.shifts===17&&nY.users===6&&nY.logins===1,JSON.stringify(nY)+h.log.slice(-200));
  await stop(h);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'verify'}));
  await waitFor(()=>/verify finished with exit code/.test(h.log));
  check('managed load (verify): the read-only verifier passes after the load',/verified/.test(h.log)&&/verify finished with exit code 0/.test(h.log),h.log.slice(-160));
  await stop(h);
  h=startCmd(loadEnv({STAGING_DEMO_LOAD:'apply',STAGING_DEMO_PLAN_HASH:ph,DEMO_SEED_PASSWORD:password,STAGING_DEMO_STATE_DIR:stateDir}));
  await waitFor(()=>/apply finished with exit code/.test(h.log),240000);
  check('managed load: a restart with the apply setting still on does nothing harmful (stale hash refused, no duplicates)',!/exit code 0/.test(h.log)&&(await countY('project_work_areas'))===20&&(await countY('shifts'))===17);
  await stop(h);
  {const noMode=run('scripts/import-demo-tenant.mjs',{...process.env,NODE_ENV:'production',...mysqlEnv(Y),DEMO_SEED_EMAIL:ADMIN,DEMO_SEED_PASSWORD:password},['--organisation-id',adm.organisation_id,'--apply','--plan-hash','x','--baseline',join(dir,'nb.json')],30000);
   check('the default importer path still refuses NODE_ENV=production (only the allow-list path accepts it)',noMode.status===2&&/NODE_ENV=production is refused/.test(out(noMode)));}
 }
}catch(e){fail++;console.log('FAIL    aborted — '+(e?.stack||e));}
finally{for(const s of servers)s.kill();for(const f of fixtures)await db.query('DROP DATABASE IF EXISTS `'+f+'`').catch(()=>{});await db.query('DROP DATABASE IF EXISTS `'+dbName+'_x`').catch(()=>{});await db.end();rmSync(dir,{recursive:true,force:true});}
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
