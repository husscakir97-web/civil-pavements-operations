'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { ReportSummary } from '@/lib/reporting';
export function useLiveReport() {
 const [summary,setSummary]=useState<ReportSummary|null>(null),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 const reload=useCallback(async()=>{
  if(document.hidden||pending.current)return;
  const abort=new AbortController();pending.current=abort;
  try{
   const r=await fetch('/api/reports?summary=1',{cache:'no-store',signal:abort.signal});
   if(!r.ok){if(r.status===401||r.status===403)setSummary(null);throw new Error('Reports could not be loaded. Please retry.');}
   const p=await r.json() as {summary:ReportSummary};
   if(!abort.signal.aborted){setSummary(previous=>JSON.stringify(previous)===JSON.stringify(p.summary)?previous:p.summary);setError('');}
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Reports unavailable');}
  finally{if(pending.current===abort)pending.current=null;}
 },[]);

 useEffect(()=>{
  let active=true;queueMicrotask(()=>{if(active)void reload();});
  const refresh=()=>void reload();
  const changed=()=>{pending.current?.abort();pending.current=null;void reload();};
  const visibility=()=>{if(document.hidden){pending.current?.abort();pending.current=null;}else refresh();};
  const id=setInterval(refresh,15000);
  window.addEventListener('focus',refresh);window.addEventListener('records-changed',changed);document.addEventListener('visibilitychange',visibility);
  return()=>{active=false;pending.current?.abort();pending.current=null;clearInterval(id);window.removeEventListener('focus',refresh);window.removeEventListener('records-changed',changed);document.removeEventListener('visibilitychange',visibility);};
 },[reload]);
 return {summary,error,reload};
}
const moneyFormat=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0});
const money=(v:number)=>moneyFormat.format(v);
export function LiveReport({summary,error,reload,overview=false}:{summary:ReportSummary|null;error:string;reload:()=>unknown;overview?:boolean}) {
 const cards=summary?(overview?[
 ['Open opportunities',summary.openOpportunities],['Upcoming shifts',summary.upcomingShifts],['Dockets needing review',summary.reviewCount],['Unapproved variations',summary.unapprovedVariations],['Weighted pipeline',money(summary.forecastRevenue)],['Unbilled docket value',money(summary.unbilledValue)]
 ]:[['Opportunities',summary.counts.opportunities],['Estimates',summary.counts.estimates],['Jobs',summary.counts.jobs],['Shifts',summary.counts.shifts],['Field records',summary.counts.field_records],['Submitted field records',summary.completedFields],['Dockets',summary.counts.dockets],['Dockets needing review',summary.reviewCount],['Commercial records',summary.counts.commercial_records],['Workers',summary.counts.workers],['Workers with expired documents',summary.expiredWorkers],['Plant',summary.counts.plant],['Plant unavailable / overdue',summary.unavailablePlant],['QA & safety records',summary.counts.qa_safety_records],['Open QA & safety',summary.openQA],['Pipeline value',money(summary.pipelineValue)],['Weighted pipeline',money(summary.forecastRevenue)],['Job contract value',money(summary.securedRevenue)],['Unapproved variation value',money(summary.unapprovedVariationValue)],['Unbilled docket value',money(summary.unbilledValue)],['Actual tonnes',summary.actualTonnes],['Actual area (m²)',summary.actualArea],['Quote win rate (awarded / decided)',`${summary.quoteWinRate.toFixed(1)}%`]]):[];
 return <div className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className={overview?'text-sm font-semibold text-slate-700':'text-2xl font-semibold tracking-tight'}>{overview?'At a glance':'Reports'}</h2>{!overview&&<p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full'}).format(new Date())} · Company records</p>}</div>
   <RefreshReport reload={reload}/>
  </div>
  {error?<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error} Totals are unavailable.</div>:!summary?<div role="status"><span className="sr-only">Loading saved records…</span><div aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0,1,2,3,4,5].map(i=><div key={i} className="surface h-32 p-5"><div className="h-3 w-24 rounded bg-slate-100"/><div className="mt-5 h-8 w-16 rounded bg-slate-100"/></div>)}</div></div>:<>
   <div className={`grid grid-cols-2 gap-3 ${overview?'sm:grid-cols-3':'xl:grid-cols-4'}`}>
    {cards.map(([label,value])=><article key={label} className={`metric-card surface p-4 sm:p-5 ${label==='Unbilled docket value'?'metric-card-accent':''}`}><p className="min-h-10 text-xs font-medium leading-5 text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p></article>)}
   </div>
   {Object.values(summary.counts).every(n=>n===0)&&<p className="surface border-dashed p-5 text-sm leading-6 text-slate-500">Your workspace is ready. Create an opportunity, plan a shift or upload a docket to see your progress here.</p>}
   <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><h3 className="text-sm font-semibold">Opportunity pipeline</h3><span className="text-xs text-slate-500">{summary.openOpportunities} open</span></div>{summary.pipeline.length?<div className="divide-y px-5">{summary.pipeline.map(p=><div key={p.stage} className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm"><div><span className="font-medium">{p.stage}</span><span className="ml-2 text-xs text-slate-500">{p.count} records</span></div><div className="text-right tabular-nums"><p className="font-medium">{money(p.value)}</p><p className="mt-1 text-xs text-slate-500">{money(p.weighted)} weighted</p></div></div>)}</div>:<div className="px-5 py-8"><p className="text-sm font-medium text-slate-600">No open opportunities yet</p><p className="mt-1 text-xs leading-5 text-slate-500">New opportunities and their expected value will appear here.</p></div>}</section>
   <details className="text-xs leading-5 text-slate-500"><summary className="w-fit cursor-pointer rounded px-1 py-1 hover:text-slate-800">How these totals are calculated</summary><p className="mt-2 px-1">Archived records are excluded. Unbilled value includes matched, ready and approved dockets only. Missing dates and expiry information are not counted as confirmed readiness or compliance.</p></details>
  </>}
 </div>;
}
function RefreshReport({reload}:{reload:()=>unknown}){
 const [busy,setBusy]=useState(false);
 return <button disabled={busy} aria-label="Refresh reports" className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-60" onClick={async()=>{setBusy(true);try{await reload();}finally{setBusy(false);}}}><svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 11.6-3L20 8M4 16l2.9 3A7 7 0 0 0 18.5 16"/></svg>{busy?'Refreshing…':'Refresh'}</button>;
}
export function ReportsWorkspace(){const state=useLiveReport();return <LiveReport {...state}/>;}
