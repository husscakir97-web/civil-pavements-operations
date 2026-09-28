import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {query,one,exec,tx,uuid,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {projectProgram,type Activity} from '@/lib/v1/program';
export const dynamic='force-dynamic';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Enter a valid date.');
const input=z.object({id:z.string().max(191).optional(),revision:z.number().int().positive().optional(),projectId:z.string().min(1).max(191),name:z.string().trim().min(1).max(180),startDate:date,durationDays:z.number().int().min(1).max(3650),predecessorId:z.string().max(191).nullable(),responsible:z.string().max(180),workPackage:z.string().max(180),resourceRequirement:z.string().max(2000),plannedQuantity:z.number().min(0).max(1e12),quantityUnit:z.string().max(40),productionPerDay:z.number().min(0).max(1e12),status:z.enum(['planned','in_progress','complete','on_hold'])});
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({actor,params})=>{
 const projects=await query("SELECT id,name FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY name",[actor.organisationId]);
 const projectId=params.get('projectId');
 if(!projectId)return {projects,activities:[]};
 if(!projects.some(p=>p.id===projectId))fail(404,'Project not found.');
 const activities=await query<Activity>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=? ORDER BY start_date,name',[actor.organisationId,projectId]);
 return {projects,activities:projectProgram(activities)};
});
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({actor,request})=>{
 const b=await body(request,input),org=actor.organisationId,id=b.id||uuid(),now=nowIso();
 return tx(async conn=>{
  // Project lock serialises graph edits, including two concurrent dependency changes.
  const project=await one('SELECT id,stage FROM jobs WHERE organisation_id=? AND id=? FOR UPDATE',[org,b.projectId],conn);
  if(!project)fail(404,'Project not found.');if(project.stage==='closed')fail(409,'Reopen the project before editing its programme.');
  const current=await one('SELECT revision FROM program_activities WHERE organisation_id=? AND project_id=? AND id=?',[org,b.projectId,id],conn);
  if(b.id&&!current)fail(404,'Activity not found.');
  if(current&&Number(current.revision)!==b.revision)fail(409,'Activity changed. Refresh before saving.');
  const rows=await query<Activity>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=?',[org,b.projectId],conn);
  try{projectProgram([...rows.filter(r=>r.id!==id),{id,name:b.name,start_date:b.startDate,duration_days:b.durationDays,predecessor_id:b.predecessorId,status:b.status}]);}catch(e){fail(400,(e as Error).message);}
  const values=[b.name,b.startDate,b.durationDays,b.predecessorId,b.responsible,b.workPackage,b.resourceRequirement,b.plannedQuantity,b.quantityUnit,b.productionPerDay,b.status];
  if(current)await exec('UPDATE program_activities SET name=?,start_date=?,duration_days=?,predecessor_id=?,responsible=?,work_package=?,resource_requirement=?,planned_quantity=?,quantity_unit=?,production_per_day=?,status=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND project_id=? AND id=?',[...values,now,org,b.projectId,id],conn);
  else await exec('INSERT INTO program_activities (name,start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,status,id,organisation_id,project_id,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',[...values,id,org,b.projectId,actor.userId,now,now],conn);
  await audit({event:'program.saved',entityType:'program_activity',entityId:id,summary:b.name,after:{projectId:b.projectId}},conn);return {id};
 });
});
