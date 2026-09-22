'use client';
import {useEffect,useEffectEvent,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {InvoiceScanner} from '@/components/invoice-scanner';
import {belongsToJob} from '@/lib/commercial-links';

type Job={id:string;name:string;client:string;baseline:Record<string,number>;current:Record<string,number>;metrics:Record<string,number>;categories:Record<string,number>;alerts:string[]};
type Variation={id:string;name:string;status:string;metadata:Record<string,unknown>};
type Section='Overview'|'Budget & Costs'|'Variations'|'Delay / EOT'|'Forecast'|'Claims'|'Invoices';

const sections:Section[]=['Overview','Budget & Costs','Variations','Delay / EOT','Forecast','Claims','Invoices'];
const n=(v:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(v||0);
const pct=(v:number)=>`${(v||0).toFixed(1)}%`;

function Metrics({job,forecast=false}:{job:Job;forecast?:boolean}){
 const rows=forecast?[
  ['Original contract / quoted revenue',n(job.baseline.revenue)],
  ['Forecast final revenue',n(job.current.forecastRevenue)],
  ['Approved budget cost',n(job.baseline.cost)],
  ['Forecast final cost',n(job.current.forecastCost)],
  ['Forecast profit',n(job.current.profit)],
  ['Tender margin',pct(job.baseline.margin)],
  ['Forecast margin',pct(job.current.margin)],
  ['Margin movement',pct(job.current.margin-job.baseline.margin)+' pts'],
 ]:[
  ['Original contract value',n(job.baseline.revenue)],
  ['Approved variations',n(job.current.approvedVariations||0)],
  ['Pending / unapproved variations',n(job.current.unapprovedVariations)],
  ['Forecast revenue',n(job.current.forecastRevenue)],
  ['Original budget',n(job.baseline.cost)],
  ['Committed',n(job.current.committed)],
  ['Actual',n(job.current.actual)],
  ['Accrued',n(job.current.accrued||0)],
  ['Forecast final cost',n(job.current.forecastCost)],
  ['Forecast profit',n(job.current.profit)],
  ['Forecast margin',pct(job.current.margin)],
  ['Unbilled completed work',n(job.current.unbilled)],
 ];
 return <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([label,value])=><article className="rounded-xl border bg-white p-4" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></article>)}</section>;
}

