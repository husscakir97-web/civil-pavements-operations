// ONE-OFF, owner-requested: replace all operational data of ONE tenant before the full fictional demo is imported. NOT a reusable feature:
// delete this file (and the two `reset*` branches in scripts/existing-tenant-load.mjs) after the demo is loaded.
//
//   plan   (changes no data, but MAINTENANCE-REQUIRED when run through the loader: it freezes writes and terminates leftover database sessions, see below):  node scripts/demo/one-off-reset-tenant.mjs --organisation-id <id> --existing-tenant-allowlist <file> [--out plan.json]
//   apply:               ... --apply --plan-hash <hash> --backup-evidence <file> --confirm "RESET-OPERATIONAL-DATA <id> <hash>" --ledger <new file>
//
// REQUIRED OUTCOME: keep only the owner's login and the records genuinely required for its access; replace everything else of THIS tenant.
// Kept (see `preservedRecords` in the plan, each with its reason): the tenant's `organisations` row, the allow-listed admin's `users` membership,
// `organisation_profiles` (the workspace API reads the onboarding state and company name from it) and `organisation_entitlements` (module access).
// Never touched: shared identities (auth_user, auth_account, auth_session, auth_verification) and every other tenant. Deleted: every other row of this tenant,
// including its other `users` memberships (their shared login remains but has no membership here), invitations, audit trail, domain events,
// migration bookkeeping and notification preferences. Billing and AI-spend ledger rows are financial/external records: if this tenant has any, the run REFUSES
// (billing is meant to be unconnected); they are never deleted by this script.
// NOT read-only in the operational sense: the loader's reset-plan and reset modes both run quiescence (KILL of any ACTIVE session of the database user in this
// database; idle sessions are left alone) and refuse unless the maintenance freeze is in force. Run them only inside the freeze window.
// An existing import baseline in the state directory is never moved or deleted by this tooling: the reset refuses until the operator decides what to do with it.
// Mechanics: rows WHERE organisation_id=<id> in the DELETE tables below, in one InnoDB transaction. Fail-closed: every table carrying organisation_id must be
// classified here, or the run refuses. The same exact-target allow-list, backup evidence (fresh, restore-attested, fingerprint == current
// state) and plan-hash binding as the additive import apply. Before COMMIT a full before/after snapshot proves: nothing changed, nothing
// was added, exactly the planned rows were removed (none in any other tenant or shared identity table), and none remain for this tenant; any surprise rolls back.
// The ledger lists every deleted key. Files/objects referenced by deleted attachment/document rows live in object storage and are NOT touched.
import {createHash} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
import {connect,identifier} from '../mysql-config.mjs';
import {evaluateExistingTenantAllowlist,evaluateBackupEvidence,databaseFingerprint} from './existing-tenant.mjs';
import {snapshot,compare,rowsGained,schemaShape,mutationGate,assertBeforeDeadline} from './import-guards.mjs';
import {pathToFileURL} from 'node:url';

