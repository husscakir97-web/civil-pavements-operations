// Shifts and resource allocations (delivery workspace). Past shifts are Completed, today's is In Progress, future ones are Planned.
// TEST CLASH / TEST shifts are saved as Draft on purpose: the conflict engine reports them as warnings and refuses to move them to
// Planned, which is exactly what a tester should try.
const W={mia:'DEMO-E01',liam:'DEMO-E02',sofia:'DEMO-E03',ravi:'DEMO-E04',dan:'DEMO-E05',tom:'DEMO-E06',priya:'DEMO-E07',ben:'DEMO-E08',jess:'DEMO-E09',owen:'DEMO-E10',karl:'DEMO-E11',nina:'DEMO-E12',sam:'DEMO-E13',leah:'DEMO-E14'};
const P={profiler:'DEMO-P01',profiler2:'DEMO-P02',paver:'DEMO-P03',roller3:'DEMO-P04',roller8:'DEMO-P05',tipA:'DEMO-P06',tipB:'DEMO-P07',water:'DEMO-P08',vms:'DEMO-P09',arrow:'DEMO-P10',ute:'DEMO-P11',tip6:'DEMO-P12'};
const crew=(...keys)=>keys.map(k=>['workers',W[k]]);
const kit=(...keys)=>keys.map(k=>['plant',P[k]]);

// [name, project(B1|B2|B3), dayOffset, start, finish, status, workers, plant, requiredCompetencies, activity, notes]
export const SHIFTS=[
 ['Profiling Quarry Road — stage 1','B1',-21,'06:00','15:00','Completed',[...crew('karl','leah','sam','mia','liam')],[...kit('profiler','water','vms')],'Construction Induction (White Card)','Profiling','Completed; 4,200 m2 profiled.'],
 ['Paving Quarry Road — chainage 0–800','B1',-14,'06:00','16:00','Completed',[...crew('dan','tom','priya','ben','jess','mia','liam')],[...kit('paver','roller3','roller8','tipA','tipB','vms','ute')],'Construction Induction (White Card)','Paving','Completed.'],
 ['Paving Quarry Road — chainage 800–1600','B1',-7,'06:00','16:00','Completed',[...crew('dan','tom','priya','ben','jess','mia','liam')],[...kit('paver','roller3','roller8','tipA','tipB','vms','ute')],'Construction Induction (White Card)','Paving','Completed.'],
 ['Paving Quarry Road — chainage 1600–2400','B1',0,'06:00','16:00','In Progress',[...crew('dan','tom','priya','ben','jess','mia','liam')],[...kit('paver','roller3','roller8','tipA','tipB','vms','ute')],'Construction Induction (White Card)','Paving','In progress on the seed date.'],
 ['Paving Quarry Road — chainage 2400–3200','B1',2,'06:00','16:00','Planned',[...crew('dan','tom','priya','ben','jess','mia','liam')],[...kit('paver','roller3','roller8','tipA','tipB','vms','ute')],'Construction Induction (White Card)','Paving','Planned.'],
 ['Final wearing course and linemarking — Quarry Road','B1',3,'06:00','16:00','Planned',[...crew('dan','tom','priya','ben','mia','liam')],[...kit('paver','roller3','tipA','vms')],'Construction Induction (White Card)','Paving and linemarking','Planned; linemarking subcontractor attends.'],
 ['Profiling Anzac Parade — night 1','B2',-140,'20:00','05:00','Completed',[...crew('karl','nina','sam','mia','liam')],[...kit('profiler','water','vms','arrow')],'Construction Induction (White Card)','Profiling','Completed.'],
 ['Profiling Anzac Parade — night 2','B2',-139,'20:00','05:00','Completed',[...crew('karl','nina','sam','mia','liam')],[...kit('profiler','water','vms','arrow')],'Construction Induction (White Card)','Profiling','Completed.'],
 ['Profiling Anzac Parade — night 3','B2',-138,'20:00','05:00','Completed',[...crew('karl','nina','sam','mia','liam')],[...kit('profiler','water','vms','arrow')],'Construction Induction (White Card)','Profiling','Completed.'],
 ['Night traffic control — motorway lane closure 1','B3',14,'20:00','05:00','Planned',[...crew('owen','mia','liam')],[...kit('vms','arrow','ute')],'Construction Induction (White Card)','Traffic control','Planned (setup stage project).'],
 ['Night traffic control — motorway lane closure 2','B3',15,'20:00','05:00','Draft',[...crew('owen','mia','liam')],[...kit('vms','arrow','ute')],'Construction Induction (White Card)','Traffic control','Draft.'],
 // ---- TEST CASES (Draft) ----
 ['TEST CLASH — Profiling Quarry Road second crew','B1',4,'06:00','15:00','Draft',[...crew('karl','sam')],[...kit('profiler','water')],'Construction Induction (White Card)','Profiling','TEST: resource clash. Profiler P01 and Karl Jensen are also booked on the shift below.'],
 ['TEST CLASH — Profiling carpark enquiry','B1',4,'07:00','14:00','Draft',[...crew('karl','leah')],[...kit('profiler')],'Construction Induction (White Card)','Profiling','TEST: resource clash (double-booked worker and plant with the shift above).'],
 ['TEST — Unavailable plant','B1',6,'06:00','15:00','Draft',[...crew('dan','tom')],[...kit('profiler2','tip6')],'Construction Induction (White Card)','Profiling','TEST: plant P02 has a safety hold and P12 has expired registration.'],
 ['TEST — Expired qualification','B1',6,'06:00','15:00','Draft',[...crew('sofia','mia')],[...kit('vms')],'Traffic Controller (TC)','Traffic control','TEST: Sofia Marchetti’s Traffic Controller (TC) qualification expired 30 days before the seed date.'],
];

