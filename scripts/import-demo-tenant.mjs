// Tenant-scoped, ADDITIVE import of the Kestrel demonstration dataset into ONE existing organisation. Separate from the test-only
// seed (scripts/seed-demo-company.mjs), whose guards are unchanged.
//
//   Dry run (read-only; works with a SELECT-only database user; touches nothing):
//     node scripts/import-demo-tenant.mjs --organisation-id <id> [--seed-date 2026-10-05] [--out plan.json]
//   Apply (test environments only, see below):
//     node scripts/import-demo-tenant.mjs --organisation-id <id> --apply --plan-hash <hash from a fresh dry run> --baseline <file> --base-url http://127.0.0.1:PORT
//
// What it does: adds demonstration records through the application's own API (state machines, approvals, audit trail), found and
// resumed by deterministic natural keys. What it never does: delete or overwrite any record, rename the organisation, edit the
// company profile, touch memberships/logins/billing/other tenants, or send anything anywhere. A conflicting record makes the plan
// refuse instead of guessing.
//
// Apply refuses unless EVERYTHING holds (the same environment guards as the seed): the database name ends in _test, the database host
// and the app are this machine, NODE_ENV is not production, no external integration is configured, the plan hash matches a fresh
// read-only plan, and DEMO_SEED_EMAIL/DEMO_SEED_PASSWORD sign in as an administrator OF THE NAMED ORGANISATION. There is no flag that
// bypasses these. Running against a hosted tenant is separate, explicitly approved work.
//
// The plan hash binds an apply to the plan that was reviewed. It is NOT proof of approval, of a valid backup or of a restore.
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {connect} from './mysql-config.mjs';
import {assertReadOnlySql} from './live-tenant-inventory.mjs';
import {buildPlan,DIVISIONS} from './demo/import-plan.mjs';
import {guardedCall,guardedDb,snapshot,compare} from './demo/import-guards.mjs';
import {verifyImport} from './demo/import-verify.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const flag=name=>process.argv.includes(name);
const org=arg('--organisation-id');
const SEED_DATE=arg('--seed-date','2026-10-05');
const apply=flag('--apply');
if(!org||org.startsWith('--')){console.error('Usage: --organisation-id <id> [--seed-date YYYY-MM-DD] [--out plan.json]   (dry run)\n       --organisation-id <id> --apply --plan-hash <hash> --base-url http://127.0.0.1:PORT   (test environments only)');process.exit(2);}
if(!/^\d{4}-\d{2}-\d{2}$/.test(SEED_DATE)||Number.isNaN(Date.parse(SEED_DATE))){console.error('--seed-date must be a valid YYYY-MM-DD date');process.exit(2);}
const out=arg('--out');
if(out&&existsSync(out)){console.error('Refusing to overwrite an existing file: '+out);process.exit(2);}

// ---------------------------------------------------------------------------------------------- apply-mode environment guards
const base=arg('--base-url');
if(apply){
 const REFUSE=[];const need=(ok,why)=>{if(!ok)REFUSE.push(why);};
 need(/_test$/.test(process.env.MYSQL_DATABASE||''),'MYSQL_DATABASE must end in _test');
 need(['127.0.0.1','localhost','::1'].includes(process.env.MYSQL_HOST||''),'MYSQL_HOST must be this machine; remote databases are refused');
 need(process.env.NODE_ENV!=='production','NODE_ENV=production is refused');
 need(Boolean(base)&&/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base),'--base-url must point at a local app (http://127.0.0.1:PORT)');
 need(Boolean(arg('--plan-hash')),'--plan-hash from a fresh dry run is required');
 need(Boolean(arg('--baseline')),'--baseline <file> is required (it is written before the first change and reused when an interrupted import is resumed)');
 for(const name of ['SMTP_HOST','SMTP_USER','BILLING_PROVIDER','BILLING_WEBHOOK_SECRET','ABR_GUID','AI_API_KEY','OPENAI_API_KEY','TWILIO_AUTH_TOKEN','SMS_PROVIDER'])need(!process.env[name],`${name} is set: external integrations must be unconfigured`);
 for(const name of ['EMAIL_ENABLED','AI_ENABLED'])need(String(process.env[name]||'false').toLowerCase()!=='true',`${name}=true is refused`);
 need(Boolean(process.env.DEMO_SEED_EMAIL&&process.env.DEMO_SEED_PASSWORD),'DEMO_SEED_EMAIL and DEMO_SEED_PASSWORD (an administrator of the target organisation) are required');
 if(REFUSE.length){console.error('Refusing to apply:\n - '+REFUSE.join('\n - '));process.exit(2);}
}

