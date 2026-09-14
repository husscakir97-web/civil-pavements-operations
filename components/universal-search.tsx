'use client';
import {FormEvent,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export function UniversalSearch(){
 const [query,setQuery]=useState(''),[results,setResults]=useState<{id:string;name:string;type:string;status:string}[]>([]),[message,setMessage]=useState('Enter at least two characters.'),[busy,setBusy]=useState(false);
 async function search(event:FormEvent){event.preventDefault();if(query.trim().length<2)return;setBusy(true);try{const r=await fetch('/api/search?q='+encodeURIComponent(query));const data=await r.json() as {error?:string;results:{id:string;name:string;type:string;status:string}[]};if(!r.ok)throw new Error(data.error||'Search failed');setResults(data.results);setMessage(data.results.length?'':'No matching records.');}catch(e){setMessage(e instanceof Error?e.message:'Search failed');setResults([]);}finally{setBusy(false);}}
 return <section className="space-y-4"><h1 className="text-2xl font-bold">Search</h1><form onSubmit={search} className="flex gap-2"><Input aria-label="Search company records" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Client, job, opportunity or docket"/><Button disabled={busy||query.trim().length<2}>{busy?'Searching…':'Search'}</Button></form><p role="status">{message}</p>{results.map(r=><article key={r.type+r.id} className="rounded-lg border bg-white p-4"><h2 className="font-semibold">{r.name}</h2><p className="text-sm text-slate-600">{r.type} · {r.status}</p></article>)}</section>;
}
