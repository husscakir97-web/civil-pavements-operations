// Generic, organisation-scoped CRUD + lifecycle for typed registers.
// Table and column names come only from the static REGISTERS definitions.
import {z,type ZodTypeAny} from 'zod';
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {assertTransition,MACHINES} from '@/lib/platform/workflow';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,round2,type Row,type Conn} from '@/lib/platform/sql';
import {REGISTERS,registerDef,riskRating,DEFAULT_RISK_MATRIX,type RegisterDef,type FieldDef,type RiskMatrix} from './registers';
import {requireModule} from '@/lib/platform/entitlements';
import {getPool} from '@/lib/platform/database';
const getPoolConn=()=>getPool();

const actor=()=>actorContext.getStore()!;
// Legacy columns that are NOT NULL with an empty-string default.
const NOT_NULL_TEXT:Record<string,string[]>={tender_requirements:['source_document','source_page','clarification']};
function legacyNulls(def:RegisterDef,values:Row){for(const c of NOT_NULL_TEXT[def.table]||[])if(c in values&&values[c]==null)values[c]='';return values;}
const scopeColumn=(def:RegisterDef)=>def.scope==='tender'?'tender_id':def.scope==='itp'?'itp_id':def.scope==='org'?null:'project_id';
const stateCol=(def:RegisterDef)=>def.stateColumn||'status';

export function getDef(key:string){const def=registerDef(key);if(!def)fail(404,'Register not found.');return def!;}

function fieldSchema(f:FieldDef):ZodTypeAny{
 const opt=(s:ZodTypeAny)=>f.required?s:s.nullable().optional();
 const blank=(v:unknown)=>v===''?null:v;
 switch(f.type){
  case 'text':case 'textarea':return f.required?z.string().trim().min(1,`${f.label} is required.`).max(f.max||255):z.preprocess(v=>v==null?null:v,z.string().trim().max(f.max||255).nullable().optional());
  case 'number':case 'rating':return opt(z.preprocess(blank,z.coerce.number().min(f.min??-1e12).max(f.max??1e12)));
  case 'money':return opt(z.preprocess(blank,z.coerce.number().min(-1e12).max(1e12).transform(round2)));
  case 'date':return opt(z.preprocess(blank,z.string().regex(/^\d{4}-\d{2}-\d{2}$/,`${f.label} must be a date.`)));
  case 'datetime':return opt(z.preprocess(blank,z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,`${f.label} must be a date and time.`).transform(s=>s.slice(0,16))));
  case 'select':return opt(z.preprocess(blank,z.enum(f.options as [string,...string[]])));
  case 'boolean':return z.preprocess(v=>v===true||v===1||v==='1'||v==='true'?1:0,z.number()).optional();
  default:return opt(z.preprocess(blank,z.string().max(191)));
 }
}

function writableFields(def:RegisterDef,role:string){
 const full=can(role,def.edit);
 return def.fields.filter(f=>!f.derived&&(full||f.fieldWritable)&&!(f.commercial&&!can(role,'commercial.view')));
}

async function validateRefs(def:RegisterDef,values:Row,conn:Conn){
 const org=actor().organisationId;
 for(const f of def.fields){
  const v=values[f.key];if(v==null||v==='')continue;
  if(f.type==='user'&&!await one('SELECT id FROM users WHERE organisation_id=? AND id=?',[org,v],conn))fail(400,`${f.label}: choose a member of your organisation.`);
  if(f.type==='document'&&!await one('SELECT id FROM documents WHERE organisation_id=? AND id=?',[org,v],conn))fail(400,`${f.label}: document not found.`);
  if(f.type==='relation'){const target=getDef(f.relation!);if(!await one(`SELECT id FROM ${target.table} WHERE organisation_id=? AND id=?`,[org,v],conn))fail(400,`${f.label}: linked record not found.`);}
 }
}

