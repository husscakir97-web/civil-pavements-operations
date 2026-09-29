// Central document service. Files stay private in R2; downloads only through
// authenticated, organisation-scoped routes. Field users see field-visible files only.
import {createHash} from 'node:crypto';
import {actorContext} from './context';
import {bucket} from './storage';
import {audit} from './audit';
import {fail} from './http';
import {can,type Capability} from './permissions';
import {getEntitlements} from './entitlements';
import {usable,writable,type Entitlements,type ModuleKey} from './modules';
import {query,one,exec,tx,nowIso,uuid,type Row} from './sql';
import {canAccessProject,projectFilter} from './project-access';
// The project a document belongs to: its project_id, or the project it is attached to directly.
const documentProject=(r:Row)=>r.project_id||(r.context_type==='project'?r.context_id:null)||null;

export const MAX_DOCUMENT_BYTES=40*1024*1024;
const ALLOWED=/\.(pdf|png|jpe?g|gif|webp|heic|txt|csv|docx?|xlsx?|pptx?|zip|msg|eml|dwg|dxf)$/i;
const CONTEXTS=['organisation','library','tender','project','swms','itp','incident','ncr','action','variation','claim','requirement','returnable','clarification','checklist','field'] as const;
export type DocumentContext=typeof CONTEXTS[number];
export const isContext=(v:string):v is DocumentContext=>(CONTEXTS as readonly string[]).includes(v);
// Who may see documents attached to each kind of record. Field workers are limited to
// documents explicitly shared with the field instead; every other role needs the
// capability of the record the document belongs to (so tender pricing and claim
// evidence never reach scheduling, supervision or read-only roles).
export const DOCUMENT_CONTEXT_MODULE:Record<DocumentContext,ModuleKey>={
 organisation:'core',library:'core',
 tender:'pipeline',requirement:'pipeline',returnable:'pipeline',clarification:'pipeline',
 project:'projects',checklist:'projects',
 swms:'ims',itp:'ims',incident:'ims',ncr:'ims',action:'ims',
 variation:'commercial',claim:'commercial',
 field:'field',
};
export const documentContextsForAccess=(role:string,e:Partial<Entitlements>)=>CONTEXTS.filter(c=>can(role,CONTEXT_CAPABILITY[c])&&usable(e,DOCUMENT_CONTEXT_MODULE[c]));
const FIELD_VISIBLE_CONTEXTS:DocumentContext[]=['organisation','library','project','checklist','swms','itp','incident','ncr','action','field'];
export const fieldDocumentContextsForAccess=(e:Partial<Entitlements>)=>FIELD_VISIBLE_CONTEXTS.filter(c=>usable(e,DOCUMENT_CONTEXT_MODULE[c]));

export const CONTEXT_CAPABILITY:Record<DocumentContext,Capability>={
 organisation:'project.view',library:'project.view',project:'project.view',checklist:'project.view',field:'project.view',
 tender:'pipeline.view',requirement:'pipeline.view',returnable:'pipeline.view',clarification:'pipeline.view',
 swms:'hseq.view',itp:'hseq.view',incident:'hseq.view',ncr:'hseq.view',action:'hseq.view',
 variation:'commercial.view',claim:'commercial.view',
};
export const documentContextsFor=(role:string)=>CONTEXTS.filter(c=>can(role,CONTEXT_CAPABILITY[c]));

export function publicDocument(r:Row){return {id:r.id,title:r.title,fileName:r.file_name,contentType:r.content_type,sizeBytes:Number(r.size_bytes),category:r.category,version:Number(r.version),status:r.status,visibility:r.visibility,source:r.source,contextType:r.context_type,contextId:r.context_id,projectId:r.project_id,contextName:r.context_name??null,uploadedBy:r.uploaded_by,uploadedByName:r.uploaded_by_name??null,createdAt:r.created_at,url:`/api/documents?id=${encodeURIComponent(r.id)}`};}