let raw;try{raw=await connect();}catch{console.error('Could not connect to the database (check MYSQL_* settings; details withheld).');process.exit(2);}
const readOnly=async fn=>{ // every plan query runs in one consistent, server-enforced read-only snapshot
 await raw.query('SET SESSION TRANSACTION READ ONLY');await raw.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 try{return await fn(async(sql,p=[])=>{assertReadOnlySql(sql);return (await raw.query(sql,p))[0];});}finally{await raw.query('ROLLBACK');await raw.query('SET SESSION TRANSACTION READ WRITE');}
};
const render=plan=>{
 console.log(`\nDemonstration import plan for organisation ${org} (seed date ${plan.seedDate})\n`);
 for(const g of plan.groups)console.log(`  ${g.group.padEnd(26)} create ${String(g.create).padStart(3)}   skip ${String(g.skip).padStart(3)}   conflict ${String(g.conflict).padStart(3)}`);
 console.log(`\n  total: create ${plan.totals.create}, skip ${plan.totals.skip}, conflict ${plan.totals.conflict}`);
 console.log('  also created by the stages (keyed to the demo records above): estimates, projects, claims, invoices, risks, SWMS, ITPs, programme, scenarios, workshop orders, service events, cost transactions, project members.');
 for(const c of plan.conflicts)console.log(`  CONFLICT  ${c.group}: ${c.key} — ${c.reason}`);
 for(const b of plan.blockers)console.log(`  BLOCKER   ${b}`);
 console.log(`\n  nothing is deleted or overwritten; the owner's login, memberships, company profile, billing and other tenants are not touched.\n  planHash: ${plan.planHash}\n`);
};

