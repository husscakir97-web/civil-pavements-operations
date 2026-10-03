// Read-only verification of the demonstration records inside a tenant that may hold other business data. Everything is scoped to
// records that belong to the demonstration (DEMO- keys and the projects, plant, plans and shifts attached to them).
import manifest from '../../docs/DEMO-COMPANY-MANIFEST.json' with {type:'json'};
import {USERS} from './projects.mjs';
import {DEMO_EMAIL_DOMAIN,DIVISIONS} from './import-plan.mjs';

const list=ids=>ids.length?ids.map(()=>'?').join(','):"'-none-'";

export async function scope(q,org){
 const col=async(sql,p)=>(await q(sql,p)).map(r=>r.id);
 const tenders=await q("SELECT id,project_id,estimate_id FROM tenders WHERE organisation_id=? AND reference LIKE 'DEMO-T-%'",[org]);
 return {
  clients:await col("SELECT id FROM clients WHERE organisation_id=? AND client_code LIKE 'DEMO-%'",[org]),
  workers:await col("SELECT id FROM workers WHERE organisation_id=? AND employee_number LIKE 'DEMO-E%'",[org]),
  plant:await col("SELECT id FROM plant WHERE organisation_id=? AND plant_number LIKE 'DEMO-P%'",[org]),
  tenders:tenders.map(t=>t.id),projects:tenders.map(t=>t.project_id).filter(Boolean),estimates:[...new Set(tenders.map(t=>t.estimate_id).filter(Boolean))],
 };
}

export async function scopedCounts(q,org,s){
 const n=async(sql,p)=>Number((await q(sql,p))[0].n);
 const inP=(table,column='project_id')=>n(`SELECT COUNT(*) n FROM ${table} WHERE organisation_id=? AND ${column} IN (${list(s.projects)})`,[org,...s.projects]);
 const shifts=(await q(`SELECT id FROM shifts WHERE organisation_id=? AND project_id IN (${list(s.projects)})`,[org,...s.projects])).map(r=>r.id);
 const plans=(await q(`SELECT id FROM planning_plans WHERE organisation_id=? AND project_id IN (${list(s.projects)})`,[org,...s.projects])).map(r=>r.id);
 const scenarios=(await q(`SELECT id FROM planning_scenarios WHERE organisation_id=? AND plan_id IN (${list(plans)})`,[org,...plans])).map(r=>r.id);
 const byScen=table=>n(`SELECT COUNT(*) n FROM ${table} WHERE organisation_id=? AND scenario_id IN (${list(scenarios)})`,[org,...scenarios]);
 const byAsset=table=>n(`SELECT COUNT(*) n FROM ${table} WHERE organisation_id=? AND asset_id IN (${list(s.plant)})`,[org,...s.plant]);
 return {
  divisions:await n(`SELECT COUNT(*) n FROM business_units WHERE organisation_id=? AND code IN (${list(DIVISIONS)})`,[org,...DIVISIONS.map(d=>d[0])]),
  workers:s.workers.length,
  competencies:await n(`SELECT COUNT(*) n FROM worker_competencies WHERE organisation_id=? AND status='current' AND worker_id IN (${list(s.workers)})`,[org,...s.workers]),
  plant:s.plant.length,
  crews:await n("SELECT COUNT(*) n FROM crews WHERE organisation_id=? AND name LIKE 'DEMO %'",[org]),
  suppliers:await n("SELECT COUNT(*) n FROM suppliers WHERE organisation_id=? AND name LIKE 'DEMO %'",[org]),
  subcontractors:await n("SELECT COUNT(*) n FROM subcontractors WHERE organisation_id=? AND name LIKE 'DEMO %'",[org]),
  clients:s.clients.length,
  sites:await n(`SELECT COUNT(*) n FROM client_sites WHERE organisation_id=? AND client_id IN (${list(s.clients)})`,[org,...s.clients]),
  contacts:await n(`SELECT COUNT(*) n FROM client_contacts WHERE organisation_id=? AND client_id IN (${list(s.clients)})`,[org,...s.clients]),
  opportunities:await n(`SELECT COUNT(*) n FROM opportunities WHERE organisation_id=? AND (client_id IN (${list(s.clients)}) OR tender_id IN (${list(s.tenders)}))`,[org,...s.clients,...s.tenders]),
  tenders:s.tenders.length,estimates:s.estimates.length,projects:s.projects.length,
  users:await n('SELECT COUNT(*) n FROM users WHERE organisation_id=? AND email LIKE ?',[org,'%'+DEMO_EMAIL_DOMAIN]),
  shifts:shifts.length,
  shiftAssignments:await n(`SELECT COUNT(*) n FROM shift_assignments WHERE organisation_id=? AND shift_id IN (${list(shifts)})`,[org,...shifts]),
  dockets:await n("SELECT COUNT(*) n FROM dockets WHERE organisation_id=? AND docket_no LIKE 'DEMO-D-%'",[org]),
  costTransactions:await inP('cost_transactions'),claims:await inP('progress_claims'),invoices:await inP('client_invoices'),
  risks:await inP('risks'),swms:await inP('swms'),itps:await inP('itps'),incidents:await inP('hseq_incidents'),ncrs:await inP('hseq_ncrs'),actions:await inP('hseq_actions'),
  workshopOrders:await byAsset('workshop_orders'),serviceEvents:await byAsset('asset_service_events'),
  programme:await inP('program_activities'),plans:plans.length,scenarios:scenarios.length,
  planningActivities:await byScen('planning_activities'),planningDependencies:await byScen('planning_dependencies'),
  sharedCosts:await n(`SELECT COUNT(*) n FROM planning_cost_items WHERE organisation_id=? AND scope='shared' AND scenario_id IN (${list(scenarios)})`,[org,...scenarios]),
 };
}

