import {domainEventStatement} from '@/lib/platform/domain-events';
import {z} from 'zod';
import {need,fail} from '@/lib/platform/http';
import {can} from '@/lib/platform/permissions';
import {query,one,exec,tx,uuid,nowIso,type Conn} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {idempotent} from '@/lib/platform/idempotency';
import {isDateOnly,isMeterValue,METER_PRECISION_MESSAGE,dateIn,isTimeZone,DEFAULT_TIME_ZONE,serviceStatus} from '@/lib/v1/service-plan';

const ref=z.string().min(1).max(191);
const note=z.string().trim().min(1).max(5000);
// DECIMAL(15,2) storage: reject excess precision up front so a reading of 100 and a threshold of 100.001 can never be stored as equal.
const meterUnit=z.enum(['hours','km']),meterValue=z.number().min(0).max(1e12).refine(isMeterValue,METER_PRECISION_MESSAGE),threshold=z.number().positive().max(1e12).refine(isMeterValue,METER_PRECISION_MESSAGE),dateOnly=z.string().refine(isDateOnly,'Use a valid date (YYYY-MM-DD).');
export const workshopAction=z.discriminatedUnion('action',[
 // A reading records the meter only. Service thresholds are plan values: `.strict()` refuses a reading that tries to carry one.
 z.object({action:z.literal('meter'),assetId:ref,meterType:meterUnit,reading:meterValue,note}).strict(),
 // Initial service plan on an asset that has none (never invented for existing assets).
 z.object({action:z.literal('plan'),assetId:ref,revision:z.number().int().positive(),nextServiceMeter:threshold.optional(),nextServiceDate:dateOnly.optional(),note}).strict(),
 // A completed service (workshop.edit). Records who/when/meter and the next thresholds; never touches a safety hold.
 z.object({action:z.literal('service'),assetId:ref,revision:z.number().int().positive(),performedOn:dateOnly,meterType:meterUnit.optional(),meterReading:meterValue.optional(),nextServiceMeter:threshold.optional(),nextServiceDate:dateOnly.optional(),note,clientRequestId:z.string().regex(/^[A-Za-z0-9-]{16,80}$/)}).strict(),
 // Administrator correction of the plan (workshop.plan.correct): mandatory reason; null clears a threshold. Not a completed service.
 z.object({action:z.literal('correct'),assetId:ref,revision:z.number().int().positive(),nextServiceMeter:threshold.nullable().optional(),nextServiceDate:dateOnly.nullable().optional(),reason:z.string().trim().min(10).max(2000)}).strict(),
 z.object({action:z.literal('asset'),name:z.string().trim().min(1).max(180),number:z.string().max(60),category:z.string().max(80),registration:z.string().max(40)}),
 z.object({action:z.literal('defect'),assetId:ref,title:z.string().trim().min(1).max(180),note,severity:z.enum(['minor','major','critical'])}),
 z.object({action:z.literal('repair'),id:ref,revision:z.number().int().positive(),note,labourHours:z.number().min(0).max(10000),parts:z.string().max(5000)}),
 z.object({action:z.literal('verify'),id:ref,revision:z.number().int().positive(),note,accepted:z.boolean()}),
]);

export async function overview(){
 const a=need('workshop.view');
 const tz=await organisationTimeZone(a.organisationId);
 const [assets,orders,entries,readings]=await Promise.all([
  query("SELECT id,name,CASE WHEN safety_hold=1 THEN 'Out of service' ELSE status END AS status,plant_number,registration,category,revision,meter_type,current_meter,next_service_meter,next_service_date FROM plant WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY name",[a.organisationId]),
  query('SELECT * FROM workshop_orders WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1000',[a.organisationId]),
  query('SELECT * FROM workshop_entries WHERE organisation_id=? ORDER BY created_at DESC LIMIT 3000',[a.organisationId]),
  query('SELECT * FROM asset_meter_readings WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1000',[a.organisationId]),
 ]);
 const today=dateIn(tz);
 return {today,timeZone:tz,canCorrect:can(a.role,'workshop.plan.correct'),
  assets:assets.map(x=>({...x,service:serviceStatus({currentMeter:x.current_meter==null?null:Number(x.current_meter),nextServiceMeter:x.next_service_meter==null?null:Number(x.next_service_meter),nextServiceDate:x.next_service_date},today)})),
  orders,entries,readings};
}

