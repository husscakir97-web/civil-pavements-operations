import {api,body} from '@/lib/platform/http';
import {getWorkMap,createWorkArea,updateWorkArea,createInput,updateInput} from '@/lib/modules/projects/work-areas';
export const dynamic='force-dynamic';
// Reads need project.view; writes need project.edit (checked again in the service). Both are module-gated and project-scoped.
export const GET=api({permission:'read',module:'projects',capability:'project.view'},async({params})=>getWorkMap(String(params.get('projectId')||''),params.get('archived')==='1'));
export const POST=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>{const area=await createWorkArea(await body(request,createInput));return Response.json({area},{status:201,headers:{'Cache-Control':'private, no-store'}});});
export const PATCH=api({permission:'write',module:'projects',capability:'project.edit'},async({request})=>({area:await updateWorkArea(await body(request,updateInput))}));
