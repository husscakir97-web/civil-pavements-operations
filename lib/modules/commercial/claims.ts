// Progress claims and client invoices.
// Claim: draft → internal_approval → submitted → certified → invoiced → paid.
// A docket can be claimed once (unique exclusive_key); contract and variation
// lines are claimed progressively and can never exceed their value.
import type {PoolConnection} from 'mysql2/promise';
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {assertTransition,stateLabel} from '@/lib/platform/workflow';
import {audit} from '@/lib/platform/audit';
import {fail} from '@/lib/platform/http';
import {seamEnabled} from '@/lib/platform/entitlements';
import {query,one,exec,tx,nowIso,uuid,round2,type Row} from '@/lib/platform/sql';
import {claimLine,gst,retention,retentionHeld,type RetentionTerms} from '@/lib/platform/finance';
import {renderDocument,organisationBranding} from '@/lib/platform/pdf';

const actor=()=>actorContext.getStore()!;
const r2=round2;

async function project(projectId:string,conn?:PoolConnection,forWrite=false){
 const p=await one('SELECT id,name,stage,contract_value,metadata,retention_enabled,retention_pct,retention_cap_amount FROM jobs WHERE organisation_id=? AND id=?',[actor().organisationId,projectId],conn);
 if(!p)fail(404,'Project not found.');
 if(forWrite&&p!.stage==='closed')fail(409,'This project is closed. Reopen it before claiming.');
 return p!;
}

async function previousClaimed(conn:PoolConnection|undefined,lineType:string,sourceId:string,excludeClaim?:string){
 const r=await one<{n:number}>(`SELECT COALESCE(SUM(l.this_claim),0) AS n FROM claim_lines l JOIN progress_claims c ON c.id=l.claim_id AND c.organisation_id=l.organisation_id WHERE l.organisation_id=? AND l.line_type=? AND l.source_id=?${excludeClaim?' AND l.claim_id<>?':''}`,[actor().organisationId,lineType,sourceId,...(excludeClaim?[excludeClaim]:[])],conn);
 return Number(r?.n||0);
}

/** Everything that may be claimed now: contract baseline, approved variations and approved, unclaimed dockets. */
export async function claimable(projectId:string,conn?:PoolConnection){
 const org=actor().organisationId;await project(projectId,conn);
 const baseline=await one('SELECT id,contract_value FROM project_baselines WHERE organisation_id=? AND project_id=? ORDER BY revision LIMIT 1',[org,projectId],conn);
 const variations=await query("SELECT id,reference,title,approved_value FROM project_variations WHERE organisation_id=? AND project_id=? AND status='approved'",[org,projectId],conn);
 const dockets=await query("SELECT d.id,d.docket_no,d.work_date,d.amount FROM dockets d WHERE d.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(d.links,'$.jobId'))=? AND d.status='approved' AND NOT EXISTS (SELECT 1 FROM claim_lines l WHERE l.organisation_id=d.organisation_id AND l.exclusive_key=CONCAT('docket:',d.id)) AND NOT EXISTS (SELECT 1 FROM claim_items i WHERE i.organisation_id=d.organisation_id AND i.docket_id=d.id) ORDER BY d.work_date",[org,projectId],conn);
 const lines:Row[]=[];
 if(baseline){const prev=await previousClaimed(conn,'contract',baseline.id);lines.push({lineType:'contract',sourceId:baseline.id,description:'Original contract works',contractValue:Number(baseline.contract_value),previousClaimed:prev,remaining:r2(Number(baseline.contract_value)-prev)});}
 for(const v of variations){const prev=await previousClaimed(conn,'variation',v.id);lines.push({lineType:'variation',sourceId:v.id,description:`${v.reference} ${v.title}`,contractValue:Number(v.approved_value),previousClaimed:prev,remaining:r2(Number(v.approved_value)-prev)});}
 for(const d of dockets)lines.push({lineType:'docket',sourceId:d.id,description:`Docket ${d.docket_no} (${d.work_date})`,contractValue:Number(d.amount),previousClaimed:0,remaining:Number(d.amount)});
 return lines;
}

