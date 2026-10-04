// Planning v0.1 (docs/PLANNING-V0-1-DECISION.md): undated methodology plans with scenarios.
// Estimating module; standalone (works with every other module disabled). Server-side financial redaction on every
// response and export; saves are version-checked; nothing here writes to estimates, projects, resources or bookings.
import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {query,exec,tx,uuid,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {can} from '@/lib/platform/permissions';
import {ID_PATTERN,emptyDocument,type PlanDocument} from '@/lib/v1/planning';
import {assertLinks,bump,canSeePlanRates,copyDocument,loadDocument,loadPlan,loadScenario,planCsv,planVisibleTo,present,writeDocument,writePositions,type PlanRow,type ScenarioRow} from '@/lib/modules/estimating/planning';
export const dynamic='force-dynamic';

const id=z.string().regex(ID_PATTERN);
// Transport-level bounds only: precision, scale and per-field ranges are enforced by validatePlan (lib/v1/planning.ts), the one contract shared with the browser and with migration 0026.
const amount=z.number().finite().min(0).max(999_999_999).nullable();
const text=(max:number)=>z.string().max(max);
const unit=z.string().trim().max(20).nullable();
const activity=z.object({
 id,kind:z.enum(['activity','milestone']),name:text(180),notes:text(4000),
 quantity:amount,unit,productivity:amount,productivityUnit:unit,durationMode:z.enum(['entered','derived']),durationDays:amount,hoursPerDay:amount,
 plannedStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
 requirements:z.array(z.object({id,kind:z.enum(['labour','plant']),name:text(180),quantity:amount,rate:amount,rateBasis:z.enum(['hour','day']),resourceRef:z.object({type:z.enum(['worker','plant']),id:z.string().min(1).max(191)}).nullable()})).max(30),
 costItems:z.array(z.object({id,label:text(180),amount})).max(20),
 sharedCostIds:z.array(id).max(50),
});
const documentSchema=z.object({
 activities:z.array(activity).max(200),
 dependencies:z.array(z.object({from:id,to:id})).max(600),
 sharedCosts:z.array(z.object({id,label:text(180),amount})).max(50),
});
const link=z.string().min(1).max(191).nullable();
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('create-plan'),name:z.string().trim().min(1).max(180),accessScope:z.enum(['organisation','owner']).default('organisation'),estimateId:link.optional(),tenderId:link.optional(),projectId:link.optional(),scenarioName:z.string().trim().min(1).max(180).default('Base scenario')}),
 z.object({action:z.literal('update-plan'),planId:id,revision:z.number().int().positive(),name:z.string().trim().min(1).max(180).optional(),accessScope:z.enum(['organisation','owner']).optional(),estimateId:link.optional(),tenderId:link.optional(),projectId:link.optional(),status:z.enum(['active','archived']).optional()}),
 z.object({action:z.literal('create-scenario'),planId:id,name:z.string().trim().min(1).max(180),basedOnScenarioId:id.nullable().optional()}),
 z.object({action:z.literal('save'),scenarioId:id,expectedRevision:z.number().int().positive(),name:z.string().trim().min(1).max(180).optional(),document:documentSchema}),
 z.object({action:z.literal('positions'),scenarioId:id,positions:z.record(z.string(),z.object({x:z.number().finite().min(-100000).max(100000),y:z.number().finite().min(-100000).max(100000)})).refine(p=>Object.keys(p).length<=200,'Too many positions.')}),
]);

const summary=(p:PlanRow,scenarios:ScenarioRow[])=>({id:p.id,name:p.name,ownerUserId:p.owner_user_id,accessScope:p.access_scope,estimateId:p.estimate_id,tenderId:p.tender_id,projectId:p.project_id,status:p.status,revision:Number(p.revision),updatedAt:p.updated_at,
 scenarios:scenarios.filter(s=>s.plan_id===p.id).map(s=>({id:s.id,name:s.name,revision:Number(s.revision),updatedAt:s.updated_at,basedOnScenarioId:s.based_on_scenario_id}))});

