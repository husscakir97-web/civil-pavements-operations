// Read-only management reporting arithmetic. Inputs must already be tenant/role scoped.
// These operational records are never promoted to reconciled ledger actuals.
export type PnlDivision={id:string;name:string;code:string};
export type PnlProject={id:string;name:string;divisionId:string|null;baseline:number|null;baselineId:string|null;estimateId:string|null;costToDate:number};
export type PnlSource={id:string;projectId:string;date:string;kind:'invoice'|'cost';status:string;amount:number;reference:string;sourceType:string;sourceId:string;sourceLine:string;category:string;costCode:string|null;description:string};
export type PnlInput={start:string;end:string;divisionId:string|null;divisions:PnlDivision[];projects:PnlProject[];sources:PnlSource[];revenueAvailable:boolean;costsAvailable:boolean};
export function pnlPeriod(start:string,end:string){
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end)||start>end||Date.parse(end)-Date.parse(start)>365*86400000)throw new Error('Choose valid start and end dates, up to 366 days apart.');
 return {start,end};
}
const cents=(n:number)=>{if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*100)))throw new Error('A source amount is invalid. Correct the source before reporting.');return Math.round(n*100);};
export function buildDivisionalPnl(i:PnlInput){
 pnlPeriod(i.start,i.end);
 if(i.divisionId&&i.divisionId!=='unallocated'&&!i.divisions.some(d=>d.id===i.divisionId))throw new Error('Division not found.');
 const projects=new Map(i.projects.map(p=>[p.id,p]));
 const known=new Set(i.divisions.map(d=>d.id));
 const divisionFor=(id:string)=>{const d=projects.get(id)?.divisionId;return d&&known.has(d)?d:'unallocated';};
 const selected=(d:string)=>!i.divisionId||i.divisionId===d;
 const seen=new Set<string>();
 const sources=i.sources.filter(s=>s.date>=i.start&&s.date<=i.end&&selected(divisionFor(s.projectId))).map(s=>{
  const key=s.kind==='invoice'?`invoice:${s.id}`:`cost:${s.sourceType}:${s.sourceId}:${s.sourceLine}`;
  let exclusion:string|null=null;
  if(s.kind==='invoice'&&!i.revenueAvailable||s.kind==='cost'&&!i.costsAvailable)exclusion='Source module unavailable';
  else if(s.kind==='invoice'&&!['issued','part_paid','paid'].includes(s.status))exclusion='Invoice is not issued';
  else if(s.kind==='cost'&&s.status==='not_posted')exclusion='Approved docket has no active posted cost';
  else if(s.kind==='cost'&&s.status!=='actual')exclusion='Cost is not active';
  // Only the existing idempotent docket seam is verified. Future payroll/AP/plant adapters
  // need a replacement/reconciliation key before joining the same total.
  else if(s.kind==='cost'&&s.sourceType!=='docket')exclusion='Unverified cost source; reconciliation required';
  else if(seen.has(key))exclusion='Duplicate source line';
  if(!exclusion)seen.add(key);
  cents(s.amount);
  return {...s,taxBasis:s.kind==='invoice'?'ex_gst' as const:'unknown' as const,divisionId:divisionFor(s.projectId),projectName:projects.get(s.projectId)?.name??'Unallocated project',exclusion};
 });
 const total=(rows:typeof sources,kind:PnlSource['kind'])=>rows.filter(s=>!s.exclusion&&s.kind===kind).reduce((n,s)=>n+cents(s.amount),0)/100;
 const summarise=(rows:typeof sources)=>{
  const revenue=i.revenueAvailable?total(rows,'invoice'):null,directCosts=i.costsAvailable?total(rows,'cost'):null;
  // The current cost source has no reliable GST basis. Even a zero recorded cost
  // does not establish comparable coverage; do not infer profit from these sums.
  return {revenue,directCosts,grossProfit:null,grossMarginPct:null,overheads:null,netResult:null};
 };
 const divisions=[...i.divisions,{id:'unallocated',name:'Unallocated',code:'—'}].filter(d=>selected(d.id)).map(d=>({...d,...summarise(sources.filter(s=>s.divisionId===d.id))}));
 const jobs=i.projects.filter(p=>selected(divisionFor(p.id))).map(p=>({...p,divisionId:divisionFor(p.id),periodCosts:total(sources.filter(s=>s.projectId===p.id),'cost')}));
 return {period:{start:i.start,end:i.end},divisionId:i.divisionId,divisions,totals:summarise(sources),sources,projects:jobs,taxBasis:{revenue:'ex_gst' as const,directCosts:'unknown' as const},profitability:{available:false,reason:'Gross profit and margin are unavailable: invoice revenue excludes GST, but the GST basis of recorded costs is unknown. No tax adjustment or comparable cost basis is assumed.'},reconciliation:'not_reconciled' as const,accountingActuals:null,allocation:{basis:null,amount:null,status:'No shared overhead source or approved productive-hours / project-duration basis'},eliminations:{amount:null,status:'Internal-charge counterparties and matching pairs are not recorded; no eliminations applied'}};
}
export type DivisionalPnl=ReturnType<typeof buildDivisionalPnl>;
