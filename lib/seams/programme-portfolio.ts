// Read-only aggregation. Project access is established before loading any programme data.
import {query} from '@/lib/platform/sql';
import {database} from '@/lib/platform/database';
import {projectScope} from '@/lib/platform/project-access';
import {can} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {fail} from '@/lib/platform/http';
import type {Actor} from '@/lib/authz';
import {addDays,orderActivities,projectProgram,responsibleUserId,type Activity} from '@/lib/v1/program';
import {parseMeta,type LegacyRow} from '@/lib/v1/resource-mapping';
import {coverage,requirementsInput} from '@/lib/v1/shift-requirements';
import {evaluateShift,loadResources,organisationToday,shiftInput,window,type ShiftInput} from '@/lib/modules/operations/conflicts';

export const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const validTime=(s:string|null)=>s!==null&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
type Project={id:string;name:string;business_unit_id:string|null;status:string};
type Division={id:string;name:string;is_default:number};
type ProgrammeActivity=Activity&{project_id:string;sequence:number|null;responsible:string};
type Member={project_id:string;user_id:string;name:string|null};
export type PortfolioShift=LegacyRow&{project_id:string|null;shift_date:string|null;start_time:string|null;finish_time:string|null};

/** Conflicting project identities are excluded, even when both projects are accessible. */
export function portfolioShift(row:PortfolioShift,allowed:Set<string>){
 const m=parseMeta(row.metadata),legacy=typeof m.jobId==='string'?m.jobId:null;
 if(m.jobId!=null&&typeof m.jobId!=='string')return null;
 if(row.project_id&&legacy&&row.project_id!==legacy)return null;
 const projectId=row.project_id||legacy;
 if(!projectId||!allowed.has(projectId))return null;
 const raw=(Array.isArray(m.assignments)?m.assignments:[]).filter((a):a is Record<string,unknown>=>a!==null&&typeof a==='object');
 const input=shiftInput({...row,metadata:{...m,assignments:raw}});
 input.date=row.shift_date??input.date;input.start=row.start_time??input.start;input.finish=row.finish_time??input.finish;
 input.assignments=[...new Map(input.assignments.map(a=>[`${a.resourceType}:${a.resourceId}`,a])).values()];
 const dated=Boolean(input.date&&validDate(input.date)&&validTime(input.start)&&validTime(input.finish));
 if(!dated){input.date=null;input.start=null;input.finish=null;}
 const requirements=requirementsInput.safeParse(m.requirements);
 // The existing coverage engine uses resourceId as identity. Namespace it by type,
 // and deduplicate before passing it in: assignment-row IDs are not identities.
 const assigned=[...new Map(raw.filter(a=>typeof a.resourceId==='string'&&a.resourceId).map(a=>{
  const category=String(a.category),resourceId=`${category}:${a.resourceId}`;
  return [resourceId,{category,resourceId,role:String(a.role||'')}] as const;
 })).values()];
 const shortage=requirements.success?coverage(requirements.data,assigned).reduce((n,r)=>n+r.missing,0):null;
 return {projectId,input,shortage,dated};
}
export function inPortfolioWindow(input:ShiftInput,start:string,endExclusive:string){
 const w=window(input);return Boolean(w&&w[0]<Date.parse(endExclusive+'T00:00:00Z')&&w[1]>Date.parse(start+'T00:00:00Z'));
}

