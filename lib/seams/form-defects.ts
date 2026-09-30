// Seam: prestart / inspection form → Workshop defect → (critical) safety hold → repair →
// independent verification → return to service. The Forms engine (IMS) and Workshop stay separate
// modules: this seam fires only when both are writable and the actor holds `workshop.defect.report`
// (a narrow authority: no repair, verification or Workshop administration). It never modifies the
// immutable form submission, and Form submission itself never depends on Workshop.
//
// Source linkage and idempotency are separate concerns:
//  - source linkage (submission + answer + exact amendment sequence) is a relationship; one answer may
//    legitimately produce several defects;
//  - idempotency is the platform client-request-id pattern (lib/platform/idempotency.ts): a retry of the
//    same command replays the first result, while a later deliberate defect carries a new request id.
import {actorContext} from '@/lib/platform/context';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one} from '@/lib/platform/sql';
import {requireSeam,requireModule,seamEnabled} from '@/lib/platform/entitlements';
import {idempotent} from '@/lib/platform/idempotency';
import {can} from '@/lib/platform/permissions';
import {resolveFormSubmissionForWorkflow} from '@/lib/platform/forms';
import {allFields} from '@/lib/v1/forms';
import {raiseSourcedDefect} from '@/lib/modules/workshop/workshop';

const actor=()=>actorContext.getStore()!;
const SEVERITIES=['minor','major','critical'] as const;
type Severity=typeof SEVERITIES[number];

export async function raiseFormDefect(submissionId:string,input:{assetId?:unknown;fieldId?:unknown;title?:unknown;severity?:unknown;note?:unknown;clientRequestId?:unknown}){
 const a=actor();
 if(!await requireSeam('form.defect'))fail(409,'Workshop is not available for new defects in your organisation. The form is saved; record the defect manually.');
 const title=typeof input.title==='string'?input.title.trim().slice(0,180):'';if(!title)fail(400,'Describe the defect.');
 const note=typeof input.note==='string'?input.note.trim().slice(0,5000):'';if(!note)fail(400,'Add the defect details.');
 const severity=SEVERITIES.includes(input.severity as Severity)?input.severity as Severity:null;if(!severity)fail(400,'Choose the defect severity.');
 const requestId=typeof input.clientRequestId==='string'?input.clientRequestId:'';
 if(!requestId)fail(400,'A request id is required so a retry cannot raise the defect twice.');
 const assetId=String(input.assetId||''),fieldId=String(input.fieldId||'');
 const {result,replay}=await idempotent('form.defect',requestId,async conn=>{
  // Re-resolved inside the transaction with the submission locked: the amendment sequence recorded is the effective one.
  const f=await resolveFormSubmissionForWorkflow(submissionId,{conn,lock:true});
  // Only plant the evidence is actually about — never an arbitrary asset id.
  if(!f.assetIds.includes(assetId))fail(400,'Choose plant recorded on this form.');
  if(!allFields(f.schema).some(x=>x.id===fieldId))fail(400,'Choose the answer that shows the defect.');
  const id=await raiseSourcedDefect(conn,{org:a.organisationId,actorId:a.userId,assetId,title,severity:severity!,note,source:{type:'form_submission',id:f.submissionId,field:fieldId,amendmentSequence:f.amendmentSequence,contextType:f.contextType,contextId:f.contextId,projectId:f.projectId}});
  await audit({event:'form_defect.raised',entityType:'form_submission',entityId:f.submissionId,projectId:f.projectId,summary:`${severity} defect raised: ${title}`.slice(0,500),after:{workOrderId:id,assetId,fieldId,severity,safetyHold:severity==='critical',amendmentSequence:f.amendmentSequence}},conn);
  return {id,safetyHold:severity==='critical',amendmentSequence:f.amendmentSequence};
 },r=>({type:'work_order',id:r.id}),{submissionId,assetId,fieldId,title,severity,note});
 return {...result,replay};
}

/** Defects raised from one submission, visible to anyone who may see the submission. */
export async function listFormDefects(submissionId:string){
 const a=actor();
 await requireModule('workshop');
 const f=await resolveFormSubmissionForWorkflow(submissionId);
 const rows=await query(`SELECT o.id,o.title,o.severity,o.status,o.source_field,o.source_amendment_sequence,o.asset_id,o.created_at,o.updated_at,p.name AS asset_name,p.plant_number,p.safety_hold
  FROM workshop_orders o LEFT JOIN plant p ON p.organisation_id=o.organisation_id AND p.id=o.asset_id
  WHERE o.organisation_id=? AND o.source_type='form_submission' AND o.source_id=? ORDER BY o.created_at`,[a.organisationId,f.submissionId]);
 const assets=f.assetIds.length?await query('SELECT id,name,plant_number,safety_hold FROM plant WHERE organisation_id=? AND id IN (?)',[a.organisationId,f.assetIds]):[];
 return {
  defects:rows.map(r=>({id:r.id,title:r.title,severity:r.severity,status:r.status,fieldId:r.source_field,amendmentSequence:r.source_amendment_sequence==null?null:Number(r.source_amendment_sequence),assetId:r.asset_id,assetName:[r.plant_number,r.asset_name].filter(Boolean).join(' · '),safetyHold:Boolean(Number(r.safety_hold)),createdAt:r.created_at,updatedAt:r.updated_at})),
  assets:assets.map(p=>({id:p.id,name:[p.plant_number,p.name].filter(Boolean).join(' · '),safetyHold:Boolean(Number(p.safety_hold))})),
  // Server-computed so the UI never offers an action the seam would refuse.
  canRaise:can(a.role,'workshop.defect.report')&&await seamEnabled(a.organisationId,...['ims','workshop'] as const),
  amendmentSequence:f.amendmentSequence,
 };
}

/**
 * Where a Workshop order came from, for Workshop's traceability panel. The Forms helper re-resolves access
 * with the normal Forms rules; a viewer outside that scope gets `restricted` and no form content at all.
 * Answers are never copied: only the form, who/when/where, the answer's label and the evidence state.
 */
export async function describeOrderSource(orderId:string){
 const a=actor();
 const o=await one('SELECT source_type,source_id,source_field,source_amendment_sequence FROM workshop_orders WHERE organisation_id=? AND id=?',[a.organisationId,orderId]);
 if(!o)fail(404,'Work order not found.');
 if(o!.source_type!=='form_submission')return {source:null};
 let f;
 try{f=await resolveFormSubmissionForWorkflow(String(o!.source_id));}
 catch(e){if([403,404].includes(Number((e as {status?:number}).status)))return {source:{restricted:true}};throw e;}
 const project=f.projectId?await one('SELECT name FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,f.projectId]):null;
 const field=allFields(f.schema).find(x=>x.id===o!.source_field);
 const seq=o!.source_amendment_sequence==null?null:Number(o!.source_amendment_sequence);
 return {source:{
  restricted:false,submissionId:f.submissionId,formName:f.templateName,versionNumber:f.versionNumber,submittedAt:f.submittedAt,submittedByName:f.submittedByName,
  contextType:f.contextType,contextLabel:f.contextLabel,projectName:project?String(project.name):null,shiftId:f.shiftId,
  fieldLabel:field?.label??String(o!.source_field),amendmentSequence:seq,currentAmendmentSequence:f.amendmentSequence,
  evidenceState:seq==null?'unrecorded':seq===0?'Original submission':`Correction ${seq}`,
 }};
}
