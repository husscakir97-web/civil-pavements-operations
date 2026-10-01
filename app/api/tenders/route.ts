import {changeTenderFiles} from '@/lib/tender-files';
import {withActor} from '@/lib/platform/route';
import { requireActor } from '@/lib/authz';
import {env} from '@/lib/platform/runtime';
import {currentOrganisationId as ORG,requireEstimateDb,jsonError} from '@/lib/estimates-db';
import {tenderPack,aiConfigured} from '@/lib/tender-db';
import {tenderDifferences,type TenderDoc} from '@/lib/tender';
import {checkUpload,safeContentType,attachmentHeaders,TENDER_UPLOAD_NAME,previewablePdf,inlinePdfHeaders,objectBytes} from '@/lib/platform/upload-safety';
export const dynamic='force-dynamic';
async function handleGET(req:Request){try{const db=requireEstimateDb(); await requireActor(req,db,'read');const p=new URL(req.url).searchParams;const {docs,removed}=await tenderPack(p.get('opportunityId')||'',true);const fileId=p.get('fileId');if(fileId){const doc=docs.find(d=>d.id===fileId);if(!doc?.key)return jsonError('File not found',404);const object=await env.BUCKET?.get(doc.key);if(!object)return jsonError('Original file unavailable',404);// Always a download with a fixed, extension-derived type: stored (client-declared) types and legacy rows are never trusted.
if(p.get('preview')==='pdf'){const bytes=await objectBytes(object) as Uint8Array<ArrayBuffer>;// Viewer-only inline mode: a validated PDF is shown as application/pdf; anything else is still a download.
if(previewablePdf(doc.name,bytes))return new Response(bytes,{headers:inlinePdfHeaders(doc.name)});return new Response(bytes,{headers:attachmentHeaders(doc.name,safeContentType(doc.name))});}
return new Response(object.body,{headers:attachmentHeaders(doc.name,safeContentType(doc.name))});}return Response.json({documents:docs.map(d=>{const out={...d};delete out.key;return out;}),removedDocuments:removed.map(d=>({id:d.id,name:d.name,size:d.size})),aiStatus:aiConfigured()?'AI configured':'AI not configured',changes:tenderDifferences(docs)},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error(e);return jsonError('Tender pack could not be loaded',503);}}
async function handlePOST(req:Request){try{const db=requireEstimateDb(); await requireActor(req,db,'write');const form=await req.formData();const opportunityId=String(form.get('opportunityId')||'');await tenderPack(opportunityId);const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>40*1024*1024)return jsonError('Choose a file between 1 byte and 40 MB.');if(!env.BUCKET)return jsonError('File storage unavailable',503);const bytes=new Uint8Array(await file.arrayBuffer()),verdict=checkUpload(file.name,bytes,TENDER_UPLOAD_NAME);if(!verdict.ok)return jsonError(verdict.reason,verdict.status);const id=crypto.randomUUID(),key=`tenders/${ORG()}/${opportunityId}/${id}`;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:verdict.contentType}});const doc:TenderDoc={id,name:file.name,key,type:verdict.contentType,size:file.size,uploadDate:new Date().toISOString(),opportunityId,kind:'tender',addendumNumber:String(form.get('addendumNumber')||'').slice(0,80),pageCount:null,processingStatus:'Uploaded',ocrStatus:'Not processed',aiStatus:aiConfigured()?'Not processed':'AI not configured',pages:[],fields:[],errors:[],revision:0};await requireEstimateDb().prepare('INSERT INTO attachments (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(id,ORG(),file.name,'active',JSON.stringify(doc),doc.uploadDate).run();const {key:unused,...publicDoc}=doc;void unused;return Response.json({document:publicDoc},{status:201});}catch(e){console.error(e);return jsonError('Upload failed. Please retry.',503);}}

export const GET=withActor(handleGET,'read','pipeline');

export const POST=withActor(handlePOST,'write','pipeline');

export const DELETE=withActor(request=>changeTenderFiles(request),'write','pipeline');
export const PATCH=withActor(request=>changeTenderFiles(request,true),'write','pipeline');
