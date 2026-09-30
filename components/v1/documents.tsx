'use client';
// Documents workspace = the managed-document register: one row per logical document. Revisions live
// inside the document's detail (immutable versions, each with its own download). Files that predate
// the managed model stay reachable under "Legacy attachments". The server enforces every permission.
import {useEffect,useState} from 'react';
import {Archive,ArchiveRestore,Download,FileText,FolderOpen,History,Link2,Plus,Search,Upload,X} from 'lucide-react';
import {Sheet,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,ErrorState,Loading,Btn,Field,field,Pill,EmptyState} from './kit';
import {useNav} from './nav';

type Current={versionId:string;versionNumber:number;revisionLabel:string|null;issueDate:string|null;fileName:string;sizeBytes:number;contentType:string;fileDocumentId:string;url:string};
type Managed={id:string;title:string;description:string|null;documentNumber:string|null;documentType:string|null;discipline:string|null;tags:string[];status:string;contextType:string;contextId:string|null;projectId:string|null;contextName:string|null;revision:number;createdAt:string;updatedAt:string;current:Current|null};
type Version={id:string;versionNumber:number;revisionLabel:string|null;issueDate:string|null;author:string|null;company:string|null;changeNote:string|null;fileName:string;sizeBytes:number;sha256:string;createdByName:string|null;createdAt:string;current:boolean;url:string};
type Link={id:string;targetType:string;targetId:string;relationship:string;label:string};
type Detail={document:Managed;versions:Version[];links:Link[];hiddenLinks:number;permissions:{canEdit:boolean;canVersion:boolean}};
type Legacy={id:string;title:string;fileName:string;sizeBytes:number;category:string;version:number;status:string;contextType:string;contextId:string|null;projectId:string|null;contextName:string|null;createdAt:string;url:string};
const CONTEXTS:Array<[string,string]>=[['','All contexts'],['organisation','Company'],['project','Projects'],['tender','Tenders'],['variation','Variations'],['claim','Claims'],['action','Corrective actions'],['library','Library']];
const size=(n:number)=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
const date=(v:string)=>new Date(v).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
const rev=(c:{revisionLabel:string|null;versionNumber:number}|null)=>c?(c.revisionLabel?`Rev ${c.revisionLabel} · v${c.versionNumber}`:`v${c.versionNumber}`):'—';
const contextLabel=(d:{contextName:string|null;contextType:string})=>d.contextName||CONTEXTS.find(x=>x[0]===d.contextType)?.[1]||d.contextType.replaceAll('_',' ');
const LINK_TYPES:Record<string,string>={Project:'project',Tender:'tender',Client:'client',Variation:'variation',Claim:'claim'};