try{
 const plan=await readOnly(q=>buildPlan(q,org,SEED_DATE));
 const refused=plan.conflicts.length>0||plan.blockers.length>0;
 if(!apply){
  render(plan);
  if(out)writeFileSync(out,JSON.stringify(plan,null,1),{mode:0o600});
  process.exitCode=refused?3:0;
 }else{
  render(plan);
  if(refused){console.error('Refusing to apply: the plan has conflicts or blockers. Nothing was changed.');process.exit(3);}
  if(arg('--plan-hash')!==plan.planHash){console.error('Refusing to apply: --plan-hash does not match a fresh plan (the tenant changed since the plan was reviewed, or an earlier run was interrupted). Run the dry run again and review it. Nothing was changed.');process.exit(3);}

  // sign in as the owner of THIS organisation
  const email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD;
  const [owner]=(await raw.query('SELECT id,organisation_id,role FROM users WHERE email=?',[email]))[0];
  if(!owner||owner.organisation_id!==org||owner.role!=='admin'){console.error('Refusing to apply: the signed-in account must be an administrator of the named organisation. Nothing was changed.');process.exit(2);}
  let r;for(let i=0;i<6;i++){r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||15)*1000));}
  if(!r.ok){console.error('Refusing to apply: sign-in failed ('+r.status+').');process.exit(2);}
  const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const rawCall=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{origin:base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};
  const rawForm=async(path,fields)=>{const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,typeof v==='string'?v:JSON.stringify(v));const res=await fetch(base+path,{method:'POST',headers:{origin:base,cookie},body:f});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};
  const call=guardedCall(rawCall),db=guardedDb(raw,org);
  const form=async(path,fields)=>{if(path.split('?')[0]!=='/api/dockets')throw new Error(`Refused by the import guard: form upload to ${path} is not an allowed demonstration write.`);return rawForm(path,fields);};
  const must=async(promise,codes,label)=>{const res=await promise;if(!codes.includes(res.status))throw new Error(`${label} -> ${res.status} ${JSON.stringify(res.body).slice(0,300)}`);return res.body;};
  const one=async(sql,params=[])=>(await db.query(sql,params))[0][0]??null,all=async(sql,params=[])=>(await db.query(sql,params))[0];
  const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const {createHash}=await import('node:crypto');
  const ctx={db,org,user:owner,base,call,form,must,one,all,log:(...a)=>console.log(...a),SEED_DATE,d:n=>addDays(SEED_DATE,n),addDays,created:{},ids:{},note:(k,n=1)=>{ctx.created[k]=(ctx.created[k]||0)+n;},tag:createHash('sha1').update(org).digest('hex').slice(0,8)};
  const {STAGES,hydrate}=await import('./demo/stages.mjs');

  // The baseline is the state of the whole database BEFORE the first change. A resumed import reuses it, so the final comparison is
  // always against the original pre-import state, never against records this tool created in an earlier, interrupted run.
  const baselineFile=arg('--baseline');let before;
  if(existsSync(baselineFile)){const saved=JSON.parse(readFileSync(baselineFile,'utf8'));if(saved.organisationId!==org){console.error('Refusing to apply: the baseline file belongs to a different organisation. Nothing was changed.');process.exit(2);}before=saved.snapshot;console.log('Resuming: comparing against the saved pre-import baseline.');}
  else{before=await snapshot(raw);writeFileSync(baselineFile,JSON.stringify({organisationId:org,takenAt:new Date().toISOString(),snapshot:before}),{mode:0o600});console.log('Pre-import baseline saved.');}
  const divisionsStage=async c=>{
   for(const [code,name,description] of DIVISIONS){
    const have=await c.one('SELECT id FROM business_units WHERE organisation_id=? AND code=? AND name=? AND description=?',[org,code,name,description]);
    if(have){c.ids['division:'+code]=have.id;continue;}
    const made=await must(c.call('/api/business-units','POST',{name,code,description}),[201],'division '+code);
    c.ids['division:'+code]=made.id||made.division?.id;c.note('divisions');
   }
  };
  await hydrate(ctx);for(const k of Object.keys(ctx.ids))if(k.startsWith('division:'))delete ctx.ids[k];
  for(const r of await all('SELECT id,code,name,description FROM business_units WHERE organisation_id=?',[org])){const d=DIVISIONS.find(x=>x[0]===r.code&&x[1]===r.name&&x[2]===r.description);if(d)ctx.ids['division:'+r.code]=r.id;}
  const stop=arg('--stop-after');
  const stages=[['divisions',divisionsStage],...STAGES.filter(([n])=>n!=='company'&&n!=='verify')];
  for(const [name,fn] of stages){
   console.log(`== ${name}`);await fn(ctx);
   if(stop===name){console.log(`Stopped after "${name}" as requested; run a fresh dry run and apply again to resume.`);break;}
  }
  console.log('\nCreated in this run:',JSON.stringify(ctx.created));
  let failed=0;
  if(!stop){
   const result=await readOnly(q=>verifyImport(q,org,console.log));failed+=result.failed;
   if(arg('--manifest'))writeFileSync(arg('--manifest'),JSON.stringify({seedDate:SEED_DATE,organisationId:org,created:ctx.created,counts:result.counts,totals:result.totals},null,1));
  }
  const after=await snapshot(raw),drift=compare(before,after);
  console.log(`Existing rows changed: ${drift.changed.length}; removed: ${drift.removed.length}`);
  for(const x of [...drift.changed,...drift.removed].slice(0,40))console.log('  '+x);
  if(drift.changed.length||drift.removed.length)failed++;
  process.exitCode=failed?1:0;
 }
}catch(e){console.error(e.code==='NO_ORG'?e.message:'Import failed: '+String(e.message).replace(/\s+/g,' ').slice(0,300));process.exitCode=1;}
finally{await raw.end();}
