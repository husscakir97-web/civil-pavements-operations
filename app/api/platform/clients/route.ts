import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listClients,createClient,updateClient,createSite,clientInput,siteInput} from '@/lib/platform/clients';
export const dynamic='force-dynamic';
// Core client directory: searchable picker data plus quick create. Capability
// checks live in lib/platform/clients.ts (pipeline or project access).
export const GET=api({permission:'read',module:'core'},async({params})=>listClients(params.get('q')||''));
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),client:clientInput}),
 z.object({action:z.literal('update'),id:z.string().max(191),revision:z.number().int(),client:clientInput.partial().extend({status:z.enum(['active','inactive']).optional()})}),
 z.object({action:z.literal('createSite'),site:siteInput}),
]);
export const POST=api({permission:'write',module:'core'},async({request})=>{
 const a=await body(request,action);
 if(a.action==='create')return Response.json(await createClient(a.client),{status:201});
 if(a.action==='update')return updateClient(a.id,a.revision,a.client);
 return Response.json(await createSite(a.site),{status:201});
});
