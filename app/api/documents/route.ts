import {api,fail} from '@/lib/platform/http';
import {storeDocument,listDocuments,openDocument,isContext} from '@/lib/platform/documents';
import {resolveParent,getDef} from '@/lib/v1/register-server';
import {one} from '@/lib/platform/sql';
import {getPool} from '@/lib/platform/database';
export const dynamic='force-dynamic';
export const GET=api({permission:'field-read',module:'core'},async({params})=>{
 const id=params.get('id');
 if(id)return openDocument(id);
 return {documents:await listDocuments({contextType:params.get('contextType'),contextId:params.get('contextId'),projectId:params.get('projectId'),includeSuperseded:params.get('all')==='1'})};
});
export const POST=api({permission:'field',module:'core',capability:'document.upload'},async({request,actor})=>{
 const form=await request.formData();
 const file=form.get('file');if(!(file instanceof File))fail(400,'Choose a file to upload.');
 const contextType=String(form.get('contextType')||'');if(!isContext(contextType))fail(400,'Unknown document context.');
 const projectId=String(form.get('projectId')||'')||null;
 if(projectId){const p=await one('SELECT id,stage FROM jobs WHERE organisation_id=? AND id=?',[actor.organisationId,projectId]);if(!p)fail(404,'Project not found.');if(p!.stage==='closed')fail(409,'This project is closed. Reopen it before adding documents.');}
 const contextId=String(form.get('contextId')||'')||null;
 if(contextType==='tender'&&contextId)await resolveParent(getDef('requirements'),contextId,getPool());
 const doc=await storeDocument(file as File,{contextType,contextId,projectId,category:String(form.get('category')||'General'),title:String(form.get('title')||''),visibility:form.get('visibility')==='field'?'field':'office',supersedesId:String(form.get('supersedesId')||'')||null});
 return Response.json({document:doc},{status:201});
});
