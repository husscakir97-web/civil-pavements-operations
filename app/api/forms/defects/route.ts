import {api,fail} from '@/lib/platform/http';
import {raiseFormDefect,listFormDefects,describeOrderSource} from '@/lib/seams/form-defects';
export const dynamic='force-dynamic';
// Form → Workshop defect seam. IMS entitlement for the route; the seam also requires Workshop writable
// and the workshop.defect.report capability (checked by the route guard and again by requireSeam).
export const GET=api({permission:'field-read',module:'ims',capability:'forms.view'},async({params})=>{
 const orderId=params.get('workOrderId');
 return orderId?describeOrderSource(orderId):listFormDefects(String(params.get('submissionId')||''));
});
export const POST=api({permission:'field',module:'ims',capability:'workshop.defect.report'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b)fail(400,'Invalid request.');
 return Response.json(await raiseFormDefect(String(b!.submissionId||''),b!),{status:201});
});
