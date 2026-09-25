import {api,body} from '@/lib/platform/http';
import {listTenders,createTender} from '@/lib/modules/pipeline/tenders';
import {tenderInput} from '@/lib/modules/pipeline/schemas';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'pipeline',capability:'pipeline.view'},async()=>({tenders:await listTenders()}));
export const POST=api({permission:'write',module:'pipeline',capability:'pipeline.edit'},async({request})=>Response.json(await createTender(await body(request,tenderInput)),{status:201}));
