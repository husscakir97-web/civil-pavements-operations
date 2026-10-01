import {actorContext} from '@/lib/platform/context';
import {need,fail} from '@/lib/platform/http';
import {getEntitlements,usable} from '@/lib/platform/entitlements';
import {can} from '@/lib/platform/permissions';
import {projectScope} from '@/lib/platform/project-access';
import {query,tx} from '@/lib/platform/sql';
import {buildDivisionalPnl,pnlPeriod,type PnlDivision,type PnlProject,type PnlSource} from '@/lib/platform/divisional-pnl';

export async function divisionalPnl(start:string,end:string,divisionId:string|null){
 need('reports.view');need('commercial.view');
 try{pnlPeriod(start,end);}catch(e){fail(400,(e as Error).message);}
 const a=actorContext.getStore()!,org=a.organisationId,e=await getEntitlements(org);
 if(!usable(e,'reports'))fail(404,'Report not available.');
 const projectsAvailable=usable(e,'projects')&&can(a.role,'project.view');
 const revenueAvailable=usable(e,'commercial'),costsAvailable=projectsAvailable;
 // A single database snapshot keeps totals and their supporting rows consistent.
 return tx(async conn=>{
  const scope=await projectScope(a,conn),params:unknown[]=[org];
  const scoped=scope?' AND j.id IN (?)':'';if(scope)params.push(scope.length?scope:['-']);
  const divisions=await query<PnlDivision>('SELECT id,name,code FROM business_units WHERE organisation_id=? ORDER BY sort_order,name',[org],conn);
  const defaultRow=await query<{id:string}>('SELECT id FROM business_units WHERE organisation_id=? AND is_default=1',[org],conn);
  // Jobs are core references for commercial records; only expose project details when entitled.
  const jobs=projectsAvailable||revenueAvailable?await query<{id:string;name:string;divisionId:string|null}>(`SELECT j.id,j.name,j.business_unit_id AS divisionId FROM jobs j WHERE j.organisation_id=?${scoped}`,params,conn):[];
  const visible=new Set(jobs.map(j=>j.divisionId??defaultRow[0]?.id));
  const allowedDivisions=scope?divisions.filter(d=>visible.has(d.id)):divisions;
  if(divisionId&&divisionId!=='unallocated'&&!allowedDivisions.some(d=>d.id===divisionId))fail(404,'Division not found.');
  if(divisionId==='unallocated'&&scope)fail(404,'Division not found.');
  const sourceParams:unknown[]=[org,start,end];if(scope)sourceParams.push(scope.length?scope:['-']);
  const sourceScope=scope?' AND project_id IN (?)':'';
  const sources:PnlSource[]=[];
  if(revenueAvailable)sources.push(...await query<PnlSource>(`SELECT id,project_id AS projectId,invoice_date AS date,'invoice' AS kind,status,amount_ex_gst AS amount,invoice_number AS reference,'client_invoice' AS sourceType,id AS sourceId,'' AS sourceLine,'revenue' AS category,NULL AS costCode,invoice_number AS description FROM client_invoices WHERE organisation_id=? AND invoice_date BETWEEN ? AND ?${sourceScope}`,sourceParams,conn));
  if(costsAvailable)sources.push(...await query<PnlSource>(`SELECT id,project_id AS projectId,transaction_date AS date,'cost' AS kind,status,amount,source_id AS reference,source_type AS sourceType,source_id AS sourceId,source_line AS sourceLine,category,cost_code AS costCode,description FROM cost_transactions WHERE organisation_id=? AND transaction_date BETWEEN ? AND ?${sourceScope}`,sourceParams,conn));
  if(costsAvailable&&usable(e,'dockets')){
   // links is legacy LONGTEXT, not validated JSON. Guard the function argument
   // (not a separate WHERE predicate whose evaluation order is unspecified).
   // Invalid links become unallocated for org-wide users; the same guarded
   // expression excludes them from restricted users' project scope.
   const docketProject="JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(d.links) THEN d.links ELSE '{}' END,'$.jobId'))";
   sources.push(...await query<PnlSource>(`SELECT d.id,${docketProject} AS projectId,d.work_date AS date,'cost' AS kind,'not_posted' AS status,d.amount,d.docket_no AS reference,'docket' AS sourceType,d.id AS sourceId,'UNPOSTED' AS sourceLine,'unmapped' AS category,NULL AS costCode,CASE WHEN JSON_VALID(d.links) THEN 'Approved docket without an active cost posting' ELSE 'Approved docket has invalid project links; no active cost posting' END AS description FROM dockets d WHERE d.organisation_id=? AND d.work_date BETWEEN ? AND ? AND d.status IN ('approved','included_claim','invoiced') AND NOT EXISTS (SELECT 1 FROM cost_transactions c WHERE c.organisation_id=d.organisation_id AND c.source_type='docket' AND c.source_id=d.id AND c.status='actual')${scope?` AND ${docketProject} IN (?)`:''}`,sourceParams,conn));
  }
  const projects:PnlProject[]=jobs.map(j=>({...j,divisionId:j.divisionId??defaultRow[0]?.id??null,baseline:null,baselineId:null,estimateId:null,costToDate:0}));
  if(projectsAvailable&&projects.length){
   const ids=projects.map(p=>p.id);
   const baselines=await query<{id:string;project_id:string;budget_total:number;estimate_id:string|null}>('SELECT b.id,b.project_id,b.budget_total,b.estimate_id FROM project_baselines b WHERE b.organisation_id=? AND b.project_id IN (?) AND b.created_at<? AND b.revision=(SELECT MIN(b2.revision) FROM project_baselines b2 WHERE b2.organisation_id=b.organisation_id AND b2.project_id=b.project_id)',[org,ids,new Date(Date.parse(end)+86400000).toISOString().slice(0,10)],conn);
   const costs=await query<{project_id:string;amount:number}>("SELECT project_id,SUM(amount) AS amount FROM cost_transactions WHERE organisation_id=? AND project_id IN (?) AND transaction_date<=? AND status='actual' AND source_type='docket' GROUP BY project_id",[org,ids,end],conn);
   for(const p of projects){const b=baselines.find(b=>b.project_id===p.id);p.baseline=b?Number(b.budget_total):null;p.baselineId=b?.id??null;p.estimateId=usable(e,'estimating')?b?.estimate_id??null:null;p.costToDate=Number(costs.find(c=>c.project_id===p.id)?.amount??0);}
  }
  const report=buildDivisionalPnl({start,end,divisionId,divisions:allowedDivisions,projects,sources:sources.map(s=>({...s,amount:Number(s.amount)})),revenueAvailable,costsAvailable});
  return {...report,projects:projectsAvailable?report.projects:[],availableDivisions:allowedDivisions,scope:scope?'Authorized projects only':'All authorized divisions',generatedAt:new Date().toISOString(),coverage:{revenueAvailable,costsAvailable,comparableTaxBasis:false,ledger:false,payroll:false,fleet:false,overheads:false},definitions:{revenue:'Provisional billed revenue: issued, part-paid and paid client invoices, ex GST, by invoice date. This is not earned revenue or reconciled accounting revenue; retention timing may differ.',directCosts:'Active docket-derived cost transactions by work date, once per source line. Amounts are reported as stored; their GST basis is unknown. Dockets, supplier invoices, payroll, field estimates and plant records are not added again.',grossProfit:report.profitability.reason,overheads:'Not available: no posted overhead source. No annual percentage of revenue is allocated.',netResult:'Not available until a comparable tax basis, overheads, accounting recognition and source reconciliation are established.'},warnings:[
   'Management report only. No general ledger or bank reconciliation is connected; accounting actuals are unavailable.',
   'Quotes, claims (including unpaid claims), budgets and operational forecasts are excluded from revenue.',
   'Unposted or unallocated dockets, supplier invoices, payroll, depreciation, fuel and fleet maintenance may be missing. A zero means no included records, not complete coverage.',
   'Cost categories and cost codes come from source records; no accounting chart mapping is assumed. Division names use tenant configuration.',
   'Division attribution uses the current project division (legacy blank assignments use the current default). Reassignments can restate prior periods.',
   report.eliminations.status,
   ...(!projectsAvailable?['Projects module unavailable: job costs, baselines and project detail are not included.']:[]),
   ...(!revenueAvailable?['Commercial module unavailable: revenue and gross profit are not available.']:[]),
  ]};
 });
}
export type DivisionalPnlReport=Awaited<ReturnType<typeof divisionalPnl>>;
