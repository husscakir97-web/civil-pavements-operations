// Regression tests for three review findings on the tenant-scoped demo importer, on disposable databases:
//   F1  an original owner record that merely looks like a demo record must never be adopted or modified by later stages;
//   F2  the HTTP writer must be bound to the database that was inspected (a localhost app on a different database is refused);
//   F3  resume must complete half-finished work from durable state (an estimate before pricing, an ITP before its items, a
//       project at "ready" before "active", and other substeps), with no duplicates and no change to owner records.
//   npm run build   then   MYSQL_DATABASE=import_review_test node scripts/test-import-review.mjs     (database must be empty)
// A second empty disposable database (<name without _test>_other_test) is created for F2. IMPORT_CLI_LEGACY=1 runs the same checks
// against the importer as it was before the fixes (it needs --base-url), to show them failing first.
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {connect,mysqlOptions,identifier} from './mysql-config.mjs';
import {presentByTable,loadFootprint} from './demo/import-footprint.mjs';

const LEGACY=process.env.IMPORT_CLI_LEGACY==='1';
const DB1=process.env.MYSQL_DATABASE;
if(!DB1?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const DB2=DB1.replace(/_test$/,'')+'_other_test';
const P1=Number(process.env.PORT||3197),P2=P1+1,base1=`http://localhost:${P1}`,base2=`http://localhost:${P2}`;
const baseEnv={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'import-review-secret-with-at-least-32-characters',R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
const env1={...baseEnv,BETTER_AUTH_URL:base1},env2={...baseEnv,MYSQL_DATABASE:DB2,BETTER_AUTH_URL:base2};
const results=[];const check=(name,ok,detail='')=>{results.push(Boolean(ok));console.log(`${ok?'PASS':'FAIL'}    ${name}${detail?' — '+detail:''}`);};
const text=r=>(r.stdout||'')+(r.stderr||'');
const hashOf=r=>/planHash: ([0-9a-f]{64})/.exec(text(r))?.[1];
const shaOf=r=>/Baseline sha256: ([0-9a-f]{64})/.exec(text(r))?.[1];
// Every scratch file (baselines) lives in one unique directory created by this run (mode 0700) and removed by this run only.
const WORK=mkdtempSync(join(tmpdir(),'import-review-'));
const password='Import-Review-Password-42!',stamp=Date.now();
const db1=await connect();
const admin=async sql=>{try{await db1.query(sql);return true;}catch{return spawnSync('mysql',['-e',sql],{encoding:'utf8',env:{PATH:process.env.PATH}}).status===0;}};
await admin(`CREATE DATABASE IF NOT EXISTS \`${DB2}\` CHARACTER SET utf8mb4`);
for(const host of ['127.0.0.1','localhost'])await admin(`GRANT ALL ON \`${DB2}\`.* TO '${process.env.MYSQL_USER}'@'${host}'`);
const db2=await mysql.createConnection({...mysqlOptions(),database:DB2});
const [[u1]]=await db1.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
if(Number(u1.n)>0&&Number((await db1.query('SELECT COUNT(*) n FROM users').catch(()=>[[{n:0}]]))[0][0].n))throw new Error('Refusing to run: the database already has users. Use an empty disposable database.');
for(const e of [env1,env2]){const m=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:e,encoding:'utf8'});if(m.status!==0)throw new Error(m.stderr);}
const app=(env,port)=>spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
const servers=[app(env1,P1),app(env2,P2)];
const up=async b=>{for(let i=0;i<120;i++){try{if((await fetch(b+'/login')).ok)return;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}throw new Error('app did not start '+b);};

// ---------------------------------------------------------------- helpers
const q1=async(sql,p=[])=>(await db1.query(sql,p))[0];
const signup=async(base,conn,name,role,email=`${name}-${stamp}@owner-co.example.invalid`)=>{let r;for(let i=0;i<8;i++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
 if(!r.ok)throw new Error('sign-up '+name+' '+r.status);const [[u]]=await conn.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);if(role)await conn.query('UPDATE users SET role=? WHERE id=?',[role,u.id]);return {email,org:u.organisation_id,id:u.id,base};};
const login=async who=>{let r;for(let i=0;i<8;i++){r=await fetch(who.base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:who.base,'Content-Type':'application/json'},body:JSON.stringify({email:who.email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
 if(!r.ok)throw new Error('sign-in '+r.status);who.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
const api=async(who,path,method='GET',body)=>{const res=await fetch(who.base+path,{method,headers:{origin:who.base,cookie:who.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await res.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:res.status,body:j};};
const okay=async(p,label)=>{const r=await p;if(![200,201].includes(r.status))throw new Error(`${label} -> ${r.status} ${JSON.stringify(r.body).slice(0,200)}`);return r.body;};
const insertRow=async(conn,table,values)=>{const [cols]=await conn.query('SELECT COLUMN_NAME c,DATA_TYPE t,IS_NULLABLE n,COLUMN_DEFAULT d,EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
 const row={...values};for(const c of cols)if(!(c.c in row)&&c.n==='NO'&&c.d===null&&!/auto_increment/.test(c.e))row[c.c]=/int|decimal|float|double|bit/.test(c.t)?0:/date|time/.test(c.t)?'2026-01-01 00:00:00':/json/.test(c.t)?'{}':'x';
 const keys=Object.keys(row);await conn.query(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]));};
const SKIP=new Set(['auth_session','auth_verification']);
// Independent fingerprints (do not rely on the tool under test): whole-database digest per table, and a map of every row by id.
const dbDigest=async conn=>{const out={};const [t]=await conn.query("SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY 1");
 for(const {n} of t){if(SKIP.has(n))continue;const [rows]=await conn.query(`SELECT * FROM ${identifier(n)}`);out[n]=rows.length+':'+createHash('sha256').update(rows.map(r=>JSON.stringify(r)).sort().join('\n')).digest('hex');}return out;};
const rowMap=async conn=>{const out=new Map();const [t]=await conn.query("SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
 for(const {n} of t){if(SKIP.has(n))continue;const [c]=await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=\'id\'',[n]);if(!c.length)continue;const [rows]=await conn.query(`SELECT * FROM ${identifier(n)}`);for(const r of rows)out.set(n+':'+r.id,createHash('sha256').update(JSON.stringify(r)).digest('hex'));}return out;};
const changed=(before,after)=>[...before].filter(([k,h])=>after.get(k)!==h).map(([k])=>k);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const importer=(who,args,over={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs','--organisation-id',who.org,...args],{env:{...env1,...over,DEMO_SEED_EMAIL:who.email,DEMO_SEED_PASSWORD:password},encoding:'utf8',timeout:1500000});
const legacyBase=LEGACY?['--base-url',base1]:[];

const only=(process.env.IMPORT_REVIEW_ONLY||'').split(',').filter(Boolean);const want=g=>!only.length||only.includes(g);
try{
 await up(base1);await up(base2);
 const A=await signup(base1,db1,'review-a','admin'),B=await signup(base1,db1,'review-b','admin'),Cc=await signup(base1,db1,'review-c','admin');
 const sharedEmail=`review-d-${stamp}@owner-co.example.invalid`;
 const D=await signup(base1,db1,'review-d','admin',sharedEmail),D2=await signup(base2,db2,'review-d','admin',sharedEmail);
 for(const w of [A,B,Cc,D,D2])await login(w);

 // ================================================================ F1: original records that look like demo records
 if(want('f1')){
 const plantCommon={status:'Available',active:1,safety_hold:0,revision:3,category:'Profiler',make:'Wirtgen',model:'W 120',ownership:'owned',hourly_rate:240};
 await insertRow(db1,'plant',{id:'owner-plant-similar',organisation_id:A.org,plant_number:'DEMO-P02',name:'Owner machine: Wirtgen W 120 Profiler (our own, rego XYZ)',...plantCommon});
 await insertRow(db1,'plant',{id:'owner-plant-exact',organisation_id:B.org,plant_number:'DEMO-P02',name:'DEMO-P02 Wirtgen W 120 Profiler',...plantCommon});
 for(const [who,label,plantId] of [[A,'a similar-name','owner-plant-similar'],[B,'an exact-copy','owner-plant-exact']]){
  const rowBefore=JSON.stringify((await q1('SELECT * FROM plant WHERE id=?',[plantId]))[0]);
  const worldBefore=await dbDigest(db1);
  const dry=importer(who,[]);
  check(`F1 ${label} collision with an original owner plant record: the dry run refuses (exit 3, named conflict)`,dry.status===3&&/CONFLICT\s+plant: DEMO-P02/.test(text(dry)),`exit ${dry.status}`);
  if(!LEGACY){
   const {snapshot,writeBaseline}=await import('./demo/import-guards.mjs');const f=join(WORK,`f1-bl-${plantId}.json`);const sha=writeBaseline(f,who.org,await snapshot(db1));
   const withBaseline=importer(who,['--baseline',f,'--baseline-sha256',sha]);
   check(`F1 ${label} collision: with a verified baseline the plan names the record as one that existed before the import began (provenance, not name matching)`,withBaseline.status===3&&/CONFLICT\s+plant: DEMO-P02 — existed before the import began/.test(text(withBaseline)),`exit ${withBaseline.status}`);
  }
  const run=importer(who,['--apply','--plan-hash',hashOf(dry)||'x','--baseline',join(WORK,`f1-${plantId}.json`),'--stages','resources,workshop',...legacyBase]);
  const rowAfter=JSON.stringify((await q1('SELECT * FROM plant WHERE id=?',[plantId]))[0]);
  const orders=Number((await q1('SELECT COUNT(*) n FROM workshop_orders WHERE asset_id=?',[plantId]))[0].n);
  check(`F1 ${label} collision: apply refuses and the original plant row (status, safety hold, revision) is unchanged, with no workshop order against it`,run.status!==0&&rowBefore===rowAfter&&orders===0,`exit ${run.status}; ${rowBefore===rowAfter?'row unchanged':'ROW CHANGED'}; ${orders} workshop order(s)`);
  check(`F1 ${label} collision: nothing else in the database changed either`,same(worldBefore,await dbDigest(db1)));
 }
 if(!LEGACY){
  // the write boundary on its own, independent of the plan: a plant that existed before the import began cannot be targeted
  const {applyImport}=await import('./demo/import-apply.mjs');const {snapshot}=await import('./demo/import-guards.mjs');
  const call=async(path,method='GET',body)=>api(B,path,method,body);
  const baseline=await snapshot(db1);const before=JSON.stringify((await q1('SELECT * FROM plant WHERE id=?',['owner-plant-exact']))[0]);
  let refusal='';try{await applyImport({raw:db1,org:B.org,seedDate:'2026-10-05',rawCall:call,rawForm:async()=>({status:500,body:''}),baseline,stages:['resources','workshop'],log:()=>{}});}catch(e){refusal=e.message;}
  check('F1 the write boundary itself refuses to target an original record (even when the plan is bypassed), before any change to it',/existed before the import/.test(refusal)&&before===JSON.stringify((await q1('SELECT * FROM plant WHERE id=?',['owner-plant-exact']))[0]),refusal.slice(0,160));
 }

 }
 // ================================================================ F2: the writer must be bound to the inspected database
 if(want('f2')){
  const d1Before=await dbDigest(db1),d2Before=await dbDigest(db2);
  const dry=importer(D,[]);
  const run=importer(D,['--apply','--plan-hash',hashOf(dry)||'x','--baseline',join(WORK,'f2.json'),'--stop-after','divisions','--base-url',base2]);
  check('F2 an app on localhost that is connected to a DIFFERENT database is refused before any write (inspected database and the app\'s database both unchanged)',run.status!==0&&same(d1Before,await dbDigest(db1))&&same(d2Before,await dbDigest(db2)),`exit ${run.status}; ${text(run).split('\n').filter(l=>/Refus|Import failed|bound|different/i.test(l)).slice(0,2).join(' | ').slice(0,200)}`);
  if(!LEGACY){
   const {verifyBinding}=await import('./demo/import-guards.mjs');
   const probe=async who=>{try{await verifyBinding(db1,who.cookie,who.id);return true;}catch{return false;}};
   check('F2 the binding proof accepts the app bound to the inspected database and rejects an app bound to another one (same owner e-mail and password on both)',await probe(D)&&!(await probe(D2)));
   const ok=importer(D,['--apply','--plan-hash',hashOf(dry)||'x','--baseline',join(WORK,'f2b.json'),'--stop-after','divisions']);
   check('F2 the importer starts its own isolated app on the verified database and configuration: apply works with no --base-url and writes only to the inspected database',ok.status===0&&/divisions/.test(text(ok))&&Number((await q1("SELECT COUNT(*) n FROM business_units WHERE organisation_id=? AND code='TC'",[D.org]))[0].n)===1&&same(d2Before,await dbDigest(db2)),`exit ${ok.status}`);
  }
 }

 // ================================================================ F3: resume from durable state at substep granularity
 const ownerFixtures=async who=>{
  await okay(api(who,'/api/platform/clients','POST',{action:'create',client:{name:'Existing Client Pty Ltd',clientCode:'OWN-1',contactName:'Owner Contact',email:'contact@existing-client.example.invalid',phone:'0400 111 222',paymentTermsDays:30,site:{name:'Existing Yard',address:'1 Yard Rd'},contact:{name:'Owner Contact',email:'contact@existing-client.example.invalid',phone:'0400 111 222',role:'Manager'}}}),'owner client');
  await okay(api(who,'/api/operations/resources','POST',{action:'saveWorker',worker:{firstName:'Olive',lastName:'Existing',employeeNumber:'OWN-E1',email:'olive@owner-co.example.invalid',phone:'0400 333 444',roleTitle:'Foreman',employmentType:'employee',hourlyRate:55,location:'Owntown',status:'Active'}}),'owner worker');
 };
 const runChain=async(who,label,CHAIN)=>{
  const BL=join(WORK,`f3${label}.json`);let sha;
  const plan=()=>importer(who,[...(sha&&existsSync(BL)?['--baseline',BL,'--baseline-sha256',sha]:[])]);
  for(const [stages,crash,why] of CHAIN){
   const dry=plan();
   const r=importer(who,['--apply','--plan-hash',hashOf(dry)||'x','--baseline',BL,...(sha&&existsSync(BL)?['--baseline-sha256',sha]:[]),'--stages',stages,'--crash-after-call',crash,...legacyBase]);
   sha=sha||shaOf(r);
   check(`F3${label} interrupted immediately after: ${why}`,r.status===99,`exit ${r.status}${r.status===99?'':'; '+text(r).split('\n').filter(l=>/Refus|failed|FAIL/.test(l)).slice(0,1).join('').slice(0,160)}`);
  }
  const dryFinal=plan();
  const final=importer(who,['--apply','--plan-hash',hashOf(dryFinal)||'x','--baseline',BL,'--baseline-sha256',sha,...legacyBase]);
  check(`F3${label} the final resume completes every stage`,final.status===0,`exit ${final.status}; ${text(final).split('\n').filter(l=>/Refus|failed|FAIL/.test(l)).slice(0,2).join(' | ').slice(0,240)}`);
 };
 const assertComplete=async(who,label,ownerBefore)=>{
  const fp=loadFootprint(),present=await presentByTable(q1,who.org);
  const total=t=>Object.values(present[t]).reduce((a,b)=>a+b,0);
  const wrongCounts=Object.keys(fp.tables).filter(t=>total(t)!==fp.tables[t].expected);
  check(`F3${label} after all the interruptions every footprint table holds exactly the planned rows: nothing missing and no duplicates`,wrongCounts.length===0,wrongCounts.slice(0,6).map(t=>`${t}:${total(t)}!=${fp.tables[t].expected}`).join(', '));
  const badKeys=Object.keys(fp.tables).filter(t=>Object.entries(fp.tables[t].byKey).some(([k,n])=>(present[t][k]||0)!==n));
  check(`F3${label} every planned parent key holds exactly its planned number of rows`,badKeys.length===0,badKeys.slice(0,6).join(', '));
  const estimates=await q1("SELECT e.metadata,t.reference,t.estimated_value FROM estimates e JOIN tenders t ON t.estimate_id=e.id WHERE e.organisation_id=? AND t.reference LIKE 'DEMO-T-%'",[who.org]);
  const unpriced=estimates.filter(e=>!(JSON.parse(e.metadata||'{}').data?.items?.length>0)).map(e=>e.reference);
  check(`F3${label} every demo estimate was priced (an estimate created before pricing is completed on resume)`,estimates.length===7&&unpriced.length===0,unpriced.join(', ')||`${estimates.length} estimates`);
  const stale=estimates.filter(e=>{const sell=Number(JSON.parse(e.metadata||'{}').totals?.sellRate||0);return sell>0&&Math.abs(Number(e.estimated_value)-Math.round(sell/100)*100)>0.5;}).map(e=>e.reference);
  check(`F3${label} every tender's indicative value follows its priced estimate`,estimates.length===7&&stale.length===0,stale.join(', '));
  const tenders=Object.fromEntries((await q1("SELECT reference,stage FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'",[who.org])).map(r=>[r.reference,r.stage]));
  check(`F3${label} tenders reached their intended stages (awarded ×3, submitted, approval, pricing ×2, lost), including one interrupted between approval and submission`,tenders['DEMO-T-001']==='awarded'&&tenders['DEMO-T-002']==='awarded'&&tenders['DEMO-T-003']==='awarded'&&tenders['DEMO-T-004']==='submitted'&&tenders['DEMO-T-005']==='approval'&&tenders['DEMO-T-006']==='pricing'&&tenders['DEMO-T-007']==='pricing'&&tenders['DEMO-T-008']==='lost',JSON.stringify(tenders));
  const itpBad=await q1('SELECT i.id,(SELECT COUNT(*) FROM itp_items x WHERE x.itp_id=i.id) n FROM itps i WHERE i.organisation_id=?',[who.org]);
  check(`F3${label} every ITP has all three inspection items (an ITP created before its items is completed on resume)`,itpBad.length===2&&itpBad.every(r=>Number(r.n)===3),itpBad.map(r=>r.n).join(','));
  const stages=Object.fromEntries((await q1("SELECT t.reference,j.stage FROM jobs j JOIN tenders t ON t.project_id=j.id WHERE j.organisation_id=? AND t.reference LIKE 'DEMO-T-%'",[who.org])).map(r=>[r.reference,r.stage]));
  check(`F3${label} projects reached active, closed and setup (a project moved to ready before active is completed on resume)`,stages['DEMO-T-001']==='active'&&stages['DEMO-T-002']==='closed'&&stages['DEMO-T-003']==='setup',JSON.stringify(stages));
  const risks=await q1('SELECT status,controls FROM risks WHERE organisation_id=?',[who.org]),swms=await q1('SELECT status FROM swms WHERE organisation_id=?',[who.org]);
  check(`F3${label} every risk is controlled with its controls recorded and every SWMS issued`,risks.length===2&&risks.every(r=>r.status==='controlled'&&r.controls)&&swms.length===2&&swms.every(r=>r.status==='issued'),`${JSON.stringify(risks.map(r=>r.status))} ${JSON.stringify(swms.map(r=>r.status))}`);
  const prog=await q1("SELECT status FROM shifts WHERE organisation_id=? AND name='Paving Quarry Road — chainage 1600–2400'",[who.org]);
  check(`F3${label} today's shift is In Progress (a shift created before the marking step is completed on resume)`,prog.length===1&&prog[0].status==='In Progress',JSON.stringify(prog));
  const touched=changed(ownerBefore,await rowMap(db1));
  check(`F3${label} no owner record changed during the interruptions and resumes (every row that existed before the first run is identical)`,touched.length===0,touched.slice(0,6).join(', '));
 };
 // Chain A: estimate created before pricing, priced before the value update, approval before submission, risk, SWMS, ITP, ready, shift.
 if(want('f3')){
  await ownerFixtures(Cc);const before=await rowMap(db1);
  await runChain(Cc,'',[
   ['divisions,resources,crm,pipeline','POST /api/tenders/workspace create-estimate','an estimate was created (pricing still to do)'],
   ['pipeline','PUT /api/estimates','the estimate was priced (tender value still to update)'],
   ['pipeline','POST /api/tenders/workspace approval-decision','a tender was approved (submission still to record)'],
   ['pipeline,projects','POST /api/registers/risks','a risk was created (controls and "controlled" still to do)'],
   ['projects','POST /api/hseq/swms create','a SWMS was created (content, review, approval, issue still to do)'],
   ['projects','POST /api/registers/itps','an ITP was created (its items still to add)'],
   ['projects','workspace transition to=ready','a project moved to ready (active still to do)'],
   ['shifts','POST /api/delivery#4','today\'s shift was created (In Progress marking still to do)'],
  ]);
  await assertComplete(Cc,'',before);
 }
 // Chain B (legacy comparison only): the later crash points WITHOUT the estimate and approval crashes, so each of them is exercised on its
 // own against the importer as it was (chain A stops at the first unrecoverable estimate there, and approval-then-submit fails loudly).
 if(LEGACY&&want('f3b')){
  const Cb=await signup(base1,db1,'review-cb','admin');await login(Cb);await ownerFixtures(Cb);const before=await rowMap(db1);
  await runChain(Cb,'b',[
   ['divisions,resources,crm,pipeline,projects','POST /api/registers/risks','a risk was created (controls and "controlled" still to do)'],
   ['projects','POST /api/hseq/swms create','a SWMS was created (content, review, approval, issue still to do)'],
   ['projects','POST /api/registers/itps','an ITP was created (its items still to add)'],
   ['projects','workspace transition to=ready','a project moved to ready (active still to do)'],
   ['shifts','POST /api/delivery#4','today\'s shift was created (In Progress marking still to do)'],
  ]);
  await assertComplete(Cb,'b',before);
 }
 // Chain C (legacy comparison only): ONLY a project moved to ready before active, with nothing else interrupted, so that gap is shown by itself.
 if(LEGACY&&want('f3c')){
  const Cx=await signup(base1,db1,'review-cx','admin');await login(Cx);
  await runChain(Cx,'c',[['divisions,resources,crm,pipeline,projects','workspace transition to=ready','a project moved to ready (active still to do)']]);
  const st=Object.fromEntries((await q1("SELECT t.reference,j.stage FROM jobs j JOIN tenders t ON t.project_id=j.id WHERE j.organisation_id=? AND t.reference LIKE 'DEMO-T-%'",[Cx.org])).map(r=>[r.reference,r.stage]));
  check('F3c the project moved to ready before active reached active on resume (and the others reached closed and setup)',st['DEMO-T-001']==='active'&&st['DEMO-T-002']==='closed'&&st['DEMO-T-003']==='setup',JSON.stringify(st));
 }
}catch(e){console.error(e.stack||e);check('harness ran to completion',false,String(e.message).slice(0,300));}
finally{for(const s of servers)s.kill();rmSync(WORK,{recursive:true,force:true});await db1.end();await db2.end();const failed=results.filter(x=>!x).length;console.log(`\n${results.length-failed} passed, ${failed} failed${LEGACY?' (legacy importer)':''}`);process.exit(failed?1:0);}
void readFileSync;
