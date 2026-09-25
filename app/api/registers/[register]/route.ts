import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listRegister,createRecord,updateRecord,transitionRecord,deleteRecord} from '@/lib/v1/register-server';
export const dynamic='force-dynamic';
// Module entitlement and capability are enforced per register inside the service.
const key=(request:Request)=>new URL(request.url).pathname.split('/').filter(Boolean).at(-1)!;
export const GET=api({permission:'field-read',module:'core'},async({request,params})=>listRegister(key(request),params));
export const POST=api({permission:'field',module:'core'},async({request})=>{
 const b=await body(request,z.object({parentId:z.string().max(191).nullable().optional(),values:z.record(z.unknown())}));
 return Response.json(await createRecord(key(request),b.parentId??null,b.values),{status:201});
});
export const PATCH=api({permission:'field',module:'core'},async({request})=>{
 const b=await body(request,z.object({id:z.string().min(1).max(191),revision:z.number().int().optional(),values:z.record(z.unknown()).optional(),transition:z.string().max(40).optional(),note:z.string().max(2000).optional()}));
 if(b.transition)return transitionRecord(key(request),b.id,b.transition,b.note);
 if(b.revision===undefined)return Response.json({error:'The record revision is required.'},{status:400});
 return updateRecord(key(request),b.id,b.revision,b.values||{});
});
export const DELETE=api({permission:'write',module:'core'},async({request,params})=>deleteRecord(key(request),String(params.get('id')||'')));
