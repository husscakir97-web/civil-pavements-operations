import {api,fail} from '@/lib/platform/http';
import {addDocumentVersion,getManagedDocument} from '@/lib/platform/managed-documents';
export const dynamic='force-dynamic';
// Upload a new immutable revision. The previous version and its physical file are kept untouched.
export const POST=api({permission:'write',module:'core',capability:'document.manage_versions'},async({request})=>{
 const form=await request.formData();
 const file=form.get('file');if(!(file instanceof File))fail(400,'Choose a file to upload.');
 const s=(k:string)=>{const v=form.get(k);return typeof v==='string'?v:undefined;};
 const expected=s('expectedVersion');
 const created=await addDocumentVersion(String(s('id')||''),{content:file as File,revisionLabel:s('revisionLabel'),issueDate:s('issueDate'),author:s('author'),company:s('company'),changeNote:s('changeNote'),visibility:s('visibility'),expectedVersion:expected?Number(expected):null});
 return Response.json({...created,document:await getManagedDocument(created.id)},{status:201});
});
