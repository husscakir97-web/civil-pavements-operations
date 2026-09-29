'use client';
import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,Search,TriangleAlert,UserRoundPlus,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {assignments,type DeliveryRecord} from '@/lib/planning';
import {coverage,type Requirement} from '@/lib/v1/shift-requirements';
import {filterLookup} from '@/lib/v1/lookup';
import {rankResources,type ResourceAvailability} from '@/lib/v1/schedule-board';

const CATEGORIES=[
 {key:'workers',label:'People'},
 {key:'plant',label:'Plant'},
 {key:'crews',label:'Crews'},
 {key:'subcontractors',label:'Subcontractors'},
 {key:'suppliers',label:'Suppliers'},
] as const;
type Category=(typeof CATEGORIES)[number]['key'];
type Conflict={code:string;severity:'block'|'warn';message:string;resourceId?:string};

export function ScheduleResourceRail({shift,data,busy,onAssign,onUnassign}:{shift:DeliveryRecord|null;data:Record<string,DeliveryRecord[]>;busy?:boolean;onAssign:(resource:DeliveryRecord,category:string)=>void|Promise<void>;onUnassign:(resourceId:string)=>void|Promise<void>}){
 const [category,setCategory]=useState<Category>('workers'),[query,setQuery]=useState(''),[checking,setChecking]=useState(false);
 const [availability,setAvailability]=useState<Record<string,ResourceAvailability>>({});
 const list=data[category]||[],assigned=shift?assignments(shift):[];
 const requirements=(shift?.metadata.requirements||[]) as Requirement[];
 const resourceText=(r:DeliveryRecord)=>[r.name,...Object.values(r.metadata).filter(v=>typeof v==='string'||typeof v==='number') as Array<string|number>];
 const resourceIds=(r:DeliveryRecord)=>[r.metadata.plantNumber,r.metadata.rego,r.metadata.registration,r.metadata.employeeNumber] as Array<string|undefined>;
 const filtered=useMemo(()=>filterLookup(list,query,resourceText,resourceIds,r=>r.name),[list,query]);
 const hasWindow=Boolean(shift?.metadata.date&&shift.metadata.start&&shift.metadata.finish);
 const ranked=useMemo(()=>rankResources(filtered,category,requirements,assigned,hasWindow?availability:{}),[filtered,category,requirements,assigned,hasWindow,availability]);
 useEffect(()=>{
  if(!shift?.metadata.date||!shift.metadata.start||!shift.metadata.finish)return;
  const abort=new AbortController(),timer=setTimeout(async()=>{
   setChecking(true);
   try{
    const candidates=list.slice(0,300).map(r=>({category,resourceId:r.id}));
    const r=await fetch('/api/delivery',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'shifts',check:true,candidates,record:{id:shift.id,name:shift.name,status:shift.status,metadata:{date:shift.metadata.date,start:shift.metadata.start,finish:shift.metadata.finish,requiredCompetencies:shift.metadata.requiredCompetencies,jobId:shift.metadata.jobId,assignments:assigned.map(a=>({category:a.category,resourceId:a.resourceId}))}}})});
    if(!r.ok)return;
    const body=await r.json() as {availability:Record<string,Conflict[]>};
    const next:Record<string,ResourceAvailability>={};
    for(const resource of list){
     const conflicts=body.availability?.[resource.id]||[];
     const block=conflicts.find(c=>c.severity==='block'),warn=conflicts.find(c=>c.severity==='warn');
     next[resource.id]=block?{tone:'block',text:block.message}:warn?{tone:'warn',text:warn.message}:{tone:'ok',text:'Available'};
    }
    setAvailability(next);
   }catch{/* read-only convenience check; save remains authoritative */}finally{setChecking(false);}
  },250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[shift?.id,shift?.status,shift?.metadata.date,shift?.metadata.start,shift?.metadata.finish,shift?.metadata.requiredCompetencies,category,list.length,assigned.map(a=>a.resourceId).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

 if(!shift)return <aside className="rounded-xl border bg-white p-4 lg:sticky lg:top-4"><p className="font-semibold">Resources</p><p className="mt-2 text-sm text-slate-500">Select a shift to allocate people, plant and crews.</p></aside>;
 const cov=coverage(requirements,assigned);
 const assignedIds=new Set(assigned.map(a=>a.resourceId));
 return <aside className="rounded-xl border bg-white shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
  <div className="border-b p-4">
   <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected shift</p>
   <h3 className="mt-1 font-semibold text-slate-950">{shift.name}</h3>
   <p className="text-sm text-slate-600">{String(shift.metadata.start||'')}–{String(shift.metadata.finish||'')} · {shift.status}</p>
   {cov.length>0&&<div className="mt-3 grid gap-1">{cov.map((r,i)=><div key={i} className="flex items-center justify-between gap-2 text-xs"><span>{r.role||r.category}</span><span className={r.missing?'font-semibold text-red-700':'text-emerald-700'}>{r.filled}/{r.quantity}</span></div>)}</div>}
  </div>
  {assigned.length>0&&<section className="border-b p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned</p><span className="text-xs text-slate-500">{assigned.length}</span></div><div className="grid gap-1.5">{assigned.map(a=><div key={a.resourceId} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-sm"><CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600"/><span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-xs text-slate-500">{a.role}</span></span><button type="button" disabled={busy} aria-label={`Remove ${a.name}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-700" onClick={()=>void onUnassign(a.resourceId)}><X aria-hidden className="size-4"/></button></div>)}</div></section>}
  <div className="p-3">
   <div className="flex gap-1 overflow-x-auto pb-2">{CATEGORIES.map(c=><button key={c.key} type="button" onClick={()=>{setCategory(c.key);setQuery('');}} className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${category===c.key?'border-slate-900 bg-slate-900 text-white':'bg-white text-slate-600 hover:bg-slate-50'}`}>{c.label}</button>)}</div>
   <div className="relative mt-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400"/><Input className="pl-9" type="search" placeholder="Name, plant no., rego, employee no." value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <p className="mt-2 text-xs text-slate-500">{checking?'Checking availability…':'Available matches are suggested first.'}</p>
   <div className="mt-2 grid gap-1.5">
    {ranked.slice(0,40).map(r=>{const a=hasWindow?availability[r.id]:undefined,isAssigned=assignedIds.has(r.id),blocked=a?.tone==='block';return <Button key={r.id} type="button" variant="outline" disabled={busy||isAssigned||blocked} title={a?.text} className={`h-auto min-h-12 justify-start px-3 py-2 text-left ${blocked?'border-red-200 bg-red-50/50':a?.tone==='warn'?'border-amber-200 bg-amber-50/50':''}`} onClick={()=>void onAssign(r,category)}>
      <UserRoundPlus aria-hidden className="size-4 shrink-0"/><span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className={`block truncate text-xs font-normal ${blocked?'text-red-700':a?.tone==='warn'?'text-amber-800':'text-slate-500'}`}>{isAssigned?'Already assigned':a?.text||'Checking…'}</span></span>{(blocked||a?.tone==='warn')&&<TriangleAlert aria-hidden className={`size-4 shrink-0 ${blocked?'text-red-600':'text-amber-600'}`}/>}
     </Button>;})}
    {!ranked.length&&<p className="rounded-lg border border-dashed p-3 text-sm text-slate-500">No matching {CATEGORIES.find(c=>c.key===category)?.label.toLowerCase()}.</p>}
   </div>
  </div>
 </aside>;
}
