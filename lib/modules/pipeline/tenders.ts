// Tender workspace service. One authoritative tender per opportunity.
// Stage changes that carry business rules run through dedicated functions;
// assertTransition() refuses to let the generic path skip them.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {assertTransition,stateLabel} from '@/lib/platform/workflow';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,round2,type Row} from '@/lib/platform/sql';
import {safeJson} from '@/lib/estimates-db';
import {calculateEstimate,validateEstimate,makeGeneralEstimate,makeDefaultEstimate,DEFAULT_RATE_LIBRARY,type RateLibrary} from '@/lib/estimate-calculations';
import {legacyOpportunityStage} from '@/lib/v1/register-server';
import {awardEstimate} from '@/lib/seams/award-to-project';
import type {TenderField} from '@/lib/tender';

const actor=()=>actorContext.getStore()!;
const OPEN_REQ="status NOT IN ('complete','not_applicable','rejected','suggested')";

async function loadTender(id:string,conn?:PoolConnection,lock=false){
 const t=await one(`SELECT * FROM tenders WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!t)fail(404,'Tender not found.');
 return t!;
}

type Stats={documents:number;requirements:number;suggested:number;mandatoryOpen:number;returnables:number;returnablesMandatoryOpen:number;clarificationsOpen:number;nextClarificationDue:string|null;estimateState:string|null;approvedRevision:Row|null;bidDecision:string;bidReviewStarted:boolean};
async function stats(t:Row):Promise<Stats>{
 const org=actor().organisationId;
 const [docs,req,ret,clar,bid]=await Promise.all([
  one<{n:number}>("SELECT COUNT(*) AS n FROM attachments WHERE organisation_id=? AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.opportunityId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='tender'",[org,t.opportunity_id]),
  one<{total:number;suggested:number;mopen:number}>(`SELECT SUM(status NOT IN ('suggested','rejected')) AS total,SUM(status='suggested') AS suggested,SUM(mandatory=1 AND ${OPEN_REQ}) AS mopen FROM tender_requirements WHERE organisation_id=? AND tender_id=?`,[org,t.id]),
  one<{total:number;mopen:number}>("SELECT COUNT(*) AS total,SUM(mandatory=1 AND status NOT IN ('complete','not_applicable')) AS mopen FROM tender_returnables WHERE organisation_id=? AND tender_id=?",[org,t.id]),
  one<{open:number;due:string|null}>("SELECT SUM(status='open') AS open,MIN(CASE WHEN status='open' THEN due_date END) AS due FROM tender_clarifications WHERE organisation_id=? AND tender_id=?",[org,t.id]),
  one('SELECT decision FROM tender_bid_reviews WHERE organisation_id=? AND tender_id=?',[org,t.id]),
 ]);
 let estimateState:string|null=null,approvedRevision:Row|null=null;
 if(t.estimate_id){
  const e=await one('SELECT workflow_state FROM estimates WHERE organisation_id=? AND id=?',[org,t.estimate_id]);
  estimateState=e?(e.workflow_state||'draft'):null;
  approvedRevision=await one("SELECT id,revision_number,sell_price,gross_margin_pct,approved_at FROM estimate_revisions WHERE organisation_id=? AND estimate_id=? AND status='approved' ORDER BY revision_number DESC LIMIT 1",[org,t.estimate_id]);
 }
 return {documents:Number(docs?.n||0),requirements:Number(req?.total||0),suggested:Number(req?.suggested||0),mandatoryOpen:Number(req?.mopen||0),returnables:Number(ret?.total||0),returnablesMandatoryOpen:Number(ret?.mopen||0),clarificationsOpen:Number(clar?.open||0),nextClarificationDue:clar?.due??null,estimateState,approvedRevision,bidDecision:bid?.decision||'pending',bidReviewStarted:Boolean(bid)};
}

export function submissionChecks(t:Row,s:Stats){
 return [
  {key:'estimate',label:'Estimate revision approved',ok:Boolean(s.approvedRevision)&&s.estimateState!=='review',detail:!t.estimate_id?'No estimate linked.':!s.approvedRevision?'Submit and approve an estimate revision.':s.estimateState==='review'?'A newer revision is waiting for review.':null},
  {key:'requirements',label:'Mandatory requirements complete',ok:s.mandatoryOpen===0&&s.suggested===0,detail:s.mandatoryOpen?`${s.mandatoryOpen} mandatory requirement${s.mandatoryOpen===1?'':'s'} open.`:s.suggested?`${s.suggested} suggested requirement${s.suggested===1?'':'s'} not yet confirmed or rejected.`:null},
  {key:'returnables',label:'Mandatory returnables complete',ok:s.returnablesMandatoryOpen===0,detail:s.returnablesMandatoryOpen?`${s.returnablesMandatoryOpen} mandatory returnable${s.returnablesMandatoryOpen===1?'':'s'} incomplete.`:null},
  {key:'approval',label:'Internal tender approval',ok:t.approval_status==='approved',detail:t.approval_status==='approved'?null:t.approval_status==='requested'?'Awaiting approval decision.':'Request internal approval.'},
 ];
}

export function nextAction(t:Row,s:Stats):string|null{
 const n=(k:number,w:string)=>`${k} ${w}${k===1?'':'s'}`;
 switch(t.stage){
  case 'draft':return s.documents||s.requirements?'Start the bid / no-bid review':'Upload tender documents or record requirements';
  case 'reviewing':return s.bidReviewStarted?'Record the bid / no-bid decision':'Complete the bid / no-bid review';
  case 'pricing':
   if(s.suggested)return `Confirm or reject ${n(s.suggested,'suggested requirement')}`;
   if(!t.estimate_id)return 'Create the tender estimate';
   if(s.estimateState==='review')return 'Approve the estimate revision in review';
   if(!s.approvedRevision||s.estimateState==='draft'&&!s.approvedRevision)return 'Submit the estimate for review';
   if(s.mandatoryOpen)return `Complete ${n(s.mandatoryOpen,'mandatory requirement')}`;
   if(s.returnablesMandatoryOpen)return `Complete ${n(s.returnablesMandatoryOpen,'mandatory returnable')}`;
   return 'Request internal tender approval';
  case 'approval':{
   if(t.approval_status==='requested')return 'Internal approval decision required';
   const failing=submissionChecks(t,s).filter(c=>!c.ok);
   return failing.length?failing[0].detail:'Record the tender submission';
  }
  case 'submitted':case 'clarification':return s.clarificationsOpen?`Respond to ${n(s.clarificationsOpen,'open clarification')}`:'Record the award or loss';
  case 'awarded':return t.project_id?'Continue in the project workspace':null;
  default:return null;
 }
}
function completion(t:Row,s:Stats){
 const checks=[s.documents>0||s.requirements>0,s.bidDecision==='bid',Boolean(s.approvedRevision),s.requirements>0&&s.mandatoryOpen===0&&s.suggested===0,s.returnables>0&&s.returnablesMandatoryOpen===0,t.approval_status==='approved',Boolean(t.submitted_at)];
 return Math.round(checks.filter(Boolean).length/checks.length*100);
}

function present(t:Row,s:Stats,owner?:string|null){
 const money=can(actor().role,'commercial.view');
 const out:Row={id:t.id,opportunityId:t.opportunity_id,reference:t.reference,title:t.title,clientName:t.client_name,ownerUserId:t.owner_user_id,ownerName:owner??null,stage:t.stage,stageLabel:stateLabel('tender',t.stage),dueDate:t.due_date,location:t.location,scopeSummary:t.scope_summary,estimateId:t.estimate_id,approvalStatus:t.approval_status,approvedBy:t.approved_by,approvedAt:t.approved_at,approvalNotes:t.approval_notes,submittedAt:t.submitted_at,submissionMethod:t.submission_method,submissionVersion:t.submission_version,submissionNotes:t.submission_notes,submissionDocumentId:t.submission_document_id,submissionOverrideReason:t.submission_override_reason,outcomeAt:t.outcome_at,outcomeReason:t.outcome_reason,projectId:t.project_id,revision:t.revision,createdAt:t.created_at,updatedAt:t.updated_at,
  stats:{documents:s.documents,requirements:s.requirements,suggested:s.suggested,mandatoryOpen:s.mandatoryOpen,returnables:s.returnables,returnablesMandatoryOpen:s.returnablesMandatoryOpen,clarificationsOpen:s.clarificationsOpen,nextClarificationDue:s.nextClarificationDue,estimateState:s.estimateState,bidDecision:s.bidDecision,approvedRevisionNumber:s.approvedRevision?Number(s.approvedRevision.revision_number):null},
  completion:completion(t,s),nextAction:nextAction(t,s),checks:submissionChecks(t,s)};
 if(money){out.estimatedValue=t.estimated_value==null?null:Number(t.estimated_value);out.approvedSellPrice=s.approvedRevision?Number(s.approvedRevision.sell_price):null;out.approvedMarginPct=s.approvedRevision?Number(s.approvedRevision.gross_margin_pct):null;}
 return out;
}

export async function listTenders(){
 const rows=await query('SELECT t.*,u.name AS owner_name FROM tenders t LEFT JOIN users u ON u.id=t.owner_user_id AND u.organisation_id=t.organisation_id WHERE t.organisation_id=? ORDER BY (t.stage IN (\'awarded\',\'lost\')),t.due_date IS NULL,t.due_date,t.created_at DESC LIMIT 300',[actor().organisationId]);
 return Promise.all(rows.map(async t=>present(t,await stats(t),t.owner_name)));
}
export async function getTender(id:string){
 const t=await loadTender(id);
 const [s,owner,bid]=await Promise.all([stats(t),t.owner_user_id?one('SELECT name FROM users WHERE organisation_id=? AND id=?',[actor().organisationId,t.owner_user_id]):null,one('SELECT * FROM tender_bid_reviews WHERE organisation_id=? AND tender_id=?',[actor().organisationId,id])]);
 if(bid)delete bid.organisation_id;
 return {tender:present(t,s,owner?.name),bidReview:bid};
}

export type TenderInput={title?:string;clientName?:string|null;reference?:string|null;dueDate?:string|null;estimatedValue?:number|null;ownerUserId?:string|null;location?:string|null;scopeSummary?:string|null};
async function checkOwner(ownerUserId:string|null|undefined,conn:PoolConnection){if(ownerUserId&&!await one('SELECT id FROM users WHERE organisation_id=? AND id=?',[actor().organisationId,ownerUserId],conn))fail(400,'Choose an owner from your organisation.');}

/** Converting an opportunity preserves lineage (opportunity.tender_id ↔ tender.opportunity_id). A tender created directly gets its own opportunity record. */
export async function createTender(input:TenderInput&{opportunityId?:string|null}){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to create tenders.');
 return tx(async conn=>{
  await checkOwner(input.ownerUserId,conn);
  const now=nowIso(),id=uuid();
  let opportunityId=input.opportunityId||null,opp:Row|null=null;
  if(opportunityId){
   opp=await one('SELECT * FROM opportunities WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,opportunityId],conn);
   if(!opp)fail(404,'Opportunity not found.');
   if(opp!.tender_id)fail(409,'This opportunity has already been converted to a tender.');
   const stage=opp!.stage||legacyOpportunityStage(opp!.status);
   if(!['qualified','bidding'].includes(stage))fail(409,'Qualify the opportunity before converting it to a tender.');
   await exec("UPDATE opportunities SET stage='converted',status='converted',tender_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[id,now,a.organisationId,opportunityId],conn);
   await audit({event:'opportunity.converted',entityType:'opportunities',entityId:opportunityId!,summary:`Converted to tender`,before:{stage},after:{stage:'converted',tenderId:id}},conn);
  }else{
   if(!input.title?.trim())fail(400,'A tender title is required.');
   opportunityId=uuid();
   await exec("INSERT INTO opportunities (id,organisation_id,name,status,metadata,created_at,client_name,owner_user_id,estimated_value,closing_date,stage,location,tender_id,revision,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[opportunityId,a.organisationId,input.title!.trim(),'converted',JSON.stringify({client:input.clientName,estimatedValue:input.estimatedValue,tenderCloseDate:input.dueDate?.slice(0,10)}),now,input.clientName||null,input.ownerUserId||null,input.estimatedValue??null,input.dueDate?.slice(0,10)||null,'converted',input.location||null,id,1,a.userId,now],conn);
  }
  const meta=safeJson<Row>(opp?.metadata,{});
  const title=(input.title||opp?.name||'').trim()||'Untitled tender';
  const row={id,organisation_id:a.organisationId,opportunity_id:opportunityId,reference:input.reference||null,title,client_name:input.clientName??opp?.client_name??meta.client??null,owner_user_id:input.ownerUserId??opp?.owner_user_id??null,stage:'draft',due_date:input.dueDate??opp?.closing_date??meta.tenderCloseDate??null,estimated_value:input.estimatedValue??opp?.estimated_value??(Number(meta.estimatedValue)||null),location:input.location??opp?.location??null,scope_summary:input.scopeSummary??null,approval_status:'not_requested',revision:1,created_by:a.userId,created_at:now,updated_at:now};
  const cols=Object.keys(row);
  await exec(`INSERT INTO tenders (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,Object.values(row),conn);
  await audit({event:'tender.created',entityType:'tender',entityId:id,summary:`Tender created: ${title}`,after:{opportunityId,title}},conn);
  return {tenderId:id,opportunityId};
 });
}

