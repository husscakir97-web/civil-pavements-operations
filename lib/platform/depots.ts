// Depots and yards: operational bases with a structured location and exact point, so later
// tranches can work out proximity, travel and mobilisation. Organisation-scoped.
import {z} from 'zod';
import {actorContext} from './context';
import {can} from './permissions';
import {audit} from './audit';
import {fail} from './http';
import {query,one,exec,tx,nowIso,uuid} from './sql';
import {saveLocation,loadLocations,locationInput} from './locations';
import type {LocationInput} from '@/lib/v1/location';

const actor=()=>actorContext.getStore()!;
const canView=(r:string)=>can(r,'schedule.view')||can(r,'resources.edit')||can(r,'org.admin');
const canEdit=(r:string)=>can(r,'resources.edit')||can(r,'org.admin');
export const depotInput=z.object({name:z.string().trim().min(1,'A depot name is required.').max(160),notes:z.string().trim().max(2000).nullish(),status:z.enum(['active','inactive']).optional(),location:locationInput.nullish()});

export async function listDepots(){
 const a=actor();if(!canView(a.role))fail(403,'You are not authorised to view depots.');
 const rows=await query("SELECT * FROM depots WHERE organisation_id=? ORDER BY status='active' DESC,name",[a.organisationId]);
 const locs=await loadLocations(rows.map(r=>r.location_id));
 return {canEdit:canEdit(a.role),depots:rows.map(r=>({id:r.id,name:r.name,notes:r.notes,status:r.status,revision:Number(r.revision),location:r.location_id?locs.get(r.location_id)??null:null}))};
}
export async function saveDepot(id:string|null,revision:number|null,input:z.infer<typeof depotInput>){
 const a=actor();if(!canEdit(a.role))fail(403,'You are not authorised to change depots.');
 const v=depotInput.parse(input),now=nowIso();
 return tx(async conn=>{
  let row=id?await one('SELECT * FROM depots WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,id],conn):null;
  if(id&&!row)fail(404,'Depot not found.');
  if(row&&revision!=null&&Number(row.revision)!==revision)fail(409,'This depot was changed by someone else. Refresh to see the latest version.');
  const depotId=row?.id||uuid();
  if(!row){await exec("INSERT INTO depots (id,organisation_id,name,notes,status,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,'active',1,?,?,?)",[depotId,a.organisationId,v.name,v.notes||null,a.userId,now,now],conn);row={id:depotId,location_id:null};}
  const lid=v.location?await saveLocation(conn,{type:'depot',id:depotId,locationType:'depot'},{...v.location,label:v.name} as LocationInput,row.location_id):row.location_id;
  await exec('UPDATE depots SET name=?,notes=?,status=?,location_id=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[v.name,v.notes||null,v.status||row.status||'active',lid,now,a.organisationId,depotId],conn);
  await audit({event:id?'depot.updated':'depot.created',entityType:'depot',entityId:depotId,summary:`Depot ${id?'updated':'added'}: ${v.name}`,after:{name:v.name,status:v.status,address:v.location?.formattedAddress??null}},conn);
  return {id:depotId};
 });
}
