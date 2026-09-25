'use client';
// AI assistance UI. Shows exactly why AI is unavailable, runs a feature through the
// orchestration service and lists source-linked suggestions. Accept/Reject are the
// person's decisions; accepting only ever creates or edits Draft/Suggested records.
import {useState,type ReactNode} from 'react';
import {Sparkles} from 'lucide-react';
import {api,useApi,useAction,useSession,Section,ErrorState,Loading,EmptyState,Btn,Pill,Field,field,dateText} from './kit';

type Gate={key:string;ok:boolean;detail:string};
type Feature={feature:string;label:string;available:boolean;gates:Gate[]};
type Status={installation:Gate[];organisationEnabled:boolean;organisationEnabledAt:string|null;features:Feature[]};
type Suggestion={id:string;field:string|null;content:Record<string,unknown>|string;sourceDocumentId:string|null;sourceLocation:string|null;confidence:number|null;extractedAt:string;status:string};

export function useAiStatus(){return useApi<Status>('/api/ai');}

function preview(s:Suggestion){
 const c=s.content;if(typeof c==='string')return c;
 if(c.title&&c.content)return `${c.title}\n\n${String(c.content).slice(0,1200)}`;
 if(c.response)return String(c.response);
 if(c.hazards||c.controls)return `Step: ${c.step}\nHazards: ${c.hazards||'—'}\nControls: ${c.controls||'—'}`;
 if(c.title)return `${c.title}${c.mandatory?' (mandatory)':''}${c.category?` · ${c.category}`:''}`;
 if(c.label)return `${c.label}: ${c.value}`;
 return JSON.stringify(c);
}

/** One AI feature bound to one record. Renders nothing for roles that can never use it. */
export function AiAssist({feature,title,description,entityType,entityId,runBody,onApplied,extra}:{feature:string;title:string;description:string;entityType:string;entityId:string;runBody:Record<string,unknown>;onApplied?:()=>void;extra?:ReactNode}){
 const status=useAiStatus();
 const list=useApi<{suggestions:Suggestion[]}>(`/api/ai?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&feature=${encodeURIComponent(feature)}`);
 const {busy,error,run}=useAction();
 const f=status.data?.features.find(x=>x.feature===feature);
 if(!f||!f.gates.find(g=>g.key==='permission')?.ok)return null;
 const open=(list.data?.suggestions||[]).filter(s=>s.status==='suggested'),decided=(list.data?.suggestions||[]).filter(s=>s.status!=='suggested');
 return <Section title={<span className="flex items-center gap-2"><Sparkles aria-hidden className="size-4"/>{title}</span>} description={description}>
  {!f.available?<div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><p className="font-medium text-slate-700">AI assistance is off. Everything here works without it.</p><ul className="mt-1 list-disc pl-5">{f.gates.filter(g=>!g.ok).map(g=><li key={g.key}>{g.detail}</li>)}</ul></div>:
   <div className="flex flex-wrap items-end gap-2">{extra}<Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api('/api/ai',{method:'POST',body:runBody}),()=>list.refresh())}><Sparkles aria-hidden className="size-4"/>Generate suggestions</Btn><span className="text-xs text-slate-500">Suggestions are drafts. Nothing is saved until you accept it, and nothing is ever approved automatically.</span></div>}
  <ErrorState error={error||list.error}/>
  {list.loading&&!list.data?<Loading/>:open.length>0&&<ul className="mt-3 grid gap-2">{open.map(s=><li key={s.id} className="rounded-lg border p-3 text-sm">
   <p className="whitespace-pre-wrap">{preview(s)}</p>
   <p className="mt-1 text-xs text-slate-500">Source: {s.sourceLocation||'not stated'} · confidence {s.confidence==null?'not stated':`${Math.round(s.confidence*100)}%`} · suggested {dateText(s.extractedAt)}</p>
   <div className="mt-2 flex gap-2"><Btn busy={busy} onClick={()=>void run(()=>api('/api/ai',{method:'POST',body:{action:'decide',id:s.id,decision:'accepted'}}),()=>{list.refresh();onApplied?.();})}>Accept as draft</Btn><Btn variant="ghost" busy={busy} onClick={()=>void run(()=>api('/api/ai',{method:'POST',body:{action:'decide',id:s.id,decision:'rejected'}}),()=>list.refresh())}>Reject</Btn></div>
  </li>)}</ul>}
  {decided.length>0&&<p className="mt-2 text-xs text-slate-500">{decided.filter(d=>d.status==='accepted').length} accepted · {decided.filter(d=>d.status==='rejected').length} rejected earlier.</p>}
 </Section>;
}

