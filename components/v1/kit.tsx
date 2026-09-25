'use client';
// Shared V1 workspace primitives: data loading with abort + retry, consistent
// status badges, headers with breadcrumbs, contextual empty/error states and
// honest money formatting ("Not available" instead of invented zeros).
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,ChevronRight,Loader2,RefreshCw} from 'lucide-react';
import {useWorkspaceBrand} from '@/components/workspace-brand';
import {stateLabel,stateTone,type MachineKey,type Tone} from '@/lib/platform/workflow';
import {can as roleCan,type Capability} from '@/lib/platform/permissions';

export class ApiError extends Error{constructor(message:string,readonly status:number,readonly body:Record<string,unknown>){super(message);}}
export async function api<T=Record<string,unknown>>(url:string,init?:{method?:string;body?:unknown;signal?:AbortSignal}):Promise<T>{
 const isForm=init?.body instanceof FormData;
 const r=await fetch(url,{method:init?.method||'GET',cache:'no-store',signal:init?.signal,headers:init?.body&&!isForm?{'Content-Type':'application/json'}:undefined,body:init?.body===undefined?undefined:isForm?init.body as FormData:JSON.stringify(init.body)});
 const type=r.headers.get('content-type')||'';
 const data=type.includes('json')?await r.json().catch(()=>({})):{};
 if(!r.ok){
  if(r.status===401&&typeof window!=='undefined')window.location.assign('/login');
  const issues=Array.isArray(data.issues)?data.issues.map((i:{path?:string;message?:string})=>i.message).filter(Boolean).join(' '):'';
  const extra=Array.isArray(data.checks)?data.checks.map((c:{detail?:string;label?:string})=>c.detail||c.label).join(' '):Array.isArray(data.blockers)?data.blockers.join(' · '):Array.isArray(data.gaps)?data.gaps.join(' '):'';
  throw new ApiError([data.error||(r.status===403?'You are not authorised for this action.':r.status===404?'Not found.':'The request failed. Please retry.'),issues,extra].filter(Boolean).join(' '),r.status,data);
 }
 return data as T;
}

/** Loads JSON with abort on change/unmount; refresh() re-runs. */
export function useApi<T>(url:string|null){
 const [tick,setTick]=useState(0);
 const key=url?`${url}#${tick}`:null;
 const [result,setResult]=useState<{key:string|null;data:T|null;error:ApiError|null}>({key:null,data:null,error:null});
 const refresh=useCallback(()=>setTick(t=>t+1),[]);
 useEffect(()=>{
  if(!key||!url)return;
  const abort=new AbortController();
  api<T>(url,{signal:abort.signal}).then(d=>setResult({key,data:d,error:null})).catch(e=>{if(!abort.signal.aborted)setResult(r=>({key,data:r.data,error:e instanceof ApiError?e:new ApiError('The request failed. Please retry.',0,{})}));});
  return()=>abort.abort();
 },[key,url]);
 const setData=useCallback((data:T|null)=>setResult(r=>({...r,data})),[]);
 return {data:url?result.data:null,error:url?result.error:null,loading:Boolean(key)&&result.key!==key,refresh,setData};
}

/** Runs a mutation, tracking busy/error state for a form or action button. */
export function useAction(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true);useEffect(()=>()=>{mounted.current=false;},[]);
 const run=useCallback(async<T,>(fn:()=>Promise<T>,onDone?:(v:T)=>void)=>{setBusy(true);setError('');try{const v=await fn();onDone?.(v);return v;}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The action failed.');return undefined;}finally{if(mounted.current)setBusy(false);}},[]);
 return {busy,error,setError,run};
}

export function useSession(){
 const s=useWorkspaceBrand();
 return {...s,can:(c:Capability)=>roleCan(s.role,c),module:(m:string)=>!s.entitlements||(s.entitlements as Record<string,string>)[m]!=='disabled',writable:(m:string)=>!s.entitlements||(s.entitlements as Record<string,string>)[m]==='active'};
}

const toneClass:Record<Tone,string>={neutral:'bg-slate-100 text-slate-700 border-slate-200',info:'bg-sky-50 text-sky-800 border-sky-200',warning:'bg-amber-50 text-amber-900 border-amber-200',success:'bg-emerald-50 text-emerald-800 border-emerald-200',danger:'bg-red-50 text-red-800 border-red-200'};
export function StatusBadge({machine,state,label}:{machine?:MachineKey;state:string;label?:string}){
 const tone=machine?stateTone(machine,state):'neutral';
 return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>{label||(machine?stateLabel(machine,state):state)}</span>;
}
export function Pill({tone='neutral',children}:{tone?:Tone;children:ReactNode}){return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>{children}</span>;}

export function Crumbs({items}:{items:Array<{label:string;onClick?:()=>void}>}){
 return <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">{items.map((c,i)=><span key={i} className="flex items-center gap-1">{i>0&&<ChevronRight aria-hidden className="size-3"/>}{c.onClick?<button className="hover:text-slate-900 hover:underline" onClick={c.onClick}>{c.label}</button>:<span className="text-slate-700">{c.label}</span>}</span>)}</nav>;
}

export function PageHeader({title,subtitle,actions,crumbs,badges}:{title:ReactNode;subtitle?:ReactNode;actions?:ReactNode;crumbs?:Array<{label:string;onClick?:()=>void}>;badges?:ReactNode}){
 return <header className="mb-5">{crumbs&&<Crumbs items={crumbs}/>}<div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{title}{badges}</h1>{subtitle&&<p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>{actions&&<div className="flex flex-wrap gap-2">{actions}</div>}</div></header>;
}

export function Section({title,description,actions,children,className=''}:{title?:ReactNode;description?:ReactNode;actions?:ReactNode;children:ReactNode;className?:string}){
 return <section className={`surface overflow-hidden ${className}`}>{(title||actions)&&<div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"><div className="min-w-0"><h2 className="font-semibold">{title}</h2>{description&&<p className="mt-0.5 text-xs text-slate-500">{description}</p>}</div>{actions&&<div className="flex flex-wrap gap-2">{actions}</div>}</div>}<div className="p-4 sm:p-5">{children}</div></section>;
}

export function EmptyState({title,detail,action}:{title:string;detail?:string;action?:ReactNode}){
 return <div className="rounded-lg border border-dashed bg-slate-50/60 p-6 text-center"><p className="text-sm font-medium text-slate-800">{title}</p>{detail&&<p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{detail}</p>}{action&&<div className="mt-4 flex justify-center">{action}</div>}</div>;
}
export function ErrorState({error,onRetry}:{error:string|Error|null|undefined;onRetry?:()=>void}){
 if(!error)return null;const message=typeof error==='string'?error:error.message;
 return <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0"/><span className="min-w-0 flex-1">{message}</span>{onRetry&&<button className="inline-flex items-center gap-1 font-medium underline" onClick={onRetry}><RefreshCw aria-hidden className="size-3.5"/>Retry</button>}</div>;
}
export function Loading({label='Loading…'}:{label?:string}){return <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 aria-hidden className="size-4 animate-spin"/>{label}</p>;}

const aud=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0});
const audExact=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',minimumFractionDigits:2,maximumFractionDigits:2});
export function money(value:unknown,exact=false){if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return 'N/A';return (exact?audExact:aud).format(Number(value));}
export function pct(value:unknown){if(value===null||value===undefined||!Number.isFinite(Number(value)))return 'N/A';return `${Number(value).toFixed(1)}%`;}
export function dateText(value:unknown){if(!value)return 'Not set';const s=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):s;}

