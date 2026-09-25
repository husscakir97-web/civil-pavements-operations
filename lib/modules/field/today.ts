// Field "Today": the worker's shifts, the issued SWMS they must acknowledge,
// and a price-free docket submission. Payloads use the field allowlist
// projection, so rates, margins and client pricing never reach field users.
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,nowIso,uuid,type Row} from '@/lib/platform/sql';
import {idempotent} from '@/lib/platform/idempotency';
import {fieldDelivery} from '@/lib/field-access';
import {safeJson} from '@/lib/estimates-db';
import {easternDate} from '@/lib/reporting';

const actor=()=>actorContext.getStore()!;

export async function today(days=7){
 const a=actor(),org=a.organisationId,start=easternDate(new Date()),end=new Date(Date.parse(start)+days*86400000).toISOString().slice(0,10);
 const shifts=await query("SELECT s.id,s.name,s.status,s.metadata,s.created_at,s.updated_at,j.id AS job_id,j.name AS job_name,j.project_number,j.stage AS job_stage,j.status AS job_status,j.metadata AS job_metadata,j.site_address FROM shifts s LEFT JOIN jobs j ON j.id=JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId')) AND j.organisation_id=s.organisation_id WHERE s.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))>=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date'))<=? AND s.status NOT IN ('Cancelled','Archived','Draft') ORDER BY JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.date')),JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.start'))",[org,start,end]);
 const workerLinks=(await query("SELECT id FROM workers WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.userId'))=?",[org,a.userId])).map(w=>w.id);
 const jobIds=[...new Set(shifts.map(s=>s.job_id).filter(Boolean))];
 const [swms,records,dockets]=await Promise.all([
  jobIds.length?query("SELECT s.id,s.project_id,s.reference,s.title,s.activity,s.issued_revision_id,(SELECT COUNT(*) FROM swms_acknowledgements k WHERE k.organisation_id=s.organisation_id AND k.swms_revision_id=s.issued_revision_id AND k.user_id=?) AS mine FROM swms s WHERE s.organisation_id=? AND s.project_id IN (?) AND s.issued_revision_id IS NOT NULL",[a.userId,org,jobIds]):[],
  shifts.length?query('SELECT shift_id,status,revision FROM field_records WHERE organisation_id=? AND shift_id IN (?)',[org,shifts.map(s=>s.id)]):[],
  shifts.length?query("SELECT id,docket_no,status,JSON_UNQUOTE(JSON_EXTRACT(links,'$.shiftId')) AS shift_id FROM dockets WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(links,'$.shiftId')) IN (?)",[org,shifts.map(s=>s.id)]):[],
 ]);
 const out=shifts.map(s=>{
  const plan=fieldDelivery({id:s.id,name:s.name,status:s.status,metadata:safeJson<Row>(s.metadata,{})},'shifts');
  const m=plan.metadata as Row,assignments=(m.assignments||[]) as Row[];
  const assigned=m.supervisorUserId===a.userId||assignments.some(x=>x.userId===a.userId||workerLinks.includes(String(x.resourceId)));
  const projectSwms=swms.filter(w=>w.project_id===s.job_id).map(w=>({id:w.id,reference:w.reference,title:w.title,activity:w.activity,revisionId:w.issued_revision_id,acknowledged:Number(w.mine)>0}));
  const job=safeJson<Row>(s.job_metadata,{});
  return {id:s.id,name:s.name,status:s.status,version:s.updated_at||s.created_at,date:m.date,start:m.start,finish:m.finish,location:m.location||s.site_address||job.site||'',supervisor:m.supervisor||'',activity:m.scope||job.scope||'',instructions:m.instructions||'',preStart:m.preStart||'',siteContact:m.siteContact||'',crew:assignments.map(x=>({name:x.name,role:x.role,category:x.category})),
   project:s.job_id?{id:s.job_id,name:s.job_name,number:s.project_number,closed:s.job_stage==='closed'}:null,assignedToMe:assigned,swms:projectSwms,swmsOutstanding:projectSwms.filter(w=>!w.acknowledged).length,
   fieldRecord:records.find(r=>r.shift_id===s.id)?{status:records.find(r=>r.shift_id===s.id)!.status}:null,dockets:dockets.filter(d=>d.shift_id===s.id).map(d=>({id:d.id,docketNo:d.docket_no,status:d.status}))};
 });
 const todays=out.filter(s=>s.date===start);
 return {date:start,today:todays.filter(s=>s.assignedToMe||a.role!=='field'),otherToday:a.role==='field'?todays.filter(s=>!s.assignedToMe):[],upcoming:out.filter(s=>s.date!==start&&(s.assignedToMe||a.role!=='field'))};
}