export async function resolveParent(def:RegisterDef,parentId:string|null,conn:Conn,forWrite=false){
 const org=actor().organisationId;
 if(def.scope==='org')return {};
 if(!parentId){if(def.scope==='optional-project')return {};fail(400,'Choose a parent record.');}
 if(def.scope==='tender'){
  const t=await one('SELECT id,opportunity_id,stage FROM tenders WHERE organisation_id=? AND id=?',[org,parentId],conn);if(!t)fail(404,'Tender not found.');
  if(forWrite&&['awarded','lost'].includes(t!.stage)&&def.key!=='clarifications')fail(409,'This tender is closed. Its records are read-only.');
  return {tender_id:t!.id,opportunityId:t!.opportunity_id};
 }
 if(def.scope==='itp'){
  const i=await one('SELECT i.id,i.project_id,j.stage FROM itps i JOIN jobs j ON j.id=i.project_id AND j.organisation_id=i.organisation_id WHERE i.organisation_id=? AND i.id=?',[org,parentId],conn);if(!i)fail(404,'ITP not found.');
  if(forWrite&&i!.stage==='closed')fail(409,'This project is closed. Reopen it before adding records.');
  return {itp_id:i!.id,project_id:i!.project_id};
 }
 const p=await one('SELECT id,stage FROM jobs WHERE organisation_id=? AND id=?',[org,parentId],conn);if(!p)fail(404,'Project not found.');
 if(forWrite&&p!.stage==='closed')fail(409,'This project is closed. Reopen it before adding or changing records.');
 return {project_id:p!.id};
}

async function orgMatrix(conn:Conn):Promise<RiskMatrix>{
 const r=await one<{risk_matrix:string|null}>('SELECT risk_matrix FROM organisation_profiles WHERE organisation_id=?',[actor().organisationId],conn);
 try{const m=r?.risk_matrix?JSON.parse(r.risk_matrix):null;if(m&&[m.low,m.medium,m.high].every(Number.isFinite)&&m.low<m.medium&&m.medium<m.high)return m;}catch{/* default below */}
 return DEFAULT_RISK_MATRIX;
}

async function derive(def:RegisterDef,values:Row,existing:Row|null,conn:Conn){
 if(def.key==='risks'){
  const m=await orgMatrix(conn),merged={...existing,...values};
  values.initial_rating=riskRating(merged.initial_likelihood,merged.initial_consequence,m);
  values.residual_rating=riskRating(merged.residual_likelihood,merged.residual_consequence,m);
 }
}

/** Public shape: strips commercial fields for roles without commercial access. */
export function project(def:RegisterDef,row:Row,role:string){
 const out:Row={...row};
 delete out.organisation_id;
 if(!can(role,'commercial.view'))for(const f of def.fields)if(f.commercial)delete out[f.key];
 if(def.key==='requirements'&&out.status==='Missing')out.status='open';
 if(def.key==='opportunities'&&!out.stage)out.stage=legacyOpportunityStage(String(out.status||''));
 if(def.key==='library')out.expired=Boolean(out.expiry_date&&out.expiry_date<nowIso().slice(0,10));
 if(def.fixed)for(const k of Object.keys(def.fixed))delete out[k];
 return out;
}
export function legacyOpportunityStage(status:string){
 const s=status.toLowerCase();
 if(['won','awarded'].includes(s))return 'won';
 if(['lost','withdrawn','cancelled','no bid'].includes(s))return 'lost';
 if(['tendering','estimating','submitted','internal review','clarification','bid review','bid decision required'].includes(s))return 'bidding';
 if(['qualified','qualifying'].includes(s))return 'qualified';
 return 'lead';
}

function checkView(def:RegisterDef){
 const role=actor().role;
 if(role==='field'){if(!def.fieldView)fail(403,'You are not authorised to view these records.');}
 else if(!can(role,def.view))fail(403,'You are not authorised to view these records.');
}

