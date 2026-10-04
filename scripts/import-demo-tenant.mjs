// Tenant-scoped, ADDITIVE import of the Kestrel demonstration dataset into ONE existing organisation. Separate from the test-only
// seed (scripts/seed-demo-company.mjs), whose guards are unchanged.
//
//   Dry run (read-only; works with a SELECT-only database user; touches nothing):
//     node scripts/import-demo-tenant.mjs --organisation-id <id> [--seed-date 2026-10-05] [--out plan.json] [--baseline <file> --baseline-sha256 <hash>]
//   Apply (test environments only, see below):
//     node scripts/import-demo-tenant.mjs --organisation-id <id> --apply --plan-hash <hash from a fresh dry run> --baseline <file> [--baseline-sha256 <hash, required when resuming>]
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
import {writeFileSync,existsSync} from 'node:fs';
import {connect} from './mysql-config.mjs';
import {assertReadOnlySql} from './live-tenant-inventory.mjs';
import {buildPlan} from './demo/import-plan.mjs';
import {snapshot,compare,writeBaseline,loadBaseline,schemaShape,makeProvenance,verifyBinding} from './demo/import-guards.mjs';
import {startIsolatedApp} from './demo/import-app.mjs';
import {applyImport} from './demo/import-apply.mjs';
import {verifyImport} from './demo/import-verify.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
const flag=name=>process.argv.includes(name);
const org=arg('--organisation-id');
const SEED_DATE=arg('--seed-date','2026-10-05');
const apply=flag('--apply');
if(!org||org.startsWith('--')){console.error('Usage: --organisation-id <id> [--seed-date YYYY-MM-DD] [--out plan.json]   (dry run)\n       --organisation-id <id> --apply --plan-hash <hash> --baseline <file>   (test environments only)');process.exit(2);}
if(!/^\d{4}-\d{2}-\d{2}$/.test(SEED_DATE)||Number.isNaN(Date.parse(SEED_DATE))){console.error('--seed-date must be a valid YYYY-MM-DD date');process.exit(2);}
const out=arg('--out');
if(out&&existsSync(out)){console.error('Refusing to overwrite an existing file: '+out);process.exit(2);}

// ---------------------------------------------------------------------------------------------- apply-mode environment guards
// The importer starts its own isolated app (scripts/demo/import-app.mjs) so the writer is bound to the verified database and a safe
// configuration by construction. An already-running app cannot be used: nothing outside this process can prove what it is bound to.
if(process.argv.includes('--base-url')){console.error('Refusing: --base-url is not accepted. The importer starts its own isolated app on the verified database and configuration (run npm run build first).');process.exit(2);}
if(apply){
 const REFUSE=[];const need=(ok,why)=>{if(!ok)REFUSE.push(why);};
 need(/_test$/.test(process.env.MYSQL_DATABASE||''),'MYSQL_DATABASE must end in _test');
 need(['127.0.0.1','localhost','::1'].includes(process.env.MYSQL_HOST||''),'MYSQL_HOST must be this machine; remote databases are refused');
 need(process.env.NODE_ENV!=='production','NODE_ENV=production is refused');
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
 console.log(`\n  keyed records: create ${plan.totals.create}, skip ${plan.totals.skip}, conflict ${plan.totals.conflict}`);
 console.log('\n  EVERY table apply can write to (direct records and everything hanging from them), measured from a reference import:');
 console.log(`  ${'table'.padEnd(26)}${'kind'.padEnd(9)}${'parent'.padEnd(10)}${'expected'.padStart(9)}${'present'.padStart(9)}${'to create'.padStart(10)}`);
 for(const r of plan.scope.records)console.log(`  ${r.table.padEnd(26)}${r.kind.padEnd(9)}${(r.parent||'-').padEnd(10)}${String(r.expected).padStart(9)}${String(r.present).padStart(9)}${String(r.toCreate).padStart(10)}`);
 console.log(`  ${'total'.padEnd(45)}${String(plan.scope.recordTotals.expected).padStart(9)}${String(plan.scope.recordTotals.present).padStart(9)}${String(plan.scope.recordTotals.toCreate).padStart(10)}   (${plan.scope.recordTotals.tables} tables; per-parent keys are in --out)`);
 console.log(`  attachments/files: ${plan.scope.attachmentsAndFiles.expected} — ${plan.scope.attachmentsAndFiles.note}`);
 console.log('  written by the application on first use only if missing (never modified): '+Object.entries(plan.scope.bootstrapIfMissing).map(([t,v])=>`${t} (${v.presentInTenant} present)`).join(', '));
 console.log('  append-only audit/event bookkeeping (counts vary with retries): '+Object.entries(plan.scope.bookkeepingAppendOnly).map(([t,v])=>`${t} (+~${v.referenceRowsAdded})`).join(', '));
 for(const c of plan.conflicts)console.log(`  CONFLICT  ${c.group}: ${c.key} — ${c.reason}`);
 for(const b of plan.blockers)console.log(`  BLOCKER   ${b}`);
 console.log(`\n  nothing is deleted or overwritten; the owner's login, memberships, company profile, billing and other tenants are not touched.\n  planHash: ${plan.planHash}\n`);
};

