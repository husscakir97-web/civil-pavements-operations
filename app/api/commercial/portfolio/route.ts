import {api} from '@/lib/platform/http';
import {query} from '@/lib/platform/sql';
import {projectFinancials} from '@/lib/seams/project-control';
import {stageOf} from '@/lib/modules/projects/projects';
export const dynamic='force-dynamic';
// Portfolio money spine: one row per live project, every figure from projectFinancials().
export const GET=api({permission:'read',module:'commercial',capability:'commercial.view'},async({actor})=>{
 const projects=await query("SELECT id,name,project_number,client_name,stage,status FROM jobs WHERE organisation_id=? AND LOWER(status)<>'archived' ORDER BY created_at DESC LIMIT 200",[actor.organisationId]);
 const rows=[];for(const p of projects){const f=await projectFinancials(p.id);rows.push({id:p.id,name:p.name,projectNumber:p.project_number,clientName:p.client_name,stage:stageOf(p),hasBaseline:f.hasBaseline,...f.forecast});}
 return {projects:rows};
});