export async function updateTender(id:string,revision:number,input:TenderInput){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to edit tenders.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(Number(t.revision)!==revision)fail(409,'This tender was changed by someone else. Refresh to see the latest version.');
  if(['awarded','lost'].includes(t.stage))fail(409,'This tender is closed and read-only.');
  await checkOwner(input.ownerUserId,conn);
  const map:Record<string,string>={title:'title',clientName:'client_name',reference:'reference',dueDate:'due_date',estimatedValue:'estimated_value',ownerUserId:'owner_user_id',location:'location',scopeSummary:'scope_summary'};
  const set:Row={};for(const [k,c] of Object.entries(map))if(k in input)set[c]=(input as Row)[k]??null;
  if('estimatedValue' in input&&!can(a.role,'commercial.view'))delete set.estimated_value;
  if(set.title==='')fail(400,'A tender title is required.');
  const cols=Object.keys(set);if(!cols.length)return getTender(id);
  await exec(`UPDATE tenders SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),nowIso(),a.organisationId,id],conn);
  await audit({event:'tender.updated',entityType:'tender',entityId:id,summary:'Tender details updated',before:Object.fromEntries(cols.map(c=>[c,t[c]])),after:set},conn);
 }).then(()=>getTender(id));
}

async function setStage(conn:PoolConnection,t:Row,to:string,extra:Row={},summary?:string,system=true){
 assertTransition('tender',t.stage,to,actor().role,{system});
 const now=nowIso(),set={stage:to,...extra},cols=Object.keys(set);
 await exec(`UPDATE tenders SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>(set as Row)[c]),now,actor().organisationId,t.id],conn);
 await audit({event:`tender.${to}`,entityType:'tender',entityId:t.id,summary:summary||`Tender: ${stateLabel('tender',t.stage)} → ${stateLabel('tender',to)}`,before:{stage:t.stage},after:set},conn);
}

