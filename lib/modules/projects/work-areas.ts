// Project work map service: operational work-area / stage polygons per project.
// Every read/write goes through loadProject, so organisation scope and project membership apply (404, never 403,
// for projects the actor cannot reach). Writes need project.edit, an open project and the current revision.
import {z} from 'zod';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid,type Row,type Conn} from '@/lib/platform/sql';
import {loadProject,projectLocations,stageOf} from './projects';
import {validateRing,isDemoName,WORK_AREA_KINDS,WORK_AREA_DISCIPLINES,WORK_AREA_DELIVERY,WORK_AREA_LIMITS,WORK_MAP_DISCLAIMER,type WorkAreaView,type WorkMapView} from '@/lib/v1/work-areas';
import type {LatLng} from '@/lib/v1/location';

const actor=()=>actorContext.getStore()!;
const L=WORK_AREA_LIMITS;
const text=(n:number)=>z.string().trim().max(n).nullish().transform(v=>v||null);
const pointSchema=z.object({lat:z.number(),lng:z.number()});
export const workAreaFields={
 name:z.string().trim().min(1,'Name the work area or stage.').max(L.maxNameLength),
 kind:z.enum(WORK_AREA_KINDS),discipline:z.enum(WORK_AREA_DISCIPLINES),delivery:z.enum(WORK_AREA_DELIVERY),
 contractorLabel:text(160),sequence:z.number().int().min(1).max(999).nullish().transform(v=>v??null),notes:text(L.maxNotesLength),
 ring:z.array(pointSchema).max(L.maxVertices+1),
};
export const createInput=z.object({projectId:z.string().min(1).max(191),...workAreaFields});
export const updateInput=z.object({id:z.string().min(1).max(191),revision:z.number().int(),archive:z.boolean().optional(),name:workAreaFields.name.optional(),kind:workAreaFields.kind.optional(),discipline:workAreaFields.discipline.optional(),delivery:workAreaFields.delivery.optional(),contractorLabel:workAreaFields.contractorLabel.optional(),sequence:workAreaFields.sequence.optional(),notes:workAreaFields.notes.optional(),ring:workAreaFields.ring.optional()});

function ringOf(raw:unknown):LatLng[]{try{const v=JSON.parse(String(raw));return Array.isArray(v)?v:[];}catch{return [];}}
export const presentWorkArea=(r:Row):WorkAreaView=>({id:r.id,projectId:r.project_id,name:r.name,kind:r.kind,discipline:r.discipline,delivery:r.delivery,contractorLabel:r.contractor_label??null,sequence:r.sequence==null?null:Number(r.sequence),notes:r.notes??null,ring:ringOf(r.geometry),areaM2:Number(r.area_m2),status:r.status==='archived'?'archived':'active',revision:Number(r.revision),createdAt:r.created_at,updatedAt:r.updated_at,archivedAt:r.archived_at??null,demo:isDemoName(String(r.name))});

function assertEditable(p:Row){
 if(!can(actor().role,'project.edit'))fail(403,'You are not authorised to edit the work map.');
 if(stageOf(p)==='closed')fail(409,'This project is closed. Reopen it before changing the work map.');
}
function geometry(ring:unknown){
 const v=validateRing(ring);
 if(!v.ok)fail(422,v.error);
 return v;
}
const stale=()=>fail(409,'This work area was changed by someone else. Reload to see the latest version.');

export async function getWorkMap(projectId:string,includeArchived=false):Promise<WorkMapView>{
 const p=await loadProject(projectId),org=actor().organisationId;
 const rows=await query(`SELECT * FROM project_work_areas WHERE organisation_id=? AND project_id=?${includeArchived?'':" AND status='active'"} ORDER BY (status='archived'),COALESCE(sequence,9999),created_at,id`,[org,projectId]);
 const loc=(await projectLocations([p]))(p).location;
 return {projectId,projectName:p.name,projectNumber:p.project_number??null,stage:stageOf(p),closed:stageOf(p)==='closed',canEdit:can(actor().role,'project.edit')&&stageOf(p)!=='closed',pin:loc?.pin??null,address:loc?.formattedAddress??null,areas:rows.map(presentWorkArea),limits:L,disclaimer:WORK_MAP_DISCLAIMER};
}

const columns=(v:ReturnType<typeof geometry>&{ok:true})=>({geometry:JSON.stringify(v.ring),vertex_count:v.ring.length,area_m2:v.areaM2,min_lat:v.bbox.minLat,max_lat:v.bbox.maxLat,min_lng:v.bbox.minLng,max_lng:v.bbox.maxLng});

async function assertNameFree(projectId:string,name:string,exceptId:string|null,conn:Conn){
 const clash=await one<{id:string}>("SELECT id FROM project_work_areas WHERE organisation_id=? AND project_id=? AND status='active' AND LOWER(name)=LOWER(?) AND id<>? LIMIT 1",[actor().organisationId,projectId,name,exceptId??''],conn);
 if(clash)fail(409,`An active work area or stage is already named “${name}”.`);
}