export function DocumentsWorkspace({initialQuery}:{initialQuery?:string}){
 const session=useSession();
 // Search results open a managed document directly through the route id `doc:<id>`.
 const direct=initialQuery?.startsWith('doc:')?initialQuery.slice(4):null;
 const start=direct?'':initialQuery||'';
 const [typed,setTyped]=useState(start),[q,setQ]=useState(start),[context,setContext]=useState(''),[archived,setArchived]=useState(false),[showCreate,setShowCreate]=useState(false),[open,setOpen]=useState<string|null>(direct),[legacyOpen,setLegacyOpen]=useState(false);
 useEffect(()=>{const t=setTimeout(()=>setQ(typed.trim()),250);return()=>clearTimeout(t);},[typed]);
 const params=new URLSearchParams();if(q)params.set('q',q);if(context)params.set('contextType',context);if(archived)params.set('archived','1');params.set('limit','250');
 const docs=useApi<{documents:Managed[]}>(`/api/managed-documents?${params.toString()}`);
 const rows=docs.data?.documents||[];
 return <div className="grid gap-4">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">Documents</h2><p className="mt-1 text-sm text-slate-500">One row per document. Open a document to see its current revision, full version history and links. Permissions and project scope are enforced on the server.</p></div>{session.can('document.upload')&&session.can('library.edit')&&<Btn onClick={()=>setShowCreate(v=>!v)}><Plus aria-hidden className="size-4"/>New document</Btn>}</div>
  {showCreate&&<CreateDocument onDone={id=>{setShowCreate(false);docs.refresh();if(id)setOpen(id);}} onCancel={()=>setShowCreate(false)}/>}
  <div className="grid gap-2 rounded-xl border bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_220px_auto] lg:items-end">
   <Field label="Search"><div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400"/><input className={`${field} pl-9`} type="search" placeholder="Title, number, type, discipline, tag, file name, revision…" value={typed} onChange={e=>setTyped(e.target.value)}/></div></Field>
   <Field label="Owning context"><select className={field} value={context} onChange={e=>setContext(e.target.value)}>{CONTEXTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
   <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Show archived</label>
  </div>
  <ErrorState error={docs.error} onRetry={docs.refresh}/>
  {docs.loading&&!docs.data?<Loading label="Loading documents…"/>:!rows.length?<EmptyState title={archived?'No archived documents.':'No documents match these filters.'} detail={q?'Try a broader search or clear a filter.':'Create a document, or upload files from a project or tender, and they appear here.'}/>:<div className="overflow-hidden rounded-xl border bg-white">
   <div className="border-b px-4 py-3 text-sm font-medium">{rows.length} document{rows.length===1?'':'s'}{rows.length===250?' shown (refine search for more)':''}</div>
   <ul className="divide-y">{rows.map(d=><li key={d.id}><button type="button" onClick={()=>setOpen(d.id)} className="grid w-full gap-2 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_170px_150px_120px] md:items-center">
    <span className="flex min-w-0 gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><FileText aria-hidden className="size-4"/></span><span className="min-w-0"><span className="block truncate font-medium">{d.documentNumber&&<span className="mr-2 text-slate-500">{d.documentNumber}</span>}{d.title}</span><span className="block truncate text-xs text-slate-500">{[d.documentType,d.discipline].filter(Boolean).join(' · ')||'No type set'} · {d.current?.fileName}</span>{d.tags.length>0&&<span className="mt-1 flex flex-wrap gap-1">{d.tags.map(t=><Pill key={t}>{t}</Pill>)}</span>}</span></span>
    <span className="truncate text-sm text-slate-700"><FolderOpen aria-hidden className="mr-1 inline size-3.5"/>{contextLabel(d)}</span>
    <span className="text-sm">{rev(d.current)}{d.status==='archived'&&<Pill tone="warning">archived</Pill>}</span>
    <span className="text-xs text-slate-500">Updated {date(d.updatedAt)}</span>
   </button></li>)}</ul>
  </div>}
  <div className="rounded-xl border bg-white">
   <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium" aria-expanded={legacyOpen} onClick={()=>setLegacyOpen(v=>!v)}><span>Legacy attachments <span className="font-normal text-slate-500">— files attached to records before managed documents (evidence, older uploads)</span></span><span className="text-slate-400">{legacyOpen?'Hide':'Show'}</span></button>
   {legacyOpen&&<LegacyAttachments q={q} context={context}/>}
  </div>
  <ManagedDocumentSheet id={open} onClose={()=>{setOpen(null);docs.refresh();}}/>
 </div>;
}

function LegacyAttachments({q,context}:{q:string;context:string}){
 const {navigate}=useNav();
 const params=new URLSearchParams({unmanaged:'1',limit:'100'});if(q)params.set('q',q);if(context)params.set('contextType',context);
 const docs=useApi<{documents:Legacy[]}>(`/api/documents?${params.toString()}`);
 const rows=docs.data?.documents||[];
 const openContext=(d:Legacy)=>{
  if(d.projectId){navigate('Projects','Projects',d.projectId,d.contextType==='variation'||d.contextType==='claim'?'commercial':['swms','itp','incident','ncr'].includes(d.contextType)?'quality':'documents');return;}
  if(d.contextType==='tender'&&d.contextId){navigate('Pipeline','Tenders',d.contextId);return;}
  if(['swms','itp','incident','ncr','action'].includes(d.contextType))navigate('IMS & HSEQ');
 };
 return <div className="border-t">
  <ErrorState error={docs.error} onRetry={docs.refresh}/>
  {docs.loading&&!docs.data?<Loading label="Loading…"/>:!rows.length?<p className="px-4 py-3 text-sm text-slate-500">No legacy attachments match.</p>:<ul className="divide-y">{rows.map(d=><li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
   <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.title}</span><span className="block truncate text-xs text-slate-500">{d.fileName} · {size(d.sizeBytes)} · {date(d.createdAt)}{d.version>1?` · v${d.version}`:''}{d.status!=='current'?` · ${d.status}`:''}</span></span>
   <button type="button" className="text-sky-800 hover:underline" onClick={()=>openContext(d)}>{contextLabel(d)}</button>
   <a href={d.url} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 font-medium text-slate-700 hover:bg-slate-50"><Download aria-hidden className="size-4"/>Download</a>
  </li>)}</ul>}
 </div>;
}

