import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {query,one,exec,tx,uuid,nowIso,type Conn} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {assertProjectAccess,projectFilter} from '@/lib/platform/project-access';
import {projectProgram,orderActivities,responsibleUserId,type Activity} from '@/lib/v1/program';
import {canSeeMoney} from '@/lib/seams/project-control';
import {costingFields,costingValues,costingColumns,financialInputKeys,programmeNumber,programmeEstimateItems,publicProgrammeActivity} from '@/lib/v1/program-costing';
export const dynamic='force-dynamic';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Enter a valid date.');
const status=z.enum(['planned','ready','in_progress','complete','on_hold']);
const input=z.object({id:z.string().max(191).optional(),revision:z.number().int().positive().optional(),projectId:z.string().min(1).max(191),name:z.string().trim().min(1).max(180),startDate:date,durationDays:z.number().int().min(1).max(3650),predecessorId:z.string().max(191).nullable(),responsible:z.string().max(180),workPackage:z.string().max(180),resourceRequirement:z.string().max(2000),plannedQuantity:programmeNumber,quantityUnit:z.string().max(40),productionPerDay:programmeNumber,status,...costingFields});
async function validateResponsible(value:string,org:string,projectId:string,conn:Conn){
 const uid=responsibleUserId(value);if(!uid)return;
 const ok=await one('SELECT 1 AS ok FROM project_members WHERE organisation_id=? AND project_id=? AND user_id=? AND active=1 UNION SELECT 1 FROM jobs WHERE organisation_id=? AND id=? AND project_manager_user_id=? LIMIT 1',[org,projectId,uid,org,projectId,uid],conn);
 if(!ok)fail(400,'Choose the responsible person from the active project team.');
}
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({actor,params})=>{
 const scoped:unknown[]=[actor.organisationId],scope=await projectFilter('id',scoped);
 const projects=await query(`SELECT id,name FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived'${scope} ORDER BY name`,scoped);
 const projectId=params.get('projectId');
 if(!projectId)return {projects,activities:[],members:[],comments:[]};
 if(!projects.some(p=>p.id===projectId))fail(404,'Project not found.');
 const canViewCosts=await canSeeMoney();
 const project=canViewCosts?await one('SELECT metadata,source_estimate_revision_id FROM jobs WHERE organisation_id=? AND id=?',[actor.organisationId,projectId]):null;
 const [activities,members,comments]=await Promise.all([
  query<Activity&{sequence:number|null;revision:number;responsible:string}>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=?',[actor.organisationId,projectId]),
  query<{user_id:string;name:string|null;email:string;project_role:string}>("SELECT m.user_id,u.name,u.email,m.project_role FROM project_members m JOIN users u ON u.id=m.user_id AND u.organisation_id=m.organisation_id WHERE m.organisation_id=? AND m.project_id=? AND m.active=1 ORDER BY FIELD(m.project_role,'project_manager','project_engineer','site_engineer','supervisor','hseq','commercial','other'),u.name,u.email",[actor.organisationId,projectId]),
  query<{id:string;activity_id:string;summary:string;actor_user_id:string|null;actor_email:string|null;created_at:string;actor_name:string|null}>("SELECT a.id,a.entity_id AS activity_id,a.summary,a.actor_user_id,a.actor_email,a.created_at,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.organisation_id=a.organisation_id AND u.id=a.actor_user_id WHERE a.organisation_id=? AND a.project_id=? AND a.entity_type='program_activity' AND a.event_type='program.comment' ORDER BY a.created_at DESC LIMIT 500",[actor.organisationId,projectId]),
 ]);
 const memberMap=new Map(members.map(m=>[m.user_id,{id:m.user_id,name:m.name||m.email,email:m.email,projectRole:m.project_role}]));
 const rows=projectProgram(orderActivities(activities)).map(a=>{const uid=responsibleUserId(a.responsible);const m=uid?memberMap.get(uid):null;return {...publicProgrammeActivity(a,canViewCosts),responsibleUserId:m?.id??null,responsibleName:m?.name||(uid?'Former project member':a.responsible||'')};});
 return {projects,activities:rows,canViewCosts,estimateItems:project?programmeEstimateItems(project):[],members:[...memberMap.values()],comments:comments.map(c=>({id:c.id,activityId:c.activity_id,text:c.summary,actorUserId:c.actor_user_id,actorName:c.actor_name||c.actor_email||'User',createdAt:c.created_at}))};
});
export const POST=api({permission:'field-read',module:'projects',capability:'programme.edit'},async({actor,request})=>{
 const b=await body(request,input),org=actor.organisationId,id=b.id||uuid(),now=nowIso();
 const canViewCosts=await canSeeMoney();
 if(!canViewCosts&&financialInputKeys.some(k=>b[k]!==undefined))fail(403,'Financial access is required to change costing rates or estimate links.');
 await assertProjectAccess(b.projectId);
 return tx(async conn=>{
  const project=await one('SELECT id,stage,metadata,source_estimate_revision_id FROM jobs WHERE organisation_id=? AND id=? FOR UPDATE',[org,b.projectId],conn);
  if(!project)fail(404,'Project not found.');if(project.stage==='closed')fail(409,'Reopen the project before editing its programme.');
  await validateResponsible(b.responsible,org,b.projectId,conn);
  const current=await one('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=? AND id=?',[org,b.projectId,id],conn);
  if(b.id&&!current)fail(404,'Activity not found.');
  if(current&&Number(current.revision)!==b.revision)fail(409,'Activity changed. Refresh before saving.');
  const rows=await query<Activity>('SELECT * FROM program_activities WHERE organisation_id=? AND project_id=?',[org,b.projectId],conn);
  try{projectProgram([...rows.filter(r=>r.id!==id),{id,name:b.name,start_date:b.startDate,duration_days:b.durationDays,predecessor_id:b.predecessorId,status:b.status}]);}catch(e){fail(400,(e as Error).message);}
  const costValues=costingValues(b,current);
  const revisionId=costValues[3],itemId=costValues[4];
  if((revisionId===null)!==(itemId===null))fail(400,'Select an estimate item and its approved revision together.');
  if((b.sourceEstimateRevisionId!==undefined||b.sourceEstimateItemId!==undefined)&&revisionId!==null&&!programmeEstimateItems(project!).some(item=>item.revisionId===revisionId&&item.itemId===itemId))fail(400,'Choose an item from this project’s approved estimate snapshot.');
  const values=[b.name,b.startDate,b.durationDays,b.predecessorId,b.responsible,b.workPackage,b.resourceRequirement,b.plannedQuantity,b.quantityUnit,b.productionPerDay,b.status,...costValues];
  if(current)await exec('UPDATE program_activities SET name=?,start_date=?,duration_days=?,predecessor_id=?,responsible=?,work_package=?,resource_requirement=?,planned_quantity=?,quantity_unit=?,production_per_day=?,status=?,productive_hours_per_day=?,direct_cost_rate=?,cost_rate_basis=?,source_estimate_revision_id=?,source_estimate_item_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND project_id=? AND id=?',[...values,now,org,b.projectId,id],conn);
  else{const seq=await one<{n:number}>('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM program_activities WHERE organisation_id=? AND project_id=?',[org,b.projectId],conn);await exec('INSERT INTO program_activities (name,start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,status,productive_hours_per_day,direct_cost_rate,cost_rate_basis,source_estimate_revision_id,source_estimate_item_id,id,organisation_id,project_id,sequence,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',[...values,id,org,b.projectId,Number(seq?.n||1),actor.userId,now,now],conn);}
  await audit({event:'program.saved',entityType:'program_activity',entityId:id,projectId:b.projectId,summary:b.name,after:{projectId:b.projectId,revision:Number(current?.revision||0)+1,costingChanged:costingColumns.filter((c,i)=>String(current?.[c]??'')!==String(costValues[i]??''))}},conn);return {id};
 });
});

