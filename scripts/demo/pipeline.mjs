// Opportunities, tenders, estimates, approvals and awards. Each bid is driven to a target state through the real workflow, so
// every state machine, approval record and audit row exists exactly as it would in use.
import {seedUsers} from './projects.mjs';
const item=(n,section,category,description,quantity,unit,rate,rateBasis='unit',productivity=0)=>({id:`demo-i${n}`,section,costCode:String(100+n*10),category,description,quantity,unit,productivity,rateBasis,rate});

// target: lead | qualified | tender | pricing | estimate-review | estimate-approved | tender-approval | submitted | awarded | lost
export const BIDS=[
 {key:'B1',ref:'DEMO-T-001',title:'Marrow Shire 2026/27 Resurfacing — Quarry Road',division:'APM',client:'DEMO-C1',site:'Quarry Road corridor',value:158000,due:-60,target:'awarded',project:'active',
  scope:'Resurface 4,200 m2 of Quarry Road with 40 mm AC14: profile, tack coat, pave, roll and reinstate linemarking.',items:[
  item(1,'Traffic management','labour','Traffic control crew (TC crew, 3 pax)',120,'h',148,'hour',1),item(2,'Profiling','plant','Profiler W 100 (profiling 4,200 m2)',24,'h',210,'hour',1),
  item(3,'Paving','labour','Paving crew (5 pax)',64,'h',265,'hour',1),item(4,'Paving','plant','Paver, rollers and tippers',48,'h',520,'hour',1),
  item(5,'Materials','material','AC14 asphalt supplied and delivered',620,'t',168),item(6,'Materials','material','Bituminous tack coat',4200,'m2',1.1),item(7,'Linemarking','subcontract','Linemarking (Stripe Right)',1,'item',6500)]},
 {key:'B2',ref:'DEMO-T-002',title:'Ridgeway Anzac Parade — Kerb-to-Kerb Profiling',division:'PRF',client:'DEMO-C2',site:'Anzac Parade',value:86000,due:-150,target:'awarded',project:'closed',
  scope:'Cold plane 7,800 m2 of Anzac Parade to 50 mm depth and remove spoil.',items:[
  item(1,'Profiling','plant','Profiler W 100',40,'h',210,'hour',1),item(2,'Profiling','labour','Profiling crew (4 pax)',40,'h',224,'hour',1),item(3,'Traffic management','labour','Traffic control (2 pax)',40,'h',98,'hour',1),
  item(4,'Spoil','other','Spoil cartage and tip fees',210,'t',22),item(5,'Water','plant','Water cart',40,'h',85,'hour',1)]},
 {key:'B3',ref:'DEMO-T-003',title:'Coastal Motorway — Night Traffic Control Services',division:'TC',client:'DEMO-C4',site:'Coastal Motorway night works',value:132000,due:-30,target:'awarded',project:'setup',
  scope:'Night-time traffic control and lane closures for motorway maintenance (indicative 36 night shifts).',items:[
  item(1,'Traffic control','labour','Traffic controllers (4 pax) night shift',288,'h',196,'hour',1),item(2,'Traffic control','labour','Traffic management supervisor night shift',288,'h',72,'hour',1),
  item(3,'Equipment','plant','VMS and arrow board trailers',36,'shift',310),item(4,'Design','subcontract','Traffic management plan design',1,'item',4800)]},
 {key:'B4',ref:'DEMO-T-004',title:'Ironbark Eastlink Industrial Estate — Pavement Rehabilitation',division:'APM',client:'DEMO-C3',site:'Eastlink Industrial Estate',value:224000,due:-8,target:'submitted',
  scope:'Rehabilitate 9,500 m2 of heavy-duty pavement: profile, repair failed areas, 50 mm AC20 and linemarking.',items:[
  item(1,'Profiling','plant','Profiler W 120',48,'h',240,'hour',1),item(2,'Paving','plant','Paver, rollers and tippers',72,'h',520,'hour',1),item(3,'Paving','labour','Paving crew (5 pax)',72,'h',265,'hour',1),
  item(4,'Materials','material','AC20 asphalt',1150,'t',162),item(5,'Traffic management','labour','Traffic control (3 pax)',90,'h',148,'hour',1)]},
 {key:'B5',ref:'DEMO-T-005',title:'Marrow Shire — Depot Hardstand Rehabilitation',division:'APM',client:'DEMO-C1',site:'Marrow Shire Depot',value:64000,due:10,target:'tender-approval',
  scope:'Rehabilitate the Marrow depot hardstand (1,900 m2).',items:[
  item(1,'Paving','plant','Paver and rollers',20,'h',520,'hour',1),item(2,'Paving','labour','Paving crew (4 pax)',20,'h',212,'hour',1),item(3,'Materials','material','AC14 asphalt',260,'t',168),item(4,'Profiling','plant','Profiler W 100',10,'h',210,'hour',1)]},
 {key:'B6',ref:'DEMO-T-006',title:'Ridgeway City — Stage 2 Road Rehabilitation',division:'APM',client:'DEMO-C2',site:'Stage 2 Rehab precinct',value:310000,due:24,target:'estimate-review',
  scope:'Stage 2 rehabilitation of Mill Street precinct (approx 14,000 m2).',items:[
  item(1,'Profiling','plant','Profiler W 120',72,'h',240,'hour',1),item(2,'Paving','plant','Paver, rollers and tippers',96,'h',520,'hour',1),item(3,'Paving','labour','Paving crew (5 pax)',96,'h',265,'hour',1),
  item(4,'Materials','material','AC14 asphalt',1650,'t',168),item(5,'Traffic management','labour','Traffic control (3 pax)',120,'h',148,'hour',1)]},
 {key:'B7',ref:'DEMO-T-007',title:'Ironbark Warehouse Carpark Profiling (pricing in progress)',division:'PRF',client:'DEMO-C3',site:'Eastlink Industrial Estate',value:42000,due:30,target:'pricing',
  scope:'Profile and reseal the warehouse carpark. TEST: contains an unpriced item.',items:[
  item(1,'Profiling','plant','Profiler W 100',16,'h',210,'hour',1),item(2,'Profiling','labour','Profiling crew (4 pax)',16,'h',224,'hour',1),item(3,'Sealing','subcontract','Sealing subcontract (RATE NOT YET RECEIVED)',1,'item',0)]},
 {key:'B8',ref:'DEMO-T-008',title:'Coastal Tollways — Resurfacing Panel (lost)',division:'APM',client:'DEMO-C4',site:'Coastal Motorway night works',value:480000,due:-120,target:'lost',lostReason:'Lost on price to a competitor (fictional); debrief held.',
  scope:'Panel of resurfacing works on the Coastal Motorway.',items:[
  item(1,'Paving','plant','Paver, rollers and tippers',120,'h',520,'hour',1),item(2,'Paving','labour','Paving crew (5 pax)',120,'h',265,'hour',1),item(3,'Materials','material','AC14 asphalt',2300,'t',168)]},
];
export const LEADS=[
 {name:'DEMO Marrow Shire — Footpath and Kerb Programme (lead)',client:'DEMO-C1',site:'Marrow Shire Depot',value:75000,prob:30,close:45,target:'lead'},
 {name:'DEMO Ironbark — Warehouse Hardstand Extension (qualified)',client:'DEMO-C3',site:'Eastlink Industrial Estate',value:120000,prob:50,close:60,target:'qualified'},
 {name:'DEMO Ridgeway City — Line Marking Panel 2027 (lead)',client:'DEMO-C2',site:'Anzac Parade',value:55000,prob:25,close:90,target:'lead'},
];
const RANK=['lead','qualified','tender','pricing','estimate-review','estimate-approved','tender-approval','submitted','awarded'];

