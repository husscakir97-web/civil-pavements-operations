// Projects (created by award), team, setup data and lifecycle. Readiness evidence (risk, SWMS, ITP, IMS pack, checklist) is
// produced through the real registers so the "ready", "active" and "closed" states are earned, not forced.
export const USERS=[
 ['pm','Elena Voss','project_manager','elena.voss'],['est','Marcus Doyle','estimator','marcus.doyle'],['sched','Hana Kobayashi','scheduler','hana.kobayashi'],
 ['site','Joel Mercer','site_engineer','joel.mercer'],['acct','Rina Patel','accounts','rina.patel'],
];
const SETUP={
 B1:{start:-45,pc:20,finish:34,contractNumber:'MSC-2026-0412',contractType:'Schedule of rates',retention:5,terms:30,defects:12,lifecycle:'active'},
 B2:{start:-140,pc:-100,finish:-95,contractNumber:'RCC-2026-0187',contractType:'Lump sum',retention:5,terms:30,defects:6,lifecycle:'closed'},
 B3:{start:14,pc:190,finish:200,contractNumber:'CT-TC-2026-021',contractType:'Panel — schedule of rates',retention:0,terms:30,defects:0,lifecycle:'setup'},
};

export async function seedUsers(c){
 const {db,org,tag,ids,note}=c;
 for(const [key,name,role,local] of USERS){
  const id=`d${tag}-user-${key}`;
  const [r]=await db.query('INSERT IGNORE INTO users (id,organisation_id,email,name,role,created_at,active) VALUES (?,?,?,?,?,?,1)',[id,org,`${local}@kestrel-demo.example.invalid`,name,role,new Date(`${c.SEED_DATE}T00:00:00Z`).toISOString()]);
  if(r.affectedRows)note('users');
  ids['user:'+key]=id;
 }
}

async function makeReady(c,projectId,label){
 const {call,must,one,org}=c;
 const reg=key=>({list:q=>call(`/api/registers/${key}${q||''}`),create:(parentId,values)=>call(`/api/registers/${key}`,'POST',{parentId,values}),update:(id,revision,values)=>call(`/api/registers/${key}`,'PATCH',{id,revision,values}),move:(id,transition)=>call(`/api/registers/${key}`,'PATCH',{id,transition})});
 if(!await one('SELECT id FROM risks WHERE organisation_id=? AND project_id=?',[org,projectId])){
  const risk=(await must(reg('risks').create(projectId,{title:`${label}: traffic and plant interface`,category:'safety',initial_likelihood:4,initial_consequence:4,residual_likelihood:2,residual_consequence:3}),[201],'risk')).record;
  await must(reg('risks').update(risk.id,risk.revision,{controls:'Traffic management plan, exclusion zones, spotters, pre-start briefing'}),[200],'risk controls');
  await must(reg('risks').move(risk.id,'controlled'),[200],'risk controlled');c.note('risks');
 }
 if(!await one('SELECT id FROM swms WHERE organisation_id=? AND project_id=?',[org,projectId])){
  const sw=await must(call('/api/hseq/swms','POST',{action:'create',projectId,title:`${label}: asphalt works`,questionnaire:{activity:'Profile, tack and pave asphalt under traffic management',workSteps:['Establish traffic management','Profile existing surface','Apply tack coat','Pave and roll','Reinstate linemarking'],highRiskWork:['mobile-plant'],ppe:['Hi-vis','Safety boots','Hearing protection'],emergency:'Call 000; first aider on site',responsiblePeople:'Site supervisor'}}),[201],'swms');
  let swms=await must(call('/api/hseq/swms?id='+sw.swmsId),[200],'swms get');
  const content={...swms.revisions[0].content,workSteps:swms.revisions[0].content.workSteps.map(s=>({...s,hazards:s.hazards||'Moving plant, hot asphalt, live traffic',controls:s.controls||'Exclusion zone, spotters, TMP, PPE'}))};
  swms=await must(call('/api/hseq/swms','POST',{action:'save',id:sw.swmsId,revisionId:sw.revisionId,updatedAt:swms.revisions[0].updated_at,content}),[200],'swms save');
  for(const to of ['review','approved','issued'])swms=await must(call('/api/hseq/swms','POST',{action:'transition',id:sw.swmsId,to}),[200],'swms '+to);
  c.note('swms');
 }
 if(!await one('SELECT id FROM itps WHERE organisation_id=? AND project_id=?',[org,projectId])){
  const itp=(await must(reg('itps').create(projectId,{title:`${label}: asphalt placement ITP`,activity:'Asphalt placement',specification:'Project specification (demonstration)'}),[201],'itp')).record;
  for(const [inspection,criteria,type] of [['Pre-lay surface condition','Clean, dry, tacked','witness'],['Mix temperature at paver','Within specified range','none'],['Compaction (roller pattern and density)','Meets specified relative compaction','hold']]){
   await must(call('/api/registers/itp_items','POST',{parentId:itp.id,values:{inspection,acceptance_criteria:criteria,point_type:type,responsibility:'Foreman'}}),[201],'itp item');
  }
  c.note('itps');
 }
 const ims=await must(call('/api/ims?jobId='+projectId),[200],'ims');
 for(const it of ims.jobPack||ims.job_pack||[])if(!/not applicable|complete/i.test(it.status||''))await must(call('/api/ims','PATCH',{kind:'job-pack',id:it.id,status:'Not Applicable',reason:'Covered by company IMS for this scope (demonstration)'}),[200],'ims n/a');
 const pw=await must(call('/api/projects/workspace?id='+projectId),[200],'workspace');
 for(const cat of pw.readiness.categories)for(const it of cat.items.filter(i=>i.source==='checklist'&&!i.ok))await must(reg('readiness').move(it.id,'complete'),[200],'readiness item');
}

