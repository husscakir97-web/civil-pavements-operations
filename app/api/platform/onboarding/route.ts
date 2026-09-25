import {z} from 'zod';
import {api,body,fail} from '@/lib/platform/http';
import {one,exec,tx,nowIso} from '@/lib/platform/sql';
import {audit} from '@/lib/platform/audit';
import {isValidAbn,normaliseAbn} from '@/lib/platform/abn';
import {can} from '@/lib/platform/permissions';
export const dynamic='force-dynamic';
const LIST_FIELDS=['business_activities','disciplines','operating_regions','certifications','key_clients'] as const;
const s=(n=255)=>z.string().trim().max(n).nullable().optional();
const list=z.array(z.string().trim().min(1).max(120)).max(40).optional();
const schema=z.object({legal_name:s(),trading_name:s(),abn:s(20),registered_address:s(2000),operating_address:s(2000),business_activities:list,disciplines:list,operating_regions:list,workforce_size:s(40),typical_project_size:s(60),plant_summary:s(5000),key_clients:list,certifications:list,tendering_activity:s(60),hseq_maturity:s(60),estimating_approach:s(60),onboarding_step:z.number().int().min(0).max(10).optional(),complete:z.boolean().optional(),risk_matrix:z.object({low:z.number().int(),medium:z.number().int(),high:z.number().int()}).refine(m=>m.low>=1&&m.low<m.medium&&m.medium<m.high&&m.high<25,'Thresholds must increase between 1 and 25.').nullable().optional()}).strict();
function present(r:Record<string,unknown>|null){
 if(!r)return null;
 const out:Record<string,unknown>={...r};delete out.organisation_id;
 for(const f of LIST_FIELDS){try{out[f]=r[f]?JSON.parse(String(r[f])):[];}catch{out[f]=[];}}
 try{out.risk_matrix=r.risk_matrix?JSON.parse(String(r.risk_matrix)):null;}catch{out.risk_matrix=null;}
 out.completed=Boolean(r.onboarding_completed_at);
 return out;
}
async function ensure(org:string,userId:string){
 const now=nowIso();
 await exec('INSERT INTO organisation_profiles (organisation_id,onboarding_step,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE organisation_id=organisation_id',[org,0,1,userId,now,now]);
}
export const GET=api({permission:'field-read',module:'core'},async({actor})=>{
 await ensure(actor.organisationId,actor.userId);
 const r=await one('SELECT p.*,o.name AS organisation_name FROM organisation_profiles p JOIN organisations o ON o.id=p.organisation_id WHERE p.organisation_id=?',[actor.organisationId]);
 const p=present(r);
 if(actor.role==='field')return {profile:{organisation_name:p?.organisation_name,trading_name:p?.trading_name,completed:p?.completed}};
 return {profile:p,canEdit:can(actor.role,'org.admin')};
});
export const PUT=api({permission:'admin',module:'core',capability:'org.admin'},async({request,actor})=>{
 const b=await body(request,schema);
 if(b.abn){if(!isValidAbn(b.abn))fail(400,'Enter a valid 11-digit ABN. The checksum does not match.');b.abn=normaliseAbn(b.abn);}
 await ensure(actor.organisationId,actor.userId);
 return tx(async conn=>{
  const before=await one('SELECT * FROM organisation_profiles WHERE organisation_id=? FOR UPDATE',[actor.organisationId],conn);
  const values:Record<string,unknown>={};
  for(const [k,v] of Object.entries(b)){if(k==='complete'||v===undefined)continue;values[k]=(LIST_FIELDS as readonly string[]).includes(k)||k==='risk_matrix'?(v===null?null:JSON.stringify(v)):v;}
  // A changed ABN loses its register confirmation until it is looked up again.
  if(values.abn!==undefined&&values.abn!==before?.abn)Object.assign(values,{abn_verification:'format-checked',abn_entity_name:null,abn_entity_type:null,abn_status:null,gst_registered_from:null,abn_lookup_source:null,abn_lookup_at:null});
  const merged={...before,...values};
  if(b.complete){if(!String(merged.legal_name||'').trim())fail(422,'Enter your legal business name to finish onboarding.');values.onboarding_completed_at=before?.onboarding_completed_at||nowIso();}
  const now=nowIso();
  const cols=Object.keys(values);
  if(cols.length)await exec(`UPDATE organisation_profiles SET ${cols.map(c=>`${c}=?`).join(',')},updated_by=?,updated_at=?,revision=revision+1 WHERE organisation_id=?`,[...cols.map(c=>values[c]),actor.userId,now,actor.organisationId],conn);
  const display=String(merged.trading_name||merged.legal_name||'').trim();
  if(display)await exec('UPDATE organisations SET name=? WHERE id=?',[display.slice(0,255),actor.organisationId],conn);
  await audit({event:b.complete?'organisation.onboarding.completed':'organisation.profile.updated',entityType:'organisation',entityId:actor.organisationId,summary:b.complete?'Onboarding completed':'Company profile updated',before:before?Object.fromEntries(cols.map(c=>[c,before[c]])):null,after:values},conn);
  return {profile:present(await one('SELECT p.*,o.name AS organisation_name FROM organisation_profiles p JOIN organisations o ON o.id=p.organisation_id WHERE p.organisation_id=?',[actor.organisationId],conn))};
 });
});
