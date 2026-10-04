// Runner coverage for 0028 (project work points + shift work-area links). Executed by the MySQL migration-recovery gate.
// Upgrade path: everything up to 0027 is applied and seeded with a work area, then the real runner applies 0028 without touching it.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect,identifier} from './mysql-config.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const base=process.env.MYSQL_DATABASE,suffix=randomUUID().slice(0,8),names={fresh:`${base}_wp_f${suffix}_test`,upgrade:`${base}_wp_u${suffix}_test`};
const admin=await connect(),opened=[],dbs=[];
const NAME='0028_work_point_and_shift_work_areas.sql';
const files=readdirSync('migrations/mysql').filter(f=>f.endsWith('.sql')).sort();
assert(files.includes(NAME),'0028 exists');const later=files.filter(f=>f>NAME);
const old=mkdtempSync(join(tmpdir(),'wp-main-'));mkdirSync(join(old,'migrations'));cpSync('scripts',join(old,'scripts'),{recursive:true});cpSync('migrations/mysql',join(old,'migrations/mysql'),{recursive:true});
for(const f of [NAME,...later])rmSync(join(old,'migrations/mysql',f));for(const d of ['node_modules','lib','db'])symlinkSync(join(process.cwd(),d),join(old,d));
const migrate=(database,cwd=process.cwd())=>{const r=spawnSync(process.execPath,['scripts/migrate.mjs'],{cwd,env:{...process.env,MYSQL_DATABASE:database},encoding:'utf8',timeout:240000});assert.equal(r.status,0,r.stderr);return r.stdout+r.stderr;};
const open=async n=>{await admin.query('CREATE DATABASE '+identifier(n)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');opened.push(n);const prev=process.env.MYSQL_DATABASE;process.env.MYSQL_DATABASE=n;try{const d=await connect();dbs.push(d);return d;}finally{process.env.MYSQL_DATABASE=prev;}};
async function shape(db,label){
 const cols=async t=>Object.fromEntries((await db.query("SELECT COLUMN_NAME c,IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",[t]))[0].map(r=>[r.c,r.n]));
 const idx=async t=>{const g={};for(const r of (await db.query("SELECT INDEX_NAME i,COLUMN_NAME c,NON_UNIQUE u FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX",[t]))[0])(g[r.i]??={u:r.u,c:[]}).c.push(r.c);return g;};
 const wp=await cols('project_work_points'),sl=await cols('shift_work_areas');
 assert.deepEqual(Object.keys(wp).sort(),['confirmed_at','confirmed_by','created_at','id','lat','lng','location_id','organisation_id','project_id','revision','source','updated_at'],label+': work point columns');
 assert.deepEqual(Object.keys(sl).sort(),['created_at','created_by','id','organisation_id','project_id','shift_id','work_area_id'],label+': shift link columns (ids only, no geometry)');
 assert.equal(wp.organisation_id,'NO');assert.equal(sl.organisation_id,'NO');
 const wi=await idx('project_work_points'),si=await idx('shift_work_areas');
 assert.deepEqual(wi.project_work_points_org_idx.c,['organisation_id']);assert.deepEqual(wi.project_work_points_project_uq.c,['organisation_id','project_id']);assert.equal(Number(wi.project_work_points_project_uq.u),0);
 assert.deepEqual(si.shift_work_areas_org_idx.c,['organisation_id']);assert.deepEqual(si.shift_work_areas_pair_uq.c,['organisation_id','shift_id','work_area_id']);assert.deepEqual(si.shift_work_areas_area_idx.c,['organisation_id','work_area_id']);
}
try{
 const fresh=await open(names.fresh);assert(migrate(names.fresh).includes('Applied '+NAME),'fresh install applies 0028');await shape(fresh,'fresh');
 console.log('PASS 0028 fresh install: both tables, organisation_id NOT NULL and indexed, unique natural keys, ids only');
 const up=await open(names.upgrade);const first=migrate(names.upgrade,old);assert(!first.includes(NAME));
 const t='2026-01-01T00:00:00.000Z';
 await up.query("INSERT INTO project_work_areas (id,organisation_id,project_id,name,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,created_at,updated_at) VALUES ('wa1','org-main','job-1','Existing area','[]',4,100,-33.1,-33.0,151.0,151.1,?,?)",[t,t]);
 const second=migrate(names.upgrade);assert(second.includes('Applied '+NAME));assert.equal((second.match(/Applied /g)||[]).length,1+later.length);await shape(up,'upgrade');
 const [[a]]=await up.query("SELECT name,revision FROM project_work_areas WHERE id='wa1'");assert.equal(a.name,'Existing area');
 for(const t2 of ['project_work_points','shift_work_areas']){const [[c]]=await up.query('SELECT COUNT(*) n FROM '+t2);assert.equal(Number(c.n),0,t2+' starts empty: nothing is invented');}
 await up.query("INSERT INTO shift_work_areas (id,organisation_id,shift_id,work_area_id,project_id,created_at) VALUES ('l1','org-main','s1','wa1','job-1',?)",[t]);
 await assert.rejects(up.query("INSERT INTO shift_work_areas (id,organisation_id,shift_id,work_area_id,project_id,created_at) VALUES ('l2','org-main','s1','wa1','job-1',?)",[t]),/Duplicate/,'a shift can reference an area once');
 await up.query("INSERT INTO project_work_points (id,organisation_id,project_id,lat,lng,confirmed_at,created_at,updated_at) VALUES ('p1','org-main','job-1',-33.2010000,149.0610000,?,?,?)",[t,t,t]);
 await assert.rejects(up.query("INSERT INTO project_work_points (id,organisation_id,project_id,lat,lng,confirmed_at,created_at,updated_at) VALUES ('p2','org-main','job-1',-33.3,149.1,?,?,?)",[t,t,t]),/Duplicate/,'one work point per project');
 const [[w]]=await up.query("SELECT source,revision,lat FROM project_work_points WHERE id='p1'");assert.equal(w.source,'project');assert.equal(Number(w.revision),1);assert.equal(Number(w.lat),-33.201);
 assert(!migrate(names.upgrade).includes('Applied '),'a repeat run applies nothing');
 console.log('PASS 0028 upgrade from 0027: existing work areas untouched, new tables empty, natural keys enforced, repeat run is a no-op');
}finally{for(const d of dbs)await d.end().catch(()=>{});for(const n of opened)await admin.query('DROP DATABASE IF EXISTS '+identifier(n)).catch(()=>{});await admin.end();rmSync(old,{recursive:true,force:true});}