export async function projectsStage(c){
 const {call,must,one,org,d,log}=c;
 await seedUsers(c);
 const bids={B1:'DEMO-T-001',B2:'DEMO-T-002',B3:'DEMO-T-003'};
 for(const [key,ref] of Object.entries(bids)){
  const t=await one('SELECT project_id FROM tenders WHERE organisation_id=? AND reference=?',[org,ref]);
  const id=t.project_id,s=SETUP[key];
  c.ids['project:'+key]=id;
  let p=await one('SELECT * FROM jobs WHERE organisation_id=? AND id=?',[org,id]);
  if(!p.project_manager_user_id){
   await must(call('/api/projects/workspace','PATCH',{id,revision:p.revision,projectManagerUserId:c.ids['user:pm'],projectManagerName:'Elena Voss',startDate:d(s.start),practicalCompletionDate:d(s.pc),finishDate:d(s.finish),contractNumber:s.contractNumber,contractType:s.contractType,retentionEnabled:s.retention>0?1:0,retentionPct:s.retention,paymentTermsDays:s.terms,defectsMonths:s.defects}),[200],'project setup '+key);
   c.note('project-setups');
  }
  // Site paperwork the shift planner checks (occupancy hours, PO, site contact, permit, TMP, TGS), recorded on the job.
  {const row=await one('SELECT name,status,metadata FROM jobs WHERE organisation_id=? AND id=?',[org,id]);const meta=JSON.parse(row.metadata||'{}');
   if(!meta.occupancyStart){
    const night=key!=='B1';
    await must(call('/api/delivery','POST',{kind:'jobs',record:{id,name:row.name,status:row.status,metadata:{occupancyStart:night?'18:00':'06:00',occupancyFinish:night?'06:00':'18:00',po:'DEMO-PO-'+(1000+Number(key.slice(1))),siteContact:'Client site representative (fictional)',permit:'DEMO-PERMIT-'+key,tmp:'DEMO-TMP-'+key,tgs:'DEMO-TGS-'+key}}}),[200,201],'job paperwork '+key);c.note('job-paperwork');
   }}
  for(const [u,role] of [['pm','project_manager'],['site','site_engineer'],['acct','commercial']]){
   if(!await one('SELECT id FROM project_members WHERE organisation_id=? AND project_id=? AND user_id=?',[org,id,c.ids['user:'+u]])){
    await must(call('/api/projects/team','POST',{projectId:id,userId:c.ids['user:'+u],projectRole:role}),[200,201],'team '+u);c.note('project-members');
   }
  }
  p=await one('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',[org,id]);
  if(s.lifecycle!=='setup'&&p.stage==='setup'){
   await makeReady(c,id,key==='B1'?'Quarry Road':'Anzac Parade');
   await must(call('/api/projects/workspace','POST',{action:'transition',id,to:'ready'}),[200],'ready '+key);
   await must(call('/api/projects/workspace','POST',{action:'transition',id,to:'active'}),[200],'active '+key);
  }
 }
 log('projects',(await one('SELECT COUNT(*) n FROM jobs WHERE organisation_id=?',[org])).n,'users',(await one('SELECT COUNT(*) n FROM users WHERE organisation_id=?',[org])).n);
}

/** Closed project lifecycle runs after its commercial history exists (see closeProject in stages.mjs). */
export async function closeProject(c,key){
 const {call,must,one,org}=c;
 const id=c.ids['project:'+key];
 const p=await one('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',[org,id]);
 if(p.stage==='closed')return;
 if(p.stage==='active')await must(call('/api/projects/workspace','POST',{action:'transition',id,to:'practical_completion'}),[200],'practical completion');
 if(['active','practical_completion'].includes((await one('SELECT stage FROM jobs WHERE organisation_id=? AND id=?',[org,id])).stage))await must(call('/api/projects/workspace','POST',{action:'transition',id,to:'closeout'}),[200],'closeout');
 const items=await must(call(`/api/registers/closeout?parentId=${id}`),[200],'closeout items');
 for(const it of items.records)if(it.state!=='complete'&&it.status!=='complete')await call('/api/registers/closeout','PATCH',{id:it.id,transition:'complete'});
 await must(call('/api/projects/workspace','POST',{action:'transition',id,to:'closed'}),[200],'close');
}
