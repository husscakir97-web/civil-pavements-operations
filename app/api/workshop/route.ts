import {api,body} from '@/lib/platform/http';
import {overview,mutate,workshopAction} from '@/lib/modules/workshop/workshop';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'workshop',capability:'workshop.view'},async()=>overview());
export const POST=api({permission:'write',module:'workshop'},async({request})=>mutate(await body(request,workshopAction)));
