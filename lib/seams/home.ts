// Home: role-aware My Actions / Needs Attention / Today, derived from workflow
// state. Each query only runs when the module is entitled and the role holds
// the capability, so field users never receive commercial counts.
import {actorContext} from '@/lib/platform/context';
import {can,type Capability} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import type {ModuleKey} from '@/lib/platform/modules';
import {query,one} from '@/lib/platform/sql';
import {easternDate} from '@/lib/reporting';

export type HomeItem={key:string;title:string;detail:string;area:string;target?:{type:string;id:string};severity:'info'|'warning'|'danger'};
const plural=(n:number,w:string,p=w+'s')=>`${n} ${n===1?w:p}`;

export async function homeFeed(){
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org),today=easternDate(new Date());
 const soon=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10),month=new Date(Date.parse(today)+30*86400000).toISOString().slice(0,10);
 const on=(m:ModuleKey,c?:Capability)=>usable(e,m)&&(!c||can(a.role,c));
 const mine:HomeItem[]=[],attention:HomeItem[]=[],todayItems:HomeItem[]=[];
 const count=async(sql:string,params:unknown[])=>Number((await one<{n:number}>(sql,params))?.n||0);
 const tasks:Promise<void>[]=[];
 const add=(list:HomeItem[],item:HomeItem|null)=>{if(item)list.push(item);};

 if(on('pipeline','pipeline.view'))tasks.push((async()=>{
  const owned=await query("SELECT id,title,stage,due_date FROM tenders WHERE organisation_id=? AND owner_user_id=? AND stage NOT IN ('awarded','lost') ORDER BY due_date IS NULL,due_date LIMIT 5",[org,a.userId]);
  for(const t of owned)mine.push({key:`tender-${t.id}`,title:`Tender: ${t.title}`,detail:t.due_date?`Due ${t.due_date}`:'No due date recorded',area:'Pipeline/Tenders',target:{type:'tender',id:t.id},severity:t.due_date&&t.due_date<=soon?'warning':'info'});
  const assigned=await count("SELECT COUNT(*) AS n FROM tender_returnables WHERE organisation_id=? AND assignee_user_id=? AND status NOT IN ('complete','not_applicable')",[org,a.userId]);
  if(assigned)mine.push({key:'returnables',title:`Complete ${plural(assigned,'assigned returnable')}`,detail:'Tender returnables assigned to you',area:'Pipeline/Tenders',severity:'warning'});
  const reqs=await count("SELECT COUNT(*) AS n FROM tender_requirements WHERE organisation_id=? AND owner_user_id=? AND status IN ('open','in_progress','Missing')",[org,a.userId]);
  if(reqs)mine.push({key:'requirements',title:`Resolve ${plural(reqs,'tender requirement')}`,detail:'Requirements where you are responsible',area:'Pipeline/Tenders',severity:'info'});
  const due=await count("SELECT COUNT(*) AS n FROM tenders WHERE organisation_id=? AND stage IN ('draft','reviewing','pricing','approval') AND due_date IS NOT NULL AND due_date<=?",[org,soon+'T23:59']);
  if(due)attention.push({key:'tenders-due',title:`${plural(due,'tender')} due within 7 days`,detail:'Not yet submitted',area:'Pipeline/Tenders',severity:'danger'});
  const suggested=await count("SELECT COUNT(*) AS n FROM tender_requirements WHERE organisation_id=? AND status='suggested' AND tender_id IS NOT NULL",[org]);
  if(suggested)attention.push({key:'suggested',title:`${plural(suggested,'suggested requirement')} to confirm`,detail:'Extracted from tender documents — a person must confirm or reject',area:'Pipeline/Tenders',severity:'warning'});
  if(can(a.role,'tender.approve')){const n=await count("SELECT COUNT(*) AS n FROM tenders WHERE organisation_id=? AND stage='approval' AND approval_status='requested'",[org]);if(n)mine.push({key:'tender-approvals',title:`Approve ${plural(n,'tender')}`,detail:'Internal approval requested',area:'Pipeline/Tenders',severity:'warning'});}
  const clar=await count("SELECT COUNT(*) AS n FROM tender_clarifications WHERE organisation_id=? AND status='open'",[org]);
  if(clar)attention.push({key:'clarifications',title:`${plural(clar,'open clarification')}`,detail:'Client questions awaiting a response',area:'Pipeline/Tenders',severity:'warning'});
 })());
 if(on('estimating','estimate.approve'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM estimates WHERE organisation_id=? AND workflow_state='review'",[org]);if(n)mine.push({key:'estimate-approvals',title:`Approve ${plural(n,'estimate revision')}`,detail:'Submitted for review',area:'Pipeline/Estimates',severity:'warning'});})());
 if(on('projects','project.view'))tasks.push((async()=>{
  const setup=await count("SELECT COUNT(*) AS n FROM jobs WHERE organisation_id=? AND stage='setup'",[org]);
  if(setup)attention.push({key:'projects-setup',title:`${plural(setup,'project')} not yet ready`,detail:'Complete readiness before mobilisation',area:'Projects',severity:'warning'});
  const closeout=await count("SELECT COUNT(*) AS n FROM jobs WHERE organisation_id=? AND stage IN ('practical_completion','closeout')",[org]);
  if(closeout)attention.push({key:'closeout',title:`${plural(closeout,'project')} in closeout`,detail:'Finish the closeout checklist',area:'Projects',severity:'info'});
 })());
 if(on('ims'))tasks.push((async()=>{
  if(can(a.role,'swms.approve')){const n=await count("SELECT COUNT(*) AS n FROM swms WHERE organisation_id=? AND status='review'",[org]);if(n)mine.push({key:'swms-approvals',title:`Approve ${plural(n,'SWMS','SWMS')}`,detail:'Submitted for review',area:'IMS & HSEQ',severity:'warning'});}
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
  if(can(a.role,'variation.approve')){const n=await count("SELECT COUNT(*) AS n FROM project_variations WHERE organisation_id=? AND status='submitted'",[org]);if(n)mine.push({key:'variations',title:`Record decisions on ${plural(n,'submitted variation')}`,detail:'Awaiting client approval',area:'Commercial',severity:'warning'});}
  if(can(a.role,'claim.approve')){const n=await count("SELECT COUNT(*) AS n FROM progress_claims WHERE organisation_id=? AND status='internal_approval'",[org]);if(n)mine.push({key:'claims',title:`Approve ${plural(n,'claim')}`,detail:'Internal approval requested',area:'Commercial',severity:'warning'});}
  const drafts=await count("SELECT COUNT(*) AS n FROM project_variations WHERE organisation_id=? AND status='draft'",[org]);if(drafts)attention.push({key:'variation-drafts',title:`${plural(drafts,'draft variation')} not submitted`,detail:'Notice periods may apply',area:'Commercial',severity:'warning'});
  const unclaimed=await count("SELECT COUNT(*) AS n FROM dockets WHERE organisation_id=? AND status='approved'",[org]);if(unclaimed)attention.push({key:'unclaimed',title:`${plural(unclaimed,'approved docket')} not yet claimed`,detail:'Include them in the next progress claim',area:'Commercial',severity:'info'});
  const overdueInv=await count("SELECT COUNT(*) AS n FROM client_invoices WHERE organisation_id=? AND status IN ('issued','part_paid') AND due_date IS NOT NULL AND due_date<?",[org,today]);if(overdueInv)attention.push({key:'invoices-overdue',title:`${plural(overdueInv,'overdue invoice')}`,detail:'Past due date and unpaid',area:'Commercial',severity:'danger'});
 })());
 if(can(a.role,'project.view'))tasks.push((async()=>{const n=await count("SELECT COUNT(*) AS n FROM library_items WHERE organisation_id=? AND status='current' AND expiry_date IS NOT NULL AND expiry_date<=?",[org,month]);if(n)attention.push({key:'library-expiry',title:`${plural(n,'library item')} expired or expiring within 30 days`,detail:'Insurances, licences and certifications',area:'Admin/Company Library',severity:'warning'});})());
 if(on('operations')||on('field'))tasks.push((async()=>{
  const shifts=await query("SELECT s.id,s.name,s.status,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.start')) AS start,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.assignments')) AS assignments,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.supervisorUserId')) AS supervisor,j.name AS job FROM shifts s LEFT JOIN jobs j ON j.id=JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))=? AND s.status NOT IN ('Cancelled','Archived','Draft') ORDER BY start LIMIT 50",[org,today]);
  for(const s of shifts){
   if(a.role==='field'&&s.supervisor!==a.userId&&!String(s.assignments||'').includes(a.userId))continue;
   todayItems.push({key:`shift-${s.id}`,title:s.name,detail:[s.start,s.job,s.status].filter(Boolean).join(' · '),area:a.role==='field'?'Field':'Operations/Schedule',target:{type:'shift',id:s.id},severity:'info'});
  }
 })());
 await Promise.all(tasks);
 return {date:today,myActions:mine,needsAttention:attention,today:todayItems};
}
