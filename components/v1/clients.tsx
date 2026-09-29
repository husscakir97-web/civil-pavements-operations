'use client';
// CRM: one client/contact/site master (Core). Fast server search across clients, contacts and
// sites; a client drawer with overview, contacts, sites and the client's Work (read from the
// real records, limited to what this user may see); bulk import, legacy linking and merge for
// authorised users. Nothing here duplicates records from other modules.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Building2,MapPin,Plus,Search,UserRound,Merge,Link2,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,PageHeader,Section,EmptyState,ErrorState,Loading,Pill,Tabs,Field,Btn,field,dateText} from './kit';
import {ClientContacts,ClientPicker,refreshClients,type Client,type Contact,type Site} from './lookup';
import {useNav} from './nav';
import {formatAbn} from '@/lib/platform/abn';
import {CrmImporter,LegacyLinks} from './crm-import';

type View='clients'|'contacts'|'sites';
type Row<T>=T&{clientName:string};
type Work={client:Client;projects?:{active:Array<{id:string;name:string;projectNumber:string|null;stage:string;startDate:string|null}>;completed:Array<{id:string;name:string;projectNumber:string|null;stage:string}>};opportunities?:Array<{id:string;name:string;stage:string;closingDate:string|null;estimatedValue?:number|null}>;tenders?:Array<{id:string;title:string;reference:string|null;stage:string;dueDate:string|null;projectId:string|null}>;estimates?:Array<{id:string;name:string;state:string;tenderId:string|null}>;upcoming?:Array<{id:string;name:string;date:string;start:string|null;status:string;projectId:string;project:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useDebounced(value:string,ms=200){const [v,setV]=useState(value);useEffect(()=>{const t=setTimeout(()=>setV(value),ms);return()=>clearTimeout(t);},[value,ms]);return v;}
// Capability-driven (server-enforced): create = quick add client/site/contact, edit = change master records,
// manage = import, merge, legacy linking and bulk changes.
const canCreate=(s:ReturnType<typeof useSession>)=>s.can('crm.create');
const canEdit=(s:ReturnType<typeof useSession>)=>s.can('crm.edit');
const canManage=(s:ReturnType<typeof useSession>)=>s.can('crm.manage');

export function ClientsArea({initialQuery}:{initialQuery?:string}){
 const session=useSession();
 const openId=initialQuery&&UUID.test(initialQuery)?initialQuery:null;
 const [view,setView]=useState<View>('clients'),[q,setQ]=useState(openId?'':initialQuery||''),[open,setOpen]=useState<string|null>(openId);
 const [adding,setAdding]=useState(false),[importing,setImporting]=useState(false),[linking,setLinking]=useState(false),[tick,setTick]=useState(0);
 const term=useDebounced(q);
 const reload=()=>{setTick(t=>t+1);refreshClients();};
 return <div className="grid gap-4">
  <PageHeader title="CRM" subtitle="Clients, their contacts and sites — entered once and chosen everywhere else."
   actions={<div className="flex flex-wrap gap-2">
    {canManage(session)&&<Btn variant="secondary" onClick={()=>setLinking(true)}><Link2 aria-hidden className="size-4"/>Link old records</Btn>}
    {canManage(session)&&<Btn variant="secondary" onClick={()=>setImporting(true)}><Upload aria-hidden className="size-4"/>Import</Btn>}
    {canCreate(session)&&<Btn onClick={()=>setAdding(true)}><Plus aria-hidden className="size-4"/>Add client</Btn>}
   </div>}/>
  <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400"/>
   <input type="search" aria-label="Search CRM" className={`${field} min-h-12 pl-9 text-base`} placeholder="Search name, ABN, code, contact, email, site or address…" value={q} onChange={e=>setQ(e.target.value)}/></div>
  <Tabs label="CRM records" active={view} onChange={setView} tabs={[{key:'clients',label:'Clients'},{key:'contacts',label:'Contacts'},{key:'sites',label:'Sites'}]}/>
  {view==='clients'?<ClientList q={term} tick={tick} onOpen={setOpen} onChanged={reload}/>:<PeopleOrSites key={view+term} view={view} q={term} tick={tick} onOpen={setOpen}/>}
  <Sheet open={Boolean(open)} onOpenChange={o=>{if(!o)setOpen(null);}}>
   <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl"><SheetTitle className="sr-only">Client</SheetTitle><SheetDescription className="sr-only">Client details, contacts, sites and work</SheetDescription>
    {open&&<ClientDrawer id={open} onChanged={reload} onOpen={setOpen}/>}
   </SheetContent>
  </Sheet>
  <Sheet open={adding} onOpenChange={setAdding}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">Add client</SheetTitle><SheetDescription className="sr-only">Quick create</SheetDescription>
   {adding&&<QuickClient onDone={id=>{setAdding(false);reload();if(id)setOpen(id);}}/>}</SheetContent></Sheet>
  <Sheet open={importing} onOpenChange={setImporting}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-4xl"><SheetTitle className="sr-only">Import CRM</SheetTitle><SheetDescription className="sr-only">Bulk import clients, contacts and sites</SheetDescription>
   {importing&&<CrmImporter onImported={reload}/>}</SheetContent></Sheet>
  <Sheet open={linking} onOpenChange={setLinking}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl"><SheetTitle className="sr-only">Link old records</SheetTitle><SheetDescription className="sr-only">Link legacy client names to CRM clients</SheetDescription>
   {linking&&<LegacyLinks onChanged={reload}/>}</SheetContent></Sheet>
 </div>;
}

function ClientList({q,tick,onOpen,onChanged}:{q:string;tick:number;onOpen:(id:string)=>void;onChanged:()=>void}){
 const session=useSession(),{busy,error,run}=useAction();
 const [showInactive,setShowInactive]=useState(false),[picked,setPicked]=useState<string[]>([]);
 const {data,error:loadError,loading,refresh}=useApi<{clients:Client[]}>(`/api/platform/clients?limit=200&inactive=1&q=${encodeURIComponent(q)}&t=${tick}`);
 const list=(data?.clients||[]).filter(c=>showInactive||c.status==='active'||q);
 const bulk=(status:'active'|'inactive')=>void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'bulk',ids:picked,change:{status}}}),()=>{setPicked([]);refresh();onChanged();});
 return <div className="grid gap-3">
  <div className="flex flex-wrap items-center gap-3 text-sm">
   <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>Show inactive clients</label>
   {picked.length>0&&canManage(session)&&<span className="flex flex-wrap items-center gap-2"><span className="text-slate-600">{picked.length} selected</span><Btn variant="secondary" className="min-h-9 py-1" busy={busy} onClick={()=>bulk('inactive')}>Mark inactive</Btn><Btn variant="secondary" className="min-h-9 py-1" busy={busy} onClick={()=>bulk('active')}>Mark active</Btn><Btn variant="ghost" className="min-h-9 py-1" onClick={()=>setPicked([])}>Clear</Btn></span>}
  </div>
  <ErrorState error={loadError||error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!list.length?<EmptyState title={q?'No clients match.':'No clients yet.'} detail={q?'Try a name, ABN, code, contact or site.':'Add a client, or import your existing customer list.'}/>:
  <section className="surface overflow-hidden"><ul className="divide-y">{list.map(c=><li key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
   {canManage(session)&&<input type="checkbox" className="size-4 shrink-0" aria-label={`Select ${c.name}`} checked={picked.includes(c.id)} onChange={e=>setPicked(p=>e.target.checked?[...p,c.id]:p.filter(x=>x!==c.id))}/>}
   <button className="grid min-w-0 flex-1 gap-0.5 text-left sm:grid-cols-[minmax(0,2fr)_1fr_1fr] sm:items-center sm:gap-3" onClick={()=>onOpen(c.id)}>
    <span className="min-w-0"><span className="flex items-center gap-2 font-medium"><Building2 aria-hidden className="size-4 shrink-0 text-slate-400"/><span className="truncate">{c.name}</span>{c.status!=='active'&&<Pill>Inactive</Pill>}</span><span className="block truncate text-xs text-slate-500">{[c.legalName&&c.legalName!==c.name?c.legalName:null,c.abn?`ABN ${formatAbn(c.abn)}`:null,c.clientCode].filter(Boolean).join(' · ')||'No legal name or ABN yet'}</span></span>
    <span className="truncate text-sm text-slate-600">{(c.contacts||[]).find(x=>x.isPrimary)?.name||c.contactName||'—'}</span>
    <span className="text-xs text-slate-500">{c.sites.length} site{c.sites.length===1?'':'s'} · {(c.contacts||[]).length} contact{(c.contacts||[]).length===1?'':'s'}</span>
   </button></li>)}</ul></section>}
  {list.length>=200&&<p className="text-xs text-slate-500">Showing the first 200. Search to narrow the list.</p>}
 </div>;
}

