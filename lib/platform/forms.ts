// Forms engine — Core infrastructure for configurable operational forms (prestarts, inspections,
// toolbox records, audits, checklists). The first product surface is IMS & HSEQ, so routes run
// under the `ims` entitlement; the model itself carries `module` for future module-owned forms.
//
// Rules this service enforces (not the UI):
//  - a published version is immutable; changes start a new draft version (n+1);
//  - a submission references the exact published version it was made against and is never updated;
//  - corrections are append-only amendments carrying a full corrected snapshot and a reason;
//  - every context (organisation/project/shift/asset) is resolved from its owning record and
//    checked with the existing project-access and shift-audience rules — 404 when out of scope.
import {actorContext} from './context';
import {audit} from './audit';
import {can} from './permissions';
import {fail} from './http';
import {query,one,exec,tx,uuid,nowIso,type Conn,type Row} from './sql';
import {canAccessProject,projectFilter} from './project-access';
import {shiftAudience,shiftVisible} from './shift-scope';
import {saveLocation,loadLocations,locationInput} from './locations';
import {storeDocument,streamDocument} from './documents';
import type {LocationInput} from '@/lib/v1/location';
import {checkSchema,validateShape,changedFields,allFields,emptySchema,isFormContext,FORM_CATEGORIES,type Answers,type FormContext,type FormSchema,type SignatureValue} from '@/lib/v1/forms';

const actor=()=>actorContext.getStore()!;
const need=(cap:Parameters<typeof can>[1],message:string)=>{if(!can(actor().role,cap))fail(403,message);};
const parse=<T>(s:unknown,fallback:T):T=>{if(typeof s!=='string')return (s as T)??fallback;try{return JSON.parse(s) as T;}catch{return fallback;}};
const trim=(v:unknown,n:number)=>typeof v==='string'?v.trim().slice(0,n):'';

// ---------------------------------------------------------------- context resolution
export type ResolvedContext={type:FormContext;id:string;projectId:string|null;label:string};
/** Resolves the owning record; the supplied project id is never trusted. Throws 404 when out of scope. */
export async function resolveContext(type:FormContext,id:string,conn?:Conn):Promise<ResolvedContext>{
 const a=actor(),org=a.organisationId,notFound=()=>fail(404,'Form context not found.');
 if(type==='organisation'){
  // 'current' lets the client address its own organisation without knowing the id.
  if((id!==org&&id!=='current')||!can(a.role,'hseq.view'))notFound();
  return {type,id:org,projectId:null,label:'Company'};
 }
 if(type==='project'){
  if(!can(a.role,'project.view'))notFound();
  const p=await one('SELECT id,name FROM jobs WHERE organisation_id=? AND id=?',[org,id],conn);
  if(!p||!await canAccessProject(id,undefined,conn))notFound();
  return {type,id,projectId:id,label:String(p!.name)};
 }
 if(type==='shift'){
  const s=await one('SELECT id,name,metadata FROM shifts WHERE organisation_id=? AND id=?',[org,id],conn);
  if(!s)notFound();
  const m=parse<Row>(s!.metadata,{});
  if(!shiftVisible(await shiftAudience(a),{jobId:m.jobId,supervisorUserId:m.supervisorUserId,assignments:m.assignments}))notFound();
  const job=m.jobId?await one('SELECT id FROM jobs WHERE organisation_id=? AND id=?',[org,String(m.jobId)],conn):null;
  return {type,id,projectId:job?String(job.id):null,label:String(s!.name)};
 }
 if(type==='asset'){
  if(!(can(a.role,'workshop.view')||can(a.role,'resources.edit')||can(a.role,'schedule.view')))notFound();
  const p=await one('SELECT id,name,plant_number FROM plant WHERE organisation_id=? AND id=?',[org,id],conn);
  if(!p)notFound();
  return {type,id,projectId:null,label:[p!.plant_number,p!.name].filter(Boolean).join(' · ')};
 }
 return notFound();
}

