// Project scope: the application role says what someone may do; project membership
// says where. Roles holding 'project.all.view' work across the organisation (unchanged
// behaviour). Others (Project Engineer, Site Engineer) are limited to projects where
// they are an active member of the project team, or the recorded project manager.
import {actorContext} from './context';
import {can} from './permissions';
import {fail} from './http';
import {query,one,type Conn} from './sql';

type Who={organisationId:string;userId:string;role:string};
const who=(a?:Who)=>a??actorContext.getStore()!;

export {PROJECT_ROLES,type ProjectRole} from '@/lib/v1/project-roles';

/**
 * True when membership does not narrow this actor's projects: roles with 'project.all.view', and
 * roles without project access at all (field workers keep their assigned-shift rules unchanged).
 */
export const orgWideProjects=(a?:Who)=>{const r=who(a).role;return can(r,'project.all.view')||!can(r,'project.view');};

/** Project ids the user belongs to (active membership, or recorded project manager). Always organisation-scoped. */
export async function memberProjectIds(a?:Who,conn?:Conn):Promise<string[]>{
 const x=who(a);
 const rows=await query<{id:string}>("SELECT project_id AS id FROM project_members WHERE organisation_id=? AND user_id=? AND active=1 UNION SELECT id FROM jobs WHERE organisation_id=? AND project_manager_user_id=?",[x.organisationId,x.userId,x.organisationId,x.userId],conn);
 return rows.map(r=>r.id);
}
/** null = no project restriction; otherwise the allowed project ids (possibly empty). */
export async function projectScope(a?:Who,conn?:Conn):Promise<string[]|null>{
 return orgWideProjects(a)?null:memberProjectIds(a,conn);
}
export async function canAccessProject(projectId:string|null|undefined,a?:Who,conn?:Conn):Promise<boolean>{
 if(!projectId||orgWideProjects(a))return true;
 const x=who(a);
 return Boolean(await one("SELECT 1 AS ok FROM project_members WHERE organisation_id=? AND project_id=? AND user_id=? AND active=1 UNION SELECT 1 FROM jobs WHERE organisation_id=? AND id=? AND project_manager_user_id=? LIMIT 1",[x.organisationId,projectId,x.userId,x.organisationId,projectId,x.userId],conn));
}
/** 404 (not 403) so a guessed id reveals nothing about other projects. */
export async function assertProjectAccess(projectId:string|null|undefined,conn?:Conn){
 if(!await canAccessProject(projectId,undefined,conn))fail(404,'Project not found.');
}
/**
 * SQL fragment restricting a project id column to the actor's scope (params appended).
 * `allowNull` keeps organisation-level rows (no project) visible, e.g. company HSEQ actions.
 */
export async function projectFilter(column:string,params:unknown[],{allowNull=false}:{allowNull?:boolean}={},conn?:Conn):Promise<string>{
 const scope=await projectScope(undefined,conn);
 if(!scope)return '';
 params.push(scope.length?scope:['-']);
 return allowNull?` AND (${column} IS NULL OR ${column} IN (?))`:` AND ${column} IN (?)`;
}