function PeopleOrSites({view,q,tick,onOpen}:{view:'contacts'|'sites';q:string;tick:number;onOpen:(id:string)=>void}){
 const [page,setPage]=useState(1);
 const {data,error,loading,refresh}=useApi<{items:Array<Row<Contact>|Row<Site>>;more:boolean}>(`/api/platform/clients?view=${view}&page=${page}&q=${encodeURIComponent(q)}&t=${tick}`);
 const items=data?.items||[];
 return <div className="grid gap-3"><ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!items.length?<EmptyState title={q?`No ${view} match.`:`No ${view} yet.`}/>:
  <section className="surface overflow-hidden"><ul className="divide-y">{items.map(x=><li key={x.id}><button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={()=>x.clientId&&onOpen(x.clientId)}>
   {view==='contacts'?<UserRound aria-hidden className="size-4 shrink-0 text-slate-400"/>:<MapPin aria-hidden className="size-4 shrink-0 text-slate-400"/>}
   <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium"><span className="truncate">{x.name}</span>{x.status&&x.status!=='active'&&<Pill>Inactive</Pill>}</span>
    <span className="block truncate text-xs text-slate-500">{view==='contacts'?[(x as Contact).role,(x as Contact).mobile||(x as Contact).phone,(x as Contact).email].filter(Boolean).join(' · '):(x as Site).address||''}</span></span>
   <span className="hidden truncate text-sm text-slate-600 sm:block sm:max-w-[40%]">{x.clientName}</span>
  </button></li>)}</ul></section>}
  {(page>1||data?.more)&&<div className="flex gap-2">{page>1&&<Btn variant="secondary" onClick={()=>setPage(p=>p-1)}>Previous</Btn>}{data?.more&&<Btn variant="secondary" onClick={()=>setPage(p=>p+1)}>Next</Btn>}</div>}
 </div>;
}

