import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {today,submitFieldDocket} from '@/lib/modules/field/today';
export const dynamic='force-dynamic';
const docket=z.object({shiftId:z.string().min(1),docketNo:z.string().max(80).default(''),workDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),labourHours:z.coerce.number().min(0).max(1000).default(0),quantity:z.coerce.number().min(0).max(1e9).default(0),quantityUnit:z.string().max(20).default('item'),notes:z.string().max(1000).default(''),lines:z.array(z.object({description:z.string().max(200),quantity:z.coerce.number().min(0).max(1e9),unit:z.string().max(20).default('')})).max(50).default([]),clientRequestId:z.string().max(80).nullable().optional(),shiftVersion:z.string().max(40).nullable().optional(),capturedAt:z.string().max(40).nullable().optional()}).strict();
export const GET=api({permission:'field-read',module:'field'},async()=>today());
export const POST=api({permission:'field',module:'field',capability:'docket.submit'},async({request})=>{const r=await submitFieldDocket(await body(request,docket));return Response.json(r,{status:r.replay?200:201});});
