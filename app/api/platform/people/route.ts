import {api} from '@/lib/platform/http';
import {query} from '@/lib/platform/sql';
export const dynamic='force-dynamic';
// Minimal member directory for assignment pickers (no emails for non-admins).
export const GET=api({permission:'read',module:'core'},async({actor})=>{
 const rows=await query('SELECT id,name,role,email FROM users WHERE organisation_id=? AND active=1 ORDER BY name',[actor.organisationId]);
 return {people:rows.map(r=>({id:r.id,name:r.name,role:r.role,...(actor.role==='admin'?{email:r.email}:{})}))};
});
