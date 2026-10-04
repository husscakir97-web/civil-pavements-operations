'use client';
// A scheduled shift's reference to the shared project work areas (seam 'shift.workarea'). It stores and shows area IDs only: the shapes live
// on the project's Work map and are opened from here, never copied. Capability-aware: when Projects (or access to it) is absent the
// section renders nothing and the shift works exactly as before. Operational markup only — not an approved traffic management plan.
import {useState} from 'react';
import {Map as MapIcon} from 'lucide-react';
import {api,useApi,useAction,Btn,Pill} from './kit';
import {DELIVERY_LABEL,DISCIPLINE_COLOUR,DISCIPLINE_LABEL,KIND_LABEL,type WorkMapView} from '@/lib/v1/work-areas';
import type {ShiftWorkAreas} from '@/lib/seams/shift-work-areas';

export function ShiftWorkAreasPanel({shiftId,onOpenMap}:{shiftId:string;onOpenMap:(projectId:string,areaId?:string)=>void}){
 const res=useApi<ShiftWorkAreas>(`/api/delivery/work-areas?shiftId=${encodeURIComponent(shiftId)}`);
 const [choosing,setChoosing]=useState(false),[picked,setPicked]=useState<Set<string>>(new Set());
 const act=useAction();
 const data=res.data;
 const options=useApi<WorkMapView>(choosing&&data?.projectId?`/api/projects/work-areas?projectId=${encodeURIComponent(data.projectId)}`:null);
 if(!data||!data.enabled)return null;
 const start=()=>{setPicked(new Set(data.links.map(l=>l.id)));act.setError('');setChoosing(true);};
 const save=()=>void act.run(()=>api<ShiftWorkAreas>('/api/delivery/work-areas',{method:'POST',body:{shiftId,workAreaIds:[...picked]}}),r=>{res.setData(r);setChoosing(false);});
 const toggle=(id:string)=>setPicked(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const linkedArchived=data.links.filter(l=>l.status==='archived');
 return <section className="rounded-lg border p-3" aria-label="Work areas for this shift" data-testid="shift-work-areas">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Work areas for this shift</h3>
   <span className="flex flex-wrap gap-2">{data.projectId&&<Btn variant="secondary" type="button" onClick={()=>onOpenMap(data.projectId!)} data-testid="open-work-map"><MapIcon aria-hidden className="size-4"/>Open work map</Btn>}{data.canEdit&&!choosing&&<Btn variant="secondary" type="button" onClick={start} data-testid="choose-work-areas">{data.links.length?'Change work areas':'Link work areas'}</Btn>}</span></div>
  <p className="mt-1 text-xs text-slate-500">Areas are drawn once on the project{data.projectName?` (${data.projectName})`:''} and referenced here. Operational overview only; not an approved traffic management plan.</p>
  {!choosing&&(data.links.length?<ul className="mt-2 divide-y text-sm" data-testid="linked-areas">{data.links.map(l=><li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <span className="flex min-w-0 items-start gap-2"><span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm" style={{background:DISCIPLINE_COLOUR[l.discipline]}}/><span className="min-w-0"><span className="block font-medium">{l.name}</span><span className="block text-xs text-slate-500">{[KIND_LABEL[l.kind],DISCIPLINE_LABEL[l.discipline],l.delivery==='subcontracted'?`Subcontracted${l.contractorLabel?` · ${l.contractorLabel}`:''}`:DELIVERY_LABEL[l.delivery]].join(' · ')}</span></span></span>
    <span className="flex items-center gap-2">{l.status==='archived'&&<Pill>Archived</Pill>}{data.projectId&&<Btn variant="ghost" type="button" onClick={()=>onOpenMap(data.projectId!,l.id)} data-testid="open-linked-area">Open on map</Btn>}</span></li>)}</ul>
   :<p className="mt-2 text-sm text-slate-600">No work areas linked yet.</p>)}
  {choosing&&<div className="mt-2 grid gap-2" data-testid="area-chooser">
   {options.loading&&!options.data?<p className="text-sm text-slate-500">Loading the work areas for this project…</p>:<>
    {(options.data?.areas||[]).filter(a=>a.status==='active').length===0&&!linkedArchived.length&&<p className="text-sm text-slate-600">This project has no work areas yet. Draw them on its Work map first.</p>}
    <ul className="grid gap-1">{(options.data?.areas||[]).filter(a=>a.status==='active').map(a=><li key={a.id}><label className="flex min-h-11 items-start gap-2 rounded-lg border p-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={picked.has(a.id)} onChange={()=>toggle(a.id)} data-testid="choose-area"/><span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm" style={{background:DISCIPLINE_COLOUR[a.discipline]}}/><span><span className="block font-medium">{a.name}</span><span className="block text-xs text-slate-500">{[KIND_LABEL[a.kind],DISCIPLINE_LABEL[a.discipline],a.delivery==='subcontracted'?`Subcontracted${a.contractorLabel?` · ${a.contractorLabel}`:''}`:DELIVERY_LABEL[a.delivery]].join(' · ')}</span></span></label></li>)}</ul>
    {linkedArchived.length>0&&<ul className="grid gap-1">{linkedArchived.map(l=><li key={l.id}><label className="flex min-h-11 items-start gap-2 rounded-lg border border-dashed p-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={picked.has(l.id)} onChange={()=>toggle(l.id)} data-testid="choose-area"/><span><span className="block font-medium">{l.name} <Pill>Archived</Pill></span><span className="block text-xs text-slate-500">Already linked; untick to unlink. Archived areas cannot be newly linked.</span></span></label></li>)}</ul>}
   </>}
   {act.error&&<p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{act.error}</p>}
   <div className="flex gap-2"><Btn type="button" onClick={save} busy={act.busy} data-testid="save-work-areas">Save work areas</Btn><Btn type="button" variant="secondary" onClick={()=>setChoosing(false)} disabled={act.busy}>Cancel</Btn></div>
  </div>}
 </section>;
}
