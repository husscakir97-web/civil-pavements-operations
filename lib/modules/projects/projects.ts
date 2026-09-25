// Project workspace service: typed project record (legacy jobs table, promoted
// columns), readiness derived from real requirements, lifecycle and closeout.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {assertTransition,stateLabel} from '@/lib/platform/workflow';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,round2,type Row,type Conn} from '@/lib/platform/sql';
import {database} from '@/lib/platform/database';
import {readinessPercent} from '@/lib/platform/finance';
import {imsBlockers} from '@/lib/ims-readiness';
import {safeJson} from '@/lib/estimates-db';

const actor=()=>actorContext.getStore()!;
export function legacyProjectStage(status:string){
 const s=String(status||'').toLowerCase();
 if(['ready to commence','ready'].includes(s))return 'ready';
 if(['in progress','active'].includes(s))return 'active';
 if(['completed','practical completion'].includes(s))return 'practical_completion';
 if(['archived','closed'].includes(s))return 'closed';
 return 'setup';
}
export const stageOf=(p:Row)=>p.stage||legacyProjectStage(p.status);

export async function loadProject(id:string,conn?:Conn,lock=false){
 const p=await one(`SELECT * FROM jobs WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!p)fail(404,'Project not found.');
 return p!;
}
/** Contract value and budget from the typed columns, falling back to legacy metadata for older jobs. */
export function projectMoney(p:Row){
 const meta=safeJson<Row>(p.metadata,{}),budget=(meta.approvedBudget||{}) as Row;
 return {contractValue:p.contract_value!=null?Number(p.contract_value):Number(meta.contractValue||budget.sellRate||0)||null,originalBudget:p.original_budget!=null?Number(p.original_budget):Number(budget.totalCost||0)||null};
}

export function presentProject(p:Row,extra:Row={}){
 const meta=safeJson<Row>(p.metadata,{}),money=can(actor().role,'commercial.view');
 const out:Row={id:p.id,name:p.name,projectNumber:p.project_number,clientName:p.client_name??meta.client??null,stage:stageOf(p),stageLabel:stateLabel('project',stageOf(p)),legacyStatus:p.status,projectManagerUserId:p.project_manager_user_id,projectManagerName:p.project_manager_name??meta.projectManager??null,startDate:p.start_date??meta.startDate??null,practicalCompletionDate:p.practical_completion_date,finishDate:p.finish_date,siteAddress:p.site_address??meta.site??null,contractNumber:p.contract_number,contractType:p.contract_type,retentionPct:p.retention_pct,retentionEnabled:Boolean(Number(p.retention_enabled)),retentionCapAmount:p.retention_cap_amount==null?null:Number(p.retention_cap_amount),paymentTermsDays:p.payment_terms_days,defectsMonths:p.defects_months,scope:p.scope??meta.scope??null,assumptions:p.assumptions,exclusions:p.exclusions,clientRequirements:p.client_requirements,mobilisationNotes:p.mobilisation_notes,sourceTenderId:p.source_tender_id,sourceEstimateId:p.source_estimate_id??meta.sourceEstimateId??null,sourceEstimateRevisionId:p.source_estimate_revision_id??meta.sourceRevisionId??null,closedAt:p.closed_at,revision:Number(p.revision||1),createdAt:p.created_at,updatedAt:p.updated_at,...extra};
 if(money)Object.assign(out,projectMoney(p));
 return out;
}

type ReadinessItem={id?:string;category:string;title:string;mandatory:boolean;ok:boolean;status:string;source:'checklist'|'derived';detail?:string|null};
export async function readiness(projectId:string,conn?:Conn){
 const org=actor().organisationId,today=nowIso().slice(0,10);
 const [items,baseline,swms,risks,shifts]=await Promise.all([
  query("SELECT id,category,title,mandatory,status,notes,evidence_document_id FROM project_checklist_items WHERE organisation_id=? AND project_id=? AND phase='readiness' ORDER BY category,title",[org,projectId],conn),
  one('SELECT id FROM project_baselines WHERE organisation_id=? AND project_id=? LIMIT 1',[org,projectId],conn),
  query("SELECT status FROM swms WHERE organisation_id=? AND project_id=?",[org,projectId],conn),
  query("SELECT title,residual_rating,initial_rating,status FROM risks WHERE organisation_id=? AND project_id=?",[org,projectId],conn),
  query("SELECT id,name,metadata FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.jobId'))=? AND status NOT IN ('Cancelled','Completed','Stand-down','Archived')",[org,projectId],conn),
 ]);
 const ims=await imsBlockers(database,org,projectId);
 const out:ReadinessItem[]=items.map(i=>({id:i.id,category:i.category,title:i.title,mandatory:Boolean(i.mandatory),ok:['complete','not_applicable'].includes(i.status),status:i.status,source:'checklist' as const,detail:i.notes}));
 const approvedSwms=swms.filter(s=>['approved','issued'].includes(s.status)).length;
 out.push({category:'contract',title:'Approved baseline recorded',mandatory:true,ok:Boolean(baseline),status:baseline?'complete':'open',source:'derived',detail:baseline?null:'Create the project baseline from an approved estimate or record a manual baseline.'});
 out.push({category:'SWMS',title:'SWMS approved for planned high-risk work',mandatory:true,ok:approvedSwms>0,status:approvedSwms?'complete':'open',source:'derived',detail:approvedSwms?`${approvedSwms} approved/issued SWMS`:swms.length?'SWMS drafted but not yet approved.':'No SWMS have been created for this project.'});
 const highOpen=risks.filter(r=>r.status==='open'&&['High','Extreme'].includes(r.residual_rating||r.initial_rating));
 out.push({category:'HSEQ',title:'Risk register reviewed with controls for high risks',mandatory:true,ok:risks.length>0&&highOpen.length===0,status:risks.length&&!highOpen.length?'complete':'open',source:'derived',detail:!risks.length?'No risks recorded.':highOpen.length?`${highOpen.length} high/extreme risk${highOpen.length===1?'':'s'} awaiting approved controls.`:null});
 out.push({category:'project plans',title:'Project IMS pack approved',mandatory:true,ok:ims.length===0,status:ims.length?'open':'complete',source:'derived',detail:ims.length?`${ims.length} IMS item${ims.length===1?'':'s'} need current approved evidence.`:null});
 const expired:string[]=[];
 if(shifts.length){
  const workerIds=[...new Set(shifts.flatMap(s=>((safeJson<Row>(s.metadata,{}).assignments||[]) as Row[]).filter(a=>a.category==='workers').map(a=>String(a.resourceId))))];
  const workers=workerIds.length?await query('SELECT id,name,metadata FROM workers WHERE organisation_id=? AND id IN (?)',[org,workerIds],conn):[];
  for(const w of workers){const exp=String(safeJson<Row>(w.metadata,{}).competencyExpiry||'');if(!exp||exp<today)expired.push(w.name);}
 }
 out.push({category:'competencies',title:'Scheduled workers hold current competencies',mandatory:shifts.length>0,ok:expired.length===0,status:expired.length?'open':'complete',source:'derived',detail:expired.length?`Expired or unrecorded: ${expired.slice(0,5).join(', ')}${expired.length>5?'…':''}`:shifts.length?null:'No work scheduled yet.'});
 const percent=readinessPercent(out);
 const blockers=out.filter(i=>i.mandatory&&!i.ok).map(i=>i.detail?`${i.title}: ${i.detail}`:i.title);
 const categories=[...new Set(out.map(i=>i.category))].map(category=>({category,items:out.filter(i=>i.category===category)}));
 return {percent,blockers,categories,mandatoryTotal:out.filter(i=>i.mandatory).length,mandatoryComplete:out.filter(i=>i.mandatory&&i.ok).length,imsBlockers:ims};
}

export async function closeoutStatus(projectId:string,conn?:Conn){
 const org=actor().organisationId;
 const [items,variations,claims,invoices]=await Promise.all([
  query("SELECT id,category,title,mandatory,status FROM project_checklist_items WHERE organisation_id=? AND project_id=? AND phase='closeout'",[org,projectId],conn),
  one<{n:number}>("SELECT COUNT(*) AS n FROM project_variations WHERE organisation_id=? AND project_id=? AND status IN ('draft','submitted')",[org,projectId],conn),
  one<{n:number}>("SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=? AND project_id=? AND status IN ('draft','internal_approval','submitted')",[org,projectId],conn),
  one<{n:number}>("SELECT COUNT(*) AS n FROM client_invoices WHERE organisation_id=? AND project_id=? AND status IN ('draft','issued','part_paid')",[org,projectId],conn),
 ]);
 const blockers=[...items.filter(i=>i.mandatory&&!['complete','not_applicable'].includes(i.status)).map(i=>`Closeout: ${i.title}`),...(Number(variations?.n)?[`${variations!.n} variation(s) not yet decided`]:[]),...(Number(claims?.n)?[`${claims!.n} claim(s) not yet certified`]:[]),...(Number(invoices?.n)?[`${invoices!.n} invoice(s) not yet paid`]:[])];
 return {items:items.length,blockers};
}

export async function nextProjectAction(p:Row,r:{blockers:string[];percent:number|null},conn?:Conn){
 const org=actor().organisationId,stage=stageOf(p);
 if(stage==='setup'){const swms=r.blockers.find(b=>b.startsWith('SWMS'));if(swms)return 'Approve SWMS before mobilisation';return r.blockers.length?`Complete ${r.blockers.length} readiness requirement${r.blockers.length===1?'':'s'}`:'Mark the project ready';}
 if(stage==='ready')return 'Start delivery';
 if(stage==='active'){
  const [d,v]=await Promise.all([one<{n:number}>("SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(links,'$.jobId'))=? AND status IN ('review','uploaded','matched','ready','draft')",[org,p.id],conn),one<{n:number}>("SELECT COUNT(*) AS n FROM project_variations WHERE organisation_id=? AND project_id=? AND status='submitted'",[org,p.id],conn)]);
  if(Number(d?.n))return `Review ${d!.n} unapproved docket${Number(d!.n)===1?'':'s'}`;
  if(Number(v?.n))return `Record the client decision on ${v!.n} submitted variation${Number(v!.n)===1?'':'s'}`;
  return 'Schedule upcoming work and capture field records';
 }
 if(stage==='practical_completion')return 'Start project closeout';
 if(stage==='closeout'){const c=await closeoutStatus(p.id,conn);return c.blockers.length?c.blockers[0]:'Close the project';}
 return null;
}

export async function listProjects(){
 const rows=await query("SELECT * FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY (COALESCE(stage,'')='closed'),created_at DESC LIMIT 300",[actor().organisationId]);
 return Promise.all(rows.map(async p=>{const r=await readiness(p.id);return presentProject(p,{readiness:r.percent,blockerCount:r.blockers.length,nextAction:await nextProjectAction(p,r)});}));
}

export async function getProject(id:string){
 const p=await loadProject(id);const org=actor().organisationId;
 const [r,baselines]=await Promise.all([readiness(id),query('SELECT id,revision,reason,source_type,tender_id,estimate_id,estimate_revision_id,contract_value,budget_labour,budget_plant,budget_material,budget_subcontract,budget_other,budget_indirect,budget_total,scope,assumptions,exclusions,clarifications,created_by,created_at FROM project_baselines WHERE organisation_id=? AND project_id=? ORDER BY revision',[org,id])]);
 const money=can(actor().role,'commercial.view');
 return {project:presentProject(p,{readiness:r.percent,nextAction:await nextProjectAction(p,r)}),readiness:r,closeout:['practical_completion','closeout','closed'].includes(stageOf(p))?await closeoutStatus(id):null,
  baselines:baselines.map(b=>{const base={id:b.id,revision:b.revision,reason:b.reason,sourceType:b.source_type,tenderId:b.tender_id,estimateId:b.estimate_id,estimateRevisionId:b.estimate_revision_id,scope:b.scope,assumptions:b.assumptions,exclusions:b.exclusions,clarifications:safeJson(b.clarifications,[]),createdAt:b.created_at};return money?{...base,contractValue:Number(b.contract_value),budget:{labour:Number(b.budget_labour),plant:Number(b.budget_plant),material:Number(b.budget_material),subcontract:Number(b.budget_subcontract),other:Number(b.budget_other),indirect:Number(b.budget_indirect),total:Number(b.budget_total)}}:base;})};
}

const SETUP_FIELDS:Record<string,string>={name:'name',clientName:'client_name',projectManagerUserId:'project_manager_user_id',projectManagerName:'project_manager_name',startDate:'start_date',practicalCompletionDate:'practical_completion_date',finishDate:'finish_date',siteAddress:'site_address',contractNumber:'contract_number',contractType:'contract_type',retentionPct:'retention_pct',retentionEnabled:'retention_enabled',retentionCapAmount:'retention_cap_amount',paymentTermsDays:'payment_terms_days',defectsMonths:'defects_months',scope:'scope',assumptions:'assumptions',exclusions:'exclusions',clientRequirements:'client_requirements',mobilisationNotes:'mobilisation_notes'};
export async function updateProject(id:string,revision:number,input:Row){
 const a=actor();if(!can(a.role,'project.edit'))fail(403,'You are not authorised to edit projects.');
 await tx(async conn=>{
  const p=await loadProject(id,conn,true);
  if(Number(p.revision||1)!==revision)fail(409,'This project was changed by someone else. Refresh to see the latest version.');
  if(stageOf(p)==='closed')fail(409,'This project is closed. Reopen it before making changes.');
  if(input.projectManagerUserId&&!await one('SELECT id FROM users WHERE organisation_id=? AND id=?',[a.organisationId,input.projectManagerUserId],conn))fail(400,'Choose a project manager from your organisation.');
  const set:Row={};for(const [k,c] of Object.entries(SETUP_FIELDS))if(k in input)set[c]=input[k]===''?null:input[k];
  if(set.name!==undefined&&!String(set.name||'').trim())fail(400,'A project name is required.');
  const cols=Object.keys(set);if(!cols.length)return;
  const meta={...safeJson<Row>(p.metadata,{})};if('client_name' in set)meta.client=set.client_name;if('site_address' in set)meta.site=set.site_address;if('start_date' in set)meta.startDate=set.start_date;if('project_manager_name' in set)meta.projectManager=set.project_manager_name;
  await exec(`UPDATE jobs SET ${cols.map(c=>`${c}=?`).join(',')},metadata=?,revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),JSON.stringify(meta),nowIso(),a.organisationId,id],conn);
  await audit({event:'project.updated',entityType:'project',entityId:id,projectId:id,summary:'Project setup updated',before:Object.fromEntries(cols.map(c=>[c,p[c]])),after:set},conn);
 });
 return getProject(id);
}