function CreateDocument({onDone,onCancel}:{onDone:(id:string|null)=>void;onCancel:()=>void}){
 const [fileValue,setFile]=useState<File|null>(null),[title,setTitle]=useState(''),[more,setMore]=useState(false),[v,setV]=useState({documentNumber:'',documentType:'',discipline:'',revisionLabel:'',issueDate:'',tags:''});
 const {busy,error,run}=useAction();
 const submit=()=>{if(!fileValue)return;const form=new FormData();form.set('file',fileValue);form.set('contextType','organisation');form.set('title',title||fileValue.name);for(const [k,val] of Object.entries(v))if(val)form.set(k,val);void run(()=>api<{id:string}>('/api/managed-documents',{method:'POST',body:form}),r=>onDone(r.id));};
 return <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2">
  <div className="sm:col-span-2"><h3 className="font-semibold">New company document</h3><p className="text-xs text-slate-500">Choose a file and give it a title — that is all that is required. Project, tender and other record files are added from their own pages so their permissions stay correct.</p></div>
  <Field label="File" required><input className={field} type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field>
  <Field label="Title"><input className={field} value={title} onChange={e=>setTitle(e.target.value)} placeholder={fileValue?.name||'Document title'}/></Field>
  <div className="sm:col-span-2"><button type="button" className="text-sm text-sky-800 underline" onClick={()=>setMore(m=>!m)}>{more?'Hide details':'Add number, type, revision…'}</button></div>
  {more&&<>
   <Field label="Document number"><input className={field} value={v.documentNumber} onChange={e=>setV({...v,documentNumber:e.target.value})}/></Field>
   <Field label="Type"><input className={field} value={v.documentType} onChange={e=>setV({...v,documentType:e.target.value})} placeholder="Drawing, Specification, Contract…"/></Field>
   <Field label="Discipline"><input className={field} value={v.discipline} onChange={e=>setV({...v,discipline:e.target.value})}/></Field>
   <Field label="Revision"><input className={field} value={v.revisionLabel} onChange={e=>setV({...v,revisionLabel:e.target.value})} placeholder="A, P01, IFC…"/></Field>
   <Field label="Issue date"><input className={field} type="date" value={v.issueDate} onChange={e=>setV({...v,issueDate:e.target.value})}/></Field>
   <Field label="Tags"><input className={field} value={v.tags} onChange={e=>setV({...v,tags:e.target.value})} placeholder="comma separated"/></Field>
  </>}
  <ErrorState error={error}/>
  <div className="flex gap-2 sm:col-span-2"><Btn busy={busy} disabled={!fileValue} onClick={submit}><Upload aria-hidden className="size-4"/>Create document</Btn><Btn variant="secondary" onClick={onCancel}>Cancel</Btn></div>
 </div>;
}

