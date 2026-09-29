// Client "Work" view: what we have done and are doing for a client, read directly from the
// source records (opportunities, tenders, estimates, projects, shifts) — nothing is copied
// into CRM tables. Each section appears only when the module is entitled and the role holds
// the capability; project-derived rows are limited to the projects the user can access, and
// no totals are computed over records the user cannot see.
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {projectScope} from '@/lib/platform/project-access';
import {query} from '@/lib/platform/sql';
import {easternDate} from '@/lib/reporting';
import {clientDetail} from '@/lib/platform/clients';
import {legacyOpportunityStage} from '@/lib/v1/register-server';
import {stageOf} from '@/lib/modules/projects/projects';

export async function clientWork(clientId:string){
 const client=await clientDetail(clientId);
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org),money=can(a.role,'commercial.view')&&usable(e,'commercial');
 const scope=await projectScope(a);
 const inScope=(col:string)=>scope?` AND ${col} IN (?)`:'',sp=()=>scope?[scope.length?scope:['-']]:[];
 const out:Record<string,unknown>={client};
 const tasks:Promise<void>[]=[];
 if(usable(e,'projects')&&can(a.role,'project.view'))tasks.push((async()=>{
  const rows=await query(`SELECT id,name,project_number,stage,status,start_date,site_address,created_at FROM jobs WHERE organisation_id=? AND client_id=? AND LOWER(status)<>'archived'${inScope('id')} ORDER BY created_at DESC LIMIT 100`,[org,clientId,...sp()]);
  const list=rows.map(p=>({id:p.id,name:p.name,projectNumber:p.project_number,stage:stageOf(p),startDate:p.start_date,site:p.site_address}));
  out.projects={active:list.filter(p=>p.stage!=='closed'),completed:list.filter(p=>p.stage==='closed')};
 })());
 // Pipeline records are organisation-level sales work: only for pipeline roles (never project-scoped engineers).
 if(usable(e,'pipeline')&&can(a.role,'pipeline.view')){
  tasks.push((async()=>{
   const rows=await query("SELECT id,name,stage,status,estimated_value,closing_date FROM opportunities WHERE organisation_id=? AND client_id=? AND LOWER(status)<>'archived' ORDER BY created_at DESC LIMIT 50",[org,clientId]);
   out.opportunities=rows.map(o=>({id:o.id,name:o.name,stage:o.stage||legacyOpportunityStage(o.status),closingDate:o.closing_date,...(money?{estimatedValue:o.estimated_value==null?null:Number(o.estimated_value)}:{})})).filter(o=>!['converted','lost'].includes(o.stage));
  })());
  tasks.push((async()=>{
   const rows=await query("SELECT id,title,reference,stage,due_date,estimated_value,project_id,estimate_id FROM tenders WHERE organisation_id=? AND client_id=? ORDER BY created_at DESC LIMIT 50",[org,clientId]);
   out.tenders=rows.map(t=>({id:t.id,title:t.title,reference:t.reference,stage:t.stage,dueDate:t.due_date,projectId:t.project_id,...(money?{estimatedValue:t.estimated_value==null?null:Number(t.estimated_value)}:{})}));
  })());
 }
 if(usable(e,'estimating')&&(can(a.role,'pipeline.view')||can(a.role,'estimate.edit')))tasks.push((async()=>{
  const rows=await query("SELECT e.id,e.name,e.workflow_state,e.tender_id,e.updated_at FROM estimates e LEFT JOIN tenders t ON t.organisation_id=e.organisation_id AND t.id=e.tender_id WHERE e.organisation_id=? AND (t.client_id=? OR JSON_UNQUOTE(JSON_EXTRACT(e.metadata,'$.data.clientId'))=?) AND LOWER(e.status)<>'archived' ORDER BY e.updated_at DESC LIMIT 50",[org,clientId,clientId]);
  out.estimates=rows.map(x=>({id:x.id,name:x.name,state:x.workflow_state||'draft',tenderId:x.tender_id}));
 })());
 if(usable(e,'operations')&&can(a.role,'schedule.view'))tasks.push((async()=>{
  const today=easternDate(new Date());
  const rows=await query(`SELECT s.id,s.name,s.status,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date')) AS date,JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.start')) AS start,j.id AS project_id,j.name AS project FROM shifts s JOIN jobs j ON j.organisation_id=s.organisation_id AND j.id=JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) WHERE s.organisation_id=? AND j.client_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))>=? AND s.status NOT IN ('Cancelled','Archived')${inScope('j.id')} ORDER BY date,start LIMIT 20`,[org,clientId,today,...sp()]);
  out.upcoming=rows.map(s=>({id:s.id,name:s.name,status:s.status,date:s.date,start:s.start,projectId:s.project_id,project:s.project}));
 })());
 await Promise.all(tasks);
 return out;
}
