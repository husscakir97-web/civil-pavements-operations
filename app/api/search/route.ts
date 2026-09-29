import {withActor} from '@/lib/platform/route';
import {requireEstimateDb} from '@/lib/estimates-db';
import {actorContext} from '@/lib/platform/context';
import {can,type Capability} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {documentContextsForAccess,fieldDocumentContextsForAccess} from '@/lib/platform/documents';
import {projectScope} from '@/lib/platform/project-access';
import {canViewClients,visibleClientIds} from '@/lib/platform/clients';
import type {ModuleKey} from '@/lib/platform/modules';

// Global search across authorised records. Every spec declares the module it
// belongs to and the capability required to see it; field users only search
// operational records and never receive commercial fields or raw metadata.
type Spec={table:string;type:string;module:ModuleKey;capability:Capability|'field'|'clients';name:string;status:string;detail:string;match:string[];filter?:string;area:string;project?:string;tender?:string;client?:string};
const specs:Spec[]=[
 // Client master (Core): clients, their contacts and sites. Project-scoped users only find clients of their own projects.
 {table:'clients',type:'Client',module:'core',capability:'clients',name:'name',status:'status',detail:"CONCAT_WS(' · ',legal_name,IF(abn IS NULL OR abn='',NULL,CONCAT('ABN ',abn)),client_code,contact_name)",match:['name','legal_name','abn','client_code','contact_name','email'],filter:"AND status<>'merged'",area:'CRM/Clients',client:'id'},
 {table:'client_contacts',type:'Contact',module:'core',capability:'clients',name:'name',status:'status',detail:"CONCAT_WS(' · ',role,(SELECT c.name FROM clients c WHERE c.organisation_id=client_contacts.organisation_id AND c.id=client_contacts.client_id),email,COALESCE(mobile,phone))",match:['name','email','role','phone','mobile'],filter:"AND status<>'archived'",area:'CRM/Clients',client:'client_id'},
 {table:'client_sites',type:'Site',module:'core',capability:'clients',name:'name',status:'status',detail:"CONCAT_WS(' · ',(SELECT c.name FROM clients c WHERE c.organisation_id=client_sites.organisation_id AND c.id=client_sites.client_id),address,suburb)",match:['name','address','suburb'],filter:"AND client_id IS NOT NULL",area:'CRM/Clients',client:'client_id'},
 {table:'opportunities',type:'Opportunity',module:'pipeline',capability:'pipeline.view',name:'name',status:"COALESCE(stage,status)",detail:"COALESCE(client_name,'')",match:['name','client_name','location'],filter:"AND LOWER(status)<>'archived'",area:'Pipeline/Opportunities'},
 {table:'tenders',type:'Tender',module:'pipeline',capability:'pipeline.view',name:'title',status:'stage',detail:"CONCAT_WS(' · ',reference,client_name)",match:['title','reference','client_name'],area:'Pipeline/Tenders'},
 {table:'estimates',type:'Estimate',module:'estimating',capability:'commercial.view',name:'name',status:'status',detail:"''",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Pipeline/Estimates',tender:'(SELECT t.id FROM tenders t WHERE t.organisation_id=estimates.organisation_id AND t.estimate_id=estimates.id LIMIT 1)'},
 {table:'jobs',type:'Project',module:'projects',capability:'field',name:'name',status:"COALESCE(stage,status)",detail:"CONCAT_WS(' · ',project_number,client_name)",match:['name','project_number','client_name'],filter:"AND LOWER(status)<>'archived'",area:'Projects',project:'id'},
 {table:'shifts',type:'Shift',module:'operations',capability:'field',name:'name',status:'status',detail:"JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date'))",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Schedule',project:"JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.jobId'))"},
 {table:'swms',type:'SWMS',module:'ims',capability:'field',name:'title',status:'status',detail:"CONCAT_WS(' · ',reference,activity)",match:['title','reference','activity'],area:'IMS & HSEQ',project:'project_id'},
 {table:'project_variations',type:'Variation',module:'commercial',capability:'commercial.view',name:'title',status:'status',detail:'reference',match:['title','reference','client_reference'],area:'Commercial',project:'project_id'},
 {table:'progress_claims',type:'Claim',module:'commercial',capability:'commercial.view',name:"CONCAT('Claim ',number,' — ',period)",status:'status',detail:'period',match:['period'],area:'Commercial',project:'project_id'},
 {table:'client_invoices',type:'Invoice',module:'commercial',capability:'invoice.manage',name:'invoice_number',status:'status',detail:'invoice_date',match:['invoice_number'],area:'Commercial',project:'project_id'},
 {table:'library_items',type:'Library item',module:'core',capability:'project.view',name:'title',status:'status',detail:"CONCAT_WS(' · ',category,owner_name,IF(expiry_date IS NULL,NULL,CONCAT('expires ',expiry_date)))",match:['title','description','category','owner_name','content','(SELECT d.file_name FROM documents d WHERE d.id=library_items.document_id AND d.organisation_id=library_items.organisation_id)'],area:'Admin/Company Library'},
 {table:'documents',type:'Document',module:'core',capability:'project.view',name:'title',status:'status',detail:'file_name',match:['title','file_name','category'],area:'Documents',project:"COALESCE(project_id,CASE WHEN context_type='project' THEN context_id END)"},
 {table:'workers',type:'Worker',module:'operations',capability:'schedule.view',name:'name',status:'status',detail:"CONCAT_WS(' · ',employee_number,role_title,location)",match:['name','employee_number','role_title','email'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Resources'},
 {table:'plant',type:'Plant',module:'operations',capability:'schedule.view',name:'name',status:'status',detail:"CONCAT_WS(' · ',plant_number,registration,category,CONCAT_WS(' ',make,model),location)",match:['name','plant_number','registration','category','make','model','description','location'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Resources'},
 {table:'dockets',type:'Docket',module:'dockets',capability:'docket.approve',name:'docket_no',status:'status',detail:"CONCAT_WS(' · ',client,project,po_number)",match:['docket_no','client','project','po_number'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Dockets',project:"JSON_UNQUOTE(JSON_EXTRACT(links,'$.jobId'))"},
];

async function handleGET(request:Request){
 try{
  const db=requireEstimateDb(),actor=actorContext.getStore()!;
  const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,200);
  if(q.length<2)return Response.json({results:[]});
  const entitlements=await getEntitlements(actor.organisationId);
  const allowed=specs.filter(s=>usable(entitlements,s.module)&&(s.capability==='field'?true:s.capability==='clients'?canViewClients(actor.role):can(actor.role,s.capability)));
  const clientIds=await visibleClientIds();
  // Legacy tables use utf8mb4_bin (case-sensitive), so fields and terms are lower-cased.
  // Every word must appear in one of the record's searchable fields, so
  // "public liability" finds "Public & Products Liability Insurance".
  const terms=q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,6).map(t=>`%${t.replace(/[\\%_]/g,m=>'\\'+m)}%`);
  const groups=await Promise.all(allowed.map(async spec=>{
   const docContexts=(actor.role==='field'?fieldDocumentContextsForAccess(entitlements):documentContextsForAccess(actor.role,entitlements)).map(c=>`'${c}'`).join(',')||"''";
   const fieldDocs=spec.table==='documents'?(actor.role==='field'?` AND visibility='field' AND context_type IN (${docContexts})`:` AND context_type IN (${docContexts})`):'';
   const fieldSwms=spec.table==='swms'&&actor.role==='field'?' AND issued_revision_id IS NOT NULL':'';
   const r=await db.prepare(`SELECT id,${spec.name} AS name,${spec.status} AS status,${spec.detail} AS detail${spec.project?`,${spec.project} AS project_id`:''}${spec.tender?`,${spec.tender} AS tender_id`:''}${spec.client?`,${spec.client} AS client_id`:''} FROM ${spec.table} WHERE organisation_id=? ${spec.filter||''}${fieldDocs}${fieldSwms} AND ${terms.map(()=>`(${spec.match.map(c=>`LOWER(${c}) LIKE ?`).join(' OR ')})`).join(' AND ')} LIMIT 10`).bind(actor.organisationId,...terms.flatMap(t=>spec.match.map(()=>t))).all<Record<string,unknown>>();
   return r.results.map(x=>({id:String(x.id),name:String(x.name??''),status:String(x.status??''),detail:String(x.detail??'').slice(0,200),type:spec.type,area:spec.area,projectId:x.project_id?String(x.project_id):null,tenderId:x.tender_id?String(x.tender_id):null,clientId:x.client_id?String(x.client_id):null}));
  }));
  // Project-scoped roles never find records belonging to projects they are not assigned to.
  const scope=await projectScope(actor);
  const visible=groups.flat().filter(r=>(!scope||!r.projectId||scope.includes(r.projectId))&&(!clientIds||!r.clientId||clientIds.includes(r.clientId)))
   // Exact name matches first, then prefix matches, so “Abergeldie” puts the client above its projects.
   .map((r,i)=>({r,i,rank:r.name.toLowerCase()===q.toLowerCase()?0:r.name.toLowerCase().startsWith(q.toLowerCase())?1:2})).sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.r);
  return Response.json({results:visible.slice(0,80)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){console.error('search',e);return Response.json({error:'Search is unavailable. Please retry.'},{status:503});}
}

export const GET=withActor(handleGET,'field-read');
