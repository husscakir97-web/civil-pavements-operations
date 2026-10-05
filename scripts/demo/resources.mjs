// People, qualifications, vehicles/plant, crews, suppliers and subcontractors. Fictional; non-deliverable contact details.
const EMAIL=(first,last)=>`${first}.${last}@kestrel-demo.example.invalid`.toLowerCase();

// [employeeNumber, first, last, role, employment, hourlyRate, division, location, [competencies: type, reference, issuedOffset, expiryOffset]]
export const WORKERS=[
 ['DEMO-E01','Mia','Okafor','Traffic Control Supervisor','employee',58,'TC','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-01',-900,null],['Traffic Controller (TC)','TC-DEMO-01',-400,320],['Implement Traffic Control Plan (ITCP)','ITCP-DEMO-01',-400,320],['First Aid','FA-DEMO-01',-200,165]]],
 ['DEMO-E02','Liam','Brennan','Traffic Controller','employee',46,'TC','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-02',-800,null],['Traffic Controller (TC)','TC-DEMO-02',-300,420]]],
 ['DEMO-E03','Sofia','Marchetti','Traffic Controller','casual',44,'TC','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-03',-700,null],['Traffic Controller (TC)','TC-DEMO-03',-800,-30]]], // TEST: expired qualification
 ['DEMO-E04','Ravi','Menon','Traffic Management Designer','employee',72,'TC','Exampleton office',[['Construction Induction (White Card)','WC-DEMO-04',-1100,null],['Traffic Management Design (TMD)','TMD-DEMO-04',-500,260]]],
 ['DEMO-E05','Dan','Hollis','Paving Foreman','employee',66,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-05',-1500,null],['Asphalt Paving Foreman','APF-DEMO-05',-600,540],['Implement Traffic Control Plan (ITCP)','ITCP-DEMO-05',-300,400]]],
 ['DEMO-E06','Tom','Reyes','Paver Operator','employee',55,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-06',-900,null],['Asphalt Paver Operator','APO-DEMO-06',-500,610]]],
 ['DEMO-E07','Priya','Nair','Roller Operator','employee',50,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-07',-950,null],['Roller Operator','RO-DEMO-07',-450,520]]],
 ['DEMO-E08','Ben','Walker','Truck Driver','employee',48,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-08',-950,null],['Heavy Rigid Licence (HR)','HR-DEMO-08',-700,700]]],
 ['DEMO-E09','Jess','Carter','Labourer','casual',40,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-09',-300,null],['Working at Heights','WAH-DEMO-09',-200,330]]],
 ['DEMO-E10','Owen','Pike','Night Shift Supervisor','employee',64,'APM','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-10',-1300,null],['Implement Traffic Control Plan (ITCP)','ITCP-DEMO-10',-250,20]]], // expiring soon
 ['DEMO-E11','Karl','Jensen','Profiler Operator','employee',62,'PRF','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-11',-1200,null],['Profiler Operator','PO-DEMO-11',-500,600]]],
 ['DEMO-E12','Nina','Alvarez','Profiler Operator','employee',60,'PRF','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-12',-800,null],['Profiler Operator','PO-DEMO-12',-700,12]]], // expiring soon
 ['DEMO-E13','Sam','Wu','Labourer / Spotter','casual',40,'PRF','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-13',-250,null],['Working at Heights','WAH-DEMO-13',-150,380]]],
 ['DEMO-E14','Leah','Grant','Profiling Leading Hand','employee',58,'PRF','Exampleton depot',[['Construction Induction (White Card)','WC-DEMO-14',-1000,null],['Profiler Operator','PO-DEMO-14',-400,480]]],
];

// [plantNumber, name, category, make, model, ownership, hourly, day, complianceOffset, status, registration, division, note]
export const PLANT=[
 ['DEMO-P01','Wirtgen W 100 Profiler','Profiler','Wirtgen','W 100','owned',210,1700,200,'Available',null,'PRF',''],
 ['DEMO-P02','Wirtgen W 120 Profiler','Profiler','Wirtgen','W 120','owned',240,1950,180,'Available',null,'PRF','TEST: unavailable plant (critical workshop defect and safety hold)'],
 ['DEMO-P03','Vogele Super 1800 Paver','Paver','Vogele','Super 1800','owned',230,1850,260,'Available',null,'APM',''],
 ['DEMO-P04','Hamm 3-tonne Roller','Roller','Hamm','HD 12','owned',95,760,300,'Available',null,'APM',''],
 ['DEMO-P05','Bomag 8-tonne Roller','Roller','Bomag','BW 174','owned',120,960,300,'Available',null,'APM',''],
 ['DEMO-P06','Tipper Truck 10 m3 (A)','Truck','Isuzu','FVZ 1400','owned',105,840,150,'Available','DEMO-T06','APM',''],
 ['DEMO-P07','Tipper Truck 10 m3 (B)','Truck','Isuzu','FVZ 1400','owned',105,840,150,'Available','DEMO-T07','APM',''],
 ['DEMO-P08','Water Cart','Truck','Hino','FM 500','owned',85,680,150,'Available','DEMO-T08','PRF',''],
 ['DEMO-P09','VMS Board Trailer','Traffic','Demo','VMS-3','owned',18,140,365,'Available',null,'TC',''],
 ['DEMO-P10','Arrow Board Trailer','Traffic','Demo','AB-2','owned',15,120,365,'Available',null,'TC',''],
 ['DEMO-P11','Traffic Control Ute','Vehicle','Toyota','HiLux','owned',35,280,200,'Available','DEMO-U11','TC',''],
 ['DEMO-P12','Tipper Truck 6 m3 (registration expired)','Truck','Hino','FC 1022','owned',90,720,-15,'Available','DEMO-T12','APM','TEST: unavailable plant (compliance expired)'],
];