/** Minimal quick create: a name is enough; ABN, main contact and a site are optional. */
function QuickClient({onDone}:{onDone:(id?:string)=>void}){
 const [v,setV]=useState({name:'',abn:'',contact:'',email:'',phone:'',address:''}),{busy,error,run}=useAction();
 const [dupes,setDupes]=useState<Array<{id:string;name:string}>>([]);
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api<{client:Client;existing:boolean;possibleDuplicates:Array<{id:string;name:string}>}>('/api/platform/clients',{method:'POST',body:{action:'create',client:{name:v.name,abn:v.abn||null,contact:v.contact?{name:v.contact,email:v.email||null,phone:v.phone||null}:null,site:v.address?{address:v.address}:null}}}),r=>{if(r.possibleDuplicates.length&&!r.existing)setDupes(r.possibleDuplicates);onDone(r.client.id);});}}>
  <Field label="Client name" required><input className={field} required autoFocus value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field>
  <Field label="ABN" hint="Optional. A matching ABN or name opens the existing client instead of creating a duplicate."><input className={field} inputMode="numeric" value={v.abn} onChange={e=>setV({...v,abn:e.target.value})}/></Field>
  <details className="rounded-lg border bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-medium">Main contact and site (optional)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
   <Field label="Contact name"><input className={field} value={v.contact} onChange={e=>setV({...v,contact:e.target.value})}/></Field>
   <Field label="Contact email"><input className={field} type="email" value={v.email} onChange={e=>setV({...v,email:e.target.value})}/></Field>
   <Field label="Contact phone"><input className={field} value={v.phone} onChange={e=>setV({...v,phone:e.target.value})}/></Field>
   <Field label="Site address"><input className={field} value={v.address} onChange={e=>setV({...v,address:e.target.value})}/></Field>
  </div></details>
  {dupes.length>0&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Similar clients already exist: {dupes.map(d=>d.name).join(', ')}.</p>}
  <ErrorState error={error}/>
  <div className="flex gap-2"><Btn type="submit" busy={busy}>Save client</Btn><Btn type="button" variant="secondary" onClick={()=>onDone()}>Cancel</Btn></div>
 </form>;
}

