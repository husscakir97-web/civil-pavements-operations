import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listClients,createClient,updateClient,bulkUpdateClients,createSite,updateSite,addContact,updateContact,mergeClients,legacyClientLinks,linkLegacyRecord,searchCrm,clientInput,clientPatch,siteInput,sitePatch,contactInput} from '@/lib/platform/clients';
import {clientWork} from '@/lib/seams/client-history';
export const dynamic='force-dynamic';
// Core client master (clients, contacts, sites): picker search, CRM lists, client detail with
// its Work history, quick create and maintenance. Capability and project-scope checks live in
// lib/platform/clients.ts; the Work view lives in lib/seams/client-history.ts.
export const GET=api({permission:'read',module:'core'},async({params})=>{
 const id=params.get('id'),view=params.get('view'),q=params.get('q')||'';
 if(id)return clientWork(id);
 if(view==='contacts'||view==='sites')return searchCrm(view,q,Number(params.get('page')||1));
 if(view==='legacy')return legacyClientLinks(false);
 const limit=params.get('limit')?Number(params.get('limit')):undefined,ids=params.get('ids')?String(params.get('ids')).split(',').filter(Boolean).slice(0,50):undefined;
 return listClients(q,{limit,ids,includeInactive:params.get('inactive')==='1'});
});
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),client:clientInput}),
 z.object({action:z.literal('update'),id:z.string().max(191),revision:z.number().int(),client:clientPatch}),
 z.object({action:z.literal('bulk'),ids:z.array(z.string().max(191)).min(1).max(500),change:z.object({status:z.enum(['active','inactive']).optional(),ownerUserId:z.string().max(191).nullable().optional()})}),
 z.object({action:z.literal('createSite'),site:siteInput}),
 z.object({action:z.literal('updateSite'),id:z.string().max(191),revision:z.number().int(),site:sitePatch}),
 z.object({action:z.literal('addContact'),clientId:z.string().max(191),contact:contactInput}),
 z.object({action:z.literal('updateContact'),id:z.string().max(191),revision:z.number().int(),contact:z.record(z.unknown())}),
 z.object({action:z.literal('merge'),keepId:z.string().max(191),mergeId:z.string().max(191),confirm:z.boolean().default(false)}),
 z.object({action:z.literal('linkLegacy'),apply:z.literal(true)}),
 z.object({action:z.literal('linkRecord'),type:z.enum(['opportunities','tenders','jobs']),id:z.string().max(191),clientId:z.string().max(191)}),
]);
export const POST=api({permission:'write',module:'core'},async({request})=>{
 const a=await body(request,action);
 switch(a.action){
  case 'create':return Response.json(await createClient(a.client),{status:201});
  case 'update':return updateClient(a.id,a.revision,a.client);
  case 'bulk':return bulkUpdateClients(a.ids,a.change);
  case 'createSite':return Response.json(await createSite(a.site),{status:201});
  case 'updateSite':return updateSite(a.id,a.revision,a.site);
  case 'addContact':return Response.json(await addContact(a.clientId,a.contact),{status:201});
  case 'updateContact':return updateContact(a.id,a.revision,a.contact);
  case 'merge':return mergeClients(a.keepId,a.mergeId,a.confirm);
  case 'linkLegacy':return legacyClientLinks(true);
  case 'linkRecord':return linkLegacyRecord(a.type,a.id,a.clientId);
 }
});
