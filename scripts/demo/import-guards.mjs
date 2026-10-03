// Guards for the tenant-scoped demo import. The stages are the original seed's; these wrappers make sure they can only do what the
// import is allowed to do: add demonstration records through the application's own API, and nothing else.
import {createHmac,createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {identifier} from '../mysql-config.mjs';
import {DEMO_EMAIL_DOMAIN,DIVISIONS} from './import-plan.mjs';
import {SHIFTS} from './shifts.mjs';
import {USERS} from './projects.mjs';

// Every mutating API call the stages make. Anything else (company profile, team, billing, admin, auth, communications…) is refused.
const MUTATIONS=[
 ['POST','/api/platform/clients'],['POST','/api/tenders/workspace'],['PATCH','/api/tenders/workspace'],['POST','/api/tenders/register'],
 ['POST','/api/estimates/approval'],['PUT','/api/estimates'],['POST','/api/registers/opportunities'],['PATCH','/api/registers/opportunities'],
 ['POST','/api/projects/workspace'],['PATCH','/api/projects/workspace'],['POST','/api/projects/team'],['POST','/api/projects/program'],['PATCH','/api/projects/program'],
 ['POST','/api/hseq/swms'],['POST','/api/ims'],['PATCH','/api/ims'],['POST','/api/registers/itp_items'],['POST','/api/registers/risks'],['PATCH','/api/registers/risks'],
 ['POST','/api/registers/itps'],['PATCH','/api/registers/itps'],['POST','/api/registers/closeout'],['PATCH','/api/registers/closeout'],['POST','/api/registers/readiness'],['PATCH','/api/registers/readiness'],
 ['POST','/api/registers/incidents'],['PATCH','/api/registers/incidents'],['POST','/api/registers/ncrs'],['PATCH','/api/registers/ncrs'],['POST','/api/registers/actions'],['PATCH','/api/registers/actions'],
 ['POST','/api/operations/resources'],['POST','/api/os/records'],['POST','/api/delivery'],['POST','/api/workshop'],['PUT','/api/dockets'],['POST','/api/dockets'],
 ['POST','/api/commercial/claims'],['POST','/api/planning'],
];
const OS_MODULES=new Set(['crews','suppliers','subcontractors']);
const DIVISION_CODES=new Set(DIVISIONS.map(d=>d[0]));

export function guardedCall(call){
 return async(path,method='GET',body)=>{
  if(method!=='GET'){
   const base=path.split('?')[0];
   const ok=(method==='POST'&&base==='/api/business-units'&&DIVISION_CODES.has(body?.code))
    ||(base==='/api/os/records'&&OS_MODULES.has(body?.module)&&String(body?.name||'').startsWith('DEMO '))
    ||(base!=='/api/os/records'&&MUTATIONS.some(([m,p])=>m===method&&p===base));
   if(!ok)throw new Error(`Refused by the import guard: ${method} ${base} is not an allowed demonstration write.`);
  }
  return call(path,method,body);
 };
}

const SHIFT_IN_PROGRESS=new Set(SHIFTS.filter(s=>s[5]==='In Progress').map(s=>s[0]));
// The five demonstration team members are the ONLY users row this import may write. They exist because the dataset's records (project
// manager, opportunity and action owners) need user ids, and the application can only create users by e-mailed invitation, which is
// not allowed here. Each is a row in `users` with a fixed address, name and non-admin role from the dataset; it has no login (no
// auth_user / auth_account row is written, no password is set) and is never an administrator. An existing row is never modified:
// the guard looks the address and the id up first and writes only when both are absent.
export const DEMO_TEAM=new Map(USERS.map(([key,name,role,local])=>[local+DEMO_EMAIL_DOMAIN,{key,name,role}]));
if([...DEMO_TEAM.values()].some(u=>/^(admin|owner)$/i.test(u.role)))throw new Error('Demonstration team members must not be administrators.');
const USER_INSERT=/^INSERT IGNORE INTO users \(id,organisation_id,email,name,role,created_at,active\) VALUES \(\?,\?,\?,\?,\?,\?,1\)$/;
// The stages use SQL for reading, plus exactly two clearly marked writes: the no-login demonstration team members, and marking
// today's demonstration shift "In Progress" (the pre-start checklist that normally gates that state is not part of the dataset).
export function guardedDb(db,org){
 return {
  end:()=>db.end(),
  query:async(sql,params=[])=>{
   const text=String(sql).trim();
   if(/^(SELECT|SHOW)\b/i.test(text))return db.query(sql,params);
   if(USER_INSERT.test(text)){
    const [id,orgId,email,name,role]=params,who=DEMO_TEAM.get(email);
    if(orgId!==org||!who||name!==who.name||role!==who.role||!String(id).includes('-user-'+who.key))throw new Error('Refused by the import guard: this users write is not one of the demonstration team members.');
    const [byEmail]=await db.query('SELECT id,organisation_id FROM users WHERE email=?',[email]);
    const [byId]=await db.query('SELECT email FROM users WHERE id=?',[id]);
    if(byEmail.length||byId.length){
     if(byEmail.length===1&&byEmail[0].id===id&&byEmail[0].organisation_id===org)return [{affectedRows:0}]; // already ours: nothing is written
     throw new Error('Refused by the import guard: a users row with this address or id already exists and is not this demonstration member. Nothing was changed.');
    }
    return db.query(sql,params);
   }
   if(text==="UPDATE shifts SET status='In Progress' WHERE organisation_id=? AND name=?"&&params[0]===org&&SHIFT_IN_PROGRESS.has(params[1]))return db.query(sql,params);
   throw new Error('Refused by the import guard: this SQL write is not an allowed demonstration write.');
  },
 };
}

// ---- before/after proof that existing data was not touched ----
// The baseline stores NO raw records. Every row of every table (all tenants) is reduced to a salted HMAC-SHA-256 of its id and of its
// full content; the file holds only table names, row counts, a random salt and those digests. Session and verification tables
// (tokens) are never read at all. Digests are fingerprints, not secrets: the salt is in the file, so the file is written 0600 and is
// still not safe to publish, but it contains no password, hash, token, session content, name, address, rate or other record text.
export const SESSION_TABLES=new Set(['auth_session','auth_verification']);
const mac=(salt,value)=>createHmac('sha256',salt).update(value).digest('hex');

export async function snapshot(db,salt=randomBytes(32).toString('hex')){
 const [tables]=await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY 1");
 const out={format:1,salt,schema:'',tables:{},keyless:{}},shape=[];
 for(const {t} of tables){
  const [cols]=await db.query('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[t]);
  shape.push(t+'('+cols.map(x=>x.c).join(',')+')');
  if(SESSION_TABLES.has(t))continue;
  const hasId=cols.some(x=>x.c==='id');
  const [rows]=await db.query(`SELECT * FROM ${identifier(t)}`);
  const map={},keyless=[];
  for(const r of rows){const h=mac(salt,'row:'+JSON.stringify(r));if(hasId)map[mac(salt,'id:'+String(r.id))]=h;else keyless.push(h);}
  out.tables[t]={n:rows.length,rows:map};if(keyless.length)out.keyless[t]=keyless.sort();
 }
 out.schema=mac(salt,'schema:'+shape.join(';'));
 return out;
}
// Rows present before must be present and identical after. New rows are expected. Changed or removed rows are reported by table and
// count only (the baseline holds no raw ids to name them with).
export function compare(before,after){
 const changed=[],removed=[];let changedRows=0,removedRows=0;
 for(const [t,b] of Object.entries(before.tables)){
  const a=after.tables[t]?.rows||{};
  let c=0,r=0;for(const [id,h] of Object.entries(b.rows)){if(!(id in a))r++;else if(a[id]!==h)c++;}
  if(c)changed.push(`${t}: ${c} row(s)`);if(r)removed.push(`${t}: ${r} row(s)`);changedRows+=c;removedRows+=r;
  const kb=before.keyless[t]||[],pool=new Map();for(const h of after.keyless[t]||[])pool.set(h,(pool.get(h)||0)+1);
  let kr=0;for(const h of kb){if(pool.get(h))pool.set(h,pool.get(h)-1);else kr++;}
  if(kr){removed.push(`${t}: ${kr} keyless row(s)`);removedRows+=kr;}
 }
 return {changed,removed,changedRows,removedRows};
}
export const rowsGained=(before,after)=>Object.fromEntries(Object.entries(after.tables).map(([t,a])=>[t,Object.keys(a.rows).filter(k=>!(k in (before.tables[t]?.rows||{}))).length+Math.max(0,(after.keyless[t]||[]).length-(before.keyless[t]||[]).length)]).filter(([,n])=>n>0));

// ---- baseline file: written before the first change, checked on every resume ----
export function writeBaseline(file,organisationId,snap){
 const body=JSON.stringify({tool:'import-demo-tenant',organisationId,takenAt:new Date().toISOString(),...snap});
 writeFileSync(file,body,{mode:0o600,flag:'wx'});
 return createHash('sha256').update(body).digest('hex'); // the operator keeps this value; resume requires it
}
/** Integrity checks on resume: permissions, operator-held SHA-256, structure, organisation, schema and internal consistency. */
export function loadBaseline(file,expectedSha,organisationId,currentSchemaShape){
 const fail=m=>{throw new Error('Refusing to use the baseline: '+m+' Nothing was changed.');};
 if(statSync(file).mode&0o077)fail('the file is readable by other users (must be mode 0600).');
 if(!/^[0-9a-f]{64}$/.test(expectedSha||''))fail('--baseline-sha256 (printed when the baseline was created) is required.');
 const raw=readFileSync(file,'utf8');
 if(createHash('sha256').update(raw).digest('hex')!==expectedSha)fail('its SHA-256 does not match --baseline-sha256, so it has been altered or replaced.');
 let b;try{b=JSON.parse(raw);}catch{fail('it is not valid JSON.');}
 if(b.tool!=='import-demo-tenant'||b.format!==1||typeof b.salt!=='string'||typeof b.tables!=='object')fail('unrecognised format.');
 if(b.organisationId!==organisationId)fail('it belongs to a different organisation.');
 if(!(Date.parse(b.takenAt)<=Date.now()))fail('its timestamp is invalid.');
 if(b.schema!==mac(b.salt,'schema:'+currentSchemaShape))fail('the database schema differs from the one the baseline was taken against (a different database, or a migration ran in between).');
 for(const [t,v] of Object.entries(b.tables))if(Object.keys(v.rows).length+(b.keyless[t]?.length||0)!==v.n)fail(`table ${t} is internally inconsistent (truncated or edited).`);
 return b;
}
export async function schemaShape(db){
 const [tables]=await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY 1");const shape=[];
 for(const {t} of tables){const [cols]=await db.query('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[t]);shape.push(t+'('+cols.map(x=>x.c).join(',')+')');}
 return shape.join(';');
}
