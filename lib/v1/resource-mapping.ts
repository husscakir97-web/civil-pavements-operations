// Deterministic mapping from legacy JSON-backed resource rows (workers, plant,
// shifts) to the typed columns added in migration 0004. Pure and dependency
// free: the same functions run in the one-off backfill (scripts/backfill-resources.mjs)
// and in the dual-write on every legacy save, so both produce identical rows.
// A value that cannot be mapped is never guessed: it is left NULL and reported
// as an issue (data_migration_issues). Legacy metadata is never modified here.

export type LegacyRow={id:string;name:string;status:string;metadata:string|Record<string,unknown>|null};
export type MappingIssue={field:string;issue:string;legacyValue:string|null};
export type CompetencyRow={competencyType:string;expiryDate:string|null};
export type AssignmentRow={resourceType:'worker'|'plant'|'crew'|'subcontractor'|'supplier';resourceId:string;role:string|null};

export const RESOURCE_MIGRATION='0004-resources';
export const LEGACY_GENERAL_COMPETENCY='General competency (legacy)';
export const RESOURCE_CATEGORIES={workers:'worker',plant:'plant',crews:'crew',subcontractors:'subcontractor',suppliers:'supplier'} as const;

const DATE=/^\d{4}-\d{2}-\d{2}$/,TIME=/^([01]\d|2[0-3]):[0-5]\d$/,EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseMeta(value:LegacyRow['metadata']):Record<string,unknown>{
 if(value&&typeof value==='object')return value;
 try{const v=JSON.parse(String(value||'{}'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}
}
const str=(v:unknown)=>v==null?'':typeof v==='string'?v.trim():typeof v==='number'||typeof v==='boolean'?String(v):'';
const raw=(v:unknown)=>v==null?null:typeof v==='string'?v:JSON.stringify(v);
export function validDate(v:string){if(!DATE.test(v))return false;const d=new Date(`${v}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;}

class Mapper{
 issues:MappingIssue[]=[];
 readonly meta:Record<string,unknown>;
 constructor(value:LegacyRow['metadata']){
  this.meta=parseMeta(value);
  if(typeof value==='string'&&value.trim()){
   let ok=false;try{const v=JSON.parse(value);ok=Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}catch{/* reported below */}
   if(!ok)this.issues.push({field:'metadata',issue:'Legacy details could not be read (invalid JSON); typed fields left blank.',legacyValue:value.slice(0,2000)});
  }
 }
 text(field:string,value:unknown,max:number){
  const s=str(value);if(!s)return null;
  if(s.length>max){this.issues.push({field,issue:`Longer than ${max} characters; truncated in the typed column (legacy value kept).`,legacyValue:s});return s.slice(0,max);}
  return s;
 }
 date(field:string,value:unknown){
  const s=str(value);if(!s)return null;
  if(validDate(s))return s;
  this.issues.push({field,issue:'Not a valid YYYY-MM-DD date; left blank.',legacyValue:raw(value)});return null;
 }
 time(field:string,value:unknown){
  const s=str(value);if(!s)return null;
  if(TIME.test(s))return s;
  this.issues.push({field,issue:'Not a valid HH:MM time; left blank.',legacyValue:raw(value)});return null;
 }
 money(field:string,value:unknown){
  const s=str(value);if(!s)return null;
  const n=Number(s);
  if(Number.isFinite(n)&&n>=0&&n<1e12)return (Math.round(n*100)/100).toFixed(2);
  this.issues.push({field,issue:'Not a non-negative number; left blank.',legacyValue:raw(value)});return null;
 }
}

const INACTIVE=['inactive','archived'];
export const isActiveStatus=(status:string)=>!INACTIVE.includes(String(status||'').trim().toLowerCase());

export function splitCompetencies(text:unknown):string[]{
 const seen=new Set<string>(),out:string[]=[];
 const parts=Array.isArray(text)?text.map(str):str(text).split(/[,;\n|]+/);
 for(const p of parts){const t=p.trim().replace(/\s+/g,' ').slice(0,160);if(t&&!seen.has(t.toLowerCase())){seen.add(t.toLowerCase());out.push(t);}}
 return out;
}

export function mapWorker(row:LegacyRow){
 const m=new Mapper(row.metadata),meta=m.meta;
 const name=str(row.name);
 if(!name)m.issues.push({field:'name',issue:'Worker has no name.',legacyValue:raw(row.name)});
 const [first,...rest]=name.split(/\s+/);
 let email=m.text('email',meta.email,254);
 if(email&&!EMAIL.test(email)){m.issues.push({field:'email',issue:'Not a valid email address; left blank.',legacyValue:email});email=null;}
 const columns={
  employee_number:m.text('employeeNumber',meta.employeeNumber??meta.employeeId,60),
  first_name:first?m.text('name',first,120):null,
  last_name:rest.length?m.text('name',rest.join(' '),120):null,
  email,
  phone:m.text('phone',meta.phone,60),
  role_title:m.text('trade',meta.trade??meta.role,120),
  employment_type:m.text('employmentType',meta.employmentType,30),
  user_id:m.text('userId',meta.userId,191),
  hourly_rate:m.money('rate',meta.rate),
  location:m.text('location',meta.location,255),
  active:isActiveStatus(row.status)?1:0,
 };
 const expiry=m.date('competencyExpiry',meta.competencyExpiry);
 const names=splitCompetencies(meta.competencies);
 const competencies:CompetencyRow[]=names.map(competencyType=>({competencyType,expiryDate:expiry}));
 if(!names.length&&expiry){
  competencies.push({competencyType:LEGACY_GENERAL_COMPETENCY,expiryDate:expiry});
  m.issues.push({field:'competencies',issue:'An expiry date was recorded without a named competency; kept as "General competency (legacy)". Record the actual competency.',legacyValue:expiry});
 }
 if(names.length>1&&expiry)m.issues.push({field:'competencyExpiry',issue:`The legacy record held one earliest expiry for ${names.length} competencies; it was applied to each. Confirm the individual expiry dates.`,legacyValue:expiry});
 return {columns,competencies,issues:m.issues};
}

export function mapPlant(row:LegacyRow){
 const m=new Mapper(row.metadata),meta=m.meta;
 if(!str(row.name))m.issues.push({field:'name',issue:'Plant item has no name.',legacyValue:raw(row.name)});
 const ownership=str(meta.ownership).toLowerCase();
 const columns={
  plant_number:m.text('plantNumber',meta.plantNumber??meta.assetId,60),
  registration:m.text('rego',meta.rego??meta.registration,40),
  category:m.text('type',meta.type??meta.category,80),
  description:m.text('description',meta.description,255),
  make:m.text('make',meta.make,80),
  model:m.text('model',meta.model,80),
  ownership:['owned','hired','leased'].includes(ownership)?ownership:null,
  hourly_rate:m.money('hourlyRate',meta.hourlyRate??meta.rate),
  day_rate:m.money('dayRate',meta.dayRate),
  compliance_expiry:m.date('complianceExpiry',meta.complianceExpiry??meta.registrationExpiry??meta.regoExpiry),
  location:m.text('location',meta.location,255),
  active:isActiveStatus(row.status)?1:0,
 };
 if(ownership&&!columns.ownership)m.issues.push({field:'ownership',issue:'Ownership must be owned, hired or leased; left blank.',legacyValue:ownership});
 return {columns,issues:m.issues};
}

/** `resources` maps a legacy resource id to its category table key (workers, plant, ...). */
export function mapShift(row:LegacyRow,known:{jobIds:Set<string>;resources:Map<string,string>}){
 const m=new Mapper(row.metadata),meta=m.meta;
 const jobId=str(meta.jobId);
 let projectId:string|null=null;
 if(!jobId)m.issues.push({field:'jobId',issue:'Shift is not linked to a job.',legacyValue:null});
 else if(!known.jobIds.has(jobId))m.issues.push({field:'jobId',issue:'Shift references a job that does not exist in this organisation.',legacyValue:jobId});
 else projectId=jobId;
 const required=Array.isArray(meta.requiredCompetencies)||typeof meta.requiredCompetencies==='string'?splitCompetencies(meta.requiredCompetencies):[];
 const columns={
  project_id:projectId,
  shift_date:m.date('date',meta.date),
  start_time:m.time('start',meta.start),
  finish_time:m.time('finish',meta.finish),
  activity:m.text('scope',meta.scope??meta.activity,255),
  supervisor_name:m.text('supervisor',meta.supervisor,160),
  supervisor_user_id:m.text('supervisorUserId',meta.supervisorUserId,191),
  location:m.text('location',meta.location,255),
  instructions:str(meta.instructions)||null,
  required_competencies:required.length?JSON.stringify(required):null,
 };
 const assignments:AssignmentRow[]=[],seen=new Set<string>();
 const list=Array.isArray(meta.assignments)?meta.assignments as Record<string,unknown>[]:[];
 list.forEach((a,i)=>{
  const id=str(a?.resourceId),category=str(a?.category);
  const type=(RESOURCE_CATEGORIES as Record<string,AssignmentRow['resourceType']>)[category];
  if(!id||!type){m.issues.push({field:`assignments[${i}]`,issue:'Assignment has no resource or an unknown category.',legacyValue:raw(a)});return;}
  if(known.resources.get(id)!==category){m.issues.push({field:`assignments[${i}]`,issue:`Assignment references a ${category} record that no longer exists.`,legacyValue:raw(a)});return;}
  const key=`${type}:${id}`;if(seen.has(key))return;seen.add(key);
  assignments.push({resourceType:type,resourceId:id,role:str(a.role).slice(0,80)||null});
 });
 return {columns,assignments,issues:m.issues};
}
