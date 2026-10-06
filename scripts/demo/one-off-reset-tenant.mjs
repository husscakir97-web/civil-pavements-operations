// ONE-OFF, owner-requested: replace all operational data of ONE tenant before the full fictional demo is imported. NOT a reusable feature:
// delete this file (and the two `reset*` branches in scripts/existing-tenant-load.mjs) after the demo is loaded.
//
//   plan   (read-only):  node scripts/demo/one-off-reset-tenant.mjs --organisation-id <id> --existing-tenant-allowlist <file> [--out plan.json]
//   apply:               ... --apply --plan-hash <hash> --backup-evidence <file> --confirm "RESET-OPERATIONAL-DATA <id> <hash>" --ledger <new file>
//
// Login-less `users` rows of the tenant (team members without access, e.g. earlier demo staff) are operational dummy data and ARE deleted; they are listed in the plan.
// Scope: rows WHERE organisation_id=<id> in the DELETE tables below, in one InnoDB transaction. Everything else is preserved byte-for-byte:
// the `organisations` row, every login (auth_*), every `users` membership that has a login (and always the allow-listed admin), the company profile, entitlements, invitations, billing,
// audit trail, AI usage ledger, migration bookkeeping and every other tenant. Fail-closed: every table carrying organisation_id must be
// classified here, or the run refuses. The same exact-target allow-list, backup evidence (fresh, restore-attested, fingerprint == current
// state) and plan-hash binding as the additive import apply. Before COMMIT a full before/after snapshot proves: nothing changed, nothing
// was added, exactly the planned rows were removed, and none remain for this tenant; any surprise rolls back. The ledger lists every deleted key.
// Files/objects referenced by deleted attachment/document rows live in object storage and are NOT touched by this script.
import {createHash} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
import {connect,identifier} from '../mysql-config.mjs';
import {evaluateExistingTenantAllowlist,evaluateBackupEvidence,databaseFingerprint} from './existing-tenant.mjs';
import {snapshot,compare,rowsGained,schemaShape,mutationGate,assertBeforeDeadline} from './import-guards.mjs';
import {pathToFileURL} from 'node:url';

export const PRESERVE_ORG_TABLES=['ai_usage_ledger','app_backfills','audit_events','audit_log','billing_customers','billing_events','billing_subscriptions',
 'data_migration_issues','domain_events','notification_preferences','organisation_entitlements','organisation_invitations','organisation_profiles','users'];
