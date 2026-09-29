// Home: role-aware My Actions / Needs Attention / Today, derived from workflow
// state. Each query only runs when the module is entitled and the role holds
// the capability, so field users never receive commercial counts.
import {actorContext} from '@/lib/platform/context';
import {can,type Capability} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import type {ModuleKey} from '@/lib/platform/modules';
import {query,one} from '@/lib/platform/sql';
import {easternDate} from '@/lib/reporting';
import {coverage,type Requirement} from '@/lib/v1/shift-requirements';
import {projectScope,memberProjectIds} from '@/lib/platform/project-access';
import {shiftAudience,shiftVisible} from '@/lib/platform/shift-scope';

export type HomeItem={key:string;title:string;detail:string;area:string;target?:{type:string;id:string;tab?:string};severity:'info'|'warning'|'danger'};
/** A real count from workflow state, e.g. "17 / 18" tomorrow's shifts fully resourced. Never a score. */
export type HomeIndicator={key:string;label:string;value:string;detail:string;area:string;severity:'ok'|'warning'|'danger'};
const plural=(n:number,w:string,p=w+'s')=>`${n} ${n===1?w:p}`;

export async function homeFeed(){
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org),today=easternDate(new Date());
 const soon=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10),month=new Date(Date.parse(today)+30*86400000).toISOString().slice(0,10);
 const on=(m:ModuleKey,c?:Capability)=>usable(e,m)&&(!c||can(a.role,c));
 const mine:HomeItem[]=[],attention:HomeItem[]=[],todayItems:HomeItem[]=[],indicators:HomeIndicator[]=[];
 const myProjects:{id:string;name:string;stage:string}[]=[];
 const count=async(sql:string,params:unknown[])=>Number((await one<{n:number}>(sql,params))?.n||0);
 // Project scope (null = organisation-wide). Project/Site Engineers only see their projects' items;
 // organisation-level records (no project) stay visible where their capability allows.
 const scope=await projectScope(a),mineIds=await memberProjectIds(a);
 const inScope=(col:string,allowNull=false)=>!scope?'':` AND ${allowNull?`(${col} IS NULL OR `:'('}${col} IN (${scope.length?scope.map(()=>'?').join(','):"'-'"}))`;
 const sp=()=>scope||[];
 const tasks:Promise<void>[]=[];

 if(on('pipeline','pipeline.view'))tasks.push((async()=>{
  const owned=await query("SELECT id,title,stage,due_date FROM tenders WHERE organisation_id=? AND owner_user_id=? AND stage NOT IN ('awarded','lost') ORDER BY due_date IS NULL,due_date LIMIT 5",[org,a.userId]);
  for(const t of owned)mine.push({key:`tender-${t.id}`,title:`Tender: ${t.title}`,detail:t.due_date?`Due ${t.due_date}`:'No due date recorded',area:'Pipeline/Tenders',target:{type:'tender',id:t.id},severity:t.due_date&&t.due_date<=soon?'warning':'info'});
  const assigned=await query<{id:string;title:string;tender_id:string;tender_title:string}>("SELECT r.id,r.title,r.tender_id,t.title AS tender_title FROM tender_returnables r JOIN tenders t ON t.organisation_id=r.organisation_id AND t.id=r.tender_id WHERE r.organisation_id=? AND r.assignee_user_id=? AND r.status NOT IN ('complete','not_applicable') ORDER BY r.due_date IS NULL,r.due_date LIMIT 5",[org,a.userId]);
  for(const r of assigned)mine.push({key:`returnable-${r.id}`,title:`Returnable: ${r.title}`,detail:`${r.tender_title} · Assigned to you`,area:'Pipeline/Tenders',target:{type:'tender',id:r.tender_id,tab:'returnables'},severity:'warning'});
  const reqs=await query<{id:string;title:string;tender_id:string;tender_title:string}>("SELECT r.id,r.title,r.tender_id,t.title AS tender_title FROM tender_requirements r JOIN tenders t ON t.organisation_id=r.organisation_id AND t.id=r.tender_id WHERE r.organisation_id=? AND r.owner_user_id=? AND r.status IN ('open','in_progress','Missing') ORDER BY r.due_date IS NULL,r.due_date LIMIT 5",[org,a.userId]);
  for(const r of reqs)mine.push({key:`requirement-${r.id}`,title:`Requirement: ${r.title}`,detail:`${r.tender_title} · You're responsible`,area:'Pipeline/Tenders',target:{type:'tender',id:r.tender_id,tab:'requirements'},severity:'info'});
  const due=await count("SELECT COUNT(*) AS n FROM tenders WHERE organisation_id=? AND stage IN ('draft','reviewing','pricing','approval') AND due_date IS NOT NULL AND due_date<=?",[org,soon+'T23:59']);
  if(due)attention.push({key:'tenders-due',title:`${plural(due,'tender')} due within 7 days`,detail:'Not yet submitted',area:'Pipeline/Tenders',severity:'danger'});
  const suggested=await count("SELECT COUNT(*) AS n FROM tender_requirements WHERE organisation_id=? AND status='suggested' AND tender_id IS NOT NULL",[org]);
  if(suggested)attention.push({key:'suggested',title:`${plural(suggested,'suggested requirement')} to confirm`,detail:'Extracted from tender documents — a person must confirm or reject',area:'Pipeline/Tenders',severity:'warning'});
  if(can(a.role,'tender.approve')){
   const rows=await query<{id:string;title:string;due_date:string|null}>("SELECT id,title,due_date FROM tenders WHERE organisation_id=? AND stage='approval' AND approval_status='requested' ORDER BY due_date IS NULL,due_date LIMIT 5",[org]);
   for(const t of rows)mine.push({key:`tender-approval-${t.id}`,title:`Approve tender: ${t.title}`,detail:t.due_date?`Internal approval requested · due ${t.due_date}`:'Internal approval requested',area:'Pipeline/Tenders',target:{type:'tender',id:t.id,tab:'approval'},severity:'warning'});
  }
  const clar=await count("SELECT COUNT(*) AS n FROM tender_clarifications WHERE organisation_id=? AND status='open'",[org]);
  if(clar)attention.push({key:'clarifications',title:`${plural(clar,'open clarification')}`,detail:'Client questions awaiting a response',area:'Pipeline/Tenders',severity:'warning'});
 })());
 if(on('estimating','estimate.approve'))tasks.push((async()=>{
  const rows=await query<{id:string;name:string;tender_id:string|null;tender_title:string|null}>("SELECT e.id,e.name,t.id AS tender_id,t.title AS tender_title FROM estimates e LEFT JOIN tenders t ON t.organisation_id=e.organisation_id AND t.estimate_id=e.id WHERE e.organisation_id=? AND e.workflow_state='review' ORDER BY e.updated_at DESC LIMIT 5",[org]);
  for(const r of rows)mine.push({key:`estimate-approval-${r.id}`,title:`Review estimate: ${r.tender_title||r.name}`,detail:'Submitted for approval',area:r.tender_id?'Pipeline/Tenders':'Pipeline/Estimates',target:r.tender_id?{type:'tender',id:r.tender_id,tab:'estimate'}:undefined,severity:'warning'});
 })());
 if(on('projects','project.view'))tasks.push((async()=>{
  const setup=await query<{id:string;name:string}>(`SELECT id,name FROM jobs WHERE organisation_id=? AND stage='setup'${inScope('id')} ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 5`,[org,...sp()]);
  for(const p of setup)attention.push({key:`project-setup-${p.id}`,title:`Project not ready: ${p.name}`,detail:'Complete readiness before mobilisation',area:'Projects',target:{type:'project',id:p.id,tab:'setup'},severity:'warning'});
  const closeout=await query<{id:string;name:string}>(`SELECT id,name FROM jobs WHERE organisation_id=? AND stage IN ('practical_completion','closeout')${inScope('id')} ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 5`,[org,...sp()]);
  // My projects: the project team (by user id) plus projects this user manages. Never matched by name.
  if(mineIds.length){const led=await query<{id:string;name:string;stage:string}>("SELECT id,name,COALESCE(stage,'setup') AS stage FROM jobs WHERE organisation_id=? AND id IN (?) AND COALESCE(stage,'') NOT IN ('closed') AND LOWER(status)<>'archived' ORDER BY name LIMIT 8",[org,mineIds]);myProjects.push(...led);}
  const ready=await query<{id:string;title:string;project_id:string;due_date:string|null}>(`SELECT id,title,project_id,due_date FROM project_checklist_items WHERE organisation_id=? AND owner_user_id=? AND status='open'${inScope('project_id')} ORDER BY due_date IS NULL,due_date LIMIT 5`,[org,a.userId,...sp()]);
  for(const r of ready)mine.push({key:`readiness-${r.id}`,title:`Readiness: ${r.title}`,detail:r.due_date?`Due ${r.due_date}`:'Assigned to you',area:'Projects',target:{type:'project',id:r.project_id,tab:'setup'},severity:r.due_date&&r.due_date<today?'danger':'info'});
  for(const p of closeout)attention.push({key:`project-closeout-${p.id}`,title:`Close out project: ${p.name}`,detail:'Finish the closeout checklist',area:'Projects',target:{type:'project',id:p.id,tab:'closeout'},severity:'info'});
 })());
 if(on('ims'))tasks.push((async()=>{
  if(can(a.role,'swms.approve')){
   const rows=await query<{id:string;reference:string;title:string;project_id:string|null}>("SELECT id,reference,title,project_id FROM swms WHERE organisation_id=? AND status='review' ORDER BY updated_at DESC LIMIT 5",[org]);
   for(const s of rows)mine.push({key:`swms-approval-${s.id}`,title:`Approve ${s.reference||'SWMS'}: ${s.title}`,detail:'Submitted for review',area:s.project_id?'Projects':'IMS & HSEQ',target:s.project_id?{type:'project',id:s.project_id,tab:'quality'}:undefined,severity:'warning'});
  }
  if(can(a.role,'hseq.view')){
   const ncr=await count(`SELECT COUNT(*) AS n FROM hseq_ncrs WHERE organisation_id=? AND status<>'closed'${inScope('project_id',true)}`,[org,...sp()]);if(ncr)attention.push({key:'ncrs',title:`${plural(ncr,'open NCR')}`,detail:'Non-conformances awaiting action or verification',area:'IMS & HSEQ',severity:'warning'});
   const inc=await count(`SELECT COUNT(*) AS n FROM hseq_incidents WHERE organisation_id=? AND status<>'closed'${inScope('project_id',true)}`,[org,...sp()]);if(inc)attention.push({key:'incidents',title:`${plural(inc,'open incident')}`,detail:'Reported or under investigation',area:'IMS & HSEQ',severity:'danger'});
   const overdue=await count(`SELECT COUNT(*) AS n FROM hseq_actions WHERE organisation_id=? AND status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date<?${inScope('project_id',true)}`,[org,today,...sp()]);if(overdue)attention.push({key:'actions-overdue',title:`${plural(overdue,'overdue corrective action')}`,detail:'Past their due date',area:'IMS & HSEQ',severity:'danger'});
  }
  // My Work reads existing assignments (ITP points, corrective actions); no task copies are created.
  if(can(a.role,'itp.complete')){
   const itp=await count(`SELECT COUNT(*) AS n FROM itp_items WHERE organisation_id=? AND assigned_user_id=? AND status='open'${inScope('project_id')}`,[org,a.userId,...sp()]);if(itp)mine.push({key:'itp',title:`Complete ${plural(itp,'inspection point')}`,detail:'Quality records assigned to you',area:can(a.role,'schedule.edit')||can(a.role,'pipeline.view')?'Projects':'Field',severity:'info'});
  }
  const acts=await query<{id:string;action:string;due_date:string|null;project_id:string|null}>(`SELECT id,action,due_date,project_id FROM hseq_actions WHERE organisation_id=? AND owner_user_id=? AND status IN ('open','in_progress')${inScope('project_id',true)} ORDER BY due_date IS NULL,due_date LIMIT 5`,[org,a.userId,...sp()]);
  for(const x of acts)mine.push({key:`action-${x.id}`,title:`Action: ${String(x.action).slice(0,90)}`,detail:x.due_date?`Due ${x.due_date}`:'No due date',area:'IMS & HSEQ',severity:x.due_date&&x.due_date<today?'danger':'info'});
  if(can(a.role,'hseq.view')||can(a.role,'itp.complete')){
   const holds=await count(`SELECT COUNT(*) AS n FROM itp_items WHERE organisation_id=? AND point_type='hold' AND status='open'${inScope('project_id')}`,[org,...sp()]);
   indicators.push({key:'hold-points',label:'Open hold points',value:String(holds),detail:'Work cannot proceed past these until released',area:'IMS & HSEQ',severity:holds?'warning':'ok'});
  }
 })());
 if(on('dockets','docket.approve'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND status IN ('review','matched','ready','uploaded','duplicate')",[org]);if(n)mine.push({key:'dockets',title:`Review ${plural(n,'docket')}`,detail:'Awaiting office review and approval',area:'Commercial/Dockets',severity:'warning'});})());
 if(on('commercial','commercial.view'))tasks.push((async()=>{
  if(can(a.role,'variation.approve')){
   const rows=await query<{id:string;reference:string|null;title:string;project_id:string}>("SELECT id,reference,title,project_id FROM project_variations WHERE organisation_id=? AND status='submitted' ORDER BY submitted_date IS NULL,submitted_date LIMIT 5",[org]);
   for(const v of rows)mine.push({key:`variation-${v.id}`,title:`Variation decision: ${v.reference||v.title}`,detail:v.reference?v.title:'Awaiting client approval',area:'Projects',target:{type:'project',id:v.project_id,tab:'commercial'},severity:'warning'});
  }
  if(can(a.role,'claim.approve')){
   const rows=await query<{id:string;number:number;period:string;project_id:string}>("SELECT id,number,period,project_id FROM progress_claims WHERE organisation_id=? AND status='internal_approval' ORDER BY created_at LIMIT 5",[org]);
   for(const cl of rows)mine.push({key:`claim-${cl.id}`,title:`Approve claim ${cl.number}`,detail:`${cl.period} · Internal approval requested`,area:'Projects',target:{type:'project',id:cl.project_id,tab:'commercial'},severity:'warning'});
  }
  const drafts=await count("SELECT COUNT(*) AS n FROM project_variations WHERE organisation_id=? AND status='draft'",[org]);if(drafts)attention.push({key:'variation-drafts',title:`${plural(drafts,'draft variation')} not submitted`,detail:'Notice periods may apply',area:'Commercial',severity:'warning'});
  const unclaimed=await count("SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND status='approved'",[org]);if(unclaimed)attention.push({key:'unclaimed',title:`${plural(unclaimed,'approved docket')} not yet claimed`,detail:'Include them in the next progress claim',area:'Commercial',severity:'info'});
  const overdueInv=await count("SELECT COUNT(*) AS n FROM client_invoices WHERE organisation_id=? AND status IN ('issued','part_paid') AND due_date IS NOT NULL AND due_date<?",[org,today]);if(overdueInv)attention.push({key:'invoices-overdue',title:`${plural(overdueInv,'overdue invoice')}`,detail:'Past due date and unpaid',area:'Commercial',severity:'danger'});
 })());
 if(can(a.role,'project.view'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM library_items WHERE organisation_id=? AND status='current' AND expiry_date IS NOT NULL AND expiry_date<=?",[org,month]);if(n)attention.push({key:'library-expiry',title:`${plural(n,'library item')} expired or expiring within 30 days`,detail:'Insurances, licences and certifications',area:'Documents',severity:'warning'});})());
 // Organisation dispatch indicators belong to the people who plan the schedule.
 if(on('operations','schedule.edit'))tasks.push((async()=>{
  const tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);
  const rows=await query<{date:string;status:string;requirements:string|null;assignments:string|null}>("SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date')) AS date,status,JSON_EXTRACT(metadata,'$.requirements') AS requirements,JSON_EXTRACT(metadata,'$.assignments') AS assignments FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date')) BETWEEN ? AND ? AND status NOT IN ('Cancelled','Archived')",[org,tomorrow,soon]);
  const parse=(v:string|null)=>{try{const x=typeof v==='string'?JSON.parse(v):v;return Array.isArray(x)?x:[];}catch{return [];}};
  const next=rows.filter(r=>r.date===tomorrow&&r.status!=='Draft');
  const full=next.filter(r=>{const as=parse(r.assignments);return as.length>0&&coverage(parse(r.requirements) as Requirement[],as).every(c=>!c.missing);}).length;
  if(next.length)indicators.push({key:'tomorrow-resourced',label:"Tomorrow's shifts fully resourced",value:`${full} / ${next.length}`,detail:'Requirements met and resources assigned',area:'Schedule',severity:full<next.length?'warning':'ok'});
  const unassigned=rows.filter(r=>r.status!=='Draft'&&!parse(r.assignments).length).length;
  if(unassigned)indicators.push({key:'unassigned',label:'Shifts with no resources',value:String(unassigned),detail:'Next 7 days',area:'Schedule',severity:'danger'});
  const drafts=rows.filter(r=>r.status==='Draft').length;
  if(drafts)indicators.push({key:'draft-shifts',label:'Draft shifts not published',value:String(drafts),detail:'Next 7 days',area:'Schedule',severity:'warning'});
  const held=await count("SELECT COUNT(*) AS n FROM plant WHERE organisation_id=? AND safety_hold=1",[org]);
  if(held)indicators.push({key:'plant-hold',label:'Plant on safety hold',value:String(held),detail:'Unavailable for allocation',area:'Resources',severity:'warning'});
  const expired=await count("SELECT COUNT(*) AS n FROM worker_competencies WHERE organisation_id=? AND expiry_date IS NOT NULL AND expiry_date<?",[org,today]);
  if(expired)indicators.push({key:'competencies-expired',label:'Expired competencies',value:String(expired),detail:'Tickets and licences past expiry',area:'Resources',severity:'danger'});
 })());
 if(on('operations','schedule.view')||on('field','field.capture'))tasks.push((async()=>{
  const shifts=await query("SELECT s.id,s.name,s.status,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.start')) AS start,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.assignments')) AS assignments,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.supervisorUserId')) AS supervisor,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AS project_id,j.name AS job FROM shifts s LEFT JOIN jobs j ON j.id=JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))=? AND s.status NOT IN ('Cancelled','Archived','Draft') ORDER BY start LIMIT 50",[org,today]);
  // Same rules as /api/field/today (lib/platform/shift-scope.ts).
  const audience=await shiftAudience(a);
  const parse=(v:unknown)=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return [];}};
  for(const s of shifts){
   if(!shiftVisible(audience,{supervisorUserId:s.supervisor,assignments:parse(s.assignments),jobId:s.project_id}))continue;
   todayItems.push({key:`shift-${s.id}`,title:s.name,detail:[s.start,s.job,s.status].filter(Boolean).join(' · '),area:a.role==='field'?'Field':s.project_id&&on('projects','project.view')?'Projects':'Schedule',target:a.role==='field'?{type:'shift',id:s.id}:s.project_id&&on('projects','project.view')?{type:'project',id:String(s.project_id),tab:'delivery'}:undefined,severity:'info'});
  }
 })());
 await Promise.all(tasks);
 // Promise-backed feeds finish in different orders; keep the work queue stable and urgency-first on every refresh.
 const rank={danger:0,warning:1,info:2} as const,order=(x:HomeItem,y:HomeItem)=>rank[x.severity]-rank[y.severity]||x.title.localeCompare(y.title);
 mine.sort(order);attention.sort(order);
 return {date:today,myActions:mine,needsAttention:attention,today:todayItems,indicators,myProjects};
}