const quick=z.discriminatedUnion('action',[
 z.object({action:z.literal('reorder'),projectId:z.string().min(1).max(191),ids:z.array(z.string().max(191)).min(1).max(1000)}),
 z.object({action:z.literal('update'),projectId:z.string().min(1).max(191),id:z.string().max(191),revision:z.number().int().positive(),changes:z.object({name:z.string().trim().min(1).max(180).optional(),startDate:date.optional(),durationDays:z.number().int().min(1).max(3650).optional(),status:status.optional(),responsible:z.string().max(180).optional()}).refine(c=>Object.keys(c).length>0,'Nothing to change.')}),
 z.object({action:z.literal('duplicate'),projectId:z.string().min(1).max(191),id:z.string().max(191)}),
 z.object({action:z.literal('comment'),projectId:z.string().min(1).max(191),id:z.string().max(191),text:z.string().trim().min(1).max(500)}),
]);
const COLUMNS={name:'name',startDate:'start_date',durationDays:'duration_days',status:'status',responsible:'responsible'} as const;
export const PATCH=api({permission:'field-read',module:'projects',capability:'programme.edit'},async({actor,request})=>{
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
  if(b.action==='comment'){
   await audit({event:'program.comment',entityType:'program_activity',entityId:b.id,projectId:b.projectId,summary:b.text},conn);
   return {id:b.id};
  }
  if(b.action==='duplicate'){
   const id=uuid(),seq=Number(row!.sequence??rows.length);
   await exec('UPDATE program_activities SET sequence=sequence+1 WHERE organisation_id=? AND project_id=? AND sequence>?',[org,b.projectId,seq],conn);
   await exec("INSERT INTO program_activities (id,organisation_id,project_id,name,start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,productive_hours_per_day,direct_cost_rate,cost_rate_basis,source_estimate_revision_id,source_estimate_item_id,status,sequence,revision,created_by,created_at,updated_at) SELECT ?,organisation_id,project_id,LEFT(CONCAT(name,' (copy)'),180),start_date,duration_days,predecessor_id,responsible,work_package,resource_requirement,planned_quantity,quantity_unit,production_per_day,productive_hours_per_day,direct_cost_rate,cost_rate_basis,source_estimate_revision_id,source_estimate_item_id,'planned',?,1,?,?,? FROM program_activities WHERE organisation_id=? AND id=?",[id,seq+1,actor.userId,now,now,org,b.id],conn);
   await audit({event:'program.duplicated',entityType:'program_activity',entityId:id,projectId:b.projectId,summary:`Duplicated ${row!.name}`,after:{sourceId:b.id}},conn);
   return {id};
  }
  if(Number(row!.revision)!==b.revision)fail(409,'Activity changed. Refresh before saving.');
  const c=b.changes;
  if(c.responsible!==undefined)await validateResponsible(c.responsible,org,b.projectId,conn);
  try{projectProgram(rows.map(r=>r.id===b.id?{...r,name:c.name??r.name,start_date:c.startDate??r.start_date,duration_days:c.durationDays??r.duration_days,status:c.status??r.status}:r));}catch(e){fail(400,(e as Error).message);}
  const cols=Object.keys(c) as Array<keyof typeof COLUMNS>;
  await exec(`UPDATE program_activities SET ${cols.map(k=>`${COLUMNS[k]}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND project_id=? AND id=?`,[...cols.map(k=>c[k]),now,org,b.projectId,b.id],conn);
  await audit({event:'program.updated',entityType:'program_activity',entityId:b.id,projectId:b.projectId,summary:row!.name,before:Object.fromEntries(cols.map(k=>[k,(row as Record<string,unknown>)[COLUMNS[k]]])),after:c},conn);
  return {id:b.id};
 });
});