export function Stat({label,value,hint,tone}:{label:string;value:ReactNode;hint?:ReactNode;tone?:'good'|'warn'|'bad'}){
 const c=tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':tone==='bad'?'text-red-700':'text-slate-900';
 return <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-semibold ${c}`}>{value}</p>{hint&&<p className="mt-0.5 text-xs text-slate-500">{hint}</p>}</div>;
}
export function NextAction({text,onClick}:{text:string|null|undefined;onClick?:()=>void}){
 if(!text)return null;
 return <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900"><span className="text-xs font-semibold uppercase tracking-wide text-orange-700">Next action</span><span className="min-w-0 flex-1">{text}</span>{onClick&&<button className="text-xs font-medium underline" onClick={onClick}>Go</button>}</div>;
}
export function Progress({value,label}:{value:number|null|undefined;label?:string}){
 if(value==null)return <span className="text-xs text-slate-500">{label?`${label}: `:''}Not available</span>;
 return <div className="min-w-24"><div className="flex justify-between text-xs text-slate-500">{label&&<span>{label}</span>}<span>{value}%</span></div><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${value>=100?'bg-emerald-500':value>=50?'bg-amber-500':'bg-orange-500'}`} style={{width:`${Math.min(100,Math.max(0,value))}%`}}/></div></div>;
}
export function Tabs<T extends string>({tabs,active,onChange,label}:{tabs:Array<{key:T;label:string;badge?:ReactNode;hidden?:boolean}>;active:T;onChange:(t:T)=>void;label:string}){
 return <nav aria-label={label} className="workspace-tabs mb-5 flex min-w-0 gap-1 overflow-x-auto border-b">{tabs.filter(t=>!t.hidden).map(t=><button key={t.key} aria-current={active===t.key?'page':undefined} onClick={()=>onChange(t.key)} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${active===t.key?'border-primary font-semibold text-slate-900':'border-transparent text-slate-500 hover:text-slate-900'}`}>{t.label}{t.badge}</button>)}</nav>;
}
export const field='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-500';
export function Field({label,children,hint,required}:{label:string;children:ReactNode;hint?:string;required?:boolean}){return <label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{label}{required&&<span className="text-red-600"> *</span>}</span>{children}{hint&&<span className="text-xs text-slate-500">{hint}</span>}</label>;}
/** Use for groups of buttons/checkboxes: a <label> would bind to the first control only. */
export function FieldGroup({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <div role="group" aria-label={label} className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{label}</span>{children}{hint&&<span className="text-xs text-slate-500">{hint}</span>}</div>;}
export function Btn({children,variant='primary',busy,className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'danger'|'ghost';busy?:boolean}){
 const v=variant==='primary'?'bg-[#172633] text-white hover:bg-[#263c4c] border-[#172633]':variant==='danger'?'bg-white text-red-700 border-red-300 hover:bg-red-50':variant==='ghost'?'border-transparent bg-transparent text-slate-700 hover:bg-slate-100':'bg-white text-slate-800 border-slate-300 hover:bg-slate-50';
 return <button {...props} disabled={props.disabled||busy} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}>{busy&&<Loader2 aria-hidden className="size-4 animate-spin"/>}{children}</button>;
}
