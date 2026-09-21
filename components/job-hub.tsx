'use client';
import {useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {IMSWorkspace} from '@/components/ims-workspace';
import type {NavLabel} from '@/components/operations-workspace';

type Row={id:string;name:string;status:string;created_at?:string;work_date?:string;amount?:number;metadata?:Record<string,unknown>};
type Data={jobs:Row[];job?:Row;shifts?:Row[];dockets?:Row[];variations?:Row[];claims?:Row[];documents?:Row[];activity?:Row[];blockers?:string[]};

const tabs=['Overview','Setup','Delivery','Quality & HSEQ','Commercial','Documents','Closeout'] as const;
type Tab=(typeof tabs)[number];

function RecordList({rows,empty}:{rows:Row[]|undefined;empty:string}){
 if(!rows?.length)return <p className="rounded border border-dashed bg-white p-4 text-sm text-slate-500">{empty}</p>;
 return <div className="space-y-2">{rows.map(r=><article key={r.id} className="rounded border bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium">{r.name}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{r.status}</span></div>{(r.work_date||r.created_at)&&<p className="mt-1 text-xs text-slate-500">{r.work_date||r.created_at}</p>}</article>)}</div>;
}

export function JobHub({onNavigate}:{onNavigate:(label:NavLabel)=>void}){
 const [jobId,setJobId]=useState('');
 const [tab,setTab]=useState<Tab>('Overview');
 const [data,setData]=useState<Data|null>(null);
 const [error,setError]=useState('');

 useEffect(()=>{try{const saved=window.localStorage.getItem('infrastruct.project');if(saved)queueMicrotask(()=>setJobId(saved));}catch{}},[]);
 useEffect(()=>{try{if(jobId)window.localStorage.setItem('infrastruct.project',jobId);else window.localStorage.removeItem('infrastruct.project');}catch{}},[jobId]);
 useEffect(()=>{let live=true;fetch('/api/job-hub?jobId='+encodeURIComponent(jobId),{cache:'no-store'}).then(async r=>{const d=await r.json() as Data&{error?:string};if(!r.ok)throw new Error(d.error||'Project could not be loaded');if(live){setData(d);setError('');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));});return()=>{live=false;};},[jobId]);

 const nextAction=useMemo(()=>{
  if(!jobId)return 'Choose an awarded project';
  if(data?.blockers?.length)return 'Resolve '+data.blockers.length+' pre-commencement blocker'+(data.blockers.length===1?'':'s');
  if(!data?.shifts?.length)return 'Plan the first delivery shift';
  if(data?.variations?.some(v=>['Draft','Potential','Notice Required'].includes(v.status)))return 'Review open potential variation';
  if(!data?.claims?.length)return 'Review completed work for claim';
  return 'Review current delivery and commercial position';
 },[jobId,data]);

 return <section className="space-y-5">
  <div className="flex flex-wrap items-end justify-between gap-4">
   <div><p className="text-sm font-medium text-slate-500">Projects</p><h1 className="text-2xl font-bold">Project Workspace</h1><p className="mt-1 text-sm text-slate-600">One authoritative home for setup, delivery, HSEQ, commercial control, documents and closeout.</p></div>
   <NativeSelect aria-label="Project workspace project" value={jobId} onChange={e=>{setJobId(e.target.value);setTab('Overview');}}><NativeSelectOption value="">Choose an awarded project</NativeSelectOption>{data?.jobs.map(j=><NativeSelectOption key={j.id} value={j.id}>{j.name}</NativeSelectOption>)}</NativeSelect>
  </div>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {!jobId?<div className="rounded-xl border border-dashed bg-white p-6"><h2 className="font-semibold">Choose a project to begin</h2><p className="mt-1 text-sm text-slate-600">Select an awarded project to view its tender baseline, readiness, delivery records, commercial position and closeout evidence in one place.</p></div>:data?.job&&<>
   <section className="rounded-xl border bg-[#101a24] p-5 text-white">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-orange-300">Project</p><h2 className="mt-1 text-2xl font-bold">{data.job.name}</h2><p className="mt-1 text-sm text-slate-300">{String(data.job.metadata?.client||'Client not recorded')} · {String(data.job.metadata?.site||'Site not recorded')} · {data.job.status}</p></div><div className="max-w-md rounded-lg bg-white/10 p-3"><p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Next action</p><p className="mt-1 font-semibold">{nextAction}</p></div></div>
   </section>
   <nav aria-label="Project workspace" className="flex gap-2 overflow-x-auto border-b pb-3">{tabs.map(t=><Button key={t} className="shrink-0" variant={tab===t?'default':'outline'} onClick={()=>setTab(t)}>{t}</Button>)}</nav>

   {tab==='Overview'&&<div className="grid gap-4 lg:grid-cols-3">
    <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Readiness</p><p className="mt-2 text-2xl font-bold">{data.blockers?.length?(data.blockers.length+' blocker'+(data.blockers.length===1?'':'s')):'Ready / verify current approvals'}</p><Button className="mt-3" variant="outline" onClick={()=>setTab('Setup')}>Open setup</Button></article>
    <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Delivery</p><p className="mt-2 text-2xl font-bold">{data.shifts?.length||0} shifts</p><p className="mt-1 text-sm text-slate-500">{data.dockets?.length||0} linked dockets</p><Button className="mt-3" variant="outline" onClick={()=>setTab('Delivery')}>Open delivery</Button></article>
    <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Commercial</p><p className="mt-2 text-2xl font-bold">{data.variations?.length||0} variations</p><p className="mt-1 text-sm text-slate-500">{data.claims?.length||0} claims</p><Button className="mt-3" variant="outline" onClick={()=>setTab('Commercial')}>Open commercial</Button></article>
    <article className="rounded-xl border bg-white p-4 lg:col-span-3"><h3 className="font-semibold">Current blockers / attention</h3>{data.blockers?.length?<ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{data.blockers.map(x=><li key={x}>{x}</li>)}</ul>:<p className="mt-2 text-sm text-slate-600">No mandatory IMS blockers are currently reported. Confirm resources, permits and current approved documents before dispatch.</p>}</article>
   </div>}

   {tab==='Setup'&&<div className="grid gap-4 lg:grid-cols-2">
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Tender handover & approved baseline</h3><p className="mt-1 text-sm text-slate-500">The awarded estimate remains the commercial baseline for the project.</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{JSON.stringify(data.job.metadata?.approvedBudget||{},null,2)}</pre></section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Pre-commencement</h3>{data.blockers?.length?<ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{data.blockers.map(x=><li key={x}>{x}</li>)}</ul>:<p className="mt-3 text-sm text-slate-600">Mandatory IMS evidence is complete in the current readiness check.</p>}<Button className="mt-4" onClick={()=>setTab('Quality & HSEQ')}>Review IMS / HSEQ evidence</Button></section>
   </div>}

   {tab==='Delivery'&&<div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button onClick={()=>onNavigate('Planning')}>Schedule / shifts</Button><Button variant="outline" onClick={()=>onNavigate('Field')}>Open field workspace</Button><Button variant="outline" onClick={()=>onNavigate('Dockets')}>Review dockets</Button></div>
    <section><h3 className="mb-2 font-semibold">Shifts & programme activity</h3><RecordList rows={data.shifts} empty="No shifts are linked yet. Plan the first shift from Operations → Schedule."/></section>
    <section><h3 className="mb-2 font-semibold">Delivery dockets</h3><RecordList rows={data.dockets} empty="No delivery dockets are linked to this project yet."/></section>
   </div>}

   {tab==='Quality & HSEQ'&&<IMSWorkspace key={jobId} jobId={jobId} onNavigate={label=>onNavigate(label as NavLabel)}/>}

   {tab==='Commercial'&&<div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4"><div><h3 className="font-semibold">Project commercial control</h3><p className="text-sm text-slate-500">Budget, cost, variations, forecast and claims remain in the shared commercial engine.</p></div><Button onClick={()=>onNavigate('Commercial')}>Open full commercial workspace</Button></div>
    <div className="grid gap-4 lg:grid-cols-2"><section><h3 className="mb-2 font-semibold">Variations</h3><RecordList rows={data.variations} empty="No project variations have been recorded."/></section><section><h3 className="mb-2 font-semibold">Claims</h3><RecordList rows={data.claims} empty="No project claims have been recorded."/></section></div>
   </div>}

   {tab==='Documents'&&<RecordList rows={data.documents} empty="No linked project documents are available yet. Use project setup and IMS workflows to add controlled evidence."/>}

   {tab==='Closeout'&&<div className="space-y-4"><section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Closeout controls</h3><p className="mt-1 text-sm text-slate-600">Use this area as the authoritative closeout path for defects, QA completion, handover evidence, DLP and final account. Existing project history is shown below while deeper closeout controls are developed.</p></section><RecordList rows={data.activity} empty="No project closeout/activity history has been recorded yet."/></div>}
  </>}
 </section>;
}
