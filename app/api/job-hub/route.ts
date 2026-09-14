import {requireActor,authError} from '@/lib/authz';
import {requireEstimateDb,safeJson,jsonError} from '@/lib/estimates-db';
import {imsBlockers} from '@/lib/ims-readiness';
export async function GET(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db,'read'),jobId=new URL(request.url).searchParams.get('jobId');
 const jobs=await db.prepare("SELECT id,name,status FROM jobs WHERE organisation_id=? AND lower(status)!='archived' ORDER BY name").bind(actor.organisationId).all();
 if(!jobId)return Response.json({jobs:jobs.results});
 const job=await db.prepare('SELECT * FROM jobs WHERE organisation_id=? AND id=?').bind(actor.organisationId,jobId).first<Record<string,unknown>>();if(!job)return jsonError('Job not found.',404);
 const meta=safeJson<Record<string,unknown>>(job.metadata,{});
 const shifts=await db.prepare("SELECT * FROM shifts WHERE organisation_id=? AND json_extract(metadata,'$.jobId')=? ORDER BY created_at DESC").bind(actor.organisationId,jobId).all<Record<string,unknown>>();
 const dockets=await db.prepare("SELECT id,docket_no AS name,status,work_date,amount FROM dockets WHERE organisation_id=? AND json_extract(links,'$.jobId')=? ORDER BY work_date DESC").bind(actor.organisationId,jobId).all();
 const variations=await db.prepare("SELECT id,name,status,metadata FROM commercial_records WHERE organisation_id=? AND json_extract(metadata,'$.jobId')=?").bind(actor.organisationId,jobId).all();
 const claims=await db.prepare('SELECT id,claim_period AS name,status FROM claims WHERE organisation_id=? AND job_id=?').bind(actor.organisationId,jobId).all();
 const docs=await db.prepare('SELECT id,title AS name,status,revision,storage_attachment_id FROM ims_documents WHERE organisation_id=? AND job_id=?').bind(actor.organisationId,jobId).all();
 const activity=await db.prepare("SELECT id,name,created_at FROM audit_events WHERE organisation_id=? AND (json_extract(metadata,'$.jobId')=? OR json_extract(metadata,'$.recordId')=?) ORDER BY created_at DESC LIMIT 100").bind(actor.organisationId,jobId,jobId).all();
 return Response.json({jobs:jobs.results,job:{...job,metadata:meta},shifts:shifts.results.map(s=>({...s,metadata:safeJson(s.metadata,{})})),dockets:dockets.results,variations:variations.results,claims:claims.results,documents:docs.results,activity:activity.results,blockers:await imsBlockers(db,actor.organisationId,jobId)});
}catch(e){return authError(e);}}
