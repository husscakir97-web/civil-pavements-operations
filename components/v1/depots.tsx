'use client';
// Depots and yards with their exact location (Resources → Depots).
import {useState} from 'react';
import {Plus,Warehouse} from 'lucide-react';
import {api,useApi,useAction,PageHeader,EmptyState,ErrorState,Loading,Pill,Btn,Field,field} from './kit';
import {AddressLocationPicker,LocationSummary,locationInputFrom} from './location';
import type {LocationInput,LocationView} from '@/lib/v1/location';

type Depot={id:string;name:string;notes:string|null;status:string;revision:number;location:LocationView|null};
export function DepotsArea(){
 const {data,error,loading,refresh}=useApi<{canEdit:boolean;depots:Depot[]}>('/api/platform/depots');
 const [edit,setEdit]=useState<Depot|'new'|null>(null);
 return <div className="grid gap-4">
  <PageHeader title="Depots & yards" subtitle="Where crews and plant start from. Exact locations support travel and mobilisation planning later." actions={data?.canEdit&&<Btn onClick={()=>setEdit('new')}><Plus aria-hidden className="size-4"/>Add depot</Btn>}/>
  <ErrorState error={error} onRetry={refresh}/>
  {edit&&<DepotForm depot={edit==='new'?null:edit} onDone={()=>{setEdit(null);refresh();}}/>}
  {loading&&!data?<Loading/>:!data?.depots.length?<EmptyState title="No depots recorded yet."/>:
   <ul className="grid gap-3 md:grid-cols-2">{data.depots.map(d=><li key={d.id} className="surface p-4"><div className="flex items-center gap-2"><Warehouse aria-hidden className="size-4 text-slate-500"/><span className="font-medium">{d.name}</span>{d.status!=='active'&&<Pill>Inactive</Pill>}{data.canEdit&&<Btn variant="ghost" className="ml-auto min-h-9 py-1" onClick={()=>setEdit(d)}>Edit</Btn>}</div><div className="mt-2"><LocationSummary location={d.location}/></div>{d.notes&&<p className="mt-1 text-xs text-slate-500">{d.notes}</p>}</li>)}</ul>}
 </div>;
}
function DepotForm({depot,onDone}:{depot:Depot|null;onDone:()=>void}){
 const [name,setName]=useState(depot?.name||''),[notes,setNotes]=useState(depot?.notes||''),[location,setLocation]=useState<LocationInput|null>(locationInputFrom(depot?.location));
 const {busy,error,run}=useAction();
 return <form className="surface grid gap-3 p-4" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/platform/depots',{method:'POST',body:{id:depot?.id||null,revision:depot?.revision??null,depot:{name,notes:notes||null,location,status:depot?.status}}}),onDone);}}>
  <Field label="Depot name" required><input className={field} required value={name} onChange={e=>setName(e.target.value)}/></Field>
  <AddressLocationPicker label="Depot address" mode="map" value={location} onChange={setLocation}/>
  <Field label="Notes"><input className={field} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Gate code, opening hours…"/></Field>
  <ErrorState error={error}/>
  <div className="flex gap-2"><Btn type="submit" busy={busy}>Save depot</Btn><Btn type="button" variant="secondary" onClick={onDone}>Cancel</Btn></div>
 </form>;
}
