import {api,body} from '@/lib/platform/http';
import {z} from 'zod';
import {checkKnowledge} from '@/lib/modules/core/knowledge';

export const dynamic='force-dynamic';

const schema=z.object({
 context:z.record(z.string(),z.unknown()),
 topics:z.array(z.string()).optional(),
 scope:z.object({
  projectId:z.string().nullable().optional(),
  tenderId:z.string().nullable().optional(),
  clientId:z.string().nullable().optional(),
  assetId:z.string().nullable().optional(),
  assetCategory:z.string().nullable().optional(),
 }).optional(),
 onDate:z.string().nullable().optional(),
});

export const POST=api({permission:'read',module:'core',capability:'knowledge.view'},async({request})=>{
 const b=await body(request,schema);
 return checkKnowledge(b);
});
