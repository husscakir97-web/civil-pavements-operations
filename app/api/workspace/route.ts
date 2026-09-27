import {withActor} from '@/lib/platform/route';
import {requireEstimateDb,safeJson} from '@/lib/estimates-db';
import {requireActor,authError} from '@/lib/authz';
import {defaultBrand} from '@/lib/workspace-brand';
import {z} from 'zod';
import {getEntitlements} from '@/lib/platform/entitlements';
import {capabilitiesFor} from '@/lib/platform/permissions';
const schema=z.object({productName:z.string().trim().min(1).max(60),companyName:z.string().trim().min(1).max(120),workspaceName:z.string().trim().min(1).max(60),accentColor:z.string().regex(/^#[0-9a-f]{6}$/i)}).strict();
async function handleGET(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db,'field-read');
 const organisation=await db.prepare('SELECT name FROM organisations WHERE id=?').bind(actor.organisationId).first<{name:string}>();
 const row=await db.prepare("SELECT metadata FROM attachments WHERE organisation_id=? AND id=? AND status='workspace-settings'").bind(actor.organisationId,`workspace-brand:${actor.organisationId}`).first<{metadata:string}>();
 const [entitlements,profile]=await Promise.all([getEntitlements(actor.organisationId),db.prepare('SELECT onboarding_completed_at,onboarding_step FROM organisation_profiles WHERE organisation_id=?').bind(actor.organisationId).first<{onboarding_completed_at:string|null;onboarding_step:number}>()]);
 return Response.json({brand:{...defaultBrand,companyName:organisation?.name||defaultBrand.companyName,...safeJson(row?.metadata,{})},canEdit:['admin'].includes(actor.role),userEmail:actor.email,userId:actor.userId,userName:actor.name||'',role:actor.role,capabilities:capabilitiesFor(actor.role),entitlements,onboarding:{completed:Boolean(profile?.onboarding_completed_at),step:Number(profile?.onboarding_step||0)}});
}catch(e){return authError(e)}}
async function handlePUT(request:Request){try{
 const db=requireEstimateDb(),actor=await requireActor(request,db,'admin'),brand=schema.parse(await request.json()),now=new Date().toISOString(),id=`workspace-brand:${actor.organisationId}`;
 await db.batch([db.prepare("INSERT INTO attachments(id,organisation_id,name,status,metadata,created_at) VALUES(?,?,?,'workspace-settings',?,?) ON DUPLICATE KEY UPDATE metadata=IF(organisation_id=VALUES(organisation_id) AND status='workspace-settings',VALUES(metadata),metadata)").bind(id,actor.organisationId,'Workspace branding',JSON.stringify(brand),now),db.prepare('INSERT INTO audit_events(id,organisation_id,name,status,metadata,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor.organisationId,'workspace.branding.updated','recorded',JSON.stringify({actor:actor.userId,brand}),now)]);
 return Response.json({brand});
}catch(e){if(e instanceof z.ZodError)return Response.json({error:'Check the company name, product name, workspace name and colour.'},{status:400});return authError(e)}}

export const GET=withActor(handleGET,'field-read');

export const PUT=withActor(handlePUT,'admin');
