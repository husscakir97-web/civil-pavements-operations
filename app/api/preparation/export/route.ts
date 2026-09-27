import {fieldPreparationDocument} from '@/lib/field-access';
import {withActor} from '@/lib/platform/route';
import { env } from '@/lib/platform/runtime';
import JSZip from 'jszip';
import { requireEstimateDb } from '@/lib/estimates-db';
import { enabled, entitlement, exact, fail, issuesFor, preparationActor, preparationError, preparationRecords } from '@/lib/preparation-db';
import { csvExport, docxExport, pdfExport, xlsxExport } from '@/lib/preparation-export';
import type { EvidenceRef } from '@/lib/preparation';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 const db=requireEstimateDb(),actor=await preparationActor(request,db),p=new URL(request.url).searchParams,records=await preparationRecords(db,actor.organisationId);
 let record=exact(records,{id:p.get('id')||'',revision:Number(p.get('revision'))});if(!record)fail('Document revision not found.',404);if(!enabled(records,entitlement(record.kind)))fail('This add-on is not enabled.',403);
 if(['field'].includes(actor.role)){
 if(p.get('format')==='zip')fail('Evidence packs are available to office staff only.',403);
 if(!record.job_id||!['plan','itp','risk','project-pack'].includes(record.kind)||!['Approved','Accepted'].includes(record.status))fail('Only approved assigned-job documents are available in Field.',403);
 const shift=await db.prepare('SELECT metadata FROM shifts WHERE id=? AND organisation_id=?').bind(p.get('shiftId')||'',actor.organisationId).first<{metadata:string}>();const meta=shift?JSON.parse(shift.metadata):{};
 if(meta.jobId!==record.job_id||!(meta.supervisorUserId===actor.userId||Array.isArray(meta.assignments)&&meta.assignments.some((a:{userId?:string})=>a.userId===actor.userId)))fail('Assigned shift access is required.',403);
 }
 if(actor.role==='field')record=fieldPreparationDocument(record);
 const format=p.get('format')||'docx',issues=actor.role==='field'?[]:issuesFor(record,records);let bytes:Uint8Array;let type='application/octet-stream';
 if(format==='docx'){bytes=await docxExport(record,issues);type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';}
 else if(format==='pdf'){try{bytes=await pdfExport(record,issues);}catch{fail('PDF export cannot represent some characters in this document. Export DOCX to retain all text.');}type='application/pdf';}
 else if(format==='xlsx'){bytes=await xlsxExport(record,issues);type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
 else if(format==='csv'){bytes=new TextEncoder().encode(csvExport(record));type='text/csv;charset=utf-8';}
 else if(format==='zip'){
  if(p.get('approved')==='true'&&(issues.length||!['Approved','Submitted'].includes(record.status)))fail('Complete review and approval before exporting an approved pack.');
  const zip=new JSZip();zip.file('Response.docx',await docxExport(record,issues));const manifest:{id:string;revision:number;title:string;status:string;attachments:{id:string;name:string;sha256:string}[]}[]=[];const pending:EvidenceRef[]=[{id:record.id,revision:record.revision},...record.data.manifest,...record.data.evidence,...record.data.rows.flatMap(r=>r.evidence)];const seen=new Set<string>();
  while(pending.length){const ref=pending.shift()!,key=`${ref.id}:${ref.revision}`;if(seen.has(key))continue;seen.add(key);const item=exact(records,ref);if(!item)fail('A selected evidence revision is unavailable.',404);const entry={id:item.id,revision:item.revision,title:item.title,status:item.status,attachments:[] as {id:string;name:string;sha256:string}[]};
   if(item.id!==record.id)zip.file(`Evidence/${item.id}-r${item.revision}.docx`,await docxExport(item,issuesFor(item,records)));
   for(const attachmentId of item.data.attachments){const attachment=await db.prepare('SELECT name,metadata FROM attachments WHERE organisation_id=? AND id=?').bind(actor.organisationId,attachmentId).first<{name:string;metadata:string}>();if(!attachment)fail('Selected evidence file is missing.',404);const meta=JSON.parse(attachment.metadata),object=await env.BUCKET?.get(meta.key);if(!object)fail('Selected original file is unavailable. Export stopped.',409);const content=new Uint8Array(await object.arrayBuffer());const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content))).map(v=>v.toString(16).padStart(2,'0')).join('');const name=attachment.name.replace(/[^a-zA-Z0-9._ -]/g,'_');zip.file(`Originals/${attachmentId}-${name}`,content);entry.attachments.push({id:attachmentId,name:attachment.name,sha256});}
   manifest.push(entry);pending.push(...item.data.evidence,...item.data.rows.flatMap(r=>r.evidence));
  }
  zip.file('manifest.json',JSON.stringify({title:record.title,status:record.status,revision:record.revision,unresolved:issues,documents:manifest},null,2));zip.file('Attachment-index.txt',manifest.flatMap(m=>[`${m.title} | ${m.id} | revision ${m.revision} | ${m.status}`,...m.attachments.map(a=>`  ${a.name} | ${a.id} | SHA256 ${a.sha256}`)]).join('\n'));zip.file('Completeness-review.txt',issues.length?'DRAFT — UNRESOLVED\n'+issues.join('\n'):'No completeness blockers detected. Export does not record submission or client acceptance.');bytes=await zip.generateAsync({type:'uint8array'});type='application/zip';
 }else fail('Unsupported export format.',400);
 await db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'preparation.export','recorded',JSON.stringify({id:record.id,revision:record.revision,format,actorId:actor.userId}),new Date().toISOString()).run();
 return new Response(bytes!.buffer as ArrayBuffer,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="${record.title.replace(/[^a-zA-Z0-9_-]/g,'_')}-r${record.revision}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return preparationError(e);}}

export const GET=withActor(handleGET,'field-read');