const terms=(p:Row):RetentionTerms=>({enabled:Boolean(Number(p.retention_enabled)),pct:Number(p.retention_pct||0),cap:p.retention_cap_amount==null?null:Number(p.retention_cap_amount)});
/** Retention held on the project's claims numbered before `beforeNumber` (all claims when null). */
async function heldExcluding(projectId:string,beforeNumber:number|null,conn?:PoolConnection){
 const rows=await query('SELECT retention_withheld,certified_retention,retention_released FROM progress_claims WHERE organisation_id=? AND project_id=?'+(beforeNumber!=null?' AND number<?':''),[actor().organisationId,projectId,...(beforeNumber!=null?[beforeNumber]:[])],conn);
 return retentionHeld(rows.map(c=>({retentionWithheld:Number(c.retention_withheld),certifiedRetention:c.certified_retention==null?null:Number(c.certified_retention),retentionReleased:Number(c.retention_released)})));
}
export async function retentionSummary(projectId:string,conn?:PoolConnection){
 const p=await project(projectId,conn);
 return {...terms(p),...await heldExcluding(projectId,null,conn)};
}

export type ClaimLineInput={lineType:'contract'|'variation'|'docket'|'other';sourceId?:string|null;description?:string;thisClaim:number};
export async function createClaim(projectId:string,input:{period:string;claimDate?:string|null;notes?:string|null;lines:ClaimLineInput[];retentionRelease?:{amount:number;reason:string}|null}){
 const a=actor();if(!can(a.role,'claim.edit'))fail(403,'You are not authorised to prepare claims.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period))fail(400,'Choose a claim period (YYYY-MM).');
 const lines=input.lines.filter(l=>Number(l.thisClaim)!==0);
 const release=r2(input.retentionRelease?.amount||0);
 if(release&&!input.retentionRelease?.reason?.trim())fail(422,'Give the reason for releasing retention (for example practical completion).');
 if(!lines.length&&!release)fail(422,'Add at least one claim line with a value, or a retention release.');
 return tx(async conn=>{
  const p=await project(projectId,conn,true);
  await exec('SELECT id FROM jobs WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,projectId],conn);
  const open=await one("SELECT id FROM progress_claims WHERE organisation_id=? AND project_id=? AND status IN ('draft','internal_approval')",[a.organisationId,projectId],conn);
  if(open)fail(409,'Finish or delete the open draft claim before starting another.');
  const available=await claimable(projectId,conn);
  const id=uuid(),now=nowIso(),rows:Row[]=[];
  for(const l of lines){
   if(l.lineType==='other'){if(!l.description?.trim())fail(422,'Describe each other claim line.');rows.push({line_type:'other',source_id:null,exclusive_key:null,description:l.description.trim(),contract_value:0,previous_claimed:0,this_claim:r2(l.thisClaim),claimed_to_date:r2(l.thisClaim)});continue;}
   const src=available.find(x=>x.lineType===l.lineType&&x.sourceId===l.sourceId);
   if(!src)fail(409,l.lineType==='docket'?'A selected docket is not approved for this project or has already been claimed.':'A selected line is not claimable.');
   if(l.lineType==='docket'&&r2(l.thisClaim)!==r2(src!.contractValue))fail(422,'Dockets are claimed in full. Adjust the docket before claiming a different amount.');
   let calc;try{calc=claimLine(src!.contractValue,src!.previousClaimed,r2(l.thisClaim));}catch(e){fail(422,`${src!.description}: ${(e as Error).message}`);}
   rows.push({line_type:l.lineType,source_id:l.sourceId,exclusive_key:l.lineType==='docket'?`docket:${l.sourceId}`:null,description:src!.description,contract_value:calc!.contractValue,previous_claimed:calc!.previousClaimed,this_claim:calc!.thisClaim,claimed_to_date:calc!.claimedToDate});
  }
  const n=await one<{n:number}>('SELECT COALESCE(MAX(number),0)+1 AS n FROM progress_claims WHERE organisation_id=? AND project_id=?',[a.organisationId,projectId],conn);
  const gross=r2(rows.reduce((s,r)=>s+Number(r.this_claim),0));
  const held=await heldExcluding(projectId,null,conn);
  let ret;try{ret=retention(terms(p),gross,held.held,release);}catch(e){fail(422,(e as Error).message);}
  await exec("INSERT INTO progress_claims (id,organisation_id,project_id,number,period,claim_date,status,gross_amount,retention_withheld,retention_released,retention_release_reason,net_amount,notes,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,1,?,?,?)",[id,a.organisationId,projectId,Number(n?.n||1),input.period,input.claimDate||now.slice(0,10),gross,ret!.withheld,ret!.released,release?input.retentionRelease!.reason.trim().slice(0,1000):null,ret!.net,input.notes||null,a.userId,now,now],conn);
  for(const r of rows)await exec('INSERT INTO claim_lines (id,organisation_id,claim_id,project_id,line_type,source_id,exclusive_key,description,contract_value,previous_claimed,this_claim,claimed_to_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[uuid(),a.organisationId,id,projectId,r.line_type,r.source_id,r.exclusive_key,String(r.description).slice(0,500),r.contract_value,r.previous_claimed,r.this_claim,r.claimed_to_date,now],conn);
  const docketIds=rows.filter(r=>r.line_type==='docket').map(r=>r.source_id);
  if(docketIds.length)await exec("UPDATE dockets SET status='included_claim',updated_at=? WHERE organisation_id=? AND id IN (?) AND status='approved'",[now,a.organisationId,docketIds],conn);
  await audit({event:'claim.created',entityType:'claim',entityId:id,projectId,summary:`Claim ${n?.n} (${input.period}) prepared: gross ${gross.toFixed(2)}, retention ${ret!.withheld.toFixed(2)}${ret!.released?`, release ${ret!.released.toFixed(2)}`:''}, net ${ret!.net.toFixed(2)} for ${p.name}`,after:{gross,lines:rows.length,retention:ret}},conn);
  return {claimId:id,number:Number(n?.n||1),grossAmount:gross,retentionWithheld:ret!.withheld,retentionReleased:ret!.released,netAmount:ret!.net};
 });
}

export async function deleteDraftClaim(claimId:string){
 const a=actor();if(!can(a.role,'claim.edit'))fail(403,'You are not authorised to change claims.');
 return tx(async conn=>{
  const c=await one('SELECT * FROM progress_claims WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,claimId],conn);
  if(!c)fail(404,'Claim not found.');
  if(c!.status!=='draft')fail(409,'Only draft claims can be deleted.');
  const docketIds=(await query("SELECT source_id FROM claim_lines WHERE organisation_id=? AND claim_id=? AND line_type='docket'",[a.organisationId,claimId],conn)).map(r=>r.source_id);
  if(docketIds.length)await exec("UPDATE dockets SET status='approved',updated_at=? WHERE organisation_id=? AND id IN (?) AND status='included_claim'",[nowIso(),a.organisationId,docketIds],conn);
  await exec('DELETE FROM claim_lines WHERE organisation_id=? AND claim_id=?',[a.organisationId,claimId],conn);
  await exec('DELETE FROM progress_claims WHERE organisation_id=? AND id=?',[a.organisationId,claimId],conn);
  await audit({event:'claim.deleted',entityType:'claim',entityId:claimId,projectId:c!.project_id,summary:`Draft claim ${c!.number} deleted; ${docketIds.length} docket(s) released`,before:c},conn);
  return {deleted:true};
 });
}

export async function transitionClaim(claimId:string,to:'internal_approval'|'submitted'|'draft',note?:string){
 const a=actor();
 return tx(async conn=>{
  const c=await one('SELECT * FROM progress_claims WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,claimId],conn);
  if(!c)fail(404,'Claim not found.');
  await project(c!.project_id,conn,true);
  assertTransition('claim',c!.status,to,a.role);
  const now=nowIso(),set:Row={status:to};
  if(to==='submitted'){set.approved_by=a.userId;set.approved_at=now;set.submitted_by=a.userId;set.submitted_at=now;}
  const cols=Object.keys(set);
  await exec(`UPDATE progress_claims SET ${cols.map(k=>`${k}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(k=>set[k]),now,a.organisationId,claimId],conn);
  await audit({event:`claim.${to}`,entityType:'claim',entityId:claimId,projectId:c!.project_id,summary:`Claim ${c!.number}: ${stateLabel('claim',c!.status)} → ${stateLabel('claim',to)}${note?` (${note})`:''}`,before:{status:c!.status},after:set},conn);
  return {status:to};
 });
}

export async function certifyClaim(claimId:string,certifiedAmount:number,certifiedDate?:string|null){
 const a=actor();
 return tx(async conn=>{
  const c=await one('SELECT * FROM progress_claims WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,claimId],conn);
  if(!c)fail(404,'Claim not found.');
  assertTransition('claim',c!.status,'certified',a.role,{system:true});
  if(!(certifiedAmount>=0))fail(422,'Enter the certified amount.');
  const now=nowIso(),p=await project(c!.project_id,conn);
  // The certified gross is the client's figure; retention on it is recomputed with the
  // project terms and the retention held on the other claims. The release stays as claimed.
  const held=await heldExcluding(c!.project_id,Number(c!.number),conn);
  let ret;try{ret=retention(terms(p),r2(certifiedAmount),held.held,Number(c!.retention_released));}catch(e){fail(422,(e as Error).message);}
  await exec("UPDATE progress_claims SET status='certified',certified_amount=?,certified_retention=?,certified_net=?,certified_by=?,certified_at=?,revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[r2(certifiedAmount),ret!.withheld,ret!.net,a.userId,certifiedDate||now,now,a.organisationId,claimId],conn);
  await audit({event:'claim.certified',entityType:'claim',entityId:claimId,projectId:c!.project_id,summary:`Claim ${c!.number} certified at ${certifiedAmount.toFixed(2)} gross (claimed ${Number(c!.gross_amount).toFixed(2)}, variance ${(certifiedAmount-Number(c!.gross_amount)).toFixed(2)}); retention ${ret!.withheld.toFixed(2)}, net ${ret!.net.toFixed(2)}`,before:{status:c!.status},after:{status:'certified',certifiedAmount,certifiedRetention:ret!.withheld,certifiedNet:ret!.net}},conn);
  return {status:'certified'};
 });
}

export async function listClaims(projectId:string){
 const org=actor().organisationId;await project(projectId);
 const claims=await query('SELECT * FROM progress_claims WHERE organisation_id=? AND project_id=? ORDER BY number DESC',[org,projectId]);
 const lines=claims.length?await query('SELECT * FROM claim_lines WHERE organisation_id=? AND claim_id IN (?) ORDER BY created_at',[org,claims.map(c=>c.id)]):[];
 const invoices=await query('SELECT * FROM client_invoices WHERE organisation_id=? AND project_id=? ORDER BY invoice_date DESC',[org,projectId]);
 return {claims:claims.map(c=>({id:c.id,number:c.number,period:c.period,claimDate:c.claim_date,status:c.status,statusLabel:stateLabel('claim',c.status),grossAmount:Number(c.gross_amount),retentionWithheld:Number(c.retention_withheld),retentionReleased:Number(c.retention_released),retentionReleaseReason:c.retention_release_reason,netAmount:c.net_amount==null?Number(c.gross_amount):Number(c.net_amount),gstOnNet:gst(c.net_amount==null?Number(c.gross_amount):Number(c.net_amount)).gst,certifiedAmount:c.certified_amount==null?null:Number(c.certified_amount),certifiedRetention:c.certified_retention==null?null:Number(c.certified_retention),certifiedNet:c.certified_net==null?null:Number(c.certified_net),variance:c.certified_amount==null?null:r2(Number(c.certified_amount)-Number(c.gross_amount)),submittedAt:c.submitted_at,certifiedAt:c.certified_at,notes:c.notes,revision:c.revision,lines:lines.filter(l=>l.claim_id===c.id).map(l=>({id:l.id,lineType:l.line_type,sourceId:l.source_id,description:l.description,contractValue:Number(l.contract_value),previousClaimed:Number(l.previous_claimed),thisClaim:Number(l.this_claim),claimedToDate:Number(l.claimed_to_date),remaining:r2(Number(l.contract_value)-Number(l.claimed_to_date))}))})),
  invoices:invoices.map(presentInvoice),claimable:await claimable(projectId),retention:await retentionSummary(projectId)};
}
const presentInvoice=(i:Row)=>({id:i.id,projectId:i.project_id,claimId:i.claim_id,invoiceNumber:i.invoice_number,invoiceDate:i.invoice_date,dueDate:i.due_date,amountExGst:Number(i.amount_ex_gst),gst:Number(i.gst),total:Number(i.total),status:i.status,statusLabel:stateLabel('invoice',i.status),paidDate:i.paid_date,paidAmount:Number(i.paid_amount),outstanding:r2(Number(i.total)-Number(i.paid_amount)),revision:i.revision});

export async function createInvoice(claimId:string,input:{invoiceNumber:string;invoiceDate:string;dueDate?:string|null;gstPct?:number}){
 const a=actor();if(!can(a.role,'invoice.manage'))fail(403,'You are not authorised to manage invoices.');
 if(!input.invoiceNumber.trim())fail(400,'An invoice number is required.');
 return tx(async conn=>{
  const c=await one('SELECT * FROM progress_claims WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,claimId],conn);
  if(!c)fail(404,'Claim not found.');
  assertTransition('claim',c!.status,'invoiced',a.role,{system:true});
  const amounts=gst(Number(c!.certified_net??c!.net_amount??c!.certified_amount??c!.gross_amount),input.gstPct??10),id=uuid(),now=nowIso();
  await exec("INSERT INTO client_invoices (id,organisation_id,project_id,claim_id,invoice_number,invoice_date,due_date,amount_ex_gst,gst,total,status,paid_amount,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'draft',0,1,?,?,?)",[id,a.organisationId,c!.project_id,claimId,input.invoiceNumber.trim().slice(0,60),input.invoiceDate,input.dueDate||null,amounts.amountExGst,amounts.gst,amounts.total,a.userId,now,now],conn);
  await exec("UPDATE progress_claims SET status='invoiced',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",[now,a.organisationId,claimId],conn);
  await exec("UPDATE dockets d JOIN claim_lines l ON l.source_id=d.id AND l.organisation_id=d.organisation_id AND l.line_type='docket' SET d.status='invoiced',d.updated_at=? WHERE d.organisation_id=? AND l.claim_id=?",[now,a.organisationId,claimId],conn);
  await audit({event:'invoice.created',entityType:'invoice',entityId:id,projectId:c!.project_id,summary:`Invoice ${input.invoiceNumber} created for claim ${c!.number}: ${amounts.total.toFixed(2)} incl. GST`,after:amounts},conn);
  return {invoiceId:id,...amounts};
 });
}

export async function invoiceAction(invoiceId:string,action:'issue'|'void'|'payment',payment?:{amount:number;date:string}){
 const a=actor();if(!can(a.role,'invoice.manage'))fail(403,'You are not authorised to manage invoices.');
 return tx(async conn=>{
  const i=await one('SELECT * FROM client_invoices WHERE organisation_id=? AND id=? FOR UPDATE',[a.organisationId,invoiceId],conn);
  if(!i)fail(404,'Invoice not found.');
  const now=nowIso();let to:string,set:Row;
  if(action==='payment'){
   if(!payment||!(payment.amount>0)||!/^\d{4}-\d{2}-\d{2}$/.test(payment.date))fail(422,'Enter the payment amount and date.');
   const paid=r2(Number(i!.paid_amount)+payment!.amount);
   if(paid>Number(i!.total)+0.005)fail(422,`Payment exceeds the outstanding amount (${r2(Number(i!.total)-Number(i!.paid_amount)).toFixed(2)}).`);
   to=paid>=Number(i!.total)-0.005?'paid':'part_paid';
   assertTransition('invoice',i!.status,to,a.role,{system:true});
   set={status:to,paid_amount:paid,paid_date:payment!.date};
  }else{to=action==='issue'?'issued':'void';assertTransition('invoice',i!.status,to,a.role);set={status:to};}
  const cols=Object.keys(set);
  await exec(`UPDATE client_invoices SET ${cols.map(k=>`${k}=?`).join(',')},revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?`,[...cols.map(k=>set[k]),now,a.organisationId,invoiceId],conn);
  if(to==='paid'&&i!.claim_id)await exec("UPDATE progress_claims SET status='paid',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=? AND status='invoiced'",[now,a.organisationId,i!.claim_id],conn);
  await audit({event:`invoice.${to}`,entityType:'invoice',entityId:invoiceId,projectId:i!.project_id,summary:`Invoice ${i!.invoice_number}: ${stateLabel('invoice',i!.status)} → ${stateLabel('invoice',to)}${payment?` (${payment.amount.toFixed(2)} on ${payment.date})`:''}`,before:{status:i!.status,paidAmount:i!.paid_amount},after:set},conn);
  return {status:to};
 });
}

/** Seam guard: variations flow into claims only when commercial is fully entitled. */
export async function assertCommercialWritable(){if(!await seamEnabled(actor().organisationId,'commercial'))fail(403,'Commercial is read-only for your organisation.');}

/** Tax invoice PDF from the stored invoice and its certified claim (amounts are never recalculated here). */
export async function invoicePdf(invoiceId:string){
 const a=actor();
 const i=await one('SELECT * FROM client_invoices WHERE organisation_id=? AND id=?',[a.organisationId,invoiceId]);
 if(!i)fail(404,'Invoice not found.');
 const p=await one('SELECT name,project_number,client_name,contract_number,site_address FROM jobs WHERE organisation_id=? AND id=?',[a.organisationId,i!.project_id]);
 const c=i!.claim_id?await one('SELECT * FROM progress_claims WHERE organisation_id=? AND id=?',[a.organisationId,i!.claim_id]):null;
 const brand=await organisationBranding(a.organisationId),aud=(n:unknown)=>`$${Number(n||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 const certifiedGross=c?Number(c.certified_amount??c.gross_amount):Number(i!.amount_ex_gst);
 const rows:string[][]=c?[
  [`Progress claim ${c.number} (${c.period})${c.certified_amount!=null?', as certified':''}`,aud(certifiedGross)],
  ...(Number(c.certified_retention??c.retention_withheld)?[['Less retention withheld',`-${aud(c.certified_retention??c.retention_withheld)}`]]:[]),
  ...(Number(c.retention_released)?[[`Retention released${c.retention_release_reason?` (${c.retention_release_reason})`:''}`,aud(c.retention_released)]]:[]),
 ]:[['Contract works',aud(i!.amount_ex_gst)]];
 rows.push(['Amount excluding GST',aud(i!.amount_ex_gst)],['GST (10%)',aud(i!.gst)],['Total including GST',aud(i!.total)]);
 if(Number(i!.paid_amount))rows.push(['Paid to date',`-${aud(i!.paid_amount)}`],['Balance due',aud(Number(i!.total)-Number(i!.paid_amount))]);
 const bytes=await renderDocument({company:brand,title:'Tax invoice',number:i!.invoice_number,revision:null,status:stateLabel('invoice',i!.status),approval:null,date:i!.invoice_date,
  control:`${brand.legalName||brand.name}${brand.abn?` · ABN ${brand.abn}`:''} · Amounts in AUD`,
  blocks:[
   {rows:[['Invoice number',i!.invoice_number],['Invoice date',i!.invoice_date],['Due date',i!.due_date||'—'],['Bill to',p?.client_name||'—'],['Project',[p?.project_number,p?.name].filter(Boolean).join(' ')||'—'],['Contract',p?.contract_number||'—'],['Supplier',`${brand.legalName||brand.name}${brand.abn?` (ABN ${brand.abn})`:''}`]]},
   {heading:'Details',table:{columns:['Description','Amount'],widths:[395,120],align:['left','right'],rows}},
  ]});
 return new Response(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${String(i!.invoice_number).replace(/[^A-Za-z0-9_-]/g,'_')}.pdf"`,'Cache-Control':'private, no-store'}});
}