type DrawerTab='overview'|'contacts'|'sites'|'work'|'merge';
function ClientDrawer({id,onChanged,onOpen}:{id:string;onChanged:()=>void;onOpen:(id:string)=>void}){
 const session=useSession();
 const {data,error,loading,refresh}=useApi<Work>(`/api/platform/clients?id=${encodeURIComponent(id)}`);
 const [tab,setTab]=useState<DrawerTab>('overview');
 const changed=()=>{refresh();refreshClients(id);onChanged();};
 if(loading&&!data)return <div className="p-5"><Loading label="Loading client…"/></div>;
 if(!data)return <div className="p-5"><ErrorState error={error} onRetry={refresh}/></div>;
 const c=data.client;
 return <div>
  <div className="sticky top-0 z-10 border-b bg-white px-5 py-4"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{c.name}</h2>{c.status!=='active'&&<Pill>Inactive</Pill>}</div><p className="text-sm text-slate-500">{[c.legalName&&c.legalName!==c.name?c.legalName:null,c.abn?`ABN ${formatAbn(c.abn)}`:null,c.clientCode].filter(Boolean).join(' · ')||'Client'}</p>
   <div className="mt-3"><Tabs label="Client" active={tab} onChange={setTab} tabs={[{key:'overview',label:'Overview'},{key:'contacts',label:`Contacts (${(c.contacts||[]).length})`},{key:'sites',label:`Sites (${c.sites.length})`},{key:'work',label:'Work'},{key:'merge',label:'Merge',hidden:!canManage(session)}]}/></div></div>
  <div className="grid gap-4 p-5">
   <ErrorState error={error}/>
   {tab==='overview'&&<ClientOverview client={c} onChanged={changed}/>}
   {tab==='contacts'&&<><ClientContacts clientId={id}/><ContactEditor client={c} onChanged={changed}/></>}
   {tab==='sites'&&<SiteEditor client={c} onChanged={changed}/>}
   {tab==='work'&&<ClientWork work={data}/>}
   {tab==='merge'&&<MergeClient client={c} onMerged={()=>{onChanged();onOpen(c.id);refresh();}}/>}
  </div>
 </div>;
}

