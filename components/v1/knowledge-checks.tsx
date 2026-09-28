'use client';

import {useEffect,useMemo,useState} from 'react';
import {BookOpenCheck,CheckCircle2,HelpCircle,ShieldAlert,TriangleAlert} from 'lucide-react';

type Source={id:string;title:string;authority:string|null;referenceCode:string|null;revisionLabel:string|null;jurisdiction:string|null;sourceClause:string|null;sourcePage:string|null;effectiveFrom:string|null;effectiveTo:string|null;sourceType:string|null;sourceUrl:string|null;documentId:string|null;origin:'platform'|'organisation'};
type Result={ruleId:string;ruleCode:string;title:string;topic:string;severity:'block'|'warning'|'advisory';applicability:'applicable'|'unknown';result:'pass'|'fail'|'needs_context'|'advisory';message:string;field:string|null;actual:unknown;expected:unknown;source:Source;scope:{type:string;id:string|null}};
type Response={onDate:string;summary:{rules:number;applicable:number;passed:number;failed:number;advisory:number;needsContext:number;blocking:number};results:Result[]};

const sourceLabel=(s:Source)=>[s.authority,s.referenceCode,s.revisionLabel,s.sourceClause&&'Clause '+s.sourceClause,s.sourcePage&&'Page '+s.sourcePage].filter(Boolean).join(' · ')||s.title;

export function KnowledgeCheckPanel({context,topics,scope,title='Specification checks',className=''}:{context:Record<string,unknown>;topics?:string[];scope?:Record<string,string|null|undefined>;title?:string;className?:string}){
 const [data,setData]=useState<Response|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const signature=useMemo(()=>JSON.stringify({context,topics:topics||[],scope:scope||{}}),[context,topics,scope]);
 useEffect(()=>{
  let live=true;const timer=setTimeout(async()=>{
   setLoading(true);setError(null);
   try{
    const r=await fetch('/api/platform/knowledge/check',{method:'POST',headers:{'Content-Type':'application/json'},body:signature});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||'Knowledge check failed.');
    if(live)setData(body as Response);
   }catch(e){if(live)setError(e instanceof Error?e.message:'Knowledge check failed.');}
   finally{if(live)setLoading(false);}
  },350);
  return()=>{live=false;clearTimeout(timer);};
 },[signature]);
 if(!loading&&!error&&!data?.results.length)return null;
 const failed=data?.results.filter(r=>r.result==='fail')||[];
 const needs=data?.results.filter(r=>r.result==='needs_context')||[];
 const advisory=data?.results.filter(r=>r.result==='advisory')||[];
 const passed=data?.results.filter(r=>r.result==='pass')||[];
 return <section className={'rounded-xl border bg-white '+className} aria-label={title}>
  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><BookOpenCheck className="size-4 text-orange-600"/><h4 className="font-semibold text-slate-900">{title}</h4>{loading&&<span className="text-xs text-slate-400">Checking…</span>}{data&&<span className="ml-auto text-xs text-slate-500">{data.summary.applicable} applicable · {data.summary.blocking} blocking</span>}</div>
  <div className="grid gap-2 p-3">
   {error&&<p className="text-sm text-red-700">{error}</p>}
   {[...failed,...needs,...advisory,...passed].map(r=>{const Icon=r.result==='fail'?ShieldAlert:r.result==='needs_context'?HelpCircle:r.result==='pass'?CheckCircle2:TriangleAlert;const box=r.result==='fail'?(r.severity==='block'?'border-red-200 bg-red-50':'border-amber-200 bg-amber-50'):r.result==='pass'?'border-emerald-200 bg-emerald-50':r.result==='needs_context'?'border-sky-200 bg-sky-50':'border-slate-200 bg-slate-50';return <div key={r.ruleId} className={'rounded-lg border p-3 '+box}><div className="flex gap-2"><Icon className="mt-0.5 size-4 shrink-0"/><div className="min-w-0"><p className="text-sm font-semibold">{r.title}</p><p className="mt-1 text-sm">{r.message}</p>{r.field&&<p className="mt-1 text-xs text-slate-600">Field: {r.field}{r.actual!==undefined?' · Actual '+String(r.actual):''}{r.expected!==undefined?' · Required '+(Array.isArray(r.expected)?r.expected.join('–'):String(r.expected)):''}</p>}<p className="mt-1 text-xs font-medium text-slate-500">{sourceLabel(r.source)} · {r.source.origin==='platform'?'Infrastruct knowledge':r.scope.type==='organisation'?'Organisation knowledge':r.scope.type.replaceAll('_',' ')+'-specific rule'}</p>{r.source.sourceUrl&&<a className="mt-1 inline-block text-xs font-semibold text-orange-700 underline" href={r.source.sourceUrl} target="_blank" rel="noreferrer">Open governing source</a>}</div></div></div>;})}
  </div>
 </section>;
}