export async function storeDocument(file:File,meta:{contextType:DocumentContext;contextId?:string|null;projectId?:string|null;category?:string;title?:string;visibility?:'office'|'field';supersedesId?:string|null;source?:string}){
 const actor=actorContext.getStore()!;
 const entitlements=await getEntitlements(actor.organisationId),module=DOCUMENT_CONTEXT_MODULE[meta.contextType];
 if(!writable(entitlements,module))fail(403,'This module is read-only or disabled. Existing documents remain available where permitted.');
 if(!file.size)fail(400,'The file is empty.');
 if(file.size>MAX_DOCUMENT_BYTES)fail(413,'Files must be 40 MB or smaller.');
 if(actor.role==='field'&&meta.contextType!=='field')fail(404,'Not found.');
 if((meta.contextType==='organisation'||meta.contextType==='library')&&!can(actor.role,'library.edit'))fail(403,'You are not authorised to manage company documents.');
 if(actor.role!=='field'&&!can(actor.role,CONTEXT_CAPABILITY[meta.contextType]))fail(403,'You are not authorised to attach documents to this record.');
 if(!await canAccessProject(documentProject({project_id:meta.projectId,context_type:meta.contextType,context_id:meta.contextId})))fail(404,'Project not found.');
 if(!ALLOWED.test(file.name))fail(415,'This file type is not accepted. Use PDF, image, Office, CSV, text or ZIP files.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const id=uuid(),key=`documents/${actor.organisationId}/${id}`,now=nowIso();
 const visibility=actor.role==='field'?'field':meta.visibility||'office';
 await bucket.put(key,bytes,{httpMetadata:{contentType:file.type||'application/octet-stream'}});
 return tx(async conn=>{
  let version=1;
  if(meta.supersedesId){
   const prev=await one('SELECT id,version,status,visibility,uploaded_by,context_type,context_id FROM documents WHERE organisation_id=? AND id=? FOR UPDATE',[actor.organisationId,meta.supersedesId],conn);
   if(!prev||(actor.role==='field'&&prev.visibility!=='field'))fail(404,'Document to replace not found.');
   // Only the original uploader or a document approver may publish a new version.
   if(prev!.uploaded_by!==actor.userId&&!can(actor.role,'document.approve'))fail(403,'Only the person who uploaded this document or a document approver can replace it.');
   if(prev!.status!=='current')fail(409,'This document has already been replaced. Upload against the current version.');
   if(prev!.context_type!==meta.contextType||(prev!.context_id||null)!==(meta.contextId||null))fail(409,'A new version must stay attached to the same record.');
   version=Number(prev!.version)+1;
   await exec("UPDATE documents SET status='superseded',updated_at=? WHERE organisation_id=? AND id=?",[now,actor.organisationId,prev!.id],conn);
  }
  const row={id,organisation_id:actor.organisationId,context_type:meta.contextType,context_id:meta.contextId||null,project_id:meta.projectId||null,category:(meta.category||'General').slice(0,60),title:(meta.title||file.name).slice(0,255),file_name:file.name.slice(0,255),content_type:(file.type||'application/octet-stream').slice(0,120),size_bytes:file.size,storage_key:key,sha256,version,status:'current',visibility,source:meta.source||'upload',supersedes_id:meta.supersedesId||null,uploaded_by:actor.userId,created_at:now,updated_at:now};
  const cols=Object.keys(row);
  await exec(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,Object.values(row),conn);
  await audit({event:'document.uploaded',entityType:'document',entityId:id,projectId:row.project_id,summary:`${row.title} (v${version})`,after:{contextType:row.context_type,contextId:row.context_id,sha256,version}},conn);
  return publicDocument(row);
 });
}

export async function listDocuments(filter:{contextType?:string|null;contextId?:string|null;projectId?:string|null;includeSuperseded?:boolean;q?:string|null;category?:string|null;limit?:number}){
 const actor=actorContext.getStore()!,entitlements=await getEntitlements(actor.organisationId);
 const where=['d.organisation_id=?'],values:unknown[]=[actor.organisationId];
 if(filter.contextType){where.push('d.context_type=?');values.push(filter.contextType);}
 if(filter.contextId){where.push('d.context_id=?');values.push(filter.contextId);}
 if(filter.projectId){where.push('d.project_id=?');values.push(filter.projectId);}
 if(filter.category){where.push('d.category=?');values.push(filter.category);}
 if(!filter.includeSuperseded)where.push("d.status='current'");
 const q=String(filter.q||'').trim().toLowerCase().slice(0,160);
 if(q){for(const term of q.split(/\s+/).filter(Boolean).slice(0,6)){const like=`%${term.replace(/[\\%_]/g,m=>'\\'+m)}%`;where.push('(LOWER(d.title) LIKE ? OR LOWER(d.file_name) LIKE ? OR LOWER(d.category) LIKE ? OR LOWER(d.context_type) LIKE ?)');values.push(like,like,like,like);}}
 if(actor.role==='field'){const ctx=fieldDocumentContextsForAccess(entitlements);if(!ctx.length)return [];where.push("d.visibility='field'");where.push('d.context_type IN (?)');values.push(ctx);}
 else{const ctx=documentContextsForAccess(actor.role,entitlements);if(!ctx.length)return [];where.push('d.context_type IN (?)');values.push(ctx);}
 const scope=await projectFilter("COALESCE(d.project_id,CASE WHEN d.context_type='project' THEN d.context_id END)",values,{allowNull:true});if(scope)where.push(scope.replace(/^ AND /,''));
 const limit=Math.min(Math.max(Number(filter.limit||200),1),500);
 const rows=await query(`SELECT d.* FROM documents d WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ${limit}`,values);
 const projectIds=[...new Set(rows.map(r=>r.project_id||(r.context_type==='project'?r.context_id:null)).filter(Boolean))] as string[];
 const tenderIds=[...new Set(rows.filter(r=>r.context_type==='tender').map(r=>r.context_id).filter(Boolean))] as string[];
 const userIds=[...new Set(rows.map(r=>r.uploaded_by).filter(Boolean))] as string[];
 const [projects,tenders,users]=await Promise.all([
  projectIds.length?query<{id:string;name:string}>('SELECT id,name FROM jobs WHERE organisation_id=? AND id IN (?)',[actor.organisationId,projectIds]):[],
  tenderIds.length?query<{id:string;title:string}>('SELECT id,title FROM tenders WHERE organisation_id=? AND id IN (?)',[actor.organisationId,tenderIds]):[],
  userIds.length?query<{id:string;name:string|null;email:string}>('SELECT id,name,email FROM users WHERE organisation_id=? AND id IN (?)',[actor.organisationId,userIds]):[],
 ]);
 const projectName=new Map(projects.map(p=>[p.id,p.name])),tenderName=new Map(tenders.map(t=>[t.id,t.title])),userName=new Map(users.map(u=>[u.id,u.name||u.email]));
 return rows.map(r=>publicDocument({...r,context_name:(r.project_id||r.context_type==='project')?projectName.get(r.project_id||r.context_id)||null:r.context_type==='tender'?tenderName.get(r.context_id)||null:null,uploaded_by_name:userName.get(r.uploaded_by)||null}));
}
export async function openDocument(id:string){
 const actor=actorContext.getStore()!,entitlements=await getEntitlements(actor.organisationId);
 const row=await one('SELECT * FROM documents WHERE organisation_id=? AND id=?',[actor.organisationId,id]);
 if(!row)fail(404,'Document not found.');
 if(actor.role==='field'&&row!.visibility!=='field')fail(403,'This file is available to office staff only.');
 const context=row!.context_type as DocumentContext,module=DOCUMENT_CONTEXT_MODULE[context];
 if(actor.role==='field'&&!fieldDocumentContextsForAccess(entitlements).includes(context))fail(404,'Document not found.');
 if(!module||!usable(entitlements,module))fail(404,'Document not found.');
 if(actor.role!=='field'&&!can(actor.role,CONTEXT_CAPABILITY[context]??'org.admin'))fail(403,'You are not authorised to open this document.');
 if(!await canAccessProject(documentProject(row!)))fail(404,'Document not found.');
 const object=await bucket.get(row!.storage_key);
 if(!object)fail(404,'The stored file is unavailable.');
 return new Response(object!.body,{headers:{'Content-Type':row!.content_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row!.file_name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
}
