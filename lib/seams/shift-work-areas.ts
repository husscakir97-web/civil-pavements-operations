// Seam: scheduled shift <-> shared project work areas. A shift (Operations) REFERENCES the stable ids of work areas drawn on its
// project (Projects); geometry is never copied, so there is one saved shape per area and the map is always opened from the project.
// Capability-aware: with Projects (or Operations) absent, the shift and the map each work on their own; link rows are kept, never
// deleted on a downgrade, and simply stop being shown or editable. The areas are operational markup only: the response carries the
// disclaimer and nothing here presents them as an approved traffic management plan.
import {actorContext} from '@/lib/platform/context';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,type Row,type Conn} from '@/lib/platform/sql';
import {getEntitlements,requireSeam,usable,writable} from '@/lib/platform/entitlements';
import {assertProjectAccess} from '@/lib/platform/project-access';
import {can} from '@/lib/platform/permissions';
import {assertProjectOpen,stageOf} from '@/lib/modules/projects/projects';
import {WORK_MAP_DISCLAIMER,type WorkAreaDelivery,type WorkAreaDiscipline,type WorkAreaKind} from '@/lib/v1/work-areas';

const actor=()=>actorContext.getStore()!;
export type LinkedWorkArea={id:string;name:string;kind:WorkAreaKind;discipline:WorkAreaDiscipline;delivery:WorkAreaDelivery;contractorLabel:string|null;sequence:number|null;status:'active'|'archived';areaM2:number};
export type ShiftWorkAreas={enabled:boolean;canEdit:boolean;reason:string|null;shiftId:string;projectId:string|null;projectName:string|null;links:LinkedWorkArea[];disclaimer:string};
const MAX_LINKS=50;
const present=(r:Row):LinkedWorkArea=>({id:r.id,name:r.name,kind:r.kind,discipline:r.discipline,delivery:r.delivery,contractorLabel:r.contractor_label??null,sequence:r.sequence==null?null:Number(r.sequence),status:r.status==='archived'?'archived':'active',areaM2:Number(r.area_m2)});

async function loadShift(shiftId:string,conn?:Conn){
 const s=await one('SELECT id,name,status,project_id FROM shifts WHERE organisation_id=? AND id=?',[actor().organisationId,shiftId],conn);
 if(!s)fail(404,'Shift not found.');
 return s!;
}

/** The work areas a shift references. Never returns geometry. `enabled` is false (not an error) when the capability is absent. */
export async function shiftWorkAreas(shiftId:string):Promise<ShiftWorkAreas>{
 const a=actor(),s=await loadShift(shiftId);
 const base:ShiftWorkAreas={enabled:false,canEdit:false,reason:null,shiftId,projectId:s.project_id??null,projectName:null,links:[],disclaimer:WORK_MAP_DISCLAIMER};
 const ent=await getEntitlements(a.organisationId);
 if(!usable(ent,'projects'))return {...base,reason:'Project work areas are not available for your organisation.'};
 if(!can(a.role,'project.view'))return {...base,reason:'You do not have access to project work areas.'};
 if(!s.project_id)return {...base,reason:'This shift is not on a project.'};
 await assertProjectAccess(s.project_id);
 const project=await one('SELECT name,stage,status FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,s.project_id]);
 const closed=project?stageOf(project)==='closed':false;
 const rows=await query('SELECT a.* FROM shift_work_areas l JOIN project_work_areas a ON a.organisation_id=l.organisation_id AND a.id=l.work_area_id WHERE l.organisation_id=? AND l.shift_id=? ORDER BY (a.status=\'archived\'),COALESCE(a.sequence,9999),a.name,a.id',[a.organisationId,shiftId]);
 const canEdit=writable(ent,'projects')&&writable(ent,'operations')&&can(a.role,'schedule.edit')&&!closed;
 return {...base,enabled:true,canEdit,reason:closed?'This project is closed, so its shifts can no longer change their work areas.':null,projectName:project?.name??null,links:rows.map(present)};
}

/**
 * Replaces the set of work areas a shift references. Every area must belong to the shift's own project; new links need an active area
 * (an already-linked area that was archived later is kept). Needs the seam (both modules writable), schedule.edit, project access and an
 * open project. Only link rows change: areas and shapes are never touched. Audited with added and removed ids.
 */
export async function setShiftWorkAreas(shiftId:string,workAreaIds:string[]):Promise<ShiftWorkAreas>{
 const a=actor();
 if(!await requireSeam('shift.workarea'))fail(409,'Work areas are not available for scheduling in your organisation (Projects and Operations must both be active). The shift is unaffected.');
 const ids=[...new Set(workAreaIds)];
 if(ids.length>MAX_LINKS)fail(422,`A shift can reference at most ${MAX_LINKS} work areas.`);
 await tx(async conn=>{
  const s=await loadShift(shiftId,conn);
  if(!s.project_id)fail(422,'This shift is not on a project, so it cannot reference project work areas.');
  await assertProjectOpen(s.project_id,conn);
  const found=ids.length?await query('SELECT id,name,status FROM project_work_areas WHERE organisation_id=? AND project_id=? AND id IN (?)',[a.organisationId,s.project_id,ids],conn):[];
  const byId=new Map(found.map(r=>[r.id as string,r]));
  for(const id of ids)if(!byId.has(id))fail(422,'One of the work areas does not belong to this shift\'s project.');
  const current=await query('SELECT work_area_id FROM shift_work_areas WHERE organisation_id=? AND shift_id=?',[a.organisationId,shiftId],conn);
  const have=new Set(current.map(r=>r.work_area_id as string));
  const add=ids.filter(id=>!have.has(id)),remove=[...have].filter(id=>!ids.includes(id));
  for(const id of add)if(byId.get(id)!.status!=='active')fail(422,'Archived work areas cannot be newly linked to a shift.');
  const now=nowIso();
  for(const id of add)await exec('INSERT INTO shift_work_areas (id,organisation_id,shift_id,work_area_id,project_id,created_by,created_at) VALUES (?,?,?,?,?,?,?)',[uuid(),a.organisationId,shiftId,id,s.project_id,a.userId,now],conn);
  if(remove.length)await exec('DELETE FROM shift_work_areas WHERE organisation_id=? AND shift_id=? AND work_area_id IN (?)',[a.organisationId,shiftId,remove],conn);
  if(add.length||remove.length)await audit({event:'shift.work_areas_changed',entityType:'shift',entityId:shiftId,projectId:s.project_id,summary:`Shift “${s.name}”: ${add.length} work area(s) linked, ${remove.length} unlinked`,before:{workAreaIds:[...have]},after:{workAreaIds:ids,added:add,removed:remove}},conn);
 });
 return shiftWorkAreas(shiftId);
}
