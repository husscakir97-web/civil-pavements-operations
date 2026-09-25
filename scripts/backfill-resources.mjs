// One-off, rerunnable backfill of the typed resource columns added in 0004.
// Runs from scripts/migrate.mjs while the migration lock is held.
//  - append-only: legacy metadata is never modified and nothing is deleted;
//  - deterministic: the same mapping code as the application dual-write;
//  - rerunnable: only rows with legacy_synced_at IS NULL are processed;
//  - unmappable values are left NULL and recorded in data_migration_issues;
//  - counts are verified inside the transaction; a mismatch rolls back and stops startup.
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function loadSync(){
 const compile=async file=>ts.transpileModule(await readFile(new URL(`../lib/v1/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
 const mappingUrl=url(await compile('resource-mapping'));
 const mapping=await import(mappingUrl);
 const sync=await import(url((await compile('resource-sync')).replace(/from ['"]\.\/resource-mapping['"]/g,`from '${mappingUrl}'`)));
 return {...mapping,...sync};
}

const CATEGORY_TABLES=['workers','plant','crews','subcontractors','suppliers'];

export async function backfillOrganisation(db,org,lib,now=new Date().toISOString()){
 const id=()=>crypto.randomUUID();
 const rows=async(sql,params)=>(await db.query(sql,params))[0];
 await db.beginTransaction();
 try{
  const counts={workers:0,plant:0,shifts:0,competencies:0,assignments:0,issues:0};
  const jobIds=new Set((await rows('SELECT id FROM jobs WHERE organisation_id=?',[org])).map(r=>r.id));
  const resources=new Map();
  for(const table of CATEGORY_TABLES)for(const r of await rows(`SELECT id FROM ${table} WHERE organisation_id=?`,[org]))resources.set(r.id,table);
  const before={
   competencies:Number((await rows('SELECT COUNT(*) AS n FROM worker_competencies WHERE organisation_id=?',[org]))[0].n),
   assignments:Number((await rows('SELECT COUNT(*) AS n FROM shift_assignments WHERE organisation_id=?',[org]))[0].n),
  };
  const apply=async(statements)=>{for(const s of statements)await db.query(s.sql,s.params);};
  const record=async(entityType,entityId,issues)=>{
   for(const i of issues){
    await db.query("INSERT INTO data_migration_issues (id,organisation_id,migration,entity_type,entity_id,field,issue,legacy_value,status,created_at) VALUES (?,?,?,?,?,?,?,?,'open',?) ON DUPLICATE KEY UPDATE issue=VALUES(issue),legacy_value=VALUES(legacy_value)",[id(),org,lib.RESOURCE_MIGRATION,entityType,entityId,i.field.slice(0,80),i.issue.slice(0,500),i.legacyValue,now]);
    counts.issues++;
   }
  };
  let expectedCompetencies=0,expectedAssignments=0;
  for(const w of await rows('SELECT id,name,status,metadata FROM workers WHERE organisation_id=? AND legacy_synced_at IS NULL FOR UPDATE',[org])){
   const existing=await rows('SELECT id,competency_type,source,status,expiry_date FROM worker_competencies WHERE organisation_id=? AND worker_id=?',[org,w.id]);
   const out=lib.workerStatements(org,w,existing,now,id);
   await apply(out.statements);await record('worker',w.id,out.issues);
   const known=new Set(existing.map(e=>e.competency_type.toLowerCase()));
   expectedCompetencies+=out.competencies.filter(c=>!known.has(c.competencyType.toLowerCase())).length;
   counts.workers++;
  }
  for(const p of await rows('SELECT id,name,status,metadata FROM plant WHERE organisation_id=? AND legacy_synced_at IS NULL FOR UPDATE',[org])){
   const out=lib.plantStatements(org,p,now);await apply(out.statements);await record('plant',p.id,out.issues);counts.plant++;
  }
  for(const s of await rows('SELECT id,name,status,metadata FROM shifts WHERE organisation_id=? AND legacy_synced_at IS NULL FOR UPDATE',[org])){
   const previous=Number((await rows("SELECT COUNT(*) AS n FROM shift_assignments WHERE organisation_id=? AND shift_id=? AND source='planner'",[org,s.id]))[0].n);
   const out=lib.shiftStatements(org,s,{jobIds,resources},now,id,null);
   await apply(out.statements);await record('shift',s.id,out.issues);
   expectedAssignments+=out.assignments.length-previous;
   counts.shifts++;
  }
  // Verification: every legacy row is now synced and derived row counts match the mapping.
  for(const table of ['workers','plant','shifts']){
   const [{n}]=await rows(`SELECT COUNT(*) AS n FROM ${table} WHERE organisation_id=? AND legacy_synced_at IS NULL`,[org]);
   if(Number(n))throw new Error(`Backfill verification failed for ${org}: ${n} ${table} rows were not synced`);
  }
  const after={
   competencies:Number((await rows('SELECT COUNT(*) AS n FROM worker_competencies WHERE organisation_id=?',[org]))[0].n),
   assignments:Number((await rows('SELECT COUNT(*) AS n FROM shift_assignments WHERE organisation_id=?',[org]))[0].n),
  };
  counts.competencies=after.competencies-before.competencies;counts.assignments=after.assignments-before.assignments;
  if(counts.competencies!==expectedCompetencies)throw new Error(`Backfill verification failed for ${org}: expected ${expectedCompetencies} competencies, wrote ${counts.competencies}`);
  if(counts.assignments!==expectedAssignments)throw new Error(`Backfill verification failed for ${org}: expected ${expectedAssignments} assignments, wrote ${counts.assignments}`);
  if(counts.workers+counts.plant+counts.shifts)await db.query("INSERT INTO app_backfills (id,organisation_id,name,status,counts,started_at,completed_at) VALUES (?,?,?,'complete',?,?,?)",[id(),org,lib.RESOURCE_MIGRATION,JSON.stringify(counts),now,new Date().toISOString()]);
  await db.commit();
  return counts;
 }catch(error){await db.rollback().catch(()=>{});throw error;}
}

export async function backfillResources(db,log=console.log){
 const lib=await loadSync();
 const orgs=(await db.query("SELECT organisation_id FROM workers WHERE legacy_synced_at IS NULL UNION SELECT organisation_id FROM plant WHERE legacy_synced_at IS NULL UNION SELECT organisation_id FROM shifts WHERE legacy_synced_at IS NULL"))[0].map(r=>r.organisation_id).sort();
 const results={};
 for(const org of orgs){results[org]=await backfillOrganisation(db,org,lib);log(`Resource backfill ${org}: ${JSON.stringify(results[org])}`);}
 if(!orgs.length)log('Resource backfill: nothing to migrate');
 return results;
}
