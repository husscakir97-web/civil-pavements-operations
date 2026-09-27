// Home: role-aware My Actions / Needs Attention / Today, derived from workflow
// state. Each query only runs when the module is entitled and the role holds
// the capability, so field users never receive commercial counts.
import {actorContext} from '@/lib/platform/context';
import {can,type Capability} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import type {ModuleKey} from '@/lib/platform/modules';
import {query,one} from '@/lib/platform/sql';
import {easternDate} from '@/lib/reporting';

export type HomeItem={key:string;title:string;detail:string;area:string;target?:{type:string;id:string;tab?:string};severity:'info'|'warning'|'danger'};
const plural=(n:number,w:string,p=w+'s')=>`${n} ${n===1?w:p}`;

export async function homeFeed(){
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org),today=easternDate(new Date());
 const soon=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10),month=new Date(Date.parse(today)+30*86400000).toISOString().slice(0,10);
 const on=(m:ModuleKey,c?:Capability)=>usable(e,m)&&(!c||can(a.role,c));
 const mine:HomeItem[]=[],attention:HomeItem[]=[],todayItems:HomeItem[]=[];
 const count=async(sql:string,params:unknown[])=>Number((await one<{n:number}>(sql,params))?.n||0);
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
  const setup=await query<{id:string;name:string}>("SELECT id,name FROM jobs WHERE organisation_id=? AND stage='setup' ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 5",[org]);
  for(const p of setup)attention.push({key:`project-setup-${p.id}`,title:`Project not ready: ${p.name}`,detail:'Complete readiness before mobilisation',area:'Projects',target:{type:'project',id:p.id,tab:'setup'},severity:'warning'});
  const closeout=await query<{id:string;name:string}>("SELECT id,name FROM jobs WHERE organisation_id=? AND stage IN ('practical_completion','closeout') ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 5",[org]);
  for(const p of closeout)attention.push({key:`project-closeout-${p.id}`,title:`Close out project: ${p.name}`,detail:'Finish the closeout checklist',area:'Projects',target:{type:'project',id:p.id,tab:'closeout'},severity:'info'});
 })());
 if(on('ims'))tasks.push((async()=>{
  if(can(a.role,'swms.approve')){
   const rows=await query<{id:string;reference:string;title:string;project_id:string|null}>("SELECT id,reference,title,project_id FROM swms WHERE organisation_id=? AND status='review' ORDER BY updated_at DESC LIMIT 5",[org]);
   for(const s of rows)mine.push({key:`swms-approval-${s.id}`,title:`Approve ${s.reference||'SWMS'}: ${s.title}`,detail:'Submitted for review',area:s.project_id?'Projects':'IMS & HSEQ',target:s.project_id?{type:'project',id:s.project_id,tab:'quality'}:undefined,severity:'warning'});
  }
  if(can(a.role,'hseq.view')){
   const ncr=await count("SELECT COUNT(*) AS n FROM hseq_ncrs WHERE organisation_id=? AND status<>'closed'",[org]);if(ncr)attention.push({key:'ncrs',title:`${plural(ncr,'open NCR')}`,detail:'Non-conformances awaiting action or verification',area:'IMS & HSEQ',severity:'warning'});
   const inc=await count("SELECT COUNT(*) AS n FROM hseq_incidents WHERE organisation_id=? AND status<>'closed'",[org]);if(inc)attention.push({key:'incidents',title:`${plural(inc,'open incident')}`,detail:'Reported or under investigation',area:'IMS & HSEQ',severity:'danger'});
   const overdue=await count("SELECT COUNT(*) AS n FROM hseq_actions WHERE organisation_id=? AND status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date<?",[org,today]);if(overdue)attention.push({key:'actions-overdue',title:`${plural(overdue,'overdue corrective action')}`,detail:'Past their due date',area:'IMS & HSEQ',severity:'danger'});
  }
  if(a.role==='field'){
   const itp=await count("SELECT COUNT(*) AS n FROM itp_items WHERE organisation_id=? AND assigned_user_id=? AND status='open'",[org,a.userId]);if(itp)mine.push({key:'itp',title:`Complete ${plural(itp,'inspection point')}`,detail:'Quality records assigned to you',area:'Field',severity:'info'});
  }
 })());
 if(on('dockets','docket.approve'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND status IN ('review','matched','ready','uploaded','duplicate')",[org]);if(n)mine.push({key:'dockets',title:`Review ${plural(n,'docket')}`,detail:'Awaiting office review and approval',area:'Operations/Dockets',severity:'warning'});})());
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
 if(can(a.role,'project.view'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM library_items WHERE organisation_id=? AND status='current' AND expiry_date IS NOT NULL AND expiry_date<=?",[org,month]);if(n)attention.push({key:'library-expiry',title:`${plural(n,'library item')} expired or expiring within 30 days`,detail:'Insurances, licences and certifications',area:'Admin/Company Library',severity:'warning'});})());
 if(on('operations')||on('field'))tasks.push((async()=>{
  const shifts=await query("SELECT s.id,s.name,s.status,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.start')) AS start,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.assignments')) AS assignments,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.supervisorUserId')) AS supervisor,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AS project_id,j.name AS job FROM shifts s LEFT JOIN jobs j ON j.id=JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))=? AND s.status NOT IN ('Cancelled','Archived','Draft') ORDER BY start LIMIT 50",[org,today]);
  for(const s of shifts){
   if(a.role==='field'&&s.supervisor!==a.userId&&!String(s.assignments||'').includes(a.userId))continue;
   todayItems.push({key:`shift-${s.id}`,title:s.name,detail:[s.start,s.job,s.status].filter(Boolean).join(' · '),area:a.role==='field'?'Field':s.project_id?'Projects':'Operations/Schedule',target:a.role==='field'?{type:'shift',id:s.id}:s.project_id?{type:'project',id:String(s.project_id),tab:'delivery'}:undefined,severity:'info'});
  }
 })());
 await Promise.all(tasks);
 // Promise-backed feeds finish in different orders; keep the work queue stable and urgency-first on every refresh.
 const rank={danger:0,warning:1,info:2} as const,order=(x:HomeItem,y:HomeItem)=>rank[x.severity]-rank[y.severity]||x.title.localeCompare(y.title);
 mine.sort(order);attention.sort(order);
 return {date:today,myActions:mine,needsAttention:attention,today:todayItems};
}
