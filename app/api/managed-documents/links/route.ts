import {api,fail} from '@/lib/platform/http';
import {linkDocument,unlinkDocument,getManagedDocument} from '@/lib/platform/managed-documents';
export const dynamic='force-dynamic';
// Links are navigation/relevance only. They never grant access to the document.
export const POST=api({permission:'write',module:'core',capability:'document.edit'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b||typeof b.id!=='string')fail(400,'Invalid request.');
 const link=await linkDocument(b!.id as string,b!);
 return Response.json({...link,document:await getManagedDocument(b!.id as string)},{status:201});
});
export const DELETE=api({permission:'write',module:'core',capability:'document.edit'},async({params})=>{
 const removed=await unlinkDocument(String(params.get('id')||''));
 return removed;
});
