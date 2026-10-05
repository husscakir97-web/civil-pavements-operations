'use client';
// Shared V1 workspace primitives: data loading with abort + retry, consistent
// status badges, headers with breadcrumbs, contextual empty/error states and
// honest money formatting ("Not available" instead of invented zeros).
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,ChevronRight,Loader2,RefreshCw} from 'lucide-react';
import {useWorkspaceBrand} from '@/components/workspace-brand';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {stateLabel,stateTone,type MachineKey,type Tone} from '@/lib/platform/workflow';
import {can as roleCan,type Capability} from '@/lib/platform/permissions';
import {usable,writable} from '@/lib/platform/modules';

export class ApiError extends Error{constructor(message:string,readonly status:number,readonly body:Record<string,unknown>){super(message);}}
export async function api<T=Record<string,unknown>>(url:string,init?:{method?:string;body?:unknown;signal?:AbortSignal}):Promise<T>{
 const isForm=init?.body instanceof FormData;
 const r=await fetch(url,{method:init?.method||'GET',cache:'no-store',signal:init?.signal,headers:init?.body&&!isForm?{'Content-Type':'application/json'}:undefined,body:init?.body===undefined?undefined:isForm?init.body as FormData:JSON.stringify(init.body)});
 const type=r.headers.get('content-type')||'';
 const data=type.includes('json')?await r.json().catch(()=>({})):{};
 if(!r.ok){
  if(r.status===401&&typeof window!=='undefined')window.location.assign('/login');
  const issues=Array.isArray(data.issues)?data.issues.map((i:{path?:string;message?:string})=>i.message).filter(Boolean).join(' '):'';
  // Scheduling conflicts arrive as structured objects: show the blocking ones in plain words.
  const conflicts=Array.isArray(data.conflicts)?data.conflicts.filter((c:{severity?:string})=>c.severity==='block').map((c:{message?:string})=>c.message).filter(Boolean).join(' '):'';
  const extra=conflicts||(Array.isArray(data.checks)?data.checks.map((c:{detail?:string;label?:string})=>c.detail||c.label).join(' '):Array.isArray(data.blockers)?data.blockers.join(' · '):Array.isArray(data.gaps)?data.gaps.join(' '):'');
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
 return {...s,can:(c:Capability)=>roleCan(s.role,c),module:(m:string)=>usable(s.entitlements,m),writable:(m:string)=>writable(s.entitlements,m)};
}

// Graphite Studio: tags are flat and square-cornered; only warning, success and danger carry colour (always with the word, never colour alone).
const toneClass:Record<Tone,string>={neutral:'bg-[var(--gs-fog)] text-slate-700 border-[var(--gs-line)]',info:'bg-transparent text-[var(--gs-ink)] border-[var(--gs-graphite)]',warning:'bg-[var(--gs-warn-bg)] text-[var(--gs-warn)] border-[var(--gs-warn-line)]',success:'bg-[var(--gs-ok-bg)] text-[var(--gs-ok)] border-[var(--gs-ok-line)]',danger:'bg-[var(--gs-error-bg)] text-[var(--gs-error)] border-[var(--gs-error-line)]'};
export function StatusBadge({machine,state,label}:{machine?:MachineKey;state:string;label?:string}){
 const tone=machine?stateTone(machine,state):'neutral';
 return <span className={`inline-flex items-center whitespace-nowrap rounded-[2px] border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>{label||(machine?stateLabel(machine,state):humanStatus(state))}</span>;
}
/** Human label for a stored status the workflow machines don't cover (e.g. legacy dockets): internal_approval → Internal approval. */
export function humanStatus(value:unknown){const s=String(value??'').trim();if(!s)return '';const t=s.replace(/[_-]+/g,' ').replace(/\s+/g,' ').toLowerCase();return t.charAt(0).toUpperCase()+t.slice(1);}
export function Pill({tone='neutral',children}:{tone?:Tone;children:ReactNode}){return <span className={`inline-flex items-center whitespace-nowrap rounded-[2px] border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>{children}</span>;}

export function Crumbs({items}:{items:Array<{label:string;onClick?:()=>void}>}){
 return <nav aria-label="Breadcrumb" className="gs-crumb mb-2 flex flex-wrap items-center gap-1 max-sm:flex-nowrap max-sm:overflow-hidden">{items.map((c,i)=><span key={i} className="flex min-w-0 items-center gap-1 max-sm:[&:not(:first-child):not(:last-child)]:hidden">{i>0&&<ChevronRight aria-hidden className="size-3"/>}{c.onClick?<button className="uppercase hover:text-slate-900 hover:underline" onClick={c.onClick}>{c.label}</button>:<span className="text-slate-700">{c.label}</span>}</span>)}</nav>;
}

export function PageHeader({title,subtitle,actions,crumbs,badges}:{title:ReactNode;subtitle?:ReactNode;actions?:ReactNode;crumbs?:Array<{label:string;onClick?:()=>void}>;badges?:ReactNode}){
 return <header className="workspace-page-header mb-7">{crumbs&&<Crumbs items={crumbs}/>}<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3"><div className="min-w-0"><h1 className="gs-title flex flex-wrap items-center gap-x-3 gap-y-1">{title}{badges&&<span className="inline-flex items-center text-[13px] font-normal tracking-normal">{badges}</span>}</h1>{subtitle&&<p className="mt-2.5 max-w-3xl text-[13px] leading-6 tracking-[0.02em] text-slate-500">{subtitle}</p>}</div>{actions&&<div className="flex flex-wrap gap-2">{actions}</div>}</div></header>;
}

export function Section({title,description,actions,children,className=''}:{title?:ReactNode;description?:ReactNode;actions?:ReactNode;children:ReactNode;className?:string}){
 return <section className={`surface overflow-hidden ${className}`}>{(title||actions)&&<div className="surface-header flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"><div className="min-w-0"><h2 className="text-[16px] font-medium tracking-[-0.01em] text-slate-900">{title}</h2>{description&&<p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}</div>{actions&&<div className="flex flex-wrap gap-2">{actions}</div>}</div>}<div className="p-4 sm:p-5">{children}</div></section>;
}

export function EmptyState({title,detail,action}:{title:string;detail?:string;action?:ReactNode}){
 return <div className="rounded-[2px] border border-dashed border-[var(--gs-line-strong)] p-6 text-center"><p className="text-sm font-medium text-slate-800">{title}</p>{detail&&<p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{detail}</p>}{action&&<div className="mt-4 flex justify-center">{action}</div>}</div>;
}
export function ErrorState({error,onRetry}:{error:string|Error|null|undefined;onRetry?:()=>void}){
 if(!error)return null;const message=typeof error==='string'?error:error.message;
 return <div role="alert" className="gs-note gs-note-error flex-wrap items-start gap-3 text-sm"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0"/><span className="min-w-0 flex-1">{message}</span>{onRetry&&<button className="inline-flex items-center gap-1 font-medium underline" onClick={onRetry}><RefreshCw aria-hidden className="size-3.5"/>Retry</button>}</div>;
}
export function Loading({label='Loading…'}:{label?:string}){return <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 aria-hidden className="size-4 animate-spin"/>{label}</p>;}

const aud=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0});
const audExact=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',minimumFractionDigits:2,maximumFractionDigits:2});
export function money(value:unknown,exact=false){if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return 'N/A';return (exact?audExact:aud).format(Number(value));}
export function pct(value:unknown){if(value===null||value===undefined||!Number.isFinite(Number(value)))return 'N/A';return `${Number(value).toFixed(1)}%`;}
export function dateText(value:unknown){if(!value)return 'Not set';const s=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return new Date(s+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):s;}