export const DELETE_TABLES=['ai_suggestions','asset_meter_readings','asset_service_events','attachments','business_units','claim_items','claim_lines','claims',
 'client_contacts','client_invoices','client_requests','client_sites','clients','commercial_records','communication_messages','communication_receipts',
 'communication_threads','cost_codes','cost_transactions','crews','depots','dockets','document_links','document_versions','documents','estimate_revisions',
 'estimates','external_access_tokens','external_responses','extraction_profiles','field_history','field_records','form_submission_amendments','form_submissions',
 'form_template_versions','form_templates','hseq_action_reviews','hseq_actions','hseq_incidents','hseq_investigations','hseq_ncrs','ims_document_revisions',
 'ims_documents','itp_items','itps','job_ims_items','jobs','knowledge_packs','knowledge_rules','knowledge_sources','library_items','locations','managed_documents',
 'notifications','opportunities','planning_activities','planning_canvas_positions','planning_cost_items','planning_cost_links','planning_dependencies',
 'planning_plans','planning_requirements','planning_scenarios','plant','preparation_revisions','program_activities','progress_claims','project_baselines',
 'project_checklist_items','project_contacts','project_cost_codes','project_members','project_variations','project_work_areas','project_work_points',
 'qa_safety_records','quote_revisions','rate_libraries','risks','shift_assignments','shift_requirements','shift_work_areas','shifts','subcontractors','suppliers',
 'swms','swms_acknowledgements','swms_revisions','tender_bid_reviews','tender_clarifications','tender_requirements','tender_returnables','tenders','variations',
 'work_packages','worker_competencies','workers','workflow_tasks','workshop_entries','workshop_orders'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const mark=(org,hash)=>`RESET-OPERATIONAL-DATA ${org} ${hash}`;
export const confirmText=mark;

async function classify(db){
 const [rows]=await db.query("SELECT DISTINCT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='organisation_id' ORDER BY 1");
 const present=rows.map(r=>r.t),known=new Set([...DELETE_TABLES,...PRESERVE_ORG_TABLES]);
 const unclassified=present.filter(t=>!known.has(t)),missing=DELETE_TABLES.filter(t=>!present.includes(t));
 if(unclassified.length)throw new Error('Refusing: table(s) with organisation_id are not classified for this one-off reset: '+unclassified.join(', '));
 if(missing.length)throw new Error('Refusing: the schema differs from the reviewed one (missing table(s): '+missing.join(', ')+').');
}

/** Read-only. Counts what would be deleted, and the identity of what is preserved. */
export async function buildResetPlan(db,org,adminEmail){
 await classify(db);
 const [[o]]=await db.query('SELECT id,name FROM organisations WHERE id=?',[org]);
 if(!o)throw new Error('Refusing: the organisation does not exist.');
 const [admins]=await db.query("SELECT id,email,role,active FROM users WHERE organisation_id=? ORDER BY id",[org]);
 const admin=admins.find(u=>String(u.email).toLowerCase()===String(adminEmail).toLowerCase()&&u.role==='admin'&&Number(u.active)===1);
 if(!admin)throw new Error('Refusing: the allow-listed administrator is not an active admin member of this organisation.');
 const [[au]]=await db.query('SELECT id FROM auth_user WHERE email=?',[adminEmail]);
 const [loginless]=await db.query('SELECT u.id,u.email,u.role,u.active FROM users u WHERE u.organisation_id=? AND u.id<>? AND NOT EXISTS (SELECT 1 FROM auth_user a WHERE LOWER(a.email)=LOWER(u.email)) ORDER BY u.id',[org,admin.id]);
 const loginlessIds=new Set(loginless.map(u=>u.id));
 if(!au)throw new Error('Refusing: the allow-listed administrator has no login (auth_user).');
 const deleteCounts={},otherTenantRows={};let total=0;
 for(const t of DELETE_TABLES){
  const [[a]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);const [[b]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id<>?`,[org]);
  deleteCounts[t]=Number(a.n);otherTenantRows[t]=Number(b.n);total+=Number(a.n);
 }
 const preserved={};
 for(const t of PRESERVE_ORG_TABLES.filter(x=>x!=='users')){const [[a]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);preserved[t]=Number(a.n);}
 preserved.users=admins.length-loginless.length;
 for(const t of ['organisations','auth_user','auth_account'])preserved[t+' (all tenants)']=Number((await db.query(`SELECT COUNT(*) n FROM ${identifier(t)}`))[0][0].n);
 const body={tool:'one-off-reset-tenant',organisation:{id:o.id,name:o.name},adminLogin:{email:adminEmail,userId:admin.id,authUserId:au.id},
  preservedMemberships:admins.filter(u=>!loginlessIds.has(u.id)).map(u=>({id:u.id,email:u.email,role:u.role,active:Number(u.active)})),deletedLoginlessMembers:loginless.map(u=>({id:u.id,email:u.email,role:u.role,active:Number(u.active)})),preservedRowCounts:preserved,
  deletedRowCounts:Object.fromEntries(Object.entries(deleteCounts).filter(([,n])=>n)),deletedTableCount:Object.values(deleteCounts).filter(Boolean).length,deletedRowTotal:total+loginless.length,
  otherTenantRowsInDeleteTables:Object.values(otherTenantRows).reduce((a,b)=>a+b,0),schema:sha(await schemaShape(db))};
 return {...body,planHash:sha(JSON.stringify({...body,deleteCounts}))};
}

async function primaryKeys(db,t){const [r]=await db.query("SELECT COLUMN_NAME c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",[t]);return r.map(x=>x.c);}

export async function applyReset(db,org,plan,{ledger}={}){
 // 1. ledger of every key about to be deleted (written first; refuses to overwrite)
 const led={tool:'one-off-reset-tenant',organisationId:org,planHash:plan.planHash,createdAt:new Date().toISOString(),tables:{}};
 for(const t of DELETE_TABLES){
  const n=plan.deletedRowCounts[t]||0;if(!n)continue;
  const pk=await primaryKeys(db,t);
  led.tables[t]=pk.length?{key:pk,rows:(await db.query(`SELECT ${pk.map(identifier).join(',')} FROM ${identifier(t)} WHERE organisation_id=? ORDER BY ${pk.map(identifier).join(',')}`,[org]))[0].map(r=>pk.length===1?r[pk[0]]:pk.map(c=>r[c]))}:{key:null,count:n};
 }
 if(plan.deletedLoginlessMembers.length)led.tables.users_loginless={key:['id'],rows:plan.deletedLoginlessMembers.map(u=>u.id)};
 if(ledger)writeFileSync(ledger,JSON.stringify(led,null,1),{mode:0o600,flag:'wx'});
 // 2. delete + prove, in one transaction
 const before=await snapshot(db);
 await db.query('START TRANSACTION');
 try{
  assertBeforeDeadline();
  const deleted={};
  for(const t of DELETE_TABLES){
   const [r]=await db.query(`DELETE FROM ${identifier(t)} WHERE organisation_id=?`,[org]);
   deleted[t]=r.affectedRows;if(r.affectedRows!==(plan.deletedRowCounts[t]||0))throw new Error(`${t}: deleted ${r.affectedRows}, the reviewed plan said ${plan.deletedRowCounts[t]||0}`);
  }
  const lr=await db.query('DELETE u FROM users u WHERE u.organisation_id=? AND u.id<>? AND NOT EXISTS (SELECT 1 FROM auth_user a WHERE LOWER(a.email)=LOWER(u.email))',[org,plan.adminLogin.userId]);
  if(lr[0].affectedRows!==plan.deletedLoginlessMembers.length)throw new Error(`users: deleted ${lr[0].affectedRows} login-less member(s), the reviewed plan said ${plan.deletedLoginlessMembers.length}`);
  deleted.users=lr[0].affectedRows;
  const after=await snapshot(db,before.salt);   // same salt: row digests are only comparable under one salt
  const cmp=compare(before,after),gained=Object.values(rowsGained(before,after)).reduce((a,b)=>a+b,0);
  if(cmp.changedRows)throw new Error('rows changed unexpectedly: '+cmp.changed.join('; '));
  if(gained)throw new Error(gained+' row(s) appeared unexpectedly');
  for(const t of Object.keys(before.tables)){
   const expected=DELETE_TABLES.includes(t)?(plan.deletedRowCounts[t]||0):t==='users'?plan.deletedLoginlessMembers.length:0;
   const removed=before.tables[t].n-after.tables[t].n;
   if(removed!==expected)throw new Error(`${t}: removed ${removed} row(s), expected ${expected}`);
  }
  for(const t of DELETE_TABLES){const [[r]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);if(Number(r.n))throw new Error(t+' still has rows for this tenant');}
  assertBeforeDeadline();
  await db.query('COMMIT');
  return {deleted,removedRows:Object.values(deleted).reduce((a,b)=>a+b,0),preservedUnchanged:true};
 }catch(e){try{await db.query('ROLLBACK');}catch{/* connection already gone */}throw e;}
}

const arg=(n,f)=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:f;};
async function main(){
 const org=arg('--organisation-id'),allowFile=arg('--existing-tenant-allowlist'),out=arg('--out');
 if(!org||!allowFile){console.error('Usage: --organisation-id <id> --existing-tenant-allowlist <file> [--out plan.json] [--apply --plan-hash H --backup-evidence F --confirm TEXT --ledger NEWFILE]');return 2;}
 const apply=process.argv.includes('--apply');
 const al=evaluateExistingTenantAllowlist(allowFile,{...process.env,DEMO_SEED_EMAIL:process.env.DEMO_SEED_EMAIL});
 if(al.problems.length||al.entry.organisationId!==org){console.error('Refused (nothing was connected or changed):\n - '+[...al.problems,...(al.entry&&al.entry.organisationId!==org?['--organisation-id is not the allow-listed organisation']:[])].join('\n - '));return 2;}
 if(out&&existsSync(out)){console.error('Refusing to overwrite '+out);return 2;}
 if(apply&&(!arg('--ledger')||existsSync(arg('--ledger')))){console.error('apply needs --ledger <a file that does not exist yet>');return 2;}
 const deadline=arg('--deadline-ms');if(deadline!==undefined){const d=Number(deadline);if(!Number.isInteger(d)||d<=Date.now()){console.error('Refusing: --deadline-ms must be a future epoch.');return 2;}mutationGate.deadline=d;}
 const db=await connect();
 try{
  const plan=await buildResetPlan(db,org,al.entry.adminEmail);
  if(out)writeFileSync(out,JSON.stringify(plan,null,1),{mode:0o600,flag:'wx'});
  if(!apply){console.log(JSON.stringify(plan,null,1));console.log('Nothing was changed. planHash='+plan.planHash);return 0;}
  const problems=[];
  if(arg('--plan-hash')!==plan.planHash)problems.push('the plan hash does not match a fresh plan (the data changed, or the wrong hash)');
  if(arg('--confirm')!==mark(org,plan.planHash))problems.push('--confirm must be exactly: '+mark(org,plan.planHash));
  const evFile=arg('--backup-evidence');
  if(!evFile)problems.push('--backup-evidence is required');
  else problems.push(...evaluateBackupEvidence(evFile,al.entry,await databaseFingerprint(db)).problems);
  if(problems.length){console.error('Refused (nothing was changed):\n - '+problems.join('\n - '));return 2;}
  const r=await applyReset(db,org,plan,{ledger:arg('--ledger')});
  console.log(`Reset committed: ${r.removedRows} row(s) deleted across ${plan.deletedTableCount} table(s); every other row unchanged (verified before commit).`);
  console.log('Post-reset fingerprint (for the next backup evidence): '+await databaseFingerprint(db));
  return 0;
 }catch(e){console.error('Reset failed, rolled back where applicable: '+String(e.message).split('\n')[0]);return 1;}
 finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
