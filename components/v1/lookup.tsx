'use client';
// One lookup interaction for every "pick an existing record" field: type to
// search, arrow keys + Enter to choose, and an inline "+ Add" when the record
// does not exist yet. Clients, sites, workers and plant all use this.
import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Check,Plus,Search,Star,X} from 'lucide-react';
import {api,field,useSession,humanStatus,Btn,Field,ErrorState,useAction} from './kit';
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
export type Client={id:string;name:string;legalName:string|null;abn:string|null;contactName:string;email:string;phone:string;status:string;revision:number;sites:Site[];contacts?:Contact[]};
export type Contact={id:string;clientId:string;name:string;role:string|null;email:string|null;phone:string|null;mobile:string|null;isPrimary:boolean;revision:number};

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
const clientItem=(c:Client):LookupItem=>({id:c.id,label:c.name,detail:[c.legalName&&c.legalName!==c.name?c.legalName:null,c.contactName,c.sites.length?`${c.sites.length} site${c.sites.length===1?'':'s'}`:null,c.status!=='active'?'inactive':null].filter(Boolean).join(' · ')||null,search:[c.name,c.legalName,c.abn,c.contactName,c.email,...c.sites.map(s=>s.label),...(c.contacts||[]).map(x=>x.name)],ids:[c.abn]});

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

/** Searchable member picker (owner, project manager, responsible person). */
export function PersonPicker({people,value,onChange,label,disabled,emptyLabel}:{people:Array<{id:string;name:string;role?:string}>;value:string|null|undefined;onChange:(id:string|null)=>void;label:string;disabled?:boolean;emptyLabel?:string}){
 const items=useMemo(()=>people.map(p=>({id:p.id,label:p.name,detail:p.role?humanStatus(p.role):null})),[people]);
 return <Lookup label={label} items={items} value={value||null} disabled={disabled} placeholder="Search people…" emptyText={emptyLabel||'No members found.'} onChange={i=>onChange(i?.id??null)}/>;
}

/** Contacts for one client: list, add, set primary, remove. Used from the Clients page. */
export function ClientContacts({clientId}:{clientId:string}){
 const {clients,refresh}=useClients(),session=useSession(),{busy,error,run}=useAction();
 const canEdit=session.can('pipeline.edit')||session.can('project.edit');
 const c=clients.find(x=>x.id===clientId);
 const [f,setF]=useState({name:'',role:'',email:'',phone:''});
 if(!c)return <p className="text-sm text-slate-500">Loading contacts…</p>;
 const post=(body:Record<string,unknown>,done?:()=>void)=>void run(()=>api('/api/platform/clients',{method:'POST',body}),()=>{refresh();done?.();});
 const contacts=c.contacts||[];
 return <div className="grid gap-3">
  {c.contactName&&<p className="text-sm text-slate-600">Main contact on the client record: <strong>{c.contactName}</strong>{[c.email,c.phone].filter(Boolean).length?` · ${[c.email,c.phone].filter(Boolean).join(' · ')}`:''}</p>}
  {contacts.length?<ul className="divide-y rounded-lg border">{contacts.map(x=><li key={x.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
   <span className="min-w-0 flex-1"><span className="font-medium">{x.name}</span>{x.isPrimary&&<span className="ml-2 rounded bg-amber-50 px-1.5 text-xs text-amber-900">Primary</span>}<span className="block text-xs text-slate-500">{[x.role,x.email,x.phone,x.mobile].filter(Boolean).join(' · ')||'No details'}</span></span>
   {canEdit&&!x.isPrimary&&<Btn variant="ghost" className="min-h-9 px-2 text-xs" busy={busy} aria-label={`Make ${x.name} primary`} onClick={()=>post({action:'updateContact',id:x.id,revision:x.revision,contact:{isPrimary:true}})}><Star aria-hidden className="size-3.5"/>Primary</Btn>}
   {canEdit&&<Btn variant="ghost" className="min-h-9 px-2 text-xs text-red-700" busy={busy} aria-label={`Remove ${x.name}`} onClick={()=>{if(confirm(`Remove ${x.name} from ${c.name}?`))post({action:'updateContact',id:x.id,revision:x.revision,contact:{archived:true}});}}>Remove</Btn>}
  </li>)}</ul>:<p className="text-sm text-slate-500">No other contacts yet.</p>}
  {canEdit&&<form className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();post({action:'addContact',clientId,contact:{...f,isPrimary:!contacts.length}},()=>setF({name:'',role:'',email:'',phone:''}));}}>
   <Field label="Name" required><input className={field} required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field>
   <Field label="Role"><input className={field} placeholder="Project manager, accounts…" value={f.role} onChange={e=>setF({...f,role:e.target.value})}/></Field>
   <Field label="Email"><input className={field} type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></Field>
   <Field label="Phone"><input className={field} value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></Field>
   <div className="sm:col-span-2"><Btn type="submit" busy={busy}><Plus aria-hidden className="size-4"/>Add contact</Btn></div>
  </form>}
  <ErrorState error={error}/>
 </div>;
}

/** Read-only client contact card for tender and project pages (the context already knows the client). */
export function ClientContactCard({clientId}:{clientId:string|null|undefined}){
 const {clients}=useClients();
 const c=clientId?clients.find(x=>x.id===clientId):null;
 if(!c)return null;
 const people=[...(c.contactName?[{id:'main',name:c.contactName,role:'Main contact',email:c.email||null,phone:c.phone||null,mobile:null,isPrimary:!(c.contacts||[]).some(x=>x.isPrimary)}]:[]),...(c.contacts||[])];
 if(!people.length)return null;
 return <div className="rounded-lg border bg-slate-50 p-3 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{c.name} contacts</p>
  <ul className="grid gap-2 sm:grid-cols-2">{people.map(x=><li key={x.id} className="min-w-0"><span className="font-medium">{x.name}</span>{x.isPrimary&&<span className="ml-2 rounded bg-amber-50 px-1.5 text-xs text-amber-900">Primary</span>}<span className="block truncate text-xs text-slate-600">{[x.role,x.email&&<a key="e" className="underline" href={`mailto:${x.email}`}>{x.email}</a>,x.phone&&<a key="p" className="underline" href={`tel:${x.phone}`}>{x.phone}</a>].filter(Boolean).reduce<ReactNode[]>((a,v,i)=>i?[...a,' · ',v]:[v],[])}</span></li>)}</ul>
 </div>;
}