export function Stat({label,value,hint,tone}:{label:string;value:ReactNode;hint?:ReactNode;tone?:'good'|'warn'|'bad'}){
 const c=tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':tone==='bad'?'text-red-700':'text-slate-900';
 return <div className="metric-card border bg-white p-3.5"><p className="gs-eyebrow">{label}</p><p className={`mt-1.5 text-xl font-medium tracking-tight ${c}`}>{value}</p>{hint&&<p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}
export function NextAction({text,onClick,actionLabel='Go'}:{text:string|null|undefined;onClick?:()=>void;actionLabel?:string}){
 if(!text)return null;
 return <div className="next-action flex flex-wrap items-center gap-x-3 gap-y-2 border border-[var(--gs-line)] border-l-[3px] border-l-[var(--gs-graphite)] bg-[var(--gs-paper)] px-4 py-3 text-sm text-slate-900"><span className="gs-eyebrow">Next action</span><span className="min-w-[11rem] flex-1 font-semibold">{text}</span>{onClick&&<button className="inline-flex min-h-9 items-center gap-1 rounded-[2px] bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:brightness-125" onClick={onClick}>{actionLabel}<ChevronRight aria-hidden className="size-3.5"/></button>}</div>;
}
export function Progress({value,label}:{value:number|null|undefined;label?:string}){
 if(value==null)return <span className="text-xs text-slate-500">{label?`${label}: `:''}Not available</span>;
 return <div className="min-w-24"><div className="flex justify-between text-xs text-slate-500">{label&&<span>{label}</span>}<span>{value}%</span></div><div className="mt-1 h-1 bg-[var(--gs-line)]"><div className={`h-1 ${value>=100?'bg-[var(--gs-ok)]':'bg-[var(--gs-graphite)]'}`} style={{width:`${Math.min(100,Math.max(0,value))}%`}}/></div></div>;
}
export function Tabs<T extends string>({tabs,active,onChange,label}:{tabs:Array<{key:T;label:string;badge?:ReactNode;hidden?:boolean}>;active:T;onChange:(t:T)=>void;label:string}){
 return <nav aria-label={label} className="workspace-tabs gs-tabs mb-6 min-w-0">{tabs.filter(t=>!t.hidden).map(t=><button key={t.key} aria-current={active===t.key?'page':undefined} onClick={()=>onChange(t.key)} className="gs-tab inline-flex items-center gap-1.5">{t.label}{t.badge}</button>)}</nav>;
}
export const field='min-h-11 w-full rounded-[2px] border border-[var(--gs-line-strong)] bg-[var(--gs-sheet)] px-3 py-2 text-base sm:text-sm focus:border-[var(--gs-graphite)] focus:outline-none focus:ring-1 focus:ring-[var(--gs-graphite)] disabled:bg-[var(--gs-fog)] disabled:text-slate-500';
export function Field({label,children,hint,required}:{label:string;children:ReactNode;hint?:string;required?:boolean}){return <label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{label}{required&&<span aria-hidden="true" className="text-[var(--gs-error)]"> *</span>}</span>{children}{hint&&<span className="text-xs text-slate-500">{hint}</span>}</label>;}
/** Use for groups of buttons/checkboxes: a <label> would bind to the first control only. */
export function FieldGroup({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <div role="group" aria-label={label} className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{label}</span>{children}{hint&&<span className="text-xs text-slate-500">{hint}</span>}</div>;}
export function Btn({children,variant='primary',busy,className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'danger'|'ghost';busy?:boolean}){
 const v=variant==='primary'?'border-primary bg-primary text-primary-foreground hover:bg-[var(--gs-graphite-2)] hover:border-[var(--gs-graphite-2)]':variant==='danger'?'border-[var(--gs-error-line)] bg-transparent text-[var(--gs-error)] hover:bg-[var(--gs-error-bg)]':variant==='ghost'?'border-transparent bg-transparent text-slate-600 hover:bg-[var(--gs-fog)] hover:text-slate-900':'border-[var(--gs-line-strong)] bg-transparent text-slate-800 hover:border-[var(--gs-graphite)] hover:bg-[var(--gs-fog)]';
 return <button {...props} disabled={props.disabled||busy} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[2px] border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}>{busy&&<Loader2 aria-hidden className="size-4 animate-spin"/>}{children}</button>;
}

/** Decision with a note/reason (replaces browser prompts). `required` mirrors the server rule for that action. */
export function ReasonDialog({open,title,description,label,required=false,confirmLabel,danger=false,busy,onConfirm,onCancel}:{open:boolean;title:string;description:ReactNode;label:string;required?:boolean;confirmLabel:string;danger?:boolean;busy?:boolean;onConfirm:(reason:string)=>void;onCancel:()=>void}){
 const [text,setText]=useState('');
 const close=()=>{setText('');onCancel();};
 return <Dialog open={open} onOpenChange={o=>{if(!o)close();}}><DialogContent className="sm:max-w-lg"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>
  <form className="grid gap-4" onSubmit={e=>{e.preventDefault();if(required&&!text.trim())return;onConfirm(text.trim());setText('');}}>
   <Field label={label} required={required} hint={required?undefined:'Optional. Recorded in the audit trail.'}><textarea autoFocus className={`${field} min-h-24`} value={text} onChange={e=>setText(e.target.value)}/></Field>
   <div className="flex flex-wrap justify-end gap-2"><Btn type="button" variant="secondary" onClick={close}>Cancel</Btn><Btn type="submit" variant={danger?'danger':'primary'} busy={busy} disabled={required&&!text.trim()}>{confirmLabel}</Btn></div>
  </form></DialogContent></Dialog>;
}
