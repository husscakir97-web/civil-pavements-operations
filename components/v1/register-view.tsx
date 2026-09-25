'use client';
// Generic register UI driven by lib/v1/registers.ts. The server enforces every
// rule; this view only hides actions the current role cannot perform.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Download,Plus,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {REGISTERS,type RegisterDef,type FieldDef,type RegisterKey} from '@/lib/v1/registers';
import {allowedTransitions,MACHINES} from '@/lib/platform/workflow';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,FieldGroup,field,money,dateText,Section} from './kit';

type Rec=Record<string,unknown>&{id:string;revision?:number};
let peopleCache:Promise<Array<{id:string;name:string;role:string}>>|null=null;
export function usePeople(){
 const [people,setPeople]=useState<Array<{id:string;name:string;role:string}>>([]);
 const {role}=useSession();
 useEffect(()=>{if(['field','read-only','read_only'].includes(role))return;peopleCache??=api<{people:Array<{id:string;name:string;role:string}>}>('/api/platform/people').then(r=>r.people).catch(()=>{peopleCache=null;return [];});let live=true;peopleCache.then(p=>{if(live)setPeople(p);});return()=>{live=false;};},[role]);
 return people;
}
const CONTEXT:Record<string,string>={library:'library',requirements:'requirement',returnables:'returnable',clarifications:'clarification',itp_items:'itp',incidents:'incident',ncrs:'ncr',actions:'action',readiness:'checklist',closeout:'checklist',variations:'variation'};

export function DocumentInput({value,onChange,contextType,contextId,projectId,disabled}:{value:string;onChange:(id:string)=>void;contextType:string;contextId?:string|null;projectId?:string|null;disabled?:boolean}){
 const {busy,error,run}=useAction();
 return <div className="grid gap-2">
  {value&&<a className="inline-flex items-center gap-1 text-sm text-sky-700 underline" href={`/api/documents?id=${encodeURIComponent(value)}`}><Download aria-hidden className="size-3.5"/>Download attached file</a>}
  {!disabled&&<label className={`${field} flex cursor-pointer items-center gap-2 text-slate-600`}><Upload aria-hidden className="size-4"/>{busy?'Uploading…':value?'Replace file':'Upload file'}<input type="file" className="sr-only" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const f=new FormData();f.set('file',file);f.set('contextType',contextType);if(contextId)f.set('contextId',contextId);if(projectId)f.set('projectId',projectId);if(value)f.set('supersedesId',value);void run(()=>api<{document:{id:string}}>('/api/documents',{method:'POST',body:f}),r=>onChange(r.document.id));e.target.value='';}}/></label>}
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
 </div>;
}

function display(f:FieldDef,v:unknown,people:Array<{id:string;name:string}>):ReactNode{
 if(v===null||v===undefined||v==='')return <span className="text-slate-400">—</span>;
 switch(f.type){
  case 'money':return money(v);
  case 'date':case 'datetime':return dateText(v);
  case 'boolean':return Number(v)?'Yes':'No';
  case 'user':return people.find(p=>p.id===v)?.name||'Assigned';
  case 'document':return <a className="text-sky-700 underline" href={`/api/documents?id=${encodeURIComponent(String(v))}`} onClick={e=>e.stopPropagation()}>File</a>;
  case 'relation':return 'Linked';
  default:{const s=String(v);return s.length>90?s.slice(0,88)+'…':s;}
 }
}