export async function shiftsStage(c){
 const {call,must,one,org,d,log}=c;
 for(const [name,proj,day,start,finish,status,workers,plant,required,activity,notes] of SHIFTS){
  if(await one('SELECT id FROM shifts WHERE organisation_id=? AND name=?',[org,name]))continue;
  const jobId=c.ids['project:'+proj];
  const assignments=[
   ...workers.map(([category,no])=>({resourceId:c.ids['worker:'+no],category,name:null,role:null,hours:9,rate:0,payload:0,trips:0,_no:no})),
   ...plant.map(([category,no])=>({resourceId:c.ids['plant:'+no],category,name:null,role:null,hours:9,rate:0,payload:0,trips:0,_no:no})),
  ];
  for(const a of assignments){
   const row=a.category==='workers'?await one('SELECT name,role_title,hourly_rate FROM workers WHERE id=?',[a.resourceId]):await one('SELECT name,category AS role_title,hourly_rate FROM plant WHERE id=?',[a.resourceId]);
   a.name=row.name;a.role=row.role_title;a.rate=Number(row.hourly_rate||0);delete a._no;
  }
  // 'In Progress' normally needs the full pre-start checklist (permit, TMP, TGS, occupancy hours...). The demo records it as Planned
  // through the API and then marks today's shift In Progress directly: a clearly marked back-dated state for the walkthrough.
  await must(call('/api/delivery','POST',{kind:'shifts',record:{id:'',name,status:status==='In Progress'?'Planned':status,metadata:{jobId,date:d(day),start,finish,activity,assignments,requiredCompetencies:required,notes,tonnes:0,checks:{}}}}),[200,201],'shift '+name);
  if(status==='In Progress')await c.db.query("UPDATE shifts SET status='In Progress' WHERE organisation_id=? AND name=?",[org,name]);
  c.note('shifts');
 }
 log('shifts',(await one('SELECT COUNT(*) n FROM shifts WHERE organisation_id=?',[org])).n,'assignments',(await one('SELECT COUNT(*) n FROM shift_assignments WHERE organisation_id=?',[org])).n);
}
