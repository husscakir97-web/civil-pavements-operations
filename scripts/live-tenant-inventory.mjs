// READ-ONLY inventory of one organisation, for preparing a precise replacement plan. It changes nothing.
//
//   node scripts/live-tenant-inventory.mjs --organisation-id <id> [--out inventory.json]
//
// Environment: MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD (and MYSQL_SSL_CA if needed) of the database to inspect.
// A read-only database user is strongly preferred: SELECT on the application schema plus SELECT on information_schema is enough.
//
// What it guarantees (and how it is enforced):
//  - It only reads. Every statement passes assertReadOnlySql() (SELECT / SHOW / session read-only controls only), the session is set
//    to READ ONLY inside one consistent-snapshot transaction, and the run aborts if the server does not confirm read-only.
//  - It needs an explicit organisation id and refuses when that organisation does not exist.
//  - It never prints credentials, the database host, or the contents of any record: only counts, table and column names, ids that
//    the operator supplied, and one-way fingerprints. Fingerprints are an order-independent sum of per-row SHA-256 values.
//
// What it does NOT do:
//  - It is evidence, not approval. A named approver, a --confirm flag, or matching counts do not appear here and must not be treated
//    as proof of approval, of a valid backup, or of a valid restore. Nothing here proves a backup can be restored.
//  - Counts do not prove records are unchanged. Fingerprints do detect any change to any column (including timestamps), but only
//    compare them when no one is writing (a maintenance window); they legitimately change while the app is in use. Session and
//    login tables are marked volatile.
//  - The database declares almost no foreign keys, so deletion dependencies are INFERRED from `<name>_id` columns and verified against
//    the data (how many child rows really point at an existing parent in this organisation). Ids stored inside JSON `metadata`
//    blobs, free-text references and R2 objects are not analysed and must be reviewed by a person before any deletion list is approved.
import {createHash} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {connect,identifier} from './mysql-config.mjs';

export const TOOL_VERSION=1;
const ALLOWED=/^\s*(SELECT\b|SHOW\b|START TRANSACTION (READ ONLY|WITH CONSISTENT SNAPSHOT,? READ ONLY)\b|SET SESSION TRANSACTION READ ONLY\b|ROLLBACK\b)/i;
// Only reads may be issued by this tool. Anything else (INSERT, UPDATE, DELETE, DDL, CALL, LOCK, multi-statement) is refused.
export function assertReadOnlySql(sql){
 const text=String(sql);
 if(!ALLOWED.test(text)||/;\s*\S/.test(text))throw new Error('Refused: this tool only issues read statements.');
 if(/\b(INTO\s+(OUTFILE|DUMPFILE)|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|GET_LOCK|SLEEP)\b/i.test(text))throw new Error('Refused: statement is not a plain read.');
}

const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const VOLATILE=/^auth_|^sessions?$|^verifications?$|^rate_limit/i;