function Input({f,value,onChange,disabled,people,relationOptions,documentContext}:{f:FieldDef;value:unknown;onChange:(v:unknown)=>void;disabled?:boolean;people:Array<{id:string;name:string}>;relationOptions:Record<string,Rec[]>;documentContext:{contextType:string;contextId?:string|null;projectId?:string|null}}){
 const v=value===null||value===undefined?'':value;
 switch(f.type){
  case 'textarea':return <textarea className={`${field} min-h-24`} value={String(v)} disabled={disabled} maxLength={f.max} onChange={e=>onChange(e.target.value)}/>;
  case 'number':case 'money':return <input className={field} type="number" inputMode="decimal" step={f.type==='money'?'0.01':'any'} min={f.min} max={f.max} value={String(v)} disabled={disabled} onChange={e=>onChange(e.target.value===''?null:e.target.value)}/>;
  case 'rating':return <select className={field} value={String(v)} disabled={disabled} onChange={e=>onChange(e.target.value?Number(e.target.value):null)}><option value="">Not rated</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select>;
  case 'date':return <input className={field} type="date" value={String(v).slice(0,10)} disabled={disabled} onChange={e=>onChange(e.target.value||null)}/>;
  case 'datetime':return <input className={field} type="datetime-local" value={String(v).slice(0,16)} disabled={disabled} onChange={e=>onChange(e.target.value||null)}/>;
  case 'select':return <select className={field} value={String(v)} disabled={disabled} onChange={e=>onChange(e.target.value||null)}><option value="">Select…</option>{f.options!.map(o=><option key={o} value={o}>{o.charAt(0).toUpperCase()+o.slice(1)}</option>)}</select>;
  case 'boolean':return <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={Boolean(Number(v))||v===true} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>Yes</label>;
  case 'user':return <select className={field} value={String(v)} disabled={disabled} onChange={e=>onChange(e.target.value||null)}><option value="">Unassigned</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>;
  case 'relation':return <select className={field} value={String(v)} disabled={disabled} onChange={e=>onChange(e.target.value||null)}><option value="">None</option>{(relationOptions[f.relation!]||[]).map(o=><option key={o.id} value={o.id}>{String(o.title||o.name||o.id).slice(0,80)}</option>)}</select>;
  case 'document':return <DocumentInput value={String(v)} onChange={onChange} disabled={disabled} {...documentContext}/>;
  default:return <input className={field} value={String(v)} disabled={disabled} maxLength={f.max} onChange={e=>onChange(e.target.value)}/>;
 }
}