export async function transitionTender(id:string,to:string){
 return tx(async conn=>{const t=await loadTender(id,conn,true);await setStage(conn,t,to,{},undefined,false);}).then(()=>getTender(id));
}

export type BidReviewInput=Partial<Record<'strategic_fit'|'capacity'|'capability'|'client_assessment'|'location_assessment'|'contract_risks'|'programme'|'resources'|'commercial_risks'|'hseq_risks'|'competition'|'recommendation_reason',string|null>>&{recommendation?:'bid'|'no_bid'|'conditional'|null};
export async function saveBidReview(id:string,input:BidReviewInput){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to edit the bid review.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(!['draft','reviewing'].includes(t.stage))fail(409,'The bid decision has been made. The review is now read-only.');
  const existing=await one('SELECT * FROM tender_bid_reviews WHERE organisation_id=? AND tender_id=? FOR UPDATE',[a.organisationId,id],conn);
  const now=nowIso(),cols=Object.keys(input);
  if(existing){if(cols.length)await exec(`UPDATE tender_bid_reviews SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND tender_id=?`,[...cols.map(c=>(input as Row)[c]??null),now,a.organisationId,id],conn);}
  else{const row:Row={id:uuid(),organisation_id:a.organisationId,tender_id:id,...input,decision:'pending',revision:1,created_by:a.userId,created_at:now,updated_at:now};const rc=Object.keys(row);await exec(`INSERT INTO tender_bid_reviews (${rc.join(',')}) VALUES (${rc.map(()=>'?').join(',')})`,rc.map(c=>row[c]??null),conn);}
  if(t.stage==='draft')await setStage(conn,t,'reviewing',{},'Bid review started',false);
  await audit({event:'tender.bid_review.saved',entityType:'tender',entityId:id,summary:'Bid review updated',after:input},conn);
 }).then(()=>getTender(id));
}