export async function pipelineStage(c){
 const {call,must,one,org,d,log}=c;
 await seedUsers(c);
 for(const l of LEADS){
  let o=await one('SELECT id,stage FROM opportunities WHERE organisation_id=? AND name=?',[org,l.name]);
  if(!o){
   await must(call('/api/registers/opportunities','POST',{values:{name:l.name,client_id:c.ids['client:'+l.client],site_id:c.ids[`site:${l.client}:${l.site}`],owner_user_id:c.ids['user:est'],estimated_value:l.value,probability:l.prob,closing_date:d(l.close),notes:'Demonstration opportunity.'}}),[200,201],'opportunity');
   o=await one('SELECT id,stage FROM opportunities WHERE organisation_id=? AND name=?',[org,l.name]);c.note('opportunities');
  }
  if(l.target==='qualified'&&o.stage==='lead')await must(call('/api/registers/opportunities','PATCH',{id:o.id,transition:'qualified'}),[200],'qualify');
  c.ids['opportunity:'+l.name]=o.id;
 }
 for(const b of BIDS){
  const at=async()=>one('SELECT id,stage,estimate_id,project_id,estimated_value,approval_status FROM tenders WHERE organisation_id=? AND reference=?',[org,b.ref]);
  let t=await at();
  if(!t){
   await must(call('/api/tenders/register','POST',{title:b.title,reference:b.ref,businessUnitId:c.ids['division:'+b.division],clientId:c.ids['client:'+b.client],siteId:c.ids[`site:${b.client}:${b.site}`],dueDate:d(b.due),ownerUserId:c.ids['user:est'],estimatedValue:b.value,scopeSummary:b.scope}),[201],'tender '+b.ref);
   t=await at();c.note('tenders');
  }
  c.ids['tender:'+b.key]=t.id;
  // Every substep below is gated on durable state (the review row, its decision, the stage), so an interrupted run resumes at the
  // exact step that did not complete.
  // (the review row exists once bid-review ran; decided_at is set only when bid-decision ran)
  const review=()=>one('SELECT id,decided_at FROM tender_bid_reviews WHERE organisation_id=? AND tender_id=?',[org,t.id]);
  if(b.target==='lost'){
   if(t.stage!=='lost'){
    if(!await review())await must(call('/api/tenders/workspace','POST',{action:'bid-review',id:t.id,values:{strategic_fit:'Panel client; fits Asphalt division',capacity:'Crew committed elsewhere',recommendation:'bid',recommendation_reason:'Strategic panel'}}),[200],'bid review');
    if(!(await review()).decided_at)await must(call('/api/tenders/workspace','POST',{action:'bid-decision',id:t.id,decision:'bid',reason:'Strategic panel client'}),[200],'bid decision');
    await must(call('/api/tenders/workspace','POST',{action:'lost',id:t.id,reason:b.lostReason}),[200],'lost');c.note('tenders-lost');
   }
   continue;
  }
  const want=RANK.indexOf(b.target);
  const state=async()=>{const x=await at(),e=x.estimate_id?await one('SELECT workflow_state FROM estimates WHERE organisation_id=? AND id=?',[org,x.estimate_id]):null;return {...x,ws:e?.workflow_state||null};};
  let s=await state();
  if(want>=RANK.indexOf('pricing')&&['draft','reviewing'].includes(s.stage)){
   if(!await review())await must(call('/api/tenders/workspace','POST',{action:'bid-review',id:t.id,values:{strategic_fit:'Good fit for the '+b.division+' division',capacity:'Crew and plant available in the window',recommendation:'bid',recommendation_reason:'Fit and capacity confirmed'}}),[200],'bid review '+b.key);
   if(!(await review()).decided_at)await must(call('/api/tenders/workspace','POST',{action:'bid-decision',id:t.id,decision:'bid',reason:'Fit and capacity confirmed'}),[200],'bid decision '+b.key);
   s=await state();
  }
  if(want>=RANK.indexOf('pricing')&&!s.estimate_id){
   await must(call('/api/tenders/workspace','POST',{action:'create-estimate',id:t.id,mode:'general'}),[200],'estimate '+b.key);
   s=await state();c.note('estimates');
  }
  // Pricing and the tender-value update are separate substeps, each resumed from the estimate's and the tender's stored state.
  if(want>=RANK.indexOf('pricing')&&s.estimate_id){
   let est=(await must(call('/api/estimates?id='+s.estimate_id),[200],'get estimate')).estimate;
   if(!(est.data.items?.length>0)){
    await must(call('/api/estimates','PUT',{id:s.estimate_id,data:{...est.data,clientName:est.data.clientName,projectName:b.title,workType:b.division==='PRF'?'Profiling':b.division==='TC'?'Traffic management':'Asphalt resurfacing',specification:b.scope,items:b.items,marginValue:15,overheadsPct:8,contingencyPct:3}}),[200],'price estimate '+b.key);
    est=(await must(call('/api/estimates?id='+s.estimate_id),[200],'get priced estimate')).estimate;
   }
   // The tender's indicative value follows the priced estimate (rounded to $100), so the pipeline and the estimate tell the same story.
   const sell=Math.round(Number(est.totals?.sellRate||0)/100)*100;
   if(sell>0&&Math.abs(Number(s.estimated_value)-sell)>0.5){const cur=await one('SELECT revision FROM tenders WHERE organisation_id=? AND id=?',[org,t.id]);await must(call('/api/tenders/workspace','PATCH',{id:t.id,revision:Number(cur.revision),estimatedValue:sell}),[200],'tender value '+b.key);s=await state();}
  }
  c.ids['estimate:'+b.key]=s.estimate_id;
  if(want>=RANK.indexOf('estimate-review')&&!['review','approved'].includes(s.ws)){
   await must(call('/api/estimates/approval','POST',{estimateId:s.estimate_id,action:'submit'}),[200],'submit estimate '+b.key);s=await state();
  }
  if(want>=RANK.indexOf('estimate-approved')&&s.ws==='review'){
   await must(call('/api/estimates/approval','POST',{estimateId:s.estimate_id,action:'approve',notes:'Approved: margin and assumptions reviewed (demonstration).'}),[200],'approve estimate '+b.key);s=await state();
  }
  if(want>=RANK.indexOf('tender-approval')&&s.stage==='pricing'){
   await must(call('/api/tenders/workspace','POST',{action:'request-approval',id:t.id}),[200],'request tender approval '+b.key);s=await state();
  }
  if(want>=RANK.indexOf('submitted')&&s.stage==='approval'){
   if(s.approval_status==='requested'){await must(call('/api/tenders/workspace','POST',{action:'approval-decision',id:t.id,approve:true,notes:'Approved to submit (demonstration).'}),[200],'tender approval '+b.key);s=await state();}
   if(s.stage==='approval'&&s.approval_status==='approved'){await must(call('/api/tenders/workspace','POST',{action:'submit',id:t.id,method:'Client portal',version:'Rev A',notes:'Submitted (demonstration; nothing was sent).'}),[200],'submit tender '+b.key);s=await state();}
  }
  if(want>=RANK.indexOf('awarded')&&['submitted','clarification'].includes(s.stage)){
   await must(call('/api/tenders/workspace','POST',{action:'award',id:t.id}),[200],'award '+b.key);s=await state();c.note('awards');
  }
  c.ids['project:'+b.key]=s.project_id;
 }
 const n=async sql=>(await one(sql,[org])).n;
 log('opportunities',await n('SELECT COUNT(*) n FROM opportunities WHERE organisation_id=?'),'tenders',await n('SELECT COUNT(*) n FROM tenders WHERE organisation_id=?'),'estimates',await n('SELECT COUNT(*) n FROM estimates WHERE organisation_id=?'),'projects',await n('SELECT COUNT(*) n FROM jobs WHERE organisation_id=?'));
}