// `users` is special: only the allow-listed admin's row is kept; the tenant's other memberships are deleted (their auth_* login is never touched).
export const PRESERVE_ORG_TABLES=['organisation_entitlements','organisation_profiles','users'];
// Financial / external-provider records: never deleted here; the run refuses if the tenant has any.
export const REFUSE_IF_PRESENT_TABLES=['ai_usage_ledger','billing_customers','billing_events','billing_subscriptions'];
export const DELETE_TABLES=['ai_suggestions','app_backfills','asset_meter_readings','asset_service_events','attachments','audit_events','audit_log','business_units','claim_items','claim_lines','claims',
 'client_contacts','client_invoices','client_requests','client_sites','clients','commercial_records','communication_messages','communication_receipts',
 'communication_threads','cost_codes','cost_transactions','crews','data_migration_issues','depots','dockets','document_links','document_versions','documents','domain_events','estimate_revisions',
 'estimates','external_access_tokens','external_responses','extraction_profiles','field_history','field_records','form_submission_amendments','form_submissions',
 'form_template_versions','form_templates','hseq_action_reviews','hseq_actions','hseq_incidents','hseq_investigations','hseq_ncrs','ims_document_revisions',
 'ims_documents','itp_items','itps','job_ims_items','jobs','knowledge_packs','knowledge_rules','knowledge_sources','library_items','locations','managed_documents',
 'notification_preferences','notifications','opportunities','organisation_invitations','planning_activities','planning_canvas_positions','planning_cost_items','planning_cost_links','planning_dependencies',
 'planning_plans','planning_requirements','planning_scenarios','plant','preparation_revisions','program_activities','progress_claims','project_baselines',
 'project_checklist_items','project_contacts','project_cost_codes','project_members','project_variations','project_work_areas','project_work_points',
 'qa_safety_records','quote_revisions','rate_libraries','risks','shift_assignments','shift_requirements','shift_work_areas','shifts','subcontractors','suppliers',
 'swms','swms_acknowledgements','swms_revisions','tender_bid_reviews','tender_clarifications','tender_requirements','tender_returnables','tenders','variations',
 'work_packages','worker_competencies','workers','workflow_tasks','workshop_entries','workshop_orders'];
