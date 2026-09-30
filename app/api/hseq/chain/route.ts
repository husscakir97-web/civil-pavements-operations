import {api,fail} from '@/lib/platform/http';
import {getChain,startInvestigation,updateInvestigation,completeInvestigation,reopenInvestigation,createActionFromSource,reviewAction,closeSource} from '@/lib/modules/hseq/corrective';
export const dynamic='force-dynamic';
// HSEQ investigation & corrective-action chain (IMS entitlement). Capability, scope and gate checks
// live in lib/modules/hseq/corrective.ts; every call re-resolves the source record.
export const GET=api({permission:'read',module:'ims',capability:'hseq.view'},async({params})=>getChain(String(params.get('sourceType')||''),String(params.get('sourceId')||'')));
export const POST=api({permission:'write',module:'ims'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b||typeof b!=='object')fail(400,'Invalid request.');
 const s=(k:string)=>String(b![k]??'');
 switch(b!.action){
  case 'startInvestigation':return Response.json(await startInvestigation(s('sourceType'),s('sourceId'),b!),{status:201});
  case 'updateInvestigation':return updateInvestigation(s('id'),b!.revision,(b!.values??{}) as Record<string,unknown>);
  case 'completeInvestigation':return completeInvestigation(s('id'),b!.revision);
  case 'reopenInvestigation':return reopenInvestigation(s('id'),b!.reason);
  case 'addAction':return Response.json(await createActionFromSource(s('sourceType'),s('sourceId'),b!),{status:201});
  case 'reviewAction':return reviewAction(s('id'),b!);
  case 'close':return closeSource(s('sourceType'),s('sourceId'),b!);
 }
 fail(400,'Unknown HSEQ action.');
});