/** The bid decision is always a human, permissioned decision (never AI). */
export async function decideBid(id:string,decision:'bid'|'no_bid',reason:string){
 const a=actor();if(!can(a.role,'tender.approve'))fail(403,'Only an authorised approver can make the bid decision.');
 if(!reason.trim())fail(422,'Record the reason for the bid decision.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(t.stage!=='reviewing')fail(409,'Start the bid review before deciding.');
  const review=await one('SELECT recommendation FROM tender_bid_reviews WHERE organisation_id=? AND tender_id=? FOR UPDATE',[a.organisationId,id],conn);
  if(!review?.recommendation)fail(422,'Complete the bid review and its recommendation first.');
  const now=nowIso();
  await exec('UPDATE tender_bid_reviews SET decision=?,decided_by=?,decided_at=?,recommendation_reason=COALESCE(recommendation_reason,?),revision=revision+1,updated_at=? WHERE organisation_id=? AND tender_id=?',[decision,a.userId,now,reason,now,a.organisationId,id],conn);
  if(decision==='bid')await setStage(conn,t,'pricing',{},`Bid decision: BID — ${reason}`);
  else{await setStage(conn,t,'lost',{outcome_at:now,outcome_reason:`No bid: ${reason}`},`Bid decision: NO BID — ${reason}`);await exec("UPDATE opportunities SET stage='lost',status='lost',lost_reason=?,updated_at=? WHERE organisation_id=? AND id=?",[`No bid: ${reason}`,now,a.organisationId,t.opportunity_id],conn);}
 }).then(()=>getTender(id));
}

