import { ZodError } from 'zod';
import { requireActor, type Actor } from './authz';
import { type PreparationRecord, type EvidenceRef, dataSchema, recordIssues } from './preparation';
export function fail(message:string,status=422):never{throw Object.assign(new Error(message),{status});}
export async function preparationActor(request:Request,db:D1Database,action='read'){
 const actor=await requireActor(request,db,'read',true);
 const admins=['owner/admin','admin'];
 const editors=[...admins,'estimator/commercial manager','commercial manager','estimator','bid coordinator','ims/qa/safety lead','project manager','operations/scheduler'];
 const approvers=[...admins,'estimator/commercial manager','commercial manager','ims/qa/safety lead','project manager'];
 if(action==='admin'&&!admins.includes(actor.role)||['approve','handover','accept','exception','submit'].includes(action)&&!approvers.includes(actor.role)||!['read','admin','approve','handover','accept','exception','submit'].includes(action)&&!editors.includes(actor.role))fail('You are not authorised for this preparation action.',403);
 return actor;
}
export async function preparationRecords(db:D1Database,org:string){const r=await db.prepare('SELECT * FROM preparation_revisions WHERE organisation_id=? ORDER BY created_at,revision').bind(org).all<Omit<PreparationRecord,'data'>&{data:string}>();return r.results.map(r=>({...r,data:dataSchema.parse(JSON.parse(r.data))}));}
export function latestRecords(records:PreparationRecord[]){const map=new Map<string,PreparationRecord>();for(const r of records)if(!map.has(r.id)||map.get(r.id)!.revision<r.revision)map.set(r.id,r);return [...map.values()];}
export function exact(records:PreparationRecord[],ref:EvidenceRef){return records.find(r=>r.id===ref.id&&r.revision===ref.revision);}
export async function checkLinks(db:D1Database,actor:Actor,record:PreparationRecord,records:PreparationRecord[]){
 for(const [table,id] of [['jobs',record.job_id],['opportunities',record.opportunity_id]] as const)if(id&&!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND organisation_id=?`).bind(id,actor.organisationId).first())fail('Linked project or opportunity not found.',404);
 const references=[...record.data.evidence,...record.data.manifest,...record.data.rows.flatMap(r=>r.evidence),...(record.data.origin?[record.data.origin]:[])];
 for(const ref of references)if(!exact(records,ref))fail('Evidence revision not found in this organisation.',404);
 const attachments=new Set([...record.data.attachments,...record.data.sourcePages.map(p=>p.fileId),...record.data.rows.map(r=>r.sourceId).filter(Boolean)]);
 for(const id of attachments)if(!await db.prepare('SELECT id FROM attachments WHERE id=? AND organisation_id=?').bind(id,actor.organisationId).first())fail('Source file not found in this organisation.',404);
 for(const owner of new Set([record.data.owner,...record.data.rows.map(r=>r.owner)].filter(Boolean)))if(owner!==actor.userId&&!await db.prepare('SELECT id FROM users WHERE id=? AND organisation_id=?').bind(owner,actor.organisationId).first())fail('Assigned owner is not an organisation member.');
}
export function appendStatements(db:D1Database,record:PreparationRecord){return [
 db.prepare('INSERT INTO preparation_revisions (id,organisation_id,revision,kind,title,status,job_id,opportunity_id,data,actor_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(record.id,record.organisation_id,record.revision,record.kind,record.title,record.status,record.job_id,record.opportunity_id,JSON.stringify(record.data),record.actor_id,record.reason,record.created_at),
 db.prepare('INSERT INTO audit_events (id,organisation_id,name,status,metadata,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),record.organisation_id,'preparation.'+record.reason,'recorded',JSON.stringify({id:record.id,revision:record.revision,actorId:record.actor_id,status:record.status}),record.created_at)
 ];}
export function entitlement(kind:string){return ['submission','answer'].includes(kind)?'tender':kind==='settings'||kind==='company'?'core':'ims';}
export function enabled(records:PreparationRecord[],module:string){const setting=latestRecords(records).find(r=>r.kind==='settings');return setting?.data.entitlements[module]!==false;}
export function issuesFor(record:PreparationRecord,records:PreparationRecord[]){
 const issues=recordIssues(record,r=>exact(records,r));const visited=new Set<string>();
 const visit=(ref:EvidenceRef)=>{const key=`${ref.id}:${ref.revision}`;if(visited.has(key))return;visited.add(key);const evidence=exact(records,ref);if(!evidence)return;issues.push(...recordIssues(evidence,r=>exact(records,r)).map(i=>`${evidence.title}: ${i}`));for(const r of [...evidence.data.evidence,...evidence.data.rows.flatMap(row=>row.evidence)])visit(r);};
 for(const ref of [...record.data.evidence,...record.data.rows.flatMap(r=>r.evidence)])visit(ref);return [...new Set(issues)];
}
export async function preparationReadiness(db:D1Database,org:string,jobId:string){
 const records=await preparationRecords(db,org);const packs=latestRecords(records).filter(r=>r.kind==='project-pack'&&r.job_id===jobId);
 if(!packs.length)return null;
 return packs.flatMap(p=>[...(p.status!=='Approved'&&p.status!=='Accepted'?['Pre-commencement pack requires authorised approval.']:[]),...issuesFor(p,records)]);
}
export function preparationError(error:unknown){if(error instanceof ZodError)return Response.json({error:error.issues.map(i=>i.path.join('.')+': '+i.message).join('\n')},{status:422});const status=Number((error as {status?:number})?.status)||(/UNIQUE constraint/.test(String(error))?409:500);return Response.json({error:status===500?'Preparation could not be saved or loaded. Your entered content has not been cleared.':status===409?'This record changed. Reload before saving again.':(error as Error).message},{status});}
