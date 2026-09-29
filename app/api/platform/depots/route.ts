import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listDepots,saveDepot,depotInput} from '@/lib/platform/depots';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'core'},async()=>listDepots());
export const POST=api({permission:'write',module:'core'},async({request})=>{const b=await body(request,z.object({id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),depot:depotInput}));return saveDepot(b.id||null,b.revision??null,b.depot);});
