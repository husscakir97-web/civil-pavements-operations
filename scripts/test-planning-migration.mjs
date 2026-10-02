// Real runner coverage for 0026 (Planning v0.1). Executed by the existing MySQL migration-recovery CI gate.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,name=base+'_plan_'+randomUUID().slice(0,8)+'_test';
const admin=await connect();let db,created=false;
const migration='0026_planning_v0_1.sql';
const tables=['planning_plans','planning_scenarios','planning_activities','planning_dependencies','planning_requirements','planning_cost_items','planning_cost_links','planning_canvas_positions'];
const run=()=>{const r=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MYSQL_DATABASE:name},encoding:'utf8',timeout:180000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr+'\n'+String(r.error||''));return r.stdout;};
try{
 await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created=true;
 assert(run().includes('Applied '+migration),'fresh install applies 0026');
 process.env.MYSQL_DATABASE=name;try{db=await connect();}finally{process.env.MYSQL_DATABASE=base;}
 const present=async()=>(await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'planning\\_%'"))[0].map(r=>r.TABLE_NAME).sort();
 assert.deepEqual(await present(),[...tables].sort());
 // every planning table carries organisation_id and an index that leads with it
 for(const t of tables){
  const [[c]]=await db.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='organisation_id' AND IS_NULLABLE='NO'",[t]);assert.equal(Number(c.n),1,t+' organisation_id');
  const [[i]]=await db.query("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='organisation_id' AND SEQ_IN_INDEX=1",[t]);assert(Number(i.n)>=1,t+' organisation_id index');
 }
 // money and quantity columns are nullable decimals: unknown is NULL, never a default of zero
 const [cols]=await db.query("SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='planning_requirements' AND COLUMN_NAME IN ('quantity','rate')) OR (TABLE_NAME='planning_cost_items' AND COLUMN_NAME='amount') OR (TABLE_NAME='planning_activities' AND COLUMN_NAME IN ('quantity','productivity','duration_days','hours_per_day')))");
 assert.equal(cols.length,7);for(const c of cols){assert.equal(c.IS_NULLABLE,'YES',c.TABLE_NAME+'.'+c.COLUMN_NAME);assert([null,'NULL'].includes(c.COLUMN_DEFAULT),c.TABLE_NAME+'.'+c.COLUMN_NAME+' has no default');}
 // the pair/position uniqueness the service relies on
 await db.query("INSERT INTO planning_canvas_positions(id,organisation_id,scenario_id,activity_id,x,y) VALUES ('p1','o','s','a',1,2)");
 await assert.rejects(db.query("INSERT INTO planning_canvas_positions(id,organisation_id,scenario_id,activity_id,x,y) VALUES ('p2','o','s','a',3,4)"),/Duplicate/);
 // existing 0025 data survives; rewinding only 0026 then re-running recreates it (idempotent restart)
 const [[before]]=await db.query("SELECT COUNT(*) AS n FROM app_migrations WHERE name<'0026'");
 for(const t of tables)await db.query('DROP TABLE '+identifier(t));
 await db.query('DELETE FROM app_migration_steps WHERE name=?',[migration]);await db.query('DELETE FROM app_migrations WHERE name=?',[migration]);
 assert(run().includes('Applied '+migration),'upgrade from 0025 applies 0026');
 assert.deepEqual(await present(),[...tables].sort());
 const [[after]]=await db.query("SELECT COUNT(*) AS n FROM app_migrations WHERE name<'0026'");assert.equal(Number(after.n),Number(before.n));
 assert(!run().includes('Applied '+migration),'restart does not reapply');
 const [steps]=await db.query('SELECT complete FROM app_migration_steps WHERE name=?',[migration]);assert(steps.length>=8&&steps.every(s=>Number(s.complete)===1));
 console.log('PASS planning 0026 real migration runner: fresh install, upgrade from 0025, organisation_id + index on all eight tables, unknown stays NULL, idempotent restart');
}finally{await db?.end().catch(()=>{});if(created)await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();}
