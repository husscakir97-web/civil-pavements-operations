// Dockets, actual costs, independently agreed client charges, claims, invoices and payments.
// Supplier/works dockets carry the INTERNAL cost; the client charge is entered separately with a reference and confirmation.
const line=(description,quantity,unit,rate,kind='material')=>({kind,description,quantity,unit,rate,amount:rate===null?null:Math.round(quantity*rate*100)/100,...(rate===null?{valueSource:'unpriced'}:{})});

// [docketNo, project, dayOffset, client, projectLabel, crewOrSupplier, vehicle, quantity, unit, lines, status, allocate, note]
export const DOCKETS=[
 ['DEMO-D-001','B1',-14,'Coastline Asphalt','Quarry Road','Coastline Asphalt','Truck DEMO-T06',62,'t',[line('AC14 asphalt supply and delivery',62,'t',168)],'approved',true,'Approved and allocated: posts actual cost to the project.'],
 ['DEMO-D-002','B1',-7,'Coastline Asphalt','Quarry Road','Coastline Asphalt','Truck DEMO-T07',58,'t',[line('AC14 asphalt supply and delivery',58,'t',168)],'approved',true,'Approved and allocated.'],
 ['DEMO-D-003','B1',-13,'Stripe Right Linemarking','Quarry Road','Stripe Right Linemarking','',1,'item',[line('Linemarking — Quarry Road stage 1',1,'item',3200,'subcontract')],'approved',true,'Subcontractor docket, approved and allocated.'],
 ['DEMO-D-004','B1',0,'Roadsign Supplies','Quarry Road','Roadsign Supplies','',1,'item',[line('Temporary signs hire (price not yet confirmed)',1,'item',null,'material')],'review',false,'TEST: unpriced work. Needs human review; posts no cost.'],
 ['DEMO-D-005','B1',-3,'Coastline Asphalt','Quarry Road','Coastline Asphalt','Truck DEMO-T06',44,'t',[line('AC14 asphalt supply and delivery',44,'t',168)],'ready',false,'Ready to reconcile; not yet allocated to a project.'],
 ['DEMO-D-006','B1',-3,'Coastline Haulage','Quarry Road','Coastline Haulage','Truck DEMO-T12',6,'h',[line('Tipper hire (6 h)',6,'h',100,'plant')],'approved',true,'TEST: internal cost corrected from $600 to $725 after approval; the agreed client charge stays $1,000.'],
 ['DEMO-D-007','B2',-140,'Spoil Tip Services','Anzac Parade','Spoil Tip Services','',210,'t',[line('Spoil tipping',210,'t',22,'other')],'approved',true,'Historical docket on the completed project.'],
 ['DEMO-D-008','B2',-139,'Water Supplies Co','Anzac Parade','Water Supplies Co','',40,'kL',[line('Water',40,'kL',9.5,'material')],'approved',true,'Historical docket on the completed project.'],
];