export function CommercialWorkspace(){
 const [jobs,setJobs]=useState<Job[]>([]);
 const [claimable,setClaimable]=useState<{id:string;workDate:string;links:Record<string,unknown>;project:string;client:string}[]>([]);
 const [vars,setVars]=useState<Variation[]>([]);
 const [selected,setSelected]=useState('');
 const [section,setSection]=useState<Section>('Overview');
 const [loading,setLoading]=useState(true);
 const [message,setMessage]=useState('Loading commercial controls…');
 const [form,setForm]=useState<Record<string,string>>({status:'Draft'});
 const [claimPeriod,setClaimPeriod]=useState(new Date().toISOString().slice(0,7));

 const load=()=>fetch('/api/commercial',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Load failed');return r.json() as Promise<{jobs:Job[];variations:Variation[];claimable:{id:string;workDate:string;links:Record<string,unknown>;project:string;client:string}[]}>;}).then(d=>{
  setJobs(d.jobs||[]);setVars(d.variations||[]);setClaimable(d.claimable||[]);
  if(!selected&&d.jobs?.[0]){
   let preferred='';
   try{preferred=window.localStorage.getItem('infrastruct.project')||'';}catch{}
   setSelected(d.jobs.some(job=>job.id===preferred)?preferred:d.jobs[0].id);
  }
  setMessage('');
 }).catch(()=>setMessage('Commercial data could not be loaded.')).finally(()=>setLoading(false));
 const refreshEvent=useEffectEvent(load);
 useEffect(()=>{void refreshEvent();},[]);
 const job=jobs.find(j=>j.id===selected)||jobs[0];
 const eligible=claimable.filter(x=>job&&belongsToJob(x,job as unknown as Record<string,unknown>)&&String(x.workDate||'').startsWith(claimPeriod));

 async function variation(){
  const r=await fetch('/api/commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'variation',...form,jobId:job?.id})});
  const d=await r.json() as {error?:string};
  setMessage(r.ok?'Variation added to register':d.error||'Variation failed');
  if(r.ok){setForm({status:'Draft'});void load();}
 }
 function exportCsv(){
  if(!job)return;
  const rows=[['Job','Metric','Value'],[job.name,'Original quoted revenue',String(job.baseline.revenue)],[job.name,'Approved cost',String(job.baseline.cost)],[job.name,'Recorded cost forecast',String(job.current.forecastCost)],[job.name,'Indicative margin',pct(job.current.margin)],...Object.entries(job.categories).map(([k,v])=>[job.name,k,String(v)])];
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'}));a.download=`commercial-${job.name.replace(/[^a-z0-9]+/gi,'-')}.csv`;a.click();
 }

 if(loading)return <p className="rounded-xl border bg-white p-8">{message}</p>;
 return <div className="space-y-5">
  <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">Commercial</p><h2 className="text-2xl font-bold">Project commercial control</h2><p className="mt-1 text-sm text-slate-500">Budget, cost, forecast, variations, claims and invoices in one project context.</p></div><div className="flex flex-wrap gap-2"><NativeSelect aria-label="Commercial project" value={job?.id||''} onChange={e=>{setSelected(e.target.value);try{window.localStorage.setItem('infrastruct.project',e.target.value);}catch{}}}>{jobs.map(j=><NativeSelectOption key={j.id} value={j.id}>{j.name} · {j.client}</NativeSelectOption>)}</NativeSelect><Button variant="outline" disabled={!job} onClick={exportCsv}>Export financial summary</Button></div></div>
  {job&&<p className="text-sm text-slate-500">Projects › {job.name} › Commercial › {section}</p>}
  <nav aria-label="Commercial workspace sections" className="flex gap-2 overflow-x-auto border-b pb-3">{sections.map(item=><Button key={item} className="shrink-0" variant={section===item?'default':'outline'} onClick={()=>setSection(item)}>{item}</Button>)}</nav>
  {message&&<p className="whitespace-pre-line rounded border bg-white p-3 text-sm">{message}</p>}
  {!job?<p className="rounded-xl border border-dashed bg-white p-6">No awarded projects are available. Award an estimate to establish a project commercial baseline.</p>:<>
   {section==='Overview'&&<><Metrics job={job}/>{job.alerts.length>0&&<section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h3 className="font-semibold text-amber-900">Commercial attention</h3><ul className="mt-2 list-disc pl-5 text-sm">{job.alerts.map(a=><li key={a}>{a}</li>)}</ul></section>}<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Current position</h3><p className="mt-2 text-sm text-slate-600">Claimed {n(job.current.claimed)} · invoiced {n(job.current.invoiced)} · contract value not yet claimed {n(Math.max(0,job.current.forecastRevenue-job.current.claimed))}.</p></section></>}
   {section==='Budget & Costs'&&<div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Planned quantities and delivery records</h3><div className="mt-3 space-y-2">{[['Tonnes',job.metrics.tonnes],['Area (m²)',job.metrics.area],['Shifts',job.metrics.shifts],['Dockets',job.metrics.dockets]].map(([k,v])=><div className="flex justify-between border-b py-2" key={k}><span>{k}</span><strong>{Number(v).toFixed(1)}</strong></div>)}</div></section><section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Cost breakdown</h3>{Object.entries(job.categories).map(([k,v])=><div className="flex justify-between border-b py-2 text-sm" key={k}><span>{k}</span><strong>{n(v)}</strong></div>)}{!Object.keys(job.categories).length&&<p className="mt-3 text-sm text-slate-500">No matched actual cost records yet.</p>}</section></div>}
   {section==='Variations'&&<section className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Create / price variation</h3><p className="mt-1 text-sm text-slate-500">Field variation events should be reviewed here before becoming submitted commercial records.</p><div className="mt-3 grid gap-3"><Input placeholder="Description" value={form.description||''} onChange={e=>setForm({...form,description:e.target.value})}/><Input placeholder="Cause / client instruction / date / shift" value={form.details||''} onChange={e=>setForm({...form,details:e.target.value})}/><Input placeholder="Submitted value" type="number" value={form.submittedValue||''} onChange={e=>setForm({...form,submittedValue:e.target.value})}/><Input placeholder="Approved value" type="number" value={form.approvedValue||''} onChange={e=>setForm({...form,approvedValue:e.target.value})}/><Textarea placeholder="Labour, plant, materials, subcontractors, photos and documents" value={form.effects||''} onChange={e=>setForm({...form,effects:e.target.value})}/><Button onClick={()=>void variation()}>Add variation</Button></div></div><div className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Variation register</h3><div className="mt-4 space-y-2">{vars.filter(v=>v.metadata.jobId===job.id).map(v=><div className="rounded border p-3 text-sm" key={v.id}><strong>{v.name}</strong><p>{v.status} · submitted {n(Number(v.metadata.submittedValue||0))}</p></div>)}{!vars.some(v=>v.metadata.jobId===job.id)&&<p className="text-sm text-slate-500">No variations recorded for this project.</p>}</div></div></section>}
   {section==='Delay / EOT'&&<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Delay / EOT administration</h3><p className="mt-2 text-sm text-slate-600">Delay and stand-down evidence is currently captured in Field shift records. A dedicated contractual notice/EOT engine is not yet implemented, so this screen does not create unsupported contractual records. Use the field evidence and variation workflow until that engine is added.</p></section>}
   {section==='Forecast'&&<><Metrics job={job} forecast/>{job.alerts.length>0&&<section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h3 className="font-semibold text-amber-900">Margin movement alerts</h3><ul className="mt-2 list-disc pl-5 text-sm">{job.alerts.map(a=><li key={a}>{a}</li>)}</ul></section>}<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Forecast basis</h3><p className="mt-2 text-sm text-slate-600">Forecast figures are based on the project baseline plus current committed/actual commercial records. Tender margin {pct(job.baseline.margin)} versus current forecast {pct(job.current.margin)}.</p></section></>}
   {section==='Claims'&&<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Progress claims</h3><div className="mt-4 max-w-sm"><Input type="month" value={claimPeriod} onChange={e=>setClaimPeriod(e.target.value)}/></div><p className="mt-2 text-sm text-slate-500">Approved dockets flow into a claim once; included or invoiced records cannot be claimed twice.</p><Button className="mt-3" variant="outline" disabled={!eligible.length} onClick={async()=>{const r=await fetch('/api/commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim',jobId:job.id,claimPeriod,docketIds:eligible.map(x=>x.id)})});const d=await r.json() as {error?:string;claimed?:number};setMessage(r.ok?`Draft claim prepared for ${d.claimed} docket(s) in ${claimPeriod}.`:(d.error||'Claim failed'));if(r.ok)void load();}}>Prepare draft claim ({eligible.length} eligible)</Button><div className="mt-5 grid gap-3 sm:grid-cols-3"><article className="rounded border p-3"><p className="text-xs text-slate-500">Claimed</p><p className="mt-1 text-lg font-bold">{n(job.current.claimed)}</p></article><article className="rounded border p-3"><p className="text-xs text-slate-500">Invoiced</p><p className="mt-1 text-lg font-bold">{n(job.current.invoiced)}</p></article><article className="rounded border p-3"><p className="text-xs text-slate-500">Unbilled</p><p className="mt-1 text-lg font-bold">{n(job.current.unbilled)}</p></article></div></section>}
   {section==='Invoices'&&<section className="rounded-xl border bg-white p-5"><h3 className="font-semibold">Invoices & cost capture</h3><p className="mt-1 mb-4 text-sm text-slate-500">Invoice scanning supports the cost workflow; it does not replace the project budget, forecast or claim controls.</p><InvoiceScanner/></section>}
  </>}
 </div>;
}
