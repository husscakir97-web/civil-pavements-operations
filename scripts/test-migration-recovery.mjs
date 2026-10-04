// Interrupted-migration recovery for migration 0024's ALTER TABLE ... MODIFY.
// Uses disposable databases derived from a database name ending in _test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,admin=await connect(),created=[];
const NAME='0024_workshop_service_due.sql',STEP=2;
const migrate=(database,{kill}={})=>{const child=spawn(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MYSQL_DATABASE:database},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const done=new Promise(resolve=>child.on('exit',code=>resolve({code,log})));return {child,done,get log(){return log;}};};
const run=async database=>(await migrate(database).done);
const open=async name=>{await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created.push(name);process.env.MYSQL_DATABASE=name;const db=await connect();process.env.MYSQL_DATABASE=base;return db;};
const column=async db=>(await db.execute("SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='asset_meter_readings' AND COLUMN_NAME='next_service'"))[0][0];
const tableExists=async(db,t)=>(await db.execute('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]))[0].length>0;
const steps=async db=>(await db.execute('SELECT step,complete FROM app_migration_steps WHERE name=? ORDER BY step',[NAME]))[0].map(r=>[r.step,Number(r.complete)]);
const applied=async db=>(await db.execute('SELECT 1 FROM app_migrations WHERE name=?',[NAME]))[0].length>0;
// Rewind a fully migrated database to the state just before 0024 started, with real data in the column.
async function prepare(name){
 const db=await open(name);process.env.MYSQL_DATABASE=name;const first=await run(name);process.env.MYSQL_DATABASE=base;assert.equal(first.code,0,first.log);
 await db.query('ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NOT NULL');
 await db.query('DROP TABLE `asset_service_events`');await db.query('ALTER TABLE `plant` DROP COLUMN `next_service_date`');await db.query('ALTER TABLE `organisation_profiles` DROP COLUMN `timezone`');
 await db.query('DELETE FROM app_migrations WHERE name=?',[NAME]);await db.query('DELETE FROM app_migration_steps WHERE name=?',[NAME]);
 await db.query("INSERT INTO asset_meter_readings(id,organisation_id,asset_id,meter_type,reading,next_service,note,actor_id,created_at) VALUES ('r1','org','asset','hours',100.25,350.5,'kept','u','2026-01-01T00:00:00Z')");
 return db;
}
// State of an interrupted run: steps before `step` complete, `step` has its intent journaled only.
async function journalUpTo(db,step){
 const crypto=await import('node:crypto'),{readFile}=await import('node:fs/promises');
 const sql=(await readFile(new URL('../migrations/mysql/'+NAME,import.meta.url),'utf8')).replaceAll('\r\n','\n'),sha=crypto.createHash('sha256').update(sql).digest('hex');
 for(let i=0;i<=step;i++)await db.query('INSERT INTO app_migration_steps(name,step,sha256,complete) VALUES (?,?,?,?)',[NAME,i,sha,i<step?1:0]);
}
const dataKept=async db=>{const [[row]]=await db.execute("SELECT reading,next_service,note FROM asset_meter_readings WHERE id='r1'");assert.deepEqual([Number(row.reading),Number(row.next_service),row.note],[100.25,350.5,'kept'],'existing meter data preserved');};
try{
 // 1. A real interruption BEFORE the DDL: a metadata lock holds the MODIFY back after its intent is journaled, then the runner is killed.
 {const db=await prepare(base+'_rec1_test');const blocker=await (async()=>{process.env.MYSQL_DATABASE=base+'_rec1_test';const c=await connect();process.env.MYSQL_DATABASE=base;return c;})();
  await blocker.query('START TRANSACTION');await blocker.query('SELECT COUNT(*) FROM asset_meter_readings');
  process.env.MYSQL_DATABASE=base;const run1=migrate(base+'_rec1_test');
  for(let i=0;i<200;i++){const [r]=await db.execute('SELECT 1 FROM app_migration_steps WHERE name=? AND step=?',[NAME,STEP]);if(r.length)break;await new Promise(r=>setTimeout(r,100));}
  await new Promise(r=>setTimeout(r,500));
  const [pl]=await admin.query("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE 'ALTER TABLE `asset_meter_readings` MODIFY%'",[base+'_rec1_test']);
  assert.equal(pl.length,1,'the MODIFY is waiting on the metadata lock');
  run1.child.kill('SIGKILL');await run1.done;await admin.query('KILL '+Number(pl[0].ID));
  await blocker.query('ROLLBACK');await blocker.end();await new Promise(r=>setTimeout(r,500));
  assert.deepEqual(await steps(db),[[0,1],[1,1],[2,0]],'intent journaled, step incomplete');
  assert.equal((await column(db)).IS_NULLABLE,'NO','DDL did not run');assert.equal(await applied(db),false);
  const r2=await run(base+'_rec1_test');assert.equal(r2.code,0,r2.log);assert(!r2.log.includes('Recovered'),'before the DDL: it is run, not skipped');
  assert.equal((await column(db)).IS_NULLABLE,'YES');assert.deepEqual(await steps(db),[[0,1],[1,1],[2,1],[3,1],[4,1],[5,1]]);assert.equal(await applied(db),true);await dataKept(db);
  const r3=await run(base+'_rec1_test');assert.equal(r3.code,0,r3.log);assert(!r3.log.includes('Applied'),'a repeated restart does nothing');await dataKept(db);await db.end();
  console.log('PASS interruption before the DDL: killed while the MODIFY waited, restart reruns it, data kept, repeat restart is a no-op');}
 // 2. Interruption AFTER the DDL, before the step is marked complete.
 {const db=await prepare(base+'_rec2_test');await journalUpTo(db,STEP);
  await db.query('ALTER TABLE `plant` ADD `next_service_date` varchar(10)').catch(()=>{});
  // steps 0 and 1 are recorded complete, so their effects must exist; step 2's DDL has run:
  await db.query('ALTER TABLE `organisation_profiles` ADD `timezone` varchar(80)').catch(()=>{});
  await db.query('ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NULL');
  assert.deepEqual(await steps(db),[[0,1],[1,1],[2,0]]);
  for(let restart=1;restart<=3;restart++){const r=await run(base+'_rec2_test');assert.equal(r.code,0,r.log);
   if(restart===1){assert(r.log.includes(`Recovered ${NAME} step ${STEP}`),'after the DDL: marked complete without re-running it');assert.equal(await applied(db),true);}
   else assert(!r.log.includes('Recovered')&&!r.log.includes('Applied'),'repeated restarts do nothing');
   assert.deepEqual(await steps(db),[[0,1],[1,1],[2,1],[3,1],[4,1],[5,1]]);assert.equal((await column(db)).IS_NULLABLE,'YES');assert(await tableExists(db,'asset_service_events'));await dataKept(db);}
  await db.end();console.log('PASS interruption after the DDL: restart marks the step complete without re-running it, three restarts stable, data kept');}
 // 3. Unexpected schema is refused with nothing changed.
 for(const [label,ddl,expect] of [
  ['wrong type','ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(10,2) NOT NULL','decimal(10,2) NOT NULL'],
  ['unexpected default',"ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NOT NULL DEFAULT 0",'default or extra'],
  ['comment on the original definition',"ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NOT NULL COMMENT 'finance review'",'column comment'],
  ['comment on the target definition',"ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NULL COMMENT 'finance review'",'column comment'],
  ['wrong type and nullability','ALTER TABLE `asset_meter_readings` MODIFY `next_service` varchar(20) NULL','varchar(20) NULL'],
 ]){
  const db=await prepare(base+'_rec3_test');await db.query('DELETE FROM asset_meter_readings');await db.query(ddl);await journalUpTo(db,STEP);
  const before=await column(db),r=await run(base+'_rec3_test');
  assert.notEqual(r.code,0,label);assert(/Unexpected schema for asset_meter_readings\.next_service/.test(r.log)&&r.log.includes(expect),r.log);assert(r.log.includes('nothing was changed'));
  assert.deepEqual(await column(db),before,label+': schema untouched');assert.deepEqual(await steps(db),[[0,1],[1,1],[2,0]],label+': not marked complete');assert.equal(await applied(db),false);
  const again=await run(base+'_rec3_test');assert.notEqual(again.code,0,label+': still refused on restart');await db.end();
 }
 // Missing column, and an unjournaled run on a database that already differs, also fail closed.
 {const db=await prepare(base+'_rec3_test');await db.query('ALTER TABLE `asset_meter_readings` DROP COLUMN `next_service`');await journalUpTo(db,STEP);
  const r=await run(base+'_rec3_test');assert.notEqual(r.code,0);assert(r.log.includes('column not found'),r.log);assert.equal(await applied(db),false);await db.end();}
 {const db=await prepare(base+'_rec3_test');await db.query('ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NULL');
  await db.query('DELETE FROM app_migration_steps WHERE name=?',[NAME]);await db.query('ALTER TABLE `plant` ADD `next_service_date` varchar(10)').catch(()=>{});
  const r=await run(base+'_rec3_test');assert.notEqual(r.code,0);assert(/Untracked database object/.test(r.log),r.log);await db.end();}
 // A changed migration file is still caught by the checksum, and the recovery path never bypasses it.
 {const db=await prepare(base+'_rec3_test');await journalUpTo(db,STEP);await db.query("UPDATE app_migration_steps SET sha256=REPEAT('0',64) WHERE name=? AND step=?",[NAME,STEP]);
  const r=await run(base+'_rec3_test');assert.notEqual(r.code,0);assert(r.log.includes('Migration checksum changed'),r.log);assert.equal((await column(db)).IS_NULLABLE,'NO');await db.end();}
 console.log('PASS unexpected schema refused (wrong type, unexpected default, comment on the original or target definition, wrong type+nullability, missing column, untracked) with the database untouched; checksum still enforced');
 // The recovery check only claims the statement it knows.
 {const {modifyColumnState,parseModify}=await import('./migrate-recovery.mjs');
  assert.equal(await modifyColumnState(admin,'ALTER TABLE `dockets` MODIFY COLUMN `organisation_id` varchar(191) NOT NULL;'),null);
  assert.equal(await modifyColumnState(admin,'ALTER TABLE `asset_meter_readings` MODIFY `next_service` decimal(15,2) NOT NULL'),null,'only the supported target definition is recognised');
  assert.equal(parseModify('DROP TABLE x'),null);console.log('PASS recovery check is limited to the supported statement');}
}finally{for(const n of created)await admin.query('DROP DATABASE IF EXISTS '+identifier(n)).catch(()=>{});await admin.end();}

await import('./test-program-costing-migration.mjs');
await import('./test-planning-migration.mjs');
await import('./test-programme-costing-containment.mjs');
