'use client';
// CRM/resource pickers built on the shared generic Lookup control.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Plus,Search,Star} from 'lucide-react';
import {api,field,useSession,humanStatus,Btn,Field,ErrorState,useAction} from './kit';
import {useNav} from './nav';
import {formatAbn} from '@/lib/platform/abn';
import {Lookup,type LookupItem} from './lookup-control';
import {AddressLocationPicker} from './location';
import type {LocationInput} from '@/lib/v1/location';

export {Lookup};
export type {LookupItem};

// ---------------------------------------------------------------- clients, sites & contacts
// One client/contact/site master (Core) behind three pickers used everywhere. Client search runs
// on the server (thousands of clients never load into the browser); a client's own sites and
// contacts load with it. Recently chosen clients are offered first.
export type Site={id:string;clientId:string|null;name:string;address:string|null;label:string;status?:string;suburb?:string|null;state?:string|null;postcode?:string|null;siteContact?:string|null;accessNotes?:string|null;revision?:number;location?:import('@/lib/v1/location').LocationView|null};
export type Contact={id:string;clientId:string;name:string;firstName?:string|null;lastName?:string|null;role:string|null;department?:string|null;email:string|null;phone:string|null;mobile:string|null;isPrimary:boolean;status?:string;notes?:string|null;revision:number};
export type Client={id:string;name:string;legalName:string|null;abn:string|null;clientCode?:string|null;contactName:string;email:string;phone:string;website?:string|null;tags?:string[];ownerUserId?:string|null;notes?:string|null;status:string;revision:number;sites:Site[];contacts?:Contact[];paymentTermsDays?:number|null;creditStatus?:string|null;billingEmail?:string|null;accountReference?:string|null};

const RECENT_KEY='infrastruct.recent-clients';
const recentIds=():string[]=>{try{const v=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,8):[];}catch{return [];}};
const remember=(id:string)=>{try{localStorage.setItem(RECENT_KEY,JSON.stringify([id,...recentIds().filter(x=>x!==id)].slice(0,8)));}catch{/* storage unavailable */}};

