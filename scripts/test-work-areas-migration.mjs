// Real runner coverage for 0027 (project work areas). Executed by the existing MySQL migration-recovery gate.
// "Current main" is every migration except 0027 (main ends at 0026): it is applied first, seeded, then the real runner upgrades it.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,suffix=randomUUID().slice(0,8),names={fresh:`${base}_wa_f${suffix}_test`,upgrade:`${base}_wa_u${suffix}_test`,crash:`${base}_wa_c${suffix}_test`};
const admin=await connect(),opened=[],dbs=[];
const NAME='0027_project_work_areas.sql';
const files=readdirSync('migrations/mysql').filter(f=>f.endsWith('.sql')).sort();
assert(files.includes(NAME),'0027 exists');assert.equal(files.at(-1),NAME,'0027 is the newest migration');
// A copy of the runner pointed at the pre-0027 migration set (what main has today).
const old=mkdtempSync(join(tmpdir(),'wa-main-'));mkdirSync(join(old,'migrations'));cpSync('scripts',join(old,'scripts'),{recursive:true});cpSync('migrations/mysql',join(old,'migrations/mysql'),{recursive:true});
rmSync(join(old,'migrations/mysql',NAME));for(const d of ['node_modules','lib','db'])symlinkSync(join(process.cwd(),d),join(old,d));// the backfills read shared lib files
const migrate=(database,script='scripts/migrate.mjs',cwd=process.cwd())=>{const r=spawnSync(process.execPath,[script],{cwd,env:{...process.env,MYSQL_DATABASE:database},encoding:'utf8',timeout:240000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr+'\n'+String(r.error||''));return r.stdout;};
const open=async n=>{await admin.query('CREATE DATABASE '+identifier(n)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');opened.push(n);process.env.MYSQL_DATABASE=n;try{const d=await connect();dbs.push(d);return d;}finally{process.env.MYSQL_DATABASE=base;}};
const COLS={id:'varchar(191)',organisation_id:'varchar(191)',project_id:'varchar(191)',name:'varchar(160)',kind:'varchar(20)',discipline:'varchar(30)',delivery:'varchar(20)',contractor_label:'varchar(160)',sequence:'int',notes:'text',geometry:'longtext',vertex_count:'int',area_m2:'double',min_lat:'decimal(10,7)',max_lat:'decimal(10,7)',min_lng:'decimal(10,7)',max_lng:'decimal(10,7)',status:'varchar(20)',revision:'int',created_by:'varchar(191)',updated_by:'varchar(191)',created_at:'varchar(40)',updated_at:'varchar(40)',archived_at:'varchar(40)',archived_by:'varchar(191)'};
async function checkShape(db,label){
 const [cols]=await db.query("SELECT COLUMN_NAME c,COLUMN_TYPE t,IS_NULLABLE n,COLUMN_DEFAULT d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_work_areas'");
 assert.deepEqual(Object.fromEntries(cols.map(c=>[c.c,c.t])),COLS,label+': column set and types');
 const by=Object.fromEntries(cols.map(c=>[c.c,c]));
 for(const k of ['id','organisation_id','project_id','name','geometry','vertex_count','area_m2','min_lat','max_lat','min_lng','max_lng','created_at','updated_at'])assert.equal(by[k].n,'NO',`${label}: ${k} is NOT NULL`);
 assert.match(String(by.status.d),/active/);assert.equal(String(by.revision.d),'1');
 const [idx]=await db.query("SELECT INDEX_NAME i,SEQ_IN_INDEX s,COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_work_areas' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
 const g={};for(const r of idx)(g[r.i]??=[]).push(r.c);
 assert.deepEqual(g.PRIMARY,['id']);assert.deepEqual(g.project_work_areas_org_idx,['organisation_id']);assert.deepEqual(g.project_work_areas_project_idx,['organisation_id','project_id','status'],label+': indexes lead with organisation_id');
}
try{
 // ---------------------------------------------------------------- fresh install
 const fresh=await open(names.fresh);
 assert(migrate(names.fresh).includes('Applied '+NAME),'fresh install applies 0027');
 await checkShape(fresh,'fresh');
 const [[n]]=await fresh.query('SELECT COUNT(*) n FROM app_migrations');assert.equal(Number(n.n),files.length,'every migration recorded once');
 const [[done]]=await fresh.query('SELECT COUNT(*) total,SUM(complete) done FROM app_migration_steps WHERE name=?',[NAME]);assert.equal(Number(done.total),3,'create + two indexes journalled');assert.equal(Number(done.done),3);
 console.log('PASS 0027 fresh install: table, 25 typed columns, organisation_id NOT NULL, indexes lead with organisation_id, all steps journalled');
 // ---------------------------------------------------------------- upgrade from current main
 const up=await open(names.upgrade);
 const first=migrate(names.upgrade,'scripts/migrate.mjs',old);
 assert(!first.includes(NAME),'baseline is main (no 0027)');assert.equal((first.match(/Applied /g)||[]).length,files.length-1,'main set applied');
 const [[pre]]=await up.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_work_areas'");assert.equal(Number(pre.n),0);
 const t='2026-01-01T00:00:00.000Z';
 await up.query("INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at) VALUES ('job-main','org-main','Existing project','Planning','{}',?)",[t]);
 await up.query("INSERT INTO audit_log (id,organisation_id,event_type,entity_type,entity_id,project_id,summary,created_at) VALUES ('audit-main','org-main','project.created','project','job-main','job-main','before upgrade',?)",[t]);
 const [[before]]=await up.query('SELECT COUNT(*) migrations FROM app_migrations');
 const second=migrate(names.upgrade);
 assert.equal((second.match(/Applied /g)||[]).length,1);assert(second.includes('Applied '+NAME),'upgrade from main applies only 0027');
 await checkShape(up,'upgrade');
 const [[job]]=await up.query("SELECT name FROM jobs WHERE id='job-main'");assert.equal(job.name,'Existing project','existing project data survives');
 const [[aud]]=await up.query("SELECT summary FROM audit_log WHERE id='audit-main'");assert.equal(aud.summary,'before upgrade');
 const [[after]]=await up.query('SELECT COUNT(*) migrations FROM app_migrations');assert.equal(Number(after.migrations),Number(before.migrations)+1);
 const [[empty]]=await up.query('SELECT COUNT(*) n FROM project_work_areas');assert.equal(Number(empty.n),0,'new table starts empty: nothing is backfilled or invented');
 // the new table is usable with real values (decimal(10,7) keeps 7 dp, defaults apply)
 await up.query("INSERT INTO project_work_areas (id,organisation_id,project_id,name,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,created_at,updated_at) VALUES ('wa1','org-main','job-main','Stage 1','[]',3,10.5,-33.7960123,-33.7959,150.9050123,150.9051,?,?)",[t,t]);
 const [[row]]=await up.query("SELECT status,revision,kind,delivery,min_lat,min_lng FROM project_work_areas WHERE id='wa1'");
 assert.equal(row.status,'active');assert.equal(Number(row.revision),1);assert.equal(row.kind,'work_area');assert.equal(row.delivery,'own');assert.equal(String(row.min_lat),'-33.7960123');assert.equal(String(row.min_lng),'150.9050123');
 await assert.rejects(up.query("INSERT INTO project_work_areas (id,organisation_id,project_id,name,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,created_at,updated_at) VALUES ('wa2',NULL,'job-main','x','[]',3,1,1,1,1,1,?,?)",[t,t]),/organisation_id/,'organisation_id cannot be NULL');
 await assert.rejects(up.query("INSERT INTO project_work_areas (id,organisation_id,project_id,name,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,created_at,updated_at) VALUES ('wa1','org-main','job-main','dup','[]',3,1,1,1,1,1,?,?)",[t,t]),/Duplicate/,'stable ids are unique');
 console.log('PASS 0027 upgrade from main: applies only 0027, existing project and audit rows untouched, table empty, defaults and decimal(10,7) precision, NOT NULL tenant column, unique ids');
 // ---------------------------------------------------------------- repeat safety
 const again=migrate(names.upgrade);assert(!again.includes('Applied '),'a repeat run applies nothing');assert(again.includes('Database migrations ready'));
 const [[kept]]=await up.query("SELECT COUNT(*) n FROM project_work_areas WHERE id='wa1'");assert.equal(Number(kept.n),1,'a repeat run keeps data');
 // rewinding only 0027's bookkeeping and table, then re-running, recreates it (idempotent restart)
 await up.query('DROP TABLE project_work_areas');await up.query('DELETE FROM app_migration_steps WHERE name=?',[NAME]);await up.query('DELETE FROM app_migrations WHERE name=?',[NAME]);
 assert(migrate(names.upgrade).includes('Applied '+NAME),'re-applies after a rewind');await checkShape(up,'rewind');
 // a changed migration file is refused (checksums are enforced), so an applied 0027 can never be silently edited
 await up.query("UPDATE app_migrations SET sha256=REPEAT('0',64) WHERE name=?",[NAME]);
 const refused=spawnSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,MYSQL_DATABASE:names.upgrade},encoding:'utf8'});assert.notEqual(refused.status,0);assert.match(refused.stderr,/Migration checksum changed/);
 await up.query("UPDATE app_migrations SET sha256=? WHERE name=?",[createHash('sha256').update((await import('node:fs')).readFileSync('migrations/mysql/'+NAME,'utf8').replaceAll('\r\n','\n')).digest('hex'),NAME]);
 console.log('PASS 0027 repeat safety: no-op rerun keeps data, rewind + rerun recreates, edited migration refused by checksum');
 // ---------------------------------------------------------------- interrupted after CREATE TABLE
 const cr=await open(names.crash);
 migrate(names.crash,'scripts/migrate.mjs',old);
 const sql=(await import('node:fs')).readFileSync('migrations/mysql/'+NAME,'utf8').replaceAll('\r\n','\n'),sha=createHash('sha256').update(sql).digest('hex'),steps=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 await cr.query(steps[0]);// the CREATE TABLE committed, then the process died before it was journalled complete
 await cr.query('INSERT INTO app_migration_steps(name,step,sha256,complete) VALUES (?,?,?,FALSE)',[NAME,0,sha]);
 assert(migrate(names.crash).includes('Applied '+NAME),'recovers and finishes');await checkShape(cr,'recovered');
 const [[rec]]=await cr.query('SELECT SUM(complete) done,COUNT(*) total FROM app_migration_steps WHERE name=?',[NAME]);assert.equal(Number(rec.done),3);assert.equal(Number(rec.total),3);
 console.log('PASS 0027 interrupted after CREATE TABLE: runner resumes, adds both indexes, journals complete');
}finally{for(const d of dbs)await d.end().catch(()=>{});for(const n of opened)await admin.query('DROP DATABASE IF EXISTS '+identifier(n)).catch(()=>{});await admin.end();rmSync(old,{recursive:true,force:true});}