async function scenarioPayload(org:string,scenarioId:string,actor:{userId:string;role:string},conn?:Parameters<typeof loadScenario>[3]){
 const {plan,scenario}=await loadScenario(org,scenarioId,actor,conn);
 const {doc,positions}=await loadDocument(org,scenarioId,conn);
 const siblings=await query<ScenarioRow>('SELECT * FROM planning_scenarios WHERE organisation_id=? AND plan_id=? ORDER BY created_at,id',[org,plan.id],conn);
 return {plan:summary(plan,siblings),scenario:{id:scenario.id,name:scenario.name,revision:Number(scenario.revision),status:scenario.status,updatedAt:scenario.updated_at},positions,...present(doc,canSeePlanRates(actor)),canEdit:can(actor.role,'estimate.edit')};
}

export const GET=api({permission:'read',module:'estimating'},async({actor,params})=>{
 const org=actor.organisationId,scenarioId=params.get('scenarioId');
 if(scenarioId){
  if(!ID_PATTERN.test(scenarioId))fail(404,'Scenario not found.');
  const payload=await scenarioPayload(org,scenarioId,actor);
  if(params.get('export')==='csv'){
   // The same redaction as the JSON: rates and costs are never in the file unless this viewer may see them.
   const csv=planCsv(payload.document,payload.ratesVisible);
   const safe=payload.plan.name.replace(/[^A-Za-z0-9 _-]/g,'').trim().slice(0,60)||'plan';
   return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${safe} - ${payload.scenario.name.replace(/[^A-Za-z0-9 _-]/g,'').slice(0,40)||'scenario'}.csv"`,'Cache-Control':'private, no-store'}});
  }
  return payload;
 }
 const plans=(await query<PlanRow>('SELECT * FROM planning_plans WHERE organisation_id=? ORDER BY updated_at DESC,id LIMIT 200',[org])).filter(p=>planVisibleTo(p,actor));
 const scenarios=plans.length?await query<ScenarioRow>('SELECT * FROM planning_scenarios WHERE organisation_id=? AND plan_id IN (?) ORDER BY created_at,id',[org,plans.map(p=>p.id)]):[];
 return {plans:plans.map(p=>summary(p,scenarios)),ratesVisible:canSeePlanRates(actor),canEdit:can(actor.role,'estimate.edit')};
});

