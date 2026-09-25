// SEAM: Approved docket → actual project cost.
// Idempotent: one cost_transactions row per (organisation, 'docket', docket id, line).
// Re-approval or re-processing updates the same rows; it never duplicates.
// Returning a docket to review reverses (status='reversed') unclaimed costs.
// Downstream off (projects not entitled): docket stays approved and exportable.
import {database,type Statement} from '@/lib/platform/database';
import {actorContext} from '@/lib/platform/context';
import {seamEnabled} from '@/lib/platform/entitlements';
import {safeJson} from '@/lib/estimates-db';

type Docket={id:string;docket_no:string;work_date:string;amount:number;quantity:number;quantity_unit:string;labour_hours:number;line_items:string;links:string;status:string;notes:string};
const r2=(n:unknown)=>Math.round((Number(n)||0)*100)/100;
export function costCategory(text:string){
 const s=text.toLowerCase();
 if(/labou?r|operator|supervisor|hand|crew|wages|hourly/.test(s))return 'labour';
 if(/subcontract|traffic control|tc crew|linemark|survey/.test(s))return 'subcontract';
 if(/plant|paver|roller|excavat|grader|broom|sweeper|truck|tipper|hire|profiler|loader|bobcat|float/.test(s))return 'plant';
 if(/asphalt|material|ac1|ac2|sma|tonne|aggregate|concrete|cement|pipe|bitumen|emulsion|supply|gravel|sand|base/.test(s))return 'material';
 return 'other';
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
export async function docketCostStatements(docketId:string,nextStatus:string):Promise<{statements:Statement[];posted:number;message:string|null}>{
 const actor=actorContext.getStore()!,org=actor.organisationId,now=new Date().toISOString();
 const d=await database.prepare('SELECT id,docket_no,work_date,amount,quantity,quantity_unit,labour_hours,line_items,links,status,notes FROM dockets WHERE organisation_id=? AND id=?').bind(org,docketId).first<Docket>();
 if(!d)return {statements:[],posted:0,message:null};
 const claimed=['included_claim','invoiced'].includes(d.status);
 if(nextStatus!=='approved'){
  if(claimed)return {statements:[],posted:0,message:null};
  const reversed=database.prepare("UPDATE cost_transactions SET status='reversed',updated_at=? WHERE organisation_id=? AND source_type='docket' AND source_id=? AND status<>'reversed'").bind(now,org,docketId);
  return {statements:[reversed],posted:0,message:null};
 }
 const jobId=String(safeJson<Record<string,unknown>>(d.links,{}).jobId||'');
 if(!jobId)return {statements:[],posted:0,message:'Approved. This docket is not allocated to a project, so no cost was posted.'};
 if(!await seamEnabled(org,'dockets','projects'))return {statements:[],posted:0,message:'Approved. Projects is not enabled, so costs were not posted; the docket remains exportable.'};
 const job=await database.prepare('SELECT id,stage,status FROM jobs WHERE organisation_id=? AND id=?').bind(org,jobId).first<{id:string;stage:string|null;status:string}>();
 if(!job)return {statements:[],posted:0,message:'Approved. The allocated project no longer exists; no cost was posted.'};
 if(job.stage==='closed')throw Object.assign(new Error('This project is closed. Reopen it before approving dockets against it.'),{status:409});
 const codes=(await database.prepare("SELECT code,category FROM project_cost_codes WHERE organisation_id=? AND project_id=? AND status='active'").bind(org,jobId).all<{code:string;category:string}>()).results;
 const lines=docketCostLines(d);
 const statements:Statement[]=[
  // Lines that no longer exist after an edit are reversed rather than deleted.
  database.prepare("UPDATE cost_transactions SET status='reversed',updated_at=? WHERE organisation_id=? AND source_type='docket' AND source_id=?").bind(now,org,docketId),
  ...lines.map(l=>{const code=codes.find(c=>c.code===CODE[l.category])?.code??codes.find(c=>c.category===l.category)?.code??null;
   return database.prepare("INSERT INTO cost_transactions (id,organisation_id,project_id,cost_code,category,source_type,source_id,source_line,description,quantity,unit,rate,amount,transaction_date,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'docket',?,?,?,?,?,?,?,?,'actual',?,?,?) ON DUPLICATE KEY UPDATE project_id=VALUES(project_id),cost_code=VALUES(cost_code),category=VALUES(category),description=VALUES(description),quantity=VALUES(quantity),unit=VALUES(unit),rate=VALUES(rate),amount=VALUES(amount),transaction_date=VALUES(transaction_date),status='actual',updated_at=VALUES(updated_at)")
    .bind(crypto.randomUUID(),org,jobId,code,l.category,docketId,l.line,l.description.slice(0,500),l.quantity,l.unit.slice(0,20),l.rate,l.amount,d.work_date,actor.userId,now,now);}),
  database.prepare('INSERT INTO audit_log (id,organisation_id,actor_user_id,actor_email,event_type,entity_type,entity_id,project_id,summary,after_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org,actor.userId,actor.email,'docket.approved','docket',docketId,jobId,`Docket ${d.docket_no} approved; ${lines.length} cost line${lines.length===1?'':'s'} posted (${r2(lines.reduce((n,l)=>n+l.amount,0)).toFixed(2)})`,JSON.stringify({lines}),now),
 ];
 return {statements,posted:lines.length,message:lines.length?null:'Approved. The docket has no amount, so no cost was posted.'};
}