export async function listRegister(key:string,params:URLSearchParams){
 const def=getDef(key);await requireModule(def.module);checkView(def);
 const org=actor().organisationId,parentId=params.get('parentId');
 const col=scopeColumn(def);
 const where=['t.organisation_id=?'],values:unknown[]=[org];
 if(parentId&&col){await resolveParent(def,parentId,getPoolConn());where.push(`t.${col}=?`);values.push(parentId);}
 else if(!parentId&&col&&def.scope!=='optional-project'&&params.get('all')!=='1')fail(400,'Choose a parent record.');
 for(const [k,v] of Object.entries(def.fixed||{})){where.push(`t.${k}=?`);values.push(v);}
 const state=params.get('state');if(state){where.push(`t.${stateCol(def)}=?`);values.push(state);}
 if(def.key==='requirements')where.push("t.tender_id IS NOT NULL");
 const joinProject=col==='project_id'||def.scope==='itp';
 const rows=await query(`SELECT t.*${joinProject?',j.name AS project_name':''} FROM ${def.table} t ${joinProject?'LEFT JOIN jobs j ON j.id=t.project_id AND j.organisation_id=t.organisation_id':''} WHERE ${where.join(' AND ')} ORDER BY ${def.key==='itp_items'?'t.sequence,t.created_at':'t.created_at DESC'} LIMIT 500`,values);
 return {register:def.key,records:rows.map(r=>project(def,r,actor().role))};
}

async function nextReference(def:RegisterDef,parent:Row,conn:PoolConnection){
 if(!def.reference)return {};
 const col=scopeColumn(def);
 const scoped=col&&parent[col]?` AND ${col}=?`:'';
 const r=await one<{n:number}>(`SELECT COUNT(*) AS n FROM ${def.table} WHERE organisation_id=?${scoped}`,[actor().organisationId,...(scoped?[parent[col!]]:[])],conn);
 return {reference:`${def.reference.prefix}-${String(Number(r?.n||0)+1).padStart(3,'0')}`};
}

