// Disposable local fixtures only. Proves the ONE-OFF tenant reset (scripts/demo/one-off-reset-tenant.mjs, via the loader's reset-plan/reset modes):
// it replaces one tenant's operational data and nothing else, is atomic, and is followed by the normal additive import of the full demo.
//   npm run build   then   MYSQL_DATABASE=roadworx_ctl_test node scripts/test-one-off-tenant-reset.mjs
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {connect} from './mysql-config.mjs';
import {SESSION_TABLES} from './demo/import-guards.mjs';
import {databaseFingerprint} from './demo/existing-tenant.mjs';
import {DELETE_TABLES,PRESERVE_ORG_TABLES,confirmText} from './demo/one-off-reset-tenant.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
if(!['127.0.0.1','localhost','::1'].includes(process.env.MYSQL_HOST)||process.env.NODE_ENV==='production')throw new Error('Fixture tests require a disposable loopback MySQL service and a non-production test driver');
let pass=0,fail=0;const check=(s,ok,d='')=>{if(ok)pass++;else fail++;console.log(`${ok?'PASS':'FAIL'}    ${s}${d?' — '+String(d).replace(/\s+/g,' ').slice(0,260):''}`);return ok;};
const sha=x=>createHash('sha256').update(x).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'one-off-reset-test-'));
const P0=Number(process.env.PORT||3410);
const password='Owner-Password-Strong-42!';
const db=await connect();const procs=[],fixtures=[],conns=[];
const mysqlEnv=database=>({PATH:process.env.PATH,HOME:process.env.HOME,MYSQL_HOST:process.env.MYSQL_HOST,MYSQL_PORT:process.env.MYSQL_PORT,MYSQL_DATABASE:database,MYSQL_USER:process.env.MYSQL_USER,MYSQL_PASSWORD:process.env.MYSQL_PASSWORD});
const makeDb=async name=>{await db.query('DROP DATABASE IF EXISTS `'+name+'`');await db.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');fixtures.push(name);};
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const out=r=>(r.stdout||'')+(r.stderr||'');
const run=(file,env,args=[],timeout=900000)=>spawnSync(process.execPath,[resolve(file),...args],{cwd:process.cwd(),env,encoding:'utf8',timeout});
const startApp=async(port,env)=>{const c=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{cwd:process.cwd(),env:{...env,PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'ignore'});procs.push(c);for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).ok)return c;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}throw new Error('app did not start');};
const call=(cookie,origin)=>async(path,method='GET',body)=>{const r=await fetch(origin+path,{method,headers:{origin,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:r.status,body:j};};
const signup=async(origin,name,email)=>{let r;for(let a=0;a<8;a++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,5000));}if(!r.ok)throw new Error('sign-up '+r.status);return r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');};
const connectTo=async name=>{const prev=process.env.MYSQL_DATABASE;process.env.MYSQL_DATABASE=name;try{const c=await connect();conns.push(c);return c;}finally{process.env.MYSQL_DATABASE=prev;}};
const soon=ms=>new Date(Date.now()+ms).toISOString();
const digest=async(name,sql,p=[])=>sha(JSON.stringify((await db.query(sql.replaceAll('{db}','`'+name+'`'),p))[0]));
const orgCount=async(name,t,org)=>Number((await q('SELECT COUNT(*) n FROM `'+name+'`.`'+t+'` WHERE organisation_id=?',[org]))[0].n);

async function fixture(name){
 await makeDb(name);const env=mysqlEnv(name);
 const m=run('scripts/migrate.mjs',env);if(m.status!==0)throw new Error(out(m));
 const appEnv={...env,NODE_ENV:'production',BETTER_AUTH_SECRET:'one-off-reset-secret-with-at-least-32-chars!',BETTER_AUTH_URL:`http://127.0.0.1:${P0}`,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake'};
 const app=await startApp(P0,appEnv),origin=`http://127.0.0.1:${P0}`;
 const emailA='owner-reset@roadworx-test.example.invalid',emailB='other-reset@other-co.example.invalid';
 const ca=await signup(origin,'Roadworx Owner',emailA),cb=await signup(origin,'Other Admin',emailB);
 const [[ua]]=await db.query('SELECT id,organisation_id FROM `'+name+'`.users WHERE email=?',[emailA]);const [[ub]]=await db.query('SELECT id,organisation_id FROM `'+name+'`.users WHERE email=?',[emailB]);
 await db.query('UPDATE `'+name+'`.users SET role=? WHERE id IN (?,?)',['admin',ua.id,ub.id]);
 const t=new Date().toISOString();for(const o of [ua.organisation_id,ub.organisation_id])await db.query('INSERT INTO `'+name+'`.organisation_profiles (organisation_id,legal_name,created_at,updated_at,onboarding_completed_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE onboarding_completed_at=VALUES(onboarding_completed_at),legal_name=VALUES(legal_name)',[o,o===ua.organisation_id?'Roadworx Test Pty Ltd':'Other Tenant Pty Ltd',t,t,t]);
 const a=call(ca,origin),b=call(cb,origin);
 const cl=await a('/api/platform/clients','POST',{action:'create',client:{name:'Old Dummy Client',clientCode:'OLD-1',contactName:'Old Contact',email:'c@old.example.invalid'}});
 const pa=await a('/api/projects','POST',{name:'Old Dummy Project'});const pb=await b('/api/projects','POST',{name:'Other Tenant Project'});
 const ring=[[0,0],[40,0],[40,40],[0,40]].map(([x,y])=>({lat:-33.9+y/111194.9,lng:151.2+x/92400}));
 const wa=await b('/api/projects/work-areas','POST',{projectId:pb.body.projectId,name:'Other tenant area',kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:null,sequence:null,notes:null,ring});
 app.kill();procs.splice(procs.indexOf(app),1);await new Promise(r=>setTimeout(r,1500));
 if(![200,201].includes(cl.status)||![200,201].includes(pa.status)||![200,201].includes(pb.status)||wa.status!==201)throw new Error('fixture setup failed '+[cl.status,pa.status,pb.status,wa.status]);
 return {name,env,org:ua.organisation_id,orgB:ub.organisation_id,emailA,ownerUser:ua.id,otherUser:ub.id};
}
const mkAllow=(f,over={})=>{const body={environment:'existing-tenant-additive',host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),database:f.name,user:process.env.MYSQL_USER,appUrl:'https://roadworx.example.invalid',organisationId:f.org,adminEmail:f.emailA,...over};const txt=JSON.stringify(body);const file=join(dir,'allow-'+Math.random().toString(36).slice(2)+'.json');writeFileSync(file,txt);chmodSync(file,0o600);return {file,txt};};
const evidence=async(f,over={})=>JSON.stringify({takenAt:new Date().toISOString(),database:f.name,organisationId:f.org,restoreVerified:true,restoredInto:'scratch fixture (test)',operator:'test operator',fingerprint:await databaseFingerprint(await connectTo(f.name)),...over});
const loaderEnv=(f,a,state,over={})=>({...f.env,NODE_ENV:'production',BETTER_AUTH_SECRET:'one-off-reset-secret-with-at-least-32-chars!',BETTER_AUTH_URL:'https://roadworx.example.invalid',LOCATION_PROVIDER:'fake',MAINTENANCE_UNTIL:soon(2*3600e3),
 EXISTING_TENANT_ALLOWLIST_JSON:a.txt,EXISTING_TENANT_CONFIRM_SHA256:sha(a.txt),EXISTING_TENANT_STATE_DIR:join(dir,state),DEMO_SEED_PASSWORD:password,...over});
const load=(f,a,state,mode,over={})=>spawnSync(process.execPath,['scripts/existing-tenant-load.mjs'],{cwd:process.cwd(),env:loaderEnv(f,a,state,{EXISTING_TENANT_LOAD:mode,...over}),encoding:'utf8',timeout:1800000});
const planHash=o=>o.match(/planHash[=:] ?"?([0-9a-f]{64})/)?.[1];
const world=async(name,org)=>{const per={};for(const t of [...DELETE_TABLES,...PRESERVE_ORG_TABLES])per[t]=await orgCount(name,t,org);return per;};
const rowsDigest=async(name,t,where,p)=>digest(name,`SELECT * FROM {db}.\`${t}\` WHERE ${where} ORDER BY 1`,p);
const tenantDigest=async(name,org)=>{let h='';for(const t of [...DELETE_TABLES,...PRESERVE_ORG_TABLES])h+=await rowsDigest(name,t,'organisation_id=?',[org]);return sha(h);};
const identityDigest=async f=>sha([await digest(f.name,'SELECT * FROM {db}.auth_user ORDER BY id'),await digest(f.name,'SELECT * FROM {db}.auth_account ORDER BY id'),await digest(f.name,'SELECT * FROM {db}.organisations ORDER BY id'),
 await digest(f.name,'SELECT * FROM {db}.users WHERE LOWER(email) IN (SELECT LOWER(email) FROM {db}.auth_user) ORDER BY id'),await digest(f.name,'SELECT * FROM {db}.organisation_profiles ORDER BY organisation_id'),await digest(f.name,'SELECT * FROM {db}.organisation_entitlements ORDER BY organisation_id'),
 await digest(f.name,'SELECT * FROM {db}.audit_log ORDER BY id')].join(''));

try{
 const f=await fixture('roadworx_reset_main_test');
 const A=mkAllow(f);
 // ---- the "existing dummy workspace": the owner's own old records AND the full demo, loaded through the real additive path
 let r=load(f,A,'state-src','fingerprint');const fp0=r.stdout.match(/fingerprint: ([0-9a-f]{64})/)?.[1];
 check('fixture: the loader fingerprints the populated source copy',r.status===0&&!!fp0,out(r).slice(-200));
 r=load(f,A,'state-src','plan');const h0=planHash(out(r));check('fixture: the demo import plan is clean',r.status===0&&!!h0,out(r).slice(-300));
 r=load(f,A,'state-src','apply',{EXISTING_TENANT_PLAN_HASH:h0,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f,{fingerprint:fp0})});
 check('fixture: the full demo is loaded into the owner tenant as the pre-existing dummy workspace',r.status===0&&/Existing rows changed: 0; removed: 0/.test(out(r)),out(r).slice(-300));
 const before=await world(f.name,f.org),otherBefore=await tenantDigest(f.name,f.orgB),idBefore=await identityDigest(f);
 const loginlessBefore=Number((await q('SELECT COUNT(*) n FROM `'+f.name+'`.users u WHERE organisation_id=? AND NOT EXISTS (SELECT 1 FROM `'+f.name+'`.auth_user a WHERE LOWER(a.email)=LOWER(u.email))',[f.org]))[0].n);
 const totalBefore=DELETE_TABLES.reduce((n,t)=>n+before[t],0)+loginlessBefore;check('fixture: the demo left login-less team members in users (to be replaced by the reset)',loginlessBefore>=5,loginlessBefore);
 check('fixture: the owner tenant holds many operational rows across many tables (own old records + demo)',totalBefore>500&&DELETE_TABLES.filter(t=>before[t]).length>40,`${totalBefore} rows in ${DELETE_TABLES.filter(t=>before[t]).length} tables`);
 const [[ownClient]]=await db.query('SELECT COUNT(*) n FROM `'+f.name+'`.clients WHERE organisation_id=? AND client_code=?',[f.org,'OLD-1']);check('fixture: the owner\'s own old client is present before the reset',Number(ownClient.n)===1);

 // ---- classification is fail-closed and complete
 const [cols]=await db.query("SELECT DISTINCT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLUMN_NAME='organisation_id'",[f.name]);
 check('every table with organisation_id is classified exactly once as delete or preserve (no gaps, no overlap)',cols.length===DELETE_TABLES.length+PRESERVE_ORG_TABLES.length&&new Set([...DELETE_TABLES,...PRESERVE_ORG_TABLES]).size===cols.length&&cols.every(c=>DELETE_TABLES.includes(c.t)||PRESERVE_ORG_TABLES.includes(c.t)),`${cols.length} tables`);

 // ---- reset-plan is read-only and reports exactly what is deleted and preserved
 const fpBefore=await databaseFingerprint(await connectTo(f.name));
 r=load(f,A,'state-new','reset-plan');const hr=planHash(out(r));const planText=out(r);
 check('reset-plan prints the plan and its hash and changes nothing',r.status===0&&!!hr&&await databaseFingerprint(await connectTo(f.name))===fpBefore,out(r).slice(-200));
 const plan=JSON.parse(planText.slice(planText.indexOf('{'),planText.lastIndexOf('}')+1));
 check('the plan\'s per-table deletion counts equal the real counts in the database',DELETE_TABLES.every(t=>(plan.deletedRowCounts[t]||0)===before[t])&&plan.deletedLoginlessMembers.length===loginlessBefore&&plan.deletedRowTotal===totalBefore);
 check('the plan names the preserved login, membership and organisation',plan.adminLogin.email===f.emailA&&plan.preservedMemberships.some(u=>u.id===f.ownerUser&&u.role==='admin')&&plan.organisation.id===f.org,JSON.stringify(plan.adminLogin));
 console.log('\n--- PLAN (isolated copy) ---\n'+JSON.stringify({organisation:plan.organisation,adminLogin:plan.adminLogin,preservedMemberships:plan.preservedMemberships,preservedRowCounts:plan.preservedRowCounts,deletedLoginlessMembers:plan.deletedLoginlessMembers,deletedTableCount:plan.deletedTableCount,deletedRowTotal:plan.deletedRowTotal,deletedRowCounts:plan.deletedRowCounts},null,1)+'\n--- END PLAN ---\n');
 if(process.env.RESET_PLAN_OUT)writeFileSync(process.env.RESET_PLAN_OUT,JSON.stringify(plan,null,1));

 // ---- refusals: nothing is connected-and-changed unless every guard holds
 const ev=await evidence(f);const base={EXISTING_TENANT_PLAN_HASH:hr,EXISTING_TENANT_RESET_CONFIRM:confirmText(f.org,hr),EXISTING_TENANT_BACKUP_EVIDENCE_JSON:ev};
 const same=async()=>await databaseFingerprint(await connectTo(f.name))===fpBefore;
 for(const [label,over,re] of [
  ['without the maintenance freeze',{MAINTENANCE_UNTIL:''},/write freeze is not in force/],
  ['with a wrong plan hash',{EXISTING_TENANT_PLAN_HASH:'0'.repeat(64),EXISTING_TENANT_RESET_CONFIRM:confirmText(f.org,'0'.repeat(64))},/plan hash does not match/],
  ['with a wrong confirmation text',{EXISTING_TENANT_RESET_CONFIRM:'yes'},/--confirm must be exactly/],
  ['without backup evidence',{EXISTING_TENANT_BACKUP_EVIDENCE_JSON:''},/needs EXISTING_TENANT_PLAN_HASH/],
  ['with backup evidence of another state (fingerprint differs)',{EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f,{fingerprint:'a'.repeat(64)})},/database has changed since the backup/],
  ['with backup evidence that is not restore-attested',{EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f,{restoreVerified:false})},/restoreVerified/],
  ['with backup evidence for another organisation',{EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f,{organisationId:f.orgB})},/different organisation/],
 ]){r=load(f,A,'state-new','reset',{...base,...over});check(`reset refuses ${label}; nothing changed`,r.status!==0&&re.test(out(r))&&await same(),out(r).slice(-160));}
 const Awrong=mkAllow(f,{organisationId:f.orgB});r=load(f,Awrong,'state-new','reset',base);check('reset refuses an allow-list that names the other tenant (the admin is not a member there); nothing changed',r.status!==0&&await same(),out(r).slice(-160));
 const Aother=mkAllow(f,{adminEmail:'other-reset@other-co.example.invalid'});r=load(f,Aother,'state-new','reset',base);check('reset refuses when the allow-listed administrator is not this tenant\'s admin',r.status!==0&&await same(),out(r).slice(-160));
 r=load(f,A,'state-src','reset',base);check('reset refuses while an earlier import baseline exists in the state directory (reset must come first)',r.status!==0&&/baseline already exists/.test(out(r))&&await same(),out(r).slice(-160));
 await q('CREATE TABLE `'+f.name+'`.surprise_table (id varchar(20) primary key, organisation_id varchar(191))');
 r=load(f,A,'state-new','reset-plan');check('an unclassified new table with organisation_id makes the reset refuse (fail-closed)',r.status!==0&&/not classified/.test(out(r)),out(r).slice(-200));await q('DROP TABLE `'+f.name+'`.surprise_table');

 // ---- atomic: a failure part-way through the deletes rolls everything back
 await q("CREATE TRIGGER `"+f.name+"`.boom BEFORE DELETE ON `"+f.name+"`.crews FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced failure mid-delete'");
 r=load(f,A,'state-new','reset',base);
 check('a failure part-way through (forced on a late table) rolls the whole reset back: every row is still there',r.status!==0&&/forced failure|failed/.test(out(r))&&JSON.stringify(await world(f.name,f.org))===JSON.stringify(before)&&await same(),out(r).slice(-200));
 await q('DROP TRIGGER `'+f.name+'`.boom');

 // ---- the real reset
 const ledgerBefore=readdirSync(join(dir,'state-new')).filter(n=>n.startsWith('reset-ledger'));
 r=load(f,A,'state-new','reset',{...base,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f)});
 check('the reset commits and reports the exact number of rows deleted',r.status===0&&new RegExp(`Reset committed: ${totalBefore} row\\(s\\) deleted across ${plan.deletedTableCount} table`).test(out(r)),out(r).slice(-300));
 const after=await world(f.name,f.org);
 check('every delete table is empty for the tenant',DELETE_TABLES.every(t=>after[t]===0));
 check('every preserved table is unchanged for the tenant (row counts)',PRESERVE_ORG_TABLES.every(t=>t==='users'?after[t]===before[t]-loginlessBefore:after[t]===before[t])&&after.users===1);
 check('login, memberships (all users rows), organisation, profile, entitlements and audit trail are byte-identical',await identityDigest(f)===idBefore);
 check('the other tenant is byte-identical',await tenantDigest(f.name,f.orgB)===otherBefore);
 const [[ow]]=await db.query('SELECT COUNT(*) n FROM `'+f.name+'`.project_work_areas WHERE organisation_id=?',[f.orgB]);
 check('the other tenant still has its client-less project and work area',Number(ow.n)===1&&(await q('SELECT COUNT(*) n FROM `'+f.name+'`.jobs WHERE organisation_id=?',[f.orgB]))[0].n==1);
 const ledgers=readdirSync(join(dir,'state-new')).filter(n=>n.startsWith('reset-ledger')).filter(n=>!ledgerBefore.includes(n));
 const led=JSON.parse(readFileSync(join(dir,'state-new',ledgers[ledgers.length-1]),'utf8'));
 check('the ledger (mode 600) lists every deleted key',(statSync(join(dir,'state-new',ledgers[ledgers.length-1])).mode&0o077)===0&&Object.values(led.tables).reduce((n,x)=>n+(x.rows?x.rows.length:x.count),0)===totalBefore&&led.planHash===hr,`${Object.keys(led.tables).length} tables`);
 const idPlan=load(f,A,'state-new','reset-plan');check('a second reset-plan now shows nothing left to delete',idPlan.status===0&&/"deletedRowTotal": 0/.test(out(idPlan)));

 // ---- then the normal additive import of the full demo, with a fresh backup of the reset state
 r=load(f,A,'state-new','fingerprint');const fp1=r.stdout.match(/fingerprint: ([0-9a-f]{64})/)?.[1];
 r=load(f,A,'state-new','plan');const h1=planHash(out(r));check('the demo plan after the reset is clean (no conflicts: the old demo records are gone)',r.status===0&&!!h1&&!/CONFLICT|BLOCKER/.test(out(r).replace(/conflicts?: 0|blockers?: 0/gi,'')),out(r).slice(-300));
 r=load(f,A,'state-new','plan');if(process.env.SHOW_PLAN)console.log(out(r).slice(-2500));
 r=load(f,A,'state-new','apply',{EXISTING_TENANT_PLAN_HASH:h1,EXISTING_TENANT_BACKUP_EVIDENCE_JSON:await evidence(f,{fingerprint:fp1})});
 if(r.status!==0)console.log(out(r).slice(-2500));
 check('the full demo is imported again into the reset tenant (existing rows changed: 0, removed: 0)',r.status===0&&/Existing rows changed: 0; removed: 0/.test(out(r)),out(r).slice(-300));
 r=load(f,A,'state-new','verify');check('verify passes: the demonstration records are present and consistent',r.status===0,out(r).slice(-200));
 const reseeded=await world(f.name,f.org);
 check('the tenant holds the demo again and not the owner\'s old dummy client',DELETE_TABLES.filter(t=>reseeded[t]).length>40&&(await q('SELECT COUNT(*) n FROM `'+f.name+'`.clients WHERE organisation_id=? AND client_code=?',[f.org,'OLD-1']))[0].n==0&&(await q('SELECT COUNT(*) n FROM `'+f.name+'`.clients WHERE organisation_id=? AND client_code LIKE ?',[f.org,'DEMO-%']))[0].n==4,JSON.stringify(Object.fromEntries(DELETE_TABLES.filter(t=>reseeded[t]!==before[t]).slice(0,6).map(t=>[t,[before[t],reseeded[t]]]))));
 check('the other tenant is still byte-identical after the whole sequence',await tenantDigest(f.name,f.orgB)===otherBefore);
 // the preserved login still signs in
 const app=await startApp(P0,{...mysqlEnv(f.name),NODE_ENV:'production',BETTER_AUTH_SECRET:'one-off-reset-secret-with-at-least-32-chars!',BETTER_AUTH_URL:`http://127.0.0.1:${P0}`,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake'});
 const sin=await fetch(`http://127.0.0.1:${P0}/api/auth/sign-in/email`,{method:'POST',headers:{origin:`http://127.0.0.1:${P0}`,'Content-Type':'application/json'},body:JSON.stringify({email:f.emailA,password})});
 const ck=sin.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
 const jobs=await call(ck,`http://127.0.0.1:${P0}`)('/api/projects');
 check('the preserved login signs in with the same password and sees the demo projects (admin access intact)',sin.ok&&jobs.status===200&&JSON.stringify(jobs.body).includes('DEMO'),`${sin.status} ${jobs.status}`);
 app.kill();procs.splice(procs.indexOf(app),1);
}catch(e){fail++;console.log('FAIL    aborted — '+(e?.stack||e));}
finally{for(const p of procs)try{p.kill('SIGKILL');}catch{/* gone */}for(const c of conns)await c.end().catch(()=>{});if(!process.env.KEEP_FIXTURES)for(const n of fixtures)await db.query('DROP DATABASE IF EXISTS `'+n+'`').catch(()=>{});await db.end().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
console.log(`\n${fail?'FAILED':'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
