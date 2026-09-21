'use client';
import {FormEvent,useState} from 'react';
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

 async function search(event:FormEvent){
  event.preventDefault();
  if(query.trim().length<2)return;
  setBusy(true);
  try{
   const r=await fetch('/api/search?q='+encodeURIComponent(query),{cache:'no-store'});
   const data=await r.json() as {error?:string;results:Result[]};
   if(!r.ok)throw new Error(data.error||'Search failed');
   setResults(data.results);
   setMessage(data.results.length?data.results.length+' matching record'+(data.results.length===1?'':'s'):'No matching records.');
  }catch(e){
   setMessage(e instanceof Error?e.message:'Search failed');
   setResults([]);
  }finally{setBusy(false);}
 }

 function open(result:Result){
  const target=destination(result);
  try{
   if(target.projectId)window.localStorage.setItem('infrastruct.project',target.projectId);
  }catch{}
  window.location.hash=encodeURIComponent(target.hash);
 }

 return <section className="space-y-5">
  <div><p className="text-sm font-medium text-slate-500">Global search</p><h1 className="text-2xl font-bold">Find work, not modules</h1><p className="mt-1 text-sm text-slate-600">Search across the organisation and jump directly to the authoritative workspace for the record.</p></div>
  <form onSubmit={search} className="flex gap-2 rounded-xl border bg-white p-3">
   <div className="relative flex-1"><SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"/><Input aria-label="Search company records" className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Dover Road, AC14, claim, docket, worker, plant…"/></div>
   <Button disabled={busy||query.trim().length<2}>{busy?'Searching…':'Search'}</Button>
  </form>
  <p role="status" className="text-sm text-slate-500">{message}</p>
  <div className="grid gap-3">
   {results.map(r=>{const target=destination(r);return <article key={r.type+r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4">
    <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{r.name}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{r.type}</span></div><p className="mt-1 text-sm text-slate-600">{r.status}</p></div>
    <Button variant="outline" onClick={()=>open(r)}>{target.label}<ArrowRight className="size-4"/></Button>
   </article>})}
  </div>
 </section>;
}
