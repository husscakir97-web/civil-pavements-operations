import {domainEventStatement} from '@/lib/platform/domain-events';
import {z} from 'zod';
import {need,fail} from '@/lib/platform/http';
import {query,one,exec,tx,uuid,nowIso,type Conn} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';

const ref=z.string().min(1).max(191);
const note=z.string().trim().min(1).max(5000);
export const workshopAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('meter'),assetId:ref,meterType:z.enum(['hours','km']),reading:z.number().min(0).max(1e12),nextService:z.number().min(0).max(1e12),note}),
 z.object({action:z.literal('asset'),name:z.string().trim().min(1).max(180),number:z.string().max(60),category:z.string().max(80),registration:z.string().max(40)}),
 z.object({action:z.literal('defect'),assetId:ref,title:z.string().trim().min(1).max(180),note,severity:z.enum(['minor','major','critical'])}),
 z.object({action:z.literal('repair'),id:ref,revision:z.number().int().positive(),note,labourHours:z.number().min(0).max(10000),parts:z.string().max(5000)}),
 z.object({action:z.literal('verify'),id:ref,revision:z.number().int().positive(),note,accepted:z.boolean()}),
]);

export async function overview(){
 const a=need('workshop.view');
 const [assets,orders,entries,readings]=await Promise.all([
  query("SELECT id,name,CASE WHEN safety_hold=1 THEN 'Out of service' ELSE status END AS status,plant_number,registration,category,revision,meter_type,current_meter,next_service_meter FROM plant WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY name",[a.organisationId]),
  query('SELECT * FROM workshop_orders WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1000',[a.organisationId]),
  query('SELECT * FROM workshop_entries WHERE organisation_id=? ORDER BY created_at DESC LIMIT 3000',[a.organisationId]),
  query('SELECT * FROM asset_meter_readings WHERE organisation_id=? ORDER BY created_at DESC LIMIT 1000',[a.organisationId]),
 ]);
 return {assets,orders,entries,readings};
}

export async function mutate(input:z.infer<typeof workshopAction>){
 const a=need(input.action==='verify'?'workshop.verify':'workshop.edit'),org=a.organisationId,now=nowIso();
 return tx(async conn=>{
  if(input.action==='meter'){
   const asset=await one('SELECT current_meter,meter_type FROM plant WHERE organisation_id=? AND id=? FOR UPDATE',[org,input.assetId],conn);
   if(!asset)fail(404,'Asset not found.');
   if(asset.meter_type&&asset.meter_type!==input.meterType)fail(409,'Meter units cannot be changed after readings are recorded.');
   if(asset.current_meter!=null&&Number(asset.current_meter)>input.reading)fail(409,'Meter reading cannot decrease.');
   await exec('UPDATE plant SET current_meter=?,meter_type=?,next_service_meter=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[input.reading,input.meterType,input.nextService,now,org,input.assetId],conn);
   const id=uuid();
   await exec('INSERT INTO asset_meter_readings (id,organisation_id,asset_id,meter_type,reading,next_service,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,org,input.assetId,input.meterType,input.reading,input.nextService,input.note,a.userId,now],conn);
   await audit({event:'asset.meter_recorded',entityType:'plant',entityId:input.assetId,summary:'Meter and service threshold recorded',after:{reading:input.reading,nextService:input.nextService}},conn);
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
