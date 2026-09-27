// Typed resource registers (migration 0004): workers, their competencies, plant,
// and the migration issues raised by the legacy backfill. Typed columns are the
// source of truth; the legacy metadata keys the planner still reads (trade, rate,
// competencies, competencyExpiry, rego, complianceExpiry...) are mirrored on every
// save so the legacy scheduler keeps working unchanged.
import {z} from 'zod';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,type Row,type Conn} from '@/lib/platform/sql';
import {parseMeta,LEGACY_GENERAL_COMPETENCY} from '@/lib/v1/resource-mapping';

const actor=()=>actorContext.getStore()!;
const day=z.preprocess(v=>v===''?null:v,z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use a valid date.').nullable().optional());
const text=(max:number)=>z.preprocess(v=>v===''?null:v,z.string().trim().max(max).nullable().optional());
const rate=z.preprocess(v=>v===''||v==null?null:v,z.coerce.number().min(0).max(1e9).nullable().optional());

export const WORKER_STATUSES=['Active','Leave','Inactive'] as const;
export const PLANT_STATUSES=['Available','Allocated','Maintenance','Out of service','Unavailable','Inactive'] as const;
export const EMPLOYMENT_TYPES=['employee','casual','contractor','labour hire'] as const;

export const workerInput=z.object({
 firstName:z.string().trim().min(1,'First name is required.').max(120),
 lastName:text(120),employeeNumber:text(60),email:z.preprocess(v=>v===''?null:v,z.string().trim().email('Use a valid email.').max(254).nullable().optional()),
 phone:text(60),roleTitle:text(120),employmentType:z.preprocess(v=>v===''?null:v,z.enum(EMPLOYMENT_TYPES).nullable().optional()),
 userId:text(191),hourlyRate:rate,location:text(255),status:z.enum(WORKER_STATUSES),
});
export const plantInput=z.object({
 name:z.string().trim().min(1,'Name is required.').max(180),
 plantNumber:text(60),registration:text(40),category:text(80),description:text(255),make:text(80),model:text(80),
 ownership:z.preprocess(v=>v===''?null:v,z.enum(['owned','hired','leased']).nullable().optional()),
 hourlyRate:rate,dayRate:rate,complianceExpiry:day,location:text(255),status:z.enum(PLANT_STATUSES),
});
export const competencyInput=z.object({
 competencyType:z.string().trim().min(1,'Competency is required.').max(160),
 reference:text(120),issuedDate:day,expiryDate:day,documentId:text(191),
});

const inactive=(status:string)=>['inactive','archived'].includes(status.toLowerCase());
function viewer(){const a=actor();if(!can(a.role,'schedule.view'))fail(403,'You are not authorised to view resources.');return a;}
function editor(){const a=actor();if(!can(a.role,'resources.edit'))fail(403,'You are not authorised to change resources.');return a;}
const strip=(row:Row,keys:string[])=>{if(!can(actor().role,'commercial.view'))for(const k of keys)delete row[k];return row;};

function competencyState(expiry:string|null,today:string){
 if(!expiry)return 'no-expiry';
 if(expiry<today)return 'expired';
 const soon=new Date(Date.parse(`${today}T00:00:00Z`)+30*86400000).toISOString().slice(0,10);
 return expiry<=soon?'expiring':'current';
}

export async function listWorkers(){
 const a=viewer(),today=nowIso().slice(0,10);
 const [workers,comps]=await Promise.all([
  query("SELECT id,name,status,employee_number,first_name,last_name,email,phone,role_title,employment_type,user_id,hourly_rate,location,active,revision,legacy_synced_at FROM workers WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY name",[a.organisationId]),
  query("SELECT id,worker_id,competency_type,reference,issued_date,expiry_date,document_id,status,source,revision FROM worker_competencies WHERE organisation_id=? AND status='current' ORDER BY competency_type",[a.organisationId]),
 ]);
 return {workers:workers.map(w=>strip({...w,active:Boolean(Number(w.active)),competencies:comps.filter(c=>c.worker_id===w.id).map(c=>({...c,state:competencyState(c.expiry_date,today)}))},['hourly_rate']))};
}

export async function listPlant(){
 const a=viewer(),today=nowIso().slice(0,10);
 const rows=await query("SELECT id,name,status,plant_number,registration,category,description,make,model,ownership,hourly_rate,day_rate,compliance_expiry,location,active,revision FROM plant WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY name",[a.organisationId]);
 return {plant:rows.map(p=>strip({...p,active:Boolean(Number(p.active)),complianceState:competencyState(p.compliance_expiry,today)},['hourly_rate','day_rate']))};
}

/** Recomputes the legacy metadata mirror the planner reads (competency list and earliest expiry). */
async function mirrorCompetencies(workerId:string,conn:Conn){
 const org=actor().organisationId;
 const w=await one('SELECT metadata FROM workers WHERE organisation_id=? AND id=?',[org,workerId],conn);
 const comps=await query("SELECT competency_type,expiry_date FROM worker_competencies WHERE organisation_id=? AND worker_id=? AND status='current' ORDER BY competency_type",[org,workerId],conn);
 const expiries=comps.map(c=>c.expiry_date).filter(Boolean).sort();
 const meta={...parseMeta(w?.metadata),competencies:comps.map(c=>c.competency_type).filter(t=>t!==LEGACY_GENERAL_COMPETENCY).join(', '),competencyExpiry:expiries[0]||''};
 await exec('UPDATE workers SET metadata=? WHERE organisation_id=? AND id=?',[JSON.stringify(meta),org,workerId],conn);
}

export async function saveWorker(id:string|null,revision:number|null,raw:unknown){
 const a=editor(),input=workerInput.parse(raw),now=nowIso();
 if(!can(a.role,'commercial.view'))delete (input as Partial<typeof input>).hourlyRate;
 return tx(async conn=>{
  if(input.userId&&!await one('SELECT id FROM users WHERE organisation_id=? AND id=?',[a.organisationId,input.userId],conn))fail(400,'Linked user: choose a member of your organisation.');
  const name=[input.firstName,input.lastName].filter(Boolean).join(' ');
  const cols={employee_number:input.employeeNumber??null,first_name:input.firstName,last_name:input.lastName??null,email:input.email??null,phone:input.phone??null,role_title:input.roleTitle??null,employment_type:input.employmentType??null,user_id:input.userId??null,location:input.location??null,active:inactive(input.status)?0:1,...('hourlyRate' in input?{hourly_rate:input.hourlyRate??null}:{})};
  const mirror={trade:input.roleTitle||'',phone:input.phone||'',location:input.location||'',email:input.email||'',userId:input.userId||'',employeeNumber:input.employeeNumber||'',...('hourlyRate' in input?{rate:input.hourlyRate??''}:{})};
  if(!id){
   id=uuid();
   const row:Row={id,organisation_id:a.organisationId,name,status:input.status,metadata:JSON.stringify(mirror),created_at:now,...cols,revision:1,created_by:a.userId,updated_at:now,legacy_synced_at:now};
   await exec(`INSERT INTO workers (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,Object.values(row),conn);
   await audit({event:'worker.created',entityType:'worker',entityId:id,summary:`Worker added: ${name}`,after:cols},conn);
  }else{
   const current=await one('SELECT * FROM workers WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
   if(!current)fail(404,'Worker not found.');
   if(revision!=null&&Number(current!.revision)!==Number(revision))fail(409,'This worker was changed by someone else. Refresh to see the latest version.');
   const meta={...parseMeta(current!.metadata),...mirror};
   await exec(`UPDATE workers SET name=?,status=?,metadata=?,${Object.keys(cols).map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=?,legacy_synced_at=? WHERE organisation_id=? AND id=?`,[name,input.status,JSON.stringify(meta),...Object.values(cols),now,now,a.organisationId,id],conn);
   await audit({event:'worker.updated',entityType:'worker',entityId:id,summary:`Worker updated: ${name}`,before:Object.fromEntries(Object.keys(cols).map(k=>[k,current![k]])),after:cols},conn);
  }
  await mirrorCompetencies(id!,conn);
  return {id};
 });
}

export async function saveCompetency(workerId:string,competencyId:string|null,raw:unknown){
 const a=editor(),input=competencyInput.parse(raw),now=nowIso();
 if(input.issuedDate&&input.expiryDate&&input.expiryDate<input.issuedDate)fail(400,'Expiry must be on or after the issue date.');
 return tx(async conn=>{
  if(!await one('SELECT id FROM workers WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,workerId],conn))fail(404,'Worker not found.');
  if(input.documentId&&!await one('SELECT id FROM documents WHERE organisation_id=? AND id=?',[a.organisationId,input.documentId],conn))fail(400,'Evidence document not found.');
  const clash=await one('SELECT id,status FROM worker_competencies WHERE organisation_id=? AND worker_id=? AND competency_type=?',[a.organisationId,workerId,input.competencyType],conn);
  if(clash&&clash.id!==competencyId){
   if(clash.status==='current')fail(409,'This worker already holds that competency. Edit the existing record instead.');
   competencyId=clash.id;// re-instate a removed/revoked record rather than duplicating it
  }
  if(!competencyId){
   competencyId=uuid();
   await exec("INSERT INTO worker_competencies (id,organisation_id,worker_id,competency_type,reference,issued_date,expiry_date,document_id,status,source,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'current','manual',1,?,?,?)",[competencyId,a.organisationId,workerId,input.competencyType,input.reference??null,input.issuedDate??null,input.expiryDate??null,input.documentId??null,a.userId,now,now],conn);
  }else{
   const n=await exec("UPDATE worker_competencies SET competency_type=?,reference=?,issued_date=?,expiry_date=?,document_id=?,status='current',source='manual',revision=revision+1,updated_at=? WHERE organisation_id=? AND worker_id=? AND id=?",[input.competencyType,input.reference??null,input.issuedDate??null,input.expiryDate??null,input.documentId??null,now,a.organisationId,workerId,competencyId],conn);
   if(!n)fail(404,'Competency not found.');
  }
  await mirrorCompetencies(workerId,conn);
  await audit({event:'competency.saved',entityType:'worker',entityId:workerId,summary:`Competency recorded: ${input.competencyType}${input.expiryDate?` (expires ${input.expiryDate})`:''}`,after:input},conn);
  return {id:competencyId};
 });
}

/** Competencies are never deleted; revoking keeps the record for audit. */
export async function revokeCompetency(workerId:string,competencyId:string,reason:string){
 const a=editor();if(!reason.trim())fail(422,'Give a reason for revoking this competency.');
 return tx(async conn=>{
  const c=await one("SELECT competency_type FROM worker_competencies WHERE organisation_id=? AND worker_id=? AND id=? AND status='current' FOR UPDATE",[a.organisationId,workerId,competencyId],conn);
  if(!c)fail(404,'Competency not found.');
  await exec("UPDATE worker_competencies SET status='revoked',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[nowIso(),a.organisationId,competencyId],conn);
  await mirrorCompetencies(workerId,conn);
  await audit({event:'competency.revoked',entityType:'worker',entityId:workerId,summary:`Competency revoked: ${c!.competency_type} (${reason.trim().slice(0,200)})`},conn);
  return {revoked:true};
 });
}

export async function savePlant(id:string|null,revision:number|null,raw:unknown){
 const a=editor(),input=plantInput.parse(raw),now=nowIso();
 if(!can(a.role,'commercial.view')){delete (input as Partial<typeof input>).hourlyRate;delete (input as Partial<typeof input>).dayRate;}
 return tx(async conn=>{
  const cols:Row={plant_number:input.plantNumber??null,registration:input.registration??null,category:input.category??null,description:input.description??null,make:input.make??null,model:input.model??null,ownership:input.ownership??null,compliance_expiry:input.complianceExpiry??null,location:input.location??null,active:inactive(input.status)?0:1};
  if('hourlyRate' in input)cols.hourly_rate=input.hourlyRate??null;
  if('dayRate' in input)cols.day_rate=input.dayRate??null;
  const mirror:Row={type:input.category||'',rego:input.registration||'',location:input.location||'',complianceExpiry:input.complianceExpiry||''};
  if('hourlyRate' in input)mirror.hourlyRate=input.hourlyRate??'';
  if(!id){
   id=uuid();
   const row:Row={id,organisation_id:a.organisationId,name:input.name,status:input.status,metadata:JSON.stringify(mirror),created_at:now,...cols,revision:1,created_by:a.userId,updated_at:now,legacy_synced_at:now};
   await exec(`INSERT INTO plant (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,Object.values(row),conn);
   await audit({event:'plant.created',entityType:'plant',entityId:id,summary:`Plant added: ${input.name}`,after:cols},conn);
  }else{
   const current=await one('SELECT * FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn);
   if(!current)fail(404,'Plant item not found.');
   if(revision!=null&&Number(current!.revision)!==Number(revision))fail(409,'This plant item was changed by someone else. Refresh to see the latest version.');
   const meta={...parseMeta(current!.metadata),...mirror};
   await exec(`UPDATE plant SET name=?,status=?,metadata=?,${Object.keys(cols).map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=?,legacy_synced_at=? WHERE organisation_id=? AND id=?`,[input.name,input.status,JSON.stringify(meta),...Object.values(cols),now,now,a.organisationId,id],conn);
   await audit({event:'plant.updated',entityType:'plant',entityId:id,summary:`Plant updated: ${input.name}`,before:Object.fromEntries(Object.keys(cols).map(k=>[k,current![k]])),after:cols},conn);
  }
  return {id};
 });
}

export async function listIssues(status='open'){
 const a=viewer();
 const rows=await query("SELECT i.id,i.migration,i.entity_type,i.entity_id,i.field,i.issue,i.legacy_value,i.status,i.created_at,COALESCE(w.name,p.name,s.name) AS entity_name FROM data_migration_issues i LEFT JOIN workers w ON i.entity_type='worker' AND w.id=i.entity_id AND w.organisation_id=i.organisation_id LEFT JOIN plant p ON i.entity_type='plant' AND p.id=i.entity_id AND p.organisation_id=i.organisation_id LEFT JOIN shifts s ON i.entity_type='shift' AND s.id=i.entity_id AND s.organisation_id=i.organisation_id WHERE i.organisation_id=? AND i.status=? ORDER BY i.entity_type,entity_name,i.field LIMIT 500",[a.organisationId,status]);
 return {issues:can(a.role,'commercial.view')?rows:rows.map(r=>['rate','hourlyRate','dayRate'].includes(r.field)?{...r,legacy_value:null}:r)};
}

/** A person acknowledges a migration issue once they have corrected (or accepted) the record. */
export async function resolveIssue(id:string,note:string){
 const a=editor();
 return tx(async conn=>{
  const i=await one("SELECT * FROM data_migration_issues WHERE organisation_id=? AND id=? AND status='open' FOR UPDATE",[a.organisationId,id],conn);
  if(!i)fail(404,'Issue not found or already resolved.');
  await exec("UPDATE data_migration_issues SET status='resolved',resolved_by=?,resolved_at=? WHERE organisation_id=? AND id=?",[a.userId,nowIso(),a.organisationId,id],conn);
  await audit({event:'migration_issue.resolved',entityType:i!.entity_type,entityId:i!.entity_id,summary:`Migration issue resolved (${i!.field})${note.trim()?`: ${note.trim().slice(0,200)}`:''}`},conn);
  return {resolved:true};
 });
}