// ---------------------------------------------------------------- evidence files
// Photos, files and drawn signatures are private Documents records in the controlled 'form' context
// (module: ims). The document's context id is the resolved form context, so every open re-derives
// authority from that record — a guessed document id never bypasses project or shift scope.
const evidenceKey=(ctx:ResolvedContext)=>`${ctx.type}:${ctx.id}`;
const FORM_EVIDENCE=/\.(pdf|png|jpe?g|gif|webp|heic|txt|csv|docx?|xlsx?)$/i;
export async function uploadFormEvidence(file:File,contextType:string,contextId:string){
 const a=actor();if(!can(a.role,'forms.submit')&&!can(a.role,'forms.amend'))fail(403,'You are not authorised to add form evidence.');
 if(!isFormContext(contextType))fail(400,'Choose where this form applies.');
 const ctx=await resolveContext(contextType,contextId);
 if(!FORM_EVIDENCE.test(file.name))fail(415,'Attach a photo, PDF, Office or text file.');
 const doc=await storeDocument(file,{contextType:'form',contextId:evidenceKey(ctx),projectId:ctx.projectId,category:'Form evidence',title:file.name,visibility:'field',source:'form',controlled:true});
 return {document:{id:doc.id,title:doc.title,contentType:doc.contentType,url:`/api/forms/evidence?id=${encodeURIComponent(String(doc.id))}`}};
}
export async function openFormEvidence(id:string){
 need('forms.view','You are not authorised to view forms.');
 const row=await one("SELECT * FROM documents WHERE organisation_id=? AND id=? AND context_type='form'",[actor().organisationId,id]);
 if(!row)fail(404,'Document not found.');
 const [type,...rest]=String(row!.context_id||'').split(':'),contextId=rest.join(':');
 if(!isFormContext(type)||!contextId)fail(404,'Document not found.');
 const ctx=await resolveContext(type,contextId);
 if((row!.project_id||null)!==ctx.projectId)fail(404,'Document not found.');
 return streamDocument(row!);
}

// ---------------------------------------------------------------- templates
const presentVersion=(v:Row,withSchema=true)=>({id:v.id,templateId:v.template_id,versionNumber:Number(v.version_number),status:v.status,changeReason:v.change_reason??null,publishedAt:v.published_at??null,publishedBy:v.published_by??null,createdAt:v.created_at,updatedAt:v.updated_at,revision:Number(v.revision),...(withSchema?{schema:parse<FormSchema>(v.schema_json,emptySchema())}:{})});
const presentTemplate=(t:Row)=>({id:t.id,name:t.name,description:t.description??null,category:t.category,module:t.module,status:t.status,currentVersionId:t.current_version_id??null,currentVersionNumber:t.current_version_number!=null?Number(t.current_version_number):null,draftVersionId:t.draft_version_id??null,draftVersionNumber:t.draft_version_number!=null?Number(t.draft_version_number):null,revision:Number(t.revision),updatedAt:t.updated_at});
const canManage=()=>can(actor().role,'forms.manage');

export async function listTemplates(){
 const a=actor();need('forms.view','You are not authorised to view forms.');
 const manage=canManage();
 const rows=await query(`SELECT t.*,cv.version_number AS current_version_number,dv.id AS draft_version_id,dv.version_number AS draft_version_number FROM form_templates t
  LEFT JOIN form_template_versions cv ON cv.organisation_id=t.organisation_id AND cv.id=t.current_version_id
  LEFT JOIN form_template_versions dv ON dv.organisation_id=t.organisation_id AND dv.template_id=t.id AND dv.status='draft'
  WHERE t.organisation_id=? AND t.module='ims' ${manage?'':"AND t.status='active' AND t.current_version_id IS NOT NULL"} ORDER BY t.status='active' DESC,t.name`,[a.organisationId]);
 return {canManage:manage,canPublish:can(a.role,'forms.publish'),canSubmit:can(a.role,'forms.submit'),categories:FORM_CATEGORIES,templates:rows.map(r=>manage?presentTemplate(r):{...presentTemplate(r),draftVersionId:null,draftVersionNumber:null})};
}

