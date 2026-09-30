// Document Engine foundation (Core). One authoritative service for managed documents:
//
//   managed document (durable business record: identity, metadata, ONE access context)
//     → document version (immutable: revision label, issue date, author, change note)
//       → physical file (a `documents` row + private object; never overwritten)
//
// Rules this service enforces (not the UI):
//  - the access context is the single security owner; links are navigation/relevance only and never
//    widen access; a guessed managed/version/file/link id fails closed (404);
//  - a new revision always creates a NEW physical file and a NEW version row, under a row lock on the
//    managed document; stale callers (expectedVersion / revision) get 409 instead of racing;
//  - historical version metadata is immutable; only identity metadata is editable;
//  - `documents.version/status/supersedes_id` stay as compatibility mirrors written here in the same
//    transaction, and the raw /api/documents supersede path refuses managed files, so the two can
//    never contradict each other;
//  - no hard delete: archive/restore only; nothing here removes a stored object;
//  - server-side callers (e.g. a future Commercial claim generator) pass bytes instead of a browser
//    File and `generated:true`: that skips only the document.upload / manage_versions capability
//    (the calling module has already authorised its own action). Entitlement, context capability,
//    project scope and organisation isolation are still enforced.
// Managed documents never depend on any consuming module: Projects, Pipeline, Commercial, IMS and
// Workshop supply context and permissions; Core owns the document infrastructure.
import {actorContext} from './context';
import {audit} from './audit';
import {fail} from './http';
import {can,type Capability} from './permissions';
import {getEntitlements} from './entitlements';
import {usable,writable} from './modules';
import {query,one,exec,tx,nowIso,uuid,type Row,type Conn} from './sql';
import {canAccessProject,projectFilter} from './project-access';
import {canViewClients,visibleClientIds} from './clients';
import {assertStorable,authoriseDocumentRow,streamDocument,insertPhysicalDocument,storageKey,putObject,discardUploadedObject,sha256Of,DOCUMENT_CONTEXT_MODULE,documentContextsForAccess,fieldDocumentContextsForAccess,type DocumentContext} from './documents';

const actor=()=>actorContext.getStore()!;
const trim=(v:unknown,n:number)=>typeof v==='string'?v.trim().slice(0,n):'';
const opt=(v:unknown,n:number)=>trim(v,n)||null;

/** Contexts a managed document may be owned by. Each is backed by a real record (or is company-level). */
export const MANAGED_CONTEXTS=['organisation','library','project','tender','variation','claim','action'] as const;
export type ManagedContext=typeof MANAGED_CONTEXTS[number];
export const isManagedContext=(v:string):v is ManagedContext=>(MANAGED_CONTEXTS as readonly string[]).includes(v);
/** Record types a document may be linked to. */
export const LINK_TARGETS=['project','tender','client','variation','claim','action','asset'] as const;
export type LinkTarget=typeof LINK_TARGETS[number];
const RELATIONSHIP=/^[a-z][a-z0-9_]{0,39}$/;
const REVISION_LABEL=/^[A-Za-z0-9][A-Za-z0-9 ._/()+-]{0,39}$/;

export type ContentInput=File|{fileName:string;contentType?:string;bytes:Uint8Array|ArrayBuffer};
async function readContent(c:ContentInput){
 if(typeof File!=='undefined'&&c instanceof File){const bytes=new Uint8Array(await c.arrayBuffer());return {fileName:c.name,contentType:c.type||'application/octet-stream',bytes};}
 const g=c as Exclude<ContentInput,File>;
 if(!g||typeof g.fileName!=='string'||!g.bytes)fail(400,'Choose a file to upload.');
 return {fileName:g.fileName,contentType:g.contentType||'application/octet-stream',bytes:g.bytes instanceof Uint8Array?g.bytes:new Uint8Array(g.bytes)};
}