/** Managed-document detail: identity, current version, revisions, links. Reused by Projects. */
export function ManagedDocumentSheet({id,onClose}:{id:string|null;onClose:()=>void}){
 return <Sheet open={!!id} onOpenChange={o=>{if(!o)onClose();}}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">{id&&<DocumentDetail id={id}/>}</SheetContent></Sheet>;
}

function DocumentDetail({id}:{id:string}){
 const {navigate}=useNav();
 const {data,error,loading,refresh}=useApi<Detail>(`/api/managed-documents?id=${encodeURIComponent(id)}`);
 if(loading&&!data)return <div className="p-5"><Loading/></div>;
 if(!data)return <div className="p-5"><ErrorState error={error}/></div>;
 const d=data.document,perms=data.permissions;
 const owner=()=>{if(d.projectId)navigate('Projects','Projects',d.projectId,'documents');else if(d.contextType==='tender'&&d.contextId)navigate('Pipeline','Tenders',d.contextId);};
 return <div className="grid gap-5 p-5">
  <div><SheetTitle>{d.documentNumber&&<span className="mr-2 text-slate-500">{d.documentNumber}</span>}{d.title}</SheetTitle>
   <SheetDescription>{contextLabel(d)} · {rev(d.current)}{d.status==='archived'?' · archived':''}{(d.projectId||d.contextType==='tender')&&<> · <button type="button" className="text-sky-800 underline" onClick={owner}>Open owning record</button></>}</SheetDescription></div>
  <Identity key={d.revision} d={d} canEdit={perms.canEdit} onSaved={refresh}/>
  {d.current&&<section aria-label="Current version" className="grid gap-1 rounded-lg border p-3 text-sm">
   <p className="flex items-center justify-between gap-2"><span className="font-medium">Current version — {rev(d.current)}</span><a href={d.current.url} className="inline-flex min-h-9 items-center gap-1 rounded-lg border bg-white px-3 font-medium hover:bg-slate-50"><Download aria-hidden className="size-4"/>Download</a></p>
   <p className="text-slate-600">{d.current.fileName} · {size(d.current.sizeBytes)}{d.current.issueDate?` · issued ${d.current.issueDate}`:''}</p>
  </section>}
  {perms.canVersion&&<NewRevision id={d.id} currentVersion={d.current?.versionNumber??0} onDone={refresh}/>}
  <section aria-label="Version history" className="grid gap-2"><p className="flex items-center gap-2 font-medium"><History aria-hidden className="size-4"/>Version history</p>
   <ul className="divide-y rounded-lg border text-sm">{data.versions.map(v=><li key={v.id} className="grid gap-1 p-3">
    <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Version {v.versionNumber}{v.revisionLabel?` — Rev ${v.revisionLabel}`:''} {v.current?<Pill tone="success">Current</Pill>:<Pill>Historical</Pill>}</span><a href={v.url} className="inline-flex min-h-9 items-center gap-1 rounded-lg border bg-white px-3 hover:bg-slate-50"><Download aria-hidden className="size-4"/>Download</a></span>
    <span className="text-xs text-slate-500">{v.fileName} · {size(v.sizeBytes)} · uploaded {date(v.createdAt)}{v.createdByName?` by ${v.createdByName}`:''}{v.issueDate?` · issued ${v.issueDate}`:''}{v.author?` · author ${v.author}`:''}{v.company?` · ${v.company}`:''}</span>
    {v.changeNote&&<span className="text-slate-700">{v.changeNote}</span>}
    <span className="break-all font-mono text-[11px] text-slate-400">SHA-256 {v.sha256}</span>
   </li>)}</ul></section>
  <Links id={d.id} links={data.links} hidden={data.hiddenLinks} canEdit={perms.canEdit} onChanged={refresh}/>
  {perms.canEdit&&<Archiver d={d} onDone={refresh}/>}
 </div>;
}