export const POST=api({permission:'write',module:'estimating',capability:'estimate.edit'},async({actor,request})=>{
 const b=await body(request,input),org=actor.organisationId,now=nowIso();
 if(b.action==='create-plan'){
  return tx(async conn=>{
   await assertLinks(org,b,conn);
   const planId=uuid(),scenarioId=uuid();
   await exec("INSERT INTO planning_plans (id,organisation_id,name,owner_user_id,access_scope,estimate_id,tender_id,project_id,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,?)",[planId,org,b.name,actor.userId,b.accessScope,b.estimateId??null,b.tenderId??null,b.projectId??null,actor.userId,now,now],conn);
   await exec("INSERT INTO planning_scenarios (id,organisation_id,plan_id,name,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,'draft',1,?,?,?)",[scenarioId,org,planId,b.scenarioName,actor.userId,now,now],conn);
   await audit({event:'planning.plan_created',entityType:'planning_plan',entityId:planId,summary:b.name,after:{accessScope:b.accessScope,linked:{estimate:Boolean(b.estimateId),tender:Boolean(b.tenderId),project:Boolean(b.projectId)}}},conn);
   return {...(await scenarioPayload(org,scenarioId,actor,conn))};
  });
 }
 if(b.action==='update-plan'){
  return tx(async conn=>{
   const plan=await loadPlan(org,b.planId,actor,conn,true);
   if(Number(plan.revision)!==b.revision)fail(409,'This plan was changed by someone else. Reload before saving.');
   if(b.accessScope&&b.accessScope!==plan.access_scope&&plan.owner_user_id!==actor.userId&&actor.role!=='admin')fail(403,'Only the plan owner can change who can open it.');
   const next={estimateId:b.estimateId===undefined?plan.estimate_id:b.estimateId,tenderId:b.tenderId===undefined?plan.tender_id:b.tenderId,projectId:b.projectId===undefined?plan.project_id:b.projectId};
   await assertLinks(org,next,conn);
   await exec('UPDATE planning_plans SET name=?,access_scope=?,estimate_id=?,tender_id=?,project_id=?,status=? WHERE organisation_id=? AND id=?',[b.name??plan.name,b.accessScope??plan.access_scope,next.estimateId,next.tenderId,next.projectId,b.status??plan.status,org,plan.id],conn);
   await bump('planning_plans',org,plan.id,conn);
   await audit({event:'planning.plan_updated',entityType:'planning_plan',entityId:plan.id,summary:b.name??plan.name,after:{accessScope:b.accessScope??plan.access_scope,status:b.status??plan.status}},conn);
   const first=await query<{id:string}>('SELECT id FROM planning_scenarios WHERE organisation_id=? AND plan_id=? ORDER BY created_at,id LIMIT 1',[org,plan.id],conn);
   return scenarioPayload(org,first[0].id,actor,conn);
  });
 }
 if(b.action==='create-scenario'){
  return tx(async conn=>{
   const plan=await loadPlan(org,b.planId,actor,conn,true);
   if(plan.status==='archived')fail(409,'This plan is archived.');
   const count=await query<{n:number}>('SELECT COUNT(*) AS n FROM planning_scenarios WHERE organisation_id=? AND plan_id=?',[org,plan.id],conn);
   if(Number(count[0].n)>=20)fail(409,'A plan holds at most 20 scenarios.');
   let doc:PlanDocument=emptyDocument(),positions={};
   if(b.basedOnScenarioId){
    const src=await loadScenario(org,b.basedOnScenarioId,actor,conn);
    if(src.plan.id!==plan.id)fail(404,'Scenario not found.');
    const loaded=await loadDocument(org,src.scenario.id,conn);
    ({doc,positions}=await copyDocument(loaded.doc,loaded.positions));
   }
   const scenarioId=uuid();
   await exec("INSERT INTO planning_scenarios (id,organisation_id,plan_id,name,status,based_on_scenario_id,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,'draft',?,1,?,?,?)",[scenarioId,org,plan.id,b.name,b.basedOnScenarioId??null,actor.userId,now,now],conn);
   await writeDocument(org,scenarioId,doc,conn);await writePositions(org,scenarioId,positions,conn);
   await audit({event:'planning.scenario_created',entityType:'planning_scenario',entityId:scenarioId,summary:b.name,after:{planId:plan.id,basedOn:b.basedOnScenarioId??null}},conn);
   return scenarioPayload(org,scenarioId,actor,conn);
  });
 }
 if(b.action==='save'){
  return tx(async conn=>{
   const {plan,scenario}=await loadScenario(org,b.scenarioId,actor,conn,true);
   if(plan.status==='archived')fail(409,'This plan is archived.');
   // Stale saves are refused before anything is written.
   if(Number(scenario.revision)!==b.expectedRevision)fail(409,'This scenario was changed elsewhere. Reload to see the latest version before saving.',{currentRevision:Number(scenario.revision)});
   await writeDocument(org,scenario.id,b.document as PlanDocument,conn);
   if(b.name&&b.name!==scenario.name)await exec('UPDATE planning_scenarios SET name=? WHERE organisation_id=? AND id=?',[b.name,org,scenario.id],conn);
   await bump('planning_scenarios',org,scenario.id,conn);
   await audit({event:'planning.scenario_saved',entityType:'planning_scenario',entityId:scenario.id,summary:scenario.name,after:{revision:Number(scenario.revision)+1,activities:b.document.activities.length,dependencies:b.document.dependencies.length}},conn);
   return scenarioPayload(org,scenario.id,actor,conn);
  });
 }
 // Layout only: no business revision, no conflict with a concurrent business edit.
 return tx(async conn=>{
  const {plan,scenario}=await loadScenario(org,b.scenarioId,actor,conn,true);
  if(plan.status==='archived')fail(409,'This plan is archived.');
  await writePositions(org,scenario.id,b.positions,conn);
  return {ok:true};
 });
});
