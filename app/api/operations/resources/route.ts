import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {listWorkers,listPlant,listIssues,saveWorker,savePlant,saveCompetency,revokeCompetency,resolveIssue} from '@/lib/modules/operations/resources';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'operations',capability:'schedule.view'},async({params})=>{
 const kind=params.get('kind');
 if(kind==='workers')return listWorkers();
 if(kind==='plant')return listPlant();
 if(kind==='issues')return listIssues(params.get('status')==='resolved'?'resolved':'open');
 fail(400,'Choose workers, plant or issues.');
});
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('saveWorker'),id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),worker:z.record(z.string(),z.unknown())}),
 z.object({action:z.literal('savePlant'),id:z.string().max(191).nullable().optional(),revision:z.number().int().nullable().optional(),plant:z.record(z.string(),z.unknown())}),
 z.object({action:z.literal('saveCompetency'),workerId:z.string().max(191),id:z.string().max(191).nullable().optional(),competency:z.record(z.string(),z.unknown())}),
 z.object({action:z.literal('revokeCompetency'),workerId:z.string().max(191),id:z.string().max(191),reason:z.string().max(500)}),
 z.object({action:z.literal('resolveIssue'),id:z.string().max(191),note:z.string().max(500).default('')}),
]);
export const POST=api({permission:'write',module:'operations',capability:'resources.edit'},async({request})=>{
 const b=await body(request,action);
 switch(b.action){
  case 'saveWorker':return saveWorker(b.id||null,b.revision??null,b.worker);
  case 'savePlant':return savePlant(b.id||null,b.revision??null,b.plant);
  case 'saveCompetency':return saveCompetency(b.workerId,b.id||null,b.competency);
  case 'revokeCompetency':return revokeCompetency(b.workerId,b.id,b.reason);
  case 'resolveIssue':return resolveIssue(b.id,b.note);
 }
});
