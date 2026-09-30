// HSEQ investigation and corrective-action chain.
//   Source (incident / NCR; form submission for actions) → investigation → finding/cause
//   → corrective actions (hseq_actions) → completion → independent verification → source closure.
// Existing records stay authoritative: hseq_incidents, hseq_ncrs and hseq_actions are extended, not
// replaced. Every operation re-resolves the source record: its organisation, its project (never a
// client-supplied project id) and the actor's project scope. Out of scope → 404.
import {actorContext} from '@/lib/platform/context';
import {audit} from '@/lib/platform/audit';
import {can} from '@/lib/platform/permissions';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,uuid,nowIso,type Conn,type Row} from '@/lib/platform/sql';
import {canAccessProject} from '@/lib/platform/project-access';
import {resolveContext} from '@/lib/platform/forms';
import type {FormContext} from '@/lib/v1/forms';

const actor=()=>actorContext.getStore()!;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const text=(v:unknown,n=5000)=>typeof v==='string'?v.trim().slice(0,n):'';
const need=(cap:Parameters<typeof can>[1],message:string)=>{if(!can(actor().role,cap))fail(403,message);};

/** Sources an action may link to. Investigations support incident and NCR today. */
export const ACTION_SOURCES=['incident','ncr','form_submission','risk'] as const;
export const INVESTIGATION_SOURCES=['incident','ncr'] as const;
export type ActionSource=typeof ACTION_SOURCES[number];
export type Source={type:ActionSource;id:string;projectId:string|null;title:string;status:string|null;row:Row};
const isActionSource=(v:string):v is ActionSource=>(ACTION_SOURCES as readonly string[]).includes(v);

/** Loads the real source record inside the organisation and checks scope. Never trusts a supplied project. */
export async function resolveSource(type:string,id:string,conn?:Conn):Promise<Source>{
 const a=actor(),org=a.organisationId,notFound=()=>fail(404,'Source record not found.');
 if(!isActionSource(type)||!id)notFound();
 if(type==='form_submission'){
  if(!can(a.role,'forms.view')||!can(a.role,'hseq.view'))notFound();
  const s=await one("SELECT s.id,s.context_type,s.context_id,s.project_id,t.name FROM form_submissions s JOIN form_templates t ON t.organisation_id=s.organisation_id AND t.id=s.template_id WHERE s.organisation_id=? AND s.id=?",[org,id],conn);
  if(!s)notFound();
  await resolveContext(s!.context_type as FormContext,String(s!.context_id),conn);
  return {type,id,projectId:s!.project_id??null,title:`Form: ${s!.name}`,status:'submitted',row:s!};
 }
 if(!can(a.role,'hseq.view'))notFound();
 const table=type==='incident'?'hseq_incidents':type==='ncr'?'hseq_ncrs':'risks';
 const r=await one(`SELECT * FROM ${table} WHERE organisation_id=? AND id=?`,[org,id],conn);
 if(!r||!await canAccessProject(r.project_id,undefined,conn))notFound();
 const title=type==='incident'?[r!.reference,String(r!.description||'').slice(0,120)].filter(Boolean).join(' · '):type==='ncr'?[r!.reference,String(r!.issue||'').slice(0,120)].filter(Boolean).join(' · '):String(r!.title||r!.hazard||'Risk');
 return {type:type as ActionSource,id,projectId:r!.project_id??null,title,status:r!.status??null,row:r!};
}

/**
 * Validates an action's source link (used by the actions register and the chain service). Sources that
 * are records must exist, be in scope, and fix the action's project; unlinked kinds carry no source id.
 */
export async function linkActionSource(values:Row,existing:Row|null,parentProjectId:string|null,conn:Conn){
 const type=String(values.source_type??existing?.source_type??'other');
 const id=(values.source_id!==undefined?values.source_id:existing?.source_id)??null;
 if(isActionSource(type)){
  if(!id)fail(400,'Choose the record this action comes from.');
  const src=await resolveSource(type,String(id),conn);
  // Incident Alpha can never carry an action tagged to Project Bravo.
  if(parentProjectId&&src.projectId!==parentProjectId)fail(400,'The action must belong to the same project as its source record.');
  if(existing&&(existing.project_id??null)!==src.projectId)fail(400,'The action must belong to the same project as its source record.');
  return src.projectId;
 }
 if(id)fail(400,'Only incident, NCR, form submission or risk sources carry a record reference.');
 return undefined;
}