export async function programmePortfolio(actor:Actor,params:URLSearchParams){
 // Defence in depth: orgWideProjects alone deliberately allows some field roles.
 if(!can(actor.role,'project.view'))fail(403,'You are not authorised for this action.');
 const scope=await projectScope(actor),org=actor.organisationId;
 const today=await organisationToday(database,org),start=params.get('start')??today;
 if(!validDate(start)||start<'0001-01-01'||start>'9999-12-17')fail(400,'Enter a valid start date.');
 const endExclusive=addDays(start,14),end=addDays(start,13);
 const projects=scope?.length===0?[]:await query<Project>(`SELECT id,name,business_unit_id,status FROM jobs WHERE organisation_id=?${scope?' AND id IN (?)':''} ORDER BY name`,scope?[org,scope]:[org]);
 const ids=projects.map(p=>p.id),allowed=new Set(ids);
 const operations=can(actor.role,'schedule.view')&&usable(await getEntitlements(org),'operations');
 const divisions=ids.length?await query<Division>('SELECT id,name,is_default FROM business_units WHERE organisation_id=? ORDER BY sort_order,name',[org]):[];
 const defaultDivision=divisions.find(d=>Number(d.is_default)===1);
 const [activities,members,shiftRows]=ids.length?await Promise.all([
  query<ProgrammeActivity>('SELECT id,project_id,name,start_date,duration_days,predecessor_id,status,sequence,responsible FROM program_activities WHERE organisation_id=? AND project_id IN (?)',[org,ids]),
  query<Member>('SELECT m.project_id,m.user_id,u.name FROM project_members m JOIN users u ON u.id=m.user_id AND u.organisation_id=m.organisation_id WHERE m.organisation_id=? AND m.project_id IN (?) AND m.active=1',[org,ids]),
  operations?query<PortfolioShift>(`SELECT id,name,status,project_id,shift_date,start_time,finish_time,metadata FROM shifts WHERE organisation_id=? AND (project_id IN (?) OR (project_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(metadata) THEN metadata ELSE '{}' END,'$.jobId')) IN (?)))`,[org,ids,ids]):Promise.resolve([]),
 ]):[[],[],[]];
 const shifts=shiftRows.map(r=>portfolioShift(r,allowed)).filter((r):r is NonNullable<typeof r>=>r!==null);
 const relevant=shifts.filter(s=>!s.dated||inPortfolioWindow(s.input,start,endExclusive));
 const resources=operations?await loadResources(database,org,relevant.flatMap(s=>s.input.assignments)):new Map();
 // All accessible divisions participate in evaluation before either display filter.
 const shiftDtos=relevant.map(s=>{
  const conflicts=evaluateShift(s.input,resources,shifts.filter(x=>x.dated).map(x=>x.input),{today});
  const issues=[...new Map(conflicts.map(c=>[`${c.code}:${c.severity}`,{code:c.code,severity:c.severity}])).values()];
  return {id:s.input.id,projectId:s.projectId,name:s.input.name,status:s.input.status,date:s.input.date,start:s.input.start,finish:s.input.finish,assignmentCount:s.input.assignments.length,shortage:s.shortage,issues};
 });
 // Archived projects need not display, but their still-live bookings must participate.
 const allProjects=projects.filter(p=>String(p.status).toLowerCase()!=='archived').map(p=>{
  const division=divisions.find(d=>d.id===(p.business_unit_id??defaultDivision?.id));
  const team=new Map(members.filter(m=>m.project_id===p.id).map(m=>[m.user_id,m.name]));
  let programmeIssue=false;
  let rows:ReturnType<typeof projectProgram<ProgrammeActivity>>=[];
  try{
   const all=activities.filter(a=>a.project_id===p.id);
   if(all.some(a=>!validDate(a.start_date)||!Number.isInteger(Number(a.duration_days))||Number(a.duration_days)<1))throw new Error('Invalid programme');
   rows=projectProgram(orderActivities(all));
  }catch{programmeIssue=true;}
  const present=(a:typeof rows[number])=>({id:a.id,name:a.name,start:a.start,finish:a.finish,status:a.status,responsibleName:team.get(responsibleUserId(a.responsible)??'')||null});
  const upcoming=rows.filter(a=>a.finish>=start&&a.start<endExclusive).map(present);
  const overdue=rows.filter(a=>a.finish<today&&a.status!=='complete').map(present);
  const projectShifts=shiftDtos.filter(s=>s.projectId===p.id);
  return {id:p.id,name:p.name,divisionId:division?.id??'unresolved',divisionName:division?.name??'Unresolved division',activities:upcoming,overdue,programmeIssue,shifts:operations?projectShifts:null,noShiftsMessage:operations&&upcoming.length&&!projectShifts.some(s=>s.date)?'Upcoming activities; no shifts in this window':null};
 });
 const projectFilter=params.get('projectId'),divisionFilter=params.get('divisionId');
 const visible=allProjects.filter(p=>(!projectFilter||p.id===projectFilter)&&(!divisionFilter||p.divisionId===divisionFilter));
 return {start,end,operations,coverage:scope===null?'All authorised projects':'Limited to your accessible projects; conflicts outside this scope are not assessed',divisions:[...new Map(allProjects.map(p=>[p.divisionId,{id:p.divisionId,name:p.divisionName}])).values()],projects:visible,counts:{projects:visible.length,activities:visible.reduce((n,p)=>n+p.activities.length,0),shifts:operations?visible.reduce((n,p)=>n+(p.shifts?.filter(s=>s.date).length??0),0):null}};
}
export type ProgrammePortfolio=Awaited<ReturnType<typeof programmePortfolio>>;
