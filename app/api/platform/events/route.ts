import {api,fail} from '@/lib/platform/http';
import {DOMAIN_EVENTS} from '@/lib/platform/domain-events';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {can} from '@/lib/platform/permissions';
import {query} from '@/lib/platform/sql';
export const dynamic='force-dynamic';
export const GET=api({permission:'read',module:'core',capability:'audit.view'},async({actor,params})=>{
 const entitlements=await getEntitlements(actor.organisationId);
 const allowed=Object.entries(DOMAIN_EVENTS).filter(([,e])=>usable(entitlements,e.module)&&can(actor.role,e.read)).map(([key])=>key);
 const requested=params.get('type');
 if(requested&&!allowed.includes(requested))fail(404,'Not found.');
 const limit=Number(params.get('limit')||50),offset=Number(params.get('offset')||0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)fail(400,'Invalid pagination.');
 if(!allowed.length)return {events:[],nextOffset:null};
 const rows=await query('SELECT id,event_type,event_version,module,entity_type,entity_id,actor_user_id,created_at FROM domain_events WHERE organisation_id=? AND event_type IN (?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',[actor.organisationId,requested?[requested]:allowed,limit+1,offset]);
 return {events:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
});
