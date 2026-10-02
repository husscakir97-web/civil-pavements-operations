// DATA-CHANGING EMERGENCY PROCEDURE (not a lossless rollback). Maintenance procedure for rolling the app back to a build that predates programme costing (previous main, b8a75ae).
// That build returns `SELECT * FROM program_activities` without financial redaction, so once migration 0025 columns hold rates
// it would show them to project readers who may not see money. This tool blocks that access and removes the exposure BEFORE
// the old build serves traffic, and only restores access when told to. It never deploys and never touches other tables.
//
//   node scripts/programme-costing-containment.mjs status
//   node scripts/programme-costing-containment.mjs contain --state /secure/path/containment.json --backup-file /secure/path/verified-backup.sql --approved-by "Name, role" --confirm
//   node scripts/programme-costing-containment.mjs release --state /secure/path/containment.json --confirm
//
// contain: (1) records each organisation's current `projects` entitlement in the state file, (2) disables it (programme routes
// then answer 404), (3) clears direct_cost_rate and the estimate-item references, (4) verifies nothing financial remains and
// exits non-zero otherwise. It DELETES saved rates and estimate-item links and DISABLES Projects, so live use requires a
// verified backup (--backup-file: an existing, non-empty file modified in the last 24 hours, checked by the operator as restorable)
// and the name of the person who approved the action (--approved-by). Without both it refuses and changes nothing. The cleared
// values are recoverable only from that backup.
// release: restores only the entitlements this tool changed. It does not restore rates (restore those from the backup after
// rolling FORWARD to a build with redaction).
import {existsSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {connect} from './mysql-config.mjs';

const [command,...rest]=process.argv.slice(2);
const flag=name=>rest.includes(name),value=name=>{const i=rest.indexOf(name);return i>=0?rest[i+1]:undefined;};
const exposure="direct_cost_rate IS NOT NULL OR source_estimate_revision_id IS NOT NULL OR source_estimate_item_id IS NOT NULL";
const db=await connect();
try{
 const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='program_activities' AND COLUMN_NAME IN ('direct_cost_rate','source_estimate_revision_id','source_estimate_item_id')");
 if(columns.length!==3){console.log('Migration 0025 columns are not present: nothing to contain.');process.exit(0);}
 const [[exposed]]=await db.query(`SELECT COUNT(*) AS n,COUNT(DISTINCT organisation_id) AS orgs FROM program_activities WHERE ${exposure}`);
 const [[blocked]]=await db.query("SELECT COUNT(*) AS n FROM organisation_entitlements WHERE module='projects' AND status<>'active'");
 const [[active]]=await db.query("SELECT COUNT(*) AS n FROM organisation_entitlements WHERE module='projects' AND status='active'");
 console.log(`program_activities rows holding costing values: ${exposed.n} (organisations: ${exposed.orgs}); projects entitlement active: ${active.n}, not active: ${blocked.n}`);
 if(command==='status')process.exit(0);
 const state=value('--state');
 if(!['contain','release'].includes(command)||!state)throw new Error('Usage: status | contain --state FILE --backup-file FILE --approved-by "Name, role" --confirm | release --state FILE --confirm');
 if(!flag('--confirm')){console.log('Dry run: nothing changed. Re-run with --confirm after taking a database backup.');process.exit(0);}
 if(command==='contain'){
  const backup=value('--backup-file'),approver=(value('--approved-by')||'').trim();
  if(!backup||!existsSync(backup)||statSync(backup).size===0||Date.now()-statSync(backup).mtimeMs>24*3600*1000)throw new Error('Refusing: --backup-file must name an existing, non-empty backup taken in the last 24 hours that you have verified can be restored. Nothing was changed.');
  if(approver.length<3)throw new Error('Refusing: --approved-by "Name, role" is required (explicit approval for a data-changing emergency procedure). Nothing was changed.');
  if(existsSync(state))throw new Error(`Refusing to overwrite an existing state file: ${state}`);
  const [previous]=await db.query("SELECT id,organisation_id,status FROM organisation_entitlements WHERE module='projects'");
  // Persist intent first: if anything below fails, release can still restore exactly what was changed.
  writeFileSync(state,JSON.stringify({createdAt:new Date().toISOString(),approvedBy:approver,backupFile:backup,rowsCleared:Number(exposed.n),entitlements:previous.filter(r=>r.status==='active'||r.status==='read_only')},null,1),{mode:0o600});
  await db.query("UPDATE organisation_entitlements SET status='disabled' WHERE module='projects' AND status<>'disabled'");
  await db.query(`UPDATE program_activities SET direct_cost_rate=NULL,source_estimate_revision_id=NULL,source_estimate_item_id=NULL WHERE ${exposure}`);
  const [[left]]=await db.query(`SELECT COUNT(*) AS n FROM program_activities WHERE ${exposure}`);
  const [[open]]=await db.query("SELECT COUNT(*) AS n FROM organisation_entitlements WHERE module='projects' AND status<>'disabled'");
  console.log(`Contained: projects access disabled, ${exposed.n} row(s) cleared. Remaining exposed rows: ${left.n}; organisations still able to open Projects: ${open.n}.`);
  if(Number(left.n)!==0||Number(open.n)!==0)throw new Error('Containment could not be verified: keep access blocked and investigate before serving the old build.');
 }else{
  const saved=JSON.parse(readFileSync(state,'utf8'));
  for(const e of saved.entitlements)await db.query("UPDATE organisation_entitlements SET status=? WHERE id=? AND module='projects' AND status='disabled'",[e.status,e.id]);
  console.log(`Released: restored the projects entitlement for ${saved.entitlements.length} organisation(s). Rates were not restored.`);
 }
}finally{await db.end();}
