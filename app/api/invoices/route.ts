import {withActor} from '@/lib/platform/route';
import { requireBindings } from '@/lib/dockets-db';
import { requireActor, authError } from '@/lib/authz';
import { invoiceIssues, type InvoiceDraft } from '@/lib/invoice-parser';
import { z } from 'zod';
const field=z.string().max(500);
const schema=z.object({invoiceNumber:field,supplier:field,customer:field,abn:field,invoiceDate:field,dueDate:field,poNumber:field,subtotal:field,gst:field,total:field,currency:z.literal('AUD'),direction:z.enum(['Supplier invoice','Customer invoice']),lines:z.array(z.object({description:field,quantity:field,unitPrice:field,amount:field,source:field})).max(500),pages:z.array(z.object({ref:field,text:z.string().max(100000),confidence:z.number().min(0).max(100),method:field,error:field.optional()})).max(60),warnings:z.array(field).max(100)});
async function handleGET(request:Request){try{
 const {db,bucket}=requireBindings(),actor=await requireActor(request,db);
 const id=new URL(request.url).searchParams.get('file');
 if(id){const row=await db.prepare("SELECT metadata FROM attachments WHERE organisation_id=? AND id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice'").bind(actor.organisationId,id).first<{metadata:string}>();if(!row)return Response.json({error:'Invoice not found'},{status:404});const meta=JSON.parse(row.metadata);const object=await bucket.get(meta.key);if(!object)return Response.json({error:'Original unavailable'},{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(object.body,{headers});}
 const rows=await db.prepare("SELECT id,name,status,metadata,created_at FROM attachments WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice' ORDER BY created_at DESC LIMIT 200").bind(actor.organisationId).all<{id:string;name:string;status:string;metadata:string}>();
 return Response.json({invoices:rows.results.map(r=>{const {key,...metadata}=JSON.parse(r.metadata);return {...r,metadata};})});
 }catch(e){return authError(e);}}
async function handlePOST(request:Request){try{
 const {db,bucket}=requireBindings(),actor=await requireActor(request,db,'write'),form=await request.formData(),file=form.get('file');
 if(!(file instanceof File)||!file.size||file.size>25*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))return Response.json({error:'Choose a PDF, JPG, PNG or WebP under 25 MB.'},{status:400});
 const draft=schema.parse(JSON.parse(String(form.get('draft')||'{}'))),id=crypto.randomUUID(),now=new Date().toISOString(),key=`invoices/${actor.organisationId}/${id}`;
 const duplicate=draft.invoiceNumber&&draft.supplier?await db.prepare("SELECT id FROM attachments WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice' AND lower(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.draft.invoiceNumber')))=lower(?) AND lower(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.draft.supplier')))=lower(?) LIMIT 1").bind(actor.organisationId,draft.invoiceNumber,draft.supplier).first():null;
 await bucket.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
 const metadata={kind:'invoice',key,draft,duplicate:!!duplicate,method:'Local OCR / embedded PDF text',revision:1};
 await db.batch([db.prepare('INSERT INTO attachments (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(id,actor.organisationId,file.name,'Needs Review',JSON.stringify(metadata),now),db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'invoice.uploaded','recorded',JSON.stringify({id,actor:actor.userId}),now)]);
 return Response.json({id,duplicate:!!duplicate},{status:201});
 }catch(e){if(e instanceof z.ZodError||e instanceof SyntaxError)return Response.json({error:'Invalid invoice extraction. Review or retry the document.'},{status:400});return authError(e);}}
async function handlePUT(request:Request){try{
 const {db}=requireBindings(),actor=await requireActor(request,db,'write'),body=await request.json() as {id:string;draft:InvoiceDraft;confirm?:boolean;revision:number},draft=schema.parse(body.draft);
 if(body.confirm)await requireActor(request,db,'approve');
 const row=await db.prepare("SELECT metadata,status FROM attachments WHERE organisation_id=? AND id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice'").bind(actor.organisationId,body.id).first<{metadata:string;status:string}>();if(!row)return Response.json({error:'Invoice not found'},{status:404});
 const previous=JSON.parse(row.metadata);if(previous.revision!==body.revision)return Response.json({error:'Invoice changed. Reload before saving.'},{status:409});
 const issues=invoiceIssues(draft);if(body.confirm&&issues.length)return Response.json({error:issues.join('; ')},{status:422});
 const counterparty=draft.direction==='Customer invoice'?draft.customer:draft.supplier;
 const duplicate=counterparty&&draft.invoiceNumber?await db.prepare("SELECT id FROM attachments WHERE organisation_id=? AND id!=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice' AND lower(trim(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.draft.invoiceNumber'))))=lower(trim(?)) AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.draft.direction'))=? AND lower(trim(json_extract(metadata,?)))=lower(trim(?)) LIMIT 1").bind(actor.organisationId,body.id,draft.invoiceNumber,draft.direction,draft.direction==='Customer invoice'?'$.draft.customer':'$.draft.supplier',counterparty).first():null;
 if(body.confirm&&duplicate)return Response.json({error:'Another invoice has this number and counterparty. Resolve the duplicate before confirming.'},{status:409});
 const status=body.confirm?'Confirmed':'Needs Review',metadata={...previous,draft,duplicate:!!duplicate,revision:previous.revision+1},now=new Date().toISOString();
 // Optimistic revision check prevents a stale draft replacing a newer review.
 const result=await db.prepare('UPDATE attachments SET metadata=?,status=? WHERE organisation_id=? AND id=? AND metadata=?').bind(JSON.stringify(metadata),status,actor.organisationId,body.id,row.metadata).run();if(!result.meta.changes)return Response.json({error:'Invoice changed. Reload before saving.'},{status:409});
 await db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'invoice.reviewed','recorded',JSON.stringify({id:body.id,actor:actor.userId,previous,next:metadata,status}),now).run();
 return Response.json({saved:true});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'Invalid invoice fields'},{status:400});return authError(e);}}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'write');

export const PUT=withActor(handlePUT,'write');