export async function createWorkArea(input:z.infer<typeof createInput>){
 const a=actor(),id=uuid();
 await tx(async conn=>{
  const p=await loadProject(input.projectId,conn,true);assertEditable(p);
  const n=await one<{n:number}>("SELECT COUNT(*) AS n FROM project_work_areas WHERE organisation_id=? AND project_id=? AND status='active'",[a.organisationId,input.projectId],conn);
  if(Number(n?.n)>=L.maxActivePerProject)fail(422,`A project can have at most ${L.maxActivePerProject} active work areas and stages. Archive some first.`);
  const g=geometry(input.ring) as ReturnType<typeof geometry>&{ok:true};
  await assertNameFree(input.projectId,input.name,null,conn);
  const c=columns(g),now=nowIso();
  await exec('INSERT INTO project_work_areas (id,organisation_id,project_id,name,kind,discipline,delivery,contractor_label,sequence,notes,geometry,vertex_count,area_m2,min_lat,max_lat,min_lng,max_lng,status,revision,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [id,a.organisationId,input.projectId,input.name,input.kind,input.discipline,input.delivery,input.delivery==='subcontracted'?input.contractorLabel:null,input.sequence,input.notes,c.geometry,c.vertex_count,c.area_m2,c.min_lat,c.max_lat,c.min_lng,c.max_lng,'active',1,a.userId,a.userId,now,now],conn);
  await audit({event:'workmap.area_created',entityType:'project_work_area',entityId:id,projectId:input.projectId,summary:`${input.kind==='stage'?'Stage':'Work area'} “${input.name}” drawn (${g.ring.length} points, ${Math.round(g.areaM2)} m²)`,after:{name:input.name,kind:input.kind,discipline:input.discipline,delivery:input.delivery,ring:g.ring}},conn);
 });
 return presentWorkArea((await one('SELECT * FROM project_work_areas WHERE organisation_id=? AND id=?',[a.organisationId,id]))!);
}

export async function updateWorkArea(input:z.infer<typeof updateInput>){
 const a=actor();
 await tx(async conn=>{
  const cur=await one('SELECT * FROM project_work_areas WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,input.id],conn);
  if(!cur)fail(404,'Work area not found.');
  const p=await loadProject(cur!.project_id,conn,true);assertEditable(p);
  if(Number(cur!.revision)!==input.revision)stale();
  if(cur!.status==='archived')fail(409,'This work area is archived and cannot be changed.');
  const now=nowIso(),set:Row={};let g:(ReturnType<typeof geometry>&{ok:true})|null=null;
  if(input.archive){
   set.status='archived';set.archived_at=now;set.archived_by=a.userId;
  }else{
   if(input.name!==undefined){await assertNameFree(cur!.project_id,input.name,cur!.id,conn);set.name=input.name;}
   for(const [k,c] of [['kind','kind'],['discipline','discipline'],['delivery','delivery'],['contractorLabel','contractor_label'],['sequence','sequence'],['notes','notes']] as const)if(input[k]!==undefined)set[c]=input[k];
   if((set.delivery??cur!.delivery)==='own')set.contractor_label=null;
   if(input.ring!==undefined){g=geometry(input.ring) as ReturnType<typeof geometry>&{ok:true};Object.assign(set,columns(g));}
  }
  if(!Object.keys(set).length)return;
  const cols=Object.keys(set);
  // The revision in the WHERE clause is the second guard (the row is also locked above).
  const r=await exec(`UPDATE project_work_areas SET ${cols.map(c=>`${c}=?`).join(',')},revision=revision+1,updated_by=?,updated_at=? WHERE organisation_id=? AND id=? AND revision=?`,[...cols.map(c=>set[c]),a.userId,now,a.organisationId,input.id,input.revision],conn);
  if(r<1)stale();
  await audit({event:input.archive?'workmap.area_archived':'workmap.area_updated',entityType:'project_work_area',entityId:input.id,projectId:cur!.project_id,summary:input.archive?`Work area “${cur!.name}” archived`:`Work area “${set.name??cur!.name}” updated${g?` (${g.ring.length} points, ${Math.round(g.areaM2)} m²)`:''}`,
   before:input.archive?{status:'active'}:{...Object.fromEntries(cols.filter(c=>c!=='geometry').map(c=>[c,cur![c]])),...(g?{ring:ringOf(cur!.geometry)}:{})},
   after:input.archive?{status:'archived'}:{...Object.fromEntries(cols.filter(c=>c!=='geometry').map(c=>[c,set[c]])),...(g?{ring:g.ring}:{})}},conn);
 });
 return presentWorkArea((await one('SELECT * FROM project_work_areas WHERE organisation_id=? AND id=?',[a.organisationId,input.id]))!);
}
export {WORK_MAP_DISCLAIMER};
