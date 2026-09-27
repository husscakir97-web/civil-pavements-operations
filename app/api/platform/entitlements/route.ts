import {z} from 'zod';
import {api,body} from '@/lib/platform/http';
import {getEntitlements,setEntitlement} from '@/lib/platform/entitlements';
import {MODULES,MODULE_LABELS} from '@/lib/platform/modules';
import {query} from '@/lib/platform/sql';
export const dynamic='force-dynamic';
export const GET=api({permission:'field-read',module:'core'},async({actor})=>{
 const e=await getEntitlements(actor.organisationId);
 const rows=actor.role==='admin'?await query('SELECT module,status,source,plan_code,valid_until,updated_at FROM organisation_entitlements WHERE organisation_id=?',[actor.organisationId]):[];
 return {entitlements:e,modules:MODULES.map(m=>({module:m,label:MODULE_LABELS[m],status:e[m],detail:rows.find(r=>r.module===m)||null})),billing:{provider:null,note:'Paid plans are not configured. Beta organisations use a full-access trial.'}};
});
export const PUT=api({permission:'admin',module:'core',capability:'entitlements.manage'},async({request,actor})=>{
 const b=await body(request,z.object({module:z.enum(MODULES),status:z.enum(['active','read_only','disabled'])}));
 return setEntitlement(actor.organisationId,b.module,b.status,'manual');
});