const HISTORY_COLUMNS="e.*,(SELECT COALESCE(NULLIF(u.name,''),u.email) FROM users u WHERE u.organisation_id=e.organisation_id AND u.id=e.actor_id) AS actor_name";
/**
 * One asset's service/plan history, newest first, keyset-paginated (recorded_at, id). Scoped to the caller's organisation and
 * workshop.view; another organisation's asset id is a 404. The caller learns "no history" only from an empty first page.
 */
export async function assetServiceHistory(assetId:string,cursor:string|null,limit:number){
 const a=need('workshop.view');
 if(!assetId||assetId.length>191)fail(400,'Choose an asset.');
 if(!await one('SELECT id FROM plant WHERE organisation_id=? AND id=?',[a.organisationId,assetId]))fail(404,'Asset not found.');
 let before:{at:string;id:string}|null=null;
 if(cursor){const m=/^([0-9TZ:.-]{1,40})~([A-Za-z0-9-]{1,191})$/.exec(cursor);if(!m)fail(400,'Invalid history cursor.');before={at:m[1],id:m[2]};}
 const size=Number.isInteger(limit)?Math.min(100,Math.max(1,limit)):20;
 const rows=await query(`SELECT ${HISTORY_COLUMNS} FROM asset_service_events e WHERE e.organisation_id=? AND e.asset_id=?${before?' AND (e.recorded_at<? OR (e.recorded_at=? AND e.id<?))':''} ORDER BY e.recorded_at DESC,e.id DESC LIMIT ${size+1}`,[a.organisationId,assetId,...(before?[before.at,before.at,before.id]:[])]);
 const page=rows.slice(0,size),last=page[page.length-1];
 return {events:page,nextCursor:rows.length>size&&last?`${last.recorded_at}~${last.id}`:null};
}

