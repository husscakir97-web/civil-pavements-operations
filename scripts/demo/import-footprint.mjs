// The complete footprint of a demonstration import: every table an apply writes to, how many rows it adds, and which demonstration
// parent each row hangs from (a tender reference, plant number, plan/scenario name, …) so the dry run can show the full scope BEFORE
// anything is created. The reference numbers live in docs/DEMO-IMPORT-FOOTPRINT.json and are measured, not hand-written: the test
// imports the dataset into an empty tenant, measures every table that gained rows, and fails if the file, the spec below or a
// populated tenant's measured delta disagree.
import {readFileSync} from 'node:fs';
import {DIVISIONS,DEMO_EMAIL_DOMAIN} from './import-plan.mjs';

export const FOOTPRINT_FILE=new URL('../../docs/DEMO-IMPORT-FOOTPRINT.json',import.meta.url);
export const loadFootprint=()=>JSON.parse(readFileSync(FOOTPRINT_FILE,'utf8'));

// Rows the application writes for any tenant on first use, whether or not the demonstration is imported (written only if missing,
// never modified), and append-only bookkeeping whose count varies with retries.
export const BOOTSTRAP=['organisation_entitlements','organisation_profiles','rate_libraries'];
export const BOOKKEEPING=['audit_log','audit_events','domain_events'];
// Tables that would hold uploaded files or attachments. The dataset creates none (storage and OCR are disabled).
export const ATTACHMENT_TABLES=/document|attachment|upload|file|blob/i;

const list=ids=>ids.length?ids.map(()=>'?').join(','):"'-none-'";

/** id -> natural key maps for every kind of demonstration parent that exists in the tenant right now. */
export async function parentMaps(q,org){
 const map=async(sql,p,key)=>new Map((await q(sql,p)).map(r=>[r.id,key(r)]));
 const P={};
 P.client=await map("SELECT id,client_code k FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'",[org],r=>r.k);
 P.worker=await map("SELECT id,employee_number k FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-E%'",[org],r=>r.k);
 P.plant=await map("SELECT id,plant_number k FROM plant WHERE organisation_id=? AND plant_number LIKE 'DEMO-P%'",[org],r=>r.k);
 const tenders=await q("SELECT id,reference,project_id,estimate_id FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'",[org]);
 P.tender=new Map(tenders.map(t=>[t.id,t.reference]));
 P.project=new Map(tenders.filter(t=>t.project_id).map(t=>[t.project_id,t.reference]));
 P.estimate=new Map(tenders.filter(t=>t.estimate_id).map(t=>[t.estimate_id,t.reference]));
 const pids=[...P.project.keys()];
 P.plan=await map(`SELECT id,name k FROM planning_plans WHERE organisation_id=? AND project_id IN (${list(pids)})`,[org,...pids],r=>r.k);
 const plans=[...P.plan.keys()];
 P.scenario=await map(`SELECT id,plan_id,name FROM planning_scenarios WHERE organisation_id=? AND plan_id IN (${list(plans)})`,[org,...plans],r=>`${P.plan.get(r.plan_id)} / ${r.name}`);
 P.shift=await map(`SELECT id,name k FROM shifts WHERE organisation_id=? AND project_id IN (${list(pids)})`,[org,...pids],r=>r.k);
 P.claim=await map(`SELECT id,project_id,number FROM progress_claims WHERE organisation_id=? AND project_id IN (${list(pids)})`,[org,...pids],r=>`${P.project.get(r.project_id)} #${r.number}`);
 const assets=[...P.plant.keys()];
 P.order=await map(`SELECT id,asset_id,title FROM workshop_orders WHERE organisation_id=? AND asset_id IN (${list(assets)})`,[org,...assets],r=>`${P.plant.get(r.asset_id)}: ${r.title}`);
 P.swms=await map(`SELECT id,project_id FROM swms WHERE organisation_id=? AND project_id IN (${list(pids)})`,[org,...pids],r=>`${P.project.get(r.project_id)}: SWMS`);
 return P;
}

