import {api,fail} from '@/lib/platform/http';
import {listTemplates,getTemplate,getVersion,createTemplate,saveDraft,publishVersion,startRevision,setTemplateStatus,submitForm,amendSubmission,getSubmission,listSubmissions,formOptions} from '@/lib/platform/forms';
export const dynamic='force-dynamic';
// Forms engine API. Runs under the IMS entitlement (disabled → 404, read-only → writes refused);
// every capability and context check lives in lib/platform/forms.ts.
export const GET=api({permission:'field-read',module:'ims'},async({params})=>{
 const op=params.get('op')||'templates',id=params.get('id')||'';
 if(op==='templates')return listTemplates();
 if(op==='template')return getTemplate(id);
 if(op==='version')return getVersion(id);
 if(op==='submission')return getSubmission(id);
 if(op==='submissions')return listSubmissions({contextType:params.get('contextType'),contextId:params.get('contextId'),templateId:params.get('templateId'),limit:Number(params.get('limit'))||undefined});
 if(op==='options')return formOptions();
 fail(400,'Unknown forms request.');
});
export const POST=api({permission:'field',module:'ims'},async({request})=>{
 const b=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!b||typeof b!=='object')fail(400,'Invalid request.');
 const id=String(b!.id||'');
 switch(b!.action){
  case 'create':return Response.json(await createTemplate(b!),{status:201});
  case 'saveDraft':return saveDraft(id,b!);
  case 'publish':return publishVersion(id,String(b!.versionId||''),b!.changeReason);
  case 'revise':return startRevision(id);
  case 'archive':return setTemplateStatus(id,'archived');
  case 'restore':return setTemplateStatus(id,'active');
  case 'submit':return Response.json(await submitForm(b!),{status:201});
  case 'amend':return Response.json(await amendSubmission(id,b!),{status:201});
 }
 fail(400,'Unknown forms action.');
});