// ---------------------------------------------------------------- investigations
const presentInvestigation=(r:Row|null)=>r?{id:r.id,sourceType:r.source_type,sourceId:r.source_id,projectId:r.project_id??null,status:r.status,summary:r.summary??null,facts:r.facts??null,finding:r.finding??null,rootCause:r.root_cause??null,rootCauseNotEstablished:Boolean(Number(r.root_cause_not_established)),contributingFactors:r.contributing_factors??null,method:r.method??null,investigatorUserId:r.investigator_user_id??null,completedBy:r.completed_by??null,completedAt:r.completed_at??null,revision:Number(r.revision),updatedAt:r.updated_at}:null;
const INV_FIELDS={summary:'summary',facts:'facts',finding:'finding',rootCause:'root_cause',contributingFactors:'contributing_factors',method:'method'} as const;

async function assertUser(userId:unknown,conn:Conn,label:string){
 if(userId==null||userId==='')return null;
 const u=await one('SELECT id,name FROM users WHERE organisation_id=? AND id=?',[actor().organisationId,String(userId)],conn);
 if(!u)fail(400,`${label}: choose a member of your organisation.`);
 return u!;
}
async function loadInvestigation(id:string,conn:Conn,lock=false){
 const r=await one(`SELECT * FROM hseq_investigations WHERE organisation_id=? AND id=?${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!r)fail(404,'Investigation not found.');
 const src=await resolveSource(String(r!.source_type),String(r!.source_id),conn);
 return {inv:r!,src};
}

export async function startInvestigation(sourceType:string,sourceId:string,input:Row){
 const a=actor();need('hseq.edit','You are not authorised to investigate HSEQ records.');
 if(!(INVESTIGATION_SOURCES as readonly string[]).includes(sourceType))fail(400,'Investigations are available for incidents and NCRs.');
 return tx(async conn=>{
  const src=await resolveSource(sourceType,sourceId,conn);
  if(src.status==='closed')fail(409,'Reopen the record before investigating it.');
  const existing=await one('SELECT id FROM hseq_investigations WHERE organisation_id=? AND source_type=? AND source_id=?',[a.organisationId,src.type,src.id],conn);
  if(existing)fail(409,'An investigation already exists for this record.');
  const investigator=await assertUser(input.investigatorUserId??a.userId,conn,'Investigator');
  const id=uuid(),now=nowIso();
  await exec("INSERT INTO hseq_investigations (id,organisation_id,project_id,source_type,source_id,status,summary,facts,method,investigator_user_id,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'investigating',?,?,?,?,1,?,?,?)",
   [id,a.organisationId,src.projectId,src.type,src.id,text(input.summary)||null,text(input.facts)||null,text(input.method,80)||null,investigator?.id??a.userId,a.userId,now,now],conn);
  if(src.type==='incident'&&src.status==='reported')await exec("UPDATE hseq_incidents SET status='investigating',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,src.id],conn);
  await audit({event:'hseq_investigation.started',entityType:'hseq_investigation',entityId:id,projectId:src.projectId,summary:`Investigation started: ${src.title}`.slice(0,500),after:{sourceType:src.type,sourceId:src.id,investigatorUserId:investigator?.id??a.userId}},conn);
  return {id};
 });
}

export async function updateInvestigation(id:string,revision:unknown,input:Row){
 const a=actor();need('hseq.edit','You are not authorised to investigate HSEQ records.');
 return tx(async conn=>{
  const {inv,src}=await loadInvestigation(id,conn,true);
  if(inv.status!=='investigating')fail(409,'This investigation is complete. Reopen it with a reason to change it.');
  if(revision!=null&&Number(revision)!==Number(inv.revision))fail(409,'This investigation was changed by someone else. Refresh to see the latest version.');
  const set:Row={};
  for(const [k,col] of Object.entries(INV_FIELDS))if(k in input)set[col]=text(input[k],k==='method'?80:5000)||null;
  if('rootCauseNotEstablished' in input)set.root_cause_not_established=input.rootCauseNotEstablished?1:0;
  if('investigatorUserId' in input)set.investigator_user_id=(await assertUser(input.investigatorUserId,conn,'Investigator'))?.id??inv.investigator_user_id;
  if(!Object.keys(set).length)return {id,revision:Number(inv.revision)};
  const cols=Object.keys(set),now=nowIso();
  await exec(`UPDATE hseq_investigations SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),now,a.organisationId,id],conn);
  await audit({event:'hseq_investigation.updated',entityType:'hseq_investigation',entityId:id,projectId:src.projectId,summary:`Investigation updated: ${src.title}`.slice(0,500),before:Object.fromEntries(cols.map(c=>[c,inv[c]??null])),after:set},conn);
  return {id,revision:Number(inv.revision)+1};
 });
}