export function RegisterView({register,parentId=null,all=false,title,description,createDefaults,rowActions,onChanged,filter,hideCreate,projectId}:{register:RegisterKey;parentId?:string|null;all?:boolean;title?:string;description?:string;createDefaults?:Rec|Record<string,unknown>;rowActions?:(r:Rec,refresh:()=>void)=>ReactNode;onChanged?:()=>void;filter?:(r:Rec)=>boolean;hideCreate?:boolean;projectId?:string|null}){
 const def=REGISTERS[register] as RegisterDef;
 const session=useSession(),people=usePeople();
 const url=`/api/registers/${register}${parentId?`?parentId=${encodeURIComponent(parentId)}`:all?'?all=1':''}`;
 const {data,error,loading,refresh}=useApi<{records:Rec[]}>(url);
 const [open,setOpen]=useState<Rec|'new'|null>(null);
 const relations=useMemo(()=>[...new Set(def.fields.filter(f=>f.type==='relation').map(f=>f.relation!))],[def]);
 const [relationOptions,setRelationOptions]=useState<Record<string,Rec[]>>({});
 useEffect(()=>{if(!open||!relations.length)return;let live=true;void Promise.all(relations.map(async r=>{const target=REGISTERS[r as RegisterKey] as RegisterDef;const q=target.scope==='org'?'':`?parentId=${encodeURIComponent(parentId||'')}`;try{return [r,(await api<{records:Rec[]}>(`/api/registers/${r}${q}`)).records] as const;}catch{return [r,[]] as const;}})).then(entries=>{if(live)setRelationOptions(Object.fromEntries(entries));});return()=>{live=false;};},[open,relations,parentId]);
 const records=(data?.records||[]).filter(r=>!filter||filter(r));
 const listFields=def.fields.filter(f=>f.list&&(!f.commercial||session.can('commercial.view')));
 const canCreate=!hideCreate&&session.can(def.create||def.edit)&&session.writable(def.module)&&(def.scope==='org'||def.scope==='optional-project'||Boolean(parentId));
 const changed=()=>{refresh();onChanged?.();};
 const docCtx=(rec:Rec|null)=>({contextType:CONTEXT[register]||'organisation',contextId:rec?.id??null,projectId:projectId??(def.scope==='project'||def.scope==='optional-project'?parentId:null)});
 return <Section title={title||def.label} description={description} actions={canCreate&&<Btn onClick={()=>setOpen('new')}><Plus aria-hidden className="size-4"/>{def.createLabel}</Btn>}>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!records.length&&!error?<EmptyState title={def.empty} action={canCreate?<Btn variant="secondary" onClick={()=>setOpen('new')}><Plus aria-hidden className="size-4"/>{def.createLabel}</Btn>:undefined}/>:<>
   <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr>{all&&<th className="py-2 pr-3 font-medium">Project</th>}{listFields.map(f=><th key={f.key} className="py-2 pr-3 font-medium">{f.label}</th>)}{def.machine&&<th className="py-2 pr-3 font-medium">Status</th>}{rowActions&&<th/>}</tr></thead>
    <tbody className="divide-y">{records.map(r=><tr key={r.id} tabIndex={0} className="cursor-pointer hover:bg-slate-50 focus:bg-slate-50 focus:outline-none" onClick={()=>setOpen(r)} onKeyDown={e=>{if(e.key==='Enter')setOpen(r);}}>{all&&<td className="py-2.5 pr-3 text-slate-600">{String(r.project_name||'Company')}</td>}{listFields.map(f=><td key={f.key} className="max-w-xs py-2.5 pr-3 align-top">{display(f,r[f.key],people)}</td>)}{def.machine&&<td className="py-2.5 pr-3"><StatusBadge machine={def.machine} state={String(r[def.stateColumn||'status'])}/></td>}{rowActions&&<td className="py-2.5 text-right" onClick={e=>e.stopPropagation()}>{rowActions(r,changed)}</td>}</tr>)}</tbody></table></div>
   <ul className="grid gap-2 md:hidden">{records.map(r=><li key={r.id}><button className="w-full rounded-lg border bg-white p-3 text-left" onClick={()=>setOpen(r)}><div className="flex items-start justify-between gap-2"><span className="font-medium">{String(r[def.titleField]||'Untitled').slice(0,120)}</span>{def.machine&&<StatusBadge machine={def.machine} state={String(r[def.stateColumn||'status'])}/>}</div><div className="mt-1 grid gap-0.5 text-xs text-slate-500">{all&&<span>{String(r.project_name||'Company')}</span>}{listFields.filter(f=>f.key!==def.titleField).slice(0,3).map(f=><span key={f.key}>{f.label}: {display(f,r[f.key],people)}</span>)}</div></button>{rowActions&&<div className="mt-1">{rowActions(r,changed)}</div>}</li>)}</ul>
  </>}
  <Sheet open={Boolean(open)} onOpenChange={o=>{if(!o)setOpen(null);}}>
   <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
    <SheetTitle className="border-b px-5 py-4 text-lg font-semibold">{open==='new'?def.createLabel:def.singular}</SheetTitle>
    <SheetDescription className="sr-only">{def.label}</SheetDescription>
    {open&&<RecordForm key={open==='new'?'new':open.id} def={def} record={open==='new'?null:open} parentId={parentId} defaults={createDefaults} people={people} relationOptions={relationOptions} docCtx={docCtx(open==='new'?null:open)} onSaved={rec=>{changed();setOpen(rec);}} onClose={()=>{setOpen(null);}} onDeleted={()=>{changed();setOpen(null);}}/>}
   </SheetContent>
  </Sheet>
 </Section>;
}

