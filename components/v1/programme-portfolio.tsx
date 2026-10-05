'use client';
import {useEffect,useState} from 'react';
import type {ProgrammePortfolio} from '@/lib/seams/programme-portfolio';
import {addDays} from '@/lib/v1/program';
import {Btn,ErrorState,field} from './kit';
import {useNav} from './nav';

export function ProgrammePortfolioView(){
 const {route,navigate}=useNav();
 // Store the window and division in the existing hash route for back/forward.
 const start=route.tab||'',division=route.focus||'';
 const url=`/api/projects/program/portfolio?${new URLSearchParams({...start?{start}:{},...division?{divisionId:division}:{}})}`;
 const [result,setResult]=useState<{url:string;data?:ProgrammePortfolio;error?:string}>(),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(url,{signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Programme could not be loaded. Please retry.');return r.json() as Promise<ProgrammePortfolio>;}).then(data=>{if(!controller.signal.aborted)setResult({url,data});}).catch(e=>{if(!controller.signal.aborted)setResult({url,error:e instanceof Error?e.message:'Programme could not be loaded.'});});
  return()=>controller.abort();
 },[url,retry]);
 const current=result?.url===url?result:undefined,data=current?.data;
 const change=(date:string,unit:string)=>navigate('Projects','Programme',undefined,date||undefined,unit||undefined);
 return <div className="space-y-4">
  <p className="text-sm text-slate-600">Read-only, 14 calendar days. Activities and operational shifts are separate plans; shifts do not establish activity completion.</p>
  <div className="flex flex-wrap items-end gap-3">
   <label className="text-sm">Window starts<input aria-label="Window starts" type="date" className={field} value={start||data?.start||''} onChange={e=>change(e.target.value,division)}/></label>
   <label className="text-sm">Division<select aria-label="Division" className={field} value={division} onChange={e=>change(start,e.target.value)}><option value="">All accessible divisions</option>{data?.divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}{division&&!data?.divisions.some(d=>d.id===division)&&<option value={division}>Selected division</option>}</select></label>
   <Btn variant="secondary" disabled={!data} onClick={()=>data&&change(addDays(data.start,-14),division)}>Previous two weeks</Btn>
   <Btn variant="secondary" onClick={()=>change('',division)}>Today</Btn>
   <Btn variant="secondary" disabled={!data} onClick={()=>data&&change(addDays(data.start,14),division)}>Next two weeks</Btn>
  </div>
  <ErrorState error={current?.error||null} onRetry={()=>{setResult(undefined);setRetry(n=>n+1);}}/>
  {!current&&<p role="status">Loading programme…</p>}
  {data&&<>
   <p className="text-sm">{data.start} – {data.end} · {data.counts.projects} projects · {data.counts.activities} activities · {data.counts.shifts===null?'Operational shifts unavailable':`${data.counts.shifts} dated shifts`}</p>
   <p className="rounded-lg bg-slate-100 p-3 text-sm">Conflict coverage: {data.coverage}. {data.operations?'Draft bookings remain tentative. Checks cover worker and plant semantics; no supplier capacity or crew expansion is assumed.':'Activities only: operational entitlement and schedule permission are required for shifts and conflicts.'}</p>
   {!data.projects.length&&<p>No accessible projects match this view.</p>}
   {data.divisions.map(d=>{const projects=data.projects.filter(p=>p.divisionId===d.id);return projects.length>0&&<section key={d.id} aria-label={d.name} className="space-y-3"><h2 className="text-lg font-semibold">{d.name}</h2>{projects.map(p=><article key={p.id} className="min-w-0 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{p.name}</h3><Btn variant="secondary" onClick={()=>navigate('Projects',undefined,p.id,'programme')}>Open project programme</Btn></div>
    {p.programmeIssue&&<p role="alert">Programme dependencies or dates need review in the project.</p>}
    <h4 className="mt-3 font-medium">Programme activities</h4>
    {!p.activities.length&&<p className="text-sm text-slate-500">No activities in this window.</p>}
    <ul className="divide-y">{p.activities.map(a=><li key={a.id} className="py-2 text-sm"><strong>{a.name}</strong><span className="block">{a.start} – {a.finish} · {a.status.replaceAll('_',' ')} · {a.responsibleName||'Unallocated responsible person'}</span></li>)}</ul>
    {p.overdue.length>0&&<details className="mt-3"><summary>Overdue incomplete activities ({p.overdue.length})</summary><ul>{p.overdue.map(a=><li key={a.id} className="py-1 text-sm">{a.name} · due {a.finish}</li>)}</ul></details>}
    {p.shifts!==null&&<>
     <h4 className="mt-4 font-medium">Operational shifts</h4>
     {p.noShiftsMessage&&<p className="text-sm">{p.noShiftsMessage}</p>}
     {!p.shifts.length&&!p.noShiftsMessage&&<p className="text-sm text-slate-500">No shifts in this window.</p>}
     <ul className="divide-y">{p.shifts.filter(s=>s.date).map(s=><ShiftRow key={s.id} shift={s}/>)}</ul>
     <details className="mt-3"><summary>Review queues</summary>{([
      ['Draft',p.shifts.filter(s=>s.status==='Draft')],
      ['Unallocated resources',p.shifts.filter(s=>s.assignmentCount===0)],
      ['Requirement shortage',p.shifts.filter(s=>s.shortage!==null&&s.shortage>0)],
      ['Requirements not recorded or invalid',p.shifts.filter(s=>s.shortage===null)],
      ['Undated or invalid shift dates/times',p.shifts.filter(s=>!s.date)],
     ] as const).map(([label,rows])=><div key={label} className="mt-2"><h5 className="text-sm font-medium">{label} ({rows.length})</h5><ul>{rows.map(s=><ShiftRow key={s.id} shift={s}/>)}</ul></div>)}</details>
    </>}
   </article>)}</section>;})}
  </>}
 </div>;
}
type Shift=NonNullable<ProgrammePortfolio['projects'][number]['shifts']>[number];
function ShiftRow({shift:s}:{shift:Shift}){
 return <li className="py-2 text-sm"><strong>{s.name}</strong><span className="block">{s.date?`${s.date} ${s.start}–${s.finish}`:'Date/time needs review'} · {s.status} · {s.assignmentCount} assigned resources · {s.shortage===null?'Requirements not recorded or invalid':`${s.shortage} missing requirement slots`}</span>{s.issues.length>0&&<details><summary>Read-only conflict details ({s.issues.length} issue types)</summary><ul>{s.issues.map(i=><li key={`${i.code}:${i.severity}`}>{i.severity==='warn'?'Warning':'Block'}: {i.code.toLowerCase().replaceAll('_',' ')}</li>)}</ul></details>}</li>;
}