// One entry per table the apply writes. kind: direct = keyed by its own natural key; derived = hangs from a demonstration parent.
// rows(q,org,P) returns one key per existing demonstration row: its own key (direct) or its parent's key (derived).
const own=(sql,key='k')=>async(q,org)=>(await q(sql,[org])).map(r=>r[key]);
const via=(table,col,parent)=>async(q,org,P)=>{const ids=[...P[parent].keys()];return (await q(`SELECT ${col} v FROM ${table} WHERE organisation_id=? AND ${col} IN (${list(ids)})`,[org,...ids])).map(r=>P[parent].get(r.v));};
export const SPEC={
 business_units:{kind:'direct',rows:async(q,org)=>(await q(`SELECT code k FROM business_units WHERE organisation_id=? AND code IN (${list(DIVISIONS)})`,[org,...DIVISIONS.map(d=>d[0])])).map(r=>r.k)},
 clients:{kind:'direct',rows:own("SELECT client_code k FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'")},
 client_sites:{kind:'derived',parent:'client',rows:via('client_sites','client_id','client')},
 client_contacts:{kind:'derived',parent:'client',rows:via('client_contacts','client_id','client')},
 workers:{kind:'direct',rows:own("SELECT employee_number k FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-E%'")},
 worker_competencies:{kind:'derived',parent:'worker',rows:via('worker_competencies','worker_id','worker')},
 plant:{kind:'direct',rows:own("SELECT plant_number k FROM plant WHERE organisation_id=? AND plant_number LIKE 'DEMO-P%'")},
 crews:{kind:'direct',rows:own("SELECT name k FROM crews WHERE organisation_id=? AND name LIKE 'DEMO %'")},
 suppliers:{kind:'direct',rows:own("SELECT name k FROM suppliers WHERE organisation_id=? AND name LIKE 'DEMO %'")},
 subcontractors:{kind:'direct',rows:own("SELECT name k FROM subcontractors WHERE organisation_id=? AND name LIKE 'DEMO %'")},
 users:{kind:'direct',rows:async(q,org)=>(await q('SELECT email k FROM users WHERE organisation_id=? AND email LIKE ?',[org,'%'+DEMO_EMAIL_DOMAIN])).map(r=>r.k)},
 opportunities:{kind:'direct',rows:async(q,org,P)=>{const c=[...P.client.keys()],t=[...P.tender.keys()];return (await q(`SELECT name k FROM opportunities WHERE organisation_id=? AND (client_id IN (${list(c)}) OR tender_id IN (${list(t)}))`,[org,...c,...t])).map(r=>r.k);}},
 tenders:{kind:'direct',rows:own("SELECT reference k FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'")},
 tender_bid_reviews:{kind:'derived',parent:'tender',rows:via('tender_bid_reviews','tender_id','tender')},
 estimates:{kind:'derived',parent:'tender',rows:async(q,org,P)=>{const ids=[...P.estimate.keys()];return (await q(`SELECT id FROM estimates WHERE organisation_id=? AND id IN (${list(ids)})`,[org,...ids])).map(r=>P.estimate.get(r.id));}},
 estimate_revisions:{kind:'derived',parent:'estimate',rows:via('estimate_revisions','estimate_id','estimate')},
 quote_revisions:{kind:'derived',parent:'estimate',rows:async(q,org,P)=>(await q('SELECT metadata FROM quote_revisions WHERE organisation_id=?',[org])).map(r=>{try{return P.estimate.get(JSON.parse(r.metadata||'{}').estimateId);}catch{return undefined;}}).filter(Boolean)},
 jobs:{kind:'derived',parent:'tender',rows:via('jobs','id','project')},
 project_baselines:{kind:'derived',parent:'project',rows:via('project_baselines','project_id','project')},
 project_members:{kind:'derived',parent:'project',rows:via('project_members','project_id','project')},
 project_cost_codes:{kind:'derived',parent:'project',rows:via('project_cost_codes','project_id','project')},
 project_checklist_items:{kind:'derived',parent:'project',rows:via('project_checklist_items','project_id','project')},
 job_ims_items:{kind:'derived',parent:'project',rows:via('job_ims_items','job_id','project')},
 risks:{kind:'derived',parent:'project',rows:via('risks','project_id','project')},
 itps:{kind:'derived',parent:'project',rows:via('itps','project_id','project')},
 itp_items:{kind:'derived',parent:'project',rows:via('itp_items','project_id','project')},
 swms:{kind:'derived',parent:'project',rows:via('swms','project_id','project')},
 swms_revisions:{kind:'derived',parent:'swms',rows:via('swms_revisions','swms_id','swms')},
 hseq_incidents:{kind:'derived',parent:'project',rows:via('hseq_incidents','project_id','project')},
 hseq_ncrs:{kind:'derived',parent:'project',rows:via('hseq_ncrs','project_id','project')},
 hseq_actions:{kind:'derived',parent:'project',rows:via('hseq_actions','project_id','project')},
 program_activities:{kind:'derived',parent:'project',rows:via('program_activities','project_id','project')},
 shifts:{kind:'direct',rows:async(q,org,P)=>[...P.shift.values()]},
 shift_assignments:{kind:'derived',parent:'shift',rows:via('shift_assignments','shift_id','shift')},
 dockets:{kind:'direct',rows:own("SELECT docket_no k FROM dockets WHERE organisation_id=? AND docket_no LIKE 'DEMO-D-%'")},
 cost_transactions:{kind:'derived',parent:'project',rows:via('cost_transactions','project_id','project')},
 progress_claims:{kind:'derived',parent:'project',rows:async(q,org,P)=>[...P.claim.values()]},
 claim_lines:{kind:'derived',parent:'claim',rows:via('claim_lines','claim_id','claim')},
 client_invoices:{kind:'derived',parent:'project',rows:via('client_invoices','project_id','project')},
 planning_plans:{kind:'direct',rows:async(q,org,P)=>[...P.plan.values()]},
 planning_scenarios:{kind:'derived',parent:'plan',rows:async(q,org,P)=>[...P.scenario.values()]},
 planning_activities:{kind:'derived',parent:'scenario',rows:via('planning_activities','scenario_id','scenario')},
 planning_dependencies:{kind:'derived',parent:'scenario',rows:via('planning_dependencies','scenario_id','scenario')},
 planning_cost_items:{kind:'derived',parent:'scenario',rows:via('planning_cost_items','scenario_id','scenario')},
 planning_cost_links:{kind:'derived',parent:'scenario',rows:via('planning_cost_links','scenario_id','scenario')},
 planning_requirements:{kind:'derived',parent:'scenario',rows:via('planning_requirements','scenario_id','scenario')},
 asset_meter_readings:{kind:'derived',parent:'plant',rows:via('asset_meter_readings','asset_id','plant')},
 asset_service_events:{kind:'derived',parent:'plant',rows:via('asset_service_events','asset_id','plant')},
 workshop_orders:{kind:'derived',parent:'plant',rows:via('workshop_orders','asset_id','plant')},
 workshop_entries:{kind:'derived',parent:'order',rows:via('workshop_entries','order_id','order')},
 client_requests:{kind:'derived',parent:'plant',rows:via('client_requests','entity_id','plant')},
 // Work map (synthetic pins, work points, shared areas, shift references). A location row hangs from a demo client (site pins) or a demo project.
 project_work_areas:{kind:'derived',parent:'project',rows:via('project_work_areas','project_id','project')},
 project_work_points:{kind:'derived',parent:'project',rows:via('project_work_points','project_id','project')},
 shift_work_areas:{kind:'derived',parent:'shift',rows:via('shift_work_areas','shift_id','shift')},
 locations:{kind:'derived',parent:'client|project',rows:async(q,org,P)=>{
  const clients=[...P.client.keys()],pids=[...P.project.keys()];
  const sites=await q(`SELECT l.id,s.client_id c FROM locations l JOIN client_sites s ON s.id=l.owner_id AND s.organisation_id=l.organisation_id WHERE l.organisation_id=? AND l.owner_type='client_site' AND s.client_id IN (${list(clients)})`,[org,...clients]);
  const projects=await q(`SELECT l.id,l.owner_id p FROM locations l WHERE l.organisation_id=? AND l.owner_type='project' AND l.owner_id IN (${list(pids)})`,[org,...pids]);
  return [...sites.map(r=>P.client.get(r.c)),...projects.map(r=>P.project.get(r.p))];
 }},
};

