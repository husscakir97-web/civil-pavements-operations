import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {projectTeam,assignMember,removeMember} from '@/lib/modules/projects/team';
import {PROJECT_ROLES} from '@/lib/v1/project-roles';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({params})=>projectTeam(String(params.get('projectId')||'')));
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>{const b=await body(request,z.object({projectId:z.string().min(1).max(191),userId:z.string().min(1).max(191),projectRole:z.enum(PROJECT_ROLES)}));return assignMember(b.projectId,b.userId,b.projectRole);});
export const DELETE=api({permission:'write',module:'projects',capability:'project.edit'},async({params})=>removeMember(String(params.get('projectId')||''),String(params.get('id')||'')));
