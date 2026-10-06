// Exercise the real fixture stage with an in-memory HTTP/SQL double; no database or dependencies.
import assert from 'node:assert/strict';
import {commercialStage,DOCKETS} from './demo/commercial.mjs';

async function scenario(seedDate){
 const claims=[],invoices=[],writes=[];
 const d=n=>new Date(Date.parse(seedDate+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const one=async(sql,p)=>{
  if(sql.includes('COUNT(*)'))return {n:sql.includes('progress_claims')?claims.length:DOCKETS.length};
  if(sql.includes('FROM dockets WHERE')){
   const docket=DOCKETS.find(x=>x[0]===p[1]);
   return {id:docket[0],status:docket[10],links:JSON.stringify({jobId:docket[1]}),updated_at:'fixture-version'};
  }
  if(sql.includes('FROM progress_claims'))return sql.includes('period=?')?claims.find(x=>x.projectId===p[1]&&x.period===p[2]):claims.find(x=>x.id===p[1]);
  if(sql.includes('FROM client_invoices'))return invoices.find(x=>x.claimId===p[1]);
  throw new Error('Unexpected SQL: '+sql);
 };
 const call=async(path,method='GET',body)=>{
  assert.ok(path.startsWith('/api/commercial/claims'));
  if(method==='GET')return {claimable:[{lineType:'contract',sourceId:path.endsWith('B1')?'contract-B1':'contract-B2',contractValue:40000},
   ...(!claims.some(x=>x.lines.some(l=>l.lineType==='docket'))?[{lineType:'docket',sourceId:'DEMO-D-006',docketVersion:'fixture-version'}]:[])]};
  writes.push(structuredClone(body));
  const claim=claims.find(x=>x.id===body.claimId);
  switch(body.action){
   case 'create': {
    assert.ok(!claims.some(x=>x.projectId===body.projectId&&['draft','internal_approval'].includes(x.status)),'finish the previous open claim');
    const id='claim-'+(claims.length+1);
    claims.push({...body,id,status:'draft'});return {claimId:id};
   }
   case 'transition':claim.status=body.to;break;
   case 'certify':assert.ok(body.certifiedDate>=claim.claimDate);claim.status='certified';break;
   case 'invoice': {
    assert.ok(body.invoiceDate>=claim.claimDate);
    assert.ok(body.dueDate>=body.invoiceDate);
    invoices.push({...body,id:'invoice-'+invoices.length,status:'draft',total:100,paid_amount:0});claim.status='invoiced';break;
   }
   case 'invoice-action': {
    const invoice=invoices.find(x=>x.id===body.invoiceId);
    if(body.invoiceAction==='issue')invoice.status='issued';
    else {assert.ok(body.date>=invoice.invoiceDate);invoice.paid_amount=body.amount;claims.find(x=>x.id===invoice.claimId).status='paid';}
    break;
   }
   default:throw new Error('Unexpected action: '+body.action);
  }
  return {};
 };
 const c={org:'fixture-org',ids:{'project:B1':'B1','project:B2':'B2'},d,one,call,
  must:async p=>p,db:{query:async sql=>{assert.ok(sql.includes('FROM cost_transactions'));return [[{total:725}]];}},
  form:()=>assert.fail('Dockets are already seeded'),note:()=>{},log:()=>{}};
 await commercialStage(c);
 assert.equal(claims.length,4,seedDate+': four claims');
 assert.equal(claims.flatMap(x=>x.lines).length,5,seedDate+': five claim lines');
 const b1=claims.filter(x=>x.projectId==='B1');
 assert.deepEqual(b1.map(x=>x.status),['paid','submitted','internal_approval']);
 assert.equal(new Set(b1.map(x=>x.period)).size,3,'three nonoverlapping monthly periods');
 assert.ok(b1[0].period<b1[1].period&&b1[1].period<b1[2].period,'chronological periods');
 for(const claim of claims){assert.match(claim.period,/^\d{4}-(0[1-9]|1[0-2])$/);assert.equal(claim.claimDate.slice(0,7),claim.period);assert.ok(claim.claimDate<=seedDate);}
 assert.equal(b1[2].claimDate,seedDate);
 assert.deepEqual(b1.map(x=>x.lines.map(l=>l.thisClaim)),[[60000],[55000],[30000,1000]]);
 assert.equal(b1[2].lines[1].billingBasis.confirmed,true);
 assert.equal(claims[3].status,'paid');assert.equal(invoices.length,2);
 const snapshot=JSON.stringify({claims,invoices}),writeCount=writes.length;
 await commercialStage(c);
 assert.equal(JSON.stringify({claims,invoices}),snapshot,'same seed resumes without changing records');
 assert.equal(writes.length,writeCount,'same seed issues no additional writes');
 return b1.map(x=>x.period).join(',');
}

// Include the reported midnight transition, midmonth, month/year ends and leap/non-leap February.
const dates=['2026-10-05','2026-10-06','2026-10-15','2026-10-31','2026-11-01','2026-12-31','2027-01-01','2027-01-31','2027-02-28','2027-03-01','2024-02-28','2024-02-29','2024-03-01','2024-03-31'];
let failed=0;
for(const date of dates){try{console.log('PASS',date,await scenario(date));}catch(e){failed++;console.error('FAIL',date,e.message);}}
assert.equal(failed,0,'demo commercial date regressions');
console.log(`Demo commercial dates: ${dates.length} passed (four claims / five lines, periods, amounts, lifecycle, idempotence)`);
