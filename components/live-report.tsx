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
const money=(v:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(v);
export function LiveReport({summary,error,reload,overview=false}:{summary:ReportSummary|null;error:string;reload:()=>unknown;overview?:boolean}) {
 const cards=summary?(overview?[
 ['Open opportunities',summary.openOpportunities],['Upcoming shifts',summary.upcomingShifts],['Dockets needing review',summary.reviewCount],['Unapproved variations',summary.unapprovedVariations],['Weighted pipeline',money(summary.forecastRevenue)],['Unbilled docket value',money(summary.unbilledValue)]
 ]:[['Opportunities',summary.counts.opportunities],['Estimates',summary.counts.estimates],['Jobs',summary.counts.jobs],['Shifts',summary.counts.shifts],['Field records',summary.counts.field_records],['Submitted field records',summary.completedFields],['Dockets',summary.counts.dockets],['Dockets needing review',summary.reviewCount],['Commercial records',summary.counts.commercial_records],['Workers',summary.counts.workers],['Workers with expired documents',summary.expiredWorkers],['Plant',summary.counts.plant],['Plant unavailable / overdue',summary.unavailablePlant],['QA & safety records',summary.counts.qa_safety_records],['Open QA & safety',summary.openQA],['Pipeline value',money(summary.pipelineValue)],['Weighted pipeline',money(summary.forecastRevenue)],['Job contract value',money(summary.securedRevenue)],['Unapproved variation value',money(summary.unapprovedVariationValue)],['Unbilled docket value',money(summary.unbilledValue)],['Actual tonnes',summary.actualTonnes],['Actual area (m²)',summary.actualArea],['Quote win rate (awarded / decided)',`${summary.quoteWinRate.toFixed(1)}%`]]):[];
 return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">{overview?'Operations overview':'Reports'}</h2><p className="text-sm text-slate-500">{new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full'}).format(new Date())} · Saved organisation records</p></div><button className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={()=>void reload()}>Refresh</button></div>{error?<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5">{error} Totals are unavailable.</div>:!summary?<p role="status" className="rounded-xl border bg-white p-8">Loading saved records…</p>:<><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label,value])=><article key={label} className="rounded-xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></article>)}</div>{Object.values(summary.counts).every(n=>n===0)&&<p className="rounded-xl border border-dashed bg-white p-6">No records yet. Create an opportunity, plan a shift or upload a docket to populate these totals.</p>}<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Open opportunity pipeline</h3>{summary.pipeline.length?summary.pipeline.map(p=><div key={p.stage} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"><span>{p.stage} · {p.count} records</span><span>{money(p.value)} · {money(p.weighted)} weighted</span></div>):<p className="mt-3 text-sm text-slate-500">No open opportunities recorded.</p>}</section><p className="text-sm text-slate-500">Archived records are excluded. Unbilled value includes matched, ready and approved dockets only. Missing dates and expiry information are not counted as confirmed readiness or compliance.</p></>}</div>;
}
export function ReportsWorkspace(){const state=useLiveReport();return <LiveReport {...state}/>;}
