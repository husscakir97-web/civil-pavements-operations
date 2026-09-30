// Migration test for the 0023 business-unit backfill against real MySQL (disposable database).
// Proves: every existing organisation gets exactly one default division (deterministic id), existing
// projects/tenders/estimates point at it, shifts inherit their project's division, tenant separation,
// an existing custom assignment/default is never overwritten, and reruns change nothing (no duplicates).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mysql from 'mysql2/promise';
import {mysqlOptions,identifier} from './mysql-config.mjs';
import {backfillBusinessUnits} from './backfill-business-units.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const name=process.env.MYSQL_DATABASE+'_bu_test';
const admin=await mysql.createConnection({...mysqlOptions(),database:undefined});
await admin.query('DROP DATABASE IF EXISTS '+identifier(name));
await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
const run=(file,env)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[file],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);c.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const db=await mysql.createConnection({...mysqlOptions(),database:name});
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
try{
 await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 const now='2026-01-01T00:00:00.000Z';
 // Legacy shape: organisations and business rows that predate divisions (no division rows, NULL columns).
 await q('DELETE FROM business_units');
 for(const o of ['orgA','orgB','orgC'])await q('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)',[o,o,now]);
 const job=(id,org)=>q("INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,'Active','{}',?)",[id,org,id,now]);
 await job('jA1','orgA');await job('jA2','orgA');await job('jB1','orgB');
 await q("INSERT INTO estimates (id,organisation_id,name,status,metadata,created_at) VALUES ('eA1','orgA','e','Draft','{}',?),('eB1','orgB','e','Draft','{}',?)",[now,now]);
 await q("INSERT INTO opportunities (id,organisation_id,name,status,metadata,created_at) VALUES ('oA1','orgA','o','converted','{}',?)",[now]);
 await q("INSERT INTO tenders (id,organisation_id,opportunity_id,title,created_at,updated_at) VALUES ('tA1','orgA','oA1','t',?,?)",[now,now]);
 await q("INSERT INTO shifts (id,organisation_id,name,status,metadata,created_at,project_id) VALUES ('sA1','orgA','s','Planned','{}',?,'jA1'),('sA2','orgA','s','Planned','{}',?,NULL),('sB1','orgB','s','Planned','{}',?,'jB1')",[now,now,now]);
 // orgC already has a custom default division and a job deliberately placed in another division: neither may change.
 await q("INSERT INTO business_units (id,organisation_id,name,code,status,is_default,sort_order,revision,created_at,updated_at) VALUES ('c-main','orgC','Main works','MAIN','active',1,0,1,?,?),('c-asp','orgC','Asphalt','ASP','active',0,1,1,?,?)",[now,now,now,now]);
 await job('jC1','orgC');await q("UPDATE jobs SET business_unit_id='c-asp' WHERE id='jC1'");await job('jC2','orgC');

 const first=await backfillBusinessUnits(db);
 const snapshot=async()=>({
  units:await q('SELECT id,organisation_id,name,code,is_default,status FROM business_units ORDER BY id'),
  jobs:await q('SELECT id,business_unit_id FROM jobs ORDER BY id'),estimates:await q('SELECT id,business_unit_id FROM estimates ORDER BY id'),
  tenders:await q('SELECT id,business_unit_id FROM tenders ORDER BY id'),shifts:await q('SELECT id,business_unit_id FROM shifts ORDER BY id')});
 const s1=await snapshot();
 assert(first.some(n=>n>0),'the first run changed rows');
 const defaults=s1.units.filter(u=>u.is_default==1);assert.equal(defaults.length,3,'exactly one default per organisation');
 assert.deepEqual(defaults.map(d=>d.organisation_id).sort(),['orgA','orgB','orgC']);
 assert.equal(defaults.find(d=>d.organisation_id==='orgA').id,'bu_default_orgA','deterministic default id');
 assert.equal(defaults.find(d=>d.organisation_id==='orgC').id,'c-main','an existing default is kept, not duplicated');
 assert.equal(s1.units.filter(u=>u.organisation_id==='orgC').length,2,'orgC gained no extra division');
 const bu=(rows,id)=>rows.find(r=>r.id===id).business_unit_id;
 assert.equal(bu(s1.jobs,'jA1'),'bu_default_orgA');assert.equal(bu(s1.jobs,'jB1'),'bu_default_orgB');
 assert.equal(bu(s1.jobs,'jC1'),'c-asp','an intentional assignment is never overwritten');assert.equal(bu(s1.jobs,'jC2'),null,'orgC has no bu_default_ id, so its unassigned job is left for the default resolver (NULL = default)');
 assert.equal(bu(s1.estimates,'eA1'),'bu_default_orgA');assert.equal(bu(s1.tenders,'tA1'),'bu_default_orgA');
 assert.equal(bu(s1.shifts,'sA1'),'bu_default_orgA','a shift inherits its project\'s division');assert.equal(bu(s1.shifts,'sA2'),null,'a shift without a project stays unassigned');assert.equal(bu(s1.shifts,'sB1'),'bu_default_orgB');
 for(const r of [...s1.jobs,...s1.estimates,...s1.tenders,...s1.shifts])if(r.business_unit_id)assert.equal(s1.units.find(u=>u.id===r.business_unit_id)?.organisation_id,(await q('SELECT organisation_id FROM jobs WHERE id=? UNION SELECT organisation_id FROM estimates WHERE id=? UNION SELECT organisation_id FROM tenders WHERE id=? UNION SELECT organisation_id FROM shifts WHERE id=?',[r.id,r.id,r.id,r.id]))[0].organisation_id,'a record only ever points at its own organisation\'s division');
 // Idempotent: a second and third run change nothing and create nothing.
 for(let i=0;i<2;i++){const again=await backfillBusinessUnits(db);assert.deepEqual(again.filter(n=>n>0),[],'rerun '+(i+1)+' changed rows');}
 assert.deepEqual(await snapshot(),s1,'the data is identical after reruns');
 // A new organisation created afterwards is picked up by a later run without touching the others.
 await q('INSERT INTO organisations (id,name,created_at) VALUES (?,?,?)',['orgD','orgD',now]);
 await backfillBusinessUnits(db);
 assert.equal((await q("SELECT COUNT(*) n FROM business_units WHERE organisation_id='orgD'"))[0].n,1);assert.equal((await q('SELECT COUNT(*) n FROM business_units'))[0].n,defaults.length+1+1);
 console.log('PASS business-unit backfill: one deterministic default per organisation, existing rows assigned, shifts inherit, custom assignments/defaults preserved, tenant separation, reruns are no-ops');
}finally{await db.end();await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();}