// Client records are cached by id so every picker on a page shares one fetch; writes invalidate.
const records=new Map<string,Promise<Client|null>>();
const listeners=new Set<()=>void>();
export function clientRecord(id:string,force=false){
 if(force||!records.has(id))records.set(id,api<{clients:Client[]}>(`/api/platform/clients?ids=${encodeURIComponent(id)}`).then(r=>r.clients[0]||null).catch(e=>{records.delete(id);throw e;}));
 return records.get(id)!;
}
/** Re-fetch cached clients (after a create or edit anywhere on the page). */
export function refreshClients(id?:string){if(id)records.delete(id);else records.clear();listeners.forEach(l=>l());}
export function useClientRecord(id:string|null|undefined){
 const [state,setState]=useState<{key:string;client:Client|null}|null>(null),[tick,setTick]=useState(0);
 useEffect(()=>{const l=()=>setTick(t=>t+1);listeners.add(l);return()=>{listeners.delete(l);};},[]);
 const key=id?`${id}#${tick}`:null;
 useEffect(()=>{if(!key||!id)return;let live=true;clientRecord(id).then(c=>{if(live)setState({key,client:c});}).catch(()=>{if(live)setState({key,client:null});});return()=>{live=false;};},[key,id]);
 // Keep showing the last loaded record for the same client while a refresh is in flight.
 const client=id&&state&&state.key.split('#')[0]===id?state.client:null;
 return {client,loading:Boolean(key)&&state?.key!==key,refresh:()=>refreshClients(id||undefined)};
}
/** Debounced server search; with no text it offers recent clients, then active clients. */
function useClientSearch(){
 const [query,setQuery]=useState(''),[clients,setClients]=useState<Client[]>([]),[loading,setLoading]=useState(true),[recent,setRecent]=useState<string[]>([]);
 useEffect(()=>{
  let live=true;const q=query.trim();
  const t=setTimeout(async()=>{
   setLoading(true);
   try{
    if(q){const r=await api<{clients:Client[]}>(`/api/platform/clients?q=${encodeURIComponent(q)}&limit=25`);if(live){setClients(r.clients);setRecent([]);}}
    else{const ids=recentIds();const [rec,top]=await Promise.all([ids.length?api<{clients:Client[]}>(`/api/platform/clients?ids=${encodeURIComponent(ids.join(','))}`):Promise.resolve({clients:[] as Client[]}),api<{clients:Client[]}>('/api/platform/clients?limit=25')]);
     const recentList=ids.map(id=>rec.clients.find(c=>c.id===id)).filter((c):c is Client=>Boolean(c&&c.status==='active'));
     if(live){setClients([...recentList,...top.clients.filter(c=>!recentList.some(r=>r.id===c.id))]);setRecent(recentList.map(c=>c.id));}}
   }catch{if(live)setClients([]);}finally{if(live)setLoading(false);}
  },q?200:0);
  return()=>{live=false;clearTimeout(t);};
 },[query]);
 return {clients,loading,recent,setQuery};
}
const clientItem=(c:Client,recent=false):LookupItem=>({id:c.id,label:c.name,detail:[c.legalName&&c.legalName!==c.name?c.legalName:null,c.abn?`ABN ${formatAbn(c.abn)}`:null,c.clientCode,c.contactName,c.sites.length?`${c.sites.length} site${c.sites.length===1?'':'s'}`:null].filter(Boolean).join(' · ')||null,badge:c.status!=='active'?<span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">Inactive</span>:recent?<span className="text-[10px] text-slate-400">Recent</span>:undefined,search:[c.name,c.legalName,c.abn,c.clientCode,c.contactName,c.email,...c.sites.map(s=>s.label),...(c.contacts||[]).flatMap(x=>[x.name,x.email])],ids:[c.abn,c.clientCode]});
/** Quick create in workflows (crm.create); editing existing master records needs crm.edit. The server enforces both. */
const canCreateClients=(s:ReturnType<typeof useSession>)=>s.can('crm.create');
const canEditClients=(s:ReturnType<typeof useSession>)=>s.can('crm.edit');

export async function quickCreateClient(name:string,extra:{abn?:string|null}={}){
 const r=await api<{client:Client;existing:boolean}>('/api/platform/clients',{method:'POST',body:{action:'create',client:{name,...extra}}});
 remember(r.client.id);refreshClients(r.client.id);return r.client;
}

/**
 * Client picker: server typeahead, recent clients first, active before inactive, and
 * inline "Add new client" that saves with just a name and selects it immediately.
 * `legacyName` shows an old free-text value that has not been linked yet.
 */
export function ClientPicker({value,onChange,disabled,legacyName,label='Client'}:{value:string|null|undefined;onChange:(c:Client|null)=>void;disabled?:boolean;legacyName?:string|null;label?:string}){
 const session=useSession(),{clients,loading,recent,setQuery}=useClientSearch(),{client:selected}=useClientRecord(value);
 const canCreate=canCreateClients(session);
 const items=useMemo(()=>clients.filter(c=>c.status==='active'||c.id===value||recent.includes(c.id)||clients.length<5).map(c=>clientItem(c,recent.includes(c.id))),[clients,value,recent]);
 const choose=(c:Client|null)=>{if(c)remember(c.id);onChange(c);};
 return <Lookup label={label} items={items} value={value} loading={loading} disabled={disabled} placeholder="Search clients, ABN or code…" emptyText="No clients yet. Type a name to add your first client."
  heading={recent.length?'Recent clients':undefined} onQueryChange={setQuery} selectedItem={selected?clientItem(selected):null}
  onChange={i=>{if(!i)return choose(null);const c=clients.find(x=>x.id===i.id)||(selected?.id===i.id?selected:null);if(c)choose(c);else void clientRecord(i.id).then(r=>choose(r));}}
  createLabel={q=>`Add new client “${q}”`} onCreate={canCreate?async q=>{const c=await quickCreateClient(q);choose(c);return clientItem(c);}:undefined}
  hint={!value&&legacyName?<>Client not linked — recorded as “{legacyName}”. Choose the matching client to link it.</>:undefined}/>;
}

/** Sites of the chosen client first. New sites use the same address/map flow without leaving the form. */
export function SitePicker({clientId,value,onChange,disabled,label='Site'}:{clientId:string|null|undefined;value:string|null|undefined;onChange:(s:Site|null)=>void;disabled?:boolean;label?:string}){
 const session=useSession(),{client,loading}=useClientRecord(clientId),{busy,error,run}=useAction();
 const canCreate=canCreateClients(session);
 const sites=useMemo(()=>client?.sites||[],[client]);
 const items=useMemo(()=>sites.map(s=>({id:s.id,label:s.name,detail:s.address&&s.address!==s.name?s.address:null,search:[s.name,s.address,s.suburb]})),[sites]);
 const [adding,setAdding]=useState(false),[siteName,setSiteName]=useState(''),[location,setLocation]=useState<LocationInput|null>(null),[seed,setSeed]=useState('');
 const cancel=()=>{setAdding(false);setSiteName('');setLocation(null);setSeed('');};
 const save=()=>{if(!clientId||(!siteName.trim()&&!location))return;void run(()=>api<{site:Site}>('/api/platform/clients',{method:'POST',body:{action:'createSite',site:{clientId,name:siteName.trim()||null,location}}}),r=>{refreshClients(clientId);onChange(r.site);cancel();});};
 return <div className="grid gap-2">
  <Lookup label={label} items={items} value={value} loading={loading} disabled={disabled||!clientId} placeholder={clientId?'Search this client’s sites…':'Choose a client first'} emptyText={clientId?'No sites recorded for this client. Type a name or address to add one.':'Choose a client first.'}
   onChange={i=>onChange(i?sites.find(s=>s.id===i.id)||null:null)}
   createLabel={q=>`Add site “${q}” with address / map`} onCreate={canCreate&&clientId?async q=>{setSeed(q);setSiteName(q);setLocation(null);setAdding(true);return null;}:undefined}/>
  {adding&&clientId&&<div className="grid gap-3 rounded-lg border bg-slate-50 p-3">
   <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New site</p><button type="button" className="text-xs text-slate-600 underline" onClick={cancel}>Cancel</button></div>
   <Field label="Site name"><input className={field} value={siteName} onChange={e=>setSiteName(e.target.value)} placeholder="Depot, Gate 2, Dover Road…"/></Field>
   <AddressLocationPicker label="Site address and exact location" value={location} onChange={setLocation} mode="compact" initialQuery={seed}/>
   <div><Btn type="button" busy={busy} disabled={!siteName.trim()&&!location} onClick={save}><Plus aria-hidden className="size-4"/>Save site</Btn></div>
   <ErrorState error={error}/>
  </div>}
 </div>;
}

/** Contacts of the chosen client, primary first, with inline "Add contact" (name is enough). */
export function ContactPicker({clientId,value,onChange,disabled,label='Client contact'}:{clientId:string|null|undefined;value:string|null|undefined;onChange:(c:Contact|null)=>void;disabled?:boolean;label?:string}){
 const session=useSession(),{client,loading}=useClientRecord(clientId);
 const canCreate=canCreateClients(session);
 const contacts=useMemo(()=>client?.contacts||[],[client]);
 const items=useMemo(()=>contacts.map(c=>({id:c.id,label:c.name,detail:[c.role,c.mobile||c.phone,c.email].filter(Boolean).join(' · ')||null,badge:c.isPrimary?<span className="rounded bg-amber-50 px-1.5 text-[10px] text-amber-900">Primary</span>:undefined,search:[c.name,c.role,c.email,c.phone,c.mobile]})),[contacts]);
 return <Lookup label={label} items={items} value={value} loading={loading} disabled={disabled||!clientId} placeholder={clientId?'Search this client’s contacts…':'Choose a client first'} emptyText={clientId?'No contacts recorded for this client. Type a name to add one.':'Choose a client first.'}
  onChange={i=>onChange(i?contacts.find(c=>c.id===i.id)||null:null)}
  createLabel={q=>`Add contact “${q}”`} onCreate={canCreate&&clientId?async q=>{const r=await api<{client:Client;contactId:string}>('/api/platform/clients',{method:'POST',body:{action:'addContact',clientId,contact:{name:q,isPrimary:!contacts.length}}});refreshClients(clientId);const c=(r.client.contacts||[]).find(x=>x.id===r.contactId)||null;onChange(c);return c?{id:c.id,label:c.name}:null;}:undefined}/>;
}

/** Searchable member picker (owner, project manager, responsible person). */
export function PersonPicker({people,value,onChange,label,disabled,emptyLabel}:{people:Array<{id:string;name:string;role?:string}>;value:string|null|undefined;onChange:(id:string|null)=>void;label:string;disabled?:boolean;emptyLabel?:string}){
 const items=useMemo(()=>people.map(p=>({id:p.id,label:p.name,detail:p.role?humanStatus(p.role):null})),[people]);
 return <Lookup label={label} items={items} value={value||null} disabled={disabled} placeholder="Search people…" emptyText={emptyLabel||'No members found.'} onChange={i=>onChange(i?.id??null)}/>;
}

/** Contacts for one client: list, add, set primary, remove. */
export function ClientContacts({clientId}:{clientId:string}){
 const {client:c,refresh}=useClientRecord(clientId),session=useSession(),{busy,error,run}=useAction();
 const canAdd=canCreateClients(session),canEdit=canEditClients(session);
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
  {canAdd&&<form className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();post({action:'addContact',clientId,contact:{...f,isPrimary:!contacts.length}},()=>setF({name:'',role:'',email:'',phone:''}));}}>
   <Field label="Name" required><input className={field} required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></Field>
   <Field label="Role"><input className={field} placeholder="Project manager, accounts…" value={f.role} onChange={e=>setF({...f,role:e.target.value})}/></Field>
   <Field label="Email"><input className={field} type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></Field>
   <Field label="Phone"><input className={field} value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></Field>
   <div className="sm:col-span-2"><Btn type="submit" busy={busy}><Plus aria-hidden className="size-4"/>Add contact</Btn></div>
  </form>}
  <ErrorState error={error}/>
 </div>;
}

