// SEAM/aggregation: project money spine and estimate-vs-actual.
// Reads projects, commercial, dockets and field data; all arithmetic is in
// lib/platform/finance.ts. Commercial figures are returned only to roles with
// commercial.view and organisations with the commercial module usable.
import {actorContext} from '@/lib/platform/context';
import {can} from '@/lib/platform/permissions';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {fail} from '@/lib/platform/http';
import {query,one,round2,type Row} from '@/lib/platform/sql';
import {forecast,type Forecast} from '@/lib/platform/finance';
import {plannedCost,type DeliveryRecord} from '@/lib/planning';
import {resourceHours,type FieldData} from '@/lib/field';
import {safeJson} from '@/lib/estimates-db';
import {itemHours,type EstimateData,type EstimateTotals} from '@/lib/estimate-calculations';

const actor=()=>actorContext.getStore()!;
const CATS=['labour','plant','material','subcontract','other'] as const;

export async function canSeeMoney(){const a=actor();return can(a.role,'commercial.view')&&usable(await getEntitlements(a.organisationId),'commercial');}

export async function projectFinancials(projectId:string){
 const org=actor().organisationId;
 const p=await one('SELECT id,name,contract_value,original_budget,metadata FROM jobs WHERE organisation_id=? AND id=?',[org,projectId]);
 if(!p)fail(404,'Project not found.');
 const meta=safeJson<Row>(p!.metadata,{}),legacyBudget=(meta.approvedBudget||{}) as Row;
 const [baseline,variations,costs,shifts,fields,docketShifts,claims,invoices]=await Promise.all([
  one('SELECT * FROM project_baselines WHERE organisation_id=? AND project_id=? ORDER BY revision LIMIT 1',[org,projectId]),
  query('SELECT status,value,cost,approved_value FROM project_variations WHERE organisation_id=? AND project_id=?',[org,projectId]),
  query("SELECT category,SUM(amount) AS amount,SUM(CASE WHEN category='labour' THEN quantity ELSE 0 END) AS qty FROM cost_transactions WHERE organisation_id=? AND project_id=? AND status='actual' GROUP BY category",[org,projectId]),
  query("SELECT id,name,status,metadata FROM shifts WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.jobId'))=?",[org,projectId]),
  query("SELECT f.shift_id,f.status,f.data FROM field_records f JOIN shifts s ON s.id=f.shift_id AND s.organisation_id=f.organisation_id WHERE f.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId'))=? AND f.status='Submitted'",[org,projectId]),
  query("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(links,'$.shiftId')) AS shift_id FROM dockets WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(links,'$.jobId'))=? AND status IN ('approved','included_claim','invoiced')",[org,projectId]),
  query("SELECT status,gross_amount,certified_amount FROM progress_claims WHERE organisation_id=? AND project_id=?",[org,projectId]),
  query("SELECT status,amount_ex_gst,paid_amount,total FROM client_invoices WHERE organisation_id=? AND project_id=?",[org,projectId]),
 ]);
 const sum=(rows:Row[],f:(r:Row)=>number)=>rows.reduce((n,r)=>n+f(r),0);
 const originalContract=baseline?Number(baseline.contract_value):Number(p!.contract_value??meta.contractValue??legacyBudget.sellRate??0);
 const originalBudget=baseline?Number(baseline.budget_total):Number(p!.original_budget??legacyBudget.totalCost??0);
 const approved=variations.filter(v=>v.status==='approved');
 const actualByCat=Object.fromEntries(CATS.map(c=>[c,round2(Number(costs.find(x=>x.category===c)?.amount||0))])) as Record<typeof CATS[number],number>;
 const docketed=new Set(docketShifts.map(d=>d.shift_id));
 // Accrued: submitted field records not yet covered by an approved docket (prevents double counting).
 const accrued=sum(fields.filter(f=>!docketed.has(f.shift_id)),f=>{const d=safeJson<FieldData>(f.data,{} as FieldData);return (d.resources||[]).reduce((n,r)=>n+resourceHours(r)*Number(r.rate||0),0)+Number(d.materialCost||0)+Number(d.otherCost||0);});
 const committed=sum(shifts.filter(s=>['Planned','Ready','In Progress'].includes(s.status)&&!fields.some(f=>f.shift_id===s.id)),s=>plannedCost({id:s.id,name:s.name,status:s.status,metadata:safeJson(s.metadata,{})} as DeliveryRecord));
 const claimed=sum(claims.filter(c=>['submitted','certified','invoiced','paid'].includes(c.status)),c=>Number(c.gross_amount));
 const certified=sum(claims.filter(c=>c.certified_amount!=null),c=>Number(c.certified_amount));
 const liveInvoices=invoices.filter(i=>i.status!=='void'&&i.status!=='draft');
 const f=forecast({originalContract,approvedVariations:sum(approved,v=>Number(v.approved_value??v.value)),pendingVariations:sum(variations.filter(v=>['draft','submitted'].includes(v.status)),v=>Number(v.value)),originalBudget,approvedVariationCost:sum(approved,v=>Number(v.cost)),actual:Object.values(actualByCat).reduce((n,v)=>n+v,0),committed,accrued,claimed,certified,invoiced:sum(liveInvoices,i=>Number(i.amount_ex_gst)),paid:sum(liveInvoices,i=>Number(i.paid_amount))});
 const budgetByCat=baseline?{labour:Number(baseline.budget_labour),plant:Number(baseline.budget_plant),material:Number(baseline.budget_material),subcontract:Number(baseline.budget_subcontract),other:Number(baseline.budget_other)+Number(baseline.budget_indirect)}:null;
 return {forecast:f,hasBaseline:Boolean(baseline),budgetByCategory:budgetByCat,actualByCategory:actualByCat};
}

