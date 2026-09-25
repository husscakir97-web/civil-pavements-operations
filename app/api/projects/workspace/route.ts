import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {getProject,updateProject,transitionProject,recordManualBaseline} from '@/lib/modules/projects/projects';
import {projectFinancials,canSeeMoney} from '@/lib/seams/project-control';
import {query} from '@/lib/platform/sql';
export const dynamic='force-dynamic';
const opt=(n:number)=>z.string().max(n).nullable().optional();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(()=>null));
const setup=z.object({id:z.string(),revision:z.number().int(),name:z.string().max(255).optional(),clientName:opt(255),projectManagerUserId:opt(191),projectManagerName:opt(160),startDate:date,practicalCompletionDate:date,finishDate:date,siteAddress:opt(2000),contractNumber:opt(80),contractType:opt(80),retentionPct:z.coerce.number().min(0).max(100).nullable().optional(),paymentTermsDays:z.coerce.number().int().min(0).max(365).nullable().optional(),defectsMonths:z.coerce.number().int().min(0).max(240).nullable().optional(),scope:opt(20000),assumptions:opt(20000),exclusions:opt(20000),clientRequirements:opt(20000),mobilisationNotes:opt(20000)}).strict();
const money=z.coerce.number().min(0).max(1e12);
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('transition'),id:z.string(),to:z.enum(['setup','ready','active','practical_completion','closeout','closed']),reason:z.string().max(2000).optional()}),
 z.object({action:z.literal('baseline'),id:z.string(),contractValue:money,labour:money,plant:money,material:money,subcontract:money,other:money,indirect:money,reason:z.string().max(255)}),
]);
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({params,actor})=>{
 const id=String(params.get('id')||'');const detail=await getProject(id);
 const activity=await query('SELECT id,event_type,summary,actor_email,created_at FROM audit_log WHERE organisation_id=? AND project_id=? ORDER BY created_at DESC LIMIT 25',[actor.organisationId,id]);
 return {...detail,financials:await canSeeMoney()?await projectFinancials(id):null,activity};
});
export const PATCH=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>{const {id,revision,...rest}=await body(request,setup);return updateProject(id,revision,rest);});
export const POST=api({permission:'write',module:'projects'},async({request})=>{
 const b=await body(request,action);
 if(b.action==='transition')return transitionProject(b.id,b.to,b.reason);
 if(b.action==='baseline')return recordManualBaseline(b.id,b);
 return fail(400,'Unknown action.');
});
