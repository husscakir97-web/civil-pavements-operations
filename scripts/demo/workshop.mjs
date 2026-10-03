// Workshop: defects, repairs, verification, meter readings, service plans and a critical defect that puts plant on safety hold.
export async function workshopStage(c){
 const {call,must,one,org,d,log}=c;
 const asset=no=>c.ids['plant:'+no];
 const rev=async no=>Number((await one('SELECT revision FROM plant WHERE organisation_id=? AND id=?',[org,asset(no)])).revision);
 const order=(no,title)=>one('SELECT id,status,revision FROM workshop_orders WHERE organisation_id=? AND asset_id=? AND title=?',[org,asset(no),title]);
 const post=(b,label)=>must(call('/api/workshop','POST',b),[200,201],label);

 // Critical defect: automatic safety hold + Out of service (TEST: unavailable plant).
 if(!await order('DEMO-P02','Hydraulic leak on cutter drum drive')){
  await post({action:'defect',assetId:asset('DEMO-P02'),title:'Hydraulic leak on cutter drum drive',severity:'critical',note:'TEST: critical defect found at pre-start. Machine tagged out; do not allocate until verified.'},'critical defect');c.note('workshop-defects');
 }
 // Major defect, repaired and awaiting independent verification.
 if(!await order('DEMO-P03','Paver conveyor chain tension out of tolerance')){
  await post({action:'defect',assetId:asset('DEMO-P03'),title:'Paver conveyor chain tension out of tolerance',severity:'major',note:'Found during pre-start on the previous paving shift.'},'major defect');c.note('workshop-defects');
 }
 let o=await order('DEMO-P03','Paver conveyor chain tension out of tolerance');
 if(o&&o.status==='open')await post({action:'repair',id:o.id,revision:Number(o.revision),note:'Chain re-tensioned and re-pinned.',labourHours:3.5,parts:'Chain link kit (1)'},'repair');
 // Minor defect repaired and awaiting independent verification.
 if(!await order('DEMO-P04','Roller sprinkler nozzle blocked')){
  await post({action:'defect',assetId:asset('DEMO-P04'),title:'Roller sprinkler nozzle blocked',severity:'minor',note:'Drum water spray uneven.'},'minor defect');c.note('workshop-defects');
 }
 o=await order('DEMO-P04','Roller sprinkler nozzle blocked');
 if(o&&o.status==='open'){
  await post({action:'repair',id:o.id,revision:Number(o.revision),note:'Nozzles cleaned and flow tested.',labourHours:0.5,parts:''},'repair minor');
  o=await order('DEMO-P04','Roller sprinkler nozzle blocked');
 }
 // Verification must be done by a DIFFERENT authorised person, so the demo leaves repairs awaiting independent verification (a walkthrough step).
 // Meter reading + service plan due soon (P05) and an overdue plan (P07, TEST). The reading and the plan are separate substeps, each
 // resumed from stored state (a reading recorded without its plan is completed on the next run).
 for(const [no,meter] of [['DEMO-P05',{meterType:'hours',reading:1180,note:'Weekly reading'}],['DEMO-P07',{meterType:'km',reading:48200,note:'Odometer'}]]){
  if(!await one('SELECT id FROM asset_meter_readings WHERE organisation_id=? AND asset_id=?',[org,asset(no)]))await post({action:'meter',assetId:asset(no),...meter},'meter');
  if(!(await one('SELECT next_service_date FROM plant WHERE organisation_id=? AND id=?',[org,asset(no)])).next_service_date){
   if(no==='DEMO-P05')await post({action:'plan',assetId:asset(no),revision:await rev(no),nextServiceMeter:1200,nextServiceDate:d(10),note:'Initial 250 h service plan'},'plan');
   else await post({action:'plan',assetId:asset(no),revision:await rev(no),nextServiceMeter:48000,nextServiceDate:d(-5),note:'TEST: service overdue (meter and date already passed).'},'plan overdue');
   c.note('service-plans');
  }
 }
 // A completed service on the profiler (service history).
 if(!await one("SELECT id FROM asset_service_events WHERE organisation_id=? AND asset_id=? AND kind='completed'",[org,asset('DEMO-P01')])){
  await post({action:'service',assetId:asset('DEMO-P01'),revision:await rev('DEMO-P01'),performedOn:d(-30),meterType:'hours',meterReading:940,nextServiceMeter:1190,nextServiceDate:d(60),note:'250 h service completed (demonstration).',clientRequestId:`demo-service-${c.tag}-p01`},'service');c.note('service-events');
 }
 log('workshop orders',(await one('SELECT COUNT(*) n FROM workshop_orders WHERE organisation_id=?',[org])).n,'held plant',(await one('SELECT COUNT(*) n FROM plant WHERE organisation_id=? AND safety_hold=1',[org])).n);
}