/** Completion requires the facts/summary, a finding, and a root cause or an explicit "not established" conclusion. */
export function investigationGaps(inv:{summary?:unknown;facts?:unknown;finding?:unknown;root_cause?:unknown;root_cause_not_established?:unknown}){
 const gaps:string[]=[];
 if(!text(inv.summary)&&!text(inv.facts))gaps.push('Record the investigation summary or facts.');
 if(!text(inv.finding))gaps.push('Record the finding.');
 if(!text(inv.root_cause)&&!Number(inv.root_cause_not_established))gaps.push('Record the root cause, or record that it could not be established.');
 return gaps;
}
export async function completeInvestigation(id:string,revision:unknown){
 const a=actor();need('hseq.edit','You are not authorised to investigate HSEQ records.');
 return tx(async conn=>{
  const {inv,src}=await loadInvestigation(id,conn,true);
  if(inv.status!=='investigating')fail(409,'This investigation is already complete.');
  if(revision!=null&&Number(revision)!==Number(inv.revision))fail(409,'This investigation was changed by someone else. Refresh to see the latest version.');
  const gaps=investigationGaps(inv);if(gaps.length)fail(422,gaps.join(' '),{gaps});
  const now=nowIso();
  await exec("UPDATE hseq_investigations SET status='complete',completed_by=?,completed_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[a.userId,now,now,a.organisationId,id],conn);
  // Legacy NCR cause stays a readable summary; the investigation is authoritative.
  if(src.type==='ncr'&&!text(src.row.cause)&&text(inv.root_cause))await exec('UPDATE hseq_ncrs SET cause=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[text(inv.root_cause),now,a.organisationId,src.id],conn);
  await audit({event:'hseq_investigation.completed',entityType:'hseq_investigation',entityId:id,projectId:src.projectId,summary:`Investigation completed: ${src.title}`.slice(0,500),after:{finding:inv.finding,rootCause:inv.root_cause??null,rootCauseNotEstablished:Boolean(Number(inv.root_cause_not_established))}},conn);
  return {id};
 });
}
export async function reopenInvestigation(id:string,reason:unknown){
 const a=actor();need('hseq.edit','You are not authorised to investigate HSEQ records.');
 const why=text(reason,1000);if(why.length<3)fail(400,'Give a reason for reopening the investigation.');
 return tx(async conn=>{
  const {inv,src}=await loadInvestigation(id,conn,true);
  if(inv.status!=='complete')fail(409,'This investigation is still open.');
  if(src.status==='closed')fail(409,'Reopen the source record first.');
  const now=nowIso();
  await exec("UPDATE hseq_investigations SET status='investigating',completed_by=NULL,completed_at=NULL,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,id],conn);
  await audit({event:'hseq_investigation.reopened',entityType:'hseq_investigation',entityId:id,projectId:src.projectId,summary:`Investigation reopened: ${why}`.slice(0,500),before:{status:'complete',completedBy:inv.completed_by,completedAt:inv.completed_at},after:{status:'investigating',reason:why}},conn);
  return {id};
 });
}

// ---------------------------------------------------------------- corrective actions
export const isOverdue=(a:{status?:unknown;due_date?:unknown},on=today())=>a.status!=='verified'&&Boolean(a.due_date)&&String(a.due_date)<on;

/** Creates an ordinary hseq_actions row linked to a verified source; project derived from the source. */
export async function createActionFromSource(sourceType:string,sourceId:string,input:Row){
 const a=actor();need('hseq.edit','You are not authorised to create corrective actions.');
 const action=text(input.actionText,5000);if(!action)fail(400,'Describe the corrective action.');
 const due=input.dueDate?String(input.dueDate):null;if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))fail(400,'Choose a valid due date.');
 return tx(async conn=>{
  const src=await resolveSource(sourceType,sourceId,conn);
  if(src.status==='closed')fail(409,'Reopen the record before adding actions.');
  const owner=await assertUser(input.ownerUserId,conn,'Owner');
  if(!owner)fail(400,'Choose the person who owns this action.');
  const id=uuid(),now=nowIso();
  await exec("INSERT INTO hseq_actions (id,organisation_id,project_id,source_type,source_id,action,owner_user_id,owner_name,due_date,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'open',1,?,?,?)",
   [id,a.organisationId,src.projectId,src.type,src.id,action,owner!.id,String(owner!.name).slice(0,160),due,a.userId,now,now],conn);
  if(src.type==='ncr'&&src.status==='open')await exec("UPDATE hseq_ncrs SET status='action',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,src.id],conn);
  await audit({event:'corrective_action.created',entityType:'actions',entityId:id,projectId:src.projectId,summary:`Corrective action for ${src.title}`.slice(0,500),after:{sourceType:src.type,sourceId:src.id,ownerUserId:owner!.id,dueDate:due,action}},conn);
  return {id};
 });
}

async function loadAction(id:string,conn:Conn){
 const r=await one('SELECT * FROM hseq_actions WHERE organisation_id=? AND id=? FOR UPDATE',[actor().organisationId,id],conn);
 if(!r||!can(actor().role,'hseq.view')||!await canAccessProject(r.project_id,undefined,conn))fail(404,'Corrective action not found.');
 if(isActionSource(String(r!.source_type))&&r!.source_id)await resolveSource(String(r!.source_type),String(r!.source_id),conn);
 return r!;
}

/**
 * Independent verification. Only hseq.verify holders, never the person who completed the action, and a
 * note is always recorded. Accept → verified. Reject → back to in progress. Each decision appends a
 * review row holding a snapshot of the completion it judged, so no completion evidence is lost.
 */
export async function reviewAction(id:string,input:{outcome?:unknown;note?:unknown;documentId?:unknown}){
 const a=actor();need('hseq.verify','You are not authorised to verify corrective actions.');
 const outcome=input.outcome==='accepted'||input.outcome==='rejected'?input.outcome:null;if(!outcome)fail(400,'Choose accept or reject.');
 const note=text(input.note,2000);if(note.length<3)fail(400,outcome==='accepted'?'Record the verification conclusion.':'Give the reason for rejecting the completion.');
 return tx(async conn=>{
  const r=await loadAction(id,conn);
  if(r.status!=='complete')fail(409,'Only a completed action can be verified.');
  if(!r.completed_by)fail(409,'This action has no recorded completion to verify.');
  if(r.completed_by===a.userId)fail(403,'The person who completed an action cannot verify it. Ask another authorised person.');
  let documentId:string|null=null;
  if(input.documentId){const d=await one('SELECT id,project_id FROM documents WHERE organisation_id=? AND id=?',[a.organisationId,String(input.documentId)],conn);if(!d||(d.project_id&&d.project_id!==r.project_id))fail(400,'Verification evidence not found.');documentId=String(d!.id);}
  const now=nowIso(),reviewId=uuid();
  await exec('INSERT INTO hseq_action_reviews (id,organisation_id,action_id,outcome,note,document_id,reviewer_user_id,completed_by,completed_at,completion_notes,completion_document_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[reviewId,a.organisationId,id,outcome,note,documentId,a.userId,r.completed_by,r.completed_at,r.completion_notes??null,r.completion_document_id??null,now],conn);
  if(outcome==='accepted')await exec("UPDATE hseq_actions SET status='verified',verified_by=?,verified_at=?,verification_note=?,verification_document_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[a.userId,now,note,documentId,now,a.organisationId,id],conn);
  else await exec("UPDATE hseq_actions SET status='in_progress',verified_by=NULL,verified_at=NULL,verification_note=NULL,verification_document_id=NULL,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,id],conn);
  await audit({event:outcome==='accepted'?'corrective_action.verified':'corrective_action.rejected',entityType:'actions',entityId:id,projectId:r.project_id??null,summary:`${outcome==='accepted'?'Verified':'Rejected for rework'}: ${note}`.slice(0,500),before:{status:'complete',completedBy:r.completed_by,completedAt:r.completed_at},after:{status:outcome==='accepted'?'verified':'in_progress',reviewerUserId:a.userId,completedBy:r.completed_by,note,reviewId}},conn);
  return {id,status:outcome==='accepted'?'verified':'in_progress'};
 });
}

// ---------------------------------------------------------------- closure
async function chainState(src:Source,conn:Conn){
 const org=actor().organisationId;
 const inv=await one('SELECT * FROM hseq_investigations WHERE organisation_id=? AND source_type=? AND source_id=?',[org,src.type,src.id],conn);
 const actions=await query('SELECT * FROM hseq_actions WHERE organisation_id=? AND source_type=? AND source_id=? ORDER BY created_at',[org,src.type,src.id],conn);
 return {inv,actions};
}
/** Deterministic closure blockers for a source; the UI shows exactly these. */
export function closureBlockers(type:'incident'|'ncr',src:Row,inv:Row|null,actions:Row[],input:{rationale?:string;verification?:string}={}){
 const blockers:string[]=[];
 if(inv&&inv.status!=='complete')blockers.push('Complete the investigation.');
 const unverified=actions.filter(x=>x.status!=='verified');
 if(unverified.length)blockers.push(`${unverified.length} corrective action${unverified.length===1?' is':'s are'} not yet independently verified.`);
 if(type==='incident'){
  if(!inv&&!actions.length&&text(input.rationale).length<10)blockers.push('No investigation or corrective action is recorded: give a closure rationale (at least 10 characters).');
 }else{
  if(src.status!=='verification')blockers.push('Move the NCR to verification first.');
  if(!inv&&!text(src.cause))blockers.push('Record the cause (or complete an investigation).');
  if(!actions.length&&!text(src.corrective_action))blockers.push('Add a corrective action.');
  if(!text(input.verification)&&!text(src.verification))blockers.push('Record the final verification.');
 }
 return blockers;
}
export async function closeSource(type:string,id:string,input:{rationale?:unknown;verification?:unknown}){
 const a=actor();
 if(type!=='incident'&&type!=='ncr')fail(400,'Only incidents and NCRs close through the chain.');
 if(type==='incident')need('hseq.edit','You are not authorised to close incidents.');else need('hseq.verify','Only an authorised verifier can close an NCR.');
 const rationale=text(input.rationale,2000),verification=text(input.verification,5000);
 return tx(async conn=>{
  const src=await resolveSource(type,id,conn);
  const table=type==='incident'?'hseq_incidents':'hseq_ncrs';
  const row=await one(`SELECT * FROM ${table} WHERE organisation_id=? AND id=? FOR UPDATE`,[a.organisationId,id],conn);
  if(row!.status==='closed')fail(409,'This record is already closed.');
  const {inv,actions}=await chainState(src,conn);
  const blockers=closureBlockers(type,row!,inv,actions,{rationale,verification});
  if(blockers.length)fail(422,blockers.join(' '),{blockers});
  const now=nowIso();
  if(type==='incident')await exec("UPDATE hseq_incidents SET status='closed',closure_rationale=?,closed_by=?,closed_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[rationale||null,a.userId,now,now,a.organisationId,id],conn);
  else await exec("UPDATE hseq_ncrs SET status='closed',verification=?,closed_by=?,closed_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[verification||row!.verification,a.userId,now,now,a.organisationId,id],conn);
  await audit({event:`${type}.closed`,entityType:type==='incident'?'incidents':'ncrs',entityId:id,projectId:src.projectId,summary:`${type==='incident'?'Incident':'NCR'} closed: ${src.title}`.slice(0,500),before:{status:row!.status},after:{status:'closed',investigationId:inv?.id??null,actions:actions.map(x=>x.id),rationale:rationale||null,verification:type==='ncr'?(verification||row!.verification):undefined}},conn);
  return {id,status:'closed'};
 });
}

// ---------------------------------------------------------------- read model
export async function getChain(sourceType:string,sourceId:string){
 const a=actor();need('hseq.view','You are not authorised to view HSEQ records.');
 const src=await resolveSource(sourceType,sourceId);
 const org=a.organisationId;
 const inv=await one('SELECT * FROM hseq_investigations WHERE organisation_id=? AND source_type=? AND source_id=?',[org,src.type,src.id]);
 const actions=await query('SELECT * FROM hseq_actions WHERE organisation_id=? AND source_type=? AND source_id=? ORDER BY created_at',[org,src.type,src.id]);
 const reviews=actions.length?await query('SELECT * FROM hseq_action_reviews WHERE organisation_id=? AND action_id IN (?) ORDER BY created_at',[org,actions.map(x=>x.id)]):[];
 const userIds=[...new Set([inv?.investigator_user_id,inv?.completed_by,...actions.flatMap(x=>[x.owner_user_id,x.completed_by,x.verified_by]),...reviews.map(r=>r.reviewer_user_id),src.row.closed_by].filter(Boolean))] as string[];
 const names=Object.fromEntries((userIds.length?await query('SELECT id,name FROM users WHERE organisation_id=? AND id IN (?)',[org,userIds]):[]).map(u=>[u.id,String(u.name)]));
 const on=today();
 const closable=src.type==='incident'||src.type==='ncr';
 return {
  source:{type:src.type,id:src.id,title:src.title,status:src.status,projectId:src.projectId,closureRationale:src.row.closure_rationale??null,closedBy:src.row.closed_by??null,closedAt:src.row.closed_at??null,verification:src.row.verification??null,cause:src.row.cause??null},
  investigation:presentInvestigation(inv),
  investigationGaps:inv&&inv.status!=='complete'?investigationGaps(inv):[],
  actions:actions.map(x=>({id:x.id,action:x.action,ownerUserId:x.owner_user_id??null,ownerName:x.owner_name??null,dueDate:x.due_date??null,status:x.status,overdue:isOverdue(x,on),completionNotes:x.completion_notes??null,completionDocumentId:x.completion_document_id??null,completedBy:x.completed_by??null,completedAt:x.completed_at??null,verifiedBy:x.verified_by??null,verifiedAt:x.verified_at??null,verificationNote:x.verification_note??null,revision:Number(x.revision),
   reviews:reviews.filter(r=>r.action_id===x.id).map(r=>({id:r.id,outcome:r.outcome,note:r.note,reviewerUserId:r.reviewer_user_id,completedBy:r.completed_by,completedAt:r.completed_at,completionNotes:r.completion_notes,createdAt:r.created_at}))})),
  closure:closable&&src.status!=='closed'?{blockers:closureBlockers(src.type as 'incident'|'ncr',src.row,inv,actions)}:null,
  names,
  can:{investigate:can(a.role,'hseq.edit'),addAction:can(a.role,'hseq.edit'),verify:can(a.role,'hseq.verify'),close:src.type==='ncr'?can(a.role,'hseq.verify'):can(a.role,'hseq.edit'),userId:a.userId},
 };
}
