import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {one,exec,tx,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {isValidAbn,formatAbn,normaliseAbn,abnLookup} from '@/lib/platform/abn';
export const dynamic='force-dynamic';
// Checksum → (optional) official ABR lookup → the admin confirms → profile populated with source and time.
export const GET=api({permission:'read',module:'core'},async({params})=>{
 const abn=normaliseAbn(String(params.get('abn')||''));
 const valid=isValidAbn(abn);
 const registry=valid&&params.get('lookup')==='1'?await abnLookup.lookup(abn):null;
 return {abn:formatAbn(abn),valid,message:valid?'ABN format and checksum are valid.':'This is not a valid ABN (11 digits with a valid checksum).',registry};
});
export const POST=api({permission:'admin',module:'core',capability:'org.admin'},async({request,actor})=>{
 const b=await body(request,z.object({abn:z.string().max(20),useLegalName:z.boolean().default(true)}).strict());
 const abn=normaliseAbn(b.abn);
 if(!isValidAbn(abn))fail(400,'Enter a valid 11-digit ABN. The checksum does not match.');
 // The register is queried again on the server; details from the browser are never trusted.
 const result=await abnLookup.lookup(abn);
 if(result.status==='not-configured')fail(503,result.message,{code:'ABR_NOT_CONFIGURED'});
 if(result.status!=='found')fail(result.status==='not-found'?404:502,result.message,{code:result.status==='not-found'?'ABN_NOT_FOUND':'ABR_UNAVAILABLE'});
 const r=result.record;
 return tx(async conn=>{
  const now=nowIso();
  await exec('INSERT INTO organisation_profiles (organisation_id,onboarding_step,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE organisation_id=organisation_id',[actor.organisationId,0,1,actor.userId,now,now],conn);
  const before=await one('SELECT abn,legal_name,abn_verification FROM organisation_profiles WHERE organisation_id=? FOR UPDATE',[actor.organisationId],conn);
  const legalName=b.useLegalName&&r.entityName?r.entityName.slice(0,255):before?.legal_name??null;
  await exec("UPDATE organisation_profiles SET abn=?,legal_name=?,abn_verification='abr-verified',abn_entity_name=?,abn_entity_type=?,abn_status=?,gst_registered_from=?,abn_lookup_source=?,abn_lookup_at=?,updated_by=?,revision=revision+1,updated_at=? WHERE organisation_id=?",[abn,legalName,r.entityName.slice(0,255),r.entityType.slice(0,120),r.abnStatus.slice(0,40),r.gstRegisteredFrom,r.source,r.lookedUpAt,actor.userId,now,actor.organisationId],conn);
  await audit({event:'organisation.abn_verified',entityType:'organisation',entityId:actor.organisationId,summary:`ABN ${formatAbn(abn)} confirmed against the ABR: ${r.entityName} (${r.abnStatus})`,before,after:{legalName,...r}},conn);
  return {verified:true,record:r};
 });
});