let app;
try{
 // Provenance: with a verified baseline the plan can tell records this import created from records that were already there.
 const baselineFile=arg('--baseline');let loaded=null;
 if(baselineFile&&existsSync(baselineFile)){loaded=loadBaseline(baselineFile,arg('--baseline-sha256'),org,await schemaShape(raw));console.log('Verified pre-import baseline: records absent from it were created by this import.');}
 const plan=await readOnly(q=>buildPlan(q,org,SEED_DATE,loaded?makeProvenance(loaded):null));
 const refused=plan.conflicts.length>0||plan.blockers.length>0;
 if(!apply){
  render(plan);
  if(out)writeFileSync(out,JSON.stringify(plan,null,1),{mode:0o600});
  process.exitCode=refused?3:0;
 }else{
  render(plan);
  if(refused){console.error('Refusing to apply: the plan has conflicts or blockers. Nothing was changed.');process.exit(3);}
  if(arg('--plan-hash')!==plan.planHash){console.error('Refusing to apply: --plan-hash does not match a fresh plan (the tenant changed since the plan was reviewed, or an earlier run was interrupted). Run the dry run again and review it. Nothing was changed.');process.exit(3);}

  // the owner of THIS organisation, from the inspected database
  const email=process.env.DEMO_SEED_EMAIL,password=process.env.DEMO_SEED_PASSWORD;
  const [owner]=(await raw.query('SELECT id,organisation_id,role FROM users WHERE email=?',[email]))[0];
  if(!owner||owner.organisation_id!==org||owner.role!=='admin'){console.error('Refusing to apply: the signed-in account must be an administrator of the named organisation. Nothing was changed.');process.exit(2);}
  // a private app instance bound to this database and configuration, then proof that it really is
  app=await startIsolatedApp(process.env);
  let r;for(let i=0;i<6;i++){r=await fetch(app.base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:app.base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(r.status!==429)break;await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||15)*1000));}
  if(!r.ok){console.error('Refusing to apply: sign-in failed ('+r.status+').');process.exit(2);}
  const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  await verifyBinding(raw,cookie,owner.id);
  const rawCall=async(path,method='GET',body)=>{const res=await fetch(app.base+path,{method,headers:{origin:app.base,cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};
  const rawForm=async(path,fields)=>{const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,typeof v==='string'?v:JSON.stringify(v));const res=await fetch(app.base+path,{method:'POST',headers:{origin:app.base,cookie},body:f});const text=await res.text();let json;try{json=JSON.parse(text);}catch{json=text;}return {status:res.status,body:json};};

  // The baseline is the state of the whole database BEFORE the first change, stored as salted digests only (no raw records, no
  // secrets; session and token tables are never read). A resumed import reuses it, so the final comparison is always against the
  // original pre-import state, never against records an earlier, interrupted run created. On resume the file must match the SHA-256
  // the operator was shown when it was created, be owner-only, name this organisation and schema, and be internally consistent.
  let before=loaded;
  if(before)console.log('Resuming: comparing against the verified pre-import baseline.');
  else{before=await snapshot(raw);const sha=writeBaseline(baselineFile,org,before);console.log(`Pre-import baseline saved (digests only). Baseline sha256: ${sha}\nKeep this value: resuming an interrupted import requires --baseline-sha256 ${sha}`);}
  const stages=(arg('--stages')||'').split(',').filter(Boolean),stopAfter=arg('--stop-after');
  const {created}=await applyImport({raw,org,seedDate:SEED_DATE,rawCall,rawForm,baseline:before,stages,stopAfter,crash:arg('--crash-after-call')});
  console.log('\nCreated in this run:',JSON.stringify(created));
  let failed=0;
  if(!stopAfter&&!stages.length){
   const result=await readOnly(q=>verifyImport(q,org,console.log));failed+=result.failed;
   if(arg('--manifest'))writeFileSync(arg('--manifest'),JSON.stringify({seedDate:SEED_DATE,organisationId:org,created,counts:result.counts,totals:result.totals},null,1));
  }
  const after=await snapshot(raw,before.salt),drift=compare(before,after);
  console.log(`Existing rows changed: ${drift.changedRows}; removed: ${drift.removedRows}`);
  for(const x of [...drift.changed,...drift.removed].slice(0,40))console.log('  '+x);
  if(drift.changedRows||drift.removedRows)failed++;
  process.exitCode=failed?1:0;
 }
}catch(e){console.error(e.code==='NO_ORG'?e.message:'Import failed: '+String(e.message).replace(/\s+/g,' ').slice(0,300));process.exitCode=1;}
finally{app?.stop();await raw.end();}