export async function inventory(db,organisationId){
 const query=async(sql,params=[])=>{assertReadOnlySql(sql);return (await db.query(sql,params))[0];};
 await query('SET SESSION TRANSACTION READ ONLY');
 await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 // MySQL calls the variable transaction_read_only, MariaDB tx_read_only.
 const flags=await query("SHOW SESSION VARIABLES WHERE Variable_name IN ('transaction_read_only','tx_read_only')");
 if(!flags.length||!flags.every(f=>['ON','1'].includes(String(f.Value).toUpperCase())))throw new Error('Aborted: the server did not confirm a read-only session.');
 try{
  const [{version,schema}]=await query('SELECT VERSION() AS version, DATABASE() AS `schema`');
  if(Number((await query('SELECT COUNT(*) AS n FROM organisations WHERE id=?',[organisationId]))[0].n)!==1)throw Object.assign(new Error('Organisation not found in this database.'),{code:'NO_ORG'});

  const columns=await query('SELECT TABLE_NAME t,COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  const views=new Set((await query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='VIEW'")).map(r=>r.t));
  const cols=new Map();for(const r of columns){if(views.has(r.t))continue;if(!cols.has(r.t))cols.set(r.t,[]);cols.get(r.t).push(r.c);}
  const tables=[...cols.keys()].sort();
  const scoped=t=>cols.get(t).includes('organisation_id');

  // ---- counts and fingerprints, own organisation vs everyone else (streamed; no row content leaves this function) ----
  const sum48=row=>BigInt('0x'+createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,12));
  const perTable={};
  for(const t of tables){
   const own={rows:0,sum:0n},others={rows:0,sum:0n};
   for await(const row of db.connection.query('SELECT * FROM '+identifier(t)).stream()){
    const side=scoped(t)&&row.organisation_id===organisationId?own:others;
    side.rows++;side.sum=(side.sum+sum48(row))&0xFFFFFFFFFFFFFFFFn;
   }
   const hex=f=>f.rows?f.sum.toString(16).padStart(16,'0'):null;
   perTable[t]={scoped:scoped(t),volatile:VOLATILE.test(t),ownRows:own.rows,otherRows:others.rows,ownFingerprint:hex(own),otherFingerprint:hex(others)};
  }

  // ---- organisation facts (counts and statuses only: no names, emails or other personal content) ----
  const has=t=>cols.has(t);
  const organisation={id:organisationId};
  if(has('users'))organisation.usersByRole=Object.fromEntries((await query('SELECT role,COUNT(*) n FROM users WHERE organisation_id=? GROUP BY role',[organisationId])).map(r=>[r.role??'(none)',Number(r.n)]));
  if(has('memberships')&&cols.get('memberships').includes('active'))organisation.membershipsByActive=Object.fromEntries((await query('SELECT active,COUNT(*) n FROM memberships WHERE organisation_id=? GROUP BY active',[organisationId])).map(r=>[String(r.active),Number(r.n)]));
  if(has('organisation_entitlements'))organisation.entitlements=Object.fromEntries((await query('SELECT module,status FROM organisation_entitlements WHERE organisation_id=? ORDER BY module',[organisationId])).map(r=>[r.module,r.status]));
  organisation.billingRows=0;for(const t of ['billing_subscriptions','billing_customers'])if(has(t))organisation.billingRows+=Number((await query(`SELECT COUNT(*) n FROM ${identifier(t)} WHERE organisation_id=?`,[organisationId]))[0].n);
  const otherOrgs=has('organisations')?Number((await query('SELECT COUNT(*) n FROM organisations WHERE id<>?',[organisationId]))[0].n):null;

  // ---- relationships: what the database declares, and what the data shows ----
  const declared=(await query('SELECT TABLE_NAME child,COLUMN_NAME col,REFERENCED_TABLE_NAME parent,REFERENCED_COLUMN_NAME pcol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY 1,2')).map(r=>({child:r.child,column:r.col,parent:r.parent,parentColumn:r.pcol}));
  const names=new Set(tables);
  const candidates=(table,col)=>{
   if(col==='organisation_id'||!col.endsWith('_id')||col==='id')return [];
   const stem=col.slice(0,-3);const plural=stem.endsWith('y')?stem.slice(0,-1)+'ies':stem+'s';
   // Exact names first, then module-prefixed tables (plan_id -> planning_plans). Candidates only become relationships if the data matches.
   const out=[stem,plural,stem+'es'].filter(n=>names.has(n)&&cols.get(n).includes('id'));
   for(const n of tables)if(!out.includes(n)&&(n.endsWith('_'+plural)||n.endsWith('_'+stem+'es'))&&cols.get(n).includes('id'))out.push(n);
   if(['created_by','updated_by','approved_by','owner_user_id','user_id'].includes(col)||/_user_id$/.test(col)||/_by$/.test(col))out.push('users');
   if(/^(parent|merged_into|supersedes|source)_/.test(col)&&!out.includes(table))out.push(table);
   return [...new Set(out)].filter(n=>names.has(n)&&cols.get(n).includes('id'));
  };
  const edges=[];
  for(const child of tables){
   if(!scoped(child))continue;
   for(const col of cols.get(child)){
    for(const parent of candidates(child,col)){
     const pScoped=scoped(parent);
     const q=`SELECT COUNT(c.${identifier(col)}) AS refs, SUM(p.id IS NOT NULL) AS matched FROM ${identifier(child)} c LEFT JOIN ${identifier(parent)} p ON p.id=c.${identifier(col)}${pScoped?' AND p.organisation_id=c.organisation_id':''} WHERE c.organisation_id=? AND c.${identifier(col)} IS NOT NULL AND c.${identifier(col)}<>''`;
     const [r]=await query(q,[organisationId]);
     const refs=Number(r.refs),matched=Number(r.matched||0);
     // Cross-tenant: rows in OTHER organisations whose reference points at one of THIS organisation's parent rows (must be 0)
     let crossTenant=0;
     if(pScoped)crossTenant=Number((await query(`SELECT COUNT(*) n FROM ${identifier(child)} c JOIN ${identifier(parent)} p ON p.id=c.${identifier(col)} WHERE p.organisation_id=? AND c.organisation_id<>p.organisation_id`,[organisationId]))[0].n);
     if(refs===0&&crossTenant===0){edges.push({child,column:col,parent,basis:'name-only',referencingRows:0,matchedRows:0,orphanRows:0,crossTenantRows:0});continue;}
     if(matched===0&&crossTenant===0)continue; // a same-named column that never matches this table is not a relationship
     edges.push({child,column:col,parent,basis:matched===refs?'inferred, fully matched':'inferred, partly matched',referencingRows:refs,matchedRows:matched,orphanRows:refs-matched,crossTenantRows:crossTenant});
    }
   }
  }
  const live=edges.filter(e=>e.matchedRows>0||e.crossTenantRows>0);
  const dependencies={};
  for(const e of live){(dependencies[e.parent]??=[]).push({referencedBy:e.child,column:e.column,rows:e.matchedRows,declaredForeignKey:declared.some(d=>d.child===e.child&&d.column===e.column&&d.parent===e.parent)});}
  for(const k of Object.keys(dependencies))dependencies[k].sort((a,b)=>b.rows-a.rows||a.referencedBy.localeCompare(b.referencedBy));
  // child-first deletion order over tables that hold this organisation's rows (cycles are reported, never guessed)
  const populated=tables.filter(t=>perTable[t].ownRows>0&&t!=='organisations');
  const deps=new Map(populated.map(t=>[t,new Set(live.filter(e=>e.parent===t&&e.child!==t&&populated.includes(e.child)).map(e=>e.child))]));
  const order=[],done=new Set();let progress=true;
  while(progress){progress=false;for(const [t,kids] of deps){if(done.has(t))continue;if([...kids].every(k=>done.has(k))){order.push(t);done.add(t);progress=true;}}}
  const inCycle=populated.filter(t=>!done.has(t));

  const report={
   tool:{name:'live-tenant-inventory',version:TOOL_VERSION,readOnly:true},
   database:{schema,serverVersion:version,tables:tables.length},
   organisation,
   otherOrganisations:otherOrgs,
   summary:{
    ownRowsTotal:populated.reduce((a,t)=>a+perTable[t].ownRows,0),
    tablesWithOwnRows:populated.length,
    tablesWithOtherTenantRows:tables.filter(t=>perTable[t].scoped&&perTable[t].otherRows>0).length,
    declaredForeignKeys:declared.length,
    inferredRelationshipsWithData:live.length,
    crossTenantReferences:live.reduce((a,e)=>a+e.crossTenantRows,0),
    orphanReferences:live.reduce((a,e)=>a+e.orphanRows,0),
    deletionOrderCycles:inCycle,
   },
   tables:perTable,
   declaredForeignKeys:declared,
   relationships:edges.filter(e=>e.basis!=='name-only'),
   deletionDependencies:dependencies,
   childFirstOrder:order,
   notAnalysed:['ids inside JSON metadata columns','free-text references','R2 objects and documents on disk','anything outside this database'],
   notEvidenceOf:['approval','a valid backup','a successful restore','that other tenants are unchanged unless fingerprints are compared across a quiet period'],
  };
  await db.query('ROLLBACK');
  return report;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
}

export function seal(report){
 const body=JSON.stringify(report);
 return {...report,inventoryHash:createHash('sha256').update(body).digest('hex'),generatedAt:new Date().toISOString()};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const organisationId=arg('--organisation-id'),out=arg('--out');
 if(!organisationId||organisationId.startsWith('--')){console.error('Usage: node scripts/live-tenant-inventory.mjs --organisation-id <id> [--out file.json]');process.exit(2);}
 if(out&&existsSync(out)){console.error('Refusing to overwrite an existing file: '+out);process.exit(2);}
 let db;
 try{db=await connect();}catch{console.error('Could not connect to the database (check MYSQL_* settings; details withheld).');process.exit(2);}
 try{
  const sealed=seal(await inventory(db,organisationId));
  const text=JSON.stringify(sealed,null,1);
  if(out)writeFileSync(out,text,{mode:0o600});else console.log(text);
  if(out)console.log(`Inventory written to ${out} (${sealed.summary.ownRowsTotal} rows in ${sealed.summary.tablesWithOwnRows} tables; hash ${sealed.inventoryHash.slice(0,16)}…)`);
 }catch(e){console.error(e.code==='NO_ORG'?e.message:'Inventory failed: '+String(e.message).replace(/\s+/g,' ').slice(0,200));process.exitCode=1;}
 finally{await db.end();}
}
