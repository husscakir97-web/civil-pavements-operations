// Estimate approval: draft → review → approved → superseded.
// A review freezes an immutable revision snapshot (data, totals and the rate
// library in force). Approval never mutates the snapshot; later edits create a
// new draft that must be reviewed and approved again.
// Uses the Database compat layer so the legacy SQLite regression suites exercise it.
import {database} from '@/lib/platform/database';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {HttpError} from '@/lib/platform/http';
import {calculateEstimate,normaliseEstimateData,validateEstimate,costBreakdown,DEFAULT_RATE_LIBRARY,type EstimateData,type EstimateTotals} from '@/lib/estimate-calculations';
import {safeJson} from '@/lib/estimates-db';

export type RevisionRow={id:string;estimate_id:string;revision_number:number;status:string;snapshot:string;totals:string;sell_price:number;direct_cost:number;indirect_cost:number;contingency:number;gross_profit:number;gross_margin_pct:number;labour_cost:number;plant_cost:number;material_cost:number;subcontract_cost:number;other_cost:number;assumptions:string|null;exclusions:string|null;submitted_by:string|null;submitted_at:string|null;approved_by:string|null;approved_at:string|null;decision_notes:string|null;created_at:string};
const actor=()=>actorContext.getStore()!;
const now=()=>new Date().toISOString();
const auditStmt=(event:string,entityId:string,summary:string,before:unknown,after:unknown)=>{const a=actor();return database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),a.organisationId,a.userId,a.email,event,'estimate',entityId,summary.slice(0,500),before===undefined?null:JSON.stringify(before),after===undefined?null:JSON.stringify(after),now());};

export async function loadEstimate(estimateId:string){
 const row=await database.prepare('SELECT id,name,status,metadata,workflow_state,approved_revision_id,tender_id FROM estimates WHERE organisation_id=? AND id=?').bind(actor().organisationId,estimateId).first<{id:string;name:string;status:string;metadata:string;workflow_state:string|null;approved_revision_id:string|null;tender_id:string|null}>();
 if(!row)throw new HttpError(404,'Estimate not found.');
 return {...row,meta:safeJson<Record<string,unknown>>(row.metadata,{}),state:row.workflow_state||'draft'};
}
export async function revisions(estimateId:string){
 return (await database.prepare('SELECT * FROM estimate_revisions WHERE organisation_id=? AND estimate_id=? ORDER BY revision_number DESC').bind(actor().organisationId,estimateId).all<RevisionRow>()).results;
}
export async function approvedRevision(estimateId:string){
 return database.prepare("SELECT * FROM estimate_revisions WHERE organisation_id=? AND estimate_id=? AND status='approved' ORDER BY revision_number DESC LIMIT 1").bind(actor().organisationId,estimateId).first<RevisionRow>();
}
export function revisionSummary(r:RevisionRow|null,includeMoney:boolean){
 if(!r)return null;
 const base={id:r.id,revisionNumber:Number(r.revision_number),status:r.status,submittedAt:r.submitted_at,approvedAt:r.approved_at,approvedBy:r.approved_by,decisionNotes:r.decision_notes,assumptions:r.assumptions,exclusions:r.exclusions};
 return includeMoney?{...base,sellPrice:Number(r.sell_price),directCost:Number(r.direct_cost),indirectCost:Number(r.indirect_cost),contingency:Number(r.contingency),grossProfit:Number(r.gross_profit),grossMarginPct:Number(r.gross_margin_pct),breakdown:{labour:Number(r.labour_cost),plant:Number(r.plant_cost),material:Number(r.material_cost),subcontract:Number(r.subcontract_cost),other:Number(r.other_cost)}}:base;
}

