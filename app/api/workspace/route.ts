import {requireEstimateDb,safeJson} from '@/lib/estimates-db';
import {requireActor,authError} from '@/lib/authz';
import {defaultBrand} from '@/lib/workspace-brand';
import {z} from 'zod';
const schema=z.object({productName:z.string().trim().min(1).max(60),companyName:z.string().trim().min(1).max(120),workspaceName:z.string().trim().min(1).max(60),accentColor:z.string().regex(/^#[0-9a-f]{6}$/i)}).strict();
export async function GET(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db);
 const organisation=await db.prepare('SELECT name FROM organisations WHERE id=?').bind(actor.organisationId).first<{name:string}>();
 const row=await db.prepare("SELECT metadata FROM attachments WHERE organisation_id=? AND id=? AND status='workspace-settings'").bind(actor.organisationId,`workspace-brand:${actor.organisationId}`).first<{metadata:string}>();
 return Response.json({brand:{...defaultBrand,companyName:organisation?.name||defaultBrand.companyName,...safeJson(row?.metadata,{})},canEdit:['owner/admin','admin'].includes(actor.role),userEmail:actor.email});
}catch(e){return authError(e)}}
export async function PUT(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db,'admin'),brand=schema.parse(await request.json()),now=new Date().toISOString(),id=`workspace-brand:${actor.organisationId}`;
 await db.batch([db.prepare("INSERT INTO attachments(id,organisation_id,name,status,metadata,created_at) VALUES(?,?,?,'workspace-settings',?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata WHERE attachments.organisation_id=excluded.organisation_id AND attachments.status='workspace-settings'").bind(id,actor.organisationId,'Workspace branding',JSON.stringify(brand),now),db.prepare('INSERT INTO audit_events(id,organisation_id,name,status,metadata,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'workspace.branding.updated','recorded',JSON.stringify({actor:actor.userId,brand}),now)]);
 return Response.json({brand});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check the company name, product name, workspace name and colour.'},{status:400});return authError(e)}}
