// Proves scripts/import-demo-tenant.mjs on a disposable database that already holds an owner, a company profile, business records and a
// second tenant: read-only dry run, conflicts refused, additive import, interruption and resume, idempotence, and that nothing that
// existed before was touched.
//   npm run build   then   MYSQL_DATABASE=import_check_test node scripts/test-import-demo-tenant.mjs     (database must be empty)
// Starts its own app (email disabled, no integrations). Nothing leaves the machine.
import {spawn,spawnSync} from 'node:child_process';
import {connect,identifier} from './mysql-config.mjs';
import {snapshot,compare,guardedCall,guardedDb} from './demo/import-guards.mjs';
import {scope,scopedCounts,scopedTotals} from './demo/import-verify.mjs';
import manifest from '../docs/DEMO-COMPANY-MANIFEST.json' with {type:'json'};
import {USERS} from './demo/projects.mjs';

if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const PORT=Number(process.env.PORT||3193),base=`http://localhost:${PORT}`;
const env={...process.env,EMAIL_ENABLED:'false',LOCATION_PROVIDER:'fake',BETTER_AUTH_SECRET:'import-test-secret-with-at-least-32-characters',BETTER_AUTH_URL:base,R2_ENDPOINT:'http://127.0.0.1:9',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x',R2_BUCKET_NAME:'x'};
const db=await connect();
const [[users]]=await db.query('SELECT COUNT(*) AS n FROM users').catch(e=>e.code==='ER_NO_SUCH_TABLE'?[[{n:0}]]:Promise.reject(e));
if(Number(users.n))throw new Error('Refusing to run: the database already has users. Use an empty disposable database.');
const migrated=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});if(migrated.status!==0)throw new Error(migrated.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT),'--hostname','127.0.0.1'],{env,stdio:'ignore'});
const results=[];const check=(name,ok,detail='')=>{results.push(Boolean(ok));console.log(`${ok?'PASS':'FAIL'}    ${name}${detail?' — '+detail:''}`);};
const password='Import-Test-Password-42!',stamp=Date.now();
const signup=async(name,role)=>{const email=`${name}-${stamp}@owner-co.example.invalid`;let r;for(let i=0;i<8;i++){r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
 if(!r.ok)throw new Error('sign-up '+name+' '+r.status);const [[u]]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);if(role)await db.query('UPDATE users SET role=? WHERE id=?',[role,u.id]);return {email,org:u.organisation_id,id:u.id};};
const login=async who=>{let r;for(let i=0;i<8;i++){r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:who.email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,10000));}
 if(!r.ok)throw new Error('sign-in '+r.status);who.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