/** Manual project (Projects-only or IMS-only customers, no tender/estimate). Baseline recorded separately. */
export async function createProject(input:{name:string;clientName?:string|null;startDate?:string|null;siteAddress?:string|null}){
 const a=actor();if(!can(a.role,'project.edit'))fail(403,'You are not authorised to create projects.');
 if(!input.name?.trim())fail(400,'A project name is required.');
 const id=uuid();
 await tx(async conn=>{
  const now=nowIso(),n=await one<{n:number}>('SELECT COUNT(*) AS n FROM jobs WHERE organisation_id=? AND project_number IS NOT NULL',[a.organisationId],conn);
  const number=`PRJ-${String(Number(n?.n||0)+1).padStart(4,'0')}`;
  await exec('INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at,project_number,client_name,stage,start_date,site_address,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,input.name.trim(),'Planning',JSON.stringify({client:input.clientName||'',site:input.siteAddress||'',startDate:input.startDate||''}),now,number,input.clientName||null,'setup',input.startDate||null,input.siteAddress||null,1,now],conn);
  await ensureDefaultChecklist(conn,id,'readiness');
  await audit({event:'project.created',entityType:'project',entityId:id,projectId:id,summary:`${number} ${input.name} created manually (no estimate baseline)`,after:input},conn);
 });
 return {projectId:id};
}

const DEFAULTS:Record<'readiness'|'closeout',Array<[string,string]>>={
 readiness:[['contract','Contract executed and key dates confirmed'],['contract','Insurances current for the contract'],['project plans','Project Management Plan approved'],['HSEQ','WHS / Safety Plan approved'],['workforce','Workforce allocated and inducted'],['plant','Plant allocated with current inspections'],['permits','Permits and approvals obtained'],['site setup','Site establishment and traffic management arranged']],
 closeout:[['outstanding works','Outstanding works complete'],['defects','Defects list closed or handed over'],['final QA','Final QA records and ITPs complete'],['final HSEQ','Final HSEQ records filed'],['as-builts','As-built documentation issued'],['client documents','Client handover documents issued'],['variations','All variations decided'],['final claim','Final claim submitted'],['invoices','All invoices issued and paid'],['lessons learned','Lessons learned recorded']],
};
export async function ensureDefaultChecklist(conn:PoolConnection,projectId:string,phase:'readiness'|'closeout'){
 const a=actor(),now=nowIso();
 for(const [category,title] of DEFAULTS[phase])await exec("INSERT INTO project_checklist_items (id,organisation_id,project_id,phase,category,title,mandatory,status,source,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'open','system',1,?,?,?) ON DUPLICATE KEY UPDATE id=id",[uuid(),a.organisationId,projectId,phase,category,title,a.userId,now,now],conn);
}

export async function recordManualBaseline(id:string,input:{contractValue:number;labour:number;plant:number;material:number;subcontract:number;other:number;indirect:number;reason:string}){
 const a=actor();if(!can(a.role,'project.baseline'))fail(403,'You are not authorised to set baselines.');
 await tx(async conn=>{
  const p=await loadProject(id,conn,true);
  if(stageOf(p)==='closed')fail(409,'This project is closed.');
  if(await one('SELECT id FROM project_baselines WHERE organisation_id=? AND project_id=? LIMIT 1',[a.organisationId,id],conn))fail(409,'The original baseline already exists and is immutable. Budget changes flow through approved variations.');
  if(!input.reason.trim())fail(422,'Record the source of this baseline.');
  const total=round2(input.labour+input.plant+input.material+input.subcontract+input.other+input.indirect),now=nowIso(),bid=uuid();
  await exec('INSERT INTO project_baselines (id,organisation_id,project_id,revision,reason,source_type,contract_value,budget_labour,budget_plant,budget_material,budget_subcontract,budget_other,budget_indirect,budget_total,scope,assumptions,exclusions,clarifications,snapshot,created_by,created_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[bid,a.organisationId,id,input.reason,'manual',round2(input.contractValue),round2(input.labour),round2(input.plant),round2(input.material),round2(input.subcontract),round2(input.other),round2(input.indirect),total,p.scope,p.assumptions,p.exclusions,'[]',JSON.stringify(input),a.userId,now],conn);
  await exec('UPDATE jobs SET contract_value=?,original_budget=?,revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?',[round2(input.contractValue),total,now,a.organisationId,id],conn);
  for(const [code,description,category,amount] of [['100','Labour','labour',input.labour],['200','Plant','plant',input.plant],['300','Materials','material',input.material],['400','Subcontract','subcontract',input.subcontract],['500','Other direct costs','other',input.other],['900','Indirects','other',input.indirect]] as const)
   await exec("INSERT INTO project_cost_codes (id,organisation_id,project_id,code,description,category,budget_amount,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',1,?,?,?) ON DUPLICATE KEY UPDATE id=id",[uuid(),a.organisationId,id,code,description,category,round2(amount),a.userId,now,now],conn);
  await audit({event:'baseline.created',entityType:'project_baseline',entityId:bid,projectId:id,summary:`Manual original baseline: contract ${input.contractValue.toFixed(2)}, budget ${total.toFixed(2)}`,after:input},conn);
 });
 return getProject(id);
}

export async function transitionProject(id:string,to:string,reason?:string){
 const a=actor();
 await tx(async conn=>{
  const p=await loadProject(id,conn,true),from=stageOf(p);
  let system=false;const set:Row={stage:to};
  if(from==='setup'&&to==='ready'){const r=await readiness(id,conn);if(r.blockers.length)fail(422,'Readiness requirements are incomplete.',{blockers:r.blockers});system=true;}
  if(from==='closeout'&&to==='closed'){const c=await closeoutStatus(id,conn);if(c.blockers.length)fail(422,'Closeout is incomplete.',{blockers:c.blockers});system=true;set.closed_at=nowIso();set.closed_by=a.userId;}
  if(from==='closed'&&to==='closeout'){if(!reason?.trim())fail(422,'Give a reason for reopening this project.');system=true;set.closed_at=null;set.closed_by=null;}
  assertTransition('project',from,to,a.role,{system});
  if(to==='closeout')await ensureDefaultChecklist(conn,id,'closeout');
  const legacy:Record<string,string>={setup:'Planning',ready:'Ready to Commence',active:'In Progress',practical_completion:'Completed',closeout:'Completed',closed:'Closed'};
  set.status=legacy[to];
  const cols=Object.keys(set);
  await exec(`UPDATE jobs SET ${cols.map(c=>`${c}=?`).join(',')},revision=COALESCE(revision,1)+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
  await audit({event:`project.${to}`,entityType:'project',entityId:id,projectId:id,summary:`Project: ${stateLabel('project',from)} → ${stateLabel('project',to)}${reason?` (${reason})`:''}`,before:{stage:from},after:set},conn);
 });
 return getProject(id);
}

/** Guard used by operational writes (shifts, dockets, costs, variations). */
export async function assertProjectOpen(projectId:string,conn?:Conn){
 const p=await one('SELECT stage,status FROM jobs WHERE organisation_id=? AND id=?',[actor().organisationId,projectId],conn);
 if(!p)fail(404,'Project not found.');
 if(stageOf(p!)==='closed')fail(409,'This project is closed. Reopen it before adding operational records.');
}