function ClientOverview({client:c,onChanged}:{client:Client;onChanged:()=>void}){
 const session=useSession(),editable=canEdit(session),money=session.can('commercial.view'),{busy,error,run}=useAction();
 const init=()=>({name:c.name,legalName:c.legalName||'',abn:c.abn||'',clientCode:c.clientCode||'',contactName:c.contactName||'',email:c.email||'',phone:c.phone||'',website:c.website||'',tags:(c.tags||[]).join(', '),notes:c.notes||'',paymentTermsDays:c.paymentTermsDays==null?'':String(c.paymentTermsDays),creditStatus:c.creditStatus||'',billingEmail:c.billingEmail||'',accountReference:c.accountReference||''});
 const [v,setV]=useState(init);useEffect(()=>setV(init()),[c.id,c.revision]);// eslint-disable-line react-hooks/exhaustive-deps
 const set=(k:keyof ReturnType<typeof init>)=>(e:{target:{value:string}})=>setV(s=>({...s,[k]:e.target.value}));
 const save=()=>void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'update',id:c.id,revision:c.revision,client:{name:v.name,legalName:v.legalName||null,abn:v.abn||null,clientCode:v.clientCode||null,contactName:v.contactName,email:v.email,phone:v.phone,website:v.website||null,tags:v.tags.split(',').map(t=>t.trim()).filter(Boolean),notes:v.notes||null,...(money?{paymentTermsDays:v.paymentTermsDays===''?null:Number(v.paymentTermsDays),creditStatus:v.creditStatus||null,billingEmail:v.billingEmail||null,accountReference:v.accountReference||null}:{})}}}),onChanged);
 const status=()=>void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'update',id:c.id,revision:c.revision,client:{status:c.status==='active'?'inactive':'active'}}}),onChanged);
 const input=(k:keyof ReturnType<typeof init>,label:string,type='text',hint?:string)=><Field label={label} hint={hint}><input className={field} type={type} disabled={!editable} value={v[k]} onChange={set(k)}/></Field>;
 return <div className="grid gap-4">
  <Section title="Identity"><div className="grid gap-3 sm:grid-cols-2">{input('name','Trading name')}{input('legalName','Legal name')}{input('abn','ABN')}{input('clientCode','Client code')}{input('tags','Tags','text','Comma separated')}</div></Section>
  <Section title="Contact"><div className="grid gap-3 sm:grid-cols-2">{input('contactName','Main contact')}{input('phone','Main phone','tel')}{input('email','Main email','email')}{input('website','Website')}</div></Section>
  {money&&<Section title="Commercial" description="Visible to commercial roles only."><div className="grid gap-3 sm:grid-cols-2">{input('paymentTermsDays','Payment terms (days)','number')}{input('creditStatus','Credit status')}{input('billingEmail','Billing email','email')}{input('accountReference','Account reference')}</div></Section>}
  <Section title="Notes"><textarea className={`${field} min-h-20`} disabled={!editable} value={v.notes} onChange={set('notes')}/></Section>
  <ErrorState error={error}/>
  {editable&&<div className="flex flex-wrap gap-2"><Btn busy={busy} onClick={save}>Save client</Btn><Btn variant="secondary" busy={busy} onClick={status}>{c.status==='active'?'Mark inactive':'Reactivate'}</Btn></div>}
  {c.status!=='active'&&<p className="text-xs text-slate-500">Inactive clients stay linked to their existing records and remain searchable, but are not offered first in pickers.</p>}
 </div>;
}

/** Edit and inactivate/reactivate contacts (adding lives in ClientContacts above). */
function ContactEditor({client:c,onChanged}:{client:Client;onChanged:()=>void}){
 const session=useSession(),{busy,error,run}=useAction(),[edit,setEdit]=useState<Contact|null>(null);
 if(!canEdit(session))return null;
 const all=(c.contacts||[]);
 return <Section title="Edit contact details">
  <select aria-label="Contact to edit" className={field} value={edit?.id||''} onChange={e=>setEdit(all.find(x=>x.id===e.target.value)||null)}><option value="">Choose a contact…</option>{all.map(x=><option key={x.id} value={x.id}>{x.name}{x.status&&x.status!=='active'?' (inactive)':''}</option>)}</select>
  {edit&&<form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'updateContact',id:edit.id,revision:edit.revision,contact:{firstName:edit.firstName||null,lastName:edit.lastName||null,name:edit.name,role:edit.role,department:edit.department||null,email:edit.email,phone:edit.phone,mobile:edit.mobile,notes:edit.notes||null}}}),()=>{setEdit(null);onChanged();});}}>
   {(['name','firstName','lastName','role','department','email','phone','mobile'] as const).map(k=><Field key={k} label={{name:'Display name',firstName:'First name',lastName:'Last name',role:'Role / title',department:'Department',email:'Email',phone:'Phone',mobile:'Mobile'}[k]}><input className={field} value={String(edit[k]||'')} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></Field>)}
   <div className="flex flex-wrap gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Save contact</Btn><Btn type="button" variant="secondary" busy={busy} onClick={()=>void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'updateContact',id:edit.id,revision:edit.revision,contact:{archived:true}}}),()=>{setEdit(null);onChanged();})}>Mark inactive</Btn></div>
  </form>}
  <p className="mt-2 text-xs text-slate-500">Inactive contacts stay on past records and are hidden from pickers.</p>
  <ErrorState error={error}/>
 </Section>;
}

