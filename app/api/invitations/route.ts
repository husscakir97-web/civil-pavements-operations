import {getAuth} from '@/lib/platform/auth';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import {withActor} from '@/lib/platform/route';
import {actorContext} from '@/lib/platform/context';
import {getPool} from '@/lib/platform/database';
import {sendEmail,isEmailEnabled} from '@/lib/platform/email';
import type {RowDataPacket} from 'mysql2';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export const GET=withActor(async()=>{const actor=actorContext.getStore()!;return Response.json({userId:actor.userId,email:actor.email,role:actor.role,organisationId:actor.organisationId,emailEnabled:isEmailEnabled()});},'field-read');
export const POST=withActor(async(request)=>{
 if(!isEmailEnabled())return Response.json({error:'Email invitations are unavailable until email is configured.'},{status:503});
 const input=z.object({email:z.string().email(),role:z.enum(['admin','office','field'])}).strict().safeParse(await request.json());if(!input.success)return Response.json({error:'A valid email and role are required.'},{status:400});
 const actor=actorContext.getStore()!,id=crypto.randomUUID(),token=randomBytes(32).toString('hex'),email=input.data.email.toLowerCase();
 const [existing]=await getPool().execute<RowDataPacket[]>('SELECT id FROM users WHERE organisation_id=? AND LOWER(email)=?',[actor.organisationId,email]);
 if(existing.length)return Response.json({error:'This person is already a member. Use Team & permissions to change their access.'},{status:409});
 await getPool().execute('INSERT INTO organisation_invitations (id,organisation_id,email,role,token_hash,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)',[id,actor.organisationId,email,input.data.role,digest(token),actor.userId,new Date(Date.now()+72*3600000),new Date()]);
 try{await sendEmail(email,'Invitation to Infrastruct',`You have been invited as ${input.data.role}. Sign up or sign in using ${email}, then accept: ${process.env.BETTER_AUTH_URL}/invite?token=${token}`);}catch{await getPool().execute('DELETE FROM organisation_invitations WHERE id=?',[id]);return Response.json({error:'Email could not be sent. Check email configuration and retry.'},{status:503});}
 return Response.json({sent:true},{status:201});
},'admin');
export const PUT=withActor(async(request)=>{
 if(!isEmailEnabled())return Response.json({error:'Email invitations are unavailable until email is configured.'},{status:503});
 const session=await getAuth().api.getSession({headers:request.headers});
 if(!session?.user.emailVerified)return Response.json({error:'Verify your email before accepting an invitation.'},{status:403});
 const body=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(await request.json());if(!body.success)return Response.json({error:'Invalid invitation'},{status:400});
 const actor=actorContext.getStore()!,conn=await getPool().getConnection();
 try{await conn.beginTransaction();const [rows]=await conn.execute<RowDataPacket[]>('SELECT * FROM organisation_invitations WHERE token_hash=? FOR UPDATE',[digest(body.data.token)]);const invite=rows[0];
 if(!invite||invite.accepted_at||new Date(invite.expires_at).getTime()<Date.now()||invite.email.toLowerCase()!==actor.email.toLowerCase()){await conn.rollback();return Response.json({error:'Invitation expired, used, or belongs to another email.'},{status:403});}
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
 await conn.commit();return Response.json({accepted:true});
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
},'field-read');
