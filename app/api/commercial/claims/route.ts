import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {listClaims,createClaim,deleteDraftClaim,transitionClaim,certifyClaim,createInvoice,invoiceAction} from '@/lib/modules/commercial/claims';
export const dynamic='force-dynamic';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),projectId:z.string(),period:z.string(),claimDate:day.nullable().optional(),notes:z.string().max(5000).nullable().optional(),lines:z.array(z.object({lineType:z.enum(['contract','variation','docket','other']),sourceId:z.string().nullable().optional(),description:z.string().max(500).optional(),thisClaim:z.coerce.number().min(-1e12).max(1e12)})).max(500),retentionRelease:z.object({amount:z.coerce.number().min(0).max(1e12),reason:z.string().max(1000)}).nullable().optional()}),
 z.object({action:z.literal('delete'),claimId:z.string()}),
 z.object({action:z.literal('transition'),claimId:z.string(),to:z.enum(['internal_approval','submitted','draft']),note:z.string().max(2000).optional()}),
 z.object({action:z.literal('certify'),claimId:z.string(),certifiedAmount:z.coerce.number().min(0).max(1e12),certifiedDate:day.nullable().optional()}),
 z.object({action:z.literal('invoice'),claimId:z.string(),invoiceNumber:z.string().max(60),invoiceDate:day,dueDate:day.nullable().optional(),gstPct:z.coerce.number().min(0).max(30).optional()}),
 z.object({action:z.literal('invoice-action'),invoiceId:z.string(),invoiceAction:z.enum(['issue','void','payment']),amount:z.coerce.number().optional(),date:day.optional()}),
]);
export const GET=api({permission:'read',module:'commercial',capability:'commercial.view'},async({params})=>listClaims(String(params.get('projectId')||'')));
export const POST=api({permission:'write',module:'commercial'},async({request})=>{
 const b=await body(request,action);
 switch(b.action){
  case 'create':return Response.json(await createClaim(b.projectId,{period:b.period,claimDate:b.claimDate,notes:b.notes,lines:b.lines,retentionRelease:b.retentionRelease}),{status:201});
  case 'delete':return deleteDraftClaim(b.claimId);
  case 'transition':return transitionClaim(b.claimId,b.to,b.note);
  case 'certify':return certifyClaim(b.claimId,b.certifiedAmount,b.certifiedDate);
  case 'invoice':return Response.json(await createInvoice(b.claimId,{invoiceNumber:b.invoiceNumber,invoiceDate:b.invoiceDate,dueDate:b.dueDate,gstPct:b.gstPct}),{status:201});
  case 'invoice-action':return invoiceAction(b.invoiceId,b.invoiceAction,b.invoiceAction==='payment'?{amount:Number(b.amount),date:String(b.date)}:undefined);
 }
 return fail(400,'Unknown action.');
});
