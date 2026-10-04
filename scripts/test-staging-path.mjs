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
const st=load('lib/platform/staging.ts');
const good={STAGING_DEMO_MODE:'true',STAGING_DEMO_DATABASE:'stg_demo',STAGING_DEMO_URL:'https://demo.example.invalid',STAGING_DEMO_ADMIN_EMAIL:'owner@example.invalid',MYSQL_DATABASE:'stg_demo',BETTER_AUTH_URL:'https://demo.example.invalid',EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake'};
check('staging mode is off by default and then changes nothing',!st.stagingActive({})&&st.stagingProblems({}).length>0&&st.stagingSignupDecision('anyone@x.invalid',5,{}).allowed&&(()=>{st.assertStagingSafe({});return true;})());
check('a correct allow-listed configuration has no problems (a database name without _test is fine)',st.stagingProblems(good).length===0,JSON.stringify(st.stagingProblems(good)));
for(const [label,over,re] of [
 ['database differs from the allow-listed one',{MYSQL_DATABASE:'other_db'},/STAGING_DEMO_DATABASE/],
 ['public URL differs from the allow-listed one',{BETTER_AUTH_URL:'https://elsewhere.example.invalid'},/STAGING_DEMO_URL/],
 ['the production database',{MYSQL_DATABASE:'u840559204_infrastruct',STAGING_DEMO_DATABASE:'u840559204_infrastruct'},/production/],
 ['an operator-listed production database',{STAGING_REFUSE_DATABASES:'stg_demo'},/production/],
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

// ------------------------------------------------------------------ pure: importer allow-list
const dir=mkdtempSync(join(tmpdir(),'staging-path-'));
const mkList=(over={},mode=0o600)=>{const f=join(dir,'allow-'+Math.random().toString(36).slice(2)+'.json');const body={environment:'staging-demo',host:'db.example.invalid',port:3306,database:'stg_demo',user:'stg_user',appUrl:'https://demo.example.invalid',adminEmail:'owner@example.invalid',...over};writeFileSync(f,JSON.stringify(body));chmodSync(f,mode);return f;};
const shaOf=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const envFor=(f,over={})=>({MYSQL_HOST:'db.example.invalid',MYSQL_PORT:'3306',MYSQL_DATABASE:'stg_demo',MYSQL_USER:'stg_user',DEMO_SEED_EMAIL:'owner@example.invalid',STAGING_DEMO_CONFIRM_SHA256:shaOf(f),...over});
{const f=mkList();check('allow-list: an exact, hash-confirmed match passes (non-_test database, remote host)',evaluateAllowlist(f,envFor(f)).problems.length===0,evaluateAllowlist(f,envFor(f)).problems.join('|'));
 const cases=[
  ['no confirmation hash',f,envFor(f,{STAGING_DEMO_CONFIRM_SHA256:undefined}),/SHA-256/],['wrong confirmation hash',f,envFor(f,{STAGING_DEMO_CONFIRM_SHA256:'0'.repeat(64)}),/SHA-256/],
  ['different host',f,envFor(f,{MYSQL_HOST:'db2.example.invalid'}),/host/],['different port',f,envFor(f,{MYSQL_PORT:'3307'}),/port/],['different database',f,envFor(f,{MYSQL_DATABASE:'u840559204_infrastruct'}),/MYSQL_DATABASE|production/],['different user',f,envFor(f,{MYSQL_USER:'someone'}),/user/],
  ['a different administrator',f,envFor(f,{DEMO_SEED_EMAIL:'other@example.invalid'}),/administrator/]];
 for(const [label,file,env,re] of cases){const r=evaluateAllowlist(file,env);check(`allow-list refuses: ${label}`,r.problems.length>0&&re.test(r.problems.join('|')),r.problems.join('|'));}
 for(const [label,over,re] of [['the production database',{database:'u840559204_infrastruct'},/production/],['an operator-listed production database',{database:'stg_demo',refuseDatabases:['stg_demo']},/production/],['a wildcard',{database:'stg_%'},/wildcard/],['a plain-http public URL',{appUrl:'http://demo.example.invalid'},/https/],['the wrong environment',{environment:'production'},/environment/],['an unknown key',{allowEverything:true},/unknown/],['a non-integer port',{port:'3306'},/port/]]){
  const g=mkList(over);const r=evaluateAllowlist(g,envFor(g,{MYSQL_DATABASE:over.database||'stg_demo'}));check(`allow-list refuses: file names ${label}`,r.problems.length>0&&re.test(r.problems.join('|')),r.problems.join('|'));}
 const loose=mkList({},0o666);check('allow-list refuses a file other users can write',/writable/.test(evaluateAllowlist(loose,envFor(loose)).problems.join('|')));
 check('allow-list refuses a missing file',/cannot be read/.test(evaluateAllowlist(join(dir,'nope.json'),{}).problems.join('|')));
 const bad=join(dir,'bad.json');writeFileSync(bad,'{nope');chmodSync(bad,0o600);check('allow-list refuses invalid JSON',/valid JSON/.test(evaluateAllowlist(bad,envFor(bad)).problems.join('|')));}

// ------------------------------------------------------------------ integration: local stand-in database, real app in staging mode, real importer
const PORT=Number(process.env.PORT||3197),base=`http://127.0.0.1:${PORT}`,BAD_PORT=PORT+1;
const dbName=process.env.MYSQL_DATABASE,ADMIN='stage-owner@example.invalid',password='Staging-Admin-Password-Strong-42!';
const db=await connect();
const [[u]]=await db.query('SELECT COUNT(*) n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(u.n))throw new Error('Refusing: the disposable database already has users.');
const mysqlEnv={PATH:process.env.PATH,HOME:process.env.HOME,MYSQL_HOST:process.env.MYSQL_HOST,MYSQL_PORT:process.env.MYSQL_PORT,MYSQL_DATABASE:dbName,MYSQL_USER:process.env.MYSQL_USER,MYSQL_PASSWORD:process.env.MYSQL_PASSWORD};
const stagingEnv=(port,over={})=>({...mysqlEnv,NODE_ENV:'production',BETTER_AUTH_SECRET:'staging-secret-with-at-least-32-characters!!',BETTER_AUTH_URL:`http://127.0.0.1:${port}`,STAGING_DEMO_MODE:'true',STAGING_DEMO_DATABASE:dbName,STAGING_DEMO_URL:`http://127.0.0.1:${port}`,STAGING_DEMO_ADMIN_EMAIL:ADMIN,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',...over});
const mig=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:mysqlEnv,encoding:'utf8'});if(mig.status!==0)throw new Error(mig.stderr);
const servers=[];const start=async(port,env)=>{const s=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env,stdio:'ignore'});servers.push(s);for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).ok)return;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}throw new Error('server did not start');};
const signup=async(origin,email)=>{let r;for(let a=0;a<8;a++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Demo Owner',email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}return r;};
const count=async t=>Number((await db.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n);
try{
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

 // importer with the allow-list. The database here is a local stand-in; the allow-list names it exactly.
 const allow=join(dir,'real-allow.json');writeFileSync(allow,JSON.stringify({environment:'staging-demo',host:mysqlEnv.MYSQL_HOST,port:Number(mysqlEnv.MYSQL_PORT||3306),database:dbName,user:mysqlEnv.MYSQL_USER,appUrl:'https://demo.example.invalid',adminEmail:ADMIN}));chmodSync(allow,0o600);
 const baseline=join(dir,'baseline.json'),sha=shaOf(allow);
 const env={...process.env,DEMO_SEED_EMAIL:ADMIN,DEMO_SEED_PASSWORD:password,STAGING_DEMO_CONFIRM_SHA256:sha,EMAIL_ENABLED:'false',R2_ENDPOINT:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET_NAME:''};
 const imp=(args,over={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs',...args],{env:{...env,...over},encoding:'utf8',timeout:1500000});
 const text=x=>(x.stdout||'')+(x.stderr||'');
 const dry=imp(['--organisation-id',admin.organisation_id,'--staging-allowlist',allow]);const plan=/planHash: ([0-9a-f]{64})/.exec(text(dry))?.[1];
 check('importer: dry run against the allow-listed database works',dry.status===0&&Boolean(plan),text(dry).slice(-160));
 const before=await count('project_work_areas');
 const applyArgs=['--organisation-id',admin.organisation_id,'--apply','--plan-hash',plan,'--baseline',baseline,'--staging-allowlist',allow];
 for(const [label,over,re] of [
  ['no confirmation hash',{STAGING_DEMO_CONFIRM_SHA256:''},/SHA-256/],['a wrong confirmation hash',{STAGING_DEMO_CONFIRM_SHA256:'f'.repeat(64)},/SHA-256/],
  ['an integration configured (SMTP)',{SMTP_HOST:'smtp.example.invalid'},/SMTP_HOST/],['email enabled',{EMAIL_ENABLED:'true'},/EMAIL_ENABLED/],
  ['a different administrator email',{DEMO_SEED_EMAIL:'x@example.invalid'},/administrator/]]){
  const x=imp(applyArgs,over);check(`importer apply refused: ${label} (nothing changed)`,x.status===2&&re.test(text(x))&&(await count('project_work_areas'))===before,text(x).slice(-140));}
 await db.query("INSERT INTO organisations (id,name,created_at) VALUES ('other-org','Another tenant',?)",[t]);
 {const x=imp(applyArgs);check('importer apply refused when the staging database holds a second organisation',x.status===3&&/exactly one organisation/.test(text(x))&&(await count('project_work_areas'))===before,text(x).slice(-200));}
 await db.query("DELETE FROM organisations WHERE id='other-org'");
 const ap=imp(applyArgs);
 check('importer apply with a correct allow-list succeeds on the stand-in staging database',ap.status===0,text(ap).slice(-300));
 const n={areas:await count('project_work_areas'),points:await count('project_work_points'),links:await count('shift_work_areas'),shifts:await count('shifts'),orgs:await count('organisations'),users:await count('users')};
 check('the full demo company is loaded: 20 work areas, 3 work points, 27 shift links, 17 shifts, one organisation, one login-capable user, 5 demo team members',n.areas===20&&n.points===3&&n.links===27&&n.shifts===17&&n.orgs===1&&n.users===6,JSON.stringify(n));
 const ap2=imp(['--organisation-id',admin.organisation_id,'--out',join(dir,'p2.json'),'--baseline',baseline,'--baseline-sha256',createHash('sha256').update(readFileSync(baseline)).digest('hex'),'--staging-allowlist',allow]);
 check('repeat: nothing is left to create',ap2.status===0&&/create 0/.test(text(ap2)));
}catch(e){fail++;console.log('FAIL    aborted — '+(e?.stack||e));}
finally{for(const s of servers)s.kill();await db.end();rmSync(dir,{recursive:true,force:true});}
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