function Identity({d,canEdit,onSaved}:{d:Managed;canEdit:boolean;onSaved:()=>void}){
 const [v,setV]=useState({title:d.title,description:d.description||'',documentNumber:d.documentNumber||'',documentType:d.documentType||'',discipline:d.discipline||'',tags:d.tags.join(', ')});
 const {busy,error,run}=useAction();
 const dirty=v.title!==d.title||v.description!==(d.description||'')||v.documentNumber!==(d.documentNumber||'')||v.documentType!==(d.documentType||'')||v.discipline!==(d.discipline||'')||v.tags!==d.tags.join(', ');
 if(!canEdit)return <section aria-label="Identity" className="grid gap-1 text-sm">{d.description&&<p>{d.description}</p>}<p className="text-slate-600">{[d.documentType,d.discipline].filter(Boolean).join(' · ')||'No type or discipline set'}</p>{d.tags.length>0&&<p className="flex flex-wrap gap-1">{d.tags.map(t=><Pill key={t}>{t}</Pill>)}</p>}</section>;
 return <form aria-label="Identity" className="grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/managed-documents',{method:'PATCH',body:{id:d.id,revision:d.revision,...v}}),onSaved);}}>
  <Field label="Title"><input className={field} required value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field>
  <Field label="Document number"><input className={field} value={v.documentNumber} onChange={e=>setV({...v,documentNumber:e.target.value})}/></Field>
  <Field label="Type"><input className={field} value={v.documentType} onChange={e=>setV({...v,documentType:e.target.value})}/></Field>
  <Field label="Discipline"><input className={field} value={v.discipline} onChange={e=>setV({...v,discipline:e.target.value})}/></Field>
  <div className="sm:col-span-2"><Field label="Tags"><input className={field} value={v.tags} onChange={e=>setV({...v,tags:e.target.value})} placeholder="comma separated"/></Field></div>
  <div className="sm:col-span-2"><Field label="Description"><textarea className={`${field} min-h-16`} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></div>
  <ErrorState error={error}/>
  <div className="sm:col-span-2"><Btn type="submit" busy={busy} disabled={!dirty}>Save details</Btn><span className="ml-2 text-xs text-slate-500">Editing details never changes a version or its file.</span></div>
 </form>;
}

function NewRevision({id,currentVersion,onDone}:{id:string;currentVersion:number;onDone:()=>void}){
 const [open,setOpen]=useState(false),[fileValue,setFile]=useState<File|null>(null),[v,setV]=useState({revisionLabel:'',issueDate:'',changeNote:''});
 const {busy,error,run}=useAction();
 if(!open)return <Btn variant="secondary" className="justify-self-start" onClick={()=>setOpen(true)}><Upload aria-hidden className="size-4"/>Upload new revision</Btn>;
 const submit=()=>{if(!fileValue)return;const form=new FormData();form.set('id',id);form.set('file',fileValue);form.set('expectedVersion',String(currentVersion));for(const [k,val] of Object.entries(v))if(val)form.set(k,val);void run(()=>api('/api/managed-documents/versions',{method:'POST',body:form}),()=>{setOpen(false);setFile(null);setV({revisionLabel:'',issueDate:'',changeNote:''});onDone();});};
 return <section aria-label="Upload new revision" className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2">
  <p className="text-sm font-medium sm:col-span-2">New revision — the previous version stays available and unchanged.</p>
  <Field label="File" required><input className={field} type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field>
  <Field label="Revision (optional)"><input className={field} value={v.revisionLabel} onChange={e=>setV({...v,revisionLabel:e.target.value})} placeholder="B, P02, IFC…"/></Field>
  <Field label="Issue date (optional)"><input className={field} type="date" value={v.issueDate} onChange={e=>setV({...v,issueDate:e.target.value})}/></Field>
  <Field label="Change note (optional)"><input className={field} value={v.changeNote} onChange={e=>setV({...v,changeNote:e.target.value})}/></Field>
  <ErrorState error={error}/>
  <div className="flex gap-2 sm:col-span-2"><Btn busy={busy} disabled={!fileValue} onClick={submit}>Upload revision</Btn><Btn variant="ghost" onClick={()=>setOpen(false)}>Cancel</Btn></div>
 </section>;
}

