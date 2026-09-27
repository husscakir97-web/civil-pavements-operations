// SEAM: Tender award / estimate award → Project.
// Both on: project created from the APPROVED estimate revision (never the live
// working copy) with an immutable baseline, cost codes, readiness requirements
// and full lineage (tender, estimate, revision, clarifications).
// Projects not entitled: the award is still recorded and an export is offered.
import {database,type Statement} from '@/lib/platform/database';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {HttpError} from '@/lib/platform/http';
import {seamEnabled} from '@/lib/platform/entitlements';
import {packStatements} from '@/lib/ims-pack';
import {safeJson} from '@/lib/estimates-db';
import {costBreakdown,type EstimateData,type EstimateTotals} from '@/lib/estimate-calculations';
import {loadEstimate,approvedRevision} from '@/lib/modules/estimating/approval';

const now=()=>new Date().toISOString();
const DEFAULT_READINESS:Array<[string,string]>=[
 ['contract','Contract executed and key dates confirmed'],
 ['contract','Insurances current for the contract'],
 ['project plans','Project Management Plan approved'],
 ['project plans','Quality Plan / ITPs approved'],
 ['HSEQ','WHS / Safety Plan approved'],
 ['HSEQ','Environmental controls confirmed'],
 ['workforce','Workforce allocated and inducted'],
 ['competencies','Competencies and licences checked for allocated workers'],
 ['plant','Plant allocated with current inspections'],
 ['subcontractors','Subcontractor compliance (insurance, SWMS) received'],
 ['procurement','Long-lead materials ordered'],
 ['permits','Permits and approvals obtained'],
 ['site setup','Site establishment and traffic management arranged'],
];
const CLIENT_REQUIREMENT_CATEGORIES=['contract','technical','programme','HSEQ','insurance','licence','personnel','plant','methodology'];

