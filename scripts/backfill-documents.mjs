// Deterministic, idempotent adoption of existing `documents` rows into the managed-document model
// (migration 0022). Runs from scripts/migrate.mjs while the migration lock is held.
//  - non-destructive: no `documents` row, id, object or column is changed or removed;
//  - deterministic ids: managed id `md-<head file id>`, version id `dv-<file id>`; INSERT IGNORE on the
//    unique (organisation, file) key makes every rerun a no-op;
//  - only unambiguous shapes are adopted: a lone current row, or a strict linear supersedes_id chain
//    (single head, versions 1..n, every row but the last 'superseded', last 'current', one context);
//    anything else stays a legacy attachment and is recorded in data_migration_issues, never guessed;
//  - only register-style contexts are adopted. Evidence/attachment contexts (actions, incidents, NCRs,
//    SWMS, ITPs, variations, claims, field, requirements…) and controlled Forms evidence are never
//    converted: their raw ids keep working exactly as before;
//  - no document number, revision label or other metadata is invented (category maps to type only when
//    it is not the default 'General').
export const DOCUMENT_MIGRATION='0022_document_engine_foundation';
export const ADOPTABLE_CONTEXTS=['organisation','library','project','tender'];

/** Pure planner: rows of one organisation → {groups, ambiguous}. Exported for tests. */
export function planAdoption(rows){
 const byId=new Map(rows.map(r=>[r.id,r]));
 const successors=new Map();
 for(const r of rows)if(r.supersedes_id){if(!successors.has(r.supersedes_id))successors.set(r.supersedes_id,[]);successors.get(r.supersedes_id).push(r);}
 const sameContext=(a,b)=>a.context_type===b.context_type&&(a.context_id||null)===(b.context_id||null)&&(a.project_id||null)===(b.project_id||null);
 const groups=[],claimed=new Set(),ambiguous=[];
 const heads=rows.filter(r=>!r.supersedes_id).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
 for(const head of heads){
  const chain=[head];let cur=head,problem=null;
  while(true){
   const next=successors.get(cur.id)||[];
   if(!next.length)break;
   if(next.length>1){problem='branching supersedes_id chain';break;}
   const n=next[0];
   if(!sameContext(head,n)){problem='chain crosses contexts';break;}
   if(Number(n.version)!==Number(cur.version)+1){problem='version numbers are not consecutive';break;}
   chain.push(n);cur=n;
   if(chain.length>1000){problem='chain too long';break;}
  }
  const last=chain[chain.length-1];
  if(!problem){
   if(Number(head.version)!==1)problem='chain does not start at version 1';
   else if(chain.slice(0,-1).some(r=>r.status!=='superseded')||last.status!=='current')problem='chain status is not superseded…current';
  }
  if(problem){for(const r of chain){claimed.add(r.id);ambiguous.push({id:r.id,issue:problem});}continue;}
  chain.forEach(r=>claimed.add(r.id));
  groups.push(chain);
 }
 // Rows never reached from a head: dangling or cyclic supersedes_id → ambiguous, left alone.
 for(const r of rows)if(!claimed.has(r.id))ambiguous.push({id:r.id,issue:byId.has(r.supersedes_id)?'supersedes_id chain has no start':'supersedes_id points to a file that is not a candidate'});
 return {groups,ambiguous};
}

export async function backfillDocuments(db,log=console.log){
 const orgs=(await db.query("SELECT DISTINCT d.organisation_id FROM documents d WHERE d.context_type IN (?) AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.organisation_id=d.organisation_id AND v.file_document_id=d.id)",[ADOPTABLE_CONTEXTS]))[0].map(r=>r.organisation_id);
 const totals={};
 for(const org of orgs){
  const now=new Date().toISOString();
  await db.beginTransaction();
  try{
   const rows=(await db.query("SELECT * FROM documents d WHERE d.organisation_id=? AND d.context_type IN (?) AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.organisation_id=d.organisation_id AND v.file_document_id=d.id) ORDER BY d.created_at,d.id FOR UPDATE",[org,ADOPTABLE_CONTEXTS]))[0];
   const {groups,ambiguous}=planAdoption(rows);
   let managed=0,versions=0;
   for(const chain of groups){
    const head=chain[0],last=chain[chain.length-1],mid='md-'+head.id;
    const type=last.category&&last.category!=='General'?String(last.category).slice(0,80):null;
    const [res]=await db.query("INSERT IGNORE INTO managed_documents (id,organisation_id,title,description,document_number,document_type,discipline,tags,status,current_version_id,context_type,context_id,project_id,source,revision,created_by,created_at,updated_at) VALUES (?,?,?,NULL,NULL,?,NULL,'[]','active',?,?,?,?,'backfill',1,?,?,?)",
     [mid,org,String(last.title).slice(0,255),type,'dv-'+last.id,head.context_type,head.context_id||null,head.project_id||null,head.uploaded_by||null,head.created_at,last.created_at]);
    if(!res.affectedRows)continue;
    managed++;
    for(const [i,r] of chain.entries()){
     await db.query('INSERT IGNORE INTO document_versions (id,organisation_id,managed_document_id,version_number,revision_label,file_document_id,sha256,issue_date,author,company,change_note,created_by,created_at) VALUES (?,?,?,?,NULL,?,?,NULL,NULL,NULL,NULL,?,?)',['dv-'+r.id,org,mid,i+1,r.id,r.sha256,r.uploaded_by||null,r.created_at]);
     versions++;
    }
   }
   for(const a of ambiguous)await db.query("INSERT INTO data_migration_issues (id,organisation_id,migration,entity_type,entity_id,field,issue,legacy_value,status,created_at) VALUES (?,?,?,?,?,?,?,?,'open',?) ON DUPLICATE KEY UPDATE issue=VALUES(issue)",[crypto.randomUUID(),org,DOCUMENT_MIGRATION,'document',a.id,'supersedes_id',('Left as a legacy attachment: '+a.issue).slice(0,500),null,now]);
   if(managed)await db.query("INSERT INTO app_backfills (id,organisation_id,name,status,counts,started_at,completed_at) VALUES (?,?,?,'complete',?,?,?)",[crypto.randomUUID(),org,DOCUMENT_MIGRATION,JSON.stringify({managed,versions,ambiguous:ambiguous.length}),now,new Date().toISOString()]);
   await db.commit();
   totals[org]={managed,versions,ambiguous:ambiguous.length};log(`Document backfill ${org}: ${JSON.stringify(totals[org])}`);
  }catch(error){await db.rollback().catch(()=>{});throw error;}
 }
 if(!orgs.length)log('Document backfill: nothing to adopt');
 return totals;
}
