import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listDivisions,createDivision,updateDivision,setDivisionArchived,setDefaultDivision} from '@/lib/platform/business-units';
export const dynamic='force-dynamic';
// Divisions are core (no module). Any signed-in role may list them for pickers/filters; managing them needs org.admin (checked in the service).
export const GET=api({permission:'field-read',module:'core'},async()=>listDivisions());
const text=z.string().max(1000);
export const POST=api({permission:'write',module:'core'},async({request})=>Response.json(await createDivision(await body(request,z.object({name:z.string().max(200),code:z.string().max(40),description:text.nullable().optional()}))),{status:201}));
const patch=z.discriminatedUnion('action',[
 z.object({action:z.literal('update'),id:z.string(),revision:z.number().int(),name:z.string().max(200).optional(),code:z.string().max(40).optional(),description:text.nullable().optional()}),
 z.object({action:z.literal('archive'),id:z.string(),revision:z.number().int()}),
 z.object({action:z.literal('restore'),id:z.string(),revision:z.number().int()}),
 z.object({action:z.literal('make-default'),id:z.string(),revision:z.number().int()}),
]);
export const PATCH=api({permission:'write',module:'core'},async({request})=>{
 const b=await body(request,patch);
 if(b.action==='update'){const {action:_a,id,...rest}=b;void _a;return updateDivision(id,rest);}
 if(b.action==='make-default')return setDefaultDivision(b.id,b.revision);
 return setDivisionArchived(b.id,b.action==='archive',b.revision);
});
