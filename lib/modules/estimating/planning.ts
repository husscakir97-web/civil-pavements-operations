// Planning v0.1 persistence (docs/PLANNING-V0-1-DECISION.md). Owned by the Estimating module; imports only platform and lib/v1.
// Proposed data only: this file never writes to estimates, tenders, projects, resources, bookings or the schedule.
import {query,one,exec,uuid,nowIso,type Conn} from '@/lib/platform/sql';
import {fail} from '@/lib/platform/http';
import {can} from '@/lib/platform/permissions';
import type {Actor} from '@/lib/authz';
import {calculatePlan,redactRates,validatePlan,newId,type PlanActivity,type PlanDocument,type Positions,type CostItem,type Requirement} from '@/lib/v1/planning';

export type PlanRow={id:string;organisation_id:string;name:string;owner_user_id:string;access_scope:'organisation'|'owner';estimate_id:string|null;tender_id:string|null;project_id:string|null;status:string;revision:number;updated_at:string;created_at:string};
export type ScenarioRow={id:string;plan_id:string;name:string;status:string;based_on_scenario_id:string|null;revision:number;updated_at:string;created_at:string};

/** Financial access for Planning: estimating roles only. Deliberately independent of Commercial so a standalone estimator keeps costs. */
export const canSeePlanRates=(actor:Pick<Actor,'role'>)=>can(actor.role,'estimate.edit')||can(actor.role,'estimate.approve');

/** An `owner`-scoped plan is visible to its owner and administrators only. Otherwise the whole organisation (with estimating access) sees it. */
export const planVisibleTo=(plan:Pick<PlanRow,'access_scope'|'owner_user_id'>,actor:Pick<Actor,'userId'|'role'>)=>plan.access_scope!=='owner'||plan.owner_user_id===actor.userId||actor.role==='admin';
export const planWritableBy=(plan:Pick<PlanRow,'access_scope'|'owner_user_id'>,actor:Pick<Actor,'userId'|'role'>)=>planVisibleTo(plan,actor);

export async function loadPlan(org:string,planId:string,actor:Pick<Actor,'userId'|'role'>,conn?:Conn,lock=false):Promise<PlanRow>{
 const plan=await one<PlanRow>(`SELECT * FROM planning_plans WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[org,planId],conn);
 // The same 404 for "missing", "other organisation" and "not yours": existence is never confirmed.
 if(!plan||!planVisibleTo(plan,actor))fail(404,'Plan not found.');
 return plan;
}
export async function loadScenario(org:string,scenarioId:string,actor:Pick<Actor,'userId'|'role'>,conn?:Conn,lock=false):Promise<{plan:PlanRow;scenario:ScenarioRow}>{
 const scenario=await one<ScenarioRow>(`SELECT * FROM planning_scenarios WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[org,scenarioId],conn);
 if(!scenario)fail(404,'Scenario not found.');
 const plan=await loadPlan(org,scenario.plan_id,actor,conn);
 return {plan,scenario};
}

const n=(v:unknown)=>v===null||v===undefined?null:Number(v);

export async function loadDocument(org:string,scenarioId:string,conn?:Conn):Promise<{doc:PlanDocument;positions:Positions}>{
 const [acts,deps,reqs,costs,links,pos]=await Promise.all([
  query<Record<string,unknown>>('SELECT * FROM planning_activities WHERE organisation_id=? AND scenario_id=? ORDER BY sort,id',[org,scenarioId],conn),
  query<Record<string,unknown>>('SELECT predecessor_id,successor_id FROM planning_dependencies WHERE organisation_id=? AND scenario_id=? ORDER BY predecessor_id,successor_id',[org,scenarioId],conn),
  query<Record<string,unknown>>('SELECT * FROM planning_requirements WHERE organisation_id=? AND scenario_id=? ORDER BY sort,id',[org,scenarioId],conn),
  query<Record<string,unknown>>('SELECT * FROM planning_cost_items WHERE organisation_id=? AND scenario_id=? ORDER BY sort,id',[org,scenarioId],conn),
  query<Record<string,unknown>>('SELECT cost_item_id,activity_id FROM planning_cost_links WHERE organisation_id=? AND scenario_id=?',[org,scenarioId],conn),
  query<Record<string,unknown>>('SELECT activity_id,x,y FROM planning_canvas_positions WHERE organisation_id=? AND scenario_id=?',[org,scenarioId],conn),
 ]);
 const activities:PlanActivity[]=acts.map(a=>({
  id:String(a.id),kind:a.kind==='milestone'?'milestone':'activity',name:String(a.name),notes:String(a.notes??''),
  quantity:n(a.quantity),unit:a.unit===null?null:String(a.unit),productivity:n(a.productivity),productivityUnit:a.productivity_unit===null?null:String(a.productivity_unit),
  durationMode:a.duration_mode==='derived'?'derived':'entered',durationDays:n(a.duration_days),hoursPerDay:n(a.hours_per_day),plannedStart:a.planned_start===null?null:String(a.planned_start),
  requirements:reqs.filter(r=>r.activity_id===a.id).map((r):Requirement=>({id:String(r.id),kind:r.kind==='plant'?'plant':'labour',name:String(r.name),quantity:n(r.quantity),rate:n(r.rate),rateBasis:r.rate_basis==='day'?'day':'hour',
   resourceRef:r.resource_ref_type&&r.resource_ref_id?{type:r.resource_ref_type==='plant'?'plant':'worker',id:String(r.resource_ref_id)}:null})),
  costItems:costs.filter(c=>c.scope==='activity'&&c.activity_id===a.id).map((c):CostItem=>({id:String(c.id),label:String(c.label),amount:n(c.amount)})),
  sharedCostIds:links.filter(l=>l.activity_id===a.id).map(l=>String(l.cost_item_id)).sort(),
 }));
 return {
  doc:{activities,dependencies:deps.map(d=>({from:String(d.predecessor_id),to:String(d.successor_id)})),sharedCosts:costs.filter(c=>c.scope==='shared').map(c=>({id:String(c.id),label:String(c.label),amount:n(c.amount)}))},
  positions:Object.fromEntries(pos.map(p=>[String(p.activity_id),{x:Number(p.x),y:Number(p.y)}])),
 };
}

