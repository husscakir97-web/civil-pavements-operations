'use client';
import {FormEvent,useState,useEffect,useRef,useCallback} from 'react';
import {ArrowRight,Search as SearchIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

type Result={id:string;name:string;type:string;status:string;metadata?:Record<string,unknown>};

function destination(result:Result){
 switch(result.type){
  case 'Project': return {label:'Open project workspace',hash:'Projects',projectId:result.id};
  case 'Opportunity': return {label:'Open pipeline',hash:'Pipeline/Opportunities'};
  case 'Estimate': return {label:'Open estimates',hash:'Pipeline/Estimates'};
  case 'Shift': return {label:'Open schedule',hash:'Operations/Schedule'};
  case 'Docket': return {label:'Open dockets',hash:'Operations/Dockets'};
  case 'Variation':
  case 'Commercial': return {label:'Open commercial',hash:'Commercial'};
  case 'Document': return {label:'Open IMS / HSEQ',hash:'IMS & HSEQ'};
  case 'Worker':
  case 'Plant': return {label:'Open resources',hash:'Operations/Resources'};
  default:return {label:'Open related workspace',hash:'Pipeline/Opportunities'};
 }
}

export function UniversalSearch(){
 const [query,setQuery]=useState('');
 const [results,setResults]=useState<Result[]>([]);
 const [message,setMessage]=useState('Search clients, tenders, projects, shifts, dockets, variations, documents, people or plant.');
 const [busy,setBusy]=useState(false);
 const [completedQuery,setCompletedQuery]=useState('');
 const pending=useRef<AbortController|null>(null);
 const scheduled=useRef<ReturnType<typeof setTimeout>|null>(null);
 const term=query.trim();

 const runSearch=useCallback(async()=>{
  if(term.length<2)return;
  pending.current?.abort();
  const abort=new AbortController();pending.current=abort;
  setBusy(true);
  try{
   const r=await fetch('/api/search?q='+encodeURIComponent(term),{cache:'no-store',signal:abort.signal});
   const data=await r.json() as {error?:string;results:Result[]};
   if(!r.ok)throw new Error(data.error||'Search failed');
   if(abort.signal.aborted)return;
   setResults(data.results);
   setCompletedQuery(term);
   setMessage(data.results.length?data.results.length+' matching record'+(data.results.length===1?'':'s'):'No matching records.');
  }catch(e){
   if(abort.signal.aborted)return;
   setMessage(e instanceof Error?e.message:'Search failed');
   setCompletedQuery(term);
   setResults([]);
  }finally{if(pending.current===abort){pending.current=null;setBusy(false);}}
 },[term]);

 useEffect(()=>{
  scheduled.current=setTimeout(()=>{scheduled.current=null;void runSearch();},300);
  return()=>{if(scheduled.current)clearTimeout(scheduled.current);pending.current?.abort();};
 },[runSearch]);

 function search(event:FormEvent){
  event.preventDefault();
  if(scheduled.current){clearTimeout(scheduled.current);scheduled.current=null;}
  void runSearch();
 }

 function open(result:Result){
  const target=destination(result);
  try{
   if(target.projectId)window.localStorage.setItem('infrastruct.project',target.projectId);
  }catch{}
  window.history.pushState(null,'','#'+encodeURIComponent(target.hash));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
 }

 return <section className="mx-auto max-w-4xl space-y-6 pt-4">
  <div><p className="mb-2 text-xs font-medium text-slate-500">Across your company</p><h1 className="text-3xl font-semibold tracking-tight">Find your work.</h1><p className="mt-2 text-sm text-slate-500">Projects, dockets, people and documents. All in one place.</p></div>
  <form onSubmit={search} className="surface flex items-center gap-2 p-3">
   <div className="relative min-w-0 flex-1"><SearchIcon aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"/><Input id="workspace-search" autoFocus aria-label="Search company records" className="h-11 border-0 pl-9 shadow-none" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a project, docket or client…"/></div>
   <Button disabled={busy||query.trim().length<2}>{busy?'Searching…':'Search'}</Button>
  </form>
  <p role="status" className="text-xs text-slate-500">{term.length<2?'Type at least two characters. Results appear as you type.':busy||completedQuery!==term?'Searching your workspace…':message}</p>
  <div className="grid gap-3">
   {(completedQuery===term&&term.length>=2?results:[]).map(r=>{const target=destination(r);return <article key={r.type+r.id} className="surface flex flex-wrap items-center justify-between gap-3 p-4">
    <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{r.name}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{r.type}</span></div><p className="mt-1 text-sm text-slate-600">{r.status}</p></div>
    <Button variant="outline" onClick={()=>open(r)}>{target.label}<ArrowRight className="size-4"/></Button>
   </article>})}
  </div>
 </section>;
}
