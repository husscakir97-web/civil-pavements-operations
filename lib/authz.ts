import { DEFAULT_ORGANISATION_ID, type GenericRow } from './estimates-db';
export type Actor={userId:string;email:string;organisationId:string;role:string};
const OWNER='huss.cakir97@gmail.com';
export async function requireActor(request:Request, db:D1Database, permission:'read'|'write'|'approve'|'admin'='read', organisationScoped=false):Promise<Actor>{
  const id=request.headers.get('oai-authenticated-user-id'); const email=request.headers.get('oai-authenticated-user-email');
  if(!id||!email) throw Object.assign(new Error('Unauthenticated'),{status:401});
  const row=await db.prepare('SELECT id,email,organisation_id,role FROM users WHERE id=? OR lower(email)=lower(?) LIMIT 1').bind(id,email).first();
  const member = row as {organisation_id?:string;role?:string}|null;
  const actor:Actor={userId:id,email,organisationId:member?.organisation_id || (email.toLowerCase()===OWNER?DEFAULT_ORGANISATION_ID:''),role:(member?.role|| (email.toLowerCase()===OWNER?'Owner/Admin':'Read-only')).toLowerCase()};
  if(!actor.organisationId) throw Object.assign(new Error('No organisation membership'),{status:403});
  // Legacy modules still use this workspace's fixed organisation. Fail closed
  // for other organisations until all legacy query helpers are parameterised.
  if(!organisationScoped && actor.organisationId!==DEFAULT_ORGANISATION_ID) throw Object.assign(new Error('Organisation workspace is not configured'),{status:403});
  const allowed=permission==='read' || (permission==='write' && !['read-only'].includes(actor.role)) || (permission==='approve' && ['owner/admin','admin','estimator/commercial manager','commercial manager','project manager','supervisor'].includes(actor.role)) || (permission==='admin' && ['owner/admin','admin'].includes(actor.role));
  if(!allowed) throw Object.assign(new Error('Unauthorised'),{status:403}); return actor;
}
export function authError(e:unknown){const status=Number((e as {status?:number})?.status)||500;return Response.json({error:status===401?'Sign in required.':status===403?'You are not authorised for this action.':'Request failed.'},{status});}