const SHARED_IDENTITY_TABLES=['auth_user','auth_account'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const mark=(org,hash)=>`RESET-OPERATIONAL-DATA ${org} ${hash}`;
export const confirmText=mark;

async function classify(db){
 const [rows]=await db.query("SELECT DISTINCT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='organisation_id' ORDER BY 1");
 const present=rows.map(r=>r.t),known=new Set([...DELETE_TABLES,...PRESERVE_ORG_TABLES,...REFUSE_IF_PRESENT_TABLES]);
 const unclassified=present.filter(t=>!known.has(t)),missing=[...DELETE_TABLES,...PRESERVE_ORG_TABLES,...REFUSE_IF_PRESENT_TABLES].filter(t=>!present.includes(t));
 if(unclassified.length)throw new Error('Refusing: table(s) with organisation_id are not classified for this one-off reset: '+unclassified.join(', '));
 if(missing.length)throw new Error('Refusing: the schema differs from the reviewed one (missing table(s): '+missing.join(', ')+').');
}

/** Read-only. Counts what would be deleted, and states exactly what is preserved and why. */
export async function buildResetPlan(db,org,adminEmail){
 await classify(db);
 const [[o]]=await db.query('SELECT id,name FROM organisations WHERE id=?',[org]);
 if(!o)throw new Error('Refusing: the organisation does not exist.');
 const [members]=await db.query("SELECT id,email,role,active FROM users WHERE organisation_id=? ORDER BY id",[org]);
 const admin=members.find(u=>String(u.email).toLowerCase()===String(adminEmail).toLowerCase()&&u.role==='admin'&&Number(u.active)===1);
 if(!admin)throw new Error('Refusing: the allow-listed administrator is not an active admin member of this organisation.');
 const [[au]]=await db.query('SELECT id FROM auth_user WHERE email=?',[adminEmail]);
 if(!au)throw new Error('Refusing: the allow-listed administrator has no login (auth_user).');
 for(const t of REFUSE_IF_PRESENT_TABLES){const [[a]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);if(Number(a.n))throw new Error(`Refusing: this tenant has ${a.n} row(s) in ${t} (financial / external-provider records are never deleted by this one-off reset). Decide separately.`);}
 const [logins]=await db.query('SELECT LOWER(email) e FROM auth_user');const hasLogin=new Set(logins.map(r=>r.e));
 const others=members.filter(u=>u.id!==admin.id).map(u=>({id:u.id,email:u.email,role:u.role,active:Number(u.active),hasLogin:hasLogin.has(String(u.email).toLowerCase())}));
 const deleteCounts={},otherTenantRows={};let total=0;
 for(const t of DELETE_TABLES){
  const [[a]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);const [[b]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id<>?`,[org]);
  deleteCounts[t]=Number(a.n);otherTenantRows[t]=Number(b.n);total+=Number(a.n);
 }
 const cnt=async(t)=>Number((await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]))[0][0].n);
 const shared={};for(const t of [...SHARED_IDENTITY_TABLES,'auth_session'])shared[t]=Number((await db.query(`SELECT COUNT(*) n FROM ${identifier(t)}`))[0][0].n);
 const preservedRecords=[
  {record:'organisations row (this tenant)',rows:1,why:'the tenant itself; every membership, profile and entitlement points to it'},
  {record:'users: the allow-listed admin membership',rows:1,why:'resolves the owner\'s role and tenant on every request'},
  {record:'organisation_profiles',rows:await cnt('organisation_profiles'),why:'the workspace API reads the onboarding state and company details from it; without it the owner is sent back through onboarding'},
  {record:'organisation_entitlements',rows:await cnt('organisation_entitlements'),why:'module access: a module that is not entitled returns 404'},
  {record:'auth_user / auth_account / auth_session (shared identities, all people)',rows:shared,why:'shared identities are never touched by this script, including the logins of the memberships that are deleted'}];
 const body={tool:'one-off-reset-tenant',organisation:{id:o.id,name:o.name},adminLogin:{email:adminEmail,userId:admin.id,authUserId:au.id},
  preservedRecords,deletedMembers:others,deletedMembersWithLogin:others.filter(u=>u.hasLogin).length,
  requestedOutcomeDifference:'None: only the owner login and the records required for its access are preserved (see preservedRecords). Other memberships of this tenant, invitations, audit trail, domain events and migration bookkeeping are deleted; shared identities (auth_*) and every other tenant are untouched.',
  deletedRowCounts:Object.fromEntries(Object.entries(deleteCounts).filter(([,n])=>n)),deletedTableCount:Object.values(deleteCounts).filter(Boolean).length+(others.length?1:0),deletedRowTotal:total+others.length,
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
 if(plan.deletedMembers.length)led.tables.users_other_members={key:['id'],rows:plan.deletedMembers.map(u=>u.id)};
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
  const mr=await db.query('DELETE FROM users WHERE organisation_id=? AND id<>?',[org,plan.adminLogin.userId]);
  if(mr[0].affectedRows!==plan.deletedMembers.length)throw new Error(`users: deleted ${mr[0].affectedRows} other member(s), the reviewed plan said ${plan.deletedMembers.length}`);
  deleted.users=mr[0].affectedRows;
  const after=await snapshot(db,before.salt);   // same salt: row digests are only comparable under one salt
  const cmp=compare(before,after),gained=Object.values(rowsGained(before,after)).reduce((a,b)=>a+b,0);
  if(cmp.changedRows)throw new Error('rows changed unexpectedly: '+cmp.changed.join('; '));
  if(gained)throw new Error(gained+' row(s) appeared unexpectedly');
  for(const t of Object.keys(before.tables)){
   const expected=DELETE_TABLES.includes(t)?(plan.deletedRowCounts[t]||0):t==='users'?plan.deletedMembers.length:0;
   const removed=before.tables[t].n-after.tables[t].n;
   if(removed!==expected)throw new Error(`${t}: removed ${removed} row(s), expected ${expected}`);
  }
  for(const t of DELETE_TABLES){const [[r]]=await db.query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[org]);if(Number(r.n))throw new Error(t+' still has rows for this tenant');}
  const [left]=await db.query('SELECT id FROM users WHERE organisation_id=?',[org]);
  if(left.length!==1||left[0].id!==plan.adminLogin.userId)throw new Error('the allow-listed admin must be the only remaining member of this tenant');
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
  if(!apply){console.log(JSON.stringify(plan,null,1));console.log('DIFFERENCE FROM THE REQUESTED OUTCOME: '+plan.requestedOutcomeDifference);console.log('No data was changed. This run is maintenance-required (write freeze in force; leftover active database sessions of this user are terminated by quiescence); it is not a read-only step to run against a live app. planHash='+plan.planHash);return 0;}
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
