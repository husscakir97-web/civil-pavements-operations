import {api,fail} from '@/lib/platform/http';
import {applyResourceSpreadsheet,previewResourceSpreadsheet,resourceTemplate,type ResourceImportKind} from '@/lib/modules/operations/resource-import';

export const dynamic='force-dynamic';
const kindOf=(value:string|null):ResourceImportKind=>{
 if(value==='workers'||value==='plant')return value;
 fail(400,'Choose Employees or Fleet & plant.');
};

export const GET=api({permission:'write',module:'operations',capability:'resources.edit'},async({params})=>{
 const kind=kindOf(params.get('kind'));
 if(params.get('template')!=='1')fail(400,'Choose a template to download.');
 const buffer=await resourceTemplate(kind);
 const name=kind==='workers'?'infrastruct-employee-import-template.xlsx':'infrastruct-plant-import-template.xlsx';
 return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'private, no-store'}});
});

export const POST=api({permission:'write',module:'operations',capability:'resources.edit'},async({request})=>{
 const form=await request.formData();
 const kind=kindOf(String(form.get('kind')||''));
 const file=form.get('file');
 if(!(file instanceof File))fail(400,'Choose an .xlsx or .csv spreadsheet.');
 const updateExisting=String(form.get('updateExisting')??'true')!=='false';
 const mode=String(form.get('mode')||'preview');
 let mapping:Record<string,string>={};
 const rawMapping=form.get('mapping');
 if(typeof rawMapping==='string'&&rawMapping.trim()){try{const parsed=JSON.parse(rawMapping);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(400,'Column mapping is invalid.');mapping=Object.fromEntries(Object.entries(parsed).filter(([,v])=>typeof v==='string').map(([k,v])=>[k,String(v)]));}catch(e){if(e instanceof SyntaxError)fail(400,'Column mapping is invalid JSON.');throw e;}}
 if(mode==='apply')return applyResourceSpreadsheet(file,kind,updateExisting,mapping);
 return previewResourceSpreadsheet(file,kind,updateExisting,mapping);
});