export async function awardEstimate(estimateId:string,opts:{tenderId?:string|null}={}){
 const actor=actorContext.getStore()!;
 if(!can(actor.role,'tender.award'))throw new HttpError(403,'You are not authorised to award work.');
 const org=actor.organisationId;
 const est=await loadEstimate(estimateId);
 if(est.meta.jobId)return {alreadyAwarded:true,projectCreated:true,jobId:String(est.meta.jobId),estimateId};
 const revision=await approvedRevision(estimateId);
 if(!revision)throw new HttpError(422,'This estimate has no approved revision. Submit it for review and approve it before award.');
 const snapshot=safeJson<{data:EstimateData;rateLibrary:unknown}>(revision.snapshot,{data:{} as EstimateData,rateLibrary:null});
 const data=snapshot.data,totals=safeJson<EstimateTotals>(revision.totals,{} as EstimateTotals);
 const tenderId=opts.tenderId??est.tender_id??null;
 let tender:{id:string;opportunity_id:string;stage:string;title:string;reference:string|null}|null=null;
 let clarifications:Array<Record<string,unknown>>=[];
 if(tenderId){
  tender=await database.prepare('SELECT id,opportunity_id,stage,title,reference FROM tenders WHERE organisation_id=? AND id=?').bind(org,tenderId).first();
  if(!tender)throw new HttpError(404,'Tender not found.');
  if(!['submitted','clarification'].includes(tender.stage))throw new HttpError(409,'Only a submitted tender can be awarded.');
  clarifications=(await database.prepare('SELECT id,reference,question,response,scope_impact,price_impact,status,created_at,updated_at FROM tender_clarifications WHERE organisation_id=? AND tender_id=? ORDER BY created_at').bind(org,tenderId).all<Record<string,unknown>>()).results;
  const repriced=clarifications.filter(c=>Number(c.price_impact||0)!==0&&String(c.updated_at)>String(revision.approved_at));
  if(repriced.length)throw new HttpError(409,'A clarification changed the price after the estimate was approved. Revise the estimate and approve the new revision before award.',{clarifications:repriced.map(c=>c.reference)});
 }
 const t=now();
 const awardAudit=(event:string,entityType:string,entityId:string,summary:string,after:unknown,projectId:string|null=null)=>database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org,actor.userId,actor.email,event,entityType,entityId,projectId,summary.slice(0,500),JSON.stringify(after),t);
 const tenderWrites=(projectId:string|null)=>tender?[
  database.prepare("UPDATE tenders SET stage='awarded',project_id=?,outcome_at=?,approved_estimate_revision_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=? AND stage IN ('submitted','clarification')").bind(projectId,t,revision.id,t,org,tender.id),
  database.prepare("UPDATE opportunities SET stage='won',status='won',updated_at=? WHERE organisation_id=? AND id=?").bind(t,org,tender.opportunity_id),
  awardAudit('tender.awarded','tender',tender.id,`Tender awarded${projectId?' — project created':' — projects module not entitled, award recorded'}`,{estimateId,estimateRevisionId:revision.id,projectId},projectId),
 ]:[];

 if(!await seamEnabled(org,'projects')){
  const writes:Statement[]=[...tenderWrites(null),database.prepare("UPDATE estimates SET status='Awarded',updated_at=? WHERE organisation_id=? AND id=?").bind(t,org,estimateId)];
  if(!tender)writes.push(awardAudit('estimate.awarded','estimate',estimateId,'Estimate awarded — projects module not entitled',{estimateRevisionId:revision.id}));
  await database.batch(writes);
  return {projectCreated:false,estimateId,tenderId,export:tender?`/api/tenders/export?id=${tender.id}`:null,message:'Award recorded. Projects is not enabled for your organisation; export the award to continue in your own system.'};
 }

 const jobId=crypto.randomUUID(),baselineId=crypto.randomUUID(),b=costBreakdown(totals);
 const count=await database.prepare('SELECT COUNT(*) AS n FROM jobs WHERE organisation_id=? AND project_number IS NOT NULL').bind(org).first<{n:number}>();
 const projectNumber=`PRJ-${String(Number(count?.n||0)+1).padStart(4,'0')}`;
 const name=data.projectName||data.name||est.name;
 const legacyMeta={client:data.clientName,site:data.site,contractValue:Number(revision.sell_price),workType:data.workType,scope:data.specification,specification:data.specification,sourceEstimateId:estimateId,sourceOpportunityId:est.meta.sourceOpportunityId||tender?.opportunity_id||null,sourceRevisionId:revision.id,sourceTenderId:tender?.id??null,approvedBudget:totals,estimateSnapshot:data,awardedAt:t,status:'Awarded'};
 const clarList=clarifications.map(c=>({id:c.id,reference:c.reference,question:c.question,response:c.response,scopeImpact:c.scope_impact,priceImpact:Number(c.price_impact||0),status:c.status}));
 const writes:Statement[]=[
  database.prepare(`INSERT INTO jobs (id,organisation_id,name,status,metadata,created_at,project_number,client_name,stage,contract_value,original_budget,site_address,scope,assumptions,exclusions,source_tender_id,source_estimate_id,source_estimate_revision_id,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(jobId,org,name,'awarded',JSON.stringify(legacyMeta),t,projectNumber,data.clientName||null,'setup',Number(revision.sell_price),b.total,data.site||null,data.specification||null,revision.assumptions,revision.exclusions,tender?.id??null,estimateId,revision.id,1,t),
  database.prepare(`INSERT INTO project_baselines (id,organisation_id,project_id,revision,reason,source_type,tender_id,estimate_id,estimate_revision_id,contract_value,budget_labour,budget_plant,budget_material,budget_subcontract,budget_other,budget_indirect,budget_total,scope,assumptions,exclusions,clarifications,snapshot,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(baselineId,org,jobId,1,'Original baseline from awarded estimate revision','award',tender?.id??null,estimateId,revision.id,Number(revision.sell_price),b.labour,b.plant,b.material,b.subcontract,b.other,b.indirect+b.contingency,b.total,data.specification||null,revision.assumptions,revision.exclusions,JSON.stringify(clarList),JSON.stringify({data,totals,rateLibrary:snapshot.rateLibrary,revisionNumber:revision.revision_number}),actor.userId,t),
  ...([['100','Labour','labour',b.labour],['200','Plant','plant',b.plant],['300','Materials','material',b.material],['400','Subcontract','subcontract',b.subcontract],['500','Other direct costs','other',b.other],['900','Indirects & contingency','other',b.indirect+b.contingency]] as const).map(([code,description,category,amount])=>
   database.prepare('INSERT INTO project_cost_codes (id,organisation_id,project_id,code,description,category,budget_amount,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org,jobId,code,description,category,amount,'active',1,actor.userId,t,t)),
  ...DEFAULT_READINESS.map(([category,title])=>database.prepare("INSERT INTO project_checklist_items (id,organisation_id,project_id,phase,category,title,mandatory,status,source,revision,created_by,created_at,updated_at) VALUES (?,?,?,'readiness',?,?,1,'open','system',1,?,?,?) ON DUPLICATE KEY UPDATE id=id").bind(crypto.randomUUID(),org,jobId,category,title,actor.userId,t,t)),
  ...packStatements(database,org,jobId,t),
  database.prepare("UPDATE estimates SET status='Awarded',metadata=?,updated_at=? WHERE organisation_id=? AND id=?").bind(JSON.stringify({...est.meta,status:'Awarded',jobId,approvedRevisionId:revision.id,approvedBudget:totals,approvedSnapshot:data,awardedAt:t}),t,org,estimateId),
  database.prepare('INSERT INTO quote_revisions (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),org,`${est.name} · Awarded rev ${revision.revision_number}`,'Awarded',JSON.stringify({estimateId,revisionNumber:Number(est.meta.revisionNumber||1),estimateRevisionId:revision.id,data,totals,reason:'Awarded — approved budget baseline',approvedBudget:totals,createdAt:t}),t),
  ...tenderWrites(jobId),
  awardAudit('project.created','project',jobId,`${projectNumber} ${name} created from estimate revision ${revision.revision_number}`,{estimateId,estimateRevisionId:revision.id,tenderId:tender?.id??null},jobId),
  awardAudit('baseline.created','project_baseline',baselineId,`Original baseline: contract ${Number(revision.sell_price).toFixed(2)}, budget ${b.total.toFixed(2)}`,{contractValue:Number(revision.sell_price),budget:b},jobId),
 ];
 if(tender){
  const reqs=(await database.prepare("SELECT id,title,category,mandatory,status,source_document,source_page,linked_document_id FROM tender_requirements WHERE organisation_id=? AND opportunity_id=? AND status NOT IN ('suggested','rejected')").bind(org,tender.opportunity_id).all<Record<string,unknown>>()).results;
  const seen=new Set<string>();
  for(const r of reqs){
   writes.push(database.prepare('INSERT INTO job_ims_items (id,organisation_id,job_id,title,document_type,mandatory,status,source_requirement_id,linked_document_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id').bind(crypto.randomUUID(),org,jobId,String(r.title).slice(0,180),'Tender requirement',Number(r.mandatory),'Missing',String(r.id),r.linked_document_id||null,JSON.stringify({sourceDocument:r.source_document,sourcePage:r.source_page}),t,t));
   if(!CLIENT_REQUIREMENT_CATEGORIES.includes(String(r.category)))continue;
   const title=`Client requirement: ${String(r.title)}`.slice(0,250);if(seen.has(title))continue;seen.add(title);
   writes.push(database.prepare("INSERT INTO project_checklist_items (id,organisation_id,project_id,phase,category,title,mandatory,status,source,source_ref,revision,created_by,created_at,updated_at) VALUES (?,?,?,'readiness','client requirements',?,?,'open','tender_requirement',?,1,?,?,?) ON DUPLICATE KEY UPDATE id=id").bind(crypto.randomUUID(),org,jobId,title,Number(r.mandatory)?1:0,String(r.id),actor.userId,t,t));
  }
 }else writes.push(awardAudit('estimate.awarded','estimate',estimateId,`Estimate awarded from revision ${revision.revision_number}`,{jobId,estimateRevisionId:revision.id},jobId));
 await database.batch(writes);
 return {projectCreated:true,jobId,projectNumber,baselineId,estimateId,estimateRevisionId:revision.id,tenderId:tender?.id??null,name,contractValue:Number(revision.sell_price),approvedBudget:totals};
}
