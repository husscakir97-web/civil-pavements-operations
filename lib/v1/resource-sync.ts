// Turns a mapped legacy resource row into portable SQL statements (MySQL and the
// SQLite test double). Used by the one-off backfill and by the dual-write in the
// legacy routes (/api/delivery, /api/os/records), so legacy screens keep working
// while typed columns, competencies and assignments stay current.
// Statement lists are applied inside one transaction by the caller.
import {mapWorker,mapPlant,mapShift,RESOURCE_MIGRATION,type LegacyRow,type MappingIssue,type CompetencyRow} from './resource-mapping';

export type Stmt={sql:string;params:unknown[]};
type Existing={id:string;competency_type:string;source:string;status:string;expiry_date:string|null};
const set=(columns:Record<string,unknown>)=>Object.keys(columns).map(c=>`${c}=?`).join(',');

// Marks earlier open issues for this record resolved once the mapping no longer reports them.
function resolveIssues(org:string,entityType:string,id:string,issues:MappingIssue[],now:string):Stmt{
 const fields=[...new Set(issues.map(i=>i.field))];
 return {sql:`UPDATE data_migration_issues SET status='resolved',resolved_by='system',resolved_at=? WHERE organisation_id=? AND migration=? AND entity_type=? AND entity_id=? AND status='open'${fields.length?` AND field NOT IN (${fields.map(()=>'?').join(',')})`:''}`,params:[now,org,RESOURCE_MIGRATION,entityType,id,...fields]};
}

/** Competency rows that came from the legacy text are refreshed; manually recorded ones are never touched. */
export function competencyStatements(org:string,workerId:string,wanted:CompetencyRow[],existing:Existing[],now:string,newId:()=>string):Stmt[]{
 const out:Stmt[]=[];
 const byType=new Map(existing.map(e=>[e.competency_type.toLowerCase(),e]));
 for(const c of wanted){
  const e=byType.get(c.competencyType.toLowerCase());
  if(!e)out.push({sql:"INSERT INTO worker_competencies (id,organisation_id,worker_id,competency_type,expiry_date,status,source,revision,created_at,updated_at) VALUES (?,?,?,?,?,'current','legacy',1,?,?)",params:[newId(),org,workerId,c.competencyType,c.expiryDate,now,now]});
  else if(e.source==='legacy'&&(e.expiry_date!==c.expiryDate||e.status!=='current'))out.push({sql:"UPDATE worker_competencies SET expiry_date=?,status='current',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",params:[c.expiryDate,now,org,e.id]});
 }
 const keep=new Set(wanted.map(c=>c.competencyType.toLowerCase()));
 for(const e of existing)if(e.source==='legacy'&&e.status==='current'&&!keep.has(e.competency_type.toLowerCase()))
  out.push({sql:"UPDATE worker_competencies SET status='removed',revision=revision+1,updated_at=? WHERE organisation_id=? AND id=?",params:[now,org,e.id]});
 return out;
}

export function workerStatements(org:string,row:LegacyRow,existingCompetencies:Existing[],now:string,newId:()=>string){
 const m=mapWorker(row);
 const statements:Stmt[]=[
  {sql:`UPDATE workers SET ${set(m.columns)},legacy_synced_at=?,updated_at=? WHERE organisation_id=? AND id=?`,params:[...Object.values(m.columns),now,now,org,row.id]},
  ...competencyStatements(org,row.id,m.competencies,existingCompetencies,now,newId),
  resolveIssues(org,'worker',row.id,m.issues,now),
 ];
 return {statements,issues:m.issues,competencies:m.competencies};
}

export function plantStatements(org:string,row:LegacyRow,now:string){
 const m=mapPlant(row);
 return {statements:[
  {sql:`UPDATE plant SET ${set(m.columns)},legacy_synced_at=?,updated_at=? WHERE organisation_id=? AND id=?`,params:[...Object.values(m.columns),now,now,org,row.id]},
  resolveIssues(org,'plant',row.id,m.issues,now),
 ],issues:m.issues};
}

/** Planner-sourced assignments are a projection of the legacy shift; they are replaced on every save. */
export function shiftStatements(org:string,row:LegacyRow,known:{jobIds:Set<string>;resources:Map<string,string>},now:string,newId:()=>string,userId:string|null){
 const m=mapShift(row,known);
 const statements:Stmt[]=[
  {sql:`UPDATE shifts SET ${set(m.columns)},legacy_synced_at=?,updated_at=? WHERE organisation_id=? AND id=?`,params:[...Object.values(m.columns),now,now,org,row.id]},
  {sql:"DELETE FROM shift_assignments WHERE organisation_id=? AND shift_id=? AND source='planner'",params:[org,row.id]},
  ...m.assignments.map(a=>({sql:"INSERT INTO shift_assignments (id,organisation_id,shift_id,resource_type,resource_id,role,source,created_by,created_at) VALUES (?,?,?,?,?,?,'planner',?,?)",params:[newId(),org,row.id,a.resourceType,a.resourceId,a.role,userId,now]})),
  resolveIssues(org,'shift',row.id,m.issues,now),
 ];
 return {statements,issues:m.issues,assignments:m.assignments,columns:m.columns};
}
