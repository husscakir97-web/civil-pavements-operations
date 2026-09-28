'use client';
// One lookup interaction for every "pick an existing record" field: type to
// search, arrow keys + Enter to choose, and an inline "+ Add" when the record
// does not exist yet. Clients, sites, workers and plant all use this.
import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Check,Plus,Search,X} from 'lucide-react';
import {api,field,useSession} from './kit';
import {filterLookup,type LookupValue} from '@/lib/v1/lookup';

export type LookupItem={id:string;label:string;detail?:string|null;badge?:ReactNode;search?:LookupValue[];ids?:LookupValue[]};

export function Lookup({label,items,value,onChange,placeholder,disabled,loading,createLabel,onCreate,emptyText,allowClear=true,hint}:{
 label:string;items:LookupItem[];value:string|null|undefined;onChange:(item:LookupItem|null)=>void;placeholder?:string;disabled?:boolean;loading?:boolean;
 /** Offered below the results; receives what the user typed. Return the created item to select it. */
 createLabel?:(query:string)=>string;onCreate?:(query:string)=>Promise<LookupItem|null|void>;
 emptyText?:string;allowClear?:boolean;hint?:ReactNode;
}){
 const id=useId(),listId=`${id}-list`;
 const selected=items.find(i=>i.id===value)||null;
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),[creating,setCreating]=useState(false),[error,setError]=useState('');
 const box=useRef<HTMLDivElement>(null);
 const results=useMemo(()=>filterLookup(items,query,i=>i.search??[i.label,i.detail],i=>i.ids??[],i=>i.label).slice(0,50),[items,query]);
 const canCreate=Boolean(onCreate&&query.trim());
 const count=results.length+(canCreate?1:0);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[open]);
 const choose=(item:LookupItem|null)=>{onChange(item);setQuery('');setOpen(false);setActive(0);};
 const create=async()=>{if(!onCreate||creating)return;setCreating(true);setError('');try{const item=await onCreate(query.trim());if(item)choose(item);}catch(e){setError((e as Error).message);}finally{setCreating(false);}};
 const pick=(i:number)=>{if(i<results.length)choose(results[i]);else if(canCreate)void create();};
 return <div ref={box} className="relative grid gap-1 text-sm">
  <span id={`${id}-label`} className="font-medium text-slate-700">{label}</span>
  {selected&&!open?<div className={`${field} flex items-center gap-2`}>
   <button type="button" disabled={disabled} className="min-w-0 flex-1 text-left" onClick={()=>{setOpen(true);setQuery('');}} aria-label={`${label}: ${selected.label}. Change`}>
    <span className="block truncate font-medium text-slate-900">{selected.label}</span>{selected.detail&&<span className="block truncate text-xs text-slate-500">{selected.detail}</span>}
   </button>
   {allowClear&&!disabled&&<button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label={`Clear ${label}`} onClick={()=>choose(null)}><X aria-hidden className="size-4"/></button>}
  </div>:
  <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400"/>
   <input role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open&&count?`${id}-opt-${active}`:undefined}
    autoFocus={Boolean(selected)} className={`${field} pl-9`} disabled={disabled} placeholder={placeholder||`Search ${label.toLowerCase()}…`} value={query}
    onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(0);}}
    onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(a=>Math.min(a+1,Math.max(count-1,0)));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}else if(e.key==='Enter'&&open&&count){e.preventDefault();pick(active);}else if(e.key==='Escape'){setOpen(false);}}}/>
  </div>}
  {open&&!disabled&&<ul id={listId} role="listbox" aria-labelledby={`${id}-label`} className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
   {loading&&!items.length?<li className="px-3 py-2 text-slate-500" role="status">Loading…</li>:null}
   {results.map((item,i)=><li key={item.id} id={`${id}-opt-${i}`} role="option" aria-selected={item.id===value} className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${i===active?'bg-slate-100':''}`} onMouseEnter={()=>setActive(i)} onMouseDown={e=>{e.preventDefault();pick(i);}}>
    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{item.label}</span>{item.detail&&<span className="block truncate text-xs text-slate-500">{item.detail}</span>}</span>
    {item.badge}{item.id===value&&<Check aria-hidden className="size-4 text-emerald-600"/>}
   </li>)}
   {!loading&&!results.length&&!canCreate&&<li className="px-3 py-2 text-slate-500">{query?'No matches.':emptyText||'Nothing recorded yet.'}</li>}
   {canCreate&&<li id={`${id}-opt-${results.length}`} role="option" aria-selected={false} className={`flex cursor-pointer items-center gap-2 border-t px-3 py-2 font-medium text-sky-800 ${active===results.length?'bg-sky-50':''}`} onMouseEnter={()=>setActive(results.length)} onMouseDown={e=>{e.preventDefault();void create();}}>
    <Plus aria-hidden className="size-4"/>{creating?'Adding…':createLabel?createLabel(query.trim()):`Add “${query.trim()}”`}
   </li>}
  </ul>}
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  {hint&&<span className="text-xs text-slate-500">{hint}</span>}
 </div>;
}

// ---------------------------------------------------------------- clients & sites
export type Site={id:string;clientId:string|null;name:string;address:string|null;label:string};
export type Client={id:string;name:string;legalName:string|null;abn:string|null;contactName:string;email:string;phone:string;status:string;revision:number;sites:Site[]};

let clientsCache:Promise<Client[]>|null=null;
const listeners=new Set<(c:Client[])=>void>();
function loadClients(force=false){
 if(force||!clientsCache)clientsCache=api<{clients:Client[]}>('/api/platform/clients').then(r=>r.clients).catch(e=>{clientsCache=null;throw e;});
 return clientsCache;
}
function publish(){void loadClients(true).then(c=>listeners.forEach(l=>l(c))).catch(()=>{});}
export function useClients(){
 const [clients,setClients]=useState<Client[]>([]),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;listeners.add(setClients);loadClients().then(c=>{if(live)setClients(c);}).catch(()=>{}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;listeners.delete(setClients);};},[]);
 return {clients,loading,refresh:publish};
}
const clientItem=(c:Client):LookupItem=>({id:c.id,label:c.name,detail:[c.legalName&&c.legalName!==c.name?c.legalName:null,c.contactName,c.sites.length?`${c.sites.length} site${c.sites.length===1?'':'s'}`:null,c.status!=='active'?'inactive':null].filter(Boolean).join(' · ')||null,search:[c.name,c.legalName,c.abn,c.contactName,c.email,...c.sites.map(s=>s.label)],ids:[c.abn]});

export async function quickCreateClient(name:string){
 const r=await api<{client:Client;existing:boolean}>('/api/platform/clients',{method:'POST',body:{action:'create',client:{name}}});
 publish();return r.client;
}

/** Searchable client picker with inline create. `legacyName` shows an old free-text value that has not been matched yet. */
export function ClientPicker({value,onChange,disabled,legacyName,label='Client'}:{value:string|null|undefined;onChange:(c:Client|null)=>void;disabled?:boolean;legacyName?:string|null;label?:string}){
 const {clients,loading}=useClients(),session=useSession();
 const canCreate=session.can('pipeline.edit')||session.can('project.edit');
 const items=useMemo(()=>clients.filter(c=>c.status==='active'||c.id===value).map(clientItem),[clients,value]);
 return <Lookup label={label} items={items} value={value} loading={loading} disabled={disabled} placeholder="Search clients…" emptyText="No clients yet. Type a name to add your first client."
  onChange={i=>onChange(i?clients.find(c=>c.id===i.id)||null:null)}
  createLabel={q=>`Add new client “${q}”`} onCreate={canCreate?async q=>{const c=await quickCreateClient(q);onChange(c);return clientItem(c);}:undefined}
  hint={!value&&legacyName?<>Recorded as “{legacyName}”. Choose the matching client to link it.</>:undefined}/>;
}

/** Sites for the chosen client (or all sites when no client is chosen), with inline add by address. */
export function SitePicker({clientId,value,onChange,disabled,label='Site'}:{clientId:string|null|undefined;value:string|null|undefined;onChange:(s:Site|null)=>void;disabled?:boolean;label?:string}){
 const {clients,loading}=useClients(),session=useSession();
 const canCreate=session.can('pipeline.edit')||session.can('project.edit');
 const sites=useMemo(()=>clientId?clients.find(c=>c.id===clientId)?.sites||[]:clients.flatMap(c=>c.sites),[clients,clientId]);
 const items=useMemo(()=>sites.map(s=>({id:s.id,label:s.name,detail:s.address&&s.address!==s.name?s.address:null,search:[s.name,s.address]})),[sites]);
 return <Lookup label={label} items={items} value={value} loading={loading} disabled={disabled} placeholder={clientId?'Search this client’s sites…':'Search sites…'} emptyText={clientId?'No sites recorded for this client. Type an address to add one.':'Choose a client first to add a site.'}
  onChange={i=>onChange(i?sites.find(s=>s.id===i.id)||null:null)}
  createLabel={q=>`Add site “${q}”`} onCreate={canCreate&&clientId?async q=>{const r=await api<{site:Site}>('/api/platform/clients',{method:'POST',body:{action:'createSite',site:{clientId:clientId||null,address:q}}});publish();onChange(r.site);return {id:r.site.id,label:r.site.name};}:undefined}/>;
}
