// Deterministic scheduling conflict engine. Pure evaluation (evaluateShift) plus a
// portable loader over the typed resource tables (migration 0004). Resources not yet
// synced from legacy metadata are mapped on the fly with the same deterministic
// mapping as the backfill, so the result never depends on backfill timing.
//
// Severity: `block` conflicts stop a shift being saved as Planned / Ready / In Progress;
// Draft shifts may be saved with blocks shown. `warn` conflicts never block.
import type {Database} from '@/lib/platform/database';
import {mapWorker,mapPlant,parseMeta,splitCompetencies,isActiveStatus,RESOURCE_CATEGORIES,type LegacyRow} from '@/lib/v1/resource-mapping';

export type Severity='block'|'warn';
export type Conflict={code:string;severity:Severity;resourceId?:string;message:string};
export type ResourceInfo={id:string;type:string;name:string;status:string;active:boolean;complianceExpiry?:string|null;competencies?:Array<{type:string;expiryDate:string|null;status:string}>};
export type ShiftWindow={id:string;name:string;status:string;date:string|null;start:string|null;finish:string|null;assignments:Array<{resourceType:string;resourceId:string}>};
export type ShiftInput=ShiftWindow&{requiredCompetencies:string[];assignmentNames?:Record<string,string>};

export const ENFORCED_STATUSES=['Planned','Ready','In Progress'];
const IGNORED_STATUSES=['Cancelled','Stand-down','Archived'];
const UNAVAILABLE=['leave','maintenance','out of service','unavailable'];

export function window(s:{date:string|null;start:string|null;finish:string|null}):[number,number]|null{
 if(!s.date||!s.start||!s.finish)return null;
 const start=Date.parse(`${s.date}T${s.start}:00Z`);let finish=Date.parse(`${s.date}T${s.finish}:00Z`);
 if(!Number.isFinite(start)||!Number.isFinite(finish))return null;
 if(finish<=start)finish+=86400000;
 return [start,finish];
}

export function evaluateShift(shift:ShiftInput,resources:Map<string,ResourceInfo>,others:ShiftWindow[]):Conflict[]{
 if(IGNORED_STATUSES.includes(shift.status))return [];
 const out:Conflict[]=[];
 const w=window(shift),date=shift.date||'';
 const required=shift.requiredCompetencies.map(c=>c.toLowerCase());
 for(const a of shift.assignments){
  const r=resources.get(`${a.resourceType}:${a.resourceId}`);
  const label=r?.name||shift.assignmentNames?.[a.resourceId]||a.resourceId;
  if(!r){out.push({code:'RESOURCE_MISSING',severity:'block',resourceId:a.resourceId,message:`${label}: this ${a.resourceType} record no longer exists.`});continue;}
  if(!r.active)out.push({code:'RESOURCE_INACTIVE',severity:'block',resourceId:r.id,message:`${label} is inactive.`});
  else if(UNAVAILABLE.includes(r.status.toLowerCase()))out.push({code:'RESOURCE_UNAVAILABLE',severity:'block',resourceId:r.id,message:`${label} is ${r.status}.`});
  if(r.type==='worker'){
   const held=(r.competencies||[]).filter(c=>c.status==='current');
   for(const need of required){
    const c=held.find(h=>h.type.toLowerCase()===need);
    if(!c)out.push({code:'COMPETENCY_MISSING',severity:'block',resourceId:r.id,message:`${label} does not hold the required competency "${shift.requiredCompetencies[required.indexOf(need)]}".`});
    else if(c.expiryDate&&date&&c.expiryDate<date)out.push({code:'COMPETENCY_EXPIRED',severity:'block',resourceId:r.id,message:`${label}: required competency "${c.type}" expired ${c.expiryDate}.`});
   }
   for(const c of held)if(!required.includes(c.type.toLowerCase())&&c.expiryDate&&date&&c.expiryDate<date)
    out.push({code:'COMPETENCY_EXPIRED_OTHER',severity:'warn',resourceId:r.id,message:`${label}: ${c.type} expired ${c.expiryDate}.`});
  }
  if(r.type==='plant'){
   if(!r.complianceExpiry)out.push({code:'PLANT_COMPLIANCE_UNKNOWN',severity:'warn',resourceId:r.id,message:`${label}: registration / compliance expiry not recorded.`});
   else if(date&&r.complianceExpiry<date)out.push({code:'PLANT_COMPLIANCE_EXPIRED',severity:'block',resourceId:r.id,message:`${label}: compliance expired ${r.complianceExpiry}.`});
  }
  if(w&&(a.resourceType==='worker'||a.resourceType==='plant')){
   for(const o of others){
    if(o.id===shift.id||IGNORED_STATUSES.includes(o.status))continue;
    const ow=window(o);if(!ow||!(w[0]<ow[1]&&w[1]>ow[0]))continue;
    if(!o.assignments.some(b=>b.resourceType===a.resourceType&&b.resourceId===a.resourceId))continue;
    const tentative=o.status==='Draft';
    out.push({code:a.resourceType==='worker'?'WORKER_DOUBLE_BOOKED':'PLANT_DOUBLE_BOOKED',severity:tentative?'warn':'block',resourceId:a.resourceId,message:`${label} is already booked on ${o.name} (${o.date} ${o.start}–${o.finish}${tentative?', draft':''}).`});
   }
  }
 }
 const seen=new Set<string>();
 return out.filter(c=>{const k=`${c.code}:${c.resourceId}:${c.message}`;if(seen.has(k))return false;seen.add(k);return true;});
}

