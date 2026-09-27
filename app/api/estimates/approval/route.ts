import {withActor} from '@/lib/platform/route';
import {actorContext} from '@/lib/platform/context';
import {jsonError,cleanText} from '@/lib/estimates-db';
import {HttpError} from '@/lib/platform/http';
import {can} from '@/lib/platform/permissions';
import {loadEstimate,revisions,revisionSummary,submitForReview,decide} from '@/lib/modules/estimating/approval';
export const dynamic='force-dynamic';
const fail=(e:unknown)=>{if(e instanceof HttpError)return jsonError(e.message,e.status,e.details);console.error('estimate approval',e);return jsonError('The estimate approval could not be completed.',503);};
async function handleGET(request:Request){try{
 const id=cleanText(new URL(request.url).searchParams.get('estimateId'),191);if(!id)return jsonError('An estimate ID is required.');
 const est=await loadEstimate(id),money=can(actorContext.getStore()!.role,'commercial.view');
 return Response.json({estimateId:id,state:est.state,approvedRevisionId:est.approved_revision_id,awarded:Boolean(est.meta.jobId),jobId:est.meta.jobId??null,revisions:(await revisions(id)).map(r=>revisionSummary(r,money))});
}catch(e){return fail(e);}}
async function handlePOST(request:Request){try{
 const b=await request.json() as {estimateId?:string;action?:string;notes?:string};
 const id=cleanText(b.estimateId,191),notes=cleanText(b.notes,2000);
 if(!id)return jsonError('An estimate ID is required.');
 if(b.action==='submit')return Response.json(await submitForReview(id));
 if(b.action==='approve'||b.action==='reject')return Response.json(await decide(id,b.action,notes));
 return jsonError('Unknown approval action.');
}catch(e){return fail(e);}}
export const GET=withActor(handleGET,'read','estimating');
export const POST=withActor(handlePOST,'write','estimating');
