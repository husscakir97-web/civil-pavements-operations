import {getAuth} from '@/lib/platform/auth';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {withActor} from '@/lib/platform/route';
import {actorContext} from '@/lib/platform/context';
import {getPool} from '@/lib/platform/database';
import {sendEmail,isEmailEnabled} from '@/lib/platform/email';
import {audit} from '@/lib/platform/audit';
import {ROLES,roleLabel,can} from '@/lib/platform/permissions';
import type {RowDataPacket} from 'mysql2';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const TTL=72*3600000;
const EMAIL_OFF='Email is switched off, so invitations cannot be sent. Existing members can still be managed. Set EMAIL_ENABLED and the SMTP settings to enable invitations.';
const inviteText=(role:string,email:string,token:string)=>`You have been invited to Infrastruct as ${roleLabel(role)}. Sign up or sign in using ${email}, then accept: ${process.env.BETTER_AUTH_URL}/invite?token=${token}\n\nThis invitation expires in 72 hours.`;
const state=(i:RowDataPacket)=>i.accepted_at?'accepted':i.cancelled_at?'cancelled':new Date(i.expires_at).getTime()<Date.now()?'expired':'pending';

export const GET=withActor(async()=>{
 const actor=actorContext.getStore()!;
 const base={userId:actor.userId,email:actor.email,role:actor.role,organisationId:actor.organisationId,emailEnabled:isEmailEnabled()};
 if(!can(actor.role,'team.admin'))return Response.json(base,{headers:{'Cache-Control':'private, no-store'}});
 const [rows]=await getPool().execute<RowDataPacket[]>('SELECT id,email,role,invited_by,expires_at,accepted_at,cancelled_at,created_at,last_sent_at,send_count FROM organisation_invitations WHERE organisation_id=? ORDER BY created_at DESC LIMIT 100',[actor.organisationId]);
 return Response.json({...base,invitations:rows.map(i=>({id:i.id,email:i.email,role:i.role,state:state(i),expiresAt:i.expires_at,createdAt:i.created_at,lastSentAt:i.last_sent_at||i.created_at,sendCount:Number(i.send_count||1)}))},{headers:{'Cache-Control':'private, no-store'}});
},'field-read');

export const POST=withActor(async(request)=>{
 if(!isEmailEnabled())return Response.json({error:EMAIL_OFF},{status:503});
 const input=z.object({email:z.string().email(),role:z.enum(ROLES)}).strict().safeParse(await request.json());if(!input.success)return Response.json({error:'A valid email and role are required.'},{status:400});
 const actor=actorContext.getStore()!,id=crypto.randomUUID(),token=randomBytes(32).toString('hex'),email=input.data.email.toLowerCase();
 const [existing]=await getPool().execute<RowDataPacket[]>('SELECT id FROM users WHERE organisation_id=? AND LOWER(email)=?',[actor.organisationId,email]);
 if(existing.length)return Response.json({error:'This person is already a member. Use Team & permissions to change their access.'},{status:409});
 const [open]=await getPool().execute<RowDataPacket[]>('SELECT id FROM organisation_invitations WHERE organisation_id=? AND LOWER(email)=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>?',[actor.organisationId,email,new Date()]);
 if(open.length)return Response.json({error:'An invitation to this email is already pending. Resend or cancel it instead.'},{status:409});
 const now=new Date();
 await getPool().execute('INSERT INTO organisation_invitations (id,organisation_id,email,role,token_hash,invited_by,expires_at,created_at,last_sent_at,send_count) VALUES (?,?,?,?,?,?,?,?,?,1)',[id,actor.organisationId,email,input.data.role,digest(token),actor.userId,new Date(now.getTime()+TTL),now,now]);
 try{await sendEmail(email,'Invitation to Infrastruct',inviteText(input.data.role,email,token));}catch{await getPool().execute('DELETE FROM organisation_invitations WHERE id=? AND accepted_at IS NULL',[id]);return Response.json({error:'Email could not be sent. Check email configuration and retry.'},{status:503});}
 await audit({event:'invitation.sent',entityType:'invitation',entityId:id,summary:`Invitation sent to ${email} as ${roleLabel(input.data.role)}`,after:{email,role:input.data.role}});
 return Response.json({sent:true,id},{status:201});
},'admin');