function SiteEditor({client:c,onChanged}:{client:Client;onChanged:()=>void}){
 const session=useSession(),editable=canEdit(session),addable=canCreate(session),{busy,error,run}=useAction();
 const [edit,setEdit]=useState<Site|null>(null),[add,setAdd]=useState({name:'',address:'',suburb:'',state:'',postcode:'',accessNotes:''});
 const post=(body:Record<string,unknown>,done:()=>void)=>void run(()=>api('/api/platform/clients',{method:'POST',body}),()=>{done();onChanged();});
 return <div className="grid gap-4">
  {c.sites.length?<ul className="divide-y rounded-lg border">{c.sites.map(s=><li key={s.id} className="flex flex-wrap items-center gap-2 p-3 text-sm"><MapPin aria-hidden className="size-4 text-slate-400"/><span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span>{s.status&&s.status!=='active'&&<span className="ml-2"><Pill>Inactive</Pill></span>}<span className="block text-xs text-slate-500">{[s.address&&s.address!==s.name?s.address:null,s.suburb,s.state,s.postcode].filter(Boolean).join(', ')||'No address recorded'}</span></span>{editable&&<Btn variant="ghost" className="min-h-9 px-2 text-xs" onClick={()=>setEdit(s)}>Edit</Btn>}</li>)}</ul>:<EmptyState title="No sites recorded for this client."/>}
  {edit&&<form className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();post({action:'updateSite',id:edit.id,revision:edit.revision||1,site:{name:edit.name,address:edit.address||null,suburb:edit.suburb||null,state:edit.state||null,postcode:edit.postcode||null,accessNotes:edit.accessNotes||null}},()=>setEdit(null));}}>
   {(['name','address','suburb','state','postcode','accessNotes'] as const).map(k=><Field key={k} label={{name:'Site name',address:'Address',suburb:'Suburb',state:'State',postcode:'Postcode',accessNotes:'Access notes'}[k]}><input className={field} value={String(edit[k]||'')} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></Field>)}
   <div className="flex flex-wrap gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Save site</Btn><Btn type="button" variant="secondary" busy={busy} onClick={()=>post({action:'updateSite',id:edit.id,revision:edit.revision||1,site:{status:edit.status==='inactive'?'active':'inactive'}},()=>setEdit(null))}>{edit.status==='inactive'?'Reactivate':'Mark inactive'}</Btn><Btn type="button" variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn></div>
  </form>}
  {addable&&!edit&&<form className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();post({action:'createSite',site:{clientId:c.id,...Object.fromEntries(Object.entries(add).map(([k,x])=>[k,x||null]))}},()=>setAdd({name:'',address:'',suburb:'',state:'',postcode:'',accessNotes:''}));}}>
   <p className="text-sm font-medium sm:col-span-2">Add a site</p>
   <Field label="Site name"><input className={field} value={add.name} onChange={e=>setAdd({...add,name:e.target.value})}/></Field>
   <Field label="Address"><input className={field} value={add.address} onChange={e=>setAdd({...add,address:e.target.value})}/></Field>
   <Field label="Suburb"><input className={field} value={add.suburb} onChange={e=>setAdd({...add,suburb:e.target.value})}/></Field>
   <Field label="State / postcode"><span className="flex gap-2"><input className={field} aria-label="State" value={add.state} onChange={e=>setAdd({...add,state:e.target.value})}/><input className={field} aria-label="Postcode" value={add.postcode} onChange={e=>setAdd({...add,postcode:e.target.value})}/></span></Field>
   <div className="sm:col-span-2"><Btn type="submit" busy={busy} disabled={!add.name&&!add.address}><Plus aria-hidden className="size-4"/>Add site</Btn></div>
  </form>}
  <ErrorState error={error}/>
 </div>;
}

