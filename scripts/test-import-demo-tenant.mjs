// Proves scripts/import-demo-tenant.mjs on a disposable database that already holds an owner, a company profile, business records and a
// second tenant: read-only dry run, conflicts refused, additive import, interruption and resume, idempotence, and that nothing that
// existed before was touched.
//   npm run build   then   MYSQL_DATABASE=import_check_test node scripts/test-import-demo-tenant.mjs     (database must be empty)
// Starts its own app (email disabled, no integrations). Nothing leaves the machine.
import {spawn,spawnSync} from 'node:child_process';
import {connect,identifier} from './mysql-config.mjs';
import {readFileSync,writeFileSync,copyFileSync,chmodSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshot,compare,rowsGained,guardedCall,guardedDb,DEMO_TEAM} from './demo/import-guards.mjs';
import {SPEC,BOOTSTRAP,BOOKKEEPING,ATTACHMENT_TABLES,measureFootprint,FOOTPRINT_FILE} from './demo/import-footprint.mjs';
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
// Administrative statements run through the test's own connection when its user may (CI connects as root), else through the local root socket.
const admin=async sql=>{try{for(const stmt of sql.split(';').map(x=>x.trim()).filter(Boolean))await db.query(stmt);return true;}catch{return spawnSync('mysql',['-e',sql],{encoding:'utf8',env:{PATH:process.env.PATH}}).status===0;}};
const BASELINE='/tmp/claude-0/import-baseline-'+Date.now()+'.json';
const importer=(args,over={},opts={})=>spawnSync(process.execPath,['scripts/import-demo-tenant.mjs',...args],{env:{...env,...over},encoding:'utf8',timeout:opts.timeout||1500000});
const text=r=>(r.stdout||'')+(r.stderr||'');
const hashOf=r=>/planHash: ([0-9a-f]{64})/.exec(text(r))?.[1];
const tenantCounts=async org=>{const out={};const [t]=await db.query("SELECT DISTINCT TABLE_NAME n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='organisation_id' AND TABLE_NAME NOT LIKE 'auth_%'");for(const {n} of t){const [[r]]=await db.query(`SELECT COUNT(*) c FROM ${identifier(n)} WHERE organisation_id=?`,[org]);if(Number(r.c))out[n]=Number(r.c);}return out;};
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
const strictSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SALT='fixed-test-salt-for-comparing-snapshots';
const snap=()=>snapshot(db,SALT);
const same=(a,b)=>{const d=compare(a,b);return d.changedRows===0&&d.removedRows===0&&Object.keys(rowsGained(a,b)).length===0;};
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const shaFrom=r=>/Baseline sha256: ([0-9a-f]{64})/.exec(text(r))?.[1];
const planFile=label=>`/tmp/claude-0/plan-${label}-${Date.now()}.json`;
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
 const snapC0=await snap();
 const refDry=importer(['--organisation-id',C.org],{});
 const refRun=importer(['--organisation-id',C.org,'--apply','--plan-hash',hashOf(refDry),'--baseline',BASELINE+'.ref'],{DEMO_SEED_EMAIL:C.email,DEMO_SEED_PASSWORD:password});
 const refSha=shaFrom(refRun);
 const refDelta=rowsGained(snapC0,await snap());
 const measured=await measureFootprint(q,C.org,refDelta);
 if(process.env.WRITE_FOOTPRINT==='1')writeFileSync(FOOTPRINT_FILE,JSON.stringify(measured,null,1)+'\n');
 const committed=JSON.parse(readFileSync(FOOTPRINT_FILE,'utf8'));
 check('the committed footprint equals what an import into an empty tenant actually wrote',strictSame(measured.tables,committed.tables)&&committed.attachmentsAndFiles===0&&Object.keys(committed.tables).length===Object.keys(SPEC).length);
 const knownTables=new Set([...Object.keys(SPEC),...BOOTSTRAP,...BOOKKEEPING]);
 const unknownTables=Object.keys(refDelta).filter(x=>!knownTables.has(x));
 check('every table that gained rows during the import is in the footprint (nothing the dry run does not know about)',unknownTables.length===0,unknownTables.join(', '));
 const wrong=Object.keys(SPEC).filter(x=>(refDelta[x]||0)!==measured.tables[x].expected).map(x=>`${x}:${refDelta[x]||0}!=${measured.tables[x].expected}`);
 check('for every footprint table the rows gained equal the rows the footprint counts',wrong.length===0,wrong.join(', '));
 check('no document, attachment, upload or file table gained a row',Object.keys(refDelta).filter(x=>ATTACHMENT_TABLES.test(x)).length===0);
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
 const world0=await snap();

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
 const quiet=async(label,r,expectStatus)=>check(label,r.status===expectStatus&&same(await snap(),world0),`exit ${r.status}`);
 check('refuses to run without an explicit organisation id',importer([]).status===2);
 check('refuses an organisation id that does not exist',(()=>{const r=importer(['--organisation-id','nope']);return r.status===1&&/not found/i.test(text(r));})());
 await quiet('apply refused without a plan hash',importer(['--organisation-id',A.org,'--apply','--baseline',BASELINE],applyEnv),2);
 await quiet('apply refused with a plan hash that does not match',importer(['--organisation-id',A.org,'--apply','--plan-hash','0'.repeat(64),'--baseline',BASELINE],applyEnv),3);
 const refusals=[['a database not ending in _test',{MYSQL_DATABASE:'import_prod'}],['a remote database host',{MYSQL_HOST:'db.example.com'}],['EMAIL_ENABLED=true',{EMAIL_ENABLED:'true'}],['a configured SMTP host',{SMTP_HOST:'smtp.example.com'}],['a configured billing provider',{BILLING_PROVIDER:'stripe'}],['an enabled AI integration',{AI_ENABLED:'true'}],['NODE_ENV=production',{NODE_ENV:'production'}]];
 for(const [label,over] of refusals)await quiet('apply refused: '+label,importer(['--organisation-id',A.org,'--apply','--plan-hash','x','--baseline',BASELINE],{...applyEnv,...over}),2);
 await quiet('apply refused: --base-url with a remote app',importer(['--organisation-id',A.org,'--apply','--plan-hash','x','--baseline',BASELINE,'--base-url','https://app.example.com'],applyEnv),2);
 await quiet('apply refused: --base-url with a local app the importer did not start (the importer only writes through its own isolated app)',importer(['--organisation-id',A.org,'--apply','--plan-hash','x','--baseline',BASELINE,'--base-url',base],applyEnv),2);

 // ---------------------------------------------------------------- read-only dry run, with a SELECT-only database user
 const roOk=await admin(`CREATE USER IF NOT EXISTS 'imp_ro'@'%' IDENTIFIED BY 'ro-integration-only'; GRANT SELECT ON \`${process.env.MYSQL_DATABASE}\`.* TO 'imp_ro'@'%'; FLUSH PRIVILEGES`);
 const roEnv=roOk?{MYSQL_USER:'imp_ro',MYSQL_PASSWORD:'ro-integration-only'}:{};
 const planAFile=planFile('a');
 const dry=importer(['--organisation-id',A.org,'--out',planAFile],roEnv);
 const plan1=hashOf(dry);
 check('dry run succeeds with a SELECT-only database user'+(roOk?'':' (no admin access: used the app user)'),dry.status===0&&Boolean(plan1),text(dry).slice(-200));
 check('dry run leaves every table of every tenant byte-for-byte unchanged',same(await snap(),world0));
 check('dry run lists what it would create and reports no conflicts for the owner\'s existing records',/keyed records: create \d+, skip 0, conflict 0/.test(text(dry))&&!/CONFLICT|BLOCKER/.test(text(dry)));
 {const planA=JSON.parse(readFileSync(planAFile,'utf8')),rec=Object.fromEntries(planA.scope.records.map(r=>[r.table,r]));
  check('the dry run lists every table apply can write to, with expected, present and to-create counts',planA.scope.records.length===Object.keys(SPEC).length&&Object.keys(committed.tables).every(x=>rec[x]&&rec[x].expected===committed.tables[x].expected&&rec[x].present===0&&rec[x].toCreate===rec[x].expected),`${planA.scope.records.length} tables, ${planA.scope.recordTotals.expected} rows`);
  check('indirect records show their planned parents: estimates and bid reviews under tenders, claims, invoices, risks, SWMS under projects, claim lines under claims, team members by address',
   rec.estimates.parent==='tender'&&rec.estimates.byKey.length===7&&rec.progress_claims.parent==='project'&&rec.progress_claims.byKey.every(k=>/^DEMO-T-00\d #\d+$/.test(k.key))&&rec.progress_claims.expected===4&&rec.client_invoices.expected===2&&rec.client_invoices.byKey.every(k=>/^DEMO-T-00\d$/.test(k.key))&&rec.claim_lines.parent==='claim'&&rec.claim_lines.byKey.every(k=>/^DEMO-T-00\d #\d+$/.test(k.key))&&rec.swms.byKey.length>0&&rec.tender_bid_reviews.parent==='tender'&&rec.users.byKey.length===5&&rec.users.byKey.every(k=>/@kestrel-demo\.example\.invalid$/.test(k.key)));
  check('the plan states that no attachments or files are created and names the bootstrap and bookkeeping tables separately',planA.scope.attachmentsAndFiles.expected===0&&BOOTSTRAP.every(x=>x in planA.scope.bootstrapIfMissing)&&BOOKKEEPING.every(x=>x in planA.scope.bookkeepingAppendOnly));
  check('the printed dry run shows the full table list and totals',/EVERY table apply can write to/.test(text(dry))&&/progress_claims/.test(text(dry))&&/client_invoices/.test(text(dry))&&/total/.test(text(dry)));}
 check('dry run is deterministic',hashOf(importer(['--organisation-id',A.org],roEnv))===plan1);

 // ---------------------------------------------------------------- conflicts are refused, never guessed
 await db.query("INSERT INTO business_units (id,organisation_id,name,name_key,code,description,status,is_default,sort_order,revision,created_at,updated_at) VALUES ('conf-bu',?,'Owner Traffic','owner traffic','TC','Owner’s own traffic division','active',0,9,1,NOW(),NOW())",[A.org]);
 await insertRow('plant',{id:'conf-plant',organisation_id:A.org,plant_number:'DEMO-P01',name:'Owner Excavator'});
 await insertRow('shifts',{id:'conf-shift',organisation_id:A.org,name:'Paving Quarry Road — chainage 0–800',status:'Planned'});
 await insertRow('users',{id:'conf-user',organisation_id:B.org,email:'elena.voss@kestrel-demo.example.invalid',name:'Another tenant user',role:'admin',active:1});
 const conflicted=importer(['--organisation-id',A.org],roEnv);
 check('dry run refuses (exit 3) and names each of the four conflicting records',conflicted.status===3&&(text(conflicted).match(/CONFLICT/g)||[]).length===4&&/divisions: TC/.test(text(conflicted))&&/plant: DEMO-P01/.test(text(conflicted))&&/shifts: Paving Quarry Road/.test(text(conflicted))&&/team members \(no login\): elena\.voss/.test(text(conflicted)),(text(conflicted).match(/CONFLICT/g)||[]).length+' conflicts');
 const worldConflict=await snap();
 await quiet2(importer(['--organisation-id',A.org,'--apply','--plan-hash',hashOf(conflicted)||'x','--baseline',BASELINE],applyEnv),3,'apply refused while conflicts exist, nothing changed',worldConflict);
 for(const [t,id] of [['business_units','conf-bu'],['plant','conf-plant'],['shifts','conf-shift'],['users','conf-user']])await db.query(`DELETE FROM ${t} WHERE id=?`,[id]);
 check('after the fixture conflicts are removed the plan is clean again and identical to the first plan',hashOf(importer(['--organisation-id',A.org],roEnv))===plan1&&same(await snap(),world0));
 // a non-admin cannot be used to import, and an administrator of another tenant cannot import into this one
 {const r1=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE],{DEMO_SEED_EMAIL:NONADMIN.email,DEMO_SEED_PASSWORD:password});
  const r2=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE],{DEMO_SEED_EMAIL:B.email,DEMO_SEED_PASSWORD:password});
  check('apply refused for a non-administrator and for an administrator of a different organisation',r1.status===2&&r2.status===2&&same(await snap(),world0));}

 // ---------------------------------------------------------------- interrupted import, then resume
 const before=await snap();
 const child=spawn(process.execPath,['scripts/import-demo-tenant.mjs','--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE],{env:{...env,...applyEnv}});
 let seen='';let killed=false;
 await new Promise(resolve=>{child.stdout.on('data',d=>{seen+=d;if(!killed&&/== projects/.test(seen)){killed=true;child.kill('SIGKILL');}});child.on('exit',resolve);});
 const baselineSha=/Baseline sha256: ([0-9a-f]{64})/.exec(seen)?.[1];
 check('the baseline was written (digests only) and its SHA-256 shown to the operator before the first change',Boolean(baselineSha)&&statSync(BASELINE).size>0&&sha256(BASELINE)===baselineSha&&(statSync(BASELINE).mode&0o777)===0o600);
 check('the import was interrupted part-way (killed during the projects stage)',killed&&!/Created in this run/.test(seen));
 const partial=await snap();
 const partialDiff=compare(before,partial);
 check('after the interruption nothing that existed before was changed or removed',partialDiff.changedRows===0&&partialDiff.removedRows===0,JSON.stringify(partialDiff).slice(0,200));
 const stale=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan1,'--baseline',BASELINE,'--baseline-sha256',baselineSha],applyEnv);
 check('the old plan hash is refused after an interruption (the tenant changed), so a fresh dry run is required',stale.status===3&&/does not match/.test(text(stale)));
 const resumeFile=planFile('resume');
 const withBaseline=['--baseline',BASELINE,'--baseline-sha256',baselineSha];
 const resumeDry=importer(['--organisation-id',A.org,'--out',resumeFile,...withBaseline],roEnv),planResume=hashOf(resumeDry);
 {const pr=JSON.parse(readFileSync(resumeFile,'utf8'));check('after the interruption the plan shows, per table, what already exists and what is still to create (present + to create = expected)',pr.scope.records.every(r=>r.present+r.toCreate===r.expected)&&pr.scope.recordTotals.present>0&&pr.scope.recordTotals.toCreate>0);}
 check('a fresh dry run shows the partly imported tenant as resume: some records skipped, the rest still to create, no conflicts',resumeDry.status===0&&/skip [1-9]/.test(text(resumeDry))&&!/conflict [1-9]/.test(text(resumeDry))&&planResume!==plan1);
 const finished=importer(['--organisation-id',A.org,'--apply','--plan-hash',planResume,'--baseline',BASELINE,'--baseline-sha256',baselineSha,'--manifest','/tmp/import-manifest-a.json'],applyEnv);
 const failedChecks=(text(finished).match(/^FAIL /gm)||[]).length;
 check('the resumed import completes with every in-import verification passing',finished.status===0&&failedChecks===0&&/PASS  demo projects = 3/.test(text(finished)),text(finished).split('\n').filter(l=>/FAIL|failed|Refused|Import failed/.test(l)).join(' | ').slice(0,300));
 check('the import reports no existing row changed or removed',/Existing rows changed: 0; removed: 0/.test(text(finished)));

 // ---------------------------------------------------------------- existing data is untouched
 const after=await snap(),drift=compare(world0,after);
 check('every row that existed before the import (all tenants, all tables except session rows) is byte-for-byte unchanged',drift.changedRows===0&&drift.removedRows===0,JSON.stringify(drift).slice(0,300));
 const profileAfter=(await q('SELECT * FROM organisation_profiles WHERE organisation_id=?',[A.org]))[0],orgAfter=(await q('SELECT * FROM organisations WHERE id=?',[A.org]))[0];
 check('the company profile and organisation name are exactly as before',strictSame(profileBefore,profileAfter)&&strictSame(orgBefore,orgAfter)&&orgAfter.name===orgBefore.name&&profileAfter.trading_name==='Owner Civil Works');
 const pick=(s,re)=>({tables:Object.fromEntries(Object.entries(s.tables).filter(([x])=>re.test(x))),keyless:{}});const authDrift=compare(pick(world0,/^auth_(user|account)$/),pick(after,/^auth_(user|account)$/));
 check('the owner\'s login records are unchanged and the owner can still sign in',authDrift.changedRows===0&&authDrift.removedRows===0&&Object.keys(rowsGained(pick(world0,/^auth_(user|account)$/),pick(after,/^auth_(user|account)$/))).length===0&&await login(A).then(()=>true,()=>false));
 const ownerRows=await q("SELECT (SELECT COUNT(*) FROM clients WHERE organisation_id=? AND client_code='OWN-1') c,(SELECT COUNT(*) FROM workers WHERE organisation_id=? AND employee_number='OWN-E1') w,(SELECT COUNT(*) FROM opportunities WHERE organisation_id=? AND name='Owner Lead — Depot Slab') o,(SELECT COUNT(*) FROM business_units WHERE organisation_id=? AND code='CIV') b",[A.org,A.org,A.org,A.org]);
 check('the owner\'s own client, worker, opportunity and division are all still there',Object.values(ownerRows[0]).every(v=>Number(v)===1));
 const countsB1=await tenantCounts(B.org);
 check('the second tenant has exactly the same rows as before (no records added, none changed)',strictSame(countsB0,countsB1));
 const noMembership=await q("SELECT COUNT(*) n FROM users WHERE organisation_id=? AND email LIKE '%@kestrel-demo.example.invalid' AND id IN (SELECT id FROM auth_user)",[A.org]);
 check('demonstration team members have no login accounts',Number(noMembership[0].n)===0);

 // ---------------------------------------------------------------- what the baseline file contains
 {const body=readFileSync(BASELINE,'utf8'),b=JSON.parse(body);
  const secrets=[...(await q('SELECT password,access_token,refresh_token,id_token FROM auth_account')).flatMap(r=>Object.values(r)),...(await q('SELECT token,ip_address FROM auth_session')).flatMap(r=>Object.values(r)),...(await q('SELECT identifier,value FROM auth_verification')).flatMap(r=>Object.values(r))].filter(v=>typeof v==='string'&&v.length>=6);
  const personal=[A.email,B.email,'Owner Civil Works','Olive','Existing','0400 333 444','existing-client.example.invalid','second-tenant.example.invalid','Second Tenant Client','Kestrel','Quarry Road','kestrel-demo'];
  const rawIds=[];for(const tname of ['users','clients','workers','auth_user','auth_account','organisations','jobs','tenders','plant','dockets'])rawIds.push(...(await q(`SELECT id FROM ${tname}`)).map(r=>String(r.id)));
  check('the baseline holds no password, hash, token or session content (even though such rows exist in the database)',secrets.length>0&&!secrets.some(s=>body.includes(s)),`${secrets.length} secret values checked`);
  check('the baseline holds no names, e-mail addresses, phone numbers or business record text',!personal.some(s=>body.includes(s)));
  check('the baseline holds no raw record ids: only the operator-supplied organisation id, table names, counts, a salt and digests',!rawIds.filter(i=>i!==A.org).some(i=>body.includes(i))&&Object.keys(b).sort().join()==='format,keyless,organisationId,salt,schema,tables,takenAt,tool'&&Object.values(b.tables).every(v=>Object.keys(v).sort().join()==='n,rows'&&Object.entries(v.rows).every(([k,h])=>/^[0-9a-f]{64}$/.test(k)&&/^[0-9a-f]{64}$/.test(h))));
  check('session and verification (token) tables are not in the baseline at all',!('auth_session' in b.tables)&&!('auth_verification' in b.tables)&&'auth_user' in b.tables&&'auth_account' in b.tables);}

 // ---------------------------------------------------------------- the rows apply actually added match the plan
 {const gained=rowsGained(world0,after);
  const off=Object.keys(SPEC).filter(x=>(gained[x]||0)!==committed.tables[x].expected).map(x=>`${x}:${gained[x]||0}!=${committed.tables[x].expected}`);
  check('in the populated tenant every footprint table gained exactly the planned number of rows',off.length===0,off.join(', '));
  const stray=Object.keys(gained).filter(x=>!knownTables.has(x));
  check('no table outside the footprint gained a row, and no attachment or file table did',stray.length===0&&Object.keys(gained).filter(x=>ATTACHMENT_TABLES.test(x)).length===0,stray.join(', '));
  const bootGain=BOOTSTRAP.filter(x=>gained[x]);check('bootstrap rows (written by the application only if missing) are the only other additions, and are listed in the plan',BOOTSTRAP.every(x=>x in committed.bootstrapRowsIfMissing),bootGain.join(', ')||'none added');}

 // ---------------------------------------------------------------- team members: exactly five, no logins, existing members untouched
 {const members=await q("SELECT id,email,role,name,active FROM users WHERE organisation_id=? AND email LIKE '%@kestrel-demo.example.invalid' ORDER BY email",[A.org]);
  check('exactly the five demonstration team members were added, with the dataset\'s names and non-admin roles',members.length===5&&members.every(m=>DEMO_TEAM.get(m.email)?.name===m.name&&DEMO_TEAM.get(m.email)?.role===m.role&&m.role!=='admin'));
  const authHits=await q('SELECT COUNT(*) n FROM auth_user WHERE id IN (?) OR email IN (?)',[members.map(m=>m.id),members.map(m=>m.email)]);const acct=await q('SELECT COUNT(*) n FROM auth_account WHERE user_id IN (?)',[members.map(m=>m.id)]);
  check('none of them has a login: no auth_user or auth_account row exists for their ids or addresses',Number(authHits[0].n)===0&&Number(acct[0].n)===0);
  const attempt=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:members[0].email,password})});
  check('signing in as a demonstration team member is refused',attempt.status>=400&&attempt.status<500,`HTTP ${attempt.status}`);
  const owner=(await q('SELECT role FROM users WHERE id=?',[A.id]))[0];const non=(await q('SELECT role FROM users WHERE id=?',[NONADMIN.id]))[0];
  check('the existing members\' roles are unchanged (owner admin, other member estimator)',owner.role==='admin'&&non.role==='estimator');
  const g=[];const stub={query:async(sql,params)=>{g.push([sql,params]);return [sql.startsWith('SELECT id,organisation_id')?[]:sql.startsWith('SELECT email')?[]:{affectedRows:1}];},end:async()=>{}};
  const gdb=guardedDb(stub,A.org);const [eEmail,e]=[...DEMO_TEAM.entries()][0];const ins=(id,org,email,name,role)=>gdb.query('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',[id,org,email,name,role,'x']);
  const rejects=async fn=>{try{await fn();return false;}catch(x){return /import guard/.test(x.message);}};
  check('the SQL guard writes a team member only when both the address and the id are absent, and only the dataset\'s own members',
   (await ins('dtag-user-'+e.key,A.org,eEmail,e.name,e.role),g.some(([s])=>/^INSERT/.test(s)))
   &&await rejects(()=>ins('dtag-user-'+e.key,A.org,eEmail,e.name,'admin'))&&await rejects(()=>ins('dtag-user-'+e.key,A.org,eEmail,'Someone Else',e.role))
   &&await rejects(()=>ins('dtag-user-x',A.org,'owner@real.example',e.name,e.role))&&await rejects(()=>ins('dtag-user-'+e.key,B.org,eEmail,e.name,e.role)));
  const existing={query:async(sql)=>[sql.startsWith('SELECT id,organisation_id')?[{id:'dtag-user-'+e.key,organisation_id:A.org}]:sql.startsWith('SELECT email')?[{email:eEmail}]:{affectedRows:1}],end:async()=>{}};
  const wrote=[];const spy={query:async(sql,p)=>{if(!/^SELECT/.test(sql))wrote.push(sql);return existing.query(sql,p);},end:async()=>{}};
  const r=await guardedDb(spy,A.org).query('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',['dtag-user-'+e.key,A.org,eEmail,e.name,e.role,'x']);
  check('an existing demonstration member is never rewritten (the guard reports 0 rows and issues no write)',r[0].affectedRows===0&&wrote.length===0);
  const conflict={query:async(sql)=>[sql.startsWith('SELECT id,organisation_id')?[{id:'other-id',organisation_id:B.org}]:[]],end:async()=>{}};
  check('an address or id that belongs to someone else makes the import stop instead of overwriting or adopting it',await rejects(()=>guardedDb(conflict,A.org).query('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',['dtag-user-'+e.key,A.org,eEmail,e.name,e.role,'x'])));
  check('the SQL guard refuses any change to an existing member, any role or admin change, and any write to login, membership or session tables',
   (await Promise.all([ "UPDATE users SET role='admin' WHERE id=?","UPDATE users SET email='x' WHERE id=?","UPDATE users SET active=0 WHERE organisation_id=?","DELETE FROM users WHERE id=?","INSERT INTO users (id,organisation_id,email,name,role,created_at) VALUES (?,?,?,?,?,?)","INSERT INTO auth_user (id,name,email) VALUES (?,?,?)","INSERT INTO auth_account (id,user_id,password) VALUES (?,?,?)","INSERT INTO auth_session (id,token) VALUES (?,?)","UPDATE auth_account SET password=? WHERE user_id=?","INSERT INTO project_members (id) VALUES (?)"].map(sql=>rejects(()=>gdb.query(sql,[A.org,A.org,'x','x','x','x'])))) ).every(Boolean));
  const apiGuard=guardedCall(async()=>({status:200,body:{}}));
  check('the API guard offers no way to invite, create, change or sign in a user (team, invitation, auth, admin and password routes are refused)',
   (await Promise.all([['/api/platform/team','POST'],['/api/platform/team','PATCH'],['/api/platform/invitations','POST'],['/api/auth/sign-up/email','POST'],['/api/auth/reset-password','POST'],['/api/admin/users','POST'],['/api/platform/members','PUT']].map(([pth,m])=>rejects(()=>apiGuard(pth,m,{}))))).every(Boolean));}

 // ---------------------------------------------------------------- an unexpected record under a demonstration parent is a blocker
 {const demoClient=(await q("SELECT id FROM clients WHERE organisation_id=? AND client_code='DEMO-C1'",[A.org]))[0];
  await insertRow('client_sites',{id:'extra-site',organisation_id:A.org,client_id:demoClient.id,name:'Site added by the owner'});
  const extra=importer(['--organisation-id',A.org,...withBaseline],roEnv);
  check('a record the owner attached to a demonstration parent makes the plan refuse (exit 3, named blocker)',extra.status===3&&/BLOCKER\s+client_sites: more demonstration rows/.test(text(extra)));
  await db.query("DELETE FROM client_sites WHERE id='extra-site'");}

 // ---------------------------------------------------------------- demo relationships and totals
 const s=await scope(q,A.org),countsDemo=await scopedCounts(q,A.org,s),totalsA=await scopedTotals(q,A.org,s);
 const expected={...manifest.counts,users:USERS.length};
 const bad=Object.entries(expected).filter(([k,v])=>k in countsDemo&&countsDemo[k]!==v).map(([k,v])=>`${k}:${countsDemo[k]}!=${v}`);
 check('demonstration counts inside the populated tenant match the dataset manifest',bad.length===0,bad.join(', '));

 // ---------------------------------------------------------------- retries are safe
 const world1=await snap();
 const plan2File=planFile('after');
 const dry2=importer(['--organisation-id',A.org,'--out',plan2File,...withBaseline],roEnv),plan2=hashOf(dry2);
 {const p2=JSON.parse(readFileSync(plan2File,'utf8'));check('a dry run after the import shows nothing left to create, in the keyed records and in every footprint table',/keyed records: create 0, skip \d+, conflict 0/.test(text(dry2))&&p2.scope.recordTotals.toCreate===0&&p2.scope.records.every(r=>r.present===r.expected));}
 // baseline integrity on resume: each of these must be refused before anything is changed
 {const quietBase=async(label,args,expect)=>{const r=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan2,...args],applyEnv);check(label,r.status!==0&&expect.test(text(r))&&same(await snap(),world1),`exit ${r.status}`);};
  const good=BASELINE,sha=baselineSha;
  await quietBase('resume refused when the baseline\'s SHA-256 is not supplied',['--baseline',good],/baseline-sha256/);
  await quietBase('resume refused when the supplied SHA-256 is wrong',['--baseline',good,'--baseline-sha256','0'.repeat(64)],/does not match/);
  const tampered=BASELINE+'.tampered';const j=JSON.parse(readFileSync(good,'utf8'));const firstTable=Object.keys(j.tables).find(x=>Object.keys(j.tables[x].rows).length);const firstKey=Object.keys(j.tables[firstTable].rows)[0];
  j.tables[firstTable].rows[firstKey]='f'.repeat(64);writeFileSync(tampered,JSON.stringify(j),{mode:0o600});
  await quietBase('resume refused when a digest in the baseline has been altered',['--baseline',tampered,'--baseline-sha256',sha],/does not match/);
  const loose=BASELINE+'.loose';copyFileSync(good,loose);chmodSync(loose,0o644);
  await quietBase('resume refused when the baseline file is readable by other users',['--baseline',loose,'--baseline-sha256',sha],/readable by other users/);
  const rewrite=(name,edit)=>{const o=JSON.parse(readFileSync(good,'utf8'));edit(o);const f=BASELINE+'.'+name;writeFileSync(f,JSON.stringify(o),{mode:0o600});return [f,sha256(f)];};
  {const [f,s]=rewrite('trunc',o=>{delete o.tables[firstTable].rows[firstKey];});await quietBase('resume refused when the baseline is internally inconsistent (a row removed even though the SHA-256 was recomputed)',['--baseline',f,'--baseline-sha256',s],/internally inconsistent/);}
  {const [f,s]=rewrite('schema',o=>{o.schema='f'.repeat(64);});await quietBase('resume refused when the baseline was taken against a different schema',['--baseline',f,'--baseline-sha256',s],/schema differs/);}
  {const [f,s]=rewrite('org',o=>{o.organisationId='someone-else';});await quietBase('resume refused when the baseline names a different organisation',['--baseline',f,'--baseline-sha256',s],/different organisation/);}
  await quietBase('resume refused when another tenant\'s baseline is supplied',['--baseline',BASELINE+'.ref','--baseline-sha256',refSha],/different organisation/);}
 const again=importer(['--organisation-id',A.org,'--apply','--plan-hash',plan2,'--baseline',BASELINE,'--baseline-sha256',baselineSha],applyEnv);
 const world2=await snap(),retryDiff=compare(world1,world2);
 const gainedRetry=Object.keys(rowsGained(world1,world2));
 check('a second apply creates nothing and changes nothing (no new rows other than audit/session bookkeeping)',again.status===0&&/Created in this run: \{\}/.test(text(again))&&retryDiff.changedRows===0&&retryDiff.removedRows===0&&gainedRetry.every(x=>/^(audit_|domain_events)/.test(x)),gainedRetry.join(','));

 // ---------------------------------------------------------------- the reference tenant gave identical totals and counts
 check('an empty tenant imported cleanly (reference, imported first)',refRun.status===0,text(refRun).split('\n').filter(l=>/FAIL|Refused|Import failed|CONFLICT/.test(l)).join(' | ').slice(0,300));
 check('totals (contract value, budget, cost, claims, invoices, dockets) in the populated tenant equal the empty tenant\'s',strictSame(totalsA,totalsC),JSON.stringify(totalsA));
 check('counts in the populated tenant equal the empty tenant\'s',strictSame(countsDemo,countsC));
 check('the owner\'s tenant and the second tenant never received each other\'s demonstration rows',Number((await q("SELECT COUNT(*) n FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-%'",[B.org]))[0].n)===0);
}catch(e){console.error(e.stack||e);check('harness ran to completion',false,String(e.message).slice(0,300));}
finally{server.kill();await admin("DROP USER IF EXISTS 'imp_ro'@'%'");await db.end();const failed=results.filter(x=>!x).length;console.log(`\n${results.length-failed} passed, ${failed} failed`);process.exit(failed?1:0);}

async function quiet2(r,expectStatus,label,expectedSnapshot){check(label,r.status===expectStatus&&same(await snap(),expectedSnapshot),`exit ${r.status}`);}
