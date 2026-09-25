import {withActor} from '@/lib/platform/route';
import {requireEstimateDb} from '@/lib/estimates-db';
import {requireActor,authError} from '@/lib/authz';
export const dynamic='force-dynamic';
async function handleGET(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db),params=new URL(request.url).searchParams,kind=params.get('kind'),id=params.get('sourceId');
 if(!id||!['docket','invoice'].includes(kind||''))return Response.json({error:'Choose a saved docket or invoice.'},{status:400});
 const row=kind==='docket'?await db.prepare("SELECT id FROM dockets WHERE organisation_id=? AND id=? AND lower(status)!='archived'").bind(actor.organisationId,id).first():await db.prepare("SELECT id FROM attachments WHERE organisation_id=? AND id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='invoice'").bind(actor.organisationId,id).first();
 if(!row)return Response.json({error:'Document not found.'},{status:404});
 // Provider credentials alone must never activate paid processing. A future
 // billing implementation must issue an expiring quote, verify company balance
 // or subscription entitlement, and record consent + idempotent usage first.
 return Response.json({available:false,priceMinor:null,currency:'AUD',message:'Paid AI scanning has not been activated for this product. Standard OCR is available; no charge has been made.'});
}catch(e){return authError(e)}}
async function handlePOST(request:Request){try{await requireActor(request,requireEstimateDb(),'write');return Response.json({error:'Paid AI scanning requires configured billing and a confirmed price. No scan was started and no charge was made.'},{status:409});}catch(e){return authError(e)}}

export const GET=withActor(handleGET,'read','ai');

export const POST=withActor(handlePOST,'write','ai');