export type FieldDocketInput={shiftId:string;docketNo:string;workDate:string;labourHours:number;quantity:number;quantityUnit:string;notes:string;lines:Array<{description:string;quantity:number;unit:string}>;clientRequestId?:string|null;shiftVersion?:string|null;capturedAt?:string|null};
export type FieldDocketResult={docketId:string;docketNo:string;status:string;warnings:string[]};
/**
 * Field users submit dockets for review with quantities only. Pricing and approval stay with the office.
 * Offline sync rules (deterministic):
 *  - the same clientRequestId is applied once; a replay returns the original docket;
 *  - the shift was cancelled or stood down after capture → 409 SHIFT_CANCELLED (kept on the device);
 *  - the shift moved to another date than the captured work date → 409 SHIFT_RESCHEDULED;
 *  - any other office change to the shift after capture → accepted, flagged for office review;
 *  - the same docket number and date already exists (another device) → 409 DUPLICATE_DOCKET.
 */
export async function submitFieldDocket(input:FieldDocketInput){
 const a=actor();if(!can(a.role,'docket.submit'))fail(403,'You are not authorised to submit dockets.');
 const out=await idempotent<FieldDocketResult>('field.docket',input.clientRequestId,async conn=>{
  const shift=await one('SELECT id,name,status,metadata,updated_at,created_at FROM shifts WHERE organisation_id=? AND id=?',[a.organisationId,input.shiftId],conn);
  if(!shift)fail(404,'Shift not found.');
  const meta=safeJson<Row>(shift!.metadata,{});
  const jobId=String(meta.jobId||'');
  const job=jobId?await one('SELECT id,name,stage,client_name,metadata FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,jobId],conn):null;
  if(!job)fail(422,'This shift is not linked to a project.');
  if(job!.stage==='closed')fail(409,'This project is closed. Ask the office to reopen it.',{code:'PROJECT_CLOSED'});
  if(['Cancelled','Stand-down','Archived'].includes(shift!.status))fail(409,`This shift was ${shift!.status==='Stand-down'?'stood down':'cancelled'} by the office after your docket was captured. It has been kept on this device; check with your supervisor.`,{code:'SHIFT_CANCELLED'});
  if(meta.date&&meta.date!==input.workDate)fail(409,`This shift was moved to ${meta.date}. Your docket for ${input.workDate} has been kept on this device; check the date with your supervisor.`,{code:'SHIFT_RESCHEDULED'});
  const version=shift!.updated_at||shift!.created_at;
  const changed=Boolean(input.shiftVersion&&version&&input.shiftVersion!==version);
  const docketNo=input.docketNo.trim()||`FIELD-${input.workDate.replaceAll('-','')}-${uuid().slice(0,6).toUpperCase()}`;
  const dup=await one("SELECT id FROM dockets WHERE organisation_id=? AND UPPER(docket_no)=? AND work_date=? AND LOWER(status)<>'archived'",[a.organisationId,docketNo.toUpperCase(),input.workDate],conn);
  if(dup)fail(409,'A docket with this number already exists for this date.',{code:'DUPLICATE_DOCKET'});
  const id=uuid(),now=nowIso();
  const lines=input.lines.filter(l=>l.description.trim()).map(l=>({description:l.description.trim().slice(0,200),quantity:l.quantity,unit:l.unit.slice(0,20)}));
  const warnings=changed?['The office changed this shift after you captured the docket. It was submitted and flagged for office review.']:[];
  const notes=(changed?`[Shift changed after capture] ${input.notes}`:input.notes).slice(0,1000);
  await exec("INSERT INTO dockets (id,organisation_id,docket_no,work_date,client,project,crew,labour_hours,quantity,quantity_unit,amount,status,notes,confidence,links,line_items,extraction_method,field_confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,'review',?,100,?,?,'field-entry','{}',?,?)",
   [id,a.organisationId,docketNo,input.workDate,job!.client_name||String(safeJson<Row>(job!.metadata,{}).client||''),job!.name,(a.name||a.email).slice(0,160),input.labourHours,input.quantity,input.quantityUnit||'item',notes,JSON.stringify({jobId,shiftId:input.shiftId,submittedBy:a.userId,...(input.clientRequestId?{clientRequestId:input.clientRequestId}:{}),...(input.capturedAt?{capturedAt:input.capturedAt}:{}),...(changed?{shiftChangedAfterCapture:true}:{})}),JSON.stringify(lines),now,now],conn);
  await audit({event:'docket.submitted',entityType:'docket',entityId:id,projectId:jobId,summary:`Docket ${docketNo} submitted from the field for review${changed?' (shift changed after capture)':''}${input.capturedAt?` — captured ${input.capturedAt}`:''}`,after:{shiftId:input.shiftId,labourHours:input.labourHours,quantity:input.quantity,offline:Boolean(input.capturedAt)}},conn);
  return {docketId:id,docketNo,status:'review',warnings};
 },r=>({type:'docket',id:r.docketId}),{shiftId:input.shiftId,docketNo:input.docketNo,workDate:input.workDate,labourHours:input.labourHours,quantity:input.quantity,quantityUnit:input.quantityUnit,notes:input.notes,lines:input.lines});
 return {...out.result,replay:out.replay};
}
