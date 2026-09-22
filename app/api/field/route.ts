import {withActor} from '@/lib/platform/route';
import {requireActor} from '@/lib/authz';
import { DEFAULT_ORGANISATION_ID as ORG, requireEstimateDb, jsonError } from '@/lib/estimates-db';
import { initialField, incomplete, invalidField, type FieldData, type FieldRecord } from '@/lib/field';
import type { DeliveryRecord } from '@/lib/planning';
export const dynamic='force-dynamic';
async function actor(request:Request) { const a=await requireActor(request,requireEstimateDb(),'read',true); return {id:a.userId,email:a.email,role:a.role,canSubmit:['admin','office','field'].includes(a.role),canAmend:['admin','office'].includes(a.role)}; }
async function record(shiftId:string):Promise<FieldRecord|null>{
 const r=await requireEstimateDb().prepare('SELECT * FROM field_records WHERE shift_id=? AND organisation_id=?').bind(shiftId,ORG()).first<Record<string,unknown>>();
 return r?{shiftId:String(r.shift_id),revision:Number(r.revision),status:String(r.status),data:JSON.parse(String(r.data)),plan:JSON.parse(String(r.plan)),job:JSON.parse(String(r.job)),updatedAt:String(r.updated_at)}:null;
}
async function handleGET(request:Request){try{
 const user=await actor(request);if(!user)return jsonError('Sign in to open field records.',401);
 const id=new URL(request.url).searchParams.get('shiftId');
 if(!id){const rows=await requireEstimateDb().prepare('SELECT shift_id,status,revision FROM field_records WHERE organisation_id=?').bind(ORG()).all();return Response.json({user,records:rows.results});}
 const r=await record(id);const history=await requireEstimateDb().prepare('SELECT revision,action,reason,actor,snapshot,created_at FROM field_history WHERE shift_id=? AND organisation_id=? ORDER BY revision DESC').bind(id,ORG()).all();
 return Response.json({user,record:r,history:history.results});
}catch(e){console.error(e);return jsonError('Field records could not be loaded.',503);}}
async function handlePOST(request:Request){try{
 const user=await actor(request);if(!user)return jsonError('Sign in to save field records.',401);
 const body=await request.json() as {shiftId:string;revision:number;action:string;reason:string;data:FieldData};
 if(!['save','submit','amend'].includes(body.action))return jsonError('Invalid action.');
 const db=requireEstimateDb();const previous=await record(body.shiftId);
 if((previous?.revision||0)!==body.revision)return jsonError('This record changed on another device. Your draft is retained; reload and reconcile before saving.',409);
 if(previous?.status==='Submitted'&&body.action!=='amend')return jsonError('Submitted record is locked. Use an authorised amendment.',409);
 if(body.action==='amend'&&(!user.canAmend||previous?.status!=='Submitted'))return jsonError('Only a manager or administrator can amend submitted records.',403);
 if(body.action==='amend'&&!body.reason?.trim())return jsonError('An amendment reason is required.');
 if(body.action==='submit'&&!user.canSubmit)return jsonError('Supervisor authorisation is required to submit.',403);
 const row=await db.prepare('SELECT * FROM shifts WHERE id=? AND organisation_id=?').bind(body.shiftId,ORG()).first<{id:string;name:string;status:string;metadata:string}>();
 if(!row)return jsonError('Planned shift not found.',404);
 if(['Cancelled','Draft'].includes(row.status)&&!previous)return jsonError('Plan this shift before opening a Field record.',422);
 const plan:DeliveryRecord=previous?.plan||{...row,metadata:JSON.parse(row.metadata)};
 const jobRow=await db.prepare('SELECT * FROM jobs WHERE id=? AND organisation_id=?').bind(String(plan.metadata.jobId),ORG()).first<{id:string;name:string;status:string;metadata:string}>();
 if(!jobRow)return jsonError('The shift job is missing.',422);
 const job=previous?.job||{...jobRow,metadata:JSON.parse(jobRow.metadata)};
 const data={...initialField(plan),...body.data};
 const errors=body.action==='save'?invalidField(data):incomplete(data);
 if(errors.length)return jsonError('Complete the highlighted requirements.',422,{requirements:errors});
 const now=new Date().toISOString(), revision=body.revision+1,status=body.action==='save'?'Draft':'Submitted';
 const saved={shiftId:body.shiftId,revision,status,data,plan,job,updatedAt:now};
 // Unique (shift, revision) makes concurrent saves fail atomically with their audit entry.
 const writes=[db.prepare('INSERT INTO field_history (id,shift_id,organisation_id,revision,action,reason,actor,snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),body.shiftId,ORG(),revision,body.action,body.reason||'',JSON.stringify(user),JSON.stringify(saved),now)];
 writes.push(previous?db.prepare('UPDATE field_records SET revision=?,status=?,data=?,updated_at=? WHERE shift_id=? AND organisation_id=? AND revision=?').bind(revision,status,JSON.stringify(data),now,body.shiftId,ORG(),body.revision):db.prepare('INSERT INTO field_records (shift_id,organisation_id,revision,status,data,plan,job,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(body.shiftId,ORG(),revision,status,JSON.stringify(data),JSON.stringify(plan),JSON.stringify(job),now));
 if(status==='Submitted')writes.push(db.prepare("UPDATE shifts SET status='Completed' WHERE id=? AND organisation_id=?").bind(body.shiftId,ORG()));
 await db.batch(writes);
 return Response.json({record:saved,user},{status:previous?200:201});
}catch(e){console.error(e);if(String(e).includes('UNIQUE'))return jsonError('Another save completed first. Reload to reconcile your retained draft.',409);return jsonError('Save failed. Your draft has been retained on this device.',503);}}

export const GET=withActor(handleGET,'read');

export const POST=withActor(handlePOST,'field');