function Links({id,links,hidden,canEdit,onChanged}:{id:string;links:Link[];hidden:number;canEdit:boolean;onChanged:()=>void}){
 const [adding,setAdding]=useState(false),[term,setTerm]=useState(''),[found,setFound]=useState<Array<{id:string;name:string;type:string}>>([]);
 const {busy,error,run}=useAction();
 useEffect(()=>{if(!adding||term.trim().length<2)return;const abort=new AbortController(),t=setTimeout(()=>{api<{results:Array<{id:string;name:string;type:string}>}>(`/api/search?q=${encodeURIComponent(term.trim())}`,{signal:abort.signal}).then(r=>setFound(r.results.filter(x=>LINK_TYPES[x.type]))).catch(()=>{});},250);return()=>{clearTimeout(t);abort.abort();};},[term,adding]);
 return <section aria-label="Links" className="grid gap-2"><p className="flex items-center justify-between gap-2 font-medium"><span className="flex items-center gap-2"><Link2 aria-hidden className="size-4"/>Related records</span>{canEdit&&!adding&&<Btn variant="ghost" className="min-h-9 py-1" onClick={()=>setAdding(true)}><Plus aria-hidden className="size-4"/>Link a record</Btn>}</p>
  <p className="text-xs text-slate-500">Links are for navigation and search only. They never change who can open this document.</p>
  <ErrorState error={error}/>
  {links.length?<ul className="divide-y rounded-lg border text-sm">{links.map(l=><li key={l.id} className="flex items-center justify-between gap-2 p-2"><span><Pill>{l.targetType}</Pill> {l.label}</span>{canEdit&&<button type="button" aria-label="Remove link" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={()=>void run(()=>api(`/api/managed-documents/links?id=${encodeURIComponent(l.id)}`,{method:'DELETE'}),onChanged)}><X aria-hidden className="size-4"/></button>}</li>)}</ul>:<p className="text-sm text-slate-500">No linked records.</p>}
  {hidden>0&&<p className="text-xs text-slate-500">{hidden} more linked record{hidden===1?'':'s'} you do not have access to.</p>}
  {adding&&<div className="grid gap-2 rounded-lg border bg-slate-50 p-3"><Field label="Find a project, tender, client, variation or claim"><input className={field} value={term} onChange={e=>setTerm(e.target.value)} placeholder="Type at least two characters"/></Field>
   {adding&&term.trim().length>=2&&found.length>0&&<ul className="max-h-48 divide-y overflow-y-auto rounded border bg-white text-sm">{found.map(r=><li key={`${r.type}-${r.id}`}><button type="button" disabled={busy} className="flex w-full items-center gap-2 p-2 text-left hover:bg-slate-50" onClick={()=>void run(()=>api('/api/managed-documents/links',{method:'POST',body:{id,targetType:LINK_TYPES[r.type],targetId:r.id}}),()=>{setAdding(false);setTerm('');onChanged();})}><Pill>{r.type}</Pill>{r.name}</button></li>)}</ul>}
   <Btn variant="ghost" className="justify-self-start" onClick={()=>{setAdding(false);setTerm('');}}>Cancel</Btn></div>}
 </section>;
}

function Archiver({d,onDone}:{d:Managed;onDone:()=>void}){
 const {busy,error,run}=useAction(),archived=d.status==='archived';
 return <div className="grid gap-1 border-t pt-3"><ErrorState error={error}/><Btn variant="ghost" busy={busy} className="justify-self-start" onClick={()=>void run(()=>api('/api/managed-documents',{method:'PATCH',body:{id:d.id,revision:d.revision,archived:!archived}}),onDone)}>{archived?<ArchiveRestore aria-hidden className="size-4"/>:<Archive aria-hidden className="size-4"/>}{archived?'Restore document':'Archive document'}</Btn><p className="text-xs text-slate-500">Documents are archived, never deleted: every version is kept for evidence.</p></div>;
}
