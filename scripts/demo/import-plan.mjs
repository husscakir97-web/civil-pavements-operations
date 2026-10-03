// Read-only plan for the tenant-scoped demo import: what would be created, what already exists and is provably ours (skip), and
// what collides with a record that is NOT ours (conflict: the import refuses instead of guessing).
//
// Ownership rule. A record is "ours" only when (a) it carries the demonstration marker in its natural key (DEMO-… numbers and
// references, "DEMO " names, the demo e-mail domain) AND its descriptive attributes match what the importer would create, or (b)
// for the few records keyed by a plain name (divisions, shifts, opportunities, plans, safety records) it is attached to a demo
// parent (a demo client, tender or project) or, for divisions, matches the exact name and description. Anything else with the
// same key is a conflict. This is a fingerprint, not proof: an owner record that deliberately mimics a demo record exactly would be
// treated as ours and skipped (never overwritten).
import {createHash} from 'node:crypto';
import {WORKERS,PLANT,CREWS,SUPPLIERS,SUBS} from './resources.mjs';
import {CLIENTS} from './crm.mjs';
import {BIDS,LEADS} from './pipeline.mjs';
import {SHIFTS} from './shifts.mjs';
import {USERS} from './projects.mjs';
import {DOCKETS} from './commercial.mjs';
import {loadFootprint,presentByTable,BOOTSTRAP,BOOKKEEPING} from './import-footprint.mjs';

export const DEMO_EMAIL_DOMAIN='@kestrel-demo.example.invalid';
export const DIVISIONS=[['TC','Traffic Control','Traffic management plans, traffic controllers, VMS and arrow boards.'],['APM','Asphalt & Pavement Maintenance','Resurfacing, patching and pavement repairs.'],['PRF','Profiling','Cold planing and profiling for resurfacing programmes.']];
export const PLAN_NAME='Quarry Road resurfacing — methodology options (DEMO)';
export const HSEQ_TEXT={
 near:'Utility vehicle entered the live work zone near chainage 1,200 (near miss).',
 minor:'Minor hand injury while handling a shovel: first aid applied, no lost time.',
 ncr:'Compaction density below specification on chainage 800–900 (TEST: overdue non-conformance).',
 actions:['Re-brief all crews on exclusion zones and spotter authority (TEST: overdue action).','Add a compaction hold point to the Quarry Road ITP and brief the foreman.'],
};
// Modules the dataset needs. A module the organisation does not hold would 404 part-way through, so it blocks the plan instead.
export const REQUIRED_MODULES=['pipeline','estimating','projects','ims','operations','field','dockets','commercial','workshop'];