export async function scopedTotals(q,org,s){
 const sum=async(sql,p)=>Number((await q(sql,p))[0].v||0);
 const P=[org,...s.projects],L=list(s.projects);
 return {
  contractValue:await sum(`SELECT SUM(contract_value) v FROM jobs WHERE organisation_id=? AND id IN (${L})`,P),
  baselineBudget:await sum(`SELECT SUM(budget_total) v FROM project_baselines WHERE organisation_id=? AND project_id IN (${L})`,P),
  costTransactions:await sum(`SELECT SUM(amount) v FROM cost_transactions WHERE organisation_id=? AND project_id IN (${L})`,P),
  claimsGross:await sum(`SELECT SUM(gross_amount) v FROM progress_claims WHERE organisation_id=? AND project_id IN (${L})`,P),
  claimsCertified:await sum(`SELECT SUM(certified_amount) v FROM progress_claims WHERE organisation_id=? AND project_id IN (${L})`,P),
  invoicesTotal:await sum(`SELECT SUM(total) v FROM client_invoices WHERE organisation_id=? AND project_id IN (${L})`,P),
  invoicesPaid:await sum(`SELECT SUM(paid_amount) v FROM client_invoices WHERE organisation_id=? AND project_id IN (${L})`,P),
  docketAmount:await sum("SELECT SUM(amount) v FROM dockets WHERE organisation_id=? AND docket_no LIKE 'DEMO-D-%'",[org]),
 };
}

export async function verifyImport(q,org,log=()=>{}){
 const results=[];const check=(name,ok,detail='')=>{results.push({name,ok:Boolean(ok),detail});log(`${ok?'PASS':'FAIL'}  ${name}${detail?' — '+detail:''}`);};
 const s=await scope(q,org),counts=await scopedCounts(q,org,s),totals=await scopedTotals(q,org,s);
 const expected={...manifest.counts,users:USERS.length};
 for(const [k,v] of Object.entries(expected))if(k in counts)check(`demo ${k} = ${v}`,counts[k]===v,String(counts[k]));
 const n=async(sql,p)=>Number((await q(sql,p))[0].n);const L=list(s.projects);
 check('every demo project has tender lineage, an approved estimate revision and a baseline equal to its contract value',
  await n(`SELECT COUNT(*) n FROM jobs j JOIN estimate_revisions r ON r.id=j.source_estimate_revision_id AND r.status='approved' JOIN project_baselines b ON b.project_id=j.id AND b.contract_value=j.contract_value WHERE j.organisation_id=? AND j.id IN (${L}) AND j.source_tender_id IN (${list(s.tenders)})`,[org,...s.projects,...s.tenders])===s.projects.length);
 check('every demo shift is on a demo project and every assignment points at a demo worker or plant',
  await n(`SELECT COUNT(*) n FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id WHERE a.organisation_id=? AND s.project_id IN (${L}) AND a.resource_id NOT IN (${list([...s.workers,...s.plant])})`,[org,...s.projects,...s.workers,...s.plant])===0);
 check('every demo invoice belongs to a demo claim',await n(`SELECT COUNT(*) n FROM client_invoices i LEFT JOIN progress_claims c ON c.id=i.claim_id AND c.project_id IN (${L}) WHERE i.organisation_id=? AND i.project_id IN (${L}) AND c.id IS NULL`,[...s.projects,org,...s.projects])===0);
 check('claim, invoice and cost totals are positive and consistent (paid never exceeds invoiced)',totals.costTransactions>0&&totals.claimsGross>0&&totals.invoicesTotal>0&&totals.invoicesPaid<=totals.invoicesTotal);
 return {counts,totals,results,failed:results.filter(r=>!r.ok).length};
}
