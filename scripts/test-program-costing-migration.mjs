// Real runner coverage for 0025. Executed by the existing MySQL migration-recovery CI gate.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,name=base+'_pcost_'+randomUUID().slice(0,8)+'_test';
const admin=await connect();let db,created=false;
const migration='0025_program_activity_costing.sql';
const columns=['productive_hours_per_day','direct_cost_rate','cost_rate_basis','source_estimate_revision_id','source_estimate_item_id'];
const run=()=>{const r=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MYSQL_DATABASE:name},encoding:'utf8',timeout:180000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr+'\n'+String(r.error||''));return r.stdout;};
try{
 await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');created=true;
 // Fresh install: runner discovers 0025 even though the historical Drizzle journal stops at 0017.
 assert(run().includes('Applied '+migration));
 process.env.MYSQL_DATABASE=name;try{db=await connect();}finally{process.env.MYSQL_DATABASE=base;}
 const [fresh]=await db.query('SELECT name FROM app_migrations WHERE name=?',[migration]);assert.equal(fresh.length,1);
 const [schema]=await db.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN (?)',['program_activities',columns]);assert.equal(schema.length,5);
 assert.equal(schema.find(c=>c.COLUMN_NAME==='productive_hours_per_day').COLUMN_TYPE,'decimal(6,2)');
 assert.equal(schema.find(c=>c.COLUMN_NAME==='direct_cost_rate').COLUMN_TYPE,'decimal(15,2)');
 assert.equal(String(schema.find(c=>c.COLUMN_NAME==='cost_rate_basis').COLUMN_DEFAULT).replace(/^'|'$/g,''),'hour'); // MariaDB reports the literal quoted, MySQL 8 does not
 assert.equal(schema.find(c=>c.COLUMN_NAME==='cost_rate_basis').IS_NULLABLE,'NO');
 for(const c of schema.filter(c=>c.COLUMN_NAME!=='cost_rate_basis'))assert.equal(c.IS_NULLABLE,'YES');
 // Rewind only this disposable fixture's five additions to an existing 0024 database.
 for(const column of columns)await db.query('ALTER TABLE program_activities DROP COLUMN '+identifier(column));
 await db.query('DELETE FROM app_migration_steps WHERE name=?',[migration]);await db.query('DELETE FROM app_migrations WHERE name=?',[migration]);
 const [[last]]=await db.query('SELECT MAX(name) AS name FROM app_migrations');assert.equal(last.name,'0024_workshop_service_due.sql');
 await db.query("INSERT INTO program_activities(id,organisation_id,project_id,name,start_date,duration_days,planned_quantity,quantity_unit,production_per_day,status,revision,created_at,updated_at) VALUES ('kept','synthetic','synthetic','Keep this activity','2026-10-03',3,125.25,'t',0,'planned',7,'2026-10-02','2026-10-02')");
 assert(run().includes('Applied '+migration));
 const [[row]]=await db.query("SELECT * FROM program_activities WHERE id='kept'");assert.equal(row.name,'Keep this activity');assert.equal(row.planned_quantity,125.25);assert.equal(row.production_per_day,0);assert.equal(row.revision,7);assert.equal(row.duration_days,3);
 assert.equal(row.cost_rate_basis,'hour');for(const c of columns.filter(c=>c!=='cost_rate_basis'))assert.equal(row[c],null);
 // Persist null/zero/reference assumptions, then prove runner restarts do not rewrite them.
 await db.query("UPDATE program_activities SET productive_hours_per_day=8,direct_cost_rate=0,source_estimate_revision_id='approved',source_estimate_item_id='item' WHERE id='kept'");
 const [[before]]=await db.query("SELECT * FROM program_activities WHERE id='kept'");assert(!run().includes('Applied '+migration));const [[after]]=await db.query("SELECT * FROM program_activities WHERE id='kept'");assert.deepEqual(after,before);
 const [steps]=await db.query('SELECT complete FROM app_migration_steps WHERE name=?',[migration]);assert.equal(steps.length,5);assert(steps.every(s=>Number(s.complete)===1));
 console.log('PASS programme 0025 real migration runner: fresh install, existing 0024 upgrade with data preserved, five journaled additions, idempotent restart');
}finally{process.env.MYSQL_DATABASE=base;if(db)await db.end();if(created)await admin.query('DROP DATABASE '+identifier(name));await admin.end();}
