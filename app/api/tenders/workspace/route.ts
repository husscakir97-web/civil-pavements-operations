import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {getTender,updateTender,transitionTender,saveBidReview,decideBid,createTenderEstimate,requestApproval,decideApproval,submitTender,awardTender,recordLoss,suggestRequirements} from '@/lib/modules/pipeline/tenders';
import {tenderInput} from '@/lib/modules/pipeline/schemas';
export const dynamic='force-dynamic';
const text=(n:number)=>z.string().max(n).nullable().optional();
const bid=z.object({strategic_fit:text(5000),capacity:text(5000),capability:text(5000),client_assessment:text(5000),location_assessment:text(5000),contract_risks:text(5000),programme:text(5000),resources:text(5000),commercial_risks:text(5000),hseq_risks:text(5000),competition:text(5000),recommendation_reason:text(5000),recommendation:z.enum(['bid','no_bid','conditional']).nullable().optional()}).strict();
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('transition'),id:z.string(),to:z.enum(['reviewing','draft','clarification','submitted'])}),
 z.object({action:z.literal('bid-review'),id:z.string(),values:bid}),
 z.object({action:z.literal('bid-decision'),id:z.string(),decision:z.enum(['bid','no_bid']),reason:z.string().max(5000)}),
 z.object({action:z.literal('create-estimate'),id:z.string(),mode:z.enum(['general','paving']).default('general')}),
 z.object({action:z.literal('request-approval'),id:z.string()}),
 z.object({action:z.literal('approval-decision'),id:z.string(),approve:z.boolean(),notes:z.string().max(5000).default('')}),
 z.object({action:z.literal('submit'),id:z.string(),method:z.string().max(60),version:text(40),notes:text(5000),documentId:text(191),overrideReason:text(5000)}),
 z.object({action:z.literal('award'),id:z.string()}),
 z.object({action:z.literal('lost'),id:z.string(),reason:z.string().max(5000)}),
 z.object({action:z.literal('suggest-requirements'),id:z.string()}),
]);
export const GET=api({permission:'read',module:'pipeline',capability:'pipeline.view'},async({params})=>getTender(String(params.get('id')||'')));
export const PATCH=api({permission:'write',module:'pipeline'},async({request})=>{
 const b=await body(request,tenderInput.extend({id:z.string(),revision:z.number().int()}));
 const {id,revision,...rest}=b;return updateTender(id,revision,rest);
});
export const POST=api({permission:'write',module:'pipeline'},async({request})=>{
 const b=await body(request,action);
 switch(b.action){
  case 'transition':return transitionTender(b.id,b.to);
  case 'bid-review':return saveBidReview(b.id,b.values);
  case 'bid-decision':return decideBid(b.id,b.decision,b.reason);
  case 'create-estimate':return createTenderEstimate(b.id,b.mode);
  case 'request-approval':return requestApproval(b.id);
  case 'approval-decision':return decideApproval(b.id,b.approve,b.notes);
  case 'submit':return submitTender(b.id,{method:b.method,version:b.version,notes:b.notes,documentId:b.documentId,overrideReason:b.overrideReason});
  case 'award':return awardTender(b.id);
  case 'lost':return recordLoss(b.id,b.reason);
  case 'suggest-requirements':return suggestRequirements(b.id);
 }
 return fail(400,'Unknown action.');
});