/**
 * Read-only client context card for tender and project pages: the client (linked to CRM when
 * the user may open it), the chosen contact and site, then the client's other contacts.
 */
export function ClientContactCard({clientId,contactId,siteId}:{clientId:string|null|undefined;contactId?:string|null;siteId?:string|null}){
 const {client:c}=useClientRecord(clientId),{navigate}=useNav(),session=useSession();
 if(!c)return null;
 const chosen=(c.contacts||[]).find(x=>x.id===contactId),site=c.sites.find(s=>s.id===siteId);
 const people=[...(c.contactName?[{id:'main',name:c.contactName,role:'Main contact',email:c.email||null,phone:c.phone||null,mobile:null,isPrimary:!(c.contacts||[]).some(x=>x.isPrimary)}]:[]),...(c.contacts||[])].sort((a,b)=>Number(b.id===contactId)-Number(a.id===contactId));
 const openCrm=session.can('pipeline.view')||session.can('project.view')||session.can('schedule.view');
 return <div className="rounded-lg border bg-slate-50 p-3 text-sm">
  <div className="mb-2 flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client</p>{openCrm?<button className="font-semibold text-sky-800 underline" onClick={()=>navigate('CRM','Clients',c.id)}>{c.name}</button>:<span className="font-semibold">{c.name}</span>}{site&&<span className="text-xs text-slate-600">· Site: {site.label}</span>}{chosen&&<span className="text-xs text-slate-600">· Contact: {chosen.name}</span>}</div>
  {people.length>0&&<ul className="grid gap-2 sm:grid-cols-2">{people.map(x=><li key={x.id} className="min-w-0"><span className="font-medium">{x.name}</span>{x.id===contactId?<span className="ml-2 rounded bg-sky-50 px-1.5 text-xs text-sky-900">This job</span>:x.isPrimary&&<span className="ml-2 rounded bg-amber-50 px-1.5 text-xs text-amber-900">Primary</span>}<span className="block truncate text-xs text-slate-600">{[x.role,x.email&&<a key="e" className="underline" href={`mailto:${x.email}`}>{x.email}</a>,(x.mobile||x.phone)&&<a key="p" className="underline" href={`tel:${x.mobile||x.phone}`}>{x.mobile||x.phone}</a>].filter(Boolean).reduce<ReactNode[]>((a,v,i)=>i?[...a,' · ',v]:[v],[])}</span></li>)}</ul>}
 </div>;
}
