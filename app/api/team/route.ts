import {z} from 'zod';
import type {RowDataPacket} from 'mysql2';
import {withActor} from '@/lib/platform/route';
import {actorContext} from '@/lib/platform/context';
import {getPool} from '@/lib/platform/database';
import {audit} from '@/lib/platform/audit';
import {ROLES,roleLabel} from '@/lib/platform/permissions';

export const GET=withActor(async()=>{
 const actor=actorContext.getStore()!;
 const [members]=await getPool().execute<RowDataPacket[]>('SELECT id,name,email,role,active,created_at FROM users WHERE organisation_id=? ORDER BY name,id',[actor.organisationId]);
 const [events]=await getPool().execute<RowDataPacket[]>("SELECT id,name,metadata,created_at FROM audit_events WHERE organisation_id=? AND name='membership.updated' ORDER BY created_at DESC LIMIT 50",[actor.organisationId]);
 return Response.json({members:members.map(m=>({...m,active:Boolean(m.active)})),events:events.map(e=>({...e,metadata:JSON.parse(e.metadata)}))},{headers:{'Cache-Control':'private, no-store'}});
},'admin');

const state=z.object({role:z.enum(ROLES),active:z.boolean()}).strict();
const update=z.object({userId:z.string().min(1).max(191),expected:state,next:state}).strict();
export const PATCH=withActor(async request=>{
 const parsed=update.safeParse(await request.json());
 if(!parsed.success)return Response.json({error:'Choose a valid member, role and access status.'},{status:400});
 const actor=actorContext.getStore()!,{userId,expected,next}=parsed.data,db=await getPool().getConnection();
 try{
  await db.beginTransaction();
  // Serialize membership changes for this organisation, including simultaneous
  // admin demotions. Recheck the caller after acquiring the lock.
  await db.execute('SELECT id FROM organisations WHERE id=? FOR UPDATE',[actor.organisationId]);
  const [members]=await db.execute<RowDataPacket[]>('SELECT id,name,email,role,active FROM users WHERE organisation_id=? FOR UPDATE',[actor.organisationId]);
  const caller=members.find(m=>m.id===actor.userId),member=members.find(m=>m.id===userId);
  if(!caller?.active||caller.role!=='admin'){await db.rollback();return Response.json({error:'Administrator access is required.'},{status:403});}
  if(!member){await db.rollback();return Response.json({error:'Member not found.'},{status:404});}
  if(member.role!==expected.role||Boolean(member.active)!==expected.active){await db.rollback();return Response.json({error:'This member changed. Refresh the team and try again.'},{status:409});}
  if(member.role==='admin'&&member.active&&(!next.active||next.role!=='admin')&&!members.some(m=>m.id!==userId&&m.active&&m.role==='admin')){
   await db.rollback();return Response.json({error:'Keep at least one active admin. Promote another member first.'},{status:409});
  }
  await db.execute('UPDATE users SET role=?,active=? WHERE id=? AND organisation_id=?',[next.role,Number(next.active),userId,actor.organisationId]);
  if(!next.active)await db.execute('DELETE FROM auth_session WHERE user_id=?',[userId]);
  if(next.role!==member.role||next.active!==Boolean(member.active))await db.execute('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[
   crypto.randomUUID(),actor.organisationId,'membership.updated','recorded',JSON.stringify({actorId:actor.userId,actorEmail:actor.email,userId,email:member.email,before:{role:member.role,active:Boolean(member.active)},after:next}),new Date().toISOString()
  ]);
  if(next.role!==member.role||next.active!==Boolean(member.active))await audit({event:next.active!==Boolean(member.active)?(next.active?'membership.reactivated':'membership.deactivated'):'membership.role_changed',entityType:'user',entityId:userId,summary:`${member.email}: ${roleLabel(member.role)}${member.active?'':' (inactive)'} → ${roleLabel(next.role)}${next.active?'':' (inactive)'}`,before:{role:member.role,active:Boolean(member.active)},after:next},db);
  await db.commit();
  return Response.json({updated:true,selfChanged:userId===actor.userId&&(next.role!=='admin'||!next.active)});
 }catch(e){await db.rollback();throw e;}finally{db.release();}
},'admin');
