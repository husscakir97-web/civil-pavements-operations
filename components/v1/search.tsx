'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,Search as SearchIcon} from 'lucide-react';
import {api,ErrorState,PageHeader,field,Pill,humanStatus,useSession} from './kit';
import {searchTarget} from '@/lib/v1/search-routing';
import {useNav} from './nav';

type Result={id:string;name:string;type:string;status:string;detail:string;area:string;projectId:string|null;tenderId?:string|null};
export function SearchV1(){
 const {navigate}=useNav();const {role}=useSession();
 const [q,setQ]=useState(''),[results,setResults]=useState<Result[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const term=q.trim();
 useEffect(()=>{
  if(term.length<2)return;
  const abort=new AbortController();
  const timer=setTimeout(()=>{setBusy(true);api<{results:Result[]}>(`/api/search?q=${encodeURIComponent(term)}`,{signal:abort.signal}).then(r=>{setResults(r.results);setError('');}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});},250);
  return()=>{clearTimeout(timer);abort.abort();};
 },[term]);
 // Opens the work context the record belongs to (lib/v1/search-routing.ts).
 const open=(r:Result)=>{const [a,s,id,tab]=searchTarget(r,role);navigate(a,s,id,tab);};
 const shown=term.length>=2?results:null;
 return <div className="mx-auto grid max-w-3xl gap-4">
  <PageHeader title="Search" subtitle="Projects, tenders, opportunities, clients, workers, plant, dockets, variations, claims, invoices and documents you are allowed to see."/>
  <label className="relative block"><span className="sr-only">Search</span><SearchIcon aria-hidden className="absolute left-3 top-3.5 size-4 text-slate-400"/><input id="workspace-search" autoFocus className={`${field} pl-9`} placeholder="Type at least two characters" value={q} onChange={e=>setQ(e.target.value)}/></label>
  <ErrorState error={error}/>
  {busy&&<p role="status" className="text-sm text-slate-500">Searching…</p>}
  {shown&&(shown.length?<ul className="surface divide-y">{shown.map(r=><li key={`${r.type}-${r.id}`}><button onClick={()=>open(r)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-slate-50"><Pill>{r.type}</Pill><span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-slate-500">{[r.detail,humanStatus(r.status)].filter(Boolean).join(' · ')}</span></span><ArrowRight aria-hidden className="size-4 text-slate-400"/></button></li>)}</ul>:<p className="text-sm text-slate-500">No matching records you can access.</p>)}
 </div>;
}