async function loadTemplate(id:string,conn?:Conn,lock=false){
 const t=await one(`SELECT * FROM form_templates WHERE organisation_id=? AND id=? AND module='ims'${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!t)fail(404,'Form not found.');
 return t!;
}
export async function getTemplate(id:string){
 need('forms.view','You are not authorised to view forms.');
 const t=await loadTemplate(id),manage=canManage();
 if(!manage&&(t.status!=='active'||!t.current_version_id))fail(404,'Form not found.');
 const versions=await query('SELECT * FROM form_template_versions WHERE organisation_id=? AND template_id=? ORDER BY version_number DESC',[actor().organisationId,id]);
 const visible=versions.filter(v=>manage||v.status!=='draft');
 return {template:presentTemplate({...t,current_version_number:versions.find(v=>v.id===t.current_version_id)?.version_number,draft_version_id:manage?versions.find(v=>v.status==='draft')?.id:null,draft_version_number:manage?versions.find(v=>v.status==='draft')?.version_number:null}),
  versions:visible.map(v=>presentVersion(v,false)),
  current:t.current_version_id?presentVersion(versions.find(v=>v.id===t.current_version_id)!):null,
  draft:manage?(()=>{const d=versions.find(v=>v.status==='draft');return d?presentVersion(d):null;})():null,
  canManage:manage,canPublish:can(actor().role,'forms.publish')};
}
/** One exact version (historical versions stay readable). Drafts are only visible to form managers. */
export async function getVersion(versionId:string){
 need('forms.view','You are not authorised to view forms.');
 const v=await one("SELECT v.* FROM form_template_versions v JOIN form_templates t ON t.organisation_id=v.organisation_id AND t.id=v.template_id AND t.module='ims' WHERE v.organisation_id=? AND v.id=?",[actor().organisationId,versionId]);
 if(!v||(v.status==='draft'&&!canManage()))fail(404,'Form version not found.');
 return {version:presentVersion(v!)};
}

function requireSchema(raw:unknown,forPublish=false){
 const r=checkSchema(raw,{forPublish});
 if(!r.schema)fail(400,r.errors[0]||'Check the form definition.',{issues:r.errors});
 return r.schema!;
}
const meta=(input:{name?:unknown;description?:unknown;category?:unknown})=>{
 const name=trim(input.name,180);if(!name)fail(400,'Give the form a name.');
 const category=trim(input.category,60)||'General';
 return {name,description:trim(input.description,2000)||null,category};
};

export async function createTemplate(input:{name?:unknown;description?:unknown;category?:unknown;schema?:unknown}){
 const a=actor();need('forms.manage','You are not authorised to create forms.');
 const m=meta(input),schema=requireSchema(input.schema??emptySchema());
 return tx(async conn=>{
  const id=uuid(),versionId=uuid(),now=nowIso();
  await exec("INSERT INTO form_templates (id,organisation_id,module,name,description,category,status,current_version_id,revision,created_by,created_at,updated_at) VALUES (?,?,'ims',?,?,?,'active',NULL,1,?,?,?)",[id,a.organisationId,m.name,m.description,m.category,a.userId,now,now],conn);
  await exec("INSERT INTO form_template_versions (id,organisation_id,template_id,version_number,status,schema_json,change_reason,revision,created_by,created_at,updated_at) VALUES (?,?,?,1,'draft',?,?,1,?,?,?)",[versionId,a.organisationId,id,JSON.stringify(schema),'Initial version',a.userId,now,now],conn);
  await audit({event:'form_template.created',entityType:'form_template',entityId:id,summary:`Form created: ${m.name}`,after:{...m,versionId,versionNumber:1}},conn);
  return {id,versionId};
 });
}

/** Edits the current draft only. A published or superseded version is refused (409), never mutated. */
export async function saveDraft(templateId:string,input:{versionId?:unknown;revision?:unknown;schema?:unknown;name?:unknown;description?:unknown;category?:unknown;changeReason?:unknown}){
 const a=actor();need('forms.manage','You are not authorised to edit forms.');
 const schema=requireSchema(input.schema);
 return tx(async conn=>{
  const t=await loadTemplate(templateId,conn,true);
  if(t.status!=='active')fail(409,'This form is archived. Restore it before editing.');
  const v=await one('SELECT * FROM form_template_versions WHERE organisation_id=? AND template_id=? AND id=? FOR UPDATE',[a.organisationId,templateId,String(input.versionId||'')],conn);
  if(!v)fail(404,'Form version not found.');
  if(v!.status!=='draft')fail(409,'Published versions cannot be edited. Start a new revision instead.');
  if(input.revision!=null&&Number(input.revision)!==Number(v!.revision))fail(409,'This draft was changed by someone else. Refresh to see the latest version.');
  const now=nowIso(),m=input.name!==undefined?meta(input):null;
  await exec('UPDATE form_template_versions SET schema_json=?,change_reason=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[JSON.stringify(schema),trim(input.changeReason,500)||v!.change_reason||null,now,a.organisationId,v!.id],conn);
  if(m)await exec('UPDATE form_templates SET name=?,description=?,category=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[m.name,m.description,m.category,now,a.organisationId,templateId],conn);
  await audit({event:'form_template.draft_updated',entityType:'form_template',entityId:templateId,summary:`Draft v${v!.version_number} updated`,after:{versionId:v!.id,versionNumber:Number(v!.version_number),fields:allFields(schema).length,...(m||{})}},conn);
  return {versionId:v!.id,revision:Number(v!.revision)+1};
 });
}

export async function publishVersion(templateId:string,versionId:string,changeReason?:unknown){
 const a=actor();need('forms.publish','You are not authorised to publish forms.');
 return tx(async conn=>{
  const t=await loadTemplate(templateId,conn,true);
  if(t.status!=='active')fail(409,'This form is archived. Restore it before publishing.');
  const v=await one('SELECT * FROM form_template_versions WHERE organisation_id=? AND template_id=? AND id=? FOR UPDATE',[a.organisationId,templateId,versionId],conn);
  if(!v)fail(404,'Form version not found.');
  if(v!.status!=='draft')fail(409,'Only a draft can be published.');
  requireSchema(parse(v!.schema_json,null),true);
  const now=nowIso(),reason=trim(changeReason,500)||v!.change_reason||null;
  if(t.current_version_id)await exec("UPDATE form_template_versions SET status='superseded',updated_at=? WHERE organisation_id=? AND id=? AND status='published'",[now,a.organisationId,t.current_version_id],conn);
  await exec("UPDATE form_template_versions SET status='published',published_by=?,published_at=?,change_reason=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[a.userId,now,reason,now,a.organisationId,versionId],conn);
  await exec('UPDATE form_templates SET current_version_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[versionId,now,a.organisationId,templateId],conn);
  await audit({event:'form_template.published',entityType:'form_template',entityId:templateId,summary:`${t.name} v${v!.version_number} published`,before:{currentVersionId:t.current_version_id??null},after:{versionId,versionNumber:Number(v!.version_number),changeReason:reason}},conn);
  return {versionId,versionNumber:Number(v!.version_number)};
 });
}

/** Starts the next draft from the current published version (or returns the open draft). */
export async function startRevision(templateId:string){
 const a=actor();need('forms.manage','You are not authorised to edit forms.');
 return tx(async conn=>{
  const t=await loadTemplate(templateId,conn,true);
  if(t.status!=='active')fail(409,'This form is archived. Restore it before editing.');
  const open=await one("SELECT id,version_number FROM form_template_versions WHERE organisation_id=? AND template_id=? AND status='draft'",[a.organisationId,templateId],conn);
  if(open)return {versionId:open.id as string,versionNumber:Number(open.version_number),existing:true};
  const cur=t.current_version_id?await one('SELECT schema_json FROM form_template_versions WHERE organisation_id=? AND id=?',[a.organisationId,t.current_version_id],conn):null;
  const n=await one<{n:number}>('SELECT COALESCE(MAX(version_number),0)+1 AS n FROM form_template_versions WHERE organisation_id=? AND template_id=?',[a.organisationId,templateId],conn);
  const id=uuid(),now=nowIso(),num=Number(n?.n||1);
  await exec("INSERT INTO form_template_versions (id,organisation_id,template_id,version_number,status,schema_json,change_reason,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,'draft',?,NULL,1,?,?,?)",[id,a.organisationId,templateId,num,cur?.schema_json||JSON.stringify(emptySchema()),a.userId,now,now],conn);
  await audit({event:'form_template.revision_started',entityType:'form_template',entityId:templateId,summary:`${t.name}: draft v${num} started`,after:{versionId:id,versionNumber:num}},conn);
  return {versionId:id,versionNumber:num,existing:false};
 });
}

/** Archiving stops new submissions; every version and submission stays readable. */
export async function setTemplateStatus(templateId:string,status:'active'|'archived'){
 const a=actor();need('forms.manage','You are not authorised to archive forms.');
 return tx(async conn=>{
  const t=await loadTemplate(templateId,conn,true);
  if(t.status===status)return {status};
  await exec('UPDATE form_templates SET status=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[status,nowIso(),a.organisationId,templateId],conn);
  await audit({event:status==='archived'?'form_template.archived':'form_template.restored',entityType:'form_template',entityId:templateId,summary:`${t.name} ${status==='archived'?'archived':'restored'}`,before:{status:t.status},after:{status}},conn);
  return {status};
 });
}

// ---------------------------------------------------------------- submissions
type Validated={values:Answers;pendingLocations:Record<string,LocationInput>};
/**
 * Server-authoritative validation against one exact schema: shape + visibility + required, then
 * every reference inside this organisation. `carried` holds values from the record being amended
 * that may be kept as-is (files and locations already on the evidence).
 */
async function validateResponses(schema:FormSchema,raw:unknown,ctx:ResolvedContext,conn:Conn,carried:Answers={}):Promise<Validated>{
 const a=actor(),org=a.organisationId,shape=validateShape(schema,raw);
 if(shape.errors.length)fail(400,shape.errors[0].message,{issues:shape.errors});
 const refFail=(field:string,message:string)=>fail(400,message,{issues:[{field,message}]});
 const fields=new Map(allFields(schema).map(f=>[f.id,f]));
 if(shape.refs.people.length){
  const ids=[...new Set(shape.refs.people)],found=new Set((await query<{id:string}>('SELECT id FROM users WHERE organisation_id=? AND id IN (?) UNION SELECT id FROM workers WHERE organisation_id=? AND id IN (?)',[org,ids,org,ids],conn)).map(r=>r.id));
  for(const [id,f] of fields)if(f.type==='person'&&shape.values[id]&&!found.has(String(shape.values[id])))refFail(id,`${f.label}: choose a person from your organisation.`);
 }
 if(shape.refs.assets.length){
  const ids=[...new Set(shape.refs.assets)],found=new Set((await query<{id:string}>('SELECT id FROM plant WHERE organisation_id=? AND id IN (?)',[org,ids],conn)).map(r=>r.id));
  for(const [id,f] of fields)if(f.type==='asset'&&shape.values[id]&&!found.has(String(shape.values[id])))refFail(id,`${f.label}: choose a plant item from your organisation.`);
 }
 if(shape.refs.documents.length){
  const already=new Set<string>();for(const v of Object.values(carried)){if(Array.isArray(v))v.forEach(x=>already.add(String(x)));else if(v&&typeof v==='object'&&(v as SignatureValue).documentId)already.add(String((v as SignatureValue).documentId));}
  const ids=[...new Set(shape.refs.documents)],rows=await query('SELECT id,context_type,context_id,project_id,uploaded_by,status FROM documents WHERE organisation_id=? AND id IN (?)',[org,ids],conn),byId=new Map(rows.map(r=>[String(r.id),r]));
  // A file may be attached when it is already on this evidence (carried through a correction), or it is
  // Forms evidence uploaded by this person for this exact resolved context. Same organisation is not
  // enough: another project's, shift's, asset's or tenant's file is refused, as is any non-Forms document.
  const key=evidenceKey(ctx);
  const ok=(d:string)=>{if(already.has(d))return true;const r=byId.get(d);return Boolean(r&&r.context_type==='form'&&r.context_id===key&&(r.project_id||null)===ctx.projectId&&r.status==='current'&&r.uploaded_by===a.userId);};
  for(const d of ids)if(!ok(d)){const f=[...fields.values()].find(x=>{const v=shape.values[x.id];return Array.isArray(v)?v.includes(d):(v as SignatureValue|undefined)?.documentId===d;});refFail(f?.id||'',`${f?.label||'File'}: attach a file you uploaded for this form.`);}
 }
 const pendingLocations:Record<string,LocationInput>={};
 for(const [id,v] of Object.entries(shape.locations)){
  const l=v as Record<string,unknown>,f=fields.get(id)!;
  if(typeof l.locationId==='string'){if(JSON.stringify(carried[id])!==JSON.stringify({locationId:l.locationId}))refFail(id,`${f.label}: choose a location.`);continue;}
  const r=locationInput.safeParse(l);if(!r.success)refFail(id,`${f.label}: ${r.error.issues[0]?.message||'enter a valid location.'}`);
  pendingLocations[id]=r.data as LocationInput;
 }
 return {values:shape.values,pendingLocations};
}
async function storeLocations(submissionId:string,v:Validated,conn:Conn){
 for(const [field,input] of Object.entries(v.pendingLocations))v.values[field]={locationId:await saveLocation(conn,{type:'form_submission',id:submissionId,locationType:field},input)};
}
/** Signatures are stamped by the server with the signer and time; an unchanged carried signature keeps its stamp. */
function stampSignatures(schema:FormSchema,values:Answers,carried:Answers={}){
 const a=actor(),now=nowIso();
 for(const f of allFields(schema)){
  if(f.type!=='signature'||!values[f.id])continue;
  const s=values[f.id] as SignatureValue,prev=carried[f.id] as SignatureValue|undefined;
  if(prev&&prev.name===s.name&&(prev.documentId||null)===(s.documentId||null))values[f.id]=prev;
  else values[f.id]={name:s.name,confirmed:true,documentId:s.documentId||null,signerUserId:a.userId,signedAt:now};
 }
}

export async function submitForm(input:{templateId?:unknown;versionId?:unknown;contextType?:unknown;contextId?:unknown;responses?:unknown;clientSubmittedAt?:unknown}){
 const a=actor();need('forms.submit','You are not authorised to submit forms.');
 const contextType=String(input.contextType||'');if(!isFormContext(contextType))fail(400,'Choose where this form applies.');
 return tx(async conn=>{
  const t=await loadTemplate(String(input.templateId||''),conn);
  if(t.status!=='active'||!t.current_version_id)fail(404,'Form not found.');
  if(input.versionId&&String(input.versionId)!==t.current_version_id)fail(409,'This form has been updated. Reload it and submit against the current version.');
  const v=await one("SELECT * FROM form_template_versions WHERE organisation_id=? AND id=? AND status='published'",[a.organisationId,t.current_version_id],conn);
  if(!v)fail(409,'This form has no published version.');
  const ctx=await resolveContext(contextType as FormContext,String(input.contextId||''),conn);
  const schema=parse<FormSchema>(v!.schema_json,emptySchema());
  const validated=await validateResponses(schema,input.responses,ctx,conn);
  const id=uuid(),now=nowIso();
  await storeLocations(id,validated,conn);
  stampSignatures(schema,validated.values);
  const provenance={role:a.role,channel:'web',clientSubmittedAt:typeof input.clientSubmittedAt==='string'?input.clientSubmittedAt.slice(0,40):null,contextLabel:ctx.label,versionNumber:Number(v!.version_number)};
  await exec('INSERT INTO form_submissions (id,organisation_id,template_id,template_version_id,context_type,context_id,project_id,responses_json,provenance_json,submitted_by,submitted_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
   [id,a.organisationId,t.id,v!.id,ctx.type,ctx.id,ctx.projectId,JSON.stringify(validated.values),JSON.stringify(provenance),a.userId,now,now],conn);
  await audit({event:'form_submission.submitted',entityType:'form_submission',entityId:id,projectId:ctx.projectId,summary:`${t.name} v${v!.version_number} submitted (${ctx.type}: ${ctx.label})`.slice(0,500),after:{templateId:t.id,versionId:v!.id,contextType:ctx.type,contextId:ctx.id}},conn);
  return {id};
 });
}

async function loadSubmission(id:string,conn?:Conn,lock=false){
 const s=await one(`SELECT * FROM form_submissions WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!s)fail(404,'Submission not found.');
 const t=await one("SELECT * FROM form_templates WHERE organisation_id=? AND id=? AND module='ims'",[actor().organisationId,s!.template_id],conn);
 if(!t)fail(404,'Submission not found.');
 // Access is always re-derived from the context the evidence belongs to.
 const ctx=await resolveContext(s!.context_type as FormContext,String(s!.context_id),conn);
 return {s:s!,t:t!,ctx};
}

