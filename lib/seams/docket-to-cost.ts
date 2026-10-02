// SEAM: Approved docket → actual project cost.
// Idempotent: one cost_transactions row per (organisation, 'docket', docket id, line).
// Re-approval or re-processing updates the same rows; it never duplicates.
// Returning a docket to review reverses (status='reversed') unclaimed costs.
// Downstream off (projects not entitled): docket stays approved and exportable.
import {database,type Statement,type QueryResult} from '@/lib/platform/database';
import type {Pool,PoolConnection} from 'mysql2/promise';
import {actorContext} from '@/lib/platform/context';
import {requireSeam} from '@/lib/platform/entitlements';
import {domainEventStatement} from '@/lib/platform/domain-events';
import {safeJson} from '@/lib/estimates-db';

export type Docket={id:string;docket_no:string;work_date:string;amount:number;quantity:number;quantity_unit:string;labour_hours:number;line_items:string;links:string;status:string;notes:string};
const r2=(n:unknown)=>Math.round((Number(n)||0)*100)/100;
export function costCategory(text:string){
 const s=text.toLowerCase();
 if(/labou?r|operator|supervisor|hand|crew|wages|hourly/.test(s))return 'labour';
 if(/subcontract|traffic control|tc crew|linemark|survey/.test(s))return 'subcontract';
 if(/plant|paver|roller|excavat|grader|broom|sweeper|truck|tipper|hire|profiler|loader|bobcat|float/.test(s))return 'plant';
 if(/asphalt|material|ac1|ac2|sma|tonne|aggregate|concrete|cement|pipe|bitumen|emulsion|supply|gravel|sand|base/.test(s))return 'material';
 return 'other';
}
// ---- Allocation history -------------------------------------------------------------------------------------------------------
// A docket's cost rows are keyed (docket, line). The first allocation uses the plain line key; each later move of an allocated docket
// (another project, or cleared) adds an "@n" suffix (links.allocationSeq). The previous rows are REVERSED, never overwritten or deleted,
// so the cost that was once posted to the old project stays on record with its original project, and the new cost is a fresh set of rows.
export const lineKey=(line:string,seq:number)=>seq>0?`${line}@${seq}`:line;
export const allocationSeq=(links:unknown)=>{const n=Number((links as Record<string,unknown>|null)?.allocationSeq);return Number.isInteger(n)&&n>0?n:0;};
export const jobOf=(links:unknown)=>String((links as Record<string,unknown>|null)?.jobId||'').trim();
/**
 * The links to store after an edit. jobId and allocationSeq are controlled here, never taken from the client: the sequence only advances
 * when an already-allocated docket moves or is cleared. The shift link belonged to the previous project, so it is dropped on any change.
 */
export function nextAllocationLinks(stored:Record<string,unknown>,incoming:Record<string,unknown>){
 const from=jobOf(stored),to=jobOf(incoming),changed=from!==to;
 const links:Record<string,unknown>={...incoming};delete links.allocationSeq;delete links.jobId;
 if(to)links.jobId=to;
 const seq=allocationSeq(stored)+(from&&changed?1:0);
 if(seq>0)links.allocationSeq=seq;
 if(changed)delete links.shiftId;
 return {links,from,to,changed,seq};
}
const CODE:Record<string,string>={labour:'100',plant:'200',material:'300',subcontract:'400',other:'500'};

export function docketCostLines(d:Docket){
 const items=safeJson<Array<Record<string,unknown>>>(d.line_items,[]);
 const lines=items.map((it,i)=>{const qty=Number(it.quantity)||0,rate=Number(it.rate)||0,amount=r2(Number(it.amount)||qty*rate);const description=String(it.description||it.item||`Line ${i+1}`);return {line:`L${i+1}`,description,quantity:qty,unit:String(it.unit||''),rate:rate||null,amount,category:costCategory(description)};}).filter(l=>l.amount!==0);
 const itemised=r2(lines.reduce((n,l)=>n+l.amount,0));
 if(!lines.length&&r2(d.amount)!==0)return [{line:'TOTAL',description:`Docket ${d.docket_no}`,quantity:Number(d.quantity)||0,unit:d.quantity_unit||'',rate:null,amount:r2(d.amount),category:costCategory(`${d.notes} ${d.docket_no}`)}];
 // If the docket total differs from its itemised lines, post the difference so actual cost equals the approved docket amount.
 if(lines.length&&r2(d.amount)&&Math.abs(r2(d.amount)-itemised)>=0.01)lines.push({line:'ADJ',description:`Docket ${d.docket_no} total adjustment`,quantity:0,unit:'',rate:null,amount:r2(d.amount-itemised),category:'other'});
 return lines;
}

