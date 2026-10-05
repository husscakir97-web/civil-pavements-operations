// Project programme (with saved costing assumptions) and Planning v0.1 scenarios for the Quarry Road resurfacing.
// Planning ids are deterministic (derived from the organisation tag), so the plan is rebuilt identically on every run.
const PROGRAMME=[
 // [name, startOffset, days, predecessorIndex|null, status, quantity, unit, perDay, hoursPerDay, rate, basis]
 ['Establish traffic management',-45,2,null,'complete',0,'',0,8,148,'hour'],
 ['Profile existing wearing course',-44,3,0,'complete',4200,'m2',1400,8,210,'hour'],
 ['Tack coat and surface preparation',-41,1,1,'complete',4200,'m2',4200,8,95,'hour'],
 ['Paving chainage 0–1,600',-40,4,2,'complete',310,'t',90,9,520,'hour'],
 ['Paving chainage 1,600–3,200',-36,4,3,'in_progress',310,'t',90,9,520,'hour'],
 ['Linemarking and reinstatement',-30,2,4,'planned',1,'item',1,8,null,'hour'],
 ['Demobilise and close out',-28,2,5,'planned',0,'',0,8,null,'hour'],
];

export async function planningStage(c){
 const {call,must,one,org,d,tag,log}=c;
 const projectId=c.ids['project:B1'];
 // ---- programme ----
 const prog=name=>one('SELECT id,revision FROM program_activities WHERE organisation_id=? AND project_id=? AND name=?',[org,projectId,name]);
 const made=[];
 for(const [name,start,days,pred,,qty,unit,perDay,hours,rate,basis] of PROGRAMME){
  let a=await prog(name);
  if(!a){
   await must(call('/api/projects/program','POST',{projectId,name,startDate:d(start),durationDays:days,predecessorId:pred===null?null:made[pred],responsible:'',workPackage:'Quarry Road resurfacing',resourceRequirement:'',plannedQuantity:qty,quantityUnit:unit,productionPerDay:perDay,status:'planned',...(rate!==null?{productiveHoursPerDay:hours,directCostRate:rate,costRateBasis:basis}:{})}),[200,201],'programme '+name);
   a=await prog(name);c.note('programme-activities');
  }
  made.push(a.id);
 }
 for(const [i,[name,,,,status]] of PROGRAMME.entries()){
  if(status==='planned')continue;
  const a=await one('SELECT id,revision,status FROM program_activities WHERE organisation_id=? AND project_id=? AND name=?',[org,projectId,name]);
  if(a.status!==status)await must(call('/api/projects/program','PATCH',{action:'update',projectId,id:a.id,revision:Number(a.revision),changes:{status}}),[200],'programme status '+name);
  void i;
 }
 // ---- Planning v0.1 ----
 const id=(scenario,key)=>`d${tag}-pl-${scenario}-${key}`.slice(0,64);
 const plant=no=>({type:'plant',id:c.ids['plant:'+no]});
 const worker=no=>({type:'worker',id:c.ids['worker:'+no]});
 const act=(scn,key,over)=>({id:id(scn,key),kind:'activity',name:'',notes:'',quantity:null,unit:null,productivity:null,productivityUnit:null,durationMode:'entered',durationDays:null,hoursPerDay:null,plannedStart:null,requirements:[],costItems:[],sharedCostIds:[],...over});
 const req=(scn,key,kind,name,quantity,rate,rateBasis,resourceRef=null)=>({id:id(scn,key),kind,name,quantity,rate,rateBasis,resourceRef});
 const shared=(scn,key,label,amount)=>({id:id(scn,key),label,amount});
 const doc=(scn,{nightFactor=1,profilingSub=false,unpriced=false}={})=>{
  const s=scn,mob=shared(s,'mob','Mobilisation and demobilisation of plant',4500),tm=shared(s,'tmp','Traffic management plan and approvals',nightFactor>1?3800:2400);
  const activities=[];
  activities.push(
   act(s,'tm',{name:'Establish traffic management',durationMode:'entered',durationDays:nightFactor>1?3:2,hoursPerDay:nightFactor>1?10:8,requirements:[req(s,'tm-r1','labour','Traffic control crew (3 pax)',3,Math.round(58*nightFactor*100)/100,'hour',worker('DEMO-E01')),req(s,'tm-r2','plant','VMS and arrow board trailers',2,16,'day',plant('DEMO-P09'))],sharedCostIds:[tm.id]}),
   profilingSub
    ?act(s,'prof',{name:'Profile existing wearing course (subcontract)',durationMode:'entered',durationDays:3,hoursPerDay:8,notes:'Alternative: subcontract the profiling. Lump-sum rate not yet received.',costItems:[{id:id(s,'prof-c1'),label:'Subcontract profiling lump sum (QUOTE PENDING)',amount:null}]})
    :act(s,'prof',{name:'Profile existing wearing course',durationMode:'derived',quantity:4200,unit:'m2',productivity:175,productivityUnit:'m2',hoursPerDay:8,requirements:[req(s,'prof-r1','plant','Wirtgen W 100 profiler',1,210,'hour',plant('DEMO-P01')),req(s,'prof-r2','labour','Profiling crew (3 pax)',3,Math.round(52*nightFactor*100)/100,'hour',worker('DEMO-E11')),req(s,'prof-r3','plant','Water cart',1,85,'hour',plant('DEMO-P08'))],sharedCostIds:[mob.id]}),
   act(s,'sign',{name:'Install signage and delineation',durationMode:'entered',durationDays:1,hoursPerDay:8,requirements:[req(s,'sign-r1','labour','Signage crew (2 pax)',2,44,'hour')],costItems:[{id:id(s,'sign-c1'),label:'Signage hire establishment',amount:650}]}),
   act(s,'tack',{name:'Tack coat and surface preparation',durationMode:'derived',quantity:4200,unit:'m2',productivity:700,productivityUnit:'m2',hoursPerDay:8,requirements:[req(s,'tack-r1','labour','Sprayer crew (2 pax)',2,50,'hour'),req(s,'tack-r2','plant','Bitumen sprayer',1,120,'hour')]}),
   act(s,'pave',{name:'Pave and compact asphalt',durationMode:'derived',quantity:620,unit:'t',productivity:Math.round(14/nightFactor*100)/100,productivityUnit:'t',hoursPerDay:9,requirements:[req(s,'pave-r1','plant','Vogele paver',1,230,'hour',plant('DEMO-P03')),req(s,'pave-r2','plant','Rollers (2)',2,107.5,'hour',plant('DEMO-P05')),req(s,'pave-r3','labour','Paving crew (5 pax)',5,Math.round(55*nightFactor*100)/100,'hour',worker('DEMO-E05')),req(s,'pave-r4','plant','Tipper trucks (2)',2,unpriced?null:105,'hour',plant('DEMO-P06'))],sharedCostIds:[mob.id]}),
   act(s,'lines',{name:'Linemarking and reinstatement',durationMode:'entered',durationDays:2,hoursPerDay:8,requirements:[req(s,'lines-r1','labour','Linemarking subcontractor crew',2,0,'hour')],costItems:[{id:id(s,'lines-c1'),label:'Linemarking subcontract (lump sum)',amount:6500}],notes:'Subcontractor crew is costed in the lump sum: the labour rate is a known zero, not an unknown.'}),
   {...act(s,'done',{name:'Practical completion',durationDays:0}),kind:'milestone'},
  );
  const link=(a,b)=>({from:id(s,a),to:id(s,b)});
  return {activities,sharedCosts:[mob,tm],dependencies:[link('tm','prof'),link('tm','sign'),link('prof','tack'),link('sign','tack'),link('tack','pave'),link('pave','lines'),link('lines','done')]};
 };
 const NAME='Quarry Road resurfacing — methodology options (DEMO)';
 const SCENARIOS=[
  ['Base: day shift, one paving crew',doc('b')],
  ['Alternative: night works (lower productivity, higher rates)',doc('n',{nightFactor:1.25})],
  ['Alternative: subcontract profiling (quote pending: total unknown)',doc('s',{profilingSub:true,unpriced:true})],
 ];
 let plan=await one('SELECT id,revision FROM planning_plans WHERE organisation_id=? AND name=?',[org,NAME]);
 if(!plan){
  const made1=await must(call('/api/planning','POST',{action:'create-plan',name:NAME,accessScope:'organisation',estimateId:c.ids['estimate:B1'],projectId,scenarioName:SCENARIOS[0][0]}),[200],'plan');
  plan=await one('SELECT id,revision FROM planning_plans WHERE organisation_id=? AND name=?',[org,NAME]);c.note('planning-plans');void made1;
 }
 for(const [i,[scenarioName,document]] of SCENARIOS.entries()){
  let s=await one('SELECT id,revision FROM planning_scenarios WHERE organisation_id=? AND plan_id=? AND name=?',[org,plan.id,scenarioName]);
  if(!s){
   if(i>0)await must(call('/api/planning','POST',{action:'create-scenario',planId:plan.id,name:scenarioName}),[200],'scenario');
   s=await one('SELECT id,revision FROM planning_scenarios WHERE organisation_id=? AND plan_id=? AND name=?',[org,plan.id,scenarioName]);
   if(!s)throw new Error('scenario missing '+scenarioName);
  }
  const has=Number((await one('SELECT COUNT(*) n FROM planning_activities WHERE organisation_id=? AND scenario_id=?',[org,s.id])).n);
  if(!has){
   await must(call('/api/planning','POST',{action:'save',scenarioId:s.id,expectedRevision:Number(s.revision),document}),[200],'plan save '+scenarioName);c.note('planning-scenarios');
  }
 }
 log('programme',(await one('SELECT COUNT(*) n FROM program_activities WHERE organisation_id=?',[org])).n,'plans',(await one('SELECT COUNT(*) n FROM planning_plans WHERE organisation_id=?',[org])).n,'scenarios',(await one('SELECT COUNT(*) n FROM planning_scenarios WHERE organisation_id=?',[org])).n);
}