/** What every response and export carries: the document (rates removed unless allowed) and the server-computed result. */
export function present(doc:PlanDocument,rates:boolean){
 return {document:rates?doc:redactRates(doc),result:calculatePlan(doc,{rates}),ratesVisible:rates};
}

async function assertReferences(org:string,doc:PlanDocument,conn:Conn){
 const refs=doc.activities.flatMap(a=>a.requirements.map(r=>r.resourceRef)).filter((r):r is NonNullable<typeof r>=>Boolean(r));
 for(const type of ['worker','plant'] as const){
  const ids=[...new Set(refs.filter(r=>r.type===type).map(r=>r.id))];
  if(!ids.length)continue;
  const found=await query<{id:string}>(`SELECT id FROM ${type==='plant'?'plant':'workers'} WHERE organisation_id=? AND id IN (?)`,[org,ids],conn);
  if(found.length!==ids.length)fail(400,'A linked resource was not found in this organisation.');
 }
}
export async function assertLinks(org:string,links:{estimateId?:string|null;tenderId?:string|null;projectId?:string|null},conn:Conn){
 const check=async(table:string,id:string|null|undefined,label:string)=>{if(id&&!await one(`SELECT 1 AS ok FROM ${table} WHERE organisation_id=? AND id=?`,[org,id],conn))fail(400,`The linked ${label} was not found.`);};
 await check('estimates',links.estimateId,'estimate');await check('tenders',links.tenderId,'tender');await check('jobs',links.projectId,'project');
}