export async function createRecord(key:string,parentId:string|null,input:Record<string,unknown>,opts:{origin?:string;initialState?:string}={}){
 const def=getDef(key),a=actor();await requireModule(def.module,true);
 if(!can(a.role,def.create||def.edit))fail(403,'You are not authorised to create this record.');
 const allowed=writableFields(def,a.role);
 const schema=z.object(Object.fromEntries(allowed.map(f=>[f.key,fieldSchema(f)])));
 const parsed=schema.safeParse(input);if(!parsed.success)fail(400,parsed.error.issues[0]?.message||'Check the highlighted fields.',{issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
 // Omit blank values on create so column defaults apply.
 const values:Row=legacyNulls(def,Object.fromEntries(Object.entries(parsed.data as Row).filter(([,v])=>v!==null&&v!==undefined)));
 return tx(async conn=>{
  const parent=await resolveParent(def,parentId,conn,true) as Row;
  await validateRefs(def,values,conn);
  await derive(def,values,null,conn);
  const id=uuid(),now=nowIso();
  const row:Row={id,organisation_id:a.organisationId,...values,...(def.fixed||{}),created_by:a.userId,created_at:now,updated_at:now,revision:1};
  const col=scopeColumn(def);if(col&&parent[col])row[col]=parent[col];
  if(def.scope==='itp')row.project_id=parent.project_id;
  if(def.machine)row[stateCol(def)]=opts.initialState||MACHINES[def.machine].initial;
  Object.assign(row,await nextReference(def,parent,conn));
  if(def.key==='requirements'){delete row.created_by;row.opportunity_id=parent.opportunityId;row.origin=opts.origin||'manual';row.requirement_type=row.category||'Project-specific';}
  if(def.key==='opportunities'){row.status=row.stage;row.metadata=JSON.stringify({client:row.client_name,estimatedValue:row.estimated_value,probability:row.probability,tenderCloseDate:row.closing_date});}
  if(def.key==='incidents')row.reported_by=a.userId;
  if(def.key==='variations'){
   const n=await one<{n:number}>('SELECT COALESCE(MAX(number),0)+1 AS n FROM project_variations WHERE organisation_id=? AND project_id=? FOR UPDATE',[a.organisationId,row.project_id],conn);
   row.number=Number(n?.n||1);row.reference=`VAR-${String(row.number).padStart(3,'0')}`;row.origin=opts.origin||'manual';
  }
  if(def.key==='itp_items'&&!row.sequence){const n=await one<{n:number}>('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM itp_items WHERE organisation_id=? AND itp_id=?',[a.organisationId,row.itp_id],conn);row.sequence=Number(n?.n||1);}
  const cols=Object.keys(row);
  await exec(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,cols.map(c=>row[c]),conn);
  await audit({event:`${def.key}.created`,entityType:def.key,entityId:id,projectId:(row.project_id as string)||null,summary:`${def.singular} created: ${String(row[def.titleField]??'').slice(0,120)}`,after:values},conn);
  return {record:project(def,{...row,...(await one(`SELECT * FROM ${def.table} WHERE id=?`,[id],conn))},a.role)};
 });
}

async function loadForUpdate(def:RegisterDef,id:string,conn:PoolConnection){
 const row=await one(`SELECT * FROM ${def.table} WHERE organisation_id=? AND id=? FOR UPDATE`,[actor().organisationId,id],conn);
 if(!row)fail(404,`${def.singular} not found.`);
 for(const [k,v] of Object.entries(def.fixed||{}))if(row![k]!==v)fail(404,`${def.singular} not found.`);
 return row!;
}
async function parentOf(def:RegisterDef,row:Row,conn:PoolConnection){
 const col=scopeColumn(def);
 if(def.scope==='itp')return resolveParent(def,row.itp_id,conn,true);
 if(col&&row[col])return resolveParent(def,row[col],conn,true);
 return {};
}

export async function updateRecord(key:string,id:string,revision:number,input:Record<string,unknown>){
 const def=getDef(key),a=actor();await requireModule(def.module,true);
 const itpFieldUpdate=def.key==='itp_items'&&can(a.role,'itp.complete');
 if(!can(a.role,def.edit)&&!itpFieldUpdate)fail(403,'You are not authorised to change this record.');
 const allowed=writableFields(def,a.role);
 const schema=z.object(Object.fromEntries(allowed.map(f=>[f.key,fieldSchema(f).optional()]))).strip();
 const parsed=schema.safeParse(input);if(!parsed.success)fail(400,parsed.error.issues[0]?.message||'Check the highlighted fields.');
 const values=legacyNulls(def,Object.fromEntries(Object.entries(parsed.data as Row).filter(([k])=>k in input)));
 return tx(async conn=>{
  const row=await loadForUpdate(def,id,conn);
  await parentOf(def,row,conn);
  if(Number(row.revision)!==Number(revision))fail(409,'This record was changed by someone else. Refresh to see the latest version.');
  if(def.lockedStates?.includes(row[stateCol(def)]))fail(409,`${def.singular} is ${row[stateCol(def)]} and can no longer be edited.`);
  if(def.key==='itp_items'&&['pass','fail','na'].includes(row.status)&&!can(a.role,'document.approve'))fail(409,'This inspection point is complete. Ask a manager to reopen it.');
  await validateRefs(def,values,conn);
  await derive(def,values,row,conn);
  if(!Object.keys(values).length)return {record:project(def,row,a.role)};
  if(def.key==='library'&&row.status==='current')values.version=Number(row.version||1)+1;
  if(def.key==='opportunities'){const m={...(()=>{try{return JSON.parse(row.metadata||'{}')}catch{return {}}})(),client:values.client_name??row.client_name,estimatedValue:values.estimated_value??row.estimated_value,probability:values.probability??row.probability,tenderCloseDate:values.closing_date??row.closing_date};values.metadata=JSON.stringify(m);}
  const now=nowIso(),cols=Object.keys(values);
  await exec(`UPDATE ${def.table} SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=? AND revision=?`,[...cols.map(c=>values[c]),now,a.organisationId,id,revision],conn);
  const before=Object.fromEntries(cols.map(c=>[c,row[c]]));
  await audit({event:`${def.key}.updated`,entityType:def.key,entityId:id,projectId:row.project_id||null,summary:`${def.singular} updated`,before,after:values},conn);
  return {record:project(def,await one(`SELECT * FROM ${def.table} WHERE id=?`,[id],conn) as Row,a.role)};
 });
}

export async function transitionRecord(key:string,id:string,to:string,note:string|undefined,opts:{system?:boolean}={}){
 const def=getDef(key),a=actor();await requireModule(def.module,true);
 if(!def.machine)fail(400,'This record has no lifecycle.');
 return tx(async conn=>{
  const row=await loadForUpdate(def,id,conn);
  const parent=await parentOf(def,row,conn) as Row;
  const col=stateCol(def);
  const from=def.key==='requirements'&&row.status==='Missing'?'open':def.key==='opportunities'&&!row.stage?legacyOpportunityStage(row.status):row[col];
  assertTransition(def.machine!,from,to,a.role,opts);
  const now=nowIso(),set:Row={[col]:to};
  // Lifecycle side-effects are deterministic code, recorded with the change.
  if(def.key==='requirements'&&from==='suggested'&&to==='open'){set.confirmed_by=a.userId;set.confirmed_at=now;}
  if(def.key==='returnables'&&to==='complete'){set.completed_by=a.userId;set.completed_at=now;}
  if(def.key==='risks'&&to==='controlled'){if(!String(row.controls||'').trim())fail(422,'Record controls before approving them.');set.controls_approved_by=a.userId;set.controls_approved_at=now;}
  if(def.key==='ncrs'&&to==='closed'){if(!String(row.verification||'').trim())fail(422,'Record verification before closing the NCR.');set.closed_by=a.userId;set.closed_at=now;}
  if(def.key==='actions'&&to==='complete'){set.completed_by=a.userId;set.completed_at=now;}
  if(def.key==='readiness'||def.key==='closeout'){if(to==='complete'){set.completed_by=a.userId;set.completed_at=now;}if(to==='not_applicable'&&!note&&!row.notes)fail(422,'Give a reason before marking this not applicable.');if(note)set.notes=note;}
  if(def.key==='itp_items'&&['pass','fail','na'].includes(to)){
   if(row.point_type==='hold'&&to==='pass'){if(!can(a.role,'document.approve'))fail(403,'Hold points must be released by an authorised manager.');set.released_by=a.userId;set.released_at=now;}
   set.completed_by=a.userId;set.completed_at=now;
  }
  if(def.key==='variations'){
   if(to==='submitted'&&!row.submitted_date)set.submitted_date=now.slice(0,10);
   if(to==='approved'){set.approved_value=row.value;set.approved_by=a.userId;set.approved_at=now;}
   if(['approved','rejected'].includes(to)&&note)set.decision_reason=note;
  }
  if(def.key==='opportunities')set.status=to;
  const cols=Object.keys(set);
  await exec(`UPDATE ${def.table} SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),now,a.organisationId,id],conn);
  await audit({event:`${def.key}.${to}`,entityType:def.key,entityId:id,projectId:row.project_id||parent.project_id||null,summary:`${def.singular}: ${from} → ${to}${note?` (${note.slice(0,200)})`:''}`,before:{[col]:from},after:set},conn);
  return {record:project(def,await one(`SELECT * FROM ${def.table} WHERE id=?`,[id],conn) as Row,a.role)};
 });
}

export async function deleteRecord(key:string,id:string){
 const def=getDef(key),a=actor();await requireModule(def.module,true);
 if(!can(a.role,def.edit))fail(403,'You are not authorised to delete this record.');
 return tx(async conn=>{
  const row=await loadForUpdate(def,id,conn);
  await parentOf(def,row,conn);
  if(def.machine&&row[stateCol(def)]!==MACHINES[def.machine].initial)fail(409,'Only records that have not progressed can be deleted. Use the lifecycle actions instead.');
  if(def.key==='itps'&&await one('SELECT id FROM itp_items WHERE organisation_id=? AND itp_id=? LIMIT 1',[a.organisationId,id],conn))fail(409,'Remove the inspection points before deleting this ITP.');
  await exec(`DELETE FROM ${def.table} WHERE organisation_id=? AND id=?`,[a.organisationId,id],conn);
  await audit({event:`${def.key}.deleted`,entityType:def.key,entityId:id,projectId:row.project_id||null,summary:`${def.singular} deleted`,before:row},conn);
  return {deleted:true,id};
 });
}
export {REGISTERS};