export async function createTenderEstimate(id:string,mode:'general'|'paving'){
 const a=actor();if(!can(a.role,'estimate.edit'))fail(403,'You are not authorised to create estimates.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(t.estimate_id)return {estimateId:t.estimate_id,existing:true};
  if(['awarded','lost'].includes(t.stage))fail(409,'This tender is closed.');
  const lib=await one('SELECT metadata FROM rate_libraries WHERE organisation_id=? ORDER BY created_at ASC LIMIT 1',[a.organisationId],conn);
  const library={...DEFAULT_RATE_LIBRARY,...safeJson<RateLibrary>(lib?.metadata,{} as RateLibrary)};
  const base=mode==='paving'?makeDefaultEstimate(library):makeGeneralEstimate(library);
  const data={...base,name:t.title,clientName:t.client_name||'',projectName:t.title,site:t.location||'',opportunityId:t.opportunity_id,opportunityName:t.title,specification:t.scope_summary||base.specification};
  const totals=calculateEstimate(data),validation=validateEstimate(data,totals),now=nowIso(),estimateId=uuid(),revisionId=uuid();
  await exec('INSERT INTO estimates (id,organisation_id,name,status,metadata,created_at,workflow_state,tender_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[estimateId,a.organisationId,t.title,'Draft',JSON.stringify({status:'Draft',revisionNumber:1,currentRevisionId:revisionId,data,totals,validation,sourceOpportunityId:t.opportunity_id,sourceTenderId:t.id,createdAt:now,updatedAt:now}),now,'draft',t.id,now],conn);
  await exec('INSERT INTO quote_revisions (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[revisionId,a.organisationId,`${t.title} · Rev 1`,'Draft',JSON.stringify({estimateId,revisionNumber:1,data,totals,validation,reason:'Created from tender'}),now],conn);
  await exec('UPDATE tenders SET estimate_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[estimateId,now,a.organisationId,id],conn);
  await audit({event:'tender.estimate.created',entityType:'tender',entityId:id,summary:`Estimate created (${mode})`,after:{estimateId}},conn);
  return {estimateId,existing:false};
 });
}

export async function requestApproval(id:string){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to request approval.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(!t.estimate_id)fail(422,'Create and approve the estimate before requesting tender approval.');
  await setStage(conn,t,'approval',{approval_status:'requested',approval_requested_by:a.userId,approval_requested_at:nowIso()},'Internal approval requested');
 }).then(()=>getTender(id));
}

