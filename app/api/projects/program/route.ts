import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {query,one,exec,tx,uuid,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {assertProjectAccess,projectFilter} from '@/lib/platform/project-access';
import {projectProgram,orderActivities,type Activity} from '@/lib/v1/program';
export const dynamic='force-dynamic';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Enter a valid date.');
const input=z.object({id:z.string().max(191).optional(),revision:z.number().int().positive().optional(),projectId:z.string().min(1).max(191),name:z.string().trim().min(1).max(180),startDate:date,durationDays:z.number().int().min(1).max(3650),predecessorId:z.string().max(191).nullable(),responsible:z.string().max(180),workPackage:z.string().max(180),resourceRequirement:z.string().max(2000),plannedQuantity:z.number().min(0).max(1e12),quantityUnit:z.string().max(40),productionPerDay:z.number().min(0).max(1e12),status:z.enum(['planned','in_progress','complete','on_hold'])});
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({actor,params})=>{
 const scoped:unknown[]=[actor.organisationId],scope=await projectFilter('id',scoped);
 const projects=await query(`SELECT id,name FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived'${scope} ORDER BY name`,scoped);
 const projectId=params.get('projectId');
 if(!projectId)return {projects,activities:[]};
 if(!projects.some(p=>p.id===projectId))fail(404,'Project not found.');
 const activities=await query<Activity&{sequence:number|null}>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=?',[actor.organisationId,projectId]);
 return {projects,activities:projectProgram(orderActivities(activities))};
});
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({actor,request})=>{
 const b=await body(request,input),org=actor.organisationId,id=b.id||uuid(),now=nowIso();
 await assertProjectAccess(b.projectId);
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
  else{const seq=await one<{n:number}>('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM program_activities WHERE organisation_id=? AND project_id=?',[org,b.projectId],conn);await exec('INSERT INTO program_activities (name,start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,status,id,organisation_id,project_id,sequence,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',[...values,id,org,b.projectId,Number(seq?.n||1),actor.userId,now,now],conn);}
  await audit({event:'program.saved',entityType:'program_activity',entityId:id,summary:b.name,after:{projectId:b.projectId}},conn);return {id};
 });
});

// Quick edits from the programme list: reorder, one-field changes and duplicate,
// so small changes never need the full activity form. Same locks and graph checks as POST.
const quick=z.discriminatedUnion('action',[
 z.object({action:z.literal('reorder'),projectId:z.string().min(1).max(191),ids:z.array(z.string().max(191)).min(1).max(1000)}),
 z.object({action:z.literal('update'),projectId:z.string().min(1).max(191),id:z.string().max(191),revision:z.number().int().positive(),changes:z.object({name:z.string().trim().min(1).max(180).optional(),startDate:date.optional(),durationDays:z.number().int().min(1).max(3650).optional(),status:z.enum(['planned','in_progress','complete','on_hold']).optional(),responsible:z.string().max(180).optional()}).refine(c=>Object.keys(c).length>0,'Nothing to change.')}),
 z.object({action:z.literal('duplicate'),projectId:z.string().min(1).max(191),id:z.string().max(191)}),
]);
const COLUMNS={name:'name',startDate:'start_date',durationDays:'duration_days',status:'status',responsible:'responsible'} as const;
export const PATCH=api({permission:'write',module:'projects',capability:'project.edit'},async({actor,request})=>{
 const b=await body(request,quick),org=actor.organisationId,now=nowIso();
 await assertProjectAccess(b.projectId);
 return tx(async conn=>{
  const project=await one('SELECT id,stage FROM jobs WHERE organisation_id=? AND id=? FOR UPDATE',[org,b.projectId],conn);
  if(!project)fail(404,'Project not found.');if(project.stage==='closed')fail(409,'Reopen the project before editing its programme.');
  const rows=await query<Activity&{revision:number;sequence:number|null}>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=?',[org,b.projectId],conn);
  if(b.action==='reorder'){
   const known=new Set(rows.map(r=>r.id));
   if(b.ids.length!==rows.length||new Set(b.ids).size!==b.ids.length||b.ids.some(i=>!known.has(i)))fail(409,'The programme changed. Refresh and try again.');
   for(const [i,rid] of b.ids.entries())await exec('UPDATE program_activities SET sequence=?,updated_at=? WHERE organisation_id=? AND project_id=? AND id=?',[i+1,now,org,b.projectId,rid],conn);
   await audit({event:'program.reordered',entityType:'project',entityId:b.projectId,projectId:b.projectId,summary:'Programme order changed',after:{ids:b.ids}},conn);
   return {ok:true};
  }
  const row=rows.find(r=>r.id===b.id);if(!row)fail(404,'Activity not found.');
  if(b.action==='duplicate'){
   const id=uuid(),seq=Number(row!.sequence??rows.length);
   await exec('UPDATE program_activities SET sequence=sequence+1 WHERE organisation_id=? AND project_id=? AND sequence>?',[org,b.projectId,seq],conn);
   await exec("INSERT INTO program_activities (id,organisation_id,project_id,name,start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,status,sequence,revision,created_by,created_at,updated_at) SELECT ?,organisation_id,project_id,LEFT(CONCAT(name,' (copy)'),180),start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,'planned',?,1,?,?,? FROM program_activities WHERE organisation_id=? AND id=?",[id,seq+1,actor.userId,now,now,org,b.id],conn);
   await audit({event:'program.duplicated',entityType:'program_activity',entityId:id,projectId:b.projectId,summary:`Duplicated ${row!.name}`,after:{sourceId:b.id}},conn);
   return {id};
  }
  if(Number(row!.revision)!==b.revision)fail(409,'Activity changed. Refresh before saving.');
  const c=b.changes;
  try{projectProgram(rows.map(r=>r.id===b.id?{...r,name:c.name??r.name,start_date:c.startDate??r.start_date,duration_days:c.durationDays??r.duration_days,status:c.status??r.status}:r));}catch(e){fail(400,(e as Error).message);}
  const cols=Object.keys(c) as Array<keyof typeof COLUMNS>;
  await exec(`UPDATE program_activities SET ${cols.map(k=>`${COLUMNS[k]}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND project_id=? AND id=?`,[...cols.map(k=>c[k]),now,org,b.projectId,b.id],conn);
  await audit({event:'program.updated',entityType:'program_activity',entityId:b.id,projectId:b.projectId,summary:row!.name,before:Object.fromEntries(cols.map(k=>[k,(row as Record<string,unknown>)[COLUMNS[k]]])),after:c},conn);
  return {id:b.id};
 });
});
