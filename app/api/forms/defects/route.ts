import {api,fail} from '@/lib/platform/http';
import {raiseFormDefect,listFormDefects} from '@/lib/seams/form-defects';
export const dynamic='force-dynamic';
// Form → Workshop defect seam. IMS entitlement for the route; the seam also requires Workshop.
export const GET=api({permission:'field-read',module:'ims',capability:'forms.view'},async({params})=>listFormDefects(String(params.get('submissionId')||'')));
export const POST=api({permission:'field',module:'ims',capability:'forms.submit'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b)fail(400,'Invalid request.');
 return Response.json(await raiseFormDefect(String(b!.submissionId||''),b!),{status:201});
});
