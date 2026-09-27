import {api} from '@/lib/platform/http';
import {query} from '@/lib/platform/sql';
export const dynamic='force-dynamic';
// Admin/office activity view. Before/after snapshots are returned only to roles with audit.view.
export const GET=api({permission:'read',module:'core',capability:'audit.view'},async({actor,params})=>{
 const where=['a.organisation_id=?'],values:unknown[]=[actor.organisationId];
 for(const [p,c] of [['entityType','a.entity_type'],['entityId','a.entity_id'],['projectId','a.project_id']] as const){const v=params.get(p);if(v){where.push(`${c}=?`);values.push(v);}}
 const rows=await query(`SELECT a.id,a.event_type,a.entity_type,a.entity_id,a.project_id,a.summary,a.before_state,a.after_state,a.created_at,a.actor_email,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id AND u.organisation_id=a.organisation_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 200`,values);
 return {events:rows.map(r=>({...r,before_state:r.before_state?JSON.parse(r.before_state):null,after_state:r.after_state?JSON.parse(r.after_state):null}))};
});
