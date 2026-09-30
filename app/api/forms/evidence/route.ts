import {api,fail} from '@/lib/platform/http';
import {uploadFormEvidence,openFormEvidence} from '@/lib/platform/forms';
export const dynamic='force-dynamic';
// Forms evidence (photos, files, drawn signatures). IMS entitlement only — the Field module is not
// required. Every upload and open re-resolves the form context in lib/platform/forms.ts.
export const GET=api({permission:'field-read',module:'ims'},async({params})=>openFormEvidence(String(params.get('id')||'')));
export const POST=api({permission:'field',module:'ims'},async({request})=>{
 const form=await request.formData().catch(()=>null);
 const file=form?.get('file');if(!(file instanceof File))fail(400,'Choose a file to upload.');
 return Response.json(await uploadFormEvidence(file as File,String(form!.get('contextType')||''),String(form!.get('contextId')||'')),{status:201});
});
