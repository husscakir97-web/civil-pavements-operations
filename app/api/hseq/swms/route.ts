import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {listSwms,getSwms,createSwms,saveDraft,transitionSwms,reviseSwms,acknowledgeSwms,swmsPdf} from '@/lib/modules/hseq/swms';
export const dynamic='force-dynamic';
const text=(n=20000)=>z.string().max(n).default('');
const content=z.object({activity:text(255),location:text(255),highRiskWork:z.array(z.string().max(200)).max(20).default([]),workSteps:z.array(z.object({step:text(1000),hazards:text(5000),controls:text(5000),responsible:text(255),residualRisk:text(40)})).max(100),plant:text(),equipment:text(),substances:text(),ppe:z.array(z.string().max(60)).max(20).default([]),competencies:text(),licences:text(),permits:text(),emergency:text(),responsiblePeople:text(),review:text()});
const questionnaire=z.object({activity:z.string().trim().min(1).max(255),location:z.string().max(255).optional(),workSteps:z.array(z.string().max(1000)).max(50).optional(),highRiskWork:z.array(z.string().max(40)).max(20).optional(),plant:z.string().max(5000).optional(),equipment:z.string().max(5000).optional(),substances:z.string().max(5000).optional(),ppe:z.array(z.string().max(60)).max(20).optional(),competencies:z.string().max(5000).optional(),licences:z.string().max(5000).optional(),permits:z.string().max(5000).optional(),emergency:z.string().max(5000).optional(),responsiblePeople:z.string().max(1000).optional()});
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),projectId:z.string(),title:z.string().trim().min(1).max(255),questionnaire}),
 z.object({action:z.literal('save'),id:z.string(),revisionId:z.string(),updatedAt:z.string(),content}),
 z.object({action:z.literal('transition'),id:z.string(),to:z.enum(['review','approved','issued','draft']),note:z.string().max(2000).optional()}),
 z.object({action:z.literal('revise'),id:z.string(),reason:z.string().max(500)}),
 z.object({action:z.literal('acknowledge'),id:z.string(),shiftId:z.string().nullable().optional()}),
]);
export const GET=api({permission:'field-read',module:'ims'},async({params})=>{
 const id=params.get('id');
 if(id&&params.get('format')==='pdf')return swmsPdf(id,params.get('revisionId'));
 if(id)return getSwms(id);
 return {swms:await listSwms(params.get('projectId'))};
});
export const POST=api({permission:'field',module:'ims'},async({request})=>{
 const b=await body(request,action);
 switch(b.action){
  case 'create':return Response.json(await createSwms(b.projectId,{title:b.title,questionnaire:b.questionnaire}),{status:201});
  case 'save':return saveDraft(b.id,b.revisionId,b.content,b.updatedAt);
  case 'transition':return transitionSwms(b.id,b.to,b.note);
  case 'revise':return reviseSwms(b.id,b.reason);
  case 'acknowledge':return acknowledgeSwms(b.id,b.shiftId);
 }
 return fail(400,'Unknown action.');
});