// ---------------------------------------------------------------- normalisation
export function normaliseTags(v:unknown):string[]{
 const raw=Array.isArray(v)?v:typeof v==='string'?v.split(','):[];
 const seen=new Set<string>(),out:string[]=[];
 for(const t of raw){const tag=trim(t,40).replace(/\s+/g,' ');const key=tag.toLowerCase();if(tag&&!seen.has(key)){seen.add(key);out.push(tag);}if(out.length>=20)break;}
 return out;
}
function versionMeta(input:{revisionLabel?:unknown;issueDate?:unknown;author?:unknown;company?:unknown;changeNote?:unknown}){
 const revisionLabel=opt(input.revisionLabel,40);
 if(revisionLabel&&!REVISION_LABEL.test(revisionLabel))fail(400,'Revision labels may use letters, numbers, spaces and . _ - / ( ) +');
 const issueDate=opt(input.issueDate,10);
 if(issueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)||Number.isNaN(Date.parse(issueDate))))fail(400,'Issue date must be a valid date.');
 return {revisionLabel,issueDate,author:opt(input.author,120),company:opt(input.company,120),changeNote:opt(input.changeNote,5000)};
}

// ---------------------------------------------------------------- targets (contexts and links)
export type Target={type:string;id:string;projectId:string|null;label:string};
/**
 * Resolves a record the actor may see. 404 when it does not exist in the organisation, is out of the
 * actor's project scope, or belongs to a module/capability the actor lacks. Used for owning contexts
 * and for links, so a link target can never be probed across tenants or projects.
 */
export async function resolveTarget(type:string,id:string,conn?:Conn):Promise<Target>{
 const a=actor(),org=a.organisationId,e=await getEntitlements(org),nf=()=>fail(404,'Record not found.');
 const ok=(module:Parameters<typeof usable>[1],cap:Parameters<typeof can>[1])=>{if(!usable(e,module)||!can(a.role,cap))nf();};
 if(!id||id.length>191)nf();
 switch(type){
  case 'project':{ok('projects','project.view');const r=await one('SELECT id,name FROM jobs WHERE organisation_id=? AND id=?',[org,id],conn);if(!r||!await canAccessProject(id,undefined,conn))nf();return {type,id,projectId:id,label:String(r!.name)};}
  case 'tender':{ok('pipeline','pipeline.view');const r=await one('SELECT id,title FROM tenders WHERE organisation_id=? AND id=?',[org,id],conn);if(!r)nf();return {type,id,projectId:null,label:String(r!.title)};}
  case 'client':{if(!usable(e,'core')||!canViewClients(a.role))nf();const r=await one("SELECT id,name FROM clients WHERE organisation_id=? AND id=? AND status<>'merged'",[org,id],conn);const ids=await visibleClientIds(conn);if(!r||(ids&&!ids.includes(id)))nf();return {type,id,projectId:null,label:String(r!.name)};}
  case 'variation':{ok('commercial','commercial.view');const r=await one('SELECT id,project_id,reference,title FROM project_variations WHERE organisation_id=? AND id=?',[org,id],conn);if(!r||!await canAccessProject(r.project_id,undefined,conn))nf();return {type,id,projectId:r!.project_id,label:`${r!.reference} — ${r!.title}`};}
  case 'claim':{ok('commercial','commercial.view');const r=await one('SELECT id,project_id,number,period FROM progress_claims WHERE organisation_id=? AND id=?',[org,id],conn);if(!r||!await canAccessProject(r.project_id,undefined,conn))nf();return {type,id,projectId:r!.project_id,label:`Claim ${r!.number} — ${r!.period}`};}
  case 'action':{ok('ims','hseq.view');const r=await one('SELECT id,project_id,action FROM hseq_actions WHERE organisation_id=? AND id=?',[org,id],conn);if(!r||!await canAccessProject(r.project_id,undefined,conn))nf();return {type,id,projectId:r!.project_id||null,label:String(r!.action).slice(0,120)};}
  case 'asset':{if(!(usable(e,'operations')||usable(e,'workshop'))||!(can(a.role,'workshop.view')||can(a.role,'schedule.view')))nf();const r=await one('SELECT id,name,plant_number FROM plant WHERE organisation_id=? AND id=?',[org,id],conn);if(!r)nf();return {type,id,projectId:null,label:[r!.plant_number,r!.name].filter(Boolean).join(' · ')};}
 }
 return nf();
}

