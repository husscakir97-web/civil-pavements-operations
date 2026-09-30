import {api,fail} from '@/lib/platform/http';
import {createManagedDocument,getManagedDocument,listManagedDocuments,openManagedVersion,updateManagedMetadata,setManagedArchived} from '@/lib/platform/managed-documents';
export const dynamic='force-dynamic';
// Managed documents (Core Document Engine). Reads are permission-filtered by each document's single
// owning context; the legacy /api/documents?id= physical-file route is unchanged.
export const GET=api({permission:'field-read',module:'core'},async({params})=>{
 const id=params.get('id');
 if(id&&params.get('download')==='1')return openManagedVersion(id,params.get('versionId')||'current');
 if(id)return getManagedDocument(id);
 return {documents:await listManagedDocuments({contextType:params.get('contextType'),contextId:params.get('contextId'),projectId:params.get('projectId'),documentType:params.get('documentType'),discipline:params.get('discipline'),q:params.get('q'),archived:params.get('archived')==='1',limit:params.get('limit')?Number(params.get('limit')):undefined})};
});
/** Fast path: a file and (optionally) a title. Everything else is optional metadata. */
export const POST=api({permission:'field',module:'core',capability:'document.upload'},async({request})=>{
 const form=await request.formData();
 const file=form.get('file');if(!(file instanceof File))fail(400,'Choose a file to upload.');
 const s=(k:string)=>{const v=form.get(k);return typeof v==='string'?v:undefined;};
 const created=await createManagedDocument({content:file as File,title:s('title'),description:s('description'),documentNumber:s('documentNumber'),documentType:s('documentType'),discipline:s('discipline'),tags:s('tags'),
  contextType:s('contextType')||'organisation',contextId:s('contextId'),visibility:s('visibility'),revisionLabel:s('revisionLabel'),issueDate:s('issueDate'),author:s('author'),company:s('company'),changeNote:s('changeNote')});
 return Response.json({...created,document:await getManagedDocument(created.id)},{status:201});
});
export const PATCH=api({permission:'write',module:'core',capability:'document.edit'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b||typeof b.id!=='string')fail(400,'Invalid request.');
 if(b!.archived!==undefined)await setManagedArchived(b!.id as string,Boolean(b!.archived),b!.revision);
 else await updateManagedMetadata(b!.id as string,b!);
 return getManagedDocument(b!.id as string);
});
