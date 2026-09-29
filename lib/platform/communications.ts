// Core communications: contextual threads, in-app notifications, acknowledgements and
// secure external shift links. Business modules keep ownership of their records; this layer
// always resolves the owning context before reading or writing a thread.
import {createHash,randomBytes} from 'node:crypto';
import {actorContext} from './context';
import {audit} from './audit';
import {bucket} from './storage';
import {can,type Capability} from './permissions';
import {getEntitlements} from './entitlements';
import {usable,writable,type ModuleKey} from './modules';
import {fail} from './http';
import {query,one,exec,tx,uuid,nowIso,type Conn,type Row} from './sql';
import {canAccessProject,orgWideProjects} from './project-access';
import {shiftAudience,shiftVisible} from './shift-scope';
import {sendEmail,isEmailEnabled} from './email';

export const COMM_CONTEXTS=['project','program_activity','shift','tender','variation','claim','incident','ncr','action','swms','itp','workshop_order'] as const;
export type CommunicationContext=typeof COMM_CONTEXTS[number];
export const isCommunicationContext=(v:string):v is CommunicationContext=>(COMM_CONTEXTS as readonly string[]).includes(v);

type ContextInfo={type:CommunicationContext;id:string;title:string;module:ModuleKey;capability:Capability;projectId:string|null;target:{area:string;sub?:string;id?:string;tab?:string};shift?:{id:string;metadata:Record<string,unknown>}};
const specs:Record<CommunicationContext,{module:ModuleKey;capability:Capability;load:(org:string,id:string)=>Promise<ContextInfo|null>}>={
 project:{module:'projects',capability:'project.view',load:async(org,id)=>{const r=await one('SELECT id,name FROM jobs WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'project',id,title:String(r.name),module:'projects',capability:'project.view',projectId:id,target:{area:'Projects',sub:'Projects',id,tab:'communication'}}:null;}},
 program_activity:{module:'projects',capability:'project.view',load:async(org,id)=>{const r=await one('SELECT id,name,project_id FROM program_activities WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'program_activity',id,title:String(r.name),module:'projects',capability:'project.view',projectId:String(r.project_id),target:{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'programme'}}:null;}},
 shift:{module:'operations',capability:'schedule.view',load:async(org,id)=>{const r=await one('SELECT id,name,metadata FROM shifts WHERE organisation_id=? AND id=?',[org,id]);if(!r)return null;const m=typeof r.metadata==='string'?JSON.parse(r.metadata||'{}'):r.metadata||{},projectId=m.jobId?String(m.jobId):null;return {type:'shift',id,title:String(r.name),module:'operations',capability:'schedule.view',projectId,target:projectId?{area:'Projects',sub:'Projects',id:projectId,tab:'delivery'}:{area:'Schedule',sub:'Schedule'},shift:{id,metadata:m}};}},
 tender:{module:'pipeline',capability:'pipeline.view',load:async(org,id)=>{const r=await one('SELECT id,title FROM tenders WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'tender',id,title:String(r.title),module:'pipeline',capability:'pipeline.view',projectId:null,target:{area:'Pipeline',sub:'Tenders',id}}:null;}},
 variation:{module:'commercial',capability:'commercial.view',load:async(org,id)=>{const r=await one('SELECT id,title,project_id FROM project_variations WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'variation',id,title:String(r.title),module:'commercial',capability:'commercial.view',projectId:String(r.project_id),target:{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'commercial'}}:null;}},
 claim:{module:'commercial',capability:'commercial.view',load:async(org,id)=>{const r=await one('SELECT id,number,period,project_id FROM progress_claims WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'claim',id,title:`Claim ${r.number} — ${r.period}`,module:'commercial',capability:'commercial.view',projectId:String(r.project_id),target:{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'commercial'}}:null;}},
 incident:{module:'ims',capability:'hseq.view',load:async(org,id)=>{const r=await one('SELECT id,reference,incident_type,project_id FROM hseq_incidents WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'incident',id,title:[r.reference,r.incident_type].filter(Boolean).join(' · ')||'Incident',module:'ims',capability:'hseq.view',projectId:r.project_id?String(r.project_id):null,target:r.project_id?{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'quality'}:{area:'IMS & HSEQ'}}:null;}},
 ncr:{module:'ims',capability:'hseq.view',load:async(org,id)=>{const r=await one('SELECT id,reference,issue,project_id FROM hseq_ncrs WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'ncr',id,title:[r.reference,String(r.issue||'').slice(0,100)].filter(Boolean).join(' · ')||'NCR',module:'ims',capability:'hseq.view',projectId:r.project_id?String(r.project_id):null,target:r.project_id?{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'quality'}:{area:'IMS & HSEQ'}}:null;}},
 action:{module:'ims',capability:'hseq.view',load:async(org,id)=>{const r=await one('SELECT id,action,project_id FROM hseq_actions WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'action',id,title:String(r.action||'Action').slice(0,140),module:'ims',capability:'hseq.view',projectId:r.project_id?String(r.project_id):null,target:r.project_id?{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'quality'}:{area:'IMS & HSEQ'}}:null;}},
 swms:{module:'ims',capability:'hseq.view',load:async(org,id)=>{const r=await one('SELECT id,title,project_id FROM swms WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'swms',id,title:String(r.title),module:'ims',capability:'hseq.view',projectId:String(r.project_id),target:{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'quality'}}:null;}},
 itp:{module:'ims',capability:'hseq.view',load:async(org,id)=>{const r=await one('SELECT id,title,project_id FROM itps WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'itp',id,title:String(r.title),module:'ims',capability:'hseq.view',projectId:String(r.project_id),target:{area:'Projects',sub:'Projects',id:String(r.project_id),tab:'quality'}}:null;}},
 workshop_order:{module:'workshop',capability:'workshop.view',load:async(org,id)=>{const r=await one('SELECT id,title FROM workshop_orders WHERE organisation_id=? AND id=?',[org,id]);return r?{type:'workshop_order',id,title:String(r.title),module:'workshop',capability:'workshop.view',projectId:null,target:{area:'Resources',sub:'Workshop'}}:null;}},
};

async function contextInfo(type:CommunicationContext,id:string,write=false){
 const a=actorContext.getStore()!,spec=specs[type],ctx=await spec.load(a.organisationId,id);
 if(!ctx)fail(404,'Communication context not found.');
 const e=await getEntitlements(a.organisationId);
 if(!usable(e,spec.module))fail(404,'Communication context not found.');
 if(write&&!writable(e,spec.module))fail(403,'This workspace is read-only.');
 if(type==='shift'){
  const aud=await shiftAudience(a),m=ctx!.shift!.metadata;
  if(!shiftVisible(aud,{jobId:m.jobId,supervisorUserId:m.supervisorUserId,assignments:m.assignments}))fail(404,'Communication context not found.');
 }else{
  if(!can(a.role,spec.capability))fail(403,'You are not authorised to view this discussion.');
  if(ctx!.projectId&&!await canAccessProject(ctx!.projectId))fail(404,'Communication context not found.');
 }
 return ctx!;
}

async function projectMemberIds(org:string,projectId:string){
 const rows=await query<{user_id:string}>('SELECT user_id FROM project_members WHERE organisation_id=? AND project_id=? AND active=1',[org,projectId]);
 const pm=await one<{project_manager_user_id:string|null}>('SELECT project_manager_user_id FROM jobs WHERE organisation_id=? AND id=?',[org,projectId]);
 return new Set([...rows.map(r=>r.user_id),...(pm?.project_manager_user_id?[pm.project_manager_user_id]:[])]);
}
async function shiftAssignedUserIds(org:string,metadata:Record<string,unknown>){
 const ids=new Set<string>();
 if(metadata.supervisorUserId)ids.add(String(metadata.supervisorUserId));
 const ass=Array.isArray(metadata.assignments)?metadata.assignments as Row[]:[];
 for(const x of ass){if(x.userId)ids.add(String(x.userId));}
 const resourceIds=ass.map(x=>String(x.resourceId||'')).filter(Boolean);
 if(resourceIds.length){
  const rows=await query<{user_id:string}>("SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.userId')) AS user_id FROM workers WHERE organisation_id=? AND id IN (?) AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.userId')) IS NOT NULL",[org,resourceIds]);
  for(const r of rows)if(r.user_id)ids.add(r.user_id);
 }
 return ids;
}

async function eligiblePeople(ctx:ContextInfo){
 const a=actorContext.getStore()!,people=await query<{id:string;name:string|null;email:string;role:string}>("SELECT id,name,email,role FROM users WHERE organisation_id=? AND COALESCE(active,1)=1 ORDER BY name,email",[a.organisationId]);
 const projectIds=ctx.projectId?await projectMemberIds(a.organisationId,ctx.projectId):new Set<string>();
 const shiftIds=ctx.type==='shift'?await shiftAssignedUserIds(a.organisationId,ctx.shift!.metadata):new Set<string>();
 return people.filter(p=>{
  if(!can(p.role,'communication.view'))return false;
  if(ctx.type==='shift'&&p.role==='field')return shiftIds.has(p.id);
  const spec=specs[ctx.type];if(!can(p.role,spec.capability))return false;
  if(ctx.projectId&&!orgWideProjects({organisationId:a.organisationId,userId:p.id,role:p.role})&&!projectIds.has(p.id))return false;
  return true;
 }).map(p=>({id:p.id,name:p.name||p.email,email:p.email,role:p.role}));
}

async function ensureThread(ctx:ContextInfo,conn:Conn){
 const a=actorContext.getStore()!,id=uuid(),now=nowIso();
 await exec("INSERT INTO communication_threads (id,organisation_id,context_type,context_id,project_id,title,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'open',?,?,?) ON DUPLICATE KEY UPDATE id=id",[id,a.organisationId,ctx.type,ctx.id,ctx.projectId,ctx.title,a.userId,now,now],conn);
 const t=await one('SELECT * FROM communication_threads WHERE organisation_id=? AND context_type=? AND context_id=? FOR UPDATE',[a.organisationId,ctx.type,ctx.id],conn);
 if(!t)throw new Error('Communication thread was not created.');
 return t;
}

const trim=(s:string,n:number)=>s.trim().slice(0,n);
function targetColumns(ctx:ContextInfo){return {target_area:ctx.target.area,target_sub:ctx.target.sub||null,target_id:ctx.target.id||null,target_tab:ctx.target.tab||null};}
async function insertNotification(conn:Conn,userId:string,kind:string,title:string,body:string,ctx:ContextInfo){
 const a=actorContext.getStore()!,t=targetColumns(ctx),id=uuid(),created=nowIso();
 await exec('INSERT INTO notifications (id,organisation_id,user_id,kind,title,body,context_type,context_id,project_id,target_area,target_sub,target_id,target_tab,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,a.organisationId,userId,kind,trim(title,255),trim(body,1000),ctx.type,ctx.id,ctx.projectId,t.target_area,t.target_sub,t.target_id,t.target_tab,created],conn);
 return id;
}
async function maybeEmail(userIds:string[],subject:string,text:string){
 if(!userIds.length||!isEmailEnabled())return;
 const a=actorContext.getStore()!,rows=await query<{id:string;email:string;pref_email:number;quiet_start:string|null;quiet_end:string|null;timezone:string|null}>("SELECT u.id,u.email,COALESCE(p.email,0) AS pref_email,p.quiet_start,p.quiet_end,p.timezone FROM users u LEFT JOIN notification_preferences p ON p.organisation_id=u.organisation_id AND p.user_id=u.id WHERE u.organisation_id=? AND u.id IN (?)",[a.organisationId,userIds]);
 for(const r of rows){if(!Number(r.pref_email)||!r.email||inQuietHours(r.quiet_start,r.quiet_end,r.timezone||'Australia/Sydney'))continue;await sendEmail(r.email,subject,text).catch(()=>{});}
}
export function inQuietHours(start:string|null|undefined,end:string|null|undefined,timeZone='Australia/Sydney',when=new Date()){
 if(!start||!end||start===end)return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(when);
 const hh=Number(parts.find(p=>p.type==='hour')?.value||0),mm=Number(parts.find(p=>p.type==='minute')?.value||0),now=hh*60+mm;
 const parse=(v:string)=>{const [h,m]=v.split(':').map(Number);return h*60+m;},a=parse(start),b=parse(end);
 return a<b?now>=a&&now<b:now>=a||now<b;
}

export async function threadFeed(type:CommunicationContext,id:string){
 const a=actorContext.getStore()!,ctx=await contextInfo(type,id,false),people=await eligiblePeople(ctx);
 const thread=await one('SELECT * FROM communication_threads WHERE organisation_id=? AND context_type=? AND context_id=?',[a.organisationId,type,id]);
 if(!thread)return {context:ctx,thread:null,messages:[],people};
 const messages=await query("SELECT m.id,m.parent_message_id,m.author_user_id,m.body,m.requires_ack,m.created_at,u.name AS author_name,u.email AS author_email FROM communication_messages m JOIN users u ON u.organisation_id=m.organisation_id AND u.id=m.author_user_id WHERE m.organisation_id=? AND m.thread_id=? ORDER BY m.created_at,m.id",[a.organisationId,thread.id]);
 const ids=messages.map(m=>m.id),receipts=ids.length?await query("SELECT r.message_id,r.user_id,r.mentioned,r.read_at,r.acknowledged_at,u.name,u.email FROM communication_receipts r JOIN users u ON u.organisation_id=r.organisation_id AND u.id=r.user_id WHERE r.organisation_id=? AND r.message_id IN (?)",[a.organisationId,ids]):[];
 const unread=receipts.filter(r=>r.user_id===a.userId&&!r.read_at).map(r=>r.message_id);
 if(unread.length)await exec('UPDATE communication_receipts SET read_at=? WHERE organisation_id=? AND user_id=? AND message_id IN (?) AND read_at IS NULL',[nowIso(),a.organisationId,a.userId,unread]);
 return {context:ctx,thread:{id:thread.id,title:thread.title,status:thread.status},people,messages:messages.map(m=>({...m,authorName:m.author_name||m.author_email,requiresAck:Boolean(m.requires_ack),receipts:receipts.filter(r=>r.message_id===m.id).map(r=>({userId:r.user_id,name:r.name||r.email,mentioned:Boolean(r.mentioned),readAt:r.read_at,acknowledgedAt:r.acknowledged_at}))}))};
}

export async function sendMessage(input:{contextType:CommunicationContext;contextId:string;body:string;recipientUserIds?:string[];mentionedUserIds?:string[];requiresAck?:boolean;parentMessageId?:string|null}){
 const a=actorContext.getStore()!;if(!can(a.role,'communication.send'))fail(403,'You are not authorised to send messages.');
 const ctx=await contextInfo(input.contextType,input.contextId,true),people=await eligiblePeople(ctx),allowed=new Set(people.map(p=>p.id));
 const recipients=[...new Set([...(input.recipientUserIds||[]),...(input.mentionedUserIds||[])])].filter(x=>x!==a.userId);
 if(recipients.some(x=>!allowed.has(x)))fail(400,'One or more recipients cannot access this work context.');
 if(input.requiresAck&&!recipients.length)fail(400,'Choose at least one recipient for an acknowledgement-required message.');
 const bodyText=trim(input.body,5000);if(!bodyText)fail(400,'Write a message.');
 const mentioned=new Set(input.mentionedUserIds||[]),messageId=uuid(),now=nowIso();
 const author=await one<{name:string|null;email:string}>('SELECT name,email FROM users WHERE organisation_id=? AND id=?',[a.organisationId,a.userId]);
 await tx(async conn=>{
  const thread=await ensureThread(ctx,conn);
  if(input.parentMessageId){const parent=await one('SELECT id FROM communication_messages WHERE organisation_id=? AND thread_id=? AND id=?',[a.organisationId,thread.id,input.parentMessageId],conn);if(!parent)fail(400,'Reply target is not in this discussion.');}
  await exec('INSERT INTO communication_messages (id,organisation_id,thread_id,author_user_id,parent_message_id,body,requires_ack,created_at) VALUES (?,?,?,?,?,?,?,?)',[messageId,a.organisationId,thread.id,a.userId,input.parentMessageId||null,bodyText,input.requiresAck?1:0,now],conn);
  for(const uid of recipients)await exec('INSERT INTO communication_receipts (id,organisation_id,message_id,user_id,mentioned,created_at) VALUES (?,?,?,?,?,?)',[uuid(),a.organisationId,messageId,uid,mentioned.has(uid)?1:0,now],conn);
  for(const uid of recipients)await insertNotification(conn,uid,input.requiresAck?'ack_required':mentioned.has(uid)?'mention':'message',`${author?.name||author?.email||'A colleague'} · ${ctx.title}`,bodyText,ctx);
  await exec('UPDATE communication_threads SET updated_at=? WHERE organisation_id=? AND id=?',[now,a.organisationId,thread.id],conn);
  await audit({event:'communication.message.sent',entityType:'communication_message',entityId:messageId,projectId:ctx.projectId,summary:`Message in ${ctx.title}`,after:{contextType:ctx.type,contextId:ctx.id,recipientCount:recipients.length,requiresAck:Boolean(input.requiresAck)}},conn);
 });
 await maybeEmail(recipients,`${ctx.title}: new Infrastruct message`,`${author?.name||'A colleague'}: ${bodyText}`);
 return {id:messageId};
}

export async function acknowledgeMessage(messageId:string){
 const a=actorContext.getStore()!;
 const r=await one("SELECT r.id,t.context_type,t.context_id FROM communication_receipts r JOIN communication_messages m ON m.organisation_id=r.organisation_id AND m.id=r.message_id JOIN communication_threads t ON t.organisation_id=m.organisation_id AND t.id=m.thread_id WHERE r.organisation_id=? AND r.message_id=? AND r.user_id=?",[a.organisationId,messageId,a.userId]);
 if(!r)fail(404,'Acknowledgement not found.');
 await contextInfo(r.context_type as CommunicationContext,String(r.context_id),false);
 const at=nowIso();await exec('UPDATE communication_receipts SET read_at=COALESCE(read_at,?),acknowledged_at=COALESCE(acknowledged_at,?) WHERE organisation_id=? AND id=?',[at,at,a.organisationId,r.id]);
 return {acknowledgedAt:at};
}

export async function notificationsFeed(limit=50){
 const a=actorContext.getStore()!,n=Math.min(Math.max(limit,1),100);
 const rows=await query('SELECT * FROM notifications WHERE organisation_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT ?',[a.organisationId,a.userId,n]);
 const pref=await one('SELECT in_app,email,sms,quiet_start,quiet_end,timezone FROM notification_preferences WHERE organisation_id=? AND user_id=?',[a.organisationId,a.userId]);
 return {unread:rows.filter(r=>!r.read_at).length,notifications:rows.map(r=>({id:r.id,kind:r.kind,title:r.title,body:r.body,readAt:r.read_at,createdAt:r.created_at,target:{area:r.target_area,sub:r.target_sub,id:r.target_id,tab:r.target_tab}})),preferences:pref?{inApp:Boolean(pref.in_app),email:Boolean(pref.email),sms:Boolean(pref.sms),quietStart:pref.quiet_start,quietEnd:pref.quiet_end,timezone:pref.timezone}:{inApp:true,email:false,sms:false,quietStart:null,quietEnd:null,timezone:'Australia/Sydney'}};
}
export async function markNotification(id:string|null){
 const a=actorContext.getStore()!,at=nowIso();
 if(id){const n=await exec('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE organisation_id=? AND user_id=? AND id=?',[at,a.organisationId,a.userId,id]);if(!n)fail(404,'Notification not found.');}
 else await exec('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE organisation_id=? AND user_id=?',[at,a.organisationId,a.userId]);
 return {ok:true};
}
export async function saveNotificationPreferences(p:{email:boolean;sms:boolean;quietStart:string|null;quietEnd:string|null;timezone:string}){
 const a=actorContext.getStore()!,id=uuid(),now=nowIso();
 try{new Intl.DateTimeFormat('en-AU',{timeZone:p.timezone}).format(new Date());}catch{fail(400,'Choose a valid timezone.');}
 // SMS is stored as preference only until a provider is configured; no number is exposed to advertisers/providers.
 await exec('INSERT INTO notification_preferences (id,organisation_id,user_id,in_app,email,sms,quiet_start,quiet_end,timezone,updated_at) VALUES (?,?,?,1,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),sms=VALUES(sms),quiet_start=VALUES(quiet_start),quiet_end=VALUES(quiet_end),timezone=VALUES(timezone),updated_at=VALUES(updated_at)',[id,a.organisationId,a.userId,p.email?1:0,p.sms?1:0,p.quietStart,p.quietEnd,trim(p.timezone,80)||'Australia/Sydney',now]);
 return notificationsFeed();
}

const tokenHash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
export async function createExternalShiftLink(input:{shiftId:string;recipientName?:string;recipientEmail?:string;recipientPhone?:string;expiresDays?:number}){
 const a=actorContext.getStore()!;if(!can(a.role,'external.share'))fail(403,'You are not authorised to create external job links.');
 const ctx=await contextInfo('shift',input.shiftId,true),days=Math.min(Math.max(Math.trunc(input.expiresDays||7),1),30);
 const raw=randomBytes(32).toString('base64url'),id=uuid(),created=nowIso(),expires=new Date(Date.now()+days*86400000).toISOString();
 await exec('INSERT INTO external_access_tokens (id,organisation_id,token_hash,context_type,context_id,project_id,recipient_name,recipient_email,recipient_phone,scopes,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)',[id,a.organisationId,tokenHash(raw),'shift',input.shiftId,ctx.projectId,trim(input.recipientName||'',180)||null,trim(input.recipientEmail||'',254)||null,trim(input.recipientPhone||'',60)||null,'view,acknowledge,respond,upload',expires,a.userId,created]);
 await audit({event:'external.link.created',entityType:'external_access',entityId:id,projectId:ctx.projectId,summary:`External job link created for ${ctx.title}`,after:{shiftId:input.shiftId,expiresAt:expires,recipientEmail:input.recipientEmail||null}});
 return {id,path:`/external/job/${raw}`,expiresAt:expires};
}
export async function listExternalShiftLinks(shiftId:string){
 const a=actorContext.getStore()!;if(!can(a.role,'external.share'))fail(403,'You are not authorised to manage external job links.');
 await contextInfo('shift',shiftId,false);
 const rows=await query("SELECT t.id,t.recipient_name,t.recipient_email,t.recipient_phone,t.expires_at,t.revoked_at,t.last_accessed_at,t.created_at,(SELECT r.kind FROM external_responses r WHERE r.organisation_id=t.organisation_id AND r.token_id=t.id ORDER BY r.created_at DESC LIMIT 1) AS last_response FROM external_access_tokens t WHERE t.organisation_id=? AND t.context_type='shift' AND t.context_id=? ORDER BY t.created_at DESC",[a.organisationId,shiftId]);
 return rows.map(r=>({id:r.id,recipientName:r.recipient_name,recipientEmail:r.recipient_email,recipientPhone:r.recipient_phone,expiresAt:r.expires_at,revokedAt:r.revoked_at,lastAccessedAt:r.last_accessed_at,createdAt:r.created_at,lastResponse:r.last_response}));
}
export async function revokeExternalLink(id:string){
 const a=actorContext.getStore()!;if(!can(a.role,'external.share'))fail(403,'You are not authorised to manage external job links.');
 const row=await one("SELECT context_id,project_id FROM external_access_tokens WHERE organisation_id=? AND id=? AND context_type='shift'",[a.organisationId,id]);if(!row)fail(404,'External link not found.');
 await contextInfo('shift',String(row.context_id),true);
 await exec('UPDATE external_access_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE organisation_id=? AND id=?',[nowIso(),a.organisationId,id]);
 await audit({event:'external.link.revoked',entityType:'external_access',entityId:id,projectId:row.project_id,summary:'External job link revoked'});
 return {ok:true};
}

async function externalToken(raw:string){
 const hash=tokenHash(raw),row=await one("SELECT * FROM external_access_tokens WHERE token_hash=? AND context_type='shift'",[hash]);
 if(!row||row.revoked_at||String(row.expires_at)<=new Date().toISOString())fail(404,'This job link is invalid or has expired.');
 const entitlements=await getEntitlements(String(row.organisation_id));
 if(!usable(entitlements,'operations'))fail(404,'This job link is invalid or has expired.');
 const shift=await one<{metadata:string|Record<string,unknown>}>('SELECT metadata FROM shifts WHERE organisation_id=? AND id=?',[row.organisation_id,row.context_id]);
 if(!shift)fail(404,'This job link is invalid or has expired.');
 const metadata=typeof shift.metadata==='string'?JSON.parse(shift.metadata||'{}'):shift.metadata||{},currentProject=metadata.jobId?String(metadata.jobId):null;
 if((row.project_id||null)!==currentProject)fail(404,'This job link is invalid or has expired.');
 await exec('UPDATE external_access_tokens SET last_accessed_at=? WHERE id=?',[nowIso(),row.id]);
 return row!;
}
function safeExternalDocumentsWhere(){return "(visibility='field' AND status='current' AND ((project_id=? AND context_type IN ('project','swms','itp')) OR (context_type='field' AND context_id=?)))";}
export async function externalJob(raw:string){
 const t=await externalToken(raw),shift=await one('SELECT id,name,status,metadata,location_id FROM shifts WHERE organisation_id=? AND id=?',[t.organisation_id,t.context_id]);if(!shift)fail(404,'This job is no longer available.');
 const m=typeof shift.metadata==='string'?JSON.parse(shift.metadata||'{}'):shift.metadata||{},projectId=t.project_id||m.jobId||null;
 const job=projectId?await one('SELECT id,name,client_name,site_address,metadata,location_id FROM jobs WHERE organisation_id=? AND id=?',[t.organisation_id,projectId]):null;
 const jm=job?(typeof job.metadata==='string'?JSON.parse(job.metadata||'{}'):job.metadata||{}):{};
 let loc:{formatted_address:string|null;pin_address:string|null;pin_lat:string|number|null;pin_lng:string|number|null}|null=null;
 const locId=shift.location_id||job?.location_id||null;
 if(locId)loc=await one('SELECT formatted_address,pin_address,pin_lat,pin_lng FROM locations WHERE organisation_id=? AND id=?',[t.organisation_id,locId]);
 const docs=projectId?await query(`SELECT id,title,file_name,category FROM documents WHERE organisation_id=? AND ${safeExternalDocumentsWhere()} ORDER BY created_at DESC LIMIT 50`,[t.organisation_id,projectId,shift.id]):[];
 const responses=await query('SELECT kind,payload,created_at FROM external_responses WHERE organisation_id=? AND token_id=? ORDER BY created_at DESC',[t.organisation_id,t.id]);
 return {tokenId:t.id,recipient:{name:t.recipient_name,email:t.recipient_email},shift:{id:shift.id,name:shift.name,status:shift.status,date:m.date||null,start:m.start||null,finish:m.finish||null,scope:m.scope||null,siteContact:m.siteContact||jm.siteContact||null,project:job?.name||null,client:job?.client_name||jm.client||null,site:job?.site_address||jm.site||m.location||null,location:loc?{address:loc.pin_address||loc.formatted_address,lat:loc.pin_lat==null?null:Number(loc.pin_lat),lng:loc.pin_lng==null?null:Number(loc.pin_lng)}:null},documents:docs.map(d=>({id:d.id,title:d.title,fileName:d.file_name,category:d.category,url:`/api/external/document?token=${encodeURIComponent(raw)}&id=${encodeURIComponent(d.id)}`})),responses:responses.map(r=>({kind:r.kind,payload:r.payload?JSON.parse(r.payload):null,createdAt:r.created_at}))};
}
export async function externalRespond(raw:string,kind:'accepted'|'declined'|'acknowledged'|'details',payload:Record<string,unknown>={}){
 const t=await externalToken(raw),now=nowIso(),id=uuid();
 await exec('INSERT INTO external_responses (id,organisation_id,token_id,kind,payload,created_at) VALUES (?,?,?,?,?,?)',[id,t.organisation_id,t.id,kind,JSON.stringify(payload),now]);
 const creator=await one<{id:string}>('SELECT id FROM users WHERE organisation_id=? AND id=?',[t.organisation_id,t.created_by]);
 if(creator){const shift=await one('SELECT name FROM shifts WHERE organisation_id=? AND id=?',[t.organisation_id,t.context_id]);await exec('INSERT INTO notifications (id,organisation_id,user_id,kind,title,body,context_type,context_id,project_id,target_area,target_sub,target_id,target_tab,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[uuid(),t.organisation_id,creator.id,'external_response',`External response · ${shift?.name||'Shift'}`,`${t.recipient_name||t.recipient_email||'External recipient'}: ${kind}`,'shift',t.context_id,t.project_id,'Projects','Projects',t.project_id,'delivery',now]);}
 await audit({event:'external.response',entityType:'external_access',entityId:t.id,projectId:t.project_id,summary:`External recipient ${kind}`,after:{kind,payload},organisationId:t.organisation_id,actorUserId:null,actorEmail:t.recipient_email||null});
 return {id,kind,createdAt:now};
}

const EXTERNAL_MAX=20*1024*1024,EXTERNAL_FILE=/\.(pdf|png|jpe?g|webp|heic)$/i;
export async function externalUpload(raw:string,file:File){
 const t=await externalToken(raw);if(!file.size||file.size>EXTERNAL_MAX)fail(413,'Evidence files must be 20 MB or smaller.');if(!EXTERNAL_FILE.test(file.name))fail(415,'Upload a PDF or image.');
 const id=uuid(),key=`documents/${t.organisation_id}/${id}`,now=nowIso(),bytes=new Uint8Array(await file.arrayBuffer()),sha=createHash('sha256').update(bytes).digest('hex');
 await bucket.put(key,bytes,{httpMetadata:{contentType:file.type||'application/octet-stream'}});
 await exec("INSERT INTO documents (id,organisation_id,context_type,context_id,project_id,category,title,file_name,content_type,size_bytes,storage_key,sha256,version,status,visibility,source,supersedes_id,uploaded_by,created_at,updated_at) VALUES (?,?,?,?,?,'External evidence',?,?,?,?,?,?,1,'current','field','external_link',NULL,NULL,?,?)",[id,t.organisation_id,'field',t.context_id,t.project_id,file.name.slice(0,255),file.name.slice(0,255),(file.type||'application/octet-stream').slice(0,120),file.size,key,sha,now,now]);
 await audit({event:'external.evidence.uploaded',entityType:'document',entityId:id,projectId:t.project_id,summary:`External evidence: ${file.name}`,organisationId:t.organisation_id,actorUserId:null,actorEmail:t.recipient_email||null});
 return {id,name:file.name};
}
export async function externalDocument(raw:string,id:string){
 const t=await externalToken(raw),doc=await one(`SELECT * FROM documents WHERE organisation_id=? AND id=? AND ${safeExternalDocumentsWhere()}`,[t.organisation_id,id,t.project_id,t.context_id]);if(!doc)fail(404,'Document not found.');
 const object=await bucket.get(doc.storage_key);if(!object)fail(404,'Document not found.');
 return new Response(object.body,{headers:{'Content-Type':doc.content_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
}


/** Best-effort operational notification after a shift save. Never call this before the shift commits. */
export async function notifyShiftChange(current:{id:string;name:string;status:string;metadata:Record<string,unknown>},previous?:{id:string;name:string;status:string;metadata:Record<string,unknown>}){
 const a=actorContext.getStore();if(!a)return;
 const next=current.metadata||{},before=previous?.metadata||{};
 const previousIds=previous?await shiftAssignedUserIds(a.organisationId,before):new Set<string>(),nextIds=await shiftAssignedUserIds(a.organisationId,next);
 const audience=new Set([...previousIds,...nextIds]);audience.delete(a.userId);if(!audience.size)return;
 const fields:Array<[string,string]>=[['date','date'],['start','start time'],['finish','finish time'],['scope','scope']];
 const changed=fields.filter(([k])=>String(before[k]??'')!==String(next[k]??'')).map(([,label])=>label);
 if(previous&&previous.status!==current.status)changed.push('status');
 const oldAss=[...previousIds].sort().join('|'),newAss=[...nextIds].sort().join('|');if(oldAss!==newAss)changed.push('resources');
 if(previous&&!changed.length)return;
 const projectId=next.jobId?String(next.jobId):null,ctx:ContextInfo={type:'shift',id:current.id,title:current.name,module:'operations',capability:'schedule.view',projectId,target:projectId?{area:'Projects',sub:'Projects',id:projectId,tab:'delivery'}:{area:'Schedule',sub:'Schedule'},shift:{id:current.id,metadata:next}};
 const title=previous?'Shift changed · '+current.name:'New shift · '+current.name,body=previous?(changed.length?'Updated: '+changed.join(', '):'Shift details updated'):[next.date,next.start,next.finish].filter(Boolean).join(' · ')||'New shift assigned';
 await tx(async conn=>{for(const uid of audience)await insertNotification(conn,uid,'shift_changed',title,body,ctx);});
 await maybeEmail([...audience],title,body);
}