const tally=keys=>{const o={};for(const k of keys)o[k]=(o[k]||0)+1;return Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));};

/** Current demonstration rows per table, by parent key. */
export async function presentByTable(q,org){
 const P=await parentMaps(q,org),out={};
 for(const [table,spec] of Object.entries(SPEC))out[table]=tally(await spec.rows(q,org,P));
 return out;
}

/** Measures the footprint of a finished import into an EMPTY tenant. `delta` = rows gained per table (all tenants), from snapshots. */
export async function measureFootprint(q,org,delta){
 const present=await presentByTable(q,org),tables={};
 for(const [table,spec] of Object.entries(SPEC))tables[table]={kind:spec.kind,...(spec.parent?{parent:spec.parent}:{}),expected:Object.values(present[table]).reduce((a,b)=>a+b,0),byKey:present[table]};
 const bootstrap=Object.fromEntries(BOOTSTRAP.map(t=>[t,delta[t]||0])),bookkeeping=Object.fromEntries(BOOKKEEPING.map(t=>[t,delta[t]||0]));
 return {description:'Every table the demonstration import writes to, measured by importing the dataset into an empty tenant (scripts/test-import-demo-tenant.mjs).',tables,bootstrapRowsIfMissing:bootstrap,bookkeepingRowsApproximate:bookkeeping,attachmentsAndFiles:0};
}
