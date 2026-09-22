import { getAuth } from '@/lib/platform/auth';
import { actorContext } from '@/lib/platform/context';
import type { Database } from '@/lib/platform/database';
export type Actor={userId:string;email:string;organisationId:string;role:string};
export type Permission='read'|'write'|'approve'|'admin'|'field';
export async function requireActor(request:Request,db:Database,permission:Permission='read',_organisationScoped=true):Promise<Actor>{
 const cached=actorContext.getStore();
 let actor=cached;
 if(!actor){
  const session=await getAuth().api.getSession({headers:request.headers});
  if(!session)throw Object.assign(new Error('Unauthenticated'),{status:401});
  const row=await db.prepare('SELECT organisation_id,role FROM users WHERE id=?').bind(session.user.id).first<{organisation_id:string;role:string}>();
  if(!row||!['admin','office','field'].includes(row.role))throw Object.assign(new Error('No organisation membership'),{status:403});
  actor={userId:session.user.id,email:session.user.email,organisationId:row.organisation_id,role:row.role};
 }
 const allowed=permission==='read'||actor.role==='admin'||actor.role==='office'&&permission!=='admin'||actor.role==='field'&&permission==='field';
 if(!allowed)throw Object.assign(new Error('Unauthorised'),{status:403});
 return actor;
}
export function authError(e:unknown){const status=Number((e as {status?:number})?.status)||500;return Response.json({error:status===401?'Sign in required.':status===403?'You are not authorised for this action.':'Request failed.'},{status});}
