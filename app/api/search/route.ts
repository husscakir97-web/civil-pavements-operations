import {withActor} from '@/lib/platform/route';
import {requireEstimateDb} from '@/lib/estimates-db';
import {actorContext} from '@/lib/platform/context';
import {can,type Capability} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import type {ModuleKey} from '@/lib/platform/modules';

// Global search across authorised records. Every spec declares the module it
// belongs to and the capability required to see it; field users only search
// operational records and never receive commercial fields or raw metadata.
type Spec={table:string;type:string;module:ModuleKey;capability:Capability|'field';name:string;status:string;detail:string;match:string[];filter?:string;area:string;project?:string};
const specs:Spec[]=[
 {table:'clients',type:'Client',module:'core',capability:'pipeline.view',name:'name',status:"'active'",detail:"CONCAT_WS(' · ',contact_name,email,phone)",match:['name','contact_name','email'],area:'Pipeline/Opportunities'},
 {table:'opportunities',type:'Opportunity',module:'pipeline',capability:'pipeline.view',name:'name',status:"COALESCE(stage,status)",detail:"COALESCE(client_name,'')",match:['name','client_name','location'],filter:"AND LOWER(status)<>'archived'",area:'Pipeline/Opportunities'},
 {table:'tenders',type:'Tender',module:'pipeline',capability:'pipeline.view',name:'title',status:'stage',detail:"CONCAT_WS(' · ',reference,client_name)",match:['title','reference','client_name'],area:'Pipeline/Tenders'},
 {table:'estimates',type:'Estimate',module:'estimating',capability:'commercial.view',name:'name',status:'status',detail:"''",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Pipeline/Estimates'},
 {table:'jobs',type:'Project',module:'projects',capability:'field',name:'name',status:"COALESCE(stage,status)",detail:"CONCAT_WS(' · ',project_number,client_name)",match:['name','project_number','client_name'],filter:"AND LOWER(status)<>'archived'",area:'Projects',project:'id'},
 {table:'shifts',type:'Shift',module:'operations',capability:'field',name:'name',status:'status',detail:"JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.date'))",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Schedule'},
 {table:'swms',type:'SWMS',module:'ims',capability:'field',name:'title',status:'status',detail:"CONCAT_WS(' · ',reference,activity)",match:['title','reference','activity'],area:'IMS & HSEQ',project:'project_id'},
 {table:'project_variations',type:'Variation',module:'commercial',capability:'commercial.view',name:'title',status:'status',detail:'reference',match:['title','reference','client_reference'],area:'Commercial',project:'project_id'},
 {table:'progress_claims',type:'Claim',module:'commercial',capability:'commercial.view',name:"CONCAT('Claim ',number,' — ',period)",status:'status',detail:'period',match:['period'],area:'Commercial',project:'project_id'},
 {table:'client_invoices',type:'Invoice',module:'commercial',capability:'invoice.manage',name:'invoice_number',status:'status',detail:'invoice_date',match:['invoice_number'],area:'Commercial',project:'project_id'},
 {table:'library_items',type:'Library item',module:'core',capability:'project.view',name:'title',status:'status',detail:'category',match:['title','description','category'],area:'Admin/Company Library'},
 {table:'documents',type:'Document',module:'core',capability:'project.view',name:'title',status:'status',detail:'file_name',match:['title','file_name','category'],area:'Documents',project:'project_id'},
 {table:'workers',type:'Worker',module:'operations',capability:'schedule.view',name:'name',status:'status',detail:"''",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Resources'},
 {table:'plant',type:'Plant',module:'operations',capability:'schedule.view',name:'name',status:'status',detail:"''",match:['name'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Resources'},
 {table:'dockets',type:'Docket',module:'dockets',capability:'docket.approve',name:'docket_no',status:'status',detail:"CONCAT_WS(' · ',client,project,po_number)",match:['docket_no','client','project','po_number'],filter:"AND LOWER(status)<>'archived'",area:'Operations/Dockets'},
];

async function handleGET(request:Request){
 try{
  const db=requireEstimateDb(),actor=actorContext.getStore()!;
  const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,200);
  if(q.length<2)return Response.json({results:[]});
  const entitlements=await getEntitlements(actor.organisationId);
  const allowed=specs.filter(s=>usable(entitlements,s.module)&&(s.capability==='field'?true:can(actor.role,s.capability)));
  const like=`%${q.replace(/[\\%_]/g,m=>'\\'+m)}%`;
  const groups=await Promise.all(allowed.map(async spec=>{
   const fieldDocs=spec.table==='documents'&&actor.role==='field'?" AND visibility='field'":'';
   const fieldSwms=spec.table==='swms'&&actor.role==='field'?' AND issued_revision_id IS NOT NULL':'';
   const r=await db.prepare(`SELECT id,${spec.name} AS name,${spec.status} AS status,${spec.detail} AS detail${spec.project?`,${spec.project} AS project_id`:''} FROM ${spec.table} WHERE organisation_id=? ${spec.filter||''}${fieldDocs}${fieldSwms} AND (${spec.match.map(c=>`${c} LIKE ?`).join(' OR ')}) LIMIT 10`).bind(actor.organisationId,...spec.match.map(()=>like)).all<Record<string,unknown>>();
   return r.results.map(x=>({id:String(x.id),name:String(x.name??''),status:String(x.status??''),detail:String(x.detail??'').slice(0,200),type:spec.type,area:spec.area,projectId:x.project_id?String(x.project_id):null}));
  }));
  return Response.json({results:groups.flat().slice(0,80)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){console.error('search',e);return Response.json({error:'Search is unavailable. Please retry.'},{status:503});}
}

export const GET=withActor(handleGET,'field-read');
