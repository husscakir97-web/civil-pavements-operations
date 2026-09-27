// Migration test for the 0004 typed-resource backfill against real MySQL.
// Uses a disposable database (<MYSQL_DATABASE>_backfill_test): applies every
// migration, inserts legacy JSON-backed rows exactly as the legacy routes wrote
// them, runs the backfill, verifies the mapping, counts, issue flags, that legacy
// metadata is untouched, and that a rerun changes nothing.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import mysql from 'mysql2/promise';
import {mysqlOptions,identifier} from './mysql-config.mjs';
import {backfillResources} from './backfill-resources.mjs';
if(!process.env.MYSQL_DATABASE?.endsWith('_test'))throw new Error('MYSQL_DATABASE must name a disposable database ending in _test');
const name=process.env.MYSQL_DATABASE+'_backfill_test';
const admin=await mysql.createConnection({...mysqlOptions(),database:undefined});
await admin.query('DROP DATABASE IF EXISTS '+identifier(name));
await admin.query('CREATE DATABASE '+identifier(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
const run=(file,env)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[file],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',b=>log+=b);c.stderr.on('data',b=>log+=b);c.on('exit',code=>code===0?resolve(log):reject(new Error(log)));});
const db=await mysql.createConnection({...mysqlOptions(),database:name});
const q=async(sql,p=[])=>(await db.query(sql,p))[0];
try{
 let log=await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 assert.match(log,/Applied 0004_v1_resources_retention\.sql/);
 assert.match(log,/Resource backfill: nothing to migrate/);
 const now='2026-01-01T00:00:00.000Z',org='org-a',other='org-b';
 const legacy=(table,id,o,nm,status,meta)=>db.query(`INSERT INTO ${table} (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)`,[id,o,nm,status,typeof meta==='string'?meta:JSON.stringify(meta),now]);
 await legacy('jobs','job-1',org,'Job one','Active',{});
 await legacy('jobs','job-b',other,'Other org job','Active',{});
 await legacy('workers','w-good',org,'Alex Jordan Smith','Active',{trade:'Paver operator',phone:'0400 000 000',rate:'62.5',location:'Depot',competencies:'White card; Paver ticket, first aid',competencyExpiry:'2027-03-31',userId:'user-1',email:'alex@example.invalid'});
 await legacy('workers','w-bad',org,'Sam','Inactive',{rate:'sixty',competencyExpiry:'31/12/2026',email:'not-an-email'});
 await legacy('workers','w-expiry-only',org,'Jo Lee','Leave',{competencyExpiry:'2026-02-01'});
 await legacy('workers','w-broken-json',org,'Broken Json','Active','{not json');
 await legacy('plant','p-1',org,'Paver 1','Available',{type:'Paver',rego:'ABC123',hourlyRate:180,complianceExpiry:'2026-12-31',ownership:'Owned'});
 await legacy('plant','p-2',org,'Roller','Out of service',{hourlyRate:-5,ownership:'borrowed'});
 await legacy('crews','c-1',org,'Crew A','Active',{});
 await legacy('shifts','s-1',org,'Night shift','Planned',{jobId:'job-1',date:'2026-02-10',start:'19:00',finish:'05:00',scope:'Mill and fill',supervisor:'Pat',location:'Main Rd',assignments:[{resourceId:'w-good',category:'workers',name:'Alex',role:'Operator'},{resourceId:'p-1',category:'plant',name:'Paver'},{resourceId:'w-good',category:'workers',name:'dup'},{resourceId:'gone',category:'workers',name:'Deleted'},{resourceId:'c-1',category:'crews',name:'Crew A'}]});
 await legacy('shifts','s-2',org,'Orphan','Draft',{jobId:'job-b',date:'2026-13-40',start:'7am'});
 await legacy('workers','w-other',other,'Other Org','Active',{competencies:'White card'});
 const snapshot=async()=>q("SELECT id,metadata,name,status FROM workers UNION ALL SELECT id,metadata,name,status FROM plant UNION ALL SELECT id,metadata,name,status FROM shifts ORDER BY id");
 const before=await snapshot();
 const logs=[];const result=await backfillResources(db,m=>logs.push(m));
 assert.deepEqual(result[org],{workers:4,plant:2,shifts:2,competencies:4,assignments:3,issues:result[org].issues});
 assert.deepEqual(result[other],{workers:1,plant:0,shifts:0,competencies:1,assignments:0,issues:0});
 assert.deepEqual(await snapshot(),before,'Legacy name, status and metadata are never modified');

 const w=await q("SELECT * FROM workers WHERE id='w-good'");
 assert.equal(w[0].first_name,'Alex');assert.equal(w[0].last_name,'Jordan Smith');assert.equal(Number(w[0].hourly_rate),62.5);assert.equal(w[0].role_title,'Paver operator');assert.equal(w[0].user_id,'user-1');assert.equal(w[0].active,1);assert(w[0].legacy_synced_at);
 const comps=await q("SELECT competency_type,expiry_date,source FROM worker_competencies WHERE worker_id='w-good' ORDER BY competency_type");
 assert.deepEqual(comps.map(c=>[c.competency_type,c.expiry_date,c.source]),[['Paver ticket','2027-03-31','legacy'],['White card','2027-03-31','legacy'],['first aid','2027-03-31','legacy']]);
 const bad=(await q("SELECT * FROM workers WHERE id='w-bad'"))[0];
 assert.equal(bad.hourly_rate,null);assert.equal(bad.email,null);assert.equal(bad.active,0);
 assert.equal((await q("SELECT COUNT(*) n FROM worker_competencies WHERE worker_id='w-bad'"))[0].n,0,'An unparseable expiry creates nothing');
 assert.deepEqual((await q("SELECT competency_type FROM worker_competencies WHERE worker_id='w-expiry-only'")).map(r=>r.competency_type),['General competency (legacy)']);
 const plant=(await q("SELECT * FROM plant WHERE id='p-1'"))[0];
 assert.equal(plant.registration,'ABC123');assert.equal(plant.category,'Paver');assert.equal(plant.ownership,'owned');assert.equal(plant.compliance_expiry,'2026-12-31');assert.equal(Number(plant.hourly_rate),180);
 const shift=(await q("SELECT * FROM shifts WHERE id='s-1'"))[0];
 assert.equal(shift.project_id,'job-1');assert.equal(shift.shift_date,'2026-02-10');assert.equal(shift.start_time,'19:00');assert.equal(shift.finish_time,'05:00');assert.equal(shift.activity,'Mill and fill');
 assert.deepEqual((await q("SELECT resource_type,resource_id FROM shift_assignments WHERE shift_id='s-1' ORDER BY resource_type,resource_id")).map(r=>`${r.resource_type}:${r.resource_id}`),['crew:c-1','plant:p-1','worker:w-good']);
 const orphan=(await q("SELECT * FROM shifts WHERE id='s-2'"))[0];
 assert.equal(orphan.project_id,null,'A job in another organisation is never linked');assert.equal(orphan.shift_date,null);assert.equal(orphan.start_time,null);

 const issues=await q("SELECT entity_type,entity_id,field FROM data_migration_issues WHERE organisation_id=? AND status='open' ORDER BY entity_id,field",[org]);
 const flagged=issues.map(i=>`${i.entity_id}.${i.field}`);
 for(const expected of ['w-good.competencyExpiry','w-bad.rate','w-bad.competencyExpiry','w-bad.email','w-expiry-only.competencies','p-2.hourlyRate','p-2.ownership','s-1.assignments[3]','s-2.jobId','s-2.date','s-2.start','w-broken-json.metadata'])assert(flagged.includes(expected),`Expected issue ${expected}; got ${flagged.join(', ')}`);
 assert.equal(result[org].issues,issues.length);
 assert.equal((await q("SELECT COUNT(*) n FROM data_migration_issues WHERE organisation_id=?",[other]))[0].n,0);
 assert.equal((await q("SELECT COUNT(*) n FROM app_backfills"))[0].n,2);

 // Rerun: nothing pending, nothing changes.
 const counts=async()=>q("SELECT (SELECT COUNT(*) FROM worker_competencies) c,(SELECT COUNT(*) FROM shift_assignments) a,(SELECT COUNT(*) FROM data_migration_issues) i,(SELECT COUNT(*) FROM app_backfills) b");
 const c1=await counts();
 assert.deepEqual(await backfillResources(db,()=>{}),{});
 log=await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 assert.match(log,/Resource backfill: nothing to migrate/);
 assert.deepEqual(await counts(),c1);

 // A row written later by a legacy path without the dual-write is picked up on the next start.
 await legacy('workers','w-late',org,'Late Worker','Active',{competencies:'White card'});
 log=await run('scripts/migrate.mjs',{MYSQL_DATABASE:name});
 assert.match(log,/Resource backfill org-a: \{"workers":1,"plant":0,"shifts":0,"competencies":1,"assignments":0,"issues":0\}/);

 // Verification failure rolls back everything for that organisation.
 await legacy('workers','w-rollback',org,'Rollback Worker','Active',{competencies:'White card'});
 await db.query("CREATE TRIGGER block_comp BEFORE INSERT ON worker_competencies FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='blocked'");
 await assert.rejects(backfillResources(db,()=>{}),/blocked/);
 assert.equal((await q("SELECT legacy_synced_at FROM workers WHERE id='w-rollback'"))[0].legacy_synced_at,null,'Failed backfill leaves the row pending');
 await db.query('DROP TRIGGER block_comp');
 console.log('Resource backfill migration test passed:',JSON.stringify(result));
}finally{await db.end();await admin.query('DROP DATABASE IF EXISTS '+identifier(name));await admin.end();}