/** Learn: deterministic estimate vs actual where reliable data exists. Nulls mean "not available". */
export async function estimateVsActual(projectId:string){
 const org=actor().organisationId;
 const baseline=await one('SELECT snapshot,contract_value,budget_total FROM project_baselines WHERE organisation_id=? AND project_id=? ORDER BY revision LIMIT 1',[org,projectId]);
 const fin=await projectFinancials(projectId);
 const snap=safeJson<{data?:EstimateData;totals?:EstimateTotals}>(baseline?.snapshot,{});
 const data=snap.data,totals=snap.totals;
 const estLabourHours=data&&totals?round2((data.labour||[]).reduce((n,l)=>n+l.headcount*l.hoursPerShift*totals.estimatedShifts,0)+(data.items||[]).filter(i=>i.category==='labour').reduce((n,i)=>n+itemHours(i),0)):null;
 const [dockets,fields]=await Promise.all([
  one<{hours:number;qty:number;n:number}>("SELECT COALESCE(SUM(labour_hours),0) AS hours,COALESCE(SUM(quantity),0) AS qty,COUNT(*) AS n FROM dockets WHERE organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(links,'$.jobId'))=? AND status IN ('approved','included_claim','invoiced')",[org,projectId]),
  query("SELECT f.data FROM field_records f JOIN shifts s ON s.id=f.shift_id AND s.organisation_id=f.organisation_id WHERE f.organisation_id=? AND JSON_UNQUOTE(JSON_EXTRACT(s.metadata,'$.jobId'))=? AND f.status='Submitted'",[org,projectId]),
 ]);
 const fieldHours=fields.reduce((n,f)=>n+((safeJson<FieldData>(f.data,{} as FieldData).resources||[]) as FieldData['resources']).filter(r=>['workers','crews'].includes(String(r.category))).reduce((v,r)=>v+resourceHours(r),0),0);
 const fieldTonnes=fields.reduce((n,f)=>n+Number(safeJson<FieldData>(f.data,{} as FieldData).tonnes||0),0);
 const actualLabourHours=Number(dockets?.hours||0)+fieldHours;
 const tenderMargin=baseline&&Number(baseline.contract_value)>0?round2((Number(baseline.contract_value)-Number(baseline.budget_total))/Number(baseline.contract_value)*100):null;
 const rows=CATS.map(c=>{const est=fin.budgetByCategory?fin.budgetByCategory[c]:null,act=fin.actualByCategory[c];return {category:c,estimated:est,actual:act,variance:est==null?null:round2(act-est),variancePct:est?round2((act-est)/est*100):null};});
 return {available:Boolean(baseline),categories:rows,
  cost:{estimated:baseline?Number(baseline.budget_total):null,actual:fin.forecast.actual,forecastFinal:fin.forecast.forecastFinalCost},
  labourHours:{estimated:estLabourHours,actual:actualLabourHours||null,source:'approved dockets + submitted field records'},
  quantity:{estimated:data?.includePaving!==false&&totals?totals.totalTonnes:null,actual:(Number(dockets?.qty||0)+fieldTonnes)||null,unit:data?.includePaving!==false?'t':null},
  productivity:{estimatedPerShift:data?.includePaving!==false&&data?data.productionTonnesPerShift:null},
  margin:{tender:tenderMargin,forecast:fin.forecast.forecastMarginPct},
  docketsCounted:Number(dockets?.n||0),fieldRecordsCounted:fields.length};
}

export type ProjectFinancials=Awaited<ReturnType<typeof projectFinancials>>;
export type {Forecast};