// ---------------------------------------------------------------- access
type Managed=Row;
const asFileRow=(m:Managed,file:Row)=>({context_type:m.context_type,context_id:m.context_id,project_id:m.project_id,visibility:file.visibility,status:'current'});
/** The managed document plus its current physical file, or 404. Access = the owning context only. */
async function loadManaged(id:string,conn?:Conn,lock=false):Promise<{m:Managed;file:Row|null}>{
 const a=actor();
 const m=await one(`SELECT * FROM managed_documents WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[a.organisationId,String(id||'')],conn);
 if(!m)fail(404,'Document not found.');
 const file=m!.current_version_id?await one('SELECT f.* FROM document_versions v JOIN documents f ON f.organisation_id=v.organisation_id AND f.id=v.file_document_id WHERE v.organisation_id=? AND v.id=? AND v.managed_document_id=?',[a.organisationId,m!.current_version_id,m!.id],conn):null;
 return {m:m!,file};
}
async function authoriseRead(m:Managed,file:Row|null,conn?:Conn){
 if(!file)fail(404,'Document not found.');
 try{await authoriseDocumentRow(asFileRow(m,file!),conn);}catch{fail(404,'Document not found.');}
}
/** The capability that legitimately mutates each owning business domain. Document capabilities alone never suffice. */
export const CONTEXT_WRITE_CAPABILITY:Record<ManagedContext,Capability>={organisation:'library.edit',library:'library.edit',project:'project.edit',tender:'pipeline.edit',variation:'variation.edit',claim:'claim.edit',action:'hseq.edit'};
/** The single context-write gate: the owning context's mutation capability. Applies to generated artifacts too. */
function assertManagedContextWritable(contextType:string){
 const a=actor(),cap=isManagedContext(contextType)?CONTEXT_WRITE_CAPABILITY[contextType]:null;
 if(!cap||!can(a.role,cap))fail(403,contextType==='organisation'||contextType==='library'?'You are not authorised to manage company documents.':'You are not authorised to change documents owned by this record.');
}
/** Writing needs read access, a writable module and the owning context's mutation capability. */
async function assertWritable(m:Managed,file:Row|null,conn?:Conn){
 await authoriseRead(m,file,conn);
 const a=actor(),e=await getEntitlements(a.organisationId);
 if(a.role==='field')fail(404,'Document not found.');
 if(!writable(e,DOCUMENT_CONTEXT_MODULE[m.context_type as DocumentContext]))fail(403,'This module is read-only or disabled. Existing documents remain available where permitted.');
 assertManagedContextWritable(m.context_type);
}
const mayWrite=async(m:Managed,file:Row|null)=>{try{await assertWritable(m,file);return true;}catch{return false;}};

// ---------------------------------------------------------------- shapes
const parseTags=(s:unknown):string[]=>{try{const v=JSON.parse(String(s||'[]'));return Array.isArray(v)?v.map(String):[];}catch{return [];}};
const downloadUrl=(id:string,versionId:string)=>`/api/managed-documents?id=${encodeURIComponent(id)}&versionId=${encodeURIComponent(versionId)}&download=1`;
function publicManaged(m:Row,extra:{contextName?:string|null}={}){
 return {id:m.id,title:m.title,description:m.description??null,documentNumber:m.document_number??null,documentType:m.document_type??null,discipline:m.discipline??null,tags:parseTags(m.tags),status:m.status,
  contextType:m.context_type,contextId:m.context_id??null,projectId:m.project_id??null,contextName:extra.contextName??null,revision:Number(m.revision),createdAt:m.created_at,updatedAt:m.updated_at,
  current:m.current_version_id?{versionId:m.current_version_id,versionNumber:Number(m.version_number),revisionLabel:m.revision_label??null,issueDate:m.issue_date??null,fileName:m.file_name,sizeBytes:Number(m.size_bytes),contentType:m.content_type,fileDocumentId:m.file_document_id,visibility:m.file_visibility,url:downloadUrl(m.id,m.current_version_id)}:null};
}
async function contextNames(rows:Row[]){
 const org=actor().organisationId;
 const projectIds=[...new Set(rows.map(r=>r.project_id).filter(Boolean))] as string[],tenderIds=[...new Set(rows.filter(r=>r.context_type==='tender').map(r=>r.context_id).filter(Boolean))] as string[];
 const [projects,tenders]=await Promise.all([
  projectIds.length?query<{id:string;name:string}>('SELECT id,name FROM jobs WHERE organisation_id=? AND id IN (?)',[org,projectIds]):[],
  tenderIds.length?query<{id:string;title:string}>('SELECT id,title FROM tenders WHERE organisation_id=? AND id IN (?)',[org,tenderIds]):[],
 ]);
 const p=new Map(projects.map(x=>[x.id,x.name])),t=new Map(tenders.map(x=>[x.id,x.title]));
 return (r:Row)=>r.project_id?p.get(r.project_id)??null:r.context_type==='tender'?t.get(r.context_id)??null:r.context_type==='organisation'||r.context_type==='library'?'Company':null;
}
const CURRENT_JOIN=`FROM managed_documents m
 JOIN document_versions v ON v.organisation_id=m.organisation_id AND v.id=m.current_version_id
 JOIN documents f ON f.organisation_id=v.organisation_id AND f.id=v.file_document_id`;
const CURRENT_COLS='m.*,v.version_number,v.revision_label,v.issue_date,v.file_document_id,f.file_name,f.size_bytes,f.content_type,f.visibility AS file_visibility';

/** Runs the DB write for a freshly uploaded object; on failure removes only that new key (best effort) and rethrows the original error. */
export async function withUploadCleanup<T>(newKey:string,write:()=>Promise<T>):Promise<T>{
 try{return await write();}catch(error){await discardUploadedObject(newKey);throw error;}
}

// ---------------------------------------------------------------- create
export type CreateInput={title?:unknown;description?:unknown;documentNumber?:unknown;documentType?:unknown;discipline?:unknown;tags?:unknown;contextType?:unknown;contextId?:unknown;visibility?:unknown;
 revisionLabel?:unknown;issueDate?:unknown;author?:unknown;company?:unknown;changeNote?:unknown;content:ContentInput;source?:string;generated?:boolean};
export async function createManagedDocument(input:CreateInput){
 const a=actor();
 if(!input.generated&&!can(a.role,'document.upload'))fail(403,'You are not authorised to upload documents.');
 if(a.role==='field')fail(404,'Document not found.');
 const contextType=String(input.contextType||'organisation');
 if(!isManagedContext(contextType))fail(400,'Unknown document context.');
 let contextId:string|null=null,projectId:string|null=null;
 if(contextType!=='organisation'&&contextType!=='library'){
  contextId=String(input.contextId||'');
  const t=await resolveTarget(contextType,contextId);projectId=t.projectId;
  assertManagedContextWritable(contextType);
  if(contextType==='project'){const p=await one('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,contextId]);if(p?.stage==='closed')fail(409,'This project is closed. Reopen it before adding documents.');}
 }
 assertManagedContextWritable(contextType);
 const content=await readContent(input.content);
 await assertStorable({name:content.fileName,size:content.bytes.byteLength},{contextType,contextId,projectId});
 const meta=versionMeta(input);
 const title=trim(input.title,255)||content.fileName.slice(0,255);
 const documentType=opt(input.documentType,80),visibility:'office'|'field'=input.visibility==='field'&&a.role!=='field'?'field':'office';
 const sha256=sha256Of(content.bytes),fileId=uuid(),mid=uuid(),vid=uuid(),now=nowIso();
 await putObject(storageKey(fileId),content.bytes,content.contentType);
 return withUploadCleanup(storageKey(fileId),()=>tx(async conn=>{
  await insertPhysicalDocument(conn,{id:fileId,key:storageKey(fileId),bytes:content.bytes,sha256,fileName:content.fileName,contentType:content.contentType,contextType:contextType as DocumentContext,contextId,projectId,category:documentType||'General',title,visibility,version:1,supersedesId:null,source:input.source||'managed',now});
  await exec("INSERT INTO managed_documents (id,organisation_id,title,description,document_number,document_type,discipline,tags,status,current_version_id,context_type,context_id,project_id,source,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',NULL,?,?,?,?,1,?,?,?)",
   [mid,a.organisationId,title,opt(input.description,5000),opt(input.documentNumber,80),documentType,opt(input.discipline,80),JSON.stringify(normaliseTags(input.tags)),contextType,contextId,projectId,input.source||'upload',a.userId,now,now],conn);
  await exec('INSERT INTO document_versions (id,organisation_id,managed_document_id,version_number,revision_label,file_document_id,sha256,issue_date,author,company,change_note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [vid,a.organisationId,mid,1,meta.revisionLabel,fileId,sha256,meta.issueDate,meta.author,meta.company,meta.changeNote,a.userId,now],conn);
  await exec('UPDATE managed_documents SET current_version_id=? WHERE organisation_id=? AND id=?',[vid,a.organisationId,mid],conn);
  await audit({event:'managed_document.created',entityType:'managed_document',entityId:mid,projectId,summary:title,after:{contextType,contextId,documentType,documentNumber:opt(input.documentNumber,80)}},conn);
  await audit({event:'managed_document.version_created',entityType:'managed_document',entityId:mid,projectId,summary:`${title} — version 1${meta.revisionLabel?` (Rev ${meta.revisionLabel})`:''}`,after:{versionId:vid,versionNumber:1,revisionLabel:meta.revisionLabel,fileDocumentId:fileId,sha256,previousVersionId:null}},conn);
  return {id:mid,versionId:vid,versionNumber:1,fileDocumentId:fileId,sha256};
 }));
}

// ---------------------------------------------------------------- new revision
export type VersionInput={content:ContentInput;revisionLabel?:unknown;issueDate?:unknown;author?:unknown;company?:unknown;changeNote?:unknown;visibility?:unknown;
 /** The version number the caller saw as current; a mismatch means someone else revised first (409). */
 expectedVersion?:number|null;generated?:boolean};
export async function addDocumentVersion(managedId:string,input:VersionInput){
 const a=actor();
 if(!input.generated&&!can(a.role,'document.manage_versions'))fail(403,'You are not authorised to upload new revisions.');
 const first=await loadManaged(managedId);
 await assertWritable(first.m,first.file);
 if(first.m.status!=='active')fail(409,'This document is archived. Restore it before adding a revision.');
 const content=await readContent(input.content);
 await assertStorable({name:content.fileName,size:content.bytes.byteLength},{contextType:first.m.context_type,contextId:first.m.context_id,projectId:first.m.project_id});
 const meta=versionMeta(input),sha256=sha256Of(content.bytes),fileId=uuid(),vid=uuid(),now=nowIso();
 await putObject(storageKey(fileId),content.bytes,content.contentType);
 return withUploadCleanup(storageKey(fileId),()=>tx(async conn=>{
  // Lock order: managed document, then its current file. Serialises concurrent revisions.
  const {m,file:prev}=await loadManaged(managedId,conn,true);
  if(m.status!=='active')fail(409,'This document is archived. Restore it before adding a revision.');
  const cur=await one('SELECT version_number FROM document_versions WHERE organisation_id=? AND id=?',[a.organisationId,m.current_version_id],conn);
  if(input.expectedVersion!=null&&Number(cur?.version_number)!==Number(input.expectedVersion))fail(409,'This document has a newer revision. Refresh and try again.');
  const max=await one('SELECT MAX(version_number) AS n FROM document_versions WHERE organisation_id=? AND managed_document_id=?',[a.organisationId,m.id],conn);
  const next=Number(max?.n||0)+1;
  const visibility:'office'|'field'=input.visibility==='field'||input.visibility==='office'?(a.role==='field'?'field':input.visibility as 'office'|'field'):(prev?.visibility==='field'?'field':'office');
  await insertPhysicalDocument(conn,{id:fileId,key:storageKey(fileId),bytes:content.bytes,sha256,fileName:content.fileName,contentType:content.contentType,contextType:m.context_type,contextId:m.context_id,projectId:m.project_id,category:m.document_type||'General',title:m.title,visibility,version:next,supersedesId:prev?.id??null,source:'managed',now});
  // Compatibility mirror only: the previous physical file becomes 'superseded'. Its object, id and hash are untouched.
  if(prev)await exec("UPDATE documents SET status='superseded',updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,prev.id],conn);
  await exec('INSERT INTO document_versions (id,organisation_id,managed_document_id,version_number,revision_label,file_document_id,sha256,issue_date,author,company,change_note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [vid,a.organisationId,m.id,next,meta.revisionLabel,fileId,sha256,meta.issueDate,meta.author,meta.company,meta.changeNote,a.userId,now],conn);
  await exec('UPDATE managed_documents SET current_version_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[vid,now,a.organisationId,m.id],conn);
  await audit({event:'managed_document.version_created',entityType:'managed_document',entityId:m.id,projectId:m.project_id,summary:`${m.title} — version ${next}${meta.revisionLabel?` (Rev ${meta.revisionLabel})`:''} is now current`.slice(0,500),
   before:{currentVersionId:m.current_version_id},after:{versionId:vid,versionNumber:next,revisionLabel:meta.revisionLabel,fileDocumentId:fileId,sha256,previousVersionId:m.current_version_id}},conn);
  return {id:m.id,versionId:vid,versionNumber:next,fileDocumentId:fileId,sha256};
 }));
}

// ---------------------------------------------------------------- metadata, archive
export async function updateManagedMetadata(id:string,input:{revision?:unknown;title?:unknown;description?:unknown;documentNumber?:unknown;documentType?:unknown;discipline?:unknown;tags?:unknown}){
 const a=actor();
 if(!can(a.role,'document.edit'))fail(403,'You are not authorised to edit document details.');
 const revision=Number(input.revision);if(!Number.isInteger(revision))fail(400,'Refresh and try again.');
 const first=await loadManaged(id);await assertWritable(first.m,first.file);
 return tx(async conn=>{
  const {m}=await loadManaged(id,conn,true);
  if(Number(m.revision)!==revision)fail(409,'This document was changed by someone else. Refresh and try again.');
  const next:Record<string,unknown>={};
  if('title' in input){const t=trim(input.title,255);if(!t)fail(400,'A title is required.');next.title=t;}
  if('description' in input)next.description=opt(input.description,5000);
  if('documentNumber' in input)next.document_number=opt(input.documentNumber,80);
  if('documentType' in input)next.document_type=opt(input.documentType,80);
  if('discipline' in input)next.discipline=opt(input.discipline,80);
  if('tags' in input)next.tags=JSON.stringify(normaliseTags(input.tags));
  const changed=Object.keys(next).filter(k=>String(next[k]??'')!==String(m[k]??''));
  if(!changed.length)return {id:m.id,revision:Number(m.revision),changed:[] as string[]};
  const now=nowIso();
  await exec(`UPDATE managed_documents SET ${changed.map(k=>`${k}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...changed.map(k=>next[k]),now,a.organisationId,m.id],conn);
  await audit({event:'managed_document.updated',entityType:'managed_document',entityId:m.id,projectId:m.project_id,summary:`${m.title}: ${changed.join(', ')}`.slice(0,500),before:Object.fromEntries(changed.map(k=>[k,m[k]??null])),after:Object.fromEntries(changed.map(k=>[k,next[k]??null]))},conn);
  return {id:m.id,revision:Number(m.revision)+1,changed};
 });
}
/** Archive/restore. There is deliberately no delete: versions may already be referenced as evidence. */
export async function setManagedArchived(id:string,archived:boolean,revision:unknown){
 const a=actor();
 if(!can(a.role,'document.edit'))fail(403,'You are not authorised to edit document details.');
 const first=await loadManaged(id);await assertWritable(first.m,first.file);
 return tx(async conn=>{
  const {m}=await loadManaged(id,conn,true);
  if(Number(m.revision)!==Number(revision))fail(409,'This document was changed by someone else. Refresh and try again.');
  const status=archived?'archived':'active';
  if(m.status===status)return {id:m.id,status,revision:Number(m.revision)};
  await exec('UPDATE managed_documents SET status=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[status,nowIso(),a.organisationId,m.id],conn);
  await audit({event:archived?'managed_document.archived':'managed_document.restored',entityType:'managed_document',entityId:m.id,projectId:m.project_id,summary:m.title,before:{status:m.status},after:{status}},conn);
  return {id:m.id,status,revision:Number(m.revision)+1};
 });
}

// ---------------------------------------------------------------- links (relevance only — never access)
export async function linkDocument(id:string,input:{targetType?:unknown;targetId?:unknown;relationship?:unknown}){
 const a=actor();
 if(!can(a.role,'document.edit'))fail(403,'You are not authorised to edit document details.');
 const targetType=String(input.targetType||'');if(!(LINK_TARGETS as readonly string[]).includes(targetType))fail(400,'Choose a record type to link.');
 const relationship=trim(input.relationship,40)||'reference';if(!RELATIONSHIP.test(relationship))fail(400,'Invalid relationship.');
 const {m,file}=await loadManaged(id);await assertWritable(m,file);
 if(m.status!=='active')fail(409,'This document is archived. Restore it before linking.');
 const target=await resolveTarget(targetType,String(input.targetId||''));
 return tx(async conn=>{
  const dup=await one('SELECT id FROM document_links WHERE organisation_id=? AND managed_document_id=? AND target_type=? AND target_id=?',[a.organisationId,m.id,target.type,target.id],conn);
  if(dup)fail(409,'This record is already linked.');
  const lid=uuid();
  await exec('INSERT INTO document_links (id,organisation_id,managed_document_id,target_type,target_id,relationship,project_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[lid,a.organisationId,m.id,target.type,target.id,relationship,target.projectId,a.userId,nowIso()],conn);
  await audit({event:'managed_document.link_added',entityType:'managed_document',entityId:m.id,projectId:m.project_id,summary:`${m.title} → ${target.type}: ${target.label}`.slice(0,500),after:{linkId:lid,targetType:target.type,targetId:target.id,relationship}},conn);
  return {id:lid};
 });
}
export async function unlinkDocument(linkId:string){
 const a=actor();
 if(!can(a.role,'document.edit'))fail(403,'You are not authorised to edit document details.');
 const link=await one('SELECT * FROM document_links WHERE organisation_id=? AND id=?',[a.organisationId,String(linkId||'')]);
 if(!link)fail(404,'Link not found.');
 const {m,file}=await loadManaged(link!.managed_document_id);await assertWritable(m,file);
 return tx(async conn=>{
  await exec('DELETE FROM document_links WHERE organisation_id=? AND id=?',[a.organisationId,link!.id],conn);
  await audit({event:'managed_document.link_removed',entityType:'managed_document',entityId:m.id,projectId:m.project_id,summary:`${m.title} ✕ ${link!.target_type}`,before:{linkId:link!.id,targetType:link!.target_type,targetId:link!.target_id}},conn);
  return {id:link!.id};
 });
}

// ---------------------------------------------------------------- reads
export async function getManagedDocument(id:string){
 const a=actor();
 const {m,file}=await loadManaged(id);
 await authoriseRead(m,file);
 const versions=await query(`SELECT v.*,f.file_name,f.size_bytes,f.content_type,f.visibility,u.name AS created_by_name FROM document_versions v
  JOIN documents f ON f.organisation_id=v.organisation_id AND f.id=v.file_document_id LEFT JOIN users u ON u.id=v.created_by AND u.organisation_id=v.organisation_id
  WHERE v.organisation_id=? AND v.managed_document_id=? ORDER BY v.version_number DESC`,[a.organisationId,m.id]);
 // Field users only ever see field-visible file versions.
 const shown=a.role==='field'?versions.filter(v=>v.visibility==='field'):versions;
 const linkRows=a.role==='field'?[]:await query('SELECT * FROM document_links WHERE organisation_id=? AND managed_document_id=? ORDER BY created_at',[a.organisationId,m.id]);
 const links:Array<{id:string;targetType:string;targetId:string;relationship:string;label:string}>=[];let hiddenLinks=0;
 for(const l of linkRows){try{const t=await resolveTarget(l.target_type,l.target_id);links.push({id:l.id,targetType:l.target_type,targetId:l.target_id,relationship:l.relationship,label:t.label});}catch{hiddenLinks++;}}
 const cur=versions.find(v=>v.id===m.current_version_id);
 const names=await contextNames([m]);
 const full=publicManaged({...m,version_number:cur?.version_number,revision_label:cur?.revision_label,issue_date:cur?.issue_date,file_document_id:cur?.file_document_id,file_name:cur?.file_name,size_bytes:cur?.size_bytes,content_type:cur?.content_type,file_visibility:cur?.visibility},{contextName:names(m)});
 const write=await mayWrite(m,file);
 return {document:full,
  versions:shown.map(v=>({id:v.id,versionNumber:Number(v.version_number),revisionLabel:v.revision_label??null,issueDate:v.issue_date??null,author:v.author??null,company:v.company??null,changeNote:v.change_note??null,
   fileName:v.file_name,sizeBytes:Number(v.size_bytes),contentType:v.content_type,sha256:v.sha256,fileDocumentId:v.file_document_id,createdBy:v.created_by,createdByName:v.created_by_name??null,createdAt:v.created_at,current:v.id===m.current_version_id,url:downloadUrl(m.id,v.id)})),
  links,hiddenLinks,
  permissions:{canEdit:write&&can(a.role,'document.edit'),canVersion:write&&can(a.role,'document.manage_versions')&&m.status==='active'}};
}

export async function listManagedDocuments(filter:{contextType?:string|null;contextId?:string|null;projectId?:string|null;documentType?:string|null;discipline?:string|null;q?:string|null;archived?:boolean;limit?:number}){
 const a=actor(),e=await getEntitlements(a.organisationId);
 const where=['m.organisation_id=?','m.status=?'],values:unknown[]=[a.organisationId,filter.archived?'archived':'active'];
 if(filter.contextType){where.push('m.context_type=?');values.push(filter.contextType);}
 if(filter.contextId){where.push('m.context_id=?');values.push(filter.contextId);}
 if(filter.projectId){where.push('m.project_id=?');values.push(filter.projectId);}
 if(filter.documentType){where.push('m.document_type=?');values.push(filter.documentType);}
 if(filter.discipline){where.push('m.discipline=?');values.push(filter.discipline);}
 const q=String(filter.q||'').trim().toLowerCase().slice(0,160);
 for(const term of q.split(/\s+/).filter(Boolean).slice(0,6)){
  const like=`%${term.replace(/[\\%_]/g,m=>'\\'+m)}%`;
  where.push('(LOWER(m.title) LIKE ? OR LOWER(m.document_number) LIKE ? OR LOWER(m.document_type) LIKE ? OR LOWER(m.discipline) LIKE ? OR LOWER(m.tags) LIKE ? OR LOWER(m.description) LIKE ? OR LOWER(f.file_name) LIKE ? OR LOWER(v.revision_label) LIKE ?)');
  values.push(like,like,like,like,like,like,like,like);
 }
 if(a.role==='field'){const ctx=fieldDocumentContextsForAccess(e).filter(c=>isManagedContext(c));if(!ctx.length)return [];where.push("f.visibility='field'");where.push('m.context_type IN (?)');values.push(ctx);}
 else{const ctx=documentContextsForAccess(a.role,e).filter(c=>isManagedContext(c));if(!ctx.length)return [];where.push('m.context_type IN (?)');values.push(ctx);}
 const scope=await projectFilter('m.project_id',values,{allowNull:true});if(scope)where.push(scope.replace(/^ AND /,''));
 const limit=Math.min(Math.max(Number(filter.limit||200),1),500);
 const rows=await query(`SELECT ${CURRENT_COLS} ${CURRENT_JOIN} WHERE ${where.join(' AND ')} ORDER BY m.updated_at DESC LIMIT ${limit}`,values);
 const names=await contextNames(rows);
 return rows.map(r=>publicManaged(r,{contextName:names(r)}));
}

// ---------------------------------------------------------------- exact-version download / identity
async function loadVersion(m:Managed,versionId:string,conn?:Conn){
 const a=actor();
 const v=versionId==='current'?await one('SELECT * FROM document_versions WHERE organisation_id=? AND id=? AND managed_document_id=?',[a.organisationId,m.current_version_id,m.id],conn)
  :await one('SELECT * FROM document_versions WHERE organisation_id=? AND id=? AND managed_document_id=?',[a.organisationId,String(versionId||''),m.id],conn);
 if(!v)fail(404,'Document not found.');
 const f=await one('SELECT * FROM documents WHERE organisation_id=? AND id=?',[a.organisationId,v!.file_document_id],conn);
 if(!f)fail(404,'Document not found.');
 return {v:v!,f:f!};
}
/** Streams the EXACT physical file of one version — never the current file in its place. */
export async function openManagedVersion(id:string,versionId:string){
 const {m,file}=await loadManaged(id);
 await authoriseRead(m,file);
 const {f}=await loadVersion(m,versionId);
 try{await authoriseDocumentRow(f);}catch{fail(404,'Document not found.');}
 return streamDocument(f);
}
/**
 * Exact-version identity for consumers that must pin an artifact (a future client approval records
 * "version Y, file Z, sha256 H"). Authorised through the managed document's access context.
 */
export async function getManagedVersion(id:string,versionId:string){
 const {m,file}=await loadManaged(id);
 await authoriseRead(m,file);
 const {v,f}=await loadVersion(m,versionId);
 return {managedDocumentId:m.id,versionId:v.id,versionNumber:Number(v.version_number),revisionLabel:v.revision_label??null,fileDocumentId:f.id,sha256:v.sha256,fileName:f.file_name,contentType:f.content_type,sizeBytes:Number(f.size_bytes),current:v.id===m.current_version_id,createdAt:v.created_at};
}