function RecordForm({def,record,parentId,defaults,people,relationOptions,docCtx,onSaved,onClose,onDeleted}:{def:RegisterDef;record:Rec|null;parentId:string|null;defaults?:Record<string,unknown>;people:Array<{id:string;name:string}>;relationOptions:Record<string,Rec[]>;docCtx:{contextType:string;contextId?:string|null;projectId?:string|null};onSaved:(r:Rec)=>void;onClose:()=>void;onDeleted:()=>void}){
 const session=useSession();
 const [values,setValues]=useState<Record<string,unknown>>(()=>record?{...record}:{...(defaults||{})});
 const [note,setNote]=useState('');
 const {busy,error,run}=useAction();
 const state=record?String(record[def.stateColumn||'status']):null;
 const locked=Boolean(record&&state&&def.lockedStates?.includes(state));
 const fullEdit=session.can(def.edit)&&session.writable(def.module)&&!locked;
 const fieldEdit=!fullEdit&&def.fields.some(f=>f.fieldWritable)&&(record?session.can('itp.complete')&&def.key==='itp_items':session.can(def.create||def.edit));
 const editable=(f:FieldDef)=>!f.derived&&(fullEdit||(fieldEdit&&f.fieldWritable))&&(!f.commercial||session.can('commercial.view'));
 const visible=def.fields.filter(f=>!f.commercial||session.can('commercial.view'));
 const transitions=record&&def.machine&&state?allowedTransitions(def.machine,state,session.role):[];
 const initial=def.machine?MACHINES[def.machine].initial:null;
 const save=()=>run(async()=>{
  const payload=Object.fromEntries(visible.filter(editable).map(f=>[f.key,values[f.key]===undefined?null:values[f.key]]).filter(([k,v])=>!record||v!==record[k as string]));
  const r=record?await api<{record:Rec}>(`/api/registers/${def.key}`,{method:'PATCH',body:{id:record.id,revision:record.revision,values:payload}}):await api<{record:Rec}>(`/api/registers/${def.key}`,{method:'POST',body:{parentId,values:payload}});
  return r.record;
 },onSaved);
 const move=(to:string)=>run(async()=>(await api<{record:Rec}>(`/api/registers/${def.key}`,{method:'PATCH',body:{id:record!.id,transition:to,note:note||undefined}})).record,r=>{setNote('');onSaved(r);});
 return <div className="grid gap-4 p-5">
  {record&&def.machine&&<div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-500">Status</span><StatusBadge machine={def.machine} state={state!}/>{typeof record.reference==='string'&&<span className="text-slate-500">· {record.reference}</span>}{typeof record.origin==='string'&&record.origin!=='manual'&&<span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Source: {String(record.origin)}{record.confidence!=null?` · confidence ${Number(record.confidence).toFixed(0)}%`:''}</span>}</div>}
  {locked&&<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This record is {state} and can no longer be edited.</p>}
  {visible.filter(f=>!f.derived||record).map(f=>{const Wrap=['boolean','document'].includes(f.type)||f.derived?FieldGroup:Field;return <Wrap key={f.key} label={f.label} hint={f.help}>{f.derived?<div className="text-sm text-slate-700">{display(f,values[f.key],people)}</div>:<Input f={f} value={values[f.key]} disabled={!editable(f)||busy} onChange={v=>setValues(s=>({...s,[f.key]:v}))} people={people} relationOptions={relationOptions} documentContext={docCtx}/>}</Wrap>;})}
  <ErrorState error={error}/>
  <div className="flex flex-wrap gap-2 border-t pt-4">
   {(fullEdit||fieldEdit)&&<Btn busy={busy} onClick={()=>void save()}>{record?'Save changes':'Create'}</Btn>}
   <Btn variant="secondary" onClick={onClose}>Close</Btn>
   {record&&fullEdit&&initial===state&&session.can(def.edit)&&<Btn variant="danger" busy={busy} onClick={()=>{if(confirm(`Delete this ${def.singular.toLowerCase()}?`))void run(()=>api(`/api/registers/${def.key}?id=${encodeURIComponent(record.id)}`,{method:'DELETE'}),onDeleted);}}>Delete</Btn>}
  </div>
  {transitions.length>0&&<div className="grid gap-2 rounded-lg border bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lifecycle</p><textarea className={`${field} min-h-16`} placeholder="Note or reason (recorded in the audit trail)" value={note} onChange={e=>setNote(e.target.value)}/><div className="flex flex-wrap gap-2">{transitions.map(t=><Btn key={t.to} variant="secondary" busy={busy} onClick={()=>void move(t.to)}>{t.label}</Btn>)}</div></div>}
 </div>;
}