export const CREWS=[['DEMO Paving Crew A','APM'],['DEMO Profiling Crew','PRF'],['DEMO Traffic Control Crew','TC']];
export const SUPPLIERS=[['DEMO Coastline Asphalt (supplier)',{trade:'Asphalt supply',email:'orders@coastline-demo.example.invalid',phone:'0400 000 101'}],['DEMO Roadsign Supplies (supplier)',{trade:'Signs and barriers',email:'sales@roadsign-demo.example.invalid',phone:'0400 000 102'}]];
export const SUBS=[['DEMO Stripe Right Linemarking (subcontractor)',{trade:'Linemarking',email:'jobs@striperight-demo.example.invalid',phone:'0400 000 201'}],['DEMO Boundary Survey Services (subcontractor)',{trade:'Survey',email:'office@boundary-demo.example.invalid',phone:'0400 000 202'}]];

export async function resourceStage(c){
 const {call,must,one,all,org,db,d,log}=c;
 for(const [no,first,last,role,employment,rate,division,location,comps] of WORKERS){
  let w=await one('SELECT id FROM workers WHERE organisation_id=? AND employee_number=?',[org,no]);
  if(!w){
   const made=await must(call('/api/operations/resources','POST',{action:'saveWorker',worker:{firstName:first,lastName:last,employeeNumber:no,email:EMAIL(first,last),phone:'0400 000 '+String(300+Number(no.slice(-2))),roleTitle:role,employmentType:employment,hourlyRate:rate,location,status:'Active'}}),[200,201],'worker '+no);
   w={id:made.id};c.note('workers');
  }
  c.ids['worker:'+no]=w.id;c.ids['division-of:'+no]=division;
  for(const [type,reference,issued,expiry] of comps){
   const have=await one("SELECT id FROM worker_competencies WHERE organisation_id=? AND worker_id=? AND competency_type=? AND status='current'",[org,w.id,type]);
   if(have)continue;
   await must(call('/api/operations/resources','POST',{action:'saveCompetency',workerId:w.id,competency:{competencyType:type,reference,issuedDate:d(issued),expiryDate:expiry===null?null:d(expiry)}}),[200,201],'competency '+type);c.note('qualifications');
  }
 }
 for(const [no,name,category,make,model,ownership,hourly,day,compliance,status,registration,,note] of PLANT){
  let p=await one('SELECT id FROM plant WHERE organisation_id=? AND plant_number=?',[org,no]);
  if(!p){
   const made=await must(call('/api/operations/resources','POST',{action:'savePlant',plant:{name:`${no} ${name}`,plantNumber:no,registration,category,description:note||name,make,model,ownership,hourlyRate:hourly,dayRate:day,complianceExpiry:d(compliance),location:'Exampleton depot',status}}),[200,201],'plant '+no);
   p={id:made.id};c.note('plant');
  }
  c.ids['plant:'+no]=p.id;
 }
 for(const [module,rows] of [['crews',CREWS.map(([n,div])=>[n,{division:div,members:[]}])],['suppliers',SUPPLIERS],['subcontractors',SUBS]]){
  for(const [name,metadata] of rows){
   const table=module;
   const have=await one(`SELECT id FROM ${table} WHERE organisation_id=? AND name=?`,[org,name]);
   if(have){c.ids[`${module}:${name}`]=have.id;continue;}
   const made=await must(call('/api/os/records','POST',{module,name,status:'active',metadata}),[200,201],module+' '+name);
   c.ids[`${module}:${name}`]=made.id||made.record?.id;c.note(module);
  }
 }
 log('workers',(await one('SELECT COUNT(*) n FROM workers WHERE organisation_id=?',[org])).n,'plant',(await one('SELECT COUNT(*) n FROM plant WHERE organisation_id=?',[org])).n);
 void all;void db;
}