/** Replaces the scenario's business rows. Caller holds the scenario row lock and has checked the revision. */
export async function writeDocument(org:string,scenarioId:string,doc:PlanDocument,conn:Conn){
 const issues=validatePlan(doc);
 if(issues.length)fail(400,issues[0].message,{issues});
 await assertReferences(org,doc,conn);
 for(const table of ['planning_cost_links','planning_cost_items','planning_requirements','planning_dependencies','planning_activities'])
  await exec(`DELETE FROM ${table} WHERE organisation_id=? AND scenario_id=?`,[org,scenarioId],conn);
 let sort=0;
 for(const a of doc.activities){
  await exec('INSERT INTO planning_activities (id,organisation_id,scenario_id,kind,name,notes,sort,quantity,unit,productivity,productivity_unit,duration_mode,duration_days,hours_per_day,planned_start) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [a.id,org,scenarioId,a.kind,a.name.trim(),a.notes,sort++,a.quantity,a.unit?.trim()||null,a.productivity,a.productivityUnit?.trim()||null,a.durationMode,a.kind==='milestone'?0:a.durationDays,a.hoursPerDay,a.plannedStart],conn);
  let rs=0;
  for(const r of a.requirements)await exec('INSERT INTO planning_requirements (id,organisation_id,scenario_id,activity_id,kind,name,sort,quantity,rate,rate_basis,resource_ref_type,resource_ref_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
   [r.id,org,scenarioId,a.id,r.kind,r.name.trim(),rs++,r.quantity,r.rate,r.rateBasis,r.resourceRef?.type??null,r.resourceRef?.id??null],conn);
  let cs=0;
  for(const c of a.costItems)await exec("INSERT INTO planning_cost_items (id,organisation_id,scenario_id,scope,activity_id,label,amount,sort) VALUES (?,?,?,'activity',?,?,?,?)",[c.id,org,scenarioId,a.id,c.label.trim(),c.amount,cs++],conn);
 }
 let ss=0;
 for(const c of doc.sharedCosts)await exec("INSERT INTO planning_cost_items (id,organisation_id,scenario_id,scope,activity_id,label,amount,sort) VALUES (?,?,?,'shared',NULL,?,?,?)",[c.id,org,scenarioId,c.label.trim(),c.amount,ss++],conn);
 for(const a of doc.activities)for(const s of a.sharedCostIds)await exec('INSERT INTO planning_cost_links (id,organisation_id,scenario_id,cost_item_id,activity_id) VALUES (?,?,?,?,?)',[uuid(),org,scenarioId,s,a.id],conn);
 for(const d of doc.dependencies)await exec('INSERT INTO planning_dependencies (id,organisation_id,scenario_id,predecessor_id,successor_id) VALUES (?,?,?,?,?)',[uuid(),org,scenarioId,d.from,d.to],conn);
 // Positions of deleted activities go with them; layout of the rest is untouched.
 const keep=doc.activities.map(a=>a.id);
 if(keep.length)await exec('DELETE FROM planning_canvas_positions WHERE organisation_id=? AND scenario_id=? AND activity_id NOT IN (?)',[org,scenarioId,keep],conn);
 else await exec('DELETE FROM planning_canvas_positions WHERE organisation_id=? AND scenario_id=?',[org,scenarioId],conn);
}

export async function writePositions(org:string,scenarioId:string,positions:Positions,conn:Conn){
 const ids=(await query<{id:string}>('SELECT id FROM planning_activities WHERE organisation_id=? AND scenario_id=?',[org,scenarioId],conn)).map(r=>r.id);
 const known=new Set(ids);
 for(const [activityId,p] of Object.entries(positions)){
  if(!known.has(activityId))fail(400,'A position refers to an activity that is not in this scenario.');
  await exec('INSERT INTO planning_canvas_positions (id,organisation_id,scenario_id,activity_id,x,y) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE x=VALUES(x),y=VALUES(y)',[uuid(),org,scenarioId,activityId,Math.round(p.x),Math.round(p.y)],conn);
 }
}

/** Copies a scenario with fresh ids (ids are globally unique) so alternatives never overwrite each other. */
export async function copyDocument(source:PlanDocument,sourcePositions:Positions):Promise<{doc:PlanDocument;positions:Positions}>{
 const map=new Map<string,string>();
 const fresh=(old:string)=>{const id=newId();map.set(old,id);return id;};
 const sharedCosts=source.sharedCosts.map(c=>({...c,id:fresh(c.id)}));
 const activities:PlanActivity[]=source.activities.map(a=>({...a,id:fresh(a.id),requirements:a.requirements.map(r=>({...r,id:newId()})),costItems:a.costItems.map(c=>({...c,id:newId()})),sharedCostIds:[] as string[]}));
 source.activities.forEach((a,i)=>{activities[i].sharedCostIds=a.sharedCostIds.map(s=>map.get(s)!);});
 const dependencies=source.dependencies.map(d=>({from:map.get(d.from)!,to:map.get(d.to)!}));
 const positions:Positions={};
 for(const [id,p] of Object.entries(sourcePositions))if(map.has(id))positions[map.get(id)!]=p;
 return {doc:{activities,dependencies,sharedCosts},positions};
}

export const bump=async(table:'planning_plans'|'planning_scenarios',org:string,id:string,conn:Conn)=>{await exec(`UPDATE ${table} SET revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[nowIso(),org,id],conn);};

/** CSV export. Rates and costs appear only when the viewer may see them; the cells are neutralised against spreadsheet formula injection. */
export function planCsv(doc:PlanDocument,rates:boolean){
 const result=calculatePlan(doc,{rates});
 const cell=(v:unknown)=>{const s=v===null||v===undefined?'':String(v);return `"${(/^[=+\-@\t\r]/.test(s)?`'${s}`:s).replace(/"/g,'""')}"`;};
 const head=['Activity','Type','Relative start (days)','Relative finish (days)','Duration (days)','Duration source',...(rates?['Cost (ex GST)','Cost status']:[])];
 const rows=result.order.map(id=>{
  const a=doc.activities.find(x=>x.id===id)!,r=result.activities[id];
  const status=r.cost?(r.cost.total===null?`Unknown (${r.cost.unknownCount} missing)`:'Known'):'';
  return [a.name,a.kind,r.start??'Unknown',r.finish??'Unknown',r.durationDays??'Unknown',r.durationSource,...(rates?[r.cost?.total??'Unknown',status]:[])];
 });
 if(rates&&result.cost){
  rows.push(['Plan total','',"","",result.duration.days??'Unknown','',result.cost.total??'Unknown',result.cost.total===null?`Unknown (${result.cost.unknownCount} missing); known subtotal ${result.cost.knownTotal}`:'Known']);
  for(const s of result.cost.sharedCosts)rows.push([`Shared: ${s.label}`,'shared cost','','','','',s.amount??'Unknown',s.usedBy.length?`Counted once; used by ${s.usedBy.length}`:'Counted once']);
 }
 return [head,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
