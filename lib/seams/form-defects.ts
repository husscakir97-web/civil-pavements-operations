// Seam: prestart / inspection form → Workshop defect → (critical) safety hold → repair →
// independent verification → return to service. The Forms engine (IMS) and Workshop stay separate
// modules: this seam fires only when both are entitled, preserves the submitter's capability and
// tenant, and never modifies the immutable form submission. Without Workshop the submission is
// still stored and the defect can be recorded manually later.
import {actorContext} from '@/lib/platform/context';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,tx,type Row} from '@/lib/platform/sql';
import {requireSeam} from '@/lib/platform/entitlements';
import {can} from '@/lib/platform/permissions';
import {resolveContext} from '@/lib/platform/forms';
import {allFields,type Answers,type FormContext,type FormSchema} from '@/lib/v1/forms';
import {raiseSourcedDefect} from '@/lib/modules/workshop/workshop';

const actor=()=>actorContext.getStore()!;
const parse=<T>(s:unknown,fallback:T):T=>{if(typeof s!=='string')return (s as T)??fallback;try{return JSON.parse(s) as T;}catch{return fallback;}};
const SEVERITIES=['minor','major','critical'] as const;
type Severity=typeof SEVERITIES[number];

/** Loads a submission the actor may see (context re-resolved), with its exact schema and current answers. */
async function authorisedSubmission(submissionId:string){
 const org=actor().organisationId;
 const s=await one('SELECT * FROM form_submissions WHERE organisation_id=? AND id=?',[org,submissionId]);
 if(!s)fail(404,'Submission not found.');
 await resolveContext(s!.context_type as FormContext,String(s!.context_id));
 const v=await one('SELECT schema_json FROM form_template_versions WHERE organisation_id=? AND id=?',[org,s!.template_version_id]);
 const last=await one('SELECT responses_json FROM form_submission_amendments WHERE organisation_id=? AND submission_id=? ORDER BY sequence DESC LIMIT 1',[org,submissionId]);
 const schema=parse<FormSchema>(v?.schema_json,{sections:[]}),answers=parse<Answers>(last?.responses_json??s!.responses_json,{});
 return {s:s!,schema,answers};
}
/** Plant the evidence is about: the asset context itself, or plant chosen in the form's asset fields. */
function evidenceAssets(s:Row,schema:FormSchema,answers:Answers){
 const ids=new Set<string>();
 if(s.context_type==='asset')ids.add(String(s.context_id));
 for(const f of allFields(schema))if(f.type==='asset'&&typeof answers[f.id]==='string')ids.add(String(answers[f.id]));
 return ids;
}

export async function raiseFormDefect(submissionId:string,input:{assetId?:unknown;fieldId?:unknown;title?:unknown;severity?:unknown;note?:unknown}){
 const a=actor();
 if(!await requireSeam('form.defect'))fail(409,'Workshop is not enabled for your organisation. The form is saved; record the defect manually.');
 const title=typeof input.title==='string'?input.title.trim().slice(0,180):'';if(!title)fail(400,'Describe the defect.');
 const note=typeof input.note==='string'?input.note.trim().slice(0,5000):'';if(!note)fail(400,'Add the defect details.');
 const severity=SEVERITIES.includes(input.severity as Severity)?input.severity as Severity:null;if(!severity)fail(400,'Choose the defect severity.');
 const {s,schema,answers}=await authorisedSubmission(submissionId);
 const assetId=String(input.assetId||'');
 // Only plant the evidence is actually about — never an arbitrary asset id.
 if(!evidenceAssets(s,schema,answers).has(assetId))fail(400,'Choose plant recorded on this form.');
 const fieldId=String(input.fieldId||'');
 if(!allFields(schema).some(f=>f.id===fieldId))fail(400,'Choose the answer that shows the defect.');
 return tx(async conn=>{
  const id=await raiseSourcedDefect(conn,{org:a.organisationId,actorId:a.userId,assetId,title,severity:severity!,note,source:{type:'form_submission',id:s.id,field:fieldId}});
  await audit({event:'form_defect.raised',entityType:'form_submission',entityId:s.id,projectId:s.project_id??null,summary:`${severity} defect raised: ${title}`.slice(0,500),after:{workOrderId:id,assetId,fieldId,severity,safetyHold:severity==='critical'}},conn);
  return {id,safetyHold:severity==='critical'};
 });
}

/** Defects raised from one submission, visible to anyone who may see the submission. */
export async function listFormDefects(submissionId:string){
 const a=actor(),{s,schema,answers}=await authorisedSubmission(submissionId);
 const rows=await query(`SELECT o.id,o.title,o.severity,o.status,o.source_field,o.asset_id,o.created_at,o.updated_at,p.name AS asset_name,p.plant_number,p.safety_hold
  FROM workshop_orders o LEFT JOIN plant p ON p.organisation_id=o.organisation_id AND p.id=o.asset_id
  WHERE o.organisation_id=? AND o.source_type='form_submission' AND o.source_id=? ORDER BY o.created_at`,[a.organisationId,s.id]);
 const assetIds=[...evidenceAssets(s,schema,answers)];
 const assets=assetIds.length?await query('SELECT id,name,plant_number,safety_hold FROM plant WHERE organisation_id=? AND id IN (?)',[a.organisationId,assetIds]):[];
 return {
  defects:rows.map(r=>({id:r.id,title:r.title,severity:r.severity,status:r.status,fieldId:r.source_field,assetId:r.asset_id,assetName:[r.plant_number,r.asset_name].filter(Boolean).join(' · '),safetyHold:Boolean(Number(r.safety_hold)),createdAt:r.created_at,updatedAt:r.updated_at})),
  assets:assets.map(p=>({id:p.id,name:[p.plant_number,p.name].filter(Boolean).join(' · '),safetyHold:Boolean(Number(p.safety_hold))})),
  canRaise:can(a.role,'forms.submit'),
 };
}
