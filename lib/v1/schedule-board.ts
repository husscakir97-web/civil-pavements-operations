import type {Assignment,DeliveryRecord} from '@/lib/planning';
import type {Requirement} from '@/lib/v1/shift-requirements';

export type AvailabilityTone='ok'|'warn'|'block'|'unknown';
export type ResourceAvailability={tone:AvailabilityTone;text:string};

const lower=(v:unknown)=>String(v??'').trim().toLowerCase();

/** Deterministic default role for a quick assignment. The full editor can refine it later. */
export function defaultAssignmentRole(resource:DeliveryRecord,category:string){
 if(category==='plant')return String(resource.metadata.type||resource.metadata.category||'Other plant');
 if(category==='workers')return String(resource.metadata.roleTitle||resource.metadata.trade||'Worker');
 if(category==='crews')return String(resource.metadata.role||'Crew');
 if(category==='suppliers')return 'Supplier';
 if(category==='subcontractors')return 'Subcontractor';
 return 'Resource';
}

export function quickAssignment(resource:DeliveryRecord,category:string):Assignment{
 return {
  resourceId:resource.id,
  category,
  name:resource.name,
  role:defaultAssignmentRole(resource,category),
  hours:8,
  rate:Number(resource.metadata.hourlyRate||resource.metadata.rate||0),
  payload:Number(resource.metadata.payload||0),
  trips:0,
 };
}

/**
 * Prioritise candidates for the selected shift:
 *  - resources that satisfy a currently missing requirement first;
 *  - available before warnings before blocks;
 *  - stable alphabetical fallback.
 * This is a suggestion order only. The server conflict engine remains authoritative.
 */
export function rankResources(
 resources:DeliveryRecord[],
 category:string,
 requirements:Requirement[],
 assigned:Assignment[],
 availability:Record<string,ResourceAvailability|undefined>,
){
 const assignedIds=new Set(assigned.map(a=>a.resourceId));
 const missing=requirements.filter(r=>r.category===category&&assigned.filter(a=>a.category===category&&(!r.role||lower(a.role)===lower(r.role))).length<r.quantity);
 const score=(r:DeliveryRecord)=>{
  const role=lower(defaultAssignmentRole(r,category));
  const fit=missing.some(m=>!m.role||lower(m.role)===role)?0:1;
  const tone=availability[r.id]?.tone;
  const avail=tone==='ok'?0:tone==='unknown'||!tone?1:tone==='warn'?2:3;
  return [assignedIds.has(r.id)?1:0,fit,avail,r.name.toLowerCase()] as const;
 };
 return [...resources].sort((a,b)=>{
  const aa=score(a),bb=score(b);
  return aa[0]-bb[0]||aa[1]-bb[1]||aa[2]-bb[2]||String(aa[3]).localeCompare(String(bb[3]));
 });
}

export function requirementLabel(r:Requirement){
 return [r.quantity,r.role||r.category].filter(Boolean).join(' × ');
}