/** Returns statements to run in the same transaction as the docket status change. */
export async function docketCostStatements(docketId:string,nextStatus:string,next:Partial<Docket>={},meta:{reason?:string}={},conn?:Pool|PoolConnection):Promise<{statements:Statement[];posted:number;message:string|null}>{
 const actor=actorContext.getStore()!,org=actor.organisationId,now=new Date().toISOString();
 // Reads run on the caller's connection, so inside its transaction they see the rows it has locked.
 const read=async<T>(sql:string,...values:unknown[])=>(await database.prepare(sql).bind(...values).execute<T>(conn) as QueryResult<T>).results;
 const first=async<T>(sql:string,...values:unknown[])=>(await read<T>(sql,...values))[0]??null;
 const stored=await first<Docket>('SELECT id,docket_no,work_date,amount,quantity,quantity_unit,labour_hours,line_items,links,status,notes FROM dockets WHERE organisation_id=? AND id=?',org,docketId);
 if(!stored)return {statements:[],posted:0,message:null};
 // Cost lines reflect the values being saved in this same transaction.
 const d:Docket={...stored,...next,status:stored.status};
 const claimed=['included_claim','invoiced'].includes(d.status);
 const storedLinks=safeJson<Record<string,unknown>>(stored.links,{}),nextLinks=safeJson<Record<string,unknown>>(d.links,{});
 const from=jobOf(storedLinks),jobId=jobOf(nextLinks),seq=allocationSeq(nextLinks),moved=stored.status==='approved'&&Boolean(from)&&from!==jobId;
 const reverseAll=database.prepare("UPDATE cost_transactions SET status='reversed',updated_at=? WHERE organisation_id=? AND source_type='docket' AND source_id=? AND status<>'reversed'").bind(now,org,docketId);
 const posted=await first<{n:number;amount:number}>("SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS amount FROM cost_transactions WHERE organisation_id=? AND source_type='docket' AND source_id=? AND status='actual'",org,docketId);
 const reallocationAudit=(to:string,lines:unknown[])=>database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,before_state,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org,actor.userId,actor.email,'docket.reallocated','docket',docketId,to||from,`Docket ${d.docket_no}: posted costs moved ${to?'to another project':'out of the project (cleared)'}${nextStatus!=='approved'?' and the docket returned to review':''}${meta.reason?` — ${meta.reason}`:''}`.slice(0,500),JSON.stringify({projectId:from,reversed:{lines:Number(posted?.n||0),amount:r2(posted?.amount)}}),JSON.stringify({projectId:to||null,allocationSeq:seq,status:nextStatus,reason:meta.reason||null,reposted:lines}),now);
 const projectStage=async(id:string)=>(await first<{stage:string|null}>('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',org,id))?.stage;
 // Moving posted cost out of a closed project is as much a change to it as posting into one, whatever status the docket ends in: reopen it first (the existing audited process).
 if(moved&&await projectStage(from)==='closed')throw Object.assign(new Error('The project these costs were posted to is closed. Reopen it before moving costs out of it.'),{status:409});
 if(nextStatus!=='approved'){
  if(claimed)return {statements:[],posted:0,message:null};
  return {statements:[reverseAll,...(moved?[reallocationAudit(jobId,[])]:[])],posted:0,message:null};
 }
 const event=await domainEventStatement('docket.approved',docketId,crypto.randomUUID());
 if(!jobId)return {statements:[event,reverseAll,...(moved?[reallocationAudit('',[])]:[])],posted:0,message:'Approved. This docket is not allocated to a project, so no cost is posted'+(Number(posted?.n)?' and the cost previously posted was reversed.':'.')};
 if(!await requireSeam('docket.cost'))return {statements:[event],posted:0,message:'Approved. Projects is not enabled, so costs were not posted; the docket remains exportable.'};
 const job=await first<{id:string;stage:string|null;status:string}>('SELECT id,stage,status FROM jobs WHERE organisation_id=? AND id=?',org,jobId);
 if(!job)return {statements:[event,reverseAll,...(moved?[reallocationAudit('',[])]:[])],posted:0,message:'Approved. The allocated project no longer exists; no cost was posted'+(Number(posted?.n)?' and the cost previously posted was reversed.':'.')};
 if(job.stage==='closed')throw Object.assign(new Error('This project is closed. Reopen it before approving dockets against it.'),{status:409});
 const codes=await read<{code:string;category:string}>("SELECT code,category FROM project_cost_codes WHERE organisation_id=? AND project_id=? AND status='active'",org,jobId);
 const lines=docketCostLines(d);
 const statements:Statement[]=[event,
  // Lines that no longer exist after an edit are reversed rather than deleted (rows already reversed keep their original timestamps).
  reverseAll,
  ...lines.map(l=>{const code=codes.find(c=>c.code===CODE[l.category])?.code??codes.find(c=>c.category===l.category)?.code??null;
   return database.prepare("INSERT INTO cost_transactions (id,organisation_id,project_id,cost_code,category,source_type,source_id,source_line,description,quantity,unit,rate,amount,transaction_date,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'docket',?,?,?,?,?,?,?,?,'actual',?,?,?) ON DUPLICATE KEY UPDATE project_id=VALUES(project_id),cost_code=VALUES(cost_code),category=VALUES(category),description=VALUES(description),quantity=VALUES(quantity),unit=VALUES(unit),rate=VALUES(rate),amount=VALUES(amount),transaction_date=VALUES(transaction_date),status='actual',updated_at=VALUES(updated_at)")
    .bind(crypto.randomUUID(),org,jobId,code,l.category,docketId,lineKey(l.line,seq),l.description.slice(0,500),l.quantity,l.unit.slice(0,20),l.rate,l.amount,d.work_date,actor.userId,now,now);}),
  database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org,actor.userId,actor.email,'docket.approved','docket',docketId,jobId,`Docket ${d.docket_no} approved; ${lines.length} cost line${lines.length===1?'':'s'} posted (${r2(lines.reduce((n,l)=>n+l.amount,0)).toFixed(2)})`,JSON.stringify({lines}),now),
 ...(moved?[reallocationAudit(jobId,lines)]:[]),
 ];
 return {statements,posted:lines.length,message:lines.length?null:'Approved. The docket has no amount, so no cost was posted.'};
}
