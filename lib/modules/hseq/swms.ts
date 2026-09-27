// SWMS: draft → review → approved → issued → superseded.
// Every revision is a row; approved/issued revisions are never edited — a
// revision creates version N+1. Drafts are generated deterministically from the
// questionnaire (AI drafting is not activated). Only a permissioned human approves.
import {renderDocument,organisationBranding} from '@/lib/platform/pdf';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {assertTransition,stateLabel} from '@/lib/platform/workflow';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,type Row} from '@/lib/platform/sql';
import {safeJson} from '@/lib/estimates-db';
import {HIGH_RISK_WORK,type SwmsContent,type SwmsQuestionnaire} from '@/lib/v1/swms-content';

const actor=()=>actorContext.getStore()!;

export function generateDraft(q:SwmsQuestionnaire):SwmsContent{
 const selected=HIGH_RISK_WORK.filter(h=>q.highRiskWork?.includes(h.key));
 const steps=(q.workSteps||[]).map(s=>s.trim()).filter(Boolean).map(step=>({step,hazards:'',controls:'',responsible:q.responsiblePeople||'',residualRisk:''}));
 const hazardRows=selected.map(h=>({step:`All steps — ${h.label}`,hazards:h.hazards,controls:h.controls,responsible:q.responsiblePeople||'',residualRisk:'Medium'}));
 return {
  activity:q.activity,location:q.location||'',highRiskWork:selected.map(h=>h.label),
  workSteps:[...steps,...hazardRows],
  plant:q.plant||'',equipment:q.equipment||'',substances:q.substances||'',
  ppe:[...new Set([...(q.ppe||[]),...selected.flatMap(h=>h.ppe)])],
  competencies:[q.competencies,...selected.map(h=>h.competency)].filter(Boolean).join('\n'),
  licences:q.licences||'',permits:[q.permits,...selected.map(h=>h.permit).filter(Boolean)].filter(Boolean).join('\n'),
  emergency:q.emergency||'',responsiblePeople:q.responsiblePeople||'',
  review:'Review this SWMS when the work, site conditions or controls change, and after any incident.',
 };
}

export function approvalGaps(c:SwmsContent){
 const gaps:string[]=[];
 if(!c.activity?.trim())gaps.push('Describe the activity.');
 if(!c.workSteps?.length)gaps.push('List the work steps.');
 c.workSteps?.forEach((s,i)=>{if(!s.hazards?.trim())gaps.push(`Step ${i+1}: identify hazards.`);if(!s.controls?.trim())gaps.push(`Step ${i+1}: record controls.`);});
 if(!c.ppe?.length)gaps.push('Specify PPE.');
 if(!c.emergency?.trim())gaps.push('Record emergency arrangements.');
 if(!c.responsiblePeople?.trim())gaps.push('Name the responsible people.');
 return gaps;
}

async function loadSwms(id:string,conn?:Parameters<typeof one>[2],lock=false){
 const s=await one(`SELECT s.*,j.stage AS project_stage,j.status AS project_status,j.name AS project_name FROM swms s JOIN jobs j ON j.id=s.project_id AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND s.id=?${lock?' FOR UPDATE':''}`,[actor().organisationId,id],conn);
 if(!s)fail(404,'SWMS not found.');
 return s!;
}
const present=(s:Row)=>({id:s.id,projectId:s.project_id,projectName:s.project_name,reference:s.reference,title:s.title,activity:s.activity,status:s.status,statusLabel:stateLabel('swms',s.status),currentRevisionId:s.current_revision_id,currentRevisionNumber:Number(s.current_revision_number),issuedRevisionId:s.issued_revision_id,revision:Number(s.revision),updatedAt:s.updated_at});

export async function listSwms(projectId?:string|null){
 const a=actor(),where=['s.organisation_id=?'],values:unknown[]=[a.organisationId];
 if(projectId){where.push('s.project_id=?');values.push(projectId);}
 if(a.role==='field')where.push('s.issued_revision_id IS NOT NULL');
 const rows=await query(`SELECT s.*,j.name AS project_name,(SELECT COUNT(*) FROM swms_acknowledgements k WHERE k.organisation_id=s.organisation_id AND k.swms_revision_id=s.issued_revision_id) AS acknowledgements,(SELECT COUNT(*) FROM swms_acknowledgements k WHERE k.organisation_id=s.organisation_id AND k.swms_revision_id=s.issued_revision_id AND k.user_id=?) AS acknowledged_by_me FROM swms s JOIN jobs j ON j.id=s.project_id AND j.organisation_id=s.organisation_id WHERE ${where.join(' AND ')} ORDER BY s.updated_at DESC LIMIT 300`,[a.userId,...values]);
 return rows.map(r=>({...present(r),acknowledgements:Number(r.acknowledgements),acknowledgedByMe:Number(r.acknowledged_by_me)>0}));
}

