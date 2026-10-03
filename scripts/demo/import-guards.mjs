// Guards for the tenant-scoped demo import. The stages are the original seed's; these wrappers make sure they can only do what the
// import is allowed to do: add demonstration records through the application's own API, and nothing else.
import {createHash} from 'node:crypto';
import {identifier} from '../mysql-config.mjs';
import {DEMO_EMAIL_DOMAIN,DIVISIONS} from './import-plan.mjs';
import {SHIFTS} from './shifts.mjs';

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
// The stages use SQL for reading, plus exactly two clearly marked writes: the no-login demonstration team members, and marking
// today's demonstration shift "In Progress" (the pre-start checklist that normally gates that state is not part of the dataset).
export function guardedDb(db,org){
 return {
  end:()=>db.end(),
  query:async(sql,params=[])=>{
   const text=String(sql).trim();
   if(/^(SELECT|SHOW)\b/i.test(text))return db.query(sql,params);
   if(/^INSERT IGNORE INTO users \(id,organisation_id,email,name,role,created_at,active\) VALUES \(\?,\?,\?,\?,\?,\?,1\)$/.test(text)&&params[1]===org&&String(params[2]).endsWith(DEMO_EMAIL_DOMAIN))return db.query(sql,params);
   if(text==="UPDATE shifts SET status='In Progress' WHERE organisation_id=? AND name=?"&&params[0]===org&&SHIFT_IN_PROGRESS.has(params[1]))return db.query(sql,params);
   throw new Error('Refused by the import guard: this SQL write is not an allowed demonstration write.');
  },
 };
}

// ---- before/after proof that existing data was not touched ----
// Every row of every table (all tenants), as an id -> content-hash map, taken inside one read-only snapshot.
export async function snapshot(db){
 const out={};
 const [tables]=await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY 1");
 for(const {t} of tables){
  const [cols]=await db.query('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]);
  const hasId=cols.some(x=>x.c==='id');
  const [rows]=await db.query(`SELECT * FROM ${identifier(t)}`);
  const map={};
  rows.forEach((r,i)=>{map[hasId?String(r.id):'#'+createHash('sha256').update(JSON.stringify(r)).digest('hex')+':'+i]=createHash('sha256').update(JSON.stringify(r)).digest('hex');});
  out[t]=map;
 }
 return out;
}
// Sign-in itself creates and refreshes session and verification rows; those two tables are the only ones excluded from the comparison.
export const SESSION_TABLES=new Set(['auth_session','auth_verification']);
// Rows present before must be present and identical after. New rows are expected; changed or removed rows are reported.
export function compare(before,after){
 const changed=[],removed=[];
 before=Object.fromEntries(Object.entries(before).filter(([t])=>!SESSION_TABLES.has(t)));
 for(const [t,rows] of Object.entries(before))for(const [id,h] of Object.entries(rows)){
  if(id.startsWith('#')){continue;}
  if(!(id in (after[t]||{})))removed.push(`${t}:${id}`);else if(after[t][id]!==h)changed.push(`${t}:${id}`);
 }
 // keyless tables: compare as multisets of row hashes
 for(const [t,rows] of Object.entries(before)){
  const b=Object.keys(rows).filter(k=>k.startsWith('#')).map(k=>k.slice(1,65)),a=Object.keys(after[t]||{}).filter(k=>k.startsWith('#')).map(k=>k.slice(1,65));
  if(!b.length)continue;const pool=new Map();for(const h of a)pool.set(h,(pool.get(h)||0)+1);
  for(const h of b){if(pool.get(h))pool.set(h,pool.get(h)-1);else removed.push(`${t}:(keyless row)`);}
 }
 return {changed,removed};
}
