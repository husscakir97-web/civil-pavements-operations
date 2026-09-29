'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download,FileText,Filter,FolderOpen,Search,Upload} from 'lucide-react';
import {api,useApi,useAction,useSession,ErrorState,Loading,Btn,Field,field,Pill,EmptyState} from './kit';
import {useNav} from './nav';

type Doc={id:string;title:string;fileName:string;contentType:string;sizeBytes:number;category:string;version:number;status:string;visibility:string;source:string;contextType:string;contextId:string|null;projectId:string|null;contextName:string|null;uploadedBy:string|null;uploadedByName:string|null;createdAt:string;url:string};
const CONTEXTS:Array<[string,string]>=[['','All contexts'],['organisation','Company'],['project','Projects'],['tender','Tenders'],['swms','SWMS'],['itp','ITPs'],['incident','Incidents'],['ncr','NCRs'],['variation','Variations'],['claim','Claims'],['field','Field records'],['library','Library']];
const size=(n:number)=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
const date=(v:string)=>new Date(v).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
const contextLabel=(d:Doc)=>d.contextName||CONTEXTS.find(x=>x[0]===d.contextType)?.[1]||d.contextType.replaceAll('_',' ');

export function DocumentsWorkspace({initialQuery}:{initialQuery?:string}){
 const session=useSession(),{navigate}=useNav();
 const [typed,setTyped]=useState(initialQuery||''),[q,setQ]=useState(initialQuery||''),[context,setContext]=useState(''),[category,setCategory]=useState(''),[allVersions,setAllVersions]=useState(false),[showUpload,setShowUpload]=useState(false);
 useEffect(()=>{const t=setTimeout(()=>setQ(typed.trim()),250);return()=>clearTimeout(t);},[typed]);
 const params=new URLSearchParams();if(q)params.set('q',q);if(context)params.set('contextType',context);if(category)params.set('category',category);if(allVersions)params.set('all','1');params.set('limit','250');
 const docs=useApi<{documents:Doc[]}>(`/api/documents?${params.toString()}`);
 const categories=useMemo(()=>[...new Set((docs.data?.documents||[]).map(d=>d.category).filter(Boolean))].sort(),[docs.data]);
 const openContext=(d:Doc)=>{
  if(d.projectId){navigate('Projects','Projects',d.projectId,d.contextType==='variation'||d.contextType==='claim'?'commercial':d.contextType==='swms'||d.contextType==='itp'||d.contextType==='incident'||d.contextType==='ncr'?'quality':'documents');return;}
  if(d.contextType==='tender'&&d.contextId){navigate('Pipeline','Tenders',d.contextId);return;}
  if(['swms','itp','incident','ncr','action'].includes(d.contextType)){navigate('IMS & HSEQ');return;}
 };
 const rows=docs.data?.documents||[];
 return <div className="grid gap-4">
  <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">All documents</h2><p className="mt-1 text-sm text-slate-500">Search files across the workspaces you are authorised to see. Project scope and module permissions are enforced on the server.</p></div>{session.can('document.upload')&&<Btn onClick={()=>setShowUpload(v=>!v)}><Upload aria-hidden className="size-4"/>Upload company file</Btn>}</div>
  {showUpload&&<CompanyUpload onDone={()=>{setShowUpload(false);docs.refresh();}}/>}
  <div className="grid gap-2 rounded-xl border bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_220px_200px_auto] lg:items-end">
   <Field label="Search"><div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400"/><input className={`${field} pl-9`} type="search" placeholder="Title, file name, category…" value={typed} onChange={e=>setTyped(e.target.value)}/></div></Field>
   <Field label="Context"><select className={field} value={context} onChange={e=>setContext(e.target.value)}>{CONTEXTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
   <Field label="Category"><select className={field} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></Field>
   <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"><input type="checkbox" checked={allVersions} onChange={e=>setAllVersions(e.target.checked)}/>Show superseded</label>
  </div>
  <ErrorState error={docs.error} onRetry={docs.refresh}/>
  {docs.loading&&!docs.data?<Loading label="Loading documents…"/>:!rows.length?<EmptyState title="No documents match these filters." detail={q?'Try a broader search or clear a filter.':'Files attached to projects, tenders, HSEQ and other records will appear here automatically.'}/>:<div className="overflow-hidden rounded-xl border bg-white">
   <div className="flex items-center justify-between border-b px-4 py-3"><p className="text-sm font-medium">{rows.length} document{rows.length===1?'':'s'}{rows.length===250?' shown (refine search for more)':''}</p><span className="inline-flex items-center gap-1 text-xs text-slate-500"><Filter aria-hidden className="size-3.5"/>Permission-filtered</span></div>
   <ul className="divide-y">{rows.map(d=><li key={d.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_130px_auto] md:items-center">
    <div className="flex min-w-0 gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><FileText aria-hidden className="size-4"/></span><span className="min-w-0"><span className="block truncate font-medium">{d.title}</span><span className="block truncate text-xs text-slate-500">{d.fileName} · {size(d.sizeBytes)} · uploaded {date(d.createdAt)}{d.uploadedByName?` by ${d.uploadedByName}`:''}</span></span></div>
    <button type="button" className="min-w-0 text-left text-sm text-sky-800 hover:underline" onClick={()=>openContext(d)} title="Open owning context"><FolderOpen aria-hidden className="mr-1 inline size-3.5"/>{contextLabel(d)}</button>
    <div className="flex flex-wrap gap-1.5"><Pill>{d.category}</Pill><Pill tone={d.visibility==='field'?'success':'neutral'}>{d.visibility==='field'?'Field':'Office'}</Pill>{d.version>1&&<Pill>v{d.version}</Pill>}{d.status!=='current'&&<Pill tone="warning">{d.status}</Pill>}</div>
    <a href={d.url} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Download aria-hidden className="size-4"/>Download</a>
   </li>)}</ul>
  </div>}
 </div>;
}

function CompanyUpload({onDone}:{onDone:()=>void}){
 const [fileValue,setFile]=useState<File|null>(null),[title,setTitle]=useState(''),[category,setCategory]=useState('General'),[visibility,setVisibility]=useState<'office'|'field'>('office');
 const {busy,error,run}=useAction();
 const submit=()=>{if(!fileValue)return;const form=new FormData();form.set('file',fileValue);form.set('contextType','organisation');form.set('category',category);form.set('title',title||fileValue.name);form.set('visibility',visibility);void run(()=>api('/api/documents',{method:'POST',body:form}),onDone);};
 return <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2"><div className="sm:col-span-2"><h3 className="font-semibold">Upload company file</h3><p className="text-xs text-slate-500">For general organisation files. Project/tender/HSEQ files should still be uploaded from their owning record so context and permissions stay correct.</p></div><Field label="File"><input className={field} type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field><Field label="Title"><input className={field} value={title} onChange={e=>setTitle(e.target.value)} placeholder={fileValue?.name||'Document title'}/></Field><Field label="Category"><input className={field} value={category} onChange={e=>setCategory(e.target.value)}/></Field><Field label="Visibility"><select className={field} value={visibility} onChange={e=>setVisibility(e.target.value as 'office'|'field')}><option value="office">Office only</option><option value="field">Office and field</option></select></Field>{error&&<p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}<div className="flex gap-2 sm:col-span-2"><Btn busy={busy} disabled={!fileValue} onClick={submit}><Upload aria-hidden className="size-4"/>Upload</Btn><Btn variant="secondary" onClick={onDone}>Cancel</Btn></div></div>;
}