export async function getSwms(id:string){
 const a=actor(),s=await loadSwms(id);
 const revisions=await query('SELECT id,revision_number,status,origin,change_reason,submitted_by,submitted_at,approved_by,approved_at,issued_by,issued_at,superseded_at,created_at,updated_at,content FROM swms_revisions WHERE organisation_id=? AND swms_id=? ORDER BY revision_number DESC',[a.organisationId,id]);
 if(a.role==='field'&&!s.issued_revision_id)fail(404,'SWMS not found.');
 const visible=a.role==='field'?revisions.filter(r=>r.id===s.issued_revision_id):revisions;
 const acks=s.issued_revision_id?await query('SELECT worker_name,user_id,acknowledged_at,shift_id FROM swms_acknowledgements WHERE organisation_id=? AND swms_revision_id=? ORDER BY acknowledged_at',[a.organisationId,s.issued_revision_id]):[];
 const currentRev=revisions.find(r=>r.id===s.current_revision_id);
 return {swms:present(s),gaps:currentRev&&['draft','review'].includes(currentRev.status)?approvalGaps(safeJson<SwmsContent>(currentRev.content,{} as SwmsContent)):[],revisions:visible.map(r=>({...r,content:safeJson<SwmsContent>(r.content,{} as SwmsContent)}) as Row&{content:SwmsContent}),acknowledgements:a.role==='field'?acks.filter(k=>k.user_id===a.userId):acks};
}