export async function decideApproval(id:string,approve:boolean,notes:string){
 const a=actor();if(!can(a.role,'tender.approve'))fail(403,'Only an authorised approver can approve tenders.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(t.stage!=='approval'||t.approval_status!=='requested')fail(409,'There is no approval request awaiting a decision.');
  const now=nowIso();
  if(approve){
   await exec("UPDATE tenders SET approval_status='approved',approved_by=?,approved_at=?,approval_notes=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[a.userId,now,notes||null,now,a.organisationId,id],conn);
   await audit({event:'tender.approved',entityType:'tender',entityId:id,summary:`Tender approved for submission${notes?`: ${notes}`:''}`,before:{approvalStatus:'requested'},after:{approvalStatus:'approved'}},conn);
  }else{
   if(!notes.trim())fail(422,'Explain what must change before approval.');
   await setStage(conn,t,'pricing',{approval_status:'rejected',approval_notes:notes},`Tender approval declined: ${notes}`);
  }
 }).then(()=>getTender(id));
}

export type SubmissionInput={method:string;version?:string|null;notes?:string|null;documentId?:string|null;overrideReason?:string|null};
export async function submitTender(id:string,input:SubmissionInput){
 const a=actor();if(!can(a.role,'tender.submit'))fail(403,'You are not authorised to record submissions.');
 if(!input.method?.trim())fail(400,'Record how the tender was submitted.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);
  if(t.stage!=='approval')fail(409,'Request and obtain internal approval before recording the submission.');
  const s=await stats(t),failing=submissionChecks(t,s).filter(c=>!c.ok);
  if(input.documentId&&!await one('SELECT id FROM documents WHERE organisation_id=? AND id=?',[a.organisationId,input.documentId],conn))fail(400,'Submission evidence not found.');
  if(failing.length){
   if(!input.overrideReason?.trim())fail(422,'Submission checks are incomplete.',{checks:failing});
   if(!can(a.role,'tender.approve'))fail(403,'Only an authorised approver can override submission checks.');
   await audit({event:'tender.submission.override',entityType:'tender',entityId:id,summary:`Submission checks overridden: ${input.overrideReason}`,after:{failing:failing.map(f=>f.key),reason:input.overrideReason}},conn);
  }
  const now=nowIso();
  await setStage(conn,t,'submitted',{submitted_at:now,submitted_by:a.userId,submission_method:input.method.trim().slice(0,60),submission_version:input.version?.slice(0,40)||null,submission_notes:input.notes||null,submission_document_id:input.documentId||null,submission_override_reason:failing.length?input.overrideReason:null,approved_estimate_revision_id:s.approvedRevision?.id??null},`Tender submitted via ${input.method}`);
 }).then(()=>getTender(id));
}

export async function awardTender(id:string){
 const t=await loadTender(id);
 if(!t.estimate_id)fail(422,'This tender has no estimate to award.');
 if(t.project_id)return {alreadyAwarded:true,projectId:t.project_id};
 return awardEstimate(t.estimate_id,{tenderId:id});
}