function ClientWork({work:w}:{work:Work}){
 const {navigate}=useNav();
 const block=(title:string,items:ReactNode[],empty:string)=><Section title={title}>{items.length?<ul className="divide-y text-sm">{items}</ul>:<p className="text-sm text-slate-500">{empty}</p>}</Section>;
 const row=(key:string,label:ReactNode,detail:ReactNode,go?:()=>void)=><li key={key}><button disabled={!go} onClick={go} className="flex w-full items-center justify-between gap-2 py-2 text-left enabled:hover:bg-slate-50"><span className="min-w-0"><span className="block truncate font-medium">{label}</span><span className="block truncate text-xs text-slate-500">{detail}</span></span></button></li>;
 const sections=[
  w.projects&&block('Active projects',w.projects.active.map(p=>row(p.id,p.name,[p.projectNumber,p.stage,p.startDate&&`starts ${dateText(p.startDate)}`].filter(Boolean).join(' · '),()=>navigate('Projects','Projects',p.id))),'No active projects you can access.'),
  w.upcoming&&block('Upcoming work',w.upcoming.map(s=>row(s.id,s.name,[dateText(s.date),s.start,s.project,s.status].filter(Boolean).join(' · '),()=>navigate('Schedule','Schedule',s.projectId))),'No upcoming shifts.'),
  w.tenders&&block('Tenders',w.tenders.map(t=>row(t.id,t.title,[t.reference,t.stage,t.dueDate&&`due ${dateText(t.dueDate)}`].filter(Boolean).join(' · '),()=>navigate('Pipeline','Tenders',t.id))),'No tenders.'),
  w.opportunities&&block('Open opportunities',w.opportunities.map(o=>row(o.id,o.name,[o.stage,o.closingDate&&`closes ${dateText(o.closingDate)}`].filter(Boolean).join(' · '),()=>navigate('Pipeline','Opportunities',o.name))),'No open opportunities.'),
  w.estimates&&block('Estimates',w.estimates.map(e=>row(e.id,e.name,e.state,()=>e.tenderId?navigate('Pipeline','Tenders',e.tenderId,'estimate'):navigate('Pipeline','Estimates',e.id))),'No estimates.'),
  w.projects&&w.projects.completed.length>0&&block('Completed projects',w.projects.completed.map(p=>row(p.id,p.name,p.projectNumber||'',()=>navigate('Projects','Projects',p.id))),''),
 ].filter(Boolean);
 return sections.length?<div className="grid gap-4">{sections}</div>:<EmptyState title="No work records are available to you for this client."/>;
}

function MergeClient({client:c,onMerged}:{client:Client;onMerged:()=>void}){
 const [other,setOther]=useState<Client|null>(null),[preview,setPreview]=useState<{keep:{name:string};merge:{name:string};affected:Record<string,number>;warnings?:string[]}|null>(null),{busy,error,run}=useAction();
 const affected=useMemo(()=>preview?Object.entries(preview.affected).filter(([,n])=>n>0):[],[preview]);
 return <div className="grid gap-4">
  <p className="text-sm text-slate-600">Merge a duplicate into <strong>{c.name}</strong>. Its opportunities, tenders, projects, contacts and sites move here; the duplicate is kept as a merged record for history, never deleted. Existing record snapshots are not rewritten.</p>
  <ClientPicker label="Duplicate to merge into this client" value={other?.id} onChange={x=>{setOther(x&&x.id!==c.id?x:null);setPreview(null);}}/>
  {other&&!preview&&<Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api<{preview:NonNullable<typeof preview>}>('/api/platform/clients',{method:'POST',body:{action:'merge',keepId:c.id,mergeId:other.id,confirm:false}}),r=>setPreview(r.preview))}><Merge aria-hidden className="size-4"/>Preview merge</Btn>}
  {preview&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-medium">Keep {preview.keep.name} · merge {preview.merge.name}</p><p className="mt-1">{affected.length?affected.map(([k,n])=>`${n} ${k.toLowerCase()}`).join(', ')+' will move.':'No linked records will move.'}</p>{(preview.warnings||[]).length>0&&<ul className="mt-2 list-disc pl-5 text-amber-900">{preview.warnings!.map(w=><li key={w}>{w}</li>)}</ul>}
   <div className="mt-3 flex gap-2"><Btn busy={busy} onClick={()=>void run(()=>api('/api/platform/clients',{method:'POST',body:{action:'merge',keepId:c.id,mergeId:other!.id,confirm:true}}),()=>{setOther(null);setPreview(null);onMerged();})}>Confirm merge</Btn><Btn variant="secondary" onClick={()=>setPreview(null)}>Cancel</Btn></div></div>}
  <ErrorState error={error}/>
 </div>;
}