const api=async(who,path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{origin:base,cookie:who.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const t=await res.text();let j;try{j=JSON.parse(t);}catch{j=t;}return {status:res.status,body:j};};
const okay=async(p,label)=>{const r=await p;if(![200,201].includes(r.status))throw new Error(`${label} -> ${r.status} ${JSON.stringify(r.body).slice(0,200)}`);return r.body;};
const root=sql=>spawnSync('mysql',['-e',sql],{encoding:'utf8',env:{PATH:process.env.PATH}});
const BASELINE='/tmp/claude-0/import-baseline-'+Date.now()+'.json';
const importer=(args,over={},opts={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs',...args],{env:{...env,...over},encoding:'utf8',timeout:opts.timeout||1500000});
const text=r=>(r.stdout||'')+(r.stderr||'');
const hashOf=r=>/planHash: ([0-9a-f]{64})/.exec(text(r))?.[1];
const tenantCounts=async org=>{const out={};const [t]=await db.query("SELECT DISTINCT TABLE_NAME n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='organisation_id' AND TABLE_NAME NOT LIKE 'auth_%'");for(const {n} of t){const [[r]]=await db.query(`SELECT COUNT(*) c FROM ${identifier(n)} WHERE organisation_id=?`,[org]);if(Number(r.c))out[n]=Number(r.c);}return out;};
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const strictSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const insertRow=async(table,values)=>{const cols=await q('SELECT COLUMN_NAME c,DATA_TYPE t,IS_NULLABLE n,COLUMN_DEFAULT d,EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
 const row={...values};for(const c of cols)if(!(c.c in row)&&c.n==='NO'&&c.d===null&&!/auto_increment/.test(c.e))row[c.c]=/int|decimal|float|double|bit/.test(c.t)?0:/date|time/.test(c.t)?'2026-01-01 00:00:00':/json/.test(c.t)?'{}':'x';
 const keys=Object.keys(row);await db.query(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]));};

try{
 for(let i=0;i<120;i++){try{if((await fetch(base+'/login')).ok)break;}catch{/* waiting */}await new Promise(r=>setTimeout(r,500));}


 // ---------------------------------------------------------------- the pre-existing world
 const A=await signup('owner-a','admin'),B=await signup('owner-b','admin'),C=await signup('clean-c','admin'),NONADMIN=await signup('not-admin');
 await db.query("UPDATE users SET organisation_id=?,role='estimator' WHERE id=?",[A.org,NONADMIN.id]);
 for(const who of [A,B,C])await login(who);

 // ---------------------------------------------------------------- reference: the same dataset in an EMPTY tenant, imported first
 // Demonstration team-member e-mail addresses are globally unique, so a second tenant in one database is (correctly) refused them.
 // The reference tenant's demo addresses are renamed afterwards so the populated tenant can be imported next.
 const refDry=importer(['--organisation-id',C.org],{});
 const refRun=importer(['--organisation-id',C.org,'--apply','--plan-hash',hashOf(refDry),'--baseline',BASELINE+'.ref','--base-url',base],{DEMO_SEED_EMAIL:C.email,DEMO_SEED_PASSWORD:password});
 await db.query("UPDATE users SET email=REPLACE(email,'@kestrel-demo','@ref-kestrel-demo') WHERE organisation_id=? AND email LIKE '%@kestrel-demo.example.invalid'",[C.org]);
 const sC=await scope(q,C.org),countsC=await scopedCounts(q,C.org,sC),totalsC=await scopedTotals(q,C.org,sC);
 countsC.users=Number((await q("SELECT COUNT(*) n FROM users WHERE organisation_id=? AND email LIKE '%@ref-kestrel-demo.example.invalid'",[C.org]))[0].n); // renamed above
 await okay(api(A,'/api/platform/onboarding','PUT',{legal_name:'Owner Civil Works Pty Ltd',trading_name:'Owner Civil Works',registered_address:'9 Real Street, Owntown NSW 2000',operating_address:'9 Real Street, Owntown NSW 2000',business_activities:['Civil'],disciplines:['Civil'],operating_regions:['NSW'],workforce_size:'11–20',typical_project_size:'$100k–$1M',plant_summary:'Own plant',key_clients:['Existing Client'],certifications:[],tendering_activity:'Regular',hseq_maturity:'Developing',estimating_approach:'Spreadsheet',onboarding_step:4,complete:true}),'owner profile');
 await okay(api(A,'/api/business-units','POST',{name:'Owner Civil Works',code:'CIV',description:'The owner’s own division'}),'owner division');
 await okay(api(A,'/api/platform/clients','POST',{action:'create',client:{name:'Existing Client Pty Ltd',clientCode:'OWN-1',contactName:'Owner Contact',email:'contact@existing-client.example.invalid',phone:'0400 111 222',paymentTermsDays:30,site:{name:'Existing Yard',address:'1 Yard Rd'},contact:{name:'Owner Contact',email:'contact@existing-client.example.invalid',phone:'0400 111 222',role:'Manager'}}}),'owner client');
 await okay(api(A,'/api/operations/resources','POST',{action:'saveWorker',worker:{firstName:'Olive',lastName:'Existing',employeeNumber:'OWN-E1',email:'olive@owner-co.example.invalid',phone:'0400 333 444',roleTitle:'Foreman',employmentType:'employee',hourlyRate:55,location:'Owntown',status:'Active'}}),'owner worker');
 const ownClient=(await q("SELECT id FROM clients WHERE organisation_id=? AND client_code='OWN-1'",[A.org]))[0];
 await okay(api(A,'/api/registers/opportunities','POST',{values:{name:'Owner Lead — Depot Slab',client_id:ownClient.id,estimated_value:90000,probability:40,closing_date:'2026-12-01',notes:'Owner opportunity.'}}),'owner opportunity');
 await okay(api(B,'/api/platform/clients','POST',{action:'create',client:{name:'Second Tenant Client',clientCode:'B-1',contactName:'B Contact',email:'b@second-tenant.example.invalid',phone:'0400 555 666',paymentTermsDays:30,site:{name:'B Yard',address:'2 B Rd'},contact:{name:'B Contact',email:'b@second-tenant.example.invalid',phone:'0400 555 666',role:'Manager'}}}),'tenant B client');
 const profileBefore=(await q('SELECT * FROM organisation_profiles WHERE organisation_id=?',[A.org]))[0];
 const orgBefore=(await q('SELECT * FROM organisations WHERE id=?',[A.org]))[0];
 const countsA0=await tenantCounts(A.org),countsB0=await tenantCounts(B.org);
 check('fixture: owner has a profile, a division, a client, a worker and an opportunity; a second tenant has its own data',Boolean(profileBefore)&&countsA0.business_units>=1&&countsA0.clients===1&&countsA0.workers===1&&countsA0.opportunities===1&&countsB0.clients===1);
 const world0=await snapshot(db);

 // ---------------------------------------------------------------- guard unit checks (no database, no app)
 const stubCalls=[];const g=guardedCall(async(...a)=>{stubCalls.push(a);return {status:200,body:{}};});
 const refusedCall=async(...a)=>{try{await g(...a);return false;}catch(e){return /import guard/.test(e.message);}};
 check('API guard refuses the company profile, team, billing, auth, admin and non-demo resource writes',
  (await Promise.all([['/api/platform/onboarding','PUT',{}],['/api/platform/team','POST',{}],['/api/billing','POST',{}],['/api/auth/sign-up/email','POST',{}],['/api/admin/anything','POST',{}],['/api/business-units','POST',{code:'XYZ'}],['/api/os/records','POST',{module:'crews',name:'Owner crew'}],['/api/os/records','POST',{module:'workers',name:'DEMO x'}],['/api/delivery','DELETE',{}]].map(a=>refusedCall(...a)))).every(Boolean)&&stubCalls.length===0);
 await g('/api/projects/workspace');await g('/api/business-units','POST',{code:'TC'});await g('/api/os/records','POST',{module:'crews',name:'DEMO Paving Crew A'});
 check('API guard allows reads and the demonstration writes',stubCalls.length===3);
 const dbSeen=[];const gd=guardedDb({query:async(...a)=>{dbSeen.push(a[0]);return [[]];},end:async()=>{}},A.org);
 const refusedSql=async(sql,p)=>{try{await gd.query(sql,p);return false;}catch(e){return /import guard/.test(e.message);}};
 check('SQL guard refuses organisation, profile, user (non-demo), deletion and other writes',
  (await Promise.all([refusedSql("UPDATE organisations SET name='x' WHERE id=?",[A.org]),refusedSql('DELETE FROM shifts WHERE organisation_id=?',[A.org]),refusedSql("UPDATE shifts SET status='In Progress' WHERE organisation_id=? AND name=?",[A.org,'Owner shift']),refusedSql('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',['x',A.org,'someone@real.example','x','admin','x']),refusedSql('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',['x','other-org','elena.voss@kestrel-demo.example.invalid','x','admin','x']),refusedSql('TRUNCATE clients')])).every(Boolean)&&dbSeen.length===0);

 // ---------------------------------------------------------------- required inputs and apply refusals (nothing may change)
 const applyEnv={DEMO_SEED_EMAIL:A.email,DEMO_SEED_PASSWORD:password};
 const quiet=async(label,r,expectStatus)=>check(label,r.status===expectStatus&&strictSame(await snapshot(db),world0),`exit ${r.status}`);
 check('refuses to run without an explicit organisation id',importer([]).status===2);
 check('refuses an organisation id that does not exist',(()=>{const r=importer(['--organisation-id','nope']);return r.status===1&&/not found/i.test(text(r));})());
 await quiet('apply refused without a plan hash',importer(['--organisation-id',A.org,'--apply','--baseline',BASELINE,'--base-url',base],applyEnv),2);
 await quiet('apply refused with a plan hash that does not match',importer(['--organisation-id',A.org,'--apply','--plan-hash','0'.repeat(64),'--baseline',BASELINE,'--base-url',base],applyEnv),3);
 const refusals=[['a database not ending in _test',{MYSQL_DATABASE:'import_prod'}],['a remote database host',{MYSQL_HOST:'db.example.com'}],['EMAIL_ENABLED=true',{EMAIL_ENABLED:'true'}],['a configured SMTP host',{SMTP_HOST:'smtp.example.com'}],['a configured billing provider',{BILLING_PROVIDER:'stripe'}],['an enabled AI integration',{AI_ENABLED:'true'}],['NODE_ENV=production',{NODE_ENV:'production'}]];
 for(const [label,over] of refusals)await quiet('apply refused: '+label,importer(['--organisation-id',A.org,'--apply','--plan-hash','x','--baseline',BASELINE,'--base-url',base],{...applyEnv,...over}),2);
 await quiet('apply refused: a non-local app URL',importer(['--organisation-id',A.org,'--apply','--plan-hash','x','--baseline',BASELINE,'--base-url','https://app.example.com'],applyEnv),2);

 // ---------------------------------------------------------------- read-only dry run, with a SELECT-only database user
 const ro=root(`CREATE USER IF NOT EXISTS 'imp_ro'@'127.0.0.1' IDENTIFIED BY 'ro-integration-only'; GRANT SELECT ON \`${process.env.MYSQL_DATABASE}\`.* TO 'imp_ro'@'127.0.0.1'; FLUSH PRIVILEGES;`);
 const roEnv=ro.status===0?{MYSQL_USER:'imp_ro',MYSQL_PASSWORD:'ro-integration-only'}:{};
 const dry=importer(['--organisation-id',A.org],roEnv);
 const plan1=hashOf(dry);
 check('dry run succeeds with a SELECT-only database user'+(ro.status===0?'':' (no admin access: used the app user)'),dry.status===0&&Boolean(plan1),text(dry).slice(-200));
 check('dry run leaves every table of every tenant byte-for-byte unchanged',strictSame(await snapshot(db),world0));
 check('dry run lists what it would create and reports no conflicts for the owner\'s existing records',/total: create \d+, skip 0, conflict 0/.test(text(dry))&&!/CONFLICT|BLOCKER/.test(text(dry)));
 check('dry run is deterministic',hashOf(importer(['--organisation-id',A.org],roEnv))===plan1);

 // ---------------------------------------------------------------- conflicts are refused, never guessed
 await db.query("INSERT INTO business_units (id,organisation_id,name,name_key,code,description,status,is_default,sort_order,revision,created_at,updated_at) VALUES ('conf-bu',?,'Owner Traffic','owner traffic','TC','Owner’s own traffic division','active',0,9,1,NOW(),NOW())",[A.org]);
 await insertRow('plant',{id:'conf-plant',organisation_id:A.org,plant_number:'DEMO-P01',name:'Owner Excavator'});
 await insertRow('shifts',{id:'conf-shift',organisation_id:A.org,name:'Paving Quarry Road — chainage 0–800',status:'Planned'});
 await insertRow('users',{id:'conf-user',organisation_id:B.org,email:'elena.voss@kestrel-demo.example.invalid',name:'Another tenant user',role:'admin',active:1});
 const conflicted=importer(['--organisation-id',A.org],roEnv);
 check('dry run refuses (exit 3) and names each of the four conflicting records',conflicted.status===3&&(text(conflicted).match(/CONFLICT/g)||[]).length===4&&/divisions: TC/.test(text(conflicted))&&/plant: DEMO-P01/.test(text(conflicted))&&/shifts: Paving Quarry Road/.test(text(conflicted))&&/team members \(no login\): elena\.voss/.test(text(conflicted)),(text(conflicted).match(/CONFLICT/g)||[]).length+' conflicts');
 const worldConflict=await snapshot(db);
 await quiet2(importer(['--organisation-id',A.org,'--apply','--plan-hash',hashOf(conflicted)||'x','--baseline',BASELINE,'--base-url',base],applyEnv),3,'apply refused while conflicts exist, nothing changed',worldConflict);
 for(const [t,id] of [['business_units','conf-bu'],['plant','conf-plant'],['shifts','conf-shift'],['users','conf-user']])await db.query(`DELETE FROM ${t} WHERE id=?`,[id]);
 check('after the fixture conflicts are removed the plan is clean again and identical to the first plan',hashOf(importer(['--organisation-id',A.org],roEnv))===plan1&&strictSame(await snapshot(db),world0));
 // a non-admin cannot be used to import, and an administrator of another tenant cannot import into this one
 {const r1=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE,'--base-url',base],{DEMO_SEED_EMAIL:NONADMIN.email,DEMO_SEED_PASSWORD:password});
  const r2=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE,'--base-url',base],{DEMO_SEED_EMAIL:B.email,DEMO_SEED_PASSWORD:password});
  check('apply refused for a non-administrator and for an administrator of a different organisation',r1.status===2&&r2.status===2&&strictSame(await snapshot(db),world0));}

 // ---------------------------------------------------------------- interrupted import, then resume
 const before=await snapshot(db);
 const child=spawn(process.execPath,['scripts/import-demo-tenant.mjs','--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE,'--base-url',base],{env:{...env,...applyEnv}});
 let seen='';let killed=false;
 await new Promise(resolve=>{child.stdout.on('data',d=>{seen+=d;if(!killed&&/== projects/.test(seen)){killed=true;child.kill('SIGKILL');}});child.on('exit',resolve);});
 check('the import was interrupted part-way (killed during the projects stage)',killed&&!/Created in this run/.test(seen));
 const partial=await snapshot(db);
 const partialDiff=compare(before,partial);
 check('after the interruption nothing that existed before was changed or removed',partialDiff.changed.length===0&&partialDiff.removed.length===0,JSON.stringify(partialDiff).slice(0,200));
 const stale=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE,'--base-url',base],applyEnv);
 check('the old plan hash is refused after an interruption (the tenant changed), so a fresh dry run is required',stale.status===3&&/does not match/.test(text(stale)));
 const resumeDry=importer(['--organisation-id',A.org],roEnv),planResume=hashOf(resumeDry);
 check('a fresh dry run shows the partly imported tenant as resume: some records skipped, the rest still to create, no conflicts',resumeDry.status===0&&/skip [1-9]/.test(text(resumeDry))&&!/conflict [1-9]/.test(text(resumeDry))&&planResume!==plan1);
 const finished=importer(['--organisation-id',A.org,'--apply','--plan-hash',planResume,'--baseline',BASELINE,'--base-url',base,'--manifest','/tmp/import-manifest-a.json'],applyEnv);
 const failedChecks=(text(finished).match(/^FAIL /gm)||[]).length;
 check('the resumed import completes with every in-import verification passing',finished.status===0&&failedChecks===0&&/PASS  demo projects = 3/.test(text(finished)),text(finished).split('\n').filter(l=>/FAIL|failed|Refused|Import failed/.test(l)).join(' | ').slice(0,300));
 check('the import reports no existing row changed or removed',/Existing rows changed: 0; removed: 0/.test(text(finished)));

 // ---------------------------------------------------------------- existing data is untouched
 const after=await snapshot(db),drift=compare(world0,after);
 check('every row that existed before the import (all tenants, all tables except session rows) is byte-for-byte unchanged',drift.changed.length===0&&drift.removed.length===0,JSON.stringify(drift).slice(0,300));
 const profileAfter=(await q('SELECT * FROM organisation_profiles WHERE organisation_id=?',[A.org]))[0],orgAfter=(await q('SELECT * FROM organisations WHERE id=?',[A.org]))[0];
 check('the company profile and organisation name are exactly as before',strictSame(profileBefore,profileAfter)&&strictSame(orgBefore,orgAfter)&&orgAfter.name===orgBefore.name&&profileAfter.trading_name==='Owner Civil Works');
 const authBefore=Object.entries(world0).filter(([t])=>/^auth_(user|account)$/.test(t)),authAfter=Object.entries(after).filter(([t])=>/^auth_(user|account)$/.test(t));
 check('the owner\'s login records are unchanged and the owner can still sign in',strictSame(authBefore,authAfter)&&await login(A).then(()=>true,()=>false));
 const ownerRows=await q("SELECT (SELECT COUNT(*) FROM clients WHERE organisation_id=? AND client_code='OWN-1') c,(SELECT COUNT(*) FROM workers WHERE organisation_id=? AND employee_number='OWN-E1') w,(SELECT COUNT(*) FROM opportunities WHERE organisation_id=? AND name='Owner Lead — Depot Slab') o,(SELECT COUNT(*) FROM business_units WHERE organisation_id=? AND code='CIV') b",[A.org,A.org,A.org,A.org]);
 check('the owner\'s own client, worker, opportunity and division are all still there',Object.values(ownerRows[0]).every(v=>Number(v)===1));
 const countsB1=await tenantCounts(B.org);
 check('the second tenant has exactly the same rows as before (no records added, none changed)',strictSame(countsB0,countsB1));
 const noMembership=await q("SELECT COUNT(*) n FROM users WHERE organisation_id=? AND email LIKE '%@kestrel-demo.example.invalid' AND id IN (SELECT id FROM auth_user)",[A.org]);
 check('demonstration team members have no login accounts',Number(noMembership[0].n)===0);

 // ---------------------------------------------------------------- demo relationships and totals
 const s=await scope(q,A.org),countsDemo=await scopedCounts(q,A.org,s),totalsA=await scopedTotals(q,A.org,s);
 const expected={...manifest.counts,users:USERS.length};
 const bad=Object.entries(expected).filter(([k,v])=>k in countsDemo&&countsDemo[k]!==v).map(([k,v])=>`${k}:${countsDemo[k]}!=${v}`);
 check('demonstration counts inside the populated tenant match the dataset manifest',bad.length===0,bad.join(', '));

 // ---------------------------------------------------------------- retries are safe
 const world1=await snapshot(db);
 const dry2=importer(['--organisation-id',A.org],roEnv),plan2=hashOf(dry2);
 check('a dry run after the import shows nothing left to create',/total: create 0, skip \d+, conflict 0/.test(text(dry2)));
 const again=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan2,'--baseline',BASELINE+'.2','--base-url',base],applyEnv);
 const world2=await snapshot(db),retryDiff=compare(world1,world2);
 const newRows=Object.entries(world2).flatMap(([t,rows])=>t.startsWith('auth_session')||t==='auth_verification'?[]:Object.keys(rows).filter(k=>!(k in (world1[t]||{}))).map(k=>t+':'+k));
 check('a second apply creates nothing and changes nothing (no new rows other than audit/session bookkeeping)',again.status===0&&/Created in this run: \{\}/.test(text(again))&&retryDiff.changed.length===0&&retryDiff.removed.length===0&&newRows.every(r=>/^(audit_|auth_)/.test(r)),newRows.slice(0,5).join(','));

 // ---------------------------------------------------------------- the reference tenant gave identical totals and counts
 check('an empty tenant imported cleanly (reference, imported first)',refRun.status===0,text(refRun).split('\n').filter(l=>/FAIL|Refused|Import failed|CONFLICT/.test(l)).join(' | ').slice(0,300));
 check('totals (contract value, budget, cost, claims, invoices, dockets) in the populated tenant equal the empty tenant\'s',strictSame(totalsA,totalsC),JSON.stringify(totalsA));
 check('counts in the populated tenant equal the empty tenant\'s',strictSame(countsDemo,countsC));
 check('the owner\'s tenant and the second tenant never received each other\'s demonstration rows',Number((await q("SELECT COUNT(*) n FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-%'",[B.org]))[0].n)===0);
}catch(e){console.error(e.stack||e);check('harness ran to completion',false,String(e.message).slice(0,300));}
finally{server.kill();root("DROP USER IF EXISTS 'imp_ro'@'127.0.0.1'");await db.end();const failed=results.filter(x=>!x).length;console.log(`\n${results.length-failed} passed, ${failed} failed`);process.exit(failed?1:0);}

async function quiet2(r,expectStatus,label,expectedSnapshot){check(label,r.status===expectStatus&&strictSame(await snapshot(db),expectedSnapshot),`exit ${r.status}`);}
