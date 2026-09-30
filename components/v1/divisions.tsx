'use client';
import {useState} from 'react';
import {Plus} from 'lucide-react';
import {api,useApi,useAction,useSession,ErrorState,Loading,Btn,Field,field,Section,Pill,EmptyState} from './kit';

export type Division={id:string;name:string;code:string;description:string|null;status:'active'|'archived';isDefault:boolean;sortOrder:number;revision:number};
type Feed={divisions:Division[];activeCount:number;defaultId:string|null;canManage:boolean};

/** Divisions of the organisation. `multi` is false for single-division companies, so pickers and filters stay hidden. */
export function useDivisions(){
 const q=useApi<Feed>('/api/business-units');
 const divisions=q.data?.divisions||[],defaultId=q.data?.defaultId??null;
 const byId=new Map(divisions.map(d=>[d.id,d]));
 return {...q,divisions,defaultId,multi:(q.data?.activeCount??0)>1,
  /** NULL on a record means the default division. */
  resolve:(id:string|null|undefined)=>byId.get(id||defaultId||'')??null,
  label:(id:string|null|undefined)=>{const d=byId.get(id||defaultId||'');return d?`${d.name}${d.status==='archived'?' (archived)':''}`:''}};
}

/** Chooser for a record's division. Renders nothing for single-division organisations. Archived divisions can only be kept, not newly chosen. */
export function DivisionPicker({value,onChange,label='Division',disabled,note}:{value:string|null|undefined;onChange:(id:string)=>void;label?:string;disabled?:boolean;note?:string}){
 const d=useDivisions();
 if(!d.multi)return null;
 const current=value||d.defaultId||'';
 const options=d.divisions.filter(x=>x.status==='active'||x.id===current);
 return <Field label={label} hint={note}><select className={field} disabled={disabled} value={current} onChange={e=>onChange(e.target.value)}>{options.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code}){x.status==='archived'?' — archived':''}</option>)}</select></Field>;
}

/** Narrows an already-permitted list. It filters what the user can see; it never widens access. */
export function DivisionFilter({value,onChange}:{value:string;onChange:(id:string)=>void}){
 const d=useDivisions();
 if(!d.multi)return null;
 return <label className="flex items-center gap-2 text-sm"><span className="text-slate-500">Division</span><select aria-label="Filter by division" className={`${field} w-auto min-w-40`} value={value} onChange={e=>onChange(e.target.value)}><option value="">All divisions</option>{d.divisions.map(x=><option key={x.id} value={x.id}>{x.name}{x.status==='archived'?' (archived)':''}</option>)}</select></label>;
}
export const inDivision=(filter:string,recordDivision:string|null|undefined,defaultId:string|null)=>!filter||(recordDivision||defaultId)===filter;

export function DivisionBadge({id}:{id:string|null|undefined}){
 const d=useDivisions();const x=d.multi?d.resolve(id):null;
 return x?<Pill>{x.code}</Pill>:null;
}

/** Admin -> Divisions: create, rename, archive/restore and choose the default. Records keep their division when it is archived. */
export function DivisionsAdmin(){
 const {data,error,loading,refresh}=useApi<Feed>('/api/business-units');
 const {can}=useSession();const {busy,error:actionError,run}=useAction();
 const [draft,setDraft]=useState({name:'',code:'',description:''});
 const [editing,setEditing]=useState<string|null>(null);const [edit,setEdit]=useState({name:'',code:'',description:''});
 if(loading&&!data)return <Loading/>;
 if(error&&!data)return <ErrorState error={error} onRetry={refresh}/>;
 if(!can('org.admin'))return <EmptyState title="Divisions are managed by an administrator."/>;
 const list=data!.divisions;
 const patch=(body:Record<string,unknown>)=>run(()=>api('/api/business-units',{method:'PATCH',body}),refresh);
 return <div className="grid gap-4">
  <Section title="Divisions" description={data!.activeCount>1?'Organise projects, tenders and estimates by division. People, plant and clients stay shared across every division.':'You have one division, so division choices stay hidden everywhere. Add another when you want to organise work by division (for example Civil, Asphalt or Traffic Control).'}>
   <ErrorState error={actionError}/>
   <ul className="divide-y rounded-lg border">{list.map(x=><li key={x.id} className="grid gap-2 p-3">
    {editing===x.id?<form className="grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/business-units',{method:'PATCH',body:{action:'update',id:x.id,revision:x.revision,...edit}}),()=>{setEditing(null);refresh();});}}>
     <Field label="Name" required><input className={field} required maxLength={120} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></Field>
     <Field label="Code" required><input className={field} required maxLength={20} value={edit.code} onChange={e=>setEdit({...edit,code:e.target.value.toUpperCase()})}/></Field>
     <div className="sm:col-span-2"><Field label="Description"><input className={field} maxLength={1000} value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></Field></div>
     <div className="flex gap-2 sm:col-span-2"><Btn busy={busy} type="submit">Save</Btn><Btn type="button" variant="secondary" onClick={()=>setEditing(null)}>Cancel</Btn></div>
    </form>:<div className="flex flex-wrap items-center gap-3">
     <div className="min-w-0 flex-1"><p className="font-medium">{x.name} <span className="text-xs text-slate-500">{x.code}</span> {x.isDefault&&<Pill>Default</Pill>} {x.status==='archived'&&<Pill tone="warning">Archived</Pill>}</p>{x.description&&<p className="text-xs text-slate-500">{x.description}</p>}</div>
     <div className="flex flex-wrap gap-2">
      <Btn variant="secondary" className="min-h-9 py-1" onClick={()=>{setEditing(x.id);setEdit({name:x.name,code:x.code,description:x.description||''});}}>Edit</Btn>
      {x.status==='active'&&!x.isDefault&&<Btn variant="secondary" className="min-h-9 py-1" busy={busy} onClick={()=>patch({action:'make-default',id:x.id,revision:x.revision})}>Make default</Btn>}
      {x.status==='active'&&!x.isDefault&&<Btn variant="secondary" className="min-h-9 py-1" busy={busy} onClick={()=>{if(confirm(`Archive ${x.name}? Existing records keep it; it just stops appearing as a choice.`))void patch({action:'archive',id:x.id,revision:x.revision});}}>Archive</Btn>}
      {x.status==='archived'&&<Btn variant="secondary" className="min-h-9 py-1" busy={busy} onClick={()=>patch({action:'restore',id:x.id,revision:x.revision})}>Restore</Btn>}
     </div></div>}
   </li>)}</ul>
  </Section>
  <Section title="Add a division">
   <form className="grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/business-units',{method:'POST',body:draft}),()=>{setDraft({name:'',code:'',description:''});refresh();});}}>
    <Field label="Name" required><input className={field} required maxLength={120} placeholder="Asphalt" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
    <Field label="Code" required><input className={field} required maxLength={20} placeholder="ASP" value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value.toUpperCase()})}/></Field>
    <div className="sm:col-span-2"><Field label="Description"><input className={field} maxLength={1000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></Field></div>
    <div className="sm:col-span-2"><Btn busy={busy} type="submit"><Plus aria-hidden className="size-4"/>Add division</Btn></div>
   </form>
  </Section>
 </div>;
}