export async function createSwms(projectId:string,input:{title:string;questionnaire:SwmsQuestionnaire}){
 const a=actor();if(!can(a.role,'hseq.edit'))fail(403,'You are not authorised to create SWMS.');
 if(!input.title.trim()||!input.questionnaire.activity?.trim())fail(400,'A title and activity are required.');
 return tx(async conn=>{
  const p=await one('SELECT id,stage,status FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,projectId],conn);
  if(!p)fail(404,'Project not found.');
  if(p!.stage==='closed')fail(409,'This project is closed.');
  const n=await one<{n:number}>('SELECT COUNT(*) AS n FROM swms WHERE organisation_id=? AND project_id=?',[a.organisationId,projectId],conn);
  const id=uuid(),revisionId=uuid(),now=nowIso(),reference=`SWMS-${String(Number(n?.n||0)+1).padStart(3,'0')}`;
  const content=generateDraft(input.questionnaire);
  await exec('INSERT INTO swms (id,organisation_id,project_id,reference,title,activity,status,current_revision_id,current_revision_number,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,projectId,reference,input.title.trim(),input.questionnaire.activity.trim().slice(0,255),'draft',revisionId,1,1,a.userId,now,now],conn);
  await exec('INSERT INTO swms_revisions (id,organisation_id,swms_id,revision_number,status,content,origin,change_reason,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[revisionId,a.organisationId,id,1,'draft',JSON.stringify(content),'template','Initial draft from questionnaire',a.userId,now,now],conn);
  await audit({event:'swms.created',entityType:'swms',entityId:id,projectId,summary:`${reference} ${input.title} drafted from questionnaire`,after:{revisionId}},conn);
  return {swmsId:id,revisionId};
 });
}

export async function saveDraft(id:string,revisionId:string,content:SwmsContent,expectedUpdatedAt:string){
 const a=actor();if(!can(a.role,'hseq.edit'))fail(403,'You are not authorised to edit SWMS.');
 await tx(async conn=>{
  const s=await loadSwms(id,conn,true);
  if(s.project_stage==='closed')fail(409,'This project is closed.');
  const r=await one('SELECT id,status,updated_at FROM swms_revisions WHERE organisation_id=? AND swms_id=? AND id=? FOR UPDATE',[a.organisationId,id,revisionId],conn);
  if(!r)fail(404,'Revision not found.');
  if(r!.status!=='draft')fail(409,'Only a draft revision can be edited. Approved and issued SWMS are immutable — create a new revision.');
  if(r!.updated_at!==expectedUpdatedAt)fail(409,'This draft was changed by someone else. Refresh to see the latest version.');
  const now=nowIso();
  await exec('UPDATE swms_revisions SET content=?,updated_at=? WHERE organisation_id=? AND id=?',[JSON.stringify(content),now,a.organisationId,revisionId],conn);
  await exec('UPDATE swms SET activity=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[String(content.activity||s.activity).slice(0,255),now,a.organisationId,id],conn);
  await audit({event:'swms.draft.saved',entityType:'swms',entityId:id,projectId:s.project_id,summary:'SWMS draft updated'},conn);
 });
 return getSwms(id);
}

export async function transitionSwms(id:string,to:'review'|'approved'|'issued'|'draft',note?:string){
 const a=actor();
 await tx(async conn=>{
  const s=await loadSwms(id,conn,true);
  if(s.project_stage==='closed')fail(409,'This project is closed.');
  const r=await one('SELECT * FROM swms_revisions WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,s.current_revision_id],conn);
  if(!r)fail(404,'Current revision not found.');
  assertTransition('swms',r!.status,to,a.role);
  const now=nowIso(),content=safeJson<SwmsContent>(r!.content,{} as SwmsContent),set:Row={status:to};
  if(to==='review'){const gaps=approvalGaps(content);if(gaps.length)fail(422,'Complete the SWMS before review.',{gaps});set.submitted_by=a.userId;set.submitted_at=now;}
  if(to==='approved'){const gaps=approvalGaps(content);if(gaps.length)fail(422,'This SWMS is incomplete.',{gaps});set.approved_by=a.userId;set.approved_at=now;}
  if(to==='issued'){
   set.issued_by=a.userId;set.issued_at=now;
   if(s.issued_revision_id&&s.issued_revision_id!==r!.id)await exec("UPDATE swms_revisions SET status='superseded',superseded_at=?,updated_at=? WHERE organisation_id=? AND id=?",[now,now,a.organisationId,s.issued_revision_id],conn);
  }
  if(to==='draft'&&note)set.change_reason=`Returned: ${note}`.slice(0,500);
  const cols=Object.keys(set);
  await exec(`UPDATE swms_revisions SET ${cols.map(c=>`${c}=?`).join(',')},updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(c=>set[c]),now,a.organisationId,r!.id],conn);
  await exec(`UPDATE swms SET status=?,${to==='issued'?'issued_revision_id=?,':''}revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[to,...(to==='issued'?[r!.id]:[]),now,a.organisationId,id],conn);
  await audit({event:`swms.${to}`,entityType:'swms',entityId:id,projectId:s.project_id,summary:`SWMS rev ${r!.revision_number}: ${stateLabel('swms',r!.status)} → ${stateLabel('swms',to)}${note?` (${note})`:''}`,before:{status:r!.status},after:{status:to,revisionId:r!.id}},conn);
 });
 return getSwms(id);
}

/** Revising an approved/issued SWMS creates version N+1 as a draft; the issued version stays in force until the new one is issued. */
export async function reviseSwms(id:string,reason:string){
 const a=actor();if(!can(a.role,'hseq.edit'))fail(403,'You are not authorised to revise SWMS.');
 if(!reason.trim())fail(422,'Give the reason for the revision.');
 await tx(async conn=>{
  const s=await loadSwms(id,conn,true);
  const r=await one('SELECT * FROM swms_revisions WHERE organisation_id=? AND id=?',[a.organisationId,s.current_revision_id],conn);
  if(!r||!['approved','issued'].includes(r.status))fail(409,'Only an approved or issued SWMS can be revised. Edit the current draft instead.');
  const now=nowIso(),revisionId=uuid(),n=Number(r!.revision_number)+1;
  await exec('INSERT INTO swms_revisions (id,organisation_id,swms_id,revision_number,status,content,origin,change_reason,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[revisionId,a.organisationId,id,n,'draft',r!.content,'manual',reason.slice(0,500),a.userId,now,now],conn);
  if(r!.status==='approved')await exec("UPDATE swms_revisions SET status='superseded',superseded_at=?,updated_at=? WHERE organisation_id=? AND id=?",[now,now,a.organisationId,r!.id],conn);
  await exec("UPDATE swms SET status='draft',current_revision_id=?,current_revision_number=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[revisionId,n,now,a.organisationId,id],conn);
  await audit({event:'swms.revised',entityType:'swms',entityId:id,projectId:s.project_id,summary:`SWMS revision ${n} started: ${reason}`,after:{revisionId,revisionNumber:n}},conn);
 });
 return getSwms(id);
}

/**
 * A worker acknowledges the issued revision they read. When the acknowledgement was
 * captured offline (revisionId given) and a newer revision has since been issued, it is
 * refused (409 SWMS_SUPERSEDED): the worker must read and acknowledge the current one.
 */
export async function acknowledgeSwms(id:string,shiftId?:string|null,revisionId?:string|null){
 const a=actor();if(!can(a.role,'swms.acknowledge'))fail(403,'You are not authorised to acknowledge SWMS.');
 return tx(async conn=>{
  const s=await loadSwms(id,conn);
  if(!s.issued_revision_id)fail(409,'This SWMS has not been issued to site.');
  if(revisionId&&revisionId!==s.issued_revision_id)fail(409,'This SWMS was revised while you were offline. Read the current revision and acknowledge it again.',{code:'SWMS_SUPERSEDED',currentRevisionId:s.issued_revision_id});
  if(shiftId&&!await one('SELECT id FROM shifts WHERE organisation_id=? AND id=?',[a.organisationId,shiftId],conn))fail(404,'Shift not found.');
  const now=nowIso();
  const existing=await one('SELECT id FROM swms_acknowledgements WHERE organisation_id=? AND swms_revision_id=? AND user_id=?',[a.organisationId,s.issued_revision_id,a.userId],conn);
  if(existing)return {acknowledged:true,revisionId:s.issued_revision_id,alreadyAcknowledged:true};
  const inserted=await exec('INSERT INTO swms_acknowledgements (id,organisation_id,swms_id,swms_revision_id,user_id,worker_name,shift_id,acknowledged_at) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[uuid(),a.organisationId,id,s.issued_revision_id,a.userId,(a.name||a.email).slice(0,160),shiftId||null,now],conn);
  if(inserted)await audit({event:'swms.acknowledged',entityType:'swms',entityId:id,projectId:s.project_id,summary:`${a.name||a.email} acknowledged the issued SWMS`,after:{revisionId:s.issued_revision_id,shiftId}},conn);
  return {acknowledged:true,revisionId:s.issued_revision_id,alreadyAcknowledged:false};
 });
}

export async function swmsPdf(id:string,revisionId?:string|null){
 const {swms,revisions}=await getSwms(id);
 const r=revisions.find(x=>x.id===(revisionId||swms.issuedRevisionId||swms.currentRevisionId));if(!r)fail(404,'Revision not found.');
 const a=actor(),c=r!.content,brand=await organisationBranding(a.organisationId);
 const people=await query('SELECT id,name FROM users WHERE organisation_id=? AND id IN (?)',[a.organisationId,[r!.approved_by,r!.issued_by].filter(Boolean).concat('-')]);
 const who=(id:unknown)=>people.find(p=>p.id===id)?.name||null,day=(v:unknown)=>v?String(v).slice(0,10):null;
 const text=(v:unknown)=>Array.isArray(v)?v.join(', '):String(v??'');
 const bytes=await renderDocument({company:brand,title:`Safe Work Method Statement: ${swms.title}`,number:swms.reference,revision:r!.revision_number,status:stateLabel('swms',r!.status),
  approval:r!.approved_at?{label:'Approved by',by:who(r!.approved_by),at:day(r!.approved_at)}:{label:'Approval',by:'not approved',at:null},
  date:day(r!.issued_at)||day(r!.approved_at)||day(r!.updated_at)||new Date().toISOString().slice(0,10),
  control:'Controlled document: the approved revision is immutable; changes require a new revision. Printed copies are uncontrolled.',
  blocks:[
   {rows:[['Project',swms.projectName||'—'],['Activity',`${c.activity}${c.location?` - ${c.location}`:''}`],['High-risk work',text(c.highRiskWork)||'None identified'],['Issued',r!.issued_at?`${day(r!.issued_at)} by ${who(r!.issued_by)||'—'}`:'Not issued'],['Revision reason',text(r!.change_reason)||'Original issue']]},
   {heading:'Work steps, hazards and controls',table:{columns:['#','Step','Hazards','Controls','Responsible / residual'],widths:[20,110,135,165,85],rows:(c.workSteps||[]).map((s,i)=>[String(i+1),text(s.step),text(s.hazards),text(s.controls),`${text(s.responsible)||'-'} / ${text(s.residualRisk)||'-'}`])}},
   {heading:'Plant and equipment',text:[text(c.plant),text(c.equipment)].filter(Boolean).join('\n')},
   {heading:'Hazardous substances',text:text(c.substances)},
   {heading:'PPE',text:text(c.ppe)},
   {heading:'Competencies, licences and permits',text:[text(c.competencies),text(c.licences),text(c.permits)].filter(Boolean).join('\n')},
   {heading:'Emergency arrangements',text:text(c.emergency)},
  ]});
 return new Response(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${swms.reference}-rev${r!.revision_number}.pdf"`,'Cache-Control':'private, no-store'}});
}