/** IMS document drafting from the Company Library. */
export function ImsDraftAssist({onApplied}:{onApplied?:()=>void}){
 const [v,setV]=useState({title:'',category:'Procedure',brief:''});
 return <AiAssist feature="ims.draft" title="Draft an IMS document" description="Drafts a procedure, plan or policy from your company profile and a short brief. The draft is added to the Company Library as Draft for review." entityType="library" entityId={`new:${v.category}:${v.title.trim().slice(0,100)}`} runBody={{action:'ims-draft',...v}} onApplied={onApplied}
  extra={<><Field label="Title"><input className={field} value={v.title} onChange={e=>setV({...v,title:e.target.value})} placeholder="Traffic management procedure"/></Field><Field label="Category"><select className={field} value={v.category} onChange={e=>setV({...v,category:e.target.value})}>{['Policy','Procedure','Quality information','Environmental information','Safety statistics'].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Brief"><input className={field} value={v.brief} onChange={e=>setV({...v,brief:e.target.value})} placeholder="Scope, key risks, client requirements"/></Field></>}/>;
}

/** Admin: installation gates, the organisation switch (with acknowledgement) and the usage ledger. */
export function AiAdmin(){
 const {can}=useSession();const status=useAiStatus();const {busy,error,run}=useAction();const [ack,setAck]=useState(false);
 const usage=useApi<{usage:Array<{id:string;feature:string;provider:string;model:string|null;status:string;input_tokens:number;output_tokens:number;created_at:string;error:string|null}>}>(can('org.admin')?'/api/ai?usage=1':null);
 if(status.loading&&!status.data)return <Loading/>;
 const d=status.data;if(!d)return <ErrorState error={status.error} onRetry={status.refresh}/>;
 return <Section title="AI assistance" description="AI only drafts. It never approves, submits or issues anything, and every workflow works without it.">
  <ul className="grid gap-1 text-sm">{d.installation.map(g=><li key={g.key} className="flex items-start gap-2"><Pill tone={g.ok?'success':'neutral'}>{g.ok?'Ready':'Off'}</Pill>{g.detail}</li>)}</ul>
  <div className="mt-3 rounded-lg border p-3 text-sm">
   <p className="font-medium">Organisation switch: {d.organisationEnabled?`on since ${dateText(d.organisationEnabledAt)}`:'off'}</p>
   {can('org.admin')&&(d.organisationEnabled?<Btn className="mt-2" variant="secondary" busy={busy} onClick={()=>void run(()=>api('/api/ai',{method:'PUT',body:{enabled:false}}),status.refresh)}>Switch AI off</Btn>:
    <div className="mt-2 grid gap-2"><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-5" checked={ack} onChange={e=>setAck(e.target.checked)}/><span>We understand AI output is a draft that a person must review, and that document text is sent to the configured AI provider for processing.</span></label><Btn className="justify-self-start" busy={busy} disabled={!ack} onClick={()=>void run(()=>api('/api/ai',{method:'PUT',body:{enabled:true,acknowledged:true}}),status.refresh)}>Switch AI on for the organisation</Btn></div>)}
  </div>
  <ErrorState error={error}/>
  {usage.data&&<div className="mt-3"><h3 className="text-sm font-semibold">Usage ledger</h3>{!usage.data.usage.length?<EmptyState title="No AI requests have been made."/>:<ul className="divide-y text-xs">{usage.data.usage.map(u=><li key={u.id} className="py-1.5">{dateText(u.created_at)} · {u.feature} · {u.provider}{u.model?`/${u.model}`:''} · {u.status} · {u.input_tokens}+{u.output_tokens} tokens{u.error?` · ${u.error}`:''}</li>)}</ul>}</div>}
 </Section>;
}

/** Admin: billing state as recorded from provider events (or the manual path). */
export function BillingAdmin(){
 const {data,error,loading,refresh}=useApi<{configured:boolean;provider:string|null;message:string;trial:{validUntil:string|null}|null;subscriptions:Array<{provider:string;plan_code:string;status:string;modules:string[];current_period_end:string|null;cancel_at:string|null;last_payment_failed_at:string|null}>;events:Array<{event_id:string;event_type:string;status:string;received_at:string}>}>('/api/billing');
 if(loading&&!data)return <Loading/>;
 if(!data)return <ErrorState error={error} onRetry={refresh}/>;
 return <Section title="Billing" description={data.message}>
  {data.trial&&<p className="text-sm">Beta trial{data.trial.validUntil?` until ${dateText(data.trial.validUntil)}`:' (no end date set)'}.</p>}
  {data.subscriptions.map(s=><div key={s.provider+s.plan_code} className="mt-2 rounded-lg border p-3 text-sm"><p className="font-medium">{s.plan_code} · {s.status} <span className="text-slate-500">({s.provider})</span></p><p className="text-xs text-slate-500">Modules: {s.modules.join(', ')||'none'}{s.current_period_end?` · period ends ${dateText(s.current_period_end)}`:''}{s.cancel_at?` · cancels ${dateText(s.cancel_at)}`:''}</p>{s.last_payment_failed_at&&<p className="mt-1 text-xs text-red-700">Last payment failed {dateText(s.last_payment_failed_at)}. Access continues until the provider cancels the subscription.</p>}</div>)}
  {data.events.length>0&&<div className="mt-3"><h3 className="text-sm font-semibold">Recent billing events</h3><ul className="divide-y text-xs">{data.events.map(e=><li key={e.event_id} className="py-1.5">{dateText(e.received_at)} · {e.event_type} · {e.status}</li>)}</ul></div>}
 </Section>;
}
