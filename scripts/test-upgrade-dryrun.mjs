// Production upgrade dry run: baseline schema + legacy data → this branch.
//   BASELINE_DIR=<checkout of the deployed commit> MYSQL_DATABASE=<name>_test node scripts/test-upgrade-dryrun.mjs
// 1. builds the deployed schema with the BASELINE's own migration runner in a disposable database;
// 2. seeds legacy data the way the legacy routes wrote it (JSON metadata, imperfect values);
// 3. fingerprints every legacy row;
// 4. runs THIS branch's migration runner (0003, 0004 and the resource backfill);
// 5. verifies no legacy row was changed or removed, typed data and issues were written,
//    counts reconcile, and a second run is a no-op.
// 6. when a production build exists (.next/BUILD_ID), boots it on the upgraded database and checks
//    that the pre-V1 user signs in with their existing password and the pre-V1 job opens as a project.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,symlinkSync} from 'node:fs';
import {hashPassword} from 'better-auth/crypto';
import {createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {mysqlOptions,identifier} from './mysql-config.mjs';
const BASE=process.env.BASELINE_DIR;
if(!BASE||!existsSync(`${BASE}/scripts/migrate.mjs`))throw new Error('Set BASELINE_DIR to a checkout of the currently deployed commit');
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
if(!existsSync(`${BASE}/node_modules`))symlinkSync(`${process.cwd()}/node_modules`,`${BASE}/node_modules`);
const name=process.env.MYSQL_DATABASE.replace(/_test$/,'')+'_upgrade_test';
const run=(cwd,file,env={})=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[file],{cwd,env:{...process.env,MYSQL_DATABASE:name,...env},stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);c.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const admin=await mysql.createConnection({...mysqlOptions(),database:undefined});
await admin.query('DROP DATABASE IF EXISTS '+identifier(name));
await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
const db=await mysql.createConnection({...mysqlOptions(),database:name});
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const report={};
try{
 // 1. deployed schema, built by the deployed runner
 const baseLog=await run(BASE,'scripts/migrate.mjs');
 report.baseline=(await q('SELECT name FROM app_migrations ORDER BY name')).map(r=>r.name);
 assert(!report.baseline.some(n=>n.startsWith('0003')),'baseline must predate 0003');
 // 2. legacy data exactly as the legacy routes stored it
 const org='legacy-org',now='2026-08-01T00:00:00.000Z';
 await q('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)',[org,'Legacy Civil',now]);
 const row=(t,id,nm,status,meta)=>q(`INSERT INTO ${t} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`,[id,org,nm,status,typeof meta==='string'?meta:JSON.stringify(meta),now]);
 await row('jobs','job-1','Main St resurfacing','Active',{client:'City Council',contractValue:250000,approvedBudget:{directCost:180000,sellRate:250000},occupancyStart:'19:00',occupancyFinish:'05:00'});
 await row('jobs','job-2','Depot works','Planning',{});
 for(let i=1;i<=40;i++)await row('workers',`w-${i}`,`Worker ${i} Surname`,i%10===0?'Inactive':i%7===0?'Leave':'Active',{trade:i%3?'Labourer':'Paver operator',phone:`04000000${String(i).padStart(2,'0')}`,rate:i%13===0?'TBC':String(45+i),competencies:i%4===0?'White card, EWP':i%5===0?'':'White card',competencyExpiry:i%11===0?'31/12/2026':i%5===0?'':'2027-06-30'});
 await row('workers','w-json','Broken Record','Active','{not-json');
 for(let i=1;i<=12;i++)await row('plant',`p-${i}`,`Plant ${i}`,i===12?'Out of service':'Available',{type:i%2?'Roller':'Paver',rego:`REG${i}`,hourlyRate:i===5?'-1':150+i,complianceExpiry:i===3?'2025-01-01':'2027-12-31',payload:10});
 await row('crews','c-1','Night crew','Active',{foreman:'Sam'});
 for(let i=1;i<=25;i++)await row('shifts',`s-${i}`,`Shift ${i}`,i%9===0?'Cancelled':'Planned',{jobId:i===25?'job-missing':'job-1',date:i===24?'2026-02-31':`2026-09-${String((i%28)+1).padStart(2,'0')}`,start:'19:00',finish:'05:00',scope:'Mill and fill',supervisor:'Sam',assignments:[{resourceId:`w-${i}`,category:'workers',name:`Worker ${i}`,role:'Worker',hours:10,rate:50},{resourceId:`p-${(i%12)+1}`,category:'plant',name:'Plant',role:'Roller',hours:10,rate:150},...(i===3?[{resourceId:'w-deleted',category:'workers',name:'Gone'}]:[])]});
 await q("INSERT INTO dockets (id,organisation_id,docket_no,work_date,client,project,quantity,quantity_unit,amount,status,confidence,source_name,source_key,raw_text,links,created_at,updated_at) VALUES ('d-1',?,'D-1','2026-09-02','City Council','Main St resurfacing',40,'t',8000,'approved',90,'scan.pdf','legacy/d1','', ?, ?, ?)",[org,JSON.stringify({jobId:'job-1'}),now,now]);
 await row('commercial_records','cr-1','Extra kerb','Draft',{recordType:'variation',jobId:'job-1',submittedValue:4500});
 await q("INSERT INTO claims (id,organisation_id,job_id,claim_period,status,metadata,created_at) VALUES ('cl-1',?,'job-1','2026-08','Draft','{}',?)",[org,now]);
 await q("INSERT INTO claim_items (id,organisation_id,claim_id,docket_id,line_item,amount,created_at) VALUES ('ci-1',?,'cl-1','d-1','',8000,?)",[org,now]);
 // an existing Better Auth user with a password, as the deployed signup wrote it
 const legacyPassword='Legacy-user-password-2026',legacyEmail='owner@legacy.example.invalid',authNow=new Date('2026-08-01T00:00:00Z');
 await q('INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)',['legacy-user','Legacy Owner',legacyEmail,1,authNow,authNow]);
 await q('INSERT INTO auth_account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',['legacy-account','legacy-user','credential','legacy-user',await hashPassword(legacyPassword),authNow,authNow]);
 await q("INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES ('legacy-user',?,?,?,'admin',?)",[org,legacyEmail,'Legacy Owner',now]);
 // 3. fingerprint every legacy row
 const LEGACY=['auth_user','auth_account','users','organisations','jobs','workers','plant','crews','shifts','dockets','commercial_records','claims','claim_items'];
 const fingerprint=async()=>{const out={};for(const t of LEGACY){const cols=t==='auth_user'?'id,email,created_at':t==='auth_account'?'id,user_id,password':t==='users'?'id,organisation_id,email,role':t==='organisations'?'id,name,created_at':t==='dockets'?'id,docket_no,work_date,amount,status,links,created_at':t==='claim_items'?'id,claim_id,docket_id,amount':t==='claims'?'id,job_id,claim_period,status,metadata':'id,name,status,metadata,created_at';const rows=await q(`SELECT ${cols} FROM ${t} ORDER BY id`);out[t]={count:rows.length,sha:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return out;};
 const before=await fingerprint();
 // 4. this branch
 const upLog=await run(process.cwd(),'scripts/migrate.mjs');
 report.applied=[...upLog.matchAll(/Applied (\S+)/g)].map(m=>m[1]);
 report.backfill=upLog.split('\n').filter(l=>l.startsWith('Resource backfill'));
 assert.deepEqual(report.applied,['0003_v1_platform.sql','0004_v1_resources_retention.sql']);
 // 5. verification
 assert.deepEqual(await fingerprint(),before,'no legacy row was changed or removed');
 const c=async sql=>Number((await q(sql))[0].n);
 report.counts={workers:await c('SELECT COUNT(*) n FROM workers'),workersSynced:await c('SELECT COUNT(*) n FROM workers WHERE legacy_synced_at IS NOT NULL'),plantSynced:await c('SELECT COUNT(*) n FROM plant WHERE legacy_synced_at IS NOT NULL'),shiftsSynced:await c('SELECT COUNT(*) n FROM shifts WHERE legacy_synced_at IS NOT NULL'),competencies:await c('SELECT COUNT(*) n FROM worker_competencies'),assignments:await c('SELECT COUNT(*) n FROM shift_assignments'),issues:await c('SELECT COUNT(*) n FROM data_migration_issues'),backfillRuns:await c('SELECT COUNT(*) n FROM app_backfills')};
 assert.equal(report.counts.workersSynced,41);assert.equal(report.counts.plantSynced,12);assert.equal(report.counts.shiftsSynced,25);
 assert(report.counts.issues>0,'imperfect legacy values are flagged');
 report.issueFields=(await q('SELECT entity_type,field,COUNT(*) n FROM data_migration_issues GROUP BY entity_type,field ORDER BY entity_type,field')).map(r=>`${r.entity_type}.${r.field}: ${r.n}`);
 const rerun=await run(process.cwd(),'scripts/migrate.mjs');
 assert.match(rerun,/Resource backfill: nothing to migrate/);assert(!/Applied/.test(rerun),'second run applies nothing');
 assert.deepEqual(await fingerprint(),before);
 report.migrations=(await q('SELECT name FROM app_migrations ORDER BY name')).map(r=>r.name);
 if(existsSync('.next/BUILD_ID')){
  const PORT=33197,base=`http://127.0.0.1:${PORT}`;
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env:{...process.env,MYSQL_DATABASE:name,EMAIL_ENABLED:'false',BETTER_AUTH_SECRET:'upgrade-dry-run-secret-with-at-least-32-characters',BETTER_AUTH_URL:base},stdio:['ignore','pipe','pipe']});
  let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);
  try{
   for(let i=0;i<60;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,500));}}
   const signin=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:legacyEmail,password:legacyPassword})});
   assert.equal(signin.status,200,'existing user signs in with the pre-V1 password: '+await signin.clone().text());
   const cookie=signin.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
   const project=await fetch(base+'/api/projects/workspace?id=job-1',{headers:{cookie}});
   const body=await project.json();
   assert.equal(project.status,200,'existing job opens as a project: '+JSON.stringify(body).slice(0,300));
   assert.equal(body.project?.name??body.name,'Main St resurfacing');
   report.server={signIn:signin.status,projectOpen:project.status,project:body.project?.name??body.name};
  }catch(e){console.error(appLog.slice(-4000));throw e;}finally{app.kill();}
 }else report.server='skipped: no production build (.next/BUILD_ID)';
 console.log('Upgrade dry run passed');
 console.log(JSON.stringify(report,null,1));
 void baseLog;
}finally{await db.end();if(!process.env.KEEP_DB)await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();}
