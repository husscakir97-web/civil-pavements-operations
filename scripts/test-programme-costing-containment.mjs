// Real-database test of scripts/programme-costing-containment.mjs. Executed by the migration-recovery gate.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,name=base+'_contain_'+randomUUID().slice(0,8)+'_test';
const admin=await connect();let db,created=false;const dir=mkdtempSync(join(tmpdir(),'contain-'));
const run=(script,args=[])=>spawnSync(process.execPath,[script,...args],{env:{...process.env,MYSQL_DATABASE:name},encoding:'utf8',timeout:180000});
const tool=(...args)=>run('scripts/programme-costing-containment.mjs',args);
try{
 await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created=true;
 const m=run('scripts/migrate.mjs');assert.equal(m.status,0,m.stdout+m.stderr);
 process.env.MYSQL_DATABASE=name;try{db=await connect();}finally{process.env.MYSQL_DATABASE=base;}
 const ts='2026-01-01T00:00:00.000Z';
 for(const [org,status] of [['org-a','active'],['org-b','read_only'],['org-c','disabled']])await db.query("INSERT INTO organisation_entitlements(id,organisation_id,module,status,source,plan_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",[`ent-${org}`,org,'projects',status,'test','test',ts,ts]);
 const act=(id,org,rate,item)=>db.query("INSERT INTO program_activities(id,organisation_id,project_id,name,start_date,duration_days,status,revision,created_at,updated_at,productive_hours_per_day,direct_cost_rate,source_estimate_revision_id,source_estimate_item_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[id,org,'p','Activity '+id,'2026-01-05',2,'planned',1,ts,ts,8,rate,item?'rev':null,item]);
 await act('a1','org-a',95,'item-1');await act('a2','org-a',0,null);await act('a3','org-b',null,null);
 const status=tool('status');assert.equal(status.status,0,status.stderr);assert.match(status.stdout,/holding costing values: 2/);
 const state=join(dir,'state.json');
 const dry=tool('contain','--state',state);assert.equal(dry.status,0);assert.match(dry.stdout,/Dry run/);assert(!existsSync(state));
 const [[stillExposed]]=await db.query('SELECT COUNT(*) AS n FROM program_activities WHERE direct_cost_rate IS NOT NULL');assert.equal(Number(stillExposed.n),2,'a dry run changes nothing');
 const backup=join(dir,'backup.sql'),approval=['--approved-by','Test Operator, DBA'];
 // Without a verified recent backup and a named approver the procedure refuses and changes nothing.
 for(const [label,args] of [['no backup',[...approval]],['missing backup file',['--backup-file',join(dir,'nope.sql'),...approval]],['no approver',['--backup-file',backup]]]){
  writeFileSync(backup,'-- synthetic backup');
  const refused=tool('contain','--state',state,...args,'--confirm');assert.equal(refused.status,1,label);assert.match(refused.stderr,/Refusing/,label);
 }
 writeFileSync(backup,'');assert.equal(tool('contain','--state',state,'--backup-file',backup,...approval,'--confirm').status,1,'an empty backup is refused');
 writeFileSync(backup,'-- synthetic backup');const old=new Date(Date.now()-48*3600*1000);utimesSync(backup,old,old);assert.equal(tool('contain','--state',state,'--backup-file',backup,...approval,'--confirm').status,1,'a stale backup is refused');
 writeFileSync(backup,'-- synthetic backup');
 const [[untouched]]=await db.query('SELECT COUNT(*) AS n FROM program_activities WHERE direct_cost_rate IS NOT NULL');assert.equal(Number(untouched.n),2,'every refusal left the data untouched');assert(!existsSync(state));
 const done=tool('contain','--state',state,'--backup-file',backup,...approval,'--confirm');assert.equal(done.status,0,done.stdout+done.stderr);assert.match(done.stdout,/Remaining exposed rows: 0; organisations still able to open Projects: 0/);
 const [rows]=await db.query('SELECT id,direct_cost_rate,source_estimate_revision_id,source_estimate_item_id,productive_hours_per_day,name FROM program_activities ORDER BY id');
 assert(rows.every(r=>r.direct_cost_rate===null&&r.source_estimate_revision_id===null&&r.source_estimate_item_id===null),'no financial value remains');
 assert(rows.every(r=>Number(r.productive_hours_per_day)===8&&r.name.startsWith('Activity')),'non-financial programme data is untouched');
 const [ents]=await db.query("SELECT organisation_id,status FROM organisation_entitlements WHERE module='projects' ORDER BY organisation_id");assert(ents.every(e=>e.status==='disabled'),'projects access blocked for every organisation');
 assert.equal(tool('contain','--state',state,'--backup-file',backup,...approval,'--confirm').status,1,'refuses to overwrite an existing state file (the original statuses must survive a second run)');
 const saved=JSON.parse(readFileSync(state,'utf8'));assert.deepEqual(saved.entitlements.map(e=>[e.organisation_id,e.status]).sort(),[['org-a','active'],['org-b','read_only']]);assert.equal(saved.approvedBy,'Test Operator, DBA');assert.equal(saved.backupFile,backup);
 const rel=tool('release','--state',state,'--confirm');assert.equal(rel.status,0,rel.stderr);
 const [after]=await db.query("SELECT organisation_id,status FROM organisation_entitlements WHERE module='projects' ORDER BY organisation_id");
 assert.deepEqual(after.map(e=>[e.organisation_id,e.status]),[['org-a','active'],['org-b','read_only'],['org-c','disabled']],'only entitlements the tool changed are restored; an already-disabled organisation stays disabled');
 const [[noRates]]=await db.query('SELECT COUNT(*) AS n FROM program_activities WHERE direct_cost_rate IS NOT NULL');assert.equal(Number(noRates.n),0,'release does not bring rates back');
 console.log('PASS programme costing containment: refuses without a recent verified backup and a named approver, dry run is inert, access blocked and rates cleared with verification, state file protected, release restores only what it changed');
}finally{await db?.end().catch(()=>{});if(created)await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();rmSync(dir,{recursive:true,force:true});}
