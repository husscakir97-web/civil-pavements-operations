import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {confirmWorkPoint} from '@/lib/modules/projects/work-areas';
export const dynamic='force-dynamic';
// Explicit confirmation of the project's current location as the work point (needs project.edit, an open project, the Projects module).
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>confirmWorkPoint((await body(request,z.object({projectId:z.string().min(1).max(191)}).strict())).projectId));
