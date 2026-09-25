import { getAuth } from '@/lib/platform/auth';
import { actorContext } from '@/lib/platform/context';
import type { Database } from '@/lib/platform/database';
import { can, isKnownRole, type Capability } from '@/lib/platform/permissions';
import type { Entitlements } from '@/lib/platform/modules';
export type Actor={userId:string;email:string;organisationId:string;role:string;name?:string;entitlements?:Entitlements};
// Read is office-only by default. Field-readable routes must explicitly opt in
// and return an operational projection, never arbitrary business metadata.
export type Permission='read'|'write'|'approve'|'admin'|'field'|'field-read';
export async function requireActor(request:Request,db:Database,permission:Permission='read'):Promise<Actor>{
 const cached=actorContext.getStore();
 let actor=cached;
 if(!actor){
  const session=await getAuth().api.getSession({headers:request.headers});
  if(!session)throw Object.assign(new Error('Unauthenticated'),{status:401});
  const row=await db.prepare('SELECT organisation_id,role,active,name FROM users WHERE id=?').bind(session.user.id).first<{organisation_id:string;role:string;active:number;name:string}>();
  if(!row||!row.active||!isKnownRole(row.role))throw Object.assign(new Error('No active organisation membership'),{status:403});
  actor={userId:session.user.id,email:session.user.email,organisationId:row.organisation_id,role:row.role,name:row.name};
 }
 const allowed=actor.role==='admin'||actor.role==='office'&&permission!=='admin'||actor.role==='field'&&['field','field-read'].includes(permission);
 if(!allowed)throw Object.assign(new Error('Unauthorised'),{status:403});
 return actor;
}
/** Explicit capability check for critical actions (approve, award, rates, claims...). */
export function requireCapability(capability:Capability){
 const actor=actorContext.getStore();
 if(!actor)throw Object.assign(new Error('Unauthenticated'),{status:401});
 if(!can(actor.role,capability))throw Object.assign(new Error('Unauthorised'),{status:403});
 return actor;
}
export function authError(e:unknown){const status=Number((e as {status?:number})?.status)||500;return Response.json({error:status===401?'Sign in required.':status===403?'You are not authorised for this action.':status===404?'Not found.':'Request failed.'},{status});}