export async function amendSubmission(id:string,input:{responses?:unknown;reason?:unknown}){
 const a=actor();need('forms.amend','You are not authorised to correct submitted forms.');
 const reason=trim(input.reason,1000);if(reason.length<3)fail(400,'Give a reason for the correction.');
 return tx(async conn=>{
  const {s,t,ctx}=await loadSubmission(id,conn,true);
  const v=await one('SELECT * FROM form_template_versions WHERE organisation_id=? AND id=?',[a.organisationId,s.template_version_id],conn);
  if(!v)fail(404,'Submission not found.');
  const schema=parse<FormSchema>(v!.schema_json,emptySchema());
  const last=await one('SELECT sequence,responses_json FROM form_submission_amendments WHERE organisation_id=? AND submission_id=? ORDER BY sequence DESC LIMIT 1',[a.organisationId,id],conn);
  const effective=parse<Answers>(last?.responses_json??s.responses_json,{});
  const validated=await validateResponses(schema,input.responses,ctx,conn,effective);
  await storeLocations(id,validated,conn);
  stampSignatures(schema,validated.values,effective);
  const changed=changedFields(effective,validated.values);
  if(!changed.length)fail(400,'The correction does not change any answer.');
  const seq=Number(last?.sequence||0)+1,aid=uuid(),now=nowIso();
  await exec('INSERT INTO form_submission_amendments (id,organisation_id,submission_id,sequence,responses_json,changed_fields,reason,amended_by,amended_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[aid,a.organisationId,id,seq,JSON.stringify(validated.values),JSON.stringify(changed),reason,a.userId,now,now],conn);
  await audit({event:'form_submission.amended',entityType:'form_submission',entityId:id,projectId:s.project_id??null,summary:`${t.name}: correction ${seq} — ${reason}`.slice(0,500),before:Object.fromEntries(changed.map(k=>[k,effective[k]??null])),after:{sequence:seq,changedFields:changed,values:Object.fromEntries(changed.map(k=>[k,validated.values[k]??null]))}},conn);
  return {id:aid,sequence:seq,changedFields:changed};
 });
}

/** Names/labels for the references inside a set of responses (organisation-scoped). */
async function referenceLabels(snapshots:Answers[],schema:FormSchema){
 const org=actor().organisationId,people=new Set<string>(),assets=new Set<string>(),docs=new Set<string>(),locs=new Set<string>();
 for(const r of snapshots)for(const f of allFields(schema)){
  const v=r[f.id];if(v==null)continue;
  if(f.type==='person')people.add(String(v));
  if(f.type==='asset')assets.add(String(v));
  if(f.type==='photo'||f.type==='file')(v as string[]).forEach(d=>docs.add(d));
  if(f.type==='signature'){const s=v as SignatureValue;if(s.documentId)docs.add(s.documentId);if(s.signerUserId)people.add(s.signerUserId);}
  if(f.type==='location'&&(v as {locationId?:string}).locationId)locs.add((v as {locationId:string}).locationId);
 }
 const ids=(s:Set<string>)=>s.size?[...s]:['-'];
 const [p,w,as,ds]=await Promise.all([
  query('SELECT id,name FROM users WHERE organisation_id=? AND id IN (?)',[org,ids(people)]),
  query('SELECT id,name FROM workers WHERE organisation_id=? AND id IN (?)',[org,ids(people)]),
  query('SELECT id,name,plant_number FROM plant WHERE organisation_id=? AND id IN (?)',[org,ids(assets)]),
  query('SELECT id,title,file_name,content_type FROM documents WHERE organisation_id=? AND id IN (?)',[org,ids(docs)]),
 ]);
 const locations=await loadLocations([...locs]);
 return {
  people:Object.fromEntries([...w,...p].map(r=>[r.id,String(r.name)])),
  assets:Object.fromEntries(as.map(r=>[r.id,[r.plant_number,r.name].filter(Boolean).join(' · ')])),
  documents:Object.fromEntries(ds.map(r=>[r.id,{title:r.title||r.file_name,contentType:r.content_type,url:`/api/forms/evidence?id=${encodeURIComponent(String(r.id))}`}])),
  locations:Object.fromEntries([...locations.entries()]),
 };
}

export async function getSubmission(id:string){
 need('forms.view','You are not authorised to view forms.');
 const {s,t,ctx}=await loadSubmission(id);
 const org=actor().organisationId;
 const v=await one('SELECT * FROM form_template_versions WHERE organisation_id=? AND id=?',[org,s.template_version_id]);
 const amendments=await query('SELECT * FROM form_submission_amendments WHERE organisation_id=? AND submission_id=? ORDER BY sequence',[org,id]);
 const schema=parse<FormSchema>(v?.schema_json,emptySchema()),original=parse<Answers>(s.responses_json,{});
 const snaps=amendments.map(x=>parse<Answers>(x.responses_json,{}));
 const userIds=[s.submitted_by,...amendments.map(x=>x.amended_by)];
 const names=Object.fromEntries((await query('SELECT id,name FROM users WHERE organisation_id=? AND id IN (?)',[org,userIds])).map(r=>[r.id,String(r.name)]));
 return {
  submission:{id:s.id,templateId:t.id,templateName:t.name,versionId:s.template_version_id,versionNumber:Number(v?.version_number||0),contextType:ctx.type,contextId:ctx.id,contextLabel:ctx.label,projectId:s.project_id??null,submittedBy:s.submitted_by,submittedByName:names[s.submitted_by]??null,submittedAt:s.submitted_at,provenance:parse(s.provenance_json,{})},
  schema,original,
  amendments:amendments.map((x,i)=>({id:x.id,sequence:Number(x.sequence),reason:x.reason,amendedBy:x.amended_by,amendedByName:names[x.amended_by]??null,amendedAt:x.amended_at,changedFields:parse<string[]>(x.changed_fields,[]),responses:snaps[i]})),
  effective:snaps.length?snaps[snaps.length-1]:original,
  labels:await referenceLabels([original,...snaps],schema),
  canAmend:can(actor().role,'forms.amend'),
 };
}

/**
 * Downstream-workflow read model of one submission (e.g. the Workshop defect seam). Server-only and not
 * exposed over HTTP: callers are seams that have already checked their own capability and entitlements.
 * Access is re-derived here exactly as for a Forms read — forms.view plus the owning context's project /
 * shift scope — so a downstream link never widens what the actor may see. Pass `conn` with `lock` inside a
 * transaction to serialise against amendments, so the returned amendment sequence is the one that is
 * effective when the downstream record is written.
 */
export type WorkflowSubmission={
 submissionId:string;templateId:string;templateName:string;versionId:string;versionNumber:number;schema:FormSchema;
 contextType:FormContext;contextId:string;contextLabel:string;projectId:string|null;shiftId:string|null;
 submittedBy:string;submittedByName:string|null;submittedAt:string;
 responses:Answers;amendmentSequence:number;assetIds:string[];
};
export async function resolveFormSubmissionForWorkflow(submissionId:string,opts:{conn?:Conn;lock?:boolean}={}):Promise<WorkflowSubmission>{
 need('forms.view','You are not authorised to view forms.');
 const org=actor().organisationId,{conn}=opts;
 const {s,t,ctx}=await loadSubmission(submissionId,conn,opts.lock);
 const v=await one('SELECT id,version_number,schema_json FROM form_template_versions WHERE organisation_id=? AND id=?',[org,s.template_version_id],conn);
 if(!v)fail(404,'Submission not found.');
 const last=await one('SELECT sequence,responses_json FROM form_submission_amendments WHERE organisation_id=? AND submission_id=? ORDER BY sequence DESC LIMIT 1',[org,submissionId],conn);
 const schema=parse<FormSchema>(v!.schema_json,emptySchema()),responses=parse<Answers>(last?.responses_json??s.responses_json,{});
 const assets=new Set<string>();
 if(ctx.type==='asset')assets.add(ctx.id);
 for(const f of allFields(schema))if(f.type==='asset'&&typeof responses[f.id]==='string'&&responses[f.id])assets.add(String(responses[f.id]));
 const submitter=await one('SELECT name FROM users WHERE organisation_id=? AND id=?',[org,s.submitted_by],conn);
 return {
  submissionId:String(s.id),templateId:String(t.id),templateName:String(t.name),versionId:String(v!.id),versionNumber:Number(v!.version_number),schema,
  contextType:ctx.type,contextId:ctx.id,contextLabel:ctx.label,projectId:ctx.projectId,shiftId:ctx.type==='shift'?ctx.id:null,
  submittedBy:String(s.submitted_by),submittedByName:submitter?String(submitter.name):null,submittedAt:String(s.submitted_at),
  responses,amendmentSequence:Number(last?.sequence||0),assetIds:[...assets],
 };
}

export async function listSubmissions(filter:{contextType?:string|null;contextId?:string|null;templateId?:string|null;limit?:number}){
 const a=actor();need('forms.view','You are not authorised to view forms.');
 const where=['s.organisation_id=?'],params:unknown[]=[a.organisationId];
 if(filter.contextType||filter.contextId){
  if(!filter.contextType||!isFormContext(filter.contextType)||!filter.contextId)fail(400,'Choose a form context.');
  const ctx=await resolveContext(filter.contextType as FormContext,filter.contextId!);
  where.push('s.context_type=? AND s.context_id=?');params.push(ctx.type,ctx.id);
 }else if(!can(a.role,'project.view')){
  // Field users without a context see only what they submitted.
  where.push('s.submitted_by=?');params.push(a.userId);
 }else{
  where.push(`1=1${await projectFilter('s.project_id',params,{allowNull:true})}`);
  if(!can(a.role,'hseq.view')){where.push("(s.project_id IS NOT NULL OR s.submitted_by=?)");params.push(a.userId);}
 }
 if(filter.templateId){where.push('s.template_id=?');params.push(filter.templateId);}
 const rows=await query(`SELECT s.id,s.template_id,s.template_version_id,s.context_type,s.context_id,s.project_id,s.submitted_by,s.submitted_at,t.name AS template_name,v.version_number,u.name AS submitted_by_name,j.name AS project_name,
  (SELECT COUNT(*) FROM form_submission_amendments x WHERE x.organisation_id=s.organisation_id AND x.submission_id=s.id) AS amendments
  FROM form_submissions s JOIN form_templates t ON t.organisation_id=s.organisation_id AND t.id=s.template_id AND t.module='ims'
  LEFT JOIN form_template_versions v ON v.organisation_id=s.organisation_id AND v.id=s.template_version_id
  LEFT JOIN users u ON u.organisation_id=s.organisation_id AND u.id=s.submitted_by
  LEFT JOIN jobs j ON j.organisation_id=s.organisation_id AND j.id=s.project_id
  WHERE ${where.join(' AND ')} ORDER BY s.submitted_at DESC LIMIT ?`,[...params,Math.min(Math.max(Number(filter.limit)||100,1),500)]);
 // Shift evidence outside a context listing still honours the shift audience (e.g. a project-wide engineer list).
 let visible=rows;
 if(!filter.contextType&&rows.some(r=>r.context_type==='shift')&&can(a.role,'project.view')){
  const aud=await shiftAudience(a);
  if(aud.mode!=='all'){
   const shiftIds=[...new Set(rows.filter(r=>r.context_type==='shift').map(r=>String(r.context_id)))];
   const shifts=await query('SELECT id,metadata FROM shifts WHERE organisation_id=? AND id IN (?)',[a.organisationId,shiftIds]);
   const ok=new Set(shifts.filter(x=>{const m=parse<Row>(x.metadata,{});return shiftVisible(aud,{jobId:m.jobId,supervisorUserId:m.supervisorUserId,assignments:m.assignments});}).map(x=>String(x.id)));
   visible=rows.filter(r=>r.context_type!=='shift'||ok.has(String(r.context_id)));
  }
 }
 return {submissions:visible.map(r=>({id:r.id,templateId:r.template_id,templateName:r.template_name,versionId:r.template_version_id,versionNumber:Number(r.version_number||0),contextType:r.context_type,contextId:r.context_id,projectId:r.project_id??null,projectName:r.project_name??null,submittedBy:r.submitted_by,submittedByName:r.submitted_by_name??null,submittedAt:r.submitted_at,amendments:Number(r.amendments||0)}))};
}

/** Pick lists for person and asset fields (organisation-scoped names only; no rates or HR detail). */
export async function formOptions(){
 const a=actor();need('forms.submit','You are not authorised to submit forms.');
 const [users,workers,plant]=await Promise.all([
  query("SELECT id,name FROM users WHERE organisation_id=? ORDER BY name",[a.organisationId]),
  query("SELECT id,name FROM workers WHERE organisation_id=? AND (status IS NULL OR status<>'archived') ORDER BY name",[a.organisationId]),
  query("SELECT id,name,plant_number FROM plant WHERE organisation_id=? ORDER BY name",[a.organisationId]),
 ]);
 const userNames=new Set(users.map(u=>String(u.name).toLowerCase()));
 return {people:[...users.map(u=>({id:u.id,name:String(u.name),kind:'member'})),...workers.filter(w=>!userNames.has(String(w.name).toLowerCase())).map(w=>({id:w.id,name:String(w.name),kind:'worker'}))],assets:plant.map(p=>({id:p.id,name:[p.plant_number,p.name].filter(Boolean).join(' · ')}))};
}
