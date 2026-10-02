// Safety and quality records: incidents, non-conformances and corrective actions (including overdue ones). Fictional events.
export async function hseqStage(c){
 const {call,must,one,org,d,log}=c;
 const projectId=c.ids['project:B1'];
 const create=(key,values)=>must(call(`/api/registers/${key}`,'POST',{parentId:projectId,values}),[200,201],key);
 const move=(key,id,transition)=>must(call(`/api/registers/${key}`,'PATCH',{id,transition}),[200],`${key} ${transition}`);
 const near='Utility vehicle entered the live work zone near chainage 1,200 (near miss).';
 let inc=await one('SELECT id,status FROM hseq_incidents WHERE organisation_id=? AND description=?',[org,near]);
 if(!inc){
  await create('incidents',{incident_type:'near miss',severity:'moderate',occurred_at:`${d(-9)}T09:30`,description:near,immediate_action:'Spotter stopped the vehicle; work paused and exclusion zone re-established.',location_description:'Quarry Road, chainage 1,200',persons_involved:'Spotter (Jess Carter); unknown driver'});
  inc=await one('SELECT id,status FROM hseq_incidents WHERE organisation_id=? AND description=?',[org,near]);c.note('incidents');
 }
 if(inc.status==='reported')await move('incidents',inc.id,'investigating');
 const minor='Minor hand injury while handling a shovel: first aid applied, no lost time.';
 if(!await one('SELECT id FROM hseq_incidents WHERE organisation_id=? AND description=?',[org,minor])){
  await create('incidents',{incident_type:'injury',severity:'minor',occurred_at:`${d(-16)}T14:10`,description:minor,immediate_action:'First aid on site; returned to duty.',location_description:'Paving crew, Quarry Road',persons_involved:'Labourer'});c.note('incidents');
 }
 const ncrIssue='Compaction density below specification on chainage 800–900 (TEST: overdue non-conformance).';
 let ncr=await one('SELECT id,status FROM hseq_ncrs WHERE organisation_id=? AND issue=?',[org,ncrIssue]);
 if(!ncr){
  await create('ncrs',{issue:ncrIssue,requirement:'Specification: relative compaction within the specified range',cause:'Roller pattern shortened to recover time after a delivery delay',corrective_action:'Re-roll and re-test; add a hold point before opening to traffic.',owner_name:'Dan Hollis',due_date:d(-6)});
  ncr=await one('SELECT id,status FROM hseq_ncrs WHERE organisation_id=? AND issue=?',[org,ncrIssue]);c.note('ncrs');
 }
 const act=async(text,fields,target)=>{
  let a=await one('SELECT id,status FROM hseq_actions WHERE organisation_id=? AND action=?',[org,text]);
  if(!a){await create('actions',{action:text,...fields});a=await one('SELECT id,status FROM hseq_actions WHERE organisation_id=? AND action=?',[org,text]);c.note('actions');}
  if(target==='in_progress'&&a.status==='open')await move('actions',a.id,'in_progress');
 };
 await act('Re-brief all crews on exclusion zones and spotter authority (TEST: overdue action).',{source_type:'incident',source_id:inc.id,owner_user_id:c.ids['user:site'],due_date:d(-10)},'in_progress');
 await act('Add a compaction hold point to the Quarry Road ITP and brief the foreman.',{source_type:'ncr',source_id:ncr.id,owner_user_id:c.ids['user:pm'],due_date:d(7)},'in_progress');
 await act('Order replacement hi-vis vests for the traffic control crew.',{source_type:'other',owner_user_id:c.ids['user:pm'],due_date:d(14)},'open');
 log('incidents',(await one('SELECT COUNT(*) n FROM hseq_incidents WHERE organisation_id=?',[org])).n,'ncrs',(await one('SELECT COUNT(*) n FROM hseq_ncrs WHERE organisation_id=?',[org])).n,'actions',(await one('SELECT COUNT(*) n FROM hseq_actions WHERE organisation_id=?',[org])).n);
}
