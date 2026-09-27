const money = new Intl.NumberFormat('en-AU', {style:'currency',currency:'AUD'});
const number = new Intl.NumberFormat('en-AU', {maximumFractionDigits:2});

export function ApprovedBaseline({value}:{value:unknown}) {
 const budget = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
 const read = (key:string) => typeof budget[key] === 'number' && Number.isFinite(budget[key]) ? budget[key] as number : null;
 const format = (key:string,unit='money') => {const n=read(key);return n===null?'Not recorded':unit==='money'?money.format(n):number.format(n)+unit;};
 if(!Object.keys(budget).some(key=>read(key)!==null))return <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-slate-500">No approved estimate baseline has been recorded for this project yet.</p>;
 const costs = [['materialCost','Materials'],['tackCoatCost','Tack coat'],['profilingCost','Profiling'],['cartageCost','Cartage'],['labourCost','Labour'],['plantCost','Plant'],['trafficCost','Traffic control'],['mobilisationCost','Mobilisation'],['allowancesCost','Allowances'],['subcontractorCost','Subcontractors'],['directCost','Direct cost subtotal'],['overheadCost','Overheads'],['contingencyCost','Contingency']];
 return <div className="mt-4 space-y-5">
  <dl className="grid gap-3 sm:grid-cols-2">{[['sellRate','Approved price · ex GST'],['totalCost','Budgeted cost'],['grossProfit','Gross profit'],['grossMargin','Gross margin']].map(([key,label])=><div key={key} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{format(key,key==='grossMargin'?'%':'money')}</dd></div>)}</dl>
  <div><h4 className="text-sm font-semibold">Planned quantities</h4><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">{[['effectiveAreaM2','Area',' m²'],['rawTonnes','Tonnes before waste',' t'],['totalTonnes','Tonnes including waste',' t'],['estimatedShifts','Shifts',''],['requiredTrips','Truck trips','']].map(([key,label,unit])=><div key={key}><dt className="text-slate-500">{label}</dt><dd className="font-medium tabular-nums">{format(key,unit)}</dd></div>)}</dl></div>
  <details className="rounded-lg border"><summary className="cursor-pointer px-3 py-3 text-sm font-medium">Cost breakdown & rates</summary><dl className="divide-y border-t px-3 text-sm">{[...costs,['totalCost','Total budgeted cost'],['costPerTonne','Cost per tonne'],['costPerM2','Cost per m²'],['sellRatePerTonne','Sell rate per tonne'],['sellRatePerM2','Sell rate per m²'],['gstAmount','GST'],['totalQuoteValue','Quote total · including GST']].filter(([key])=>read(key)!==null).map(([key,label])=><div key={key} className="flex flex-wrap justify-between gap-2 py-2"><dt className="text-slate-600">{label}</dt><dd className="font-medium tabular-nums">{format(key)}</dd></div>)}</dl></details>
  <p className="text-xs text-slate-500">Saved at award. These figures preserve the approved estimate and its historical rates.</p>
 </div>;
}