export async function buildPlan(q,org,seedDate){
 const groups=[];
 const add=(group,key,state,reason)=>{let g=groups.find(x=>x.group===group);if(!g){g={group,create:0,skip:0,conflict:0,items:[]};groups.push(g);}g[state]++;g.items.push(reason?{key,state,reason}:{key,state});};
 const one=async(sql,p=[])=>(await q(sql,p))[0]??null;
 const ids=async(sql,p)=>new Set((await q(sql,p)).map(r=>r.id));
 const blockers=[];

 // ---- organisation-level preconditions ----
 const organisation=await one('SELECT id FROM organisations WHERE id=?',[org]);
 if(!organisation)throw Object.assign(new Error('Organisation not found in this database.'),{code:'NO_ORG'});
 const billing=Number((await one('SELECT (SELECT COUNT(*) FROM billing_subscriptions WHERE organisation_id=?)+(SELECT COUNT(*) FROM billing_customers WHERE organisation_id=?) AS n',[org,org])).n);
 if(billing)blockers.push('The organisation has a billing relationship; demonstration data is not added to organisations with payment activity.');
 const admins=Number((await one("SELECT COUNT(*) n FROM users WHERE organisation_id=? AND role='admin' AND active=1",[org])).n);
 if(!admins)blockers.push('The organisation has no active administrator, so there is no owner login to import as.');
 const ent=Object.fromEntries((await q('SELECT module,status FROM organisation_entitlements WHERE organisation_id=?',[org])).map(r=>[r.module,r.status]));
 for(const m of REQUIRED_MODULES)if(ent[m]&&ent[m]!=='active')blockers.push(`Module "${m}" is ${ent[m]} for this organisation; the dataset needs it active.`);

 // ---- divisions ----
 for(const [code,name,description] of DIVISIONS){
  const r=await one('SELECT name,description FROM business_units WHERE organisation_id=? AND code=?',[org,code]);
  if(!r)add('divisions',code,'create');
  else if(r.name===name&&r.description===description)add('divisions',code,'skip');
  else add('divisions',code,'conflict','a division with this code exists and is not the demonstration division');
 }
 // ---- people, plant, clients ----
 for(const [no,,last] of WORKERS){
  const r=await one('SELECT name FROM workers WHERE organisation_id=? AND employee_number=?',[org,no]);
  if(!r)add('workers',no,'create');else if(String(r.name).toLowerCase().includes(String(last).toLowerCase()))add('workers',no,'skip');else add('workers',no,'conflict','employee number is used by a different person');
 }
 for(const [no,name] of PLANT){
  const r=await one('SELECT name FROM plant WHERE organisation_id=? AND plant_number=?',[org,no]);
  if(!r)add('plant',no,'create');else if(String(r.name).includes(name))add('plant',no,'skip');else add('plant',no,'conflict','plant number is used by a different asset');
 }
 const demoClients=await ids("SELECT id FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'",[org]);
 for(const k of CLIENTS){
  const r=await one('SELECT id,name FROM clients WHERE organisation_id=? AND client_code=?',[org,k.code]);
  if(!r)add('clients',k.code,'create');else if(r.name===k.name)add('clients',k.code,'skip');else add('clients',k.code,'conflict','client code is used by a different client');
  for(const [site] of k.sites){const s=r&&await one('SELECT id FROM client_sites WHERE organisation_id=? AND client_id=? AND name=?',[org,r.id,site]);add('client sites',`${k.code}:${site}`,s?'skip':'create');}
  for(const [contact] of k.contacts){const s=r&&await one('SELECT id FROM client_contacts WHERE organisation_id=? AND client_id=? AND name=?',[org,r.id,contact]);add('client contacts',`${k.code}:${contact}`,s?'skip':'create');}
 }
 for(const [table,rows] of [['crews',CREWS.map(r=>r[0])],['suppliers',SUPPLIERS.map(r=>r[0])],['subcontractors',SUBS.map(r=>r[0])]])
  for(const name of rows)add(table,name,(await one(`SELECT id FROM ${table} WHERE organisation_id=? AND name=?`,[org,name]))?'skip':'create');

 // ---- pipeline ----
 const demoTenders=await q("SELECT id,project_id,reference,title FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'",[org]);
 const demoTenderIds=new Set(demoTenders.map(t=>t.id)),demoProjects=new Set(demoTenders.map(t=>t.project_id).filter(Boolean));
 for(const b of BIDS){
  const r=await one('SELECT title FROM tenders WHERE organisation_id=? AND reference=?',[org,b.ref]);
  if(!r)add('tenders',b.ref,'create');else if(r.title===b.title)add('tenders',b.ref,'skip');else add('tenders',b.ref,'conflict','tender reference is used by a different tender');
 }
 for(const l of LEADS){
  const r=await one('SELECT client_id,tender_id FROM opportunities WHERE organisation_id=? AND name=?',[org,l.name]);
  if(!r)add('opportunities',l.name,'create');else if(demoClients.has(r.client_id)||demoTenderIds.has(r.tender_id))add('opportunities',l.name,'skip');else add('opportunities',l.name,'conflict','an opportunity with this name exists and is not attached to a demonstration client');
 }
 // ---- shifts, users, dockets, plan, safety records ----
 for(const s of SHIFTS){
  const r=await one('SELECT project_id FROM shifts WHERE organisation_id=? AND name=?',[org,s[0]]);
  if(!r)add('shifts',s[0],'create');else if(demoProjects.has(r.project_id))add('shifts',s[0],'skip');else add('shifts',s[0],'conflict','a shift with this name exists and is not on a demonstration project');
 }
 for(const [,,,local] of USERS){
  const email=local+DEMO_EMAIL_DOMAIN;const r=await one('SELECT organisation_id FROM users WHERE email=?',[email]);
  if(!r)add('team members (no login)',email,'create');else if(r.organisation_id===org)add('team members (no login)',email,'skip');else add('team members (no login)',email,'conflict','this address already belongs to another organisation');
 }
 for(const [no] of DOCKETS){const r=await one('SELECT id FROM dockets WHERE organisation_id=? AND docket_no=?',[org,no]);add('dockets',no,r?'skip':'create');}
 {const r=await one('SELECT project_id FROM planning_plans WHERE organisation_id=? AND name=?',[org,PLAN_NAME]);
  if(!r)add('planning plans',PLAN_NAME,'create');else if(demoProjects.has(r.project_id))add('planning plans',PLAN_NAME,'skip');else add('planning plans',PLAN_NAME,'conflict','a plan with this name exists and is not on a demonstration project');}
 for(const [table,col,text] of [['hseq_incidents','description',HSEQ_TEXT.near],['hseq_incidents','description',HSEQ_TEXT.minor],['hseq_ncrs','issue',HSEQ_TEXT.ncr],...HSEQ_TEXT.actions.map(t=>['hseq_actions','action',t])]){
  const r=await one(`SELECT project_id FROM ${table} WHERE organisation_id=? AND ${col}=?`,[org,text]);
  if(!r)add('safety records',text.slice(0,48),'create');else if(demoProjects.has(r.project_id))add('safety records',text.slice(0,48),'skip');else add('safety records',text.slice(0,48),'conflict','a safety record with identical text exists and is not on a demonstration project');
 }
 // Records created as a consequence of the above (estimates, projects, claims, invoices, risks, SWMS, ITPs, programme, scenarios,
 // workshop orders, service events, cost transactions, project members) are keyed to demonstration tenders, projects and plant, so
 // they cannot collide with owner records; they are created or resumed by the stages and counted in the post-import verification.
 const conflicts=groups.flatMap(g=>g.items.filter(i=>i.state==='conflict').map(i=>({group:g.group,key:i.key,reason:i.reason})));
 const totals=groups.reduce((a,g)=>({create:a.create+g.create,skip:a.skip+g.skip,conflict:a.conflict+g.conflict}),{create:0,skip:0,conflict:0});
 // ---- the full scope of apply: every table it writes to, by demonstration parent, measured from a reference import ----
 const fp=loadFootprint(),present=await presentByTable(q,org),records=[];
 for(const [table,ref] of Object.entries(fp.tables)){
  const have=present[table]||{},keys=[...new Set([...Object.keys(ref.byKey),...Object.keys(have)])].sort();
  const have_n=Object.values(have).reduce((a,b)=>a+b,0),extra=keys.filter(k=>(have[k]||0)>(ref.byKey[k]||0));
  records.push({table,kind:ref.kind,...(ref.parent?{parent:ref.parent}:{}),expected:ref.expected,present:have_n,toCreate:Math.max(0,ref.expected-have_n),byKey:keys.map(k=>({key:k,expected:ref.byKey[k]||0,present:have[k]||0}))});
  if(extra.length)blockers.push(`${table}: more demonstration rows than the dataset defines under ${extra.slice(0,3).join(', ')}${extra.length>3?'…':''}; the tenant has records attached to demonstration parents that this import did not create.`);
 }
 const orgRows=async t=>Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE organisation_id=?`,[org])).n);
 const bootstrap=Object.fromEntries(await Promise.all(BOOTSTRAP.map(async t=>[t,{presentInTenant:await orgRows(t),referenceRowsIfMissing:fp.bootstrapRowsIfMissing[t]}])));
 const bookkeeping=Object.fromEntries(await Promise.all(BOOKKEEPING.map(async t=>[t,{presentInTenant:await orgRows(t),referenceRowsAdded:fp.bookkeepingRowsApproximate[t]}])));
 const recordTotals={tables:records.length,expected:records.reduce((a,r)=>a+r.expected,0),present:records.reduce((a,r)=>a+r.present,0),toCreate:records.reduce((a,r)=>a+r.toCreate,0)};
 const scope={records,recordTotals,bootstrapIfMissing:bootstrap,bookkeepingAppendOnly:bookkeeping,attachmentsAndFiles:{expected:0,note:'No uploaded files, documents or attachments are created (storage and OCR are disabled); claim PDFs are generated on request and not stored.'}};
 const body={organisationId:org,seedDate,groups,scope,conflicts,blockers};
 return {...body,totals,planHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
