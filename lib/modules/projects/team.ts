// Project team: assigns existing organisation users to a project with a project role.
// Assignment only — people records stay in users/workers; no HR data here.
import {actorContext} from '@/lib/platform/context';
import {can,roleLabel} from '@/lib/platform/permissions';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {query,one,exec,tx,nowIso,uuid} from '@/lib/platform/sql';
import {PROJECT_ROLES,type ProjectRole} from '@/lib/v1/project-roles';
import {loadProject} from './projects';

const actor=()=>actorContext.getStore()!;
/** Organisation-wide project managers (project.edit + project.all.view) manage teams; engineers work within them. */
export const canManageTeam=(role:string)=>can(role,'project.edit')&&can(role,'project.all.view');

export async function projectTeam(projectId:string){
 const a=actor();await loadProject(projectId);
 const members=await query("SELECT m.id,m.user_id,m.project_role,m.revision,m.created_at,u.name,u.email,u.role FROM project_members m JOIN users u ON u.id=m.user_id AND u.organisation_id=m.organisation_id WHERE m.organisation_id=? AND m.project_id=? AND m.active=1 ORDER BY FIELD(m.project_role,?),u.name",[a.organisationId,projectId,[...PROJECT_ROLES]]);
 const manage=canManageTeam(a.role);
 const people=manage?await query("SELECT id,name,email,role FROM users WHERE organisation_id=? AND COALESCE(active,1)=1 ORDER BY name,email",[a.organisationId]):[];
 return {canManage:manage,members:members.map(m=>({id:m.id,userId:m.user_id,projectRole:m.project_role as ProjectRole,name:m.name||m.email,email:m.email,appRole:roleLabel(String(m.role)),revision:Number(m.revision)})),people:people.map(p=>({id:p.id,name:p.name||p.email,email:p.email,appRole:roleLabel(String(p.role))}))};
}

export async function assignMember(projectId:string,userId:string,projectRole:ProjectRole){
 const a=actor();if(!canManageTeam(a.role))fail(403,'You are not authorised to change the project team.');
 if(!PROJECT_ROLES.includes(projectRole))fail(400,'Choose a project role.');
 await tx(async conn=>{
  await loadProject(projectId,conn,true);
  const user=await one('SELECT id,name,email FROM users WHERE organisation_id=? AND id=?',[a.organisationId,userId],conn);
  if(!user)fail(400,'Choose a member of your organisation.');
  const now=nowIso(),existing=await one('SELECT id,active,project_role FROM project_members WHERE organisation_id=? AND project_id=? AND user_id=? FOR UPDATE',[a.organisationId,projectId,userId],conn);
  if(existing)await exec('UPDATE project_members SET project_role=?,active=1,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[projectRole,now,a.organisationId,existing.id],conn);
  else await exec('INSERT INTO project_members (id,organisation_id,project_id,user_id,project_role,active,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?,?)',[uuid(),a.organisationId,projectId,userId,projectRole,a.userId,now,now],conn);
  await audit({event:'project.team.assigned',entityType:'project',entityId:projectId,projectId,summary:`${user!.name||user!.email} assigned as ${projectRole.replace('_',' ')}`,before:existing?{projectRole:existing.project_role,active:Number(existing.active)}:null,after:{userId,projectRole}},conn);
 });
 return projectTeam(projectId);
}

export async function removeMember(projectId:string,memberId:string){
 const a=actor();if(!canManageTeam(a.role))fail(403,'You are not authorised to change the project team.');
 await tx(async conn=>{
  await loadProject(projectId,conn,true);
  const m=await one('SELECT id,user_id,project_role FROM project_members WHERE organisation_id=? AND project_id=? AND id=? AND active=1 FOR UPDATE',[a.organisationId,projectId,memberId],conn);
  if(!m)fail(404,'Team member not found.');
  // Deactivated, not deleted: the assignment history stays with the project.
  await exec('UPDATE project_members SET active=0,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?',[nowIso(),a.organisationId,memberId],conn);
  await audit({event:'project.team.removed',entityType:'project',entityId:projectId,projectId,summary:`Removed ${String(m!.project_role).replace('_',' ')} from the project team`,before:{userId:m!.user_id,projectRole:m!.project_role}},conn);
 });
 return projectTeam(projectId);
}
