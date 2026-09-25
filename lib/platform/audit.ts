// Central typed audit log. Every controlled state change writes one row,
// inside the same transaction as the change it records.
import {actorContext} from './context';
import {exec,nowIso,uuid,type Conn} from './sql';
import {getPool} from './database';
export type AuditInput={event:string;entityType:string;entityId:string;projectId?:string|null;summary?:string;before?:unknown;after?:unknown;organisationId?:string;actorUserId?:string|null;actorEmail?:string|null};
const json=(v:unknown)=>v===undefined?null:JSON.stringify(v);
export async function audit(input:AuditInput,conn:Conn=getPool()){
 const actor=actorContext.getStore();
 const org=input.organisationId??actor?.organisationId;
 if(!org)throw new Error('Audit requires an organisation');
 await exec('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  [uuid(),org,input.actorUserId??actor?.userId??null,input.actorEmail??actor?.email??null,input.event,input.entityType,input.entityId,input.projectId??null,(input.summary||'').slice(0,500),json(input.before),json(input.after),nowIso()],conn);
}
