'use client';
// Project programme: what is planned and in what order. Small changes (order,
// dates, duration, status, name) are made in the list; the full form is only
// for detail. Shifts stay in Schedule — this links there, never duplicates them.
import {useState,type FormEvent} from 'react';
import {ArrowDown,ArrowUp,CalendarDays,Copy,Plus} from 'lucide-react';
import {api,useApi,useAction,useSession,PageHeader,Section,ErrorState,Btn,Pill,Field,field as fieldClass} from './kit';
import {useNav} from './nav';
import {addDays,moveActivity,type Activity} from '@/lib/v1/program';
type Row=Activity&{revision:number;start:string;finish:string;delayDays:number;responsible:string;work_package:string;resource_requirement:string;planned_quantity:number;quantity_unit:string;production_per_day:number};
const STATUSES=['planned','in_progress','complete','on_hold'] as const;
const statusLabel=(s:string)=>s==='in_progress'?'In progress':s==='on_hold'?'On hold':s.charAt(0).toUpperCase()+s.slice(1);
const todayText=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
const blank=(start:string)=>({name:'',startDate:start,durationDays:1,predecessorId:null as string|null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:0,quantityUnit:'',productionPerDay:0,status:'planned'});
const cell='min-h-9 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-50';

/** Standalone page: choose a project, then the same panel used in the project workspace. */
export function Program(){
 const [projectId,setProjectId]=useState('');
 const list=useApi<{projects:{id:string;name:string}[]}>('/api/projects/program');
 return <div className="space-y-5"><PageHeader title="Planning & programme" subtitle="Project activities in order. Dependencies move projected dates without changing what you planned."/><ErrorState error={list.error}/>
  <label className="block max-w-md text-sm"><span className="font-medium text-slate-700">Project</span><select className={fieldClass} value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Choose project</option>{list.data?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {projectId&&<ProgrammePanel key={projectId} projectId={projectId}/>}
 </div>;
}

export function ProgrammePanel({projectId}:{projectId:string}){
 const data=useApi<{activities:Row[]}>(`/api/projects/program?projectId=${encodeURIComponent(projectId)}`),action=useAction(),session=useSession(),{navigate}=useNav();
 const writable=session.writable('projects')&&session.can('project.edit');
 const [view,setView]=useState<'Programme'|'Two-week lookahead'|'Timeline'>('Programme'),[editing,setEditing]=useState<Row|null>(null);
 // Optimistic order after a move; dropped as soon as fresh data arrives.
 const [pending,setPending]=useState<{src:unknown;ids:string[]}|null>(null);
 const server=data.data?.activities||[];
 const order=pending&&pending.src===data.data?pending.ids:null;
 const byId=new Map(server.map(a=>[a.id,a]));
 const all=order?order.map(id=>byId.get(id)).filter(Boolean) as Row[]:server;
 const today=todayText(),end=addDays(today,13);
 const rows=view==='Two-week lookahead'?all.filter(a=>a.finish>=today&&a.start<=end&&a.status!=='complete'):all;
 const nextStart=all.length?addDays(all.reduce((m,a)=>a.finish>m?a.finish:m,all[0].finish),1):today;
 const done=()=>data.refresh();
 const quick=(a:Row,changes:Record<string,unknown>)=>void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'update',projectId,id:a.id,revision:a.revision,changes}}),done);
 const move=(id:string,delta:number)=>{const ids=moveActivity(all.map(a=>a.id),id,delta);setPending({src:data.data,ids});void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'reorder',projectId,ids}}),done);};
 const duplicate=(a:Row)=>void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'duplicate',projectId,id:a.id}}),done);
 return <div className="space-y-4">
  <ErrorState error={data.error||action.error} onRetry={data.error?data.refresh:undefined}/>
  <div className="flex flex-wrap items-center gap-2">
   <div role="group" aria-label="Programme view" className="flex flex-wrap gap-2">{(['Programme','Two-week lookahead','Timeline'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)} className={`min-h-9 rounded-full border px-3 text-sm ${view===v?'border-[#172633] bg-[#172633] text-white':'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{v}</button>)}</div>
   {session.can('schedule.view')&&<Btn variant="secondary" className="ml-auto" onClick={()=>navigate('Operations','Schedule',projectId)}><CalendarDays aria-hidden className="size-4"/>{session.can('schedule.edit')?'Plan shifts':'View schedule'}</Btn>}
  </div>
  {writable&&view==='Programme'&&<QuickAdd projectId={projectId} defaultStart={nextStart} onAdded={done}/>}
  <Section title={view}>
   {!rows.length?<p className="text-sm text-slate-500">{view==='Programme'?'No activities yet. Type the first activity above and press Enter.':'No activities in this view.'}</p>:
   <ol className="divide-y">{rows.map((a,i)=><li key={a.id} className="grid gap-2 py-3">
    <div className="flex flex-wrap items-center gap-2">
     <span className="w-7 text-sm tabular-nums text-slate-400">{String(all.indexOf(a)+1).padStart(2,'0')}</span>
     {writable&&view==='Programme'?<input aria-label="Activity name" className={`${cell} min-w-40 flex-1 font-medium`} defaultValue={a.name} key={`n${a.revision}`} onBlur={e=>{const v=e.target.value.trim();if(v&&v!==a.name)quick(a,{name:v});}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}/>:<strong className="min-w-40 flex-1">{a.name}</strong>}
     {a.delayDays>0&&<Pill tone="warning">{a.delayDays} day{a.delayDays===1?'':'s'} late from predecessor</Pill>}
     {a.status!=='complete'&&a.finish<today&&<Pill tone="danger">Overdue</Pill>}
     {writable&&view==='Programme'&&<span className="flex gap-1">
      <Btn variant="ghost" className="min-h-9 px-2" disabled={i===0||action.busy} aria-label={`Move ${a.name} up`} onClick={()=>move(a.id,-1)}><ArrowUp aria-hidden className="size-4"/></Btn>
      <Btn variant="ghost" className="min-h-9 px-2" disabled={i===rows.length-1||action.busy} aria-label={`Move ${a.name} down`} onClick={()=>move(a.id,1)}><ArrowDown aria-hidden className="size-4"/></Btn>
      <Btn variant="ghost" className="min-h-9 px-2" disabled={action.busy} aria-label={`Duplicate ${a.name}`} onClick={()=>duplicate(a)}><Copy aria-hidden className="size-4"/></Btn>
     </span>}
    </div>
    <div className="flex flex-wrap items-center gap-2 pl-9 text-sm">
     {writable&&view==='Programme'?<>
      <label className="flex items-center gap-1"><span className="text-slate-500">Start</span><input type="date" className={cell} defaultValue={a.start_date} key={`s${a.revision}`} onChange={e=>{if(e.target.value&&e.target.value!==a.start_date)quick(a,{startDate:e.target.value});}}/></label>
      <label className="flex items-center gap-1"><span className="text-slate-500">Days</span><input type="number" min={1} className={`${cell} w-20`} defaultValue={a.duration_days} key={`d${a.revision}`} onBlur={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n!==Number(a.duration_days))quick(a,{durationDays:n});}}/></label>
      <label className="flex items-center gap-1"><span className="sr-only">Status</span><select className={cell} value={a.status} onChange={e=>quick(a,{status:e.target.value})}>{STATUSES.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <span className="text-slate-500">Projected {a.start} → {a.finish}</span>
      <Btn variant="ghost" className="min-h-9 px-2 text-sm" onClick={()=>setEditing(a)}>Details</Btn>
     </>:<span className="text-slate-600">{a.start} → {a.finish} · {a.duration_days} day{Number(a.duration_days)===1?'':'s'} · {statusLabel(a.status)} · {a.responsible||'Unassigned'}</span>}
    </div>
    {view==='Timeline'&&<div className="ml-9 flex overflow-hidden rounded bg-slate-100" aria-label={`${a.name}: ${a.start} to ${a.finish}`}>{Array.from({length:14},(_,d)=>addDays(today,d)).map(d=><span key={d} title={d} className={`flex-1 border-r py-2 text-center text-xs ${d>=a.start&&d<=a.finish?'bg-orange-200':'bg-slate-50'}`}>{d.slice(8)}</span>)}</div>}
    {editing?.id===a.id&&<DetailForm projectId={projectId} activity={a} activities={server} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);done();}}/>}
   </li>)}</ol>}
  </Section>
 </div>;
}

/** Name + start + days; Enter adds and keeps focus for the next activity. */
function QuickAdd({projectId,defaultStart,onAdded}:{projectId:string;defaultStart:string;onAdded:()=>void}){
 const [name,setName]=useState(''),[start,setStart]=useState(''),[days,setDays]=useState(1);const {busy,error,run}=useAction();
 const submit=(e:FormEvent)=>{e.preventDefault();if(!name.trim())return;void run(()=>api('/api/projects/program',{method:'POST',body:{...blank(start||defaultStart),name:name.trim(),durationDays:days,projectId}}),()=>{setName('');setStart('');setDays(1);onAdded();});};
 return <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3" aria-label="Add activity">
  <label className="grid min-w-48 flex-1 gap-1 text-sm"><span className="font-medium text-slate-700">New activity</span><input className={fieldClass} placeholder="e.g. Profiling" value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">Start</span><input type="date" className={fieldClass} value={start||defaultStart} onChange={e=>setStart(e.target.value)}/></label>
  <label className="grid w-24 gap-1 text-sm"><span className="font-medium text-slate-700">Days</span><input type="number" min={1} className={fieldClass} value={days} onChange={e=>setDays(Math.max(1,Number(e.target.value)||1))}/></label>
  <Btn type="submit" busy={busy} disabled={!name.trim()}><Plus aria-hidden className="size-4"/>Add</Btn>
  {error&&<p role="alert" className="w-full text-sm text-red-700">{error}</p>}
 </form>;
}

function DetailForm({projectId,activity:a,activities,onClose,onSaved}:{projectId:string;activity:Row;activities:Row[];onClose:()=>void;onSaved:()=>void}){
 const [form,setForm]=useState({name:a.name,startDate:a.start_date,durationDays:Number(a.duration_days),predecessorId:a.predecessor_id,responsible:a.responsible||'',workPackage:a.work_package||'',resourceRequirement:a.resource_requirement||'',plannedQuantity:Number(a.planned_quantity||0),quantityUnit:a.quantity_unit||'',productionPerDay:Number(a.production_per_day||0),status:a.status});
 const {busy,error,run}=useAction();const patch=(k:string,v:unknown)=>setForm(f=>({...f,[k]:v}));
 return <form className="ml-9 grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/projects/program',{method:'POST',body:{...form,projectId,id:a.id,revision:a.revision}}),onSaved);}}>
  {([['responsible','Responsible person','text'],['workPackage','Work package','text'],['resourceRequirement','Crew / plant / subcontractor requirements','text'],['plannedQuantity','Planned quantity','number'],['quantityUnit','Quantity unit','text'],['productionPerDay','Production per day','number']] as const).map(([k,label,type])=><Field key={k} label={label}><input className={fieldClass} type={type} min={0} step={type==='number'?'any':undefined} value={form[k]} onChange={e=>patch(k,type==='number'?Number(e.target.value):e.target.value)}/></Field>)}
  <Field label="Starts after (predecessor)"><select className={fieldClass} value={form.predecessorId||''} onChange={e=>patch('predecessorId',e.target.value||null)}><option value="">None</option>{activities.filter(x=>x.id!==a.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
  {form.productionPerDay>0&&<p className="text-sm text-slate-600 sm:col-span-2">Production assumption: {Math.ceil(form.plannedQuantity/form.productionPerDay)} working days. Confirm the calendar allowance in Days.</p>}
  {error&&<p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
  <div className="flex gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Save details</Btn><Btn type="button" variant="secondary" onClick={onClose}>Close</Btn></div>
 </form>;
}
