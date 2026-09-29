// Which shifts a person's Today/Home shows. One rule set for /api/field/today and the Home seam:
//  - field workers: shifts they are assigned to or supervise (unchanged);
//  - project-scoped roles (Project/Site Engineer): assigned, supervising, or on one of their projects;
//  - organisation-wide roles: every shift (they dispatch from Schedule; Today is not a substitute).
import {can} from './permissions';
import {query} from './sql';
import {orgWideProjects,memberProjectIds} from './project-access';

type Who={organisationId:string;userId:string;role:string};
export type ShiftAudience={mode:'assigned'|'projects'|'all';userId:string;workerIds:string[];projectIds:Set<string>};
type ShiftLike={supervisorUserId?:unknown;assignments?:unknown;jobId?:unknown};

export async function shiftAudience(a:Who):Promise<ShiftAudience>{
 const field=!can(a.role,'project.view');
 const mode=field?'assigned':orgWideProjects(a)?'all':'projects';
 const workerIds=(await query<{id:string}>("SELECT id FROM workers WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.userId'))=?",[a.organisationId,a.userId])).map(w=>w.id);
 const projectIds=new Set(mode==='projects'?await memberProjectIds(a):[]);
 return {mode,userId:a.userId,workerIds,projectIds};
}
/** Directly assigned (as a user or via their linked worker record) or the shift supervisor. */
export function assignedToShift(aud:ShiftAudience,s:ShiftLike){
 const list=Array.isArray(s.assignments)?s.assignments as Array<Record<string,unknown>>:[];
 return s.supervisorUserId===aud.userId||list.some(x=>x.userId===aud.userId||aud.workerIds.includes(String(x.resourceId)));
}
export function shiftVisible(aud:ShiftAudience,s:ShiftLike){
 if(aud.mode==='all')return true;
 if(assignedToShift(aud,s))return true;
 return aud.mode==='projects'&&Boolean(s.jobId)&&aud.projectIds.has(String(s.jobId));
}
