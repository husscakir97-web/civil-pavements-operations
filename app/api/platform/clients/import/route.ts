import {api,fail} from '@/lib/platform/http';
import {previewCrmImport,applyCrmImport,crmTemplate,type CrmOptions} from '@/lib/platform/crm-import';
export const dynamic='force-dynamic';
// CRM bulk import (Core). GET ?template=1 downloads the workbook; POST previews (mode=preview)
// or applies (mode=apply) an uploaded .xlsx/.csv. Authorisation lives in the import service.
export const GET=api({permission:'write',module:'core'},async({params})=>{
 if(params.get('template')!=='1')fail(400,'Choose the template to download.');
 const buffer=await crmTemplate();
 return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="infrastruct-crm-import-template.xlsx"','Cache-Control':'private, no-store'}});
});
const json=(v:FormDataEntryValue|null,label:string)=>{if(typeof v!=='string'||!v.trim())return undefined;try{const p=JSON.parse(v);if(!p||typeof p!=='object'||Array.isArray(p))throw new Error();return p;}catch{fail(400,`${label} is invalid.`);}};
export const POST=api({permission:'write',module:'core'},async({request})=>{
 const form=await request.formData(),file=form.get('file');
 if(!(file instanceof File))fail(400,'Choose an .xlsx or .csv spreadsheet.');
 const opts:CrmOptions={updateExisting:String(form.get('updateExisting')??'true')!=='false',mapping:json(form.get('mapping'),'Column mapping'),sheetKinds:json(form.get('sheetKinds'),'Sheet types'),decisions:json(form.get('decisions'),'Duplicate decisions')};
 if(String(form.get('mode')||'preview')==='apply')return applyCrmImport(file as File,opts);
 return (await previewCrmImport(file as File,opts)).preview;
});
