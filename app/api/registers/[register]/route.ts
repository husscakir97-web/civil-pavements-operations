import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listRegister,createRecord,updateRecord,transitionRecord,deleteRecord} from '@/lib/v1/register-server';
import {idempotent} from '@/lib/platform/idempotency';
export const dynamic='force-dynamic';
// Module entitlement and capability are enforced per register inside the service.
const key=(request:Request)=>new URL(request.url).pathname.split('/').filter(Boolean).at(-1)!;
export const GET=api({permission:'field-read',module:'core'},async({request,params})=>listRegister(key(request),params));
export const POST=api({permission:'field',module:'core'},async({request})=>{
 const b=await body(request,z.object({parentId:z.string().max(191).nullable().optional(),values:z.record(z.unknown()),clientRequestId:z.string().max(80).nullable().optional()}));
 if(!b.clientRequestId)return Response.json(await createRecord(key(request),b.parentId??null,b.values),{status:201});
 // Queued (offline) creates carry a client request id: a replay returns the original record.
 const out=await idempotent(`register.${key(request)}`,b.clientRequestId,conn=>createRecord(key(request),b.parentId??null,b.values,{conn}),r=>({type:key(request),id:String(r.record.id)}),{parentId:b.parentId??null,values:b.values});
 return Response.json({...out.result,replay:out.replay},{status:out.replay?200:201});
});
export const PATCH=api({permission:'field',module:'core'},async({request})=>{
 const b=await body(request,z.object({id:z.string().min(1).max(191),revision:z.number().int().optional(),values:z.record(z.unknown()).optional(),transition:z.string().max(40).optional(),note:z.string().max(2000).optional()}));
 if(b.transition)return transitionRecord(key(request),b.id,b.transition,b.note);
 if(b.revision===undefined)return Response.json({error:'The record revision is required.'},{status:400});
 return updateRecord(key(request),b.id,b.revision,b.values||{});
});
export const DELETE=api({permission:'write',module:'core'},async({request,params})=>deleteRecord(key(request),String(params.get('id')||'')));