export async function submitForReview(estimateId:string){
 const a=actor();if(!can(a.role,'estimate.edit'))throw new HttpError(403,'You are not authorised to submit estimates.');
 const est=await loadEstimate(estimateId);
 if(est.state==='review')throw new HttpError(409,'This estimate is already in review.');
 const data:EstimateData=normaliseEstimateData(est.meta.data??{},DEFAULT_RATE_LIBRARY);
 const totals:EstimateTotals=calculateEstimate(data);
 const validation=validateEstimate(data,totals);
 if(validation.errors.length)throw new HttpError(422,'Resolve validation errors before submitting for review.',{validation});
 const library=(await database.prepare('SELECT metadata FROM rate_libraries WHERE organisation_id=? ORDER BY created_at ASC LIMIT 1').bind(a.organisationId).first<{metadata:string}>())?.metadata??null;
 const last=await database.prepare('SELECT MAX(revision_number) AS n FROM estimate_revisions WHERE organisation_id=? AND estimate_id=?').bind(a.organisationId,estimateId).first<{n:number|null}>();
 const n=Number(last?.n||0)+1,b=costBreakdown(totals),id=crypto.randomUUID(),t=now();
 await database.batch([
  database.prepare('INSERT INTO estimate_revisions (id,organisation_id,estimate_id,revision_number,status,snapshot,totals,direct_cost,indirect_cost,contingency,gross_profit,sell_price,gross_margin_pct,labour_cost,plant_cost,material_cost,subcontract_cost,other_cost,assumptions,exclusions,submitted_by,submitted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,a.organisationId,estimateId,n,'review',JSON.stringify({data,rateLibrary:library?JSON.parse(library):null}),JSON.stringify(totals),totals.directCost,totals.overheadCost,totals.contingencyCost,totals.grossProfit,totals.sellRate,totals.grossMargin,b.labour,b.plant,b.material,b.subcontract,b.other,data.assumptions,data.exclusions,a.userId,t,t,t),
  database.prepare("UPDATE estimates SET workflow_state='review',updated_at=? WHERE organisation_id=? AND id=? AND (workflow_state IS NULL OR workflow_state<>'review')").bind(t,a.organisationId,estimateId),
  auditStmt('estimate.submitted_for_review',estimateId,`Revision ${n} submitted for review (sell ${totals.sellRate.toFixed(2)})`,{state:est.state},{revisionId:id,revisionNumber:n,sellPrice:totals.sellRate}),
 ]);
 return {revisionId:id,revisionNumber:n,state:'review'};
}

export async function decide(estimateId:string,decision:'approve'|'reject',notes:string){
 const a=actor();if(!can(a.role,'estimate.approve'))throw new HttpError(403,'You are not authorised to approve estimates.');
 const est=await loadEstimate(estimateId);
 const pending=await database.prepare("SELECT * FROM estimate_revisions WHERE organisation_id=? AND estimate_id=? AND status='review' ORDER BY revision_number DESC LIMIT 1").bind(a.organisationId,estimateId).first<RevisionRow>();
 if(!pending||est.state!=='review')throw new HttpError(409,'There is no revision awaiting review.');
 const t=now();
 if(decision==='reject'){
  if(!notes.trim())throw new HttpError(422,'Explain what needs to change.');
  await database.batch([
   database.prepare("UPDATE estimate_revisions SET status='rejected',decision_notes=?,updated_at=? WHERE organisation_id=? AND id=? AND status='review'").bind(notes,t,a.organisationId,pending.id),
   database.prepare("UPDATE estimates SET workflow_state='draft',updated_at=? WHERE organisation_id=? AND id=?").bind(t,a.organisationId,estimateId),
   auditStmt('estimate.returned',estimateId,`Revision ${pending.revision_number} returned: ${notes}`,{state:'review'},{state:'draft'}),
  ]);
  return {state:'draft',revisionId:pending.id};
 }
 const results=await database.batch([
  database.prepare("UPDATE estimate_revisions SET status='superseded',superseded_at=?,updated_at=? WHERE organisation_id=? AND estimate_id=? AND status='approved'").bind(t,t,a.organisationId,estimateId),
  database.prepare("UPDATE estimate_revisions SET status='approved',approved_by=?,approved_at=?,decision_notes=?,updated_at=? WHERE organisation_id=? AND id=? AND status='review'").bind(a.userId,t,notes||null,t,a.organisationId,pending.id),
  database.prepare("UPDATE estimates SET workflow_state='approved',approved_revision_id=?,updated_at=? WHERE organisation_id=? AND id=?").bind(pending.id,t,a.organisationId,estimateId),
  auditStmt('estimate.approved',estimateId,`Revision ${pending.revision_number} approved (sell ${Number(pending.sell_price).toFixed(2)})`,{state:'review',approvedRevisionId:est.approved_revision_id},{state:'approved',approvedRevisionId:pending.id,totals:{sellPrice:pending.sell_price,directCost:pending.direct_cost}}),
 ]);
 if(!results[1].meta.changes)throw new HttpError(409,'This revision was decided by another request.');
 return {state:'approved',revisionId:pending.id};
}

/** Called by the legacy estimate editor: edits after approval start a new draft; edits in review are refused. */
export async function assertEditable(estimateId:string){
 const est=await loadEstimate(estimateId);
 if(est.state==='review')throw new HttpError(409,'This estimate is in review. Approve or return it before editing.');
 return est.state;
}