export async function mutate(input:z.infer<typeof workshopAction>){
 const a=need(input.action==='verify'?'workshop.verify':input.action==='correct'?'workshop.plan.correct':'workshop.edit'),org=a.organisationId,now=nowIso();
 if(input.action==='service'){
  // Atomic: service history, meter history, the asset update, audit and domain event commit together or not at all.
  // The request id makes a retry return the first result; a different concurrent submission loses on the revision check.
  const {result,replay}=await idempotent('workshop.service',input.clientRequestId,conn=>recordService(conn,a,input,now),()=>({type:'asset',id:input.assetId}),input);
  return {...result,replay};
 }
 return tx(async conn=>{
  if(input.action==='meter'){
   const asset=await one('SELECT current_meter,meter_type,next_service_meter FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[org,input.assetId],conn);
   if(!asset)fail(404,'Asset not found.');
   if(asset.meter_type&&asset.meter_type!==input.meterType)fail(409,'Meter units cannot be changed after readings are recorded.');
   if(asset.current_meter!=null&&Number(asset.current_meter)>input.reading)fail(409,'Meter reading cannot decrease.');
   // Only the meter changes. The service plan (next_service_meter / next_service_date) is untouched: a reading can never clear an overdue service.
   await exec('UPDATE plant SET current_meter=?,meter_type=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[input.reading,input.meterType,now,org,input.assetId],conn);
   const id=uuid();
   await exec('INSERT INTO asset_meter_readings (id,organisation_id,asset_id,meter_type,reading,next_service,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,org,input.assetId,input.meterType,input.reading,asset.next_service_meter??null,input.note,a.userId,now],conn);
   await audit({event:'asset.meter_recorded',entityType:'plant',entityId:input.assetId,summary:'Meter reading recorded',after:{reading:input.reading}},conn);
   return {id};
  }
  if(input.action==='plan'){
   const asset=await lockPlan(conn,org,input.assetId,input.revision);
   if(hasPlan(asset))fail(409,'This asset already has a service plan. Record a completed service; an administrator can correct the plan.');
   if(input.nextServiceMeter==null&&input.nextServiceDate==null)fail(400,'Set a next service meter, a next service date, or both.');
   if(input.nextServiceMeter!=null&&!asset.meter_type)fail(409,'Record a meter reading first so the meter units are known.');
   const id=await writePlan(conn,{org,actorId:a.userId,asset,kind:'plan_set',now,next:{meter:input.nextServiceMeter??null,date:input.nextServiceDate??null},note:input.note,reason:null});
   await audit({event:'asset.service_plan_set',entityType:'plant',entityId:input.assetId,summary:'Initial service plan set',after:{nextServiceMeter:input.nextServiceMeter??null,nextServiceDate:input.nextServiceDate??null}},conn);
   await (await domainEventStatement('workshop.plan.set',input.assetId,String(Number(asset.revision)+1))).execute(conn);
   return {id};
  }
  if(input.action==='correct'){
   const asset=await lockPlan(conn,org,input.assetId,input.revision);
   const next={meter:input.nextServiceMeter===undefined?numOrNull(asset.next_service_meter):input.nextServiceMeter,date:input.nextServiceDate===undefined?(asset.next_service_date??null):input.nextServiceDate};
   if(next.meter===numOrNull(asset.next_service_meter)&&next.date===(asset.next_service_date??null))fail(400,'The corrected plan is the same as the current plan.');
   if(next.meter!=null&&!asset.meter_type)fail(409,'Record a meter reading first so the meter units are known.');
   // Correction changes plan values only: never the meter, the asset status or a safety hold.
   const id=await writePlan(conn,{org,actorId:a.userId,asset,kind:'plan_corrected',now,next,note:null,reason:input.reason});
   await audit({event:'asset.service_plan_corrected',entityType:'plant',entityId:input.assetId,summary:'Service plan corrected by an administrator',before:{nextServiceMeter:numOrNull(asset.next_service_meter),nextServiceDate:asset.next_service_date??null},after:{nextServiceMeter:next.meter,nextServiceDate:next.date,reason:input.reason}},conn);
   await (await domainEventStatement('workshop.plan.corrected',input.assetId,String(Number(asset.revision)+1))).execute(conn);
   return {id};
  }
  if(input.action==='asset'){
   const id=uuid();
   await exec("INSERT INTO plant (id,organisation_id,name,status,metadata,plant_number,category,registration,active,revision,created_by,created_at,updated_at,legacy_synced_at) VALUES (?,?,?,'Available',?,?,?,?,1,1,?,?,?,?)",[id,org,input.name,JSON.stringify({type:input.category,rego:input.registration}),input.number,input.category,input.registration,a.userId,now,now,now],conn);
   await audit({event:'plant.created',entityType:'plant',entityId:id,summary:`Workshop asset: ${input.name}`},conn);
   return {id};
  }
  const record=input.action==='defect'?null:await one('SELECT asset_id FROM workshop_orders WHERE organisation_id=? AND id=?',[org,input.id],conn);
  const assetId=input.action==='defect'?input.assetId:record?.asset_id;
  // Always lock asset first: serialises all repairs/defects and resource edits.
  const asset=assetId?await one('SELECT id,status FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[org,assetId],conn):null;
  if(!asset)fail(404,'Asset or work order not found.');
  let id:string;
  if(input.action==='defect'){
   id=await insertDefect(conn,{org,actorId:a.userId,assetId:assetId!,title:input.title,severity:input.severity,now});
  }else{
   id=input.id;
   const order=await one('SELECT * FROM workshop_orders WHERE organisation_id=? AND id=? FOR UPDATE',[org,id],conn);
   if(!order)fail(404,'Work order not found.');
   if(Number(order.revision)!==input.revision)fail(409,'This work order changed. Refresh before continuing.');
   if(input.action==='repair'){
    if(!['open','rework'].includes(order.status))fail(409,'This work order is not awaiting repair.');
    await exec("UPDATE workshop_orders SET status='awaiting_verification',repairer_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[a.userId,now,org,id],conn);
   }else{
    if(order.status!=='awaiting_verification')fail(409,'Record the repair before verification.');
    if(order.repairer_id===a.userId)fail(403,'Another authorised person must independently verify this repair.');
    await exec('UPDATE workshop_orders SET status=?,verified_by=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[input.accepted?'closed':'rework',a.userId,now,org,id],conn);
    // A resolved defect never clears another outstanding critical defect.
    if(input.accepted&&order.severity==='critical'&&!await hasSafetyHold(org,assetId,conn)){
     await exec("UPDATE plant SET status=CASE WHEN status='Out of service' THEN 'Available' ELSE status END,safety_hold=0,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,org,assetId],conn);
    }
   }
  }
  await exec('INSERT INTO workshop_entries (id,organisation_id,order_id,kind,note,labour_hours,parts,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[uuid(),org,id,input.action==='verify'?(input.accepted?'verified':'rejected'):input.action,input.note,input.action==='repair'?input.labourHours:null,input.action==='repair'?input.parts:null,a.userId,now],conn);
  await audit({event:`workshop.${input.action}`,entityType:'work_order',entityId:id,summary:`Work order ${input.action}`,after:{assetId}},conn);
  const event=input.action==='defect'?'workshop.defect.created':input.action==='repair'?'workshop.repair.recorded':'workshop.verified';
  await (await domainEventStatement(event,id,input.action==='defect'?'1':String(input.revision+1))).execute(conn);
  return {id};
 });
}

type PlantPlanRow={id:string;revision:number|string;meter_type:string|null;current_meter:string|number|null;next_service_meter:string|number|null;next_service_date:string|null};
const numOrNull=(v:unknown)=>v==null?null:Number(v);
const hasPlan=(asset:PlantPlanRow)=>asset.next_service_meter!=null||Boolean(asset.next_service_date);
/** Locks the asset first (like every Workshop write) and refuses a stale revision. */
async function lockPlan(conn:Conn,org:string,assetId:string,revision:number){
 const asset=await one<PlantPlanRow>('SELECT id,revision,meter_type,current_meter,next_service_meter,next_service_date FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[org,assetId],conn);
 if(!asset)fail(404,'Asset not found.');
 if(Number(asset!.revision)!==revision)fail(409,'This asset changed. Refresh before continuing.');
 return asset!;
}
/** Writes the plan values and the immutable history row together. Never touches status, safety_hold or the meter. */
async function writePlan(conn:Conn,d:{org:string;actorId:string;asset:PlantPlanRow;kind:'plan_set'|'plan_corrected';now:string;next:{meter:number|null;date:string|null};note:string|null;reason:string|null}){
 const id=uuid(),revision=Number(d.asset.revision)+1;
 await exec('UPDATE plant SET next_service_meter=?,next_service_date=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[d.next.meter,d.next.date,d.now,d.org,d.asset.id],conn);
 await exec('INSERT INTO asset_service_events (id,organisation_id,asset_id,kind,actor_id,performed_on,recorded_at,meter_type,meter_reading,previous_next_service_meter,previous_next_service_date,new_next_service_meter,new_next_service_date,note,reason,asset_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,d.org,d.asset.id,d.kind,d.actorId,null,d.now,d.asset.meter_type??null,null,numOrNull(d.asset.next_service_meter),d.asset.next_service_date??null,d.next.meter,d.next.date,d.note,d.reason,revision],conn);
 return id;
}
export async function organisationTimeZone(org:string,conn?:Conn){
 const row=await one<{timezone:string|null}>('SELECT timezone FROM organisation_profiles WHERE organisation_id=?',[org],conn);
 return isTimeZone(row?.timezone)?row!.timezone!:DEFAULT_TIME_ZONE;
}
type ServiceInput=Extract<z.infer<typeof workshopAction>,{action:'service'}>;
async function recordService(conn:Conn,a:{organisationId:string;userId:string},input:ServiceInput,now:string){
 const org=a.organisationId,asset=await lockPlan(conn,org,input.assetId,input.revision),tz=await organisationTimeZone(org,conn);
 const today=dateIn(tz);
 if(input.performedOn>today)fail(400,'A completed service cannot be dated in the future.');
 if(asset.meter_type&&input.meterReading==null)fail(400,'Enter the meter reading at service.');
 if(input.meterReading!=null){
  if(!asset.meter_type&&!input.meterType)fail(400,'Choose the meter units.');
  if(asset.meter_type&&input.meterType&&input.meterType!==asset.meter_type)fail(409,'Meter units cannot be changed after readings are recorded.');
  if(asset.current_meter!=null&&Number(asset.current_meter)>input.meterReading)fail(409,`This reading is lower than the latest recorded reading (${Number(asset.current_meter)}). Backdated service evidence is not supported in this version: enter the current reading.`);
 }
 // A backdated service must not predate newer evidence (a later meter reading or an earlier recorded service).
 const latest=await one<{read_at:string|null;served_on:string|null}>("SELECT (SELECT MAX(created_at) FROM asset_meter_readings WHERE organisation_id=? AND asset_id=?) AS read_at,(SELECT MAX(performed_on) FROM asset_service_events WHERE organisation_id=? AND asset_id=? AND kind='completed') AS served_on",[org,input.assetId,org,input.assetId],conn);
 const newest=[latest?.read_at?dateIn(tz,latest.read_at):null,latest?.served_on??null].filter(Boolean).sort().pop();
 if(newest&&input.performedOn<newest)fail(409,`Backdated service evidence is not supported in this version: newer evidence was recorded on ${newest}. Use ${newest} or later.`);
 const hadMeter=asset.next_service_meter!=null,hadDate=Boolean(asset.next_service_date);
 if(hadMeter&&input.nextServiceMeter==null)fail(400,'Enter the next service meter.');
 if(hadDate&&input.nextServiceDate==null)fail(400,'Enter the next service date.');
 if(input.nextServiceMeter!=null){
  if(input.meterReading==null)fail(400,'A next service meter needs the meter reading at service.');
  if(input.nextServiceMeter<=input.meterReading!)fail(400,'The next service meter must be above the reading at service.');
 }
 if(input.nextServiceDate!=null&&input.nextServiceDate<=input.performedOn)fail(400,'The next service date must be after the date of this service.');
 const meterType=asset.meter_type||input.meterType||null,revision=Number(asset.revision)+1,next={meter:input.nextServiceMeter??null,date:input.nextServiceDate??null};
 const id=uuid();
 // Never touches status or safety_hold: recording a service cannot return an asset from a critical-defect hold.
 await exec('UPDATE plant SET current_meter=COALESCE(?,current_meter),meter_type=COALESCE(meter_type,?),next_service_meter=?,next_service_date=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[input.meterReading??null,meterType,next.meter,next.date,now,org,input.assetId],conn);
 await exec('INSERT INTO asset_service_events (id,organisation_id,asset_id,kind,actor_id,performed_on,recorded_at,meter_type,meter_reading,previous_next_service_meter,previous_next_service_date,new_next_service_meter,new_next_service_date,note,reason,asset_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,org,input.assetId,'completed',a.userId,input.performedOn,now,meterType,input.meterReading??null,numOrNull(asset.next_service_meter),asset.next_service_date??null,next.meter,next.date,input.note,null,revision],conn);
 if(input.meterReading!=null&&meterType)await exec('INSERT INTO asset_meter_readings (id,organisation_id,asset_id,meter_type,reading,next_service,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[uuid(),org,input.assetId,meterType,input.meterReading,next.meter,`Service completed on ${input.performedOn}: ${input.note}`.slice(0,5000),a.userId,now],conn);
 await audit({event:'asset.service_completed',entityType:'plant',entityId:input.assetId,summary:`Service completed on ${input.performedOn}`,before:{nextServiceMeter:numOrNull(asset.next_service_meter),nextServiceDate:asset.next_service_date??null},after:{meterReading:input.meterReading??null,nextServiceMeter:next.meter,nextServiceDate:next.date}},conn);
 await (await domainEventStatement('workshop.service.recorded',input.assetId,String(revision))).execute(conn);
 return {id,revision};
}

/**
 * Opens a defect work order on a locked asset. A critical defect places the asset on safety hold
 * (Out of service) until every critical defect is repaired and independently verified.
 * Callers lock the asset row first and write the entry, audit and domain event.
 */
/** Where a defect came from: the evidence record, the answer, and the exact evidence state (Forms amendment sequence, 0 = original) when raised. */
export type DefectSource={type:string;id:string;field:string;amendmentSequence:number;contextType:string;contextId:string;projectId:string|null};
async function insertDefect(conn:Conn,d:{org:string;actorId:string;assetId:string;title:string;severity:'minor'|'major'|'critical';now:string;source?:DefectSource}){
 const id=uuid();
 await exec("INSERT INTO workshop_orders (id,organisation_id,asset_id,title,severity,status,source_type,source_id,source_field,source_amendment_sequence,source_context_type,source_context_id,source_project_id,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,1,?,?,?)",[id,d.org,d.assetId,d.title,d.severity,d.source?.type??null,d.source?.id??null,d.source?.field??null,d.source?.amendmentSequence??null,d.source?.contextType??null,d.source?.contextId??null,d.source?.projectId??null,d.actorId,d.now,d.now],conn);
 if(d.severity==='critical')await exec("UPDATE plant SET status='Out of service',safety_hold=1,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[d.now,d.org,d.assetId],conn);
 return id;
}
/**
 * Seam entry (lib/seams/form-defects.ts): raise a defect from source evidence the caller has already
 * authorised. Same rules as a Workshop-raised defect; the source link is recorded on the order.
 * A source answer may yield several defects: request idempotency is the caller's concern (platform/idempotency).
 */
export async function raiseSourcedDefect(conn:Conn,d:{org:string;actorId:string;assetId:string;title:string;severity:'minor'|'major'|'critical';note:string;source:DefectSource}){
 const now=nowIso();
 const asset=await one('SELECT id FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[d.org,d.assetId],conn);
 if(!asset)fail(404,'Asset not found.');
 const id=await insertDefect(conn,{...d,now});
 await exec('INSERT INTO workshop_entries (id,organisation_id,order_id,kind,note,labour_hours,parts,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[uuid(),d.org,id,'defect',d.note,null,null,d.actorId,now],conn);
 await audit({event:'workshop.defect',entityType:'work_order',entityId:id,summary:`Defect raised from ${d.source.type.replace('_',' ')}`,after:{assetId:d.assetId,severity:d.severity,source:d.source}},conn);
 await (await domainEventStatement('workshop.defect.reported',id,'1')).execute(conn);
 return id;
}

async function hasSafetyHold(org:string,assetId:string,conn:Conn){
 return Boolean(await one("SELECT id FROM workshop_orders WHERE organisation_id=? AND asset_id=? AND severity='critical' AND status<>'closed' LIMIT 1",[org,assetId],conn));
}