export async function recordLoss(id:string,reason:string){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to record the outcome.');
 if(!reason.trim())fail(422,'Record why the tender was lost or withdrawn.');
 return tx(async conn=>{
  const t=await loadTender(id,conn,true);const now=nowIso();
  const system=['reviewing','submitted','clarification'].includes(t.stage);
  await setStage(conn,t,'lost',{outcome_at:now,outcome_reason:reason},`Tender lost / withdrawn: ${reason}`,system);
  await exec("UPDATE opportunities SET stage='lost',status='lost',lost_reason=?,updated_at=? WHERE organisation_id=? AND id=?",[reason,now,a.organisationId,t.opportunity_id],conn);
 }).then(()=>getTender(id));
}

const SUGGESTION_MAP:Record<string,string>={'Plant requirements':'plant','Labour requirements':'personnel','Testing and QA requirements':'HSEQ','Contract conditions':'contract','Clarifications required':'clarification','Risks':'contract','Exclusions':'commercial','Scope':'technical','Start date':'programme','Completion date':'programme','Closing date':'programme'};
/** Extraction (local or AI) may only create SUGGESTED requirements with source + confidence. Humans confirm. */
export async function suggestRequirements(id:string){
 const a=actor();if(!can(a.role,'pipeline.edit'))fail(403,'You are not authorised to update requirements.');
 const t=await loadTender(id);
 if(['awarded','lost'].includes(t.stage))fail(409,'This tender is closed.');
 const docs=await query("SELECT id,name,metadata FROM attachments WHERE organisation_id=? AND status='active' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.opportunityId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.kind'))='tender'",[a.organisationId,t.opportunity_id]);
 const existing=new Set((await query('SELECT title,source_page FROM tender_requirements WHERE organisation_id=? AND tender_id=?',[a.organisationId,id])).map(r=>`${r.title}|${r.source_page}`));
 let created=0;const now=nowIso();
 await tx(async conn=>{
  for(const d of docs){
   const fields=(safeJson<{fields?:TenderField[]}>(d.metadata,{}).fields||[]).filter(f=>f.status!=='Rejected'&&SUGGESTION_MAP[f.label]);
   for(const f of fields){
    const title=String(f.value).slice(0,2000),key=`${title}|${f.source}`;if(existing.has(key))continue;existing.add(key);
    await exec("INSERT INTO tender_requirements (id,organisation_id,opportunity_id,tender_id,title,requirement_type,category,source_document,source_page,status,mandatory,clarification,metadata,origin,confidence,risk_flag,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'suggested',?,?,?,?,?,?,1,?,?)",[uuid(),a.organisationId,t.opportunity_id,id,title,SUGGESTION_MAP[f.label],SUGGESTION_MAP[f.label],String(d.name).slice(0,500),String(f.source).slice(0,500),f.label==='Clarifications required'?0:1,'',JSON.stringify({extractedLabel:f.label,documentId:d.id,fieldId:f.id,extractedAt:now}),f.origin==='Inferred'?'ai':'extracted',round2(f.confidence),f.label==='Risks'?1:0,now,now],conn);
    created++;
   }
  }
  if(created)await audit({event:'tender.requirements.suggested',entityType:'tender',entityId:id,summary:`${created} suggested requirement${created===1?'':'s'} created from tender documents (awaiting human confirmation)`,after:{created}},conn);
 });
 return {created};
}

/** CSV export offered when the Projects module is not entitled at award (graceful degradation). */
export async function exportTender(id:string){
 const {tender}=await getTender(id);
 const reqs=await query('SELECT title,category,mandatory,status,response FROM tender_requirements WHERE organisation_id=? AND tender_id=? ORDER BY created_at',[actor().organisationId,id]);
 const esc=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;
 const lines=[['Field','Value'].map(esc).join(','),...Object.entries({Tender:tender.title,Reference:tender.reference,Client:tender.clientName,Stage:tender.stageLabel,Submitted:tender.submittedAt,Outcome:tender.outcomeReason,'Approved sell price':tender.approvedSellPrice}).map(([k,v])=>[k,v].map(esc).join(',')),'',['Requirement','Category','Mandatory','Status','Response'].map(esc).join(','),...reqs.map(r=>[r.title,r.category,r.mandatory?'Yes':'No',r.status,r.response].map(esc).join(','))];
 return new Response(lines.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="tender-${id}.csv"`,'Cache-Control':'private, no-store'}});
}