export const blocking=(status:string,conflicts:Conflict[])=>ENFORCED_STATUSES.includes(status)?conflicts.filter(c=>c.severity==='block'):[];

type Legacy=LegacyRow&{active?:number|null;legacy_synced_at?:string|null;compliance_expiry?:string|null};
/** Loads the resources referenced by `ids` (typed where synced, mapped where not). Portable SQL. */
export async function loadResources(db:Database,org:string,ids:Array<{resourceType:string;resourceId:string}>){
 const out=new Map<string,ResourceInfo>();
 const byType=new Map<string,string[]>();
 for(const a of ids)byType.set(a.resourceType,[...(byType.get(a.resourceType)||[]),a.resourceId]);
 const tableOf=Object.fromEntries(Object.entries(RESOURCE_CATEGORIES).map(([table,type])=>[type,table]));
 for(const [type,list] of byType){
  const table=tableOf[type];if(!table||!list.length)continue;
  const unique=[...new Set(list)],marks=unique.map(()=>'?').join(',');
  const cols=type==='worker'?',active,legacy_synced_at':type==='plant'?',active,legacy_synced_at,compliance_expiry':'';
  const rows=(await db.prepare(`SELECT id,name,status,metadata${cols} FROM ${table} WHERE organisation_id=? AND id IN (${marks})`).bind(org,...unique).all<Legacy>()).results;
  const comps=type==='worker'&&rows.length?(await db.prepare(`SELECT worker_id,competency_type,expiry_date,status FROM worker_competencies WHERE organisation_id=? AND worker_id IN (${rows.map(()=>'?').join(',')})`).bind(org,...rows.map(r=>r.id)).all<{worker_id:string;competency_type:string;expiry_date:string|null;status:string}>()).results:[];
  for(const r of rows){
   const info:ResourceInfo={id:r.id,type,name:r.name,status:r.status,active:isActiveStatus(r.status)};
   if(type==='worker'){
    if(r.legacy_synced_at){info.active=Boolean(Number(r.active))&&info.active;info.competencies=comps.filter(c=>c.worker_id===r.id).map(c=>({type:c.competency_type,expiryDate:c.expiry_date,status:c.status}));}
    else info.competencies=mapWorker(r).competencies.map(c=>({type:c.competencyType,expiryDate:c.expiryDate,status:'current'}));
   }
   if(type==='plant'){
    if(r.legacy_synced_at){info.active=Boolean(Number(r.active))&&info.active;info.complianceExpiry=r.compliance_expiry??null;}
    else info.complianceExpiry=mapPlant(r).columns.compliance_expiry;
   }
   out.set(`${type}:${r.id}`,info);
  }
 }
 return out;
}

/** Legacy shift row → engine input. `assignments` come from the planner's metadata. */
export function shiftInput(row:LegacyRow):ShiftInput{
 const m=parseMeta(row.metadata);
 const list=Array.isArray(m.assignments)?m.assignments as Array<Record<string,unknown>>:[];
 const assignments=list.map(a=>({resourceType:(RESOURCE_CATEGORIES as Record<string,string>)[String(a.category)]||String(a.category),resourceId:String(a.resourceId||'')})).filter(a=>a.resourceId);
 return {id:row.id,name:row.name,status:row.status,date:typeof m.date==='string'?m.date:null,start:typeof m.start==='string'?m.start:null,finish:typeof m.finish==='string'?m.finish:null,
  assignments,requiredCompetencies:splitCompetencies(m.requiredCompetencies),assignmentNames:Object.fromEntries(list.map(a=>[String(a.resourceId),String(a.name||'')]))};
}

/** Other shifts that may overlap (same or adjacent day) with their assignments. */
export async function loadNearbyShifts(db:Database,org:string,date:string|null):Promise<ShiftWindow[]>{
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
 const day=Date.parse(`${date}T00:00:00Z`),iso=(d:number)=>new Date(d).toISOString().slice(0,10);
 const rows=(await db.prepare("SELECT id,name,status,metadata FROM shifts WHERE organisation_id=? AND (shift_date IN (?,?,?) OR (shift_date IS NULL AND legacy_synced_at IS NULL))").bind(org,iso(day-86400000),date,iso(day+86400000)).all<LegacyRow>()).results;
 return rows.map(shiftInput).filter(s=>s.date&&Math.abs(Date.parse(`${s.date}T00:00:00Z`)-day)<=86400000);
}