export async function commercialStage(c){
 const {call,form,must,one,org,d,db,log}=c;
 const monthOf=day=>day.slice(0,7);
 const find=no=>one('SELECT id,project,links,work_date,updated_at,status,amount FROM dockets WHERE organisation_id=? AND docket_no=?',[org,no]);
 for(const [no,proj,day,,projectLabel,crew,vehicle,quantity,unit,lines,status,allocate,note] of DOCKETS){
  let row=await find(no);
  const jobId=c.ids['project:'+proj];
  if(!row){
   const rec={docketNo:no,workDate:d(day),client:'Kestrel Civil & Pavements (DEMO)',project:projectLabel,crew,vehicle,startTime:'06:00',finishTime:'16:00',breakHours:0.5,labourHours:0,quantity,quantityUnit:unit,amount:lines.every(l=>l.amount!==null)?lines.reduce((s,l)=>s+l.amount,0):0,poNumber:'DEMO-PO-'+no.slice(-3),notes:note,status:status==='approved'?'review':status,lineItems:lines,links:{}};
   await must(form('/api/dockets',{records:[rec]}),[200],'docket '+no);c.note('dockets');
   row=await find(no);
  }
  const links=JSON.parse(row.links||'{}');
  if(status==='approved'&&!['approved','included_claim'].includes(row.status)||allocate&&!links.jobId){
   const docket=(await must(call(`/api/dockets?id=${row.id}`),[200],'docket read '+no)).docket||null;
   const stored=docket||{};
   await must(call('/api/dockets','PUT',{...stored,status:'approved',links:{...(stored.links||{}),jobId},expectedUpdatedAt:stored.updatedAt||row.updated_at}),[200],'approve docket '+no);c.note('dockets-approved');
  }
 }
 // TEST: internal cost correction 600 -> 725 on DEMO-D-006 (re-approval re-posts in place as an adjustment).
 {
  const r=await find('DEMO-D-006');
  const [[cost]]=await db.query("SELECT COALESCE(SUM(amount),0) AS total FROM cost_transactions WHERE organisation_id=? AND source_id=? AND status='actual'",[org,r.id]);
  if(Number(cost.total)===600){
   const docket=(await must(call(`/api/dockets?id=${r.id}`),[200],'docket read')).docket;
   await must(call('/api/dockets','PUT',{...docket,amount:725,lineItems:[{kind:'plant',description:'Tipper hire (6 h) — corrected after supplier invoice review',quantity:6,unit:'h',rate:120.83,amount:725}],expectedUpdatedAt:docket.updatedAt}),[200],'correct docket');c.note('docket-corrections');
  }
 }
 // ---- claims -------------------------------------------------------------------------------------------------------------
 const claimable=async key=>(await must(call('/api/commercial/claims?projectId='+c.ids['project:'+key]),[200],'claimable '+key));
 const claimAt=(key,period)=>one('SELECT id,status FROM progress_claims WHERE organisation_id=? AND project_id=? AND period=?',[org,c.ids['project:'+key],period]);
 const contractLine=async key=>(await claimable(key)).claimable.find(l=>l.lineType==='contract');
 // A claim is created once and then advanced step by step from whatever state it is already in, so a partial run can resume.
 const drive=async({key,period,date,notes,lines,target,certifiedAmount,certifiedDate,invoiceNumber,invoiceDate,dueDate,payDate})=>{
  let claim=await claimAt(key,period);
  if(!claim){
   const made=await must(call('/api/commercial/claims','POST',{action:'create',projectId:c.ids['project:'+key],period,claimDate:date,notes,lines}),[201],'claim '+key+' '+period);
   claim=await one('SELECT id,status FROM progress_claims WHERE organisation_id=? AND id=?',[org,made.claimId]);c.note('claims');
  }
  const order=['draft','internal_approval','submitted','certified','invoiced','paid'];
  const reached=want=>order.indexOf(want)<=order.indexOf(target);
  const status=async()=>(await one('SELECT status FROM progress_claims WHERE organisation_id=? AND id=?',[org,claim.id])).status;
  if(reached('internal_approval')&&await status()==='draft')await must(call('/api/commercial/claims','POST',{action:'transition',claimId:claim.id,to:'internal_approval'}),[200],'claim approval');
  if(reached('submitted')&&await status()==='internal_approval')await must(call('/api/commercial/claims','POST',{action:'transition',claimId:claim.id,to:'submitted'}),[200],'claim submit');
  if(reached('certified')&&await status()==='submitted')await must(call('/api/commercial/claims','POST',{action:'certify',claimId:claim.id,certifiedAmount,certifiedDate}),[200],'certify');
  if(reached('invoiced')){
   let inv=await one('SELECT id,status,total,paid_amount FROM client_invoices WHERE organisation_id=? AND claim_id=?',[org,claim.id]);
   if(!inv){await must(call('/api/commercial/claims','POST',{action:'invoice',claimId:claim.id,invoiceNumber,invoiceDate,dueDate,gstPct:10}),[200,201],'invoice');inv=await one('SELECT id,status,total,paid_amount FROM client_invoices WHERE organisation_id=? AND claim_id=?',[org,claim.id]);}
   if(inv.status==='draft')await must(call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.id,invoiceAction:'issue'}),[200],'issue invoice');
   if(reached('paid')&&Number(inv.paid_amount)===0)await must(call('/api/commercial/claims','POST',{action:'invoice-action',invoiceId:inv.id,invoiceAction:'payment',amount:Number(inv.total),date:payDate}),[200],'payment');
  }
  return claim;
 };
 const b1=await contractLine('B1');
 await drive({key:'B1',period:monthOf(d(-35)),date:d(-35),notes:'Progress claim 1 (demonstration)',lines:[{lineType:'contract',sourceId:b1.sourceId,thisClaim:60000}],target:'paid',certifiedAmount:60000,certifiedDate:d(-28),invoiceNumber:'DEMO-INV-0001',invoiceDate:d(-27),dueDate:d(3),payDate:d(-5)});
 if(monthOf(d(-5))!==monthOf(d(0)))await drive({key:'B1',period:monthOf(d(-5)),date:d(-5),notes:'Progress claim 2 (demonstration)',lines:[{lineType:'contract',sourceId:b1.sourceId,thisClaim:55000}],target:'submitted'});
 {
  // current-month claim: docket-linked line with a SEPARATELY AGREED client charge of $1,000 (internal cost is $725)
  const cl=await claimable('B1'),dk=await find('DEMO-D-006');
  const docketLine=cl.claimable.find(l=>l.lineType==='docket'&&l.sourceId===dk.id);
  if(!await claimAt('B1',monthOf(d(0)))&&!docketLine)throw new Error('DEMO-D-006 is not claimable: '+JSON.stringify(cl.claimable.map(l=>[l.lineType,l.sourceId])));
  await drive({key:'B1',period:monthOf(d(0)),date:d(0),notes:'Progress claim 3 (demonstration): includes a day-work charge agreed with the client separately from internal cost.',lines:[{lineType:'contract',sourceId:b1.sourceId,thisClaim:30000},{lineType:'docket',sourceId:dk.id,thisClaim:1000,billingBasis:{confirmed:true,reference:'DEMO daywork agreement DW-17 (client charge $1,000 agreed independently of cost)',expectedUpdatedAt:docketLine?.docketVersion}}],target:'internal_approval'});
 }
 const b2=await contractLine('B2')||{contractValue:0};
 const b2Value=b2.contractValue||Number((await one('SELECT contract_value v FROM jobs WHERE organisation_id=? AND id=?',[org,c.ids['project:B2']])).v);
 await drive({key:'B2',period:monthOf(d(-110)),date:d(-110),notes:'Final claim (demonstration)',lines:[{lineType:'contract',sourceId:b2.sourceId,thisClaim:b2Value}],target:'paid',certifiedAmount:b2Value,certifiedDate:d(-100),invoiceNumber:'DEMO-INV-0002',invoiceDate:d(-99),dueDate:d(-69),payDate:d(-70)});
 log('dockets',(await one('SELECT COUNT(*) n FROM dockets WHERE organisation_id=?',[org])).n,'cost rows',(await one('SELECT COUNT(*) n FROM cost_transactions WHERE organisation_id=?',[org])).n,'claims',(await one('SELECT COUNT(*) n FROM progress_claims WHERE organisation_id=?',[org])).n);
}