// Resend (new token, new expiry; the old link stops working) or cancel a pending invitation.
export const PATCH=withActor(async(request)=>{
 const input=z.object({id:z.string().min(1).max(191),action:z.enum(['resend','cancel'])}).strict().safeParse(await request.json());
 if(!input.success)return Response.json({error:'Choose an invitation and an action.'},{status:400});
 const actor=actorContext.getStore()!;
 const [rows]=await getPool().execute<RowDataPacket[]>('SELECT * FROM organisation_invitations WHERE organisation_id=? AND id=?',[actor.organisationId,input.data.id]);
 const invite=rows[0];
 if(!invite)return Response.json({error:'Invitation not found.'},{status:404});
 if(invite.accepted_at)return Response.json({error:'This invitation has already been accepted.'},{status:409});
 if(invite.cancelled_at)return Response.json({error:'This invitation was cancelled. Send a new invitation instead.'},{status:409});
 if(input.data.action==='cancel'){
  await getPool().execute('UPDATE organisation_invitations SET cancelled_at=?,cancelled_by=? WHERE id=? AND organisation_id=? AND accepted_at IS NULL AND cancelled_at IS NULL',[new Date(),actor.userId,invite.id,actor.organisationId]);
  await audit({event:'invitation.cancelled',entityType:'invitation',entityId:invite.id,summary:`Invitation to ${invite.email} cancelled`});
  return Response.json({cancelled:true});
 }
 if(!isEmailEnabled())return Response.json({error:EMAIL_OFF},{status:503});
 const token=randomBytes(32).toString('hex'),now=new Date();
 const previous={token_hash:invite.token_hash,expires_at:invite.expires_at};
 await getPool().execute('UPDATE organisation_invitations SET token_hash=?,expires_at=?,last_sent_at=?,send_count=send_count+1 WHERE id=? AND organisation_id=?',[digest(token),new Date(now.getTime()+TTL),now,invite.id,actor.organisationId]);
 try{await sendEmail(invite.email,'Invitation to Infrastruct (resent)',inviteText(invite.role,invite.email,token));}
 catch{await getPool().execute('UPDATE organisation_invitations SET token_hash=?,expires_at=?,send_count=send_count-1 WHERE id=?',[previous.token_hash,previous.expires_at,invite.id]);return Response.json({error:'Email could not be sent. The previous invitation link still works until it expires.'},{status:503});}
 await audit({event:'invitation.resent',entityType:'invitation',entityId:invite.id,summary:`Invitation to ${invite.email} resent`});
 return Response.json({resent:true});
},'admin');

export const PUT=withActor(async(request)=>{
 if(!isEmailEnabled())return Response.json({error:'Email invitations are unavailable until email is configured.'},{status:503});
 const session=await getAuth().api.getSession({headers:request.headers});
 if(!session?.user.emailVerified)return Response.json({error:'Verify your email before accepting an invitation.'},{status:403});
 const body=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(await request.json());if(!body.success)return Response.json({error:'Invalid invitation'},{status:400});
 const actor=actorContext.getStore()!,conn=await getPool().getConnection();
 try{await conn.beginTransaction();const [rows]=await conn.execute<RowDataPacket[]>('SELECT * FROM organisation_invitations WHERE token_hash=? FOR UPDATE',[digest(body.data.token)]);const invite=rows[0];
 if(!invite||invite.accepted_at||invite.cancelled_at||new Date(invite.expires_at).getTime()<Date.now()||invite.email.toLowerCase()!==actor.email.toLowerCase()){await conn.rollback();return Response.json({error:'Invitation expired, cancelled, used, or belongs to another email.'},{status:403});}
 // Membership updates use the same organisation locks as team administration.
 for(const org of [...new Set([actor.organisationId,String(invite.organisation_id)])].sort())await conn.execute('SELECT id FROM organisations WHERE id=? FOR UPDATE',[org]);
 const [current]=await conn.execute<RowDataPacket[]>('SELECT organisation_id,role,active FROM users WHERE id=? FOR UPDATE',[actor.userId]);
 if(!current[0]?.active||current[0].organisation_id!==actor.organisationId){await conn.rollback();return Response.json({error:'Membership changed. Sign in again.'},{status:403});}
 const [issuer]=await conn.execute<RowDataPacket[]>("SELECT id FROM users WHERE id=? AND organisation_id=? AND role='admin' AND active=1",[invite.invited_by,invite.organisation_id]);
 if(!issuer.length||invite.organisation_id===actor.organisationId){await conn.rollback();return Response.json({error:'Invitation is no longer valid. Ask an admin to manage access from Team & permissions.'},{status:403});}
 const [others]=await conn.execute<RowDataPacket[]>('SELECT role,active FROM users WHERE organisation_id=? AND id<>?',[actor.organisationId,actor.userId]);
 if(current[0].role==='admin'&&others.length&&!others.some(m=>m.role==='admin'&&m.active)){await conn.rollback();return Response.json({error:'Promote another active admin in your current team before joining a different organisation.'},{status:409});}
 await conn.execute('UPDATE users SET organisation_id=?,role=? WHERE id=?',[invite.organisation_id,invite.role,actor.userId]);
 await conn.execute('UPDATE organisation_invitations SET accepted_at=? WHERE id=?',[new Date(),invite.id]);
 await conn.execute('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),invite.organisation_id,'membership.invitation.accepted','recorded',JSON.stringify({userId:actor.userId,invitedBy:invite.invited_by,role:invite.role,previousOrganisationId:actor.organisationId}),new Date().toISOString()]);
 await audit({event:'invitation.accepted',entityType:'invitation',entityId:invite.id,organisationId:invite.organisation_id,summary:`${actor.email} joined as ${roleLabel(invite.role)}`},conn);
 await conn.commit();return Response.json({accepted:true});
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
},'field-read');
