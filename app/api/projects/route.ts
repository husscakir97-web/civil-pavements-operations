import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {listProjects,createProject} from '@/lib/modules/projects/projects';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async()=>({projects:await listProjects()}));
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>Response.json(await createProject(await body(request,z.object({name:z.string().trim().min(1).max(255),clientName:z.string().max(255).nullable().optional(),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(()=>null)),siteAddress:z.string().max(2000).nullable().optional()}))),{status:201}));
