'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Plus,Trash2} from 'lucide-react';
import {api,useApi,useAction,useSession,ErrorState,Loading,Btn,Field,field,Section,Pill,dateText,EmptyState} from './kit';
import {RegisterView} from './register-view';
import {CompanyProfile} from './company';
import {WorkspaceBrandSettings} from '@/components/workspace-brand';
import {ROLES,ROLE_CAPABILITIES,CAPABILITIES} from '@/lib/platform/permissions';
import {MODULE_LABELS,type ModuleKey} from '@/lib/platform/modules';
import type {RateLibrary,RateItem} from '@/lib/estimate-calculations';

const RATE_GROUPS:Array<[keyof RateLibrary,string]>=[['labour','Labour'],['plant','Plant'],['materials','Materials'],['subcontractors','Subcontract'],['traffic','Common services / traffic'],['allowances','Allowances']];
export function RatesAdmin(){
 const {can}=useSession();
 const {data,error,loading,refresh}=useApi<{rateLibraries:RateLibrary[]}>('/api/estimates/rates');
 if(loading&&!data)return <Loading/>;
 if(error)return <ErrorState error={error} onRetry={refresh}/>;
 const library=data!.rateLibraries[0];
 if(!library)return <EmptyState title="No rate library yet." detail="Open Estimates once to create your organisation's starting library, then review every rate before quoting."/>;
 return <RatesForm key={library.id} library={library} editable={can('rates.edit')} onSaved={refresh}/>;
}
function RatesForm({library,editable,onSaved}:{library:RateLibrary;editable:boolean;onSaved:()=>void}){
 const [draft,setDraft]=useState<RateLibrary>(library);const {busy,error,run}=useAction();const [saved,setSaved]=useState(false);
 const update=(group:keyof RateLibrary,i:number,patch:Partial<RateItem>)=>setDraft(d=>({...d,[group]:(d[group] as RateItem[]).map((r,j)=>j===i?{...r,...patch}:r)}));
 return <div className="grid gap-4">
  <Section title="Rate library" description="Organisation-specific rates. Approved estimate revisions freeze the rates they used, so changing a rate here never changes an awarded project." actions={editable&&<Btn busy={busy} onClick={()=>void run(()=>api('/api/estimates/rates',{method:'POST',body:draft}),()=>{setSaved(true);onSaved();})}>Save rates</Btn>}>
   <div className="grid gap-4 sm:grid-cols-3"><Field label="Library name"><input className={field} disabled={!editable} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field><Field label="Target margin %"><input className={field} type="number" disabled={!editable} value={draft.targetMarginPct} onChange={e=>setDraft({...draft,targetMarginPct:Number(e.target.value)})}/></Field><Field label="GST %"><input className={field} type="number" disabled={!editable} value={draft.gstPct} onChange={e=>setDraft({...draft,gstPct:Number(e.target.value)})}/></Field></div>
   {!editable&&<p className="mt-3 text-sm text-slate-500">Only administrators can change rates.</p>}
   {saved&&<p role="status" className="mt-3 text-sm text-emerald-700">Rates saved. The change is recorded in the audit log.</p>}
   <div className="mt-3"><ErrorState error={error}/></div>
  </Section>
  {RATE_GROUPS.map(([group,label])=><Section key={group} title={label} actions={editable&&<Btn variant="secondary" onClick={()=>setDraft(d=>({...d,[group]:[...(d[group] as RateItem[]),{id:`${group}-${Date.now()}`,name:'',unit:'hour',rate:0}]}))}><Plus aria-hidden className="size-4"/>Add rate</Btn>}>
   {!(draft[group] as RateItem[]).length?<EmptyState title={`No ${label.toLowerCase()} rates.`}/>:<div className="grid gap-2">{(draft[group] as RateItem[]).map((r,i)=><div key={r.id} className="grid grid-cols-[1fr_6rem_7rem_auto] items-center gap-2"><input aria-label="Name" className={field} disabled={!editable} value={r.name} onChange={e=>update(group,i,{name:e.target.value})}/><input aria-label="Unit" className={field} disabled={!editable} value={r.unit} onChange={e=>update(group,i,{unit:e.target.value})}/><input aria-label="Rate" className={field} type="number" step="0.01" disabled={!editable} value={r.rate} onChange={e=>update(group,i,{rate:Number(e.target.value)})}/>{editable?<button aria-label="Remove rate" className="p-2 text-slate-400 hover:text-red-600" onClick={()=>setDraft(d=>({...d,[group]:(d[group] as RateItem[]).filter((_,j)=>j!==i)}))}><Trash2 className="size-4"/></button>:<span/>}</div>)}</div>}
  </Section>)}
 </div>;
}

export function TeamAdmin(){
 const label=(c:string)=>c.replace('.',' · ').replace(/_/g,' ');
 return <div className="grid gap-4">
  <Section title="Team members and invitations" description="Change roles, deactivate access (sessions are revoked immediately) and invite colleagues." actions={<Link className="inline-flex min-h-10 items-center rounded-lg bg-[#172633] px-3.5 text-sm font-medium text-white" href="/account">Manage team</Link>}><p className="text-sm text-slate-600">Every permission below is enforced on the server. Hiding a button is never the only protection.</p></Section>
  <Section title="Role permissions" description="Admin, Office and Field are active in V1. Additional roles are defined for future plans.">
   <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2 pr-3">Capability</th>{ROLES.map(r=><th key={r} className="px-2 py-2 capitalize">{r}</th>)}</tr></thead><tbody className="divide-y">{CAPABILITIES.map(c=><tr key={c}><td className="py-1.5 pr-3 capitalize text-slate-700">{label(c)}</td>{ROLES.map(r=><td key={r} className="px-2 py-1.5">{ROLE_CAPABILITIES[r].includes(c)?<span className="text-emerald-700">✓</span>:<span className="text-slate-300">—</span>}</td>)}</tr>)}</tbody></table></div>
  </Section>
 </div>;
}

export function IntegrationsAdmin(){
 const {data,error,loading,refresh}=useApi<{integrations:Array<{key:string;label:string;status:string;detail:string}>}>('/api/platform/integrations');
 return <Section title="Integrations" description="Connection status only. Secrets are configured in your hosting environment and are never displayed.">
  <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:<ul className="divide-y">{data?.integrations.map(i=><li key={i.key} className="flex flex-wrap items-start justify-between gap-2 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{i.label}</p><p className="mt-0.5 text-xs text-slate-500">{i.detail}</p></div><Pill tone={i.status==='connected'?'success':i.status==='disabled'||i.status.startsWith('key')?'warning':'neutral'}>{i.status.replaceAll('-',' ')}</Pill></li>)}</ul>}
 </Section>;
}

type EntRow={module:ModuleKey;label:string;status:string;detail:{source:string;plan_code:string|null}|null};
export function EntitlementsAdmin(){
 const {can,refresh:refreshSession}=useSession();
 const {data,error,loading,refresh}=useApi<{modules:EntRow[];billing:{note:string}}>('/api/platform/entitlements');
 const {busy,error:actionError,run}=useAction();
 return <Section title="Modules" description={data?.billing.note}>
  <ErrorState error={error||actionError} onRetry={refresh}/>{loading&&!data?<Loading/>:<ul className="divide-y">{data?.modules.map(m=><li key={m.module} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="text-sm font-medium">{m.label}</p><p className="text-xs text-slate-500">{m.module==='core'?'Always on':m.detail?`${m.detail.source}${m.detail.plan_code?` · ${m.detail.plan_code}`:''}`:''}</p></div>{m.module==='core'||!can('entitlements.manage')?<Pill tone={m.status==='active'?'success':m.status==='read_only'?'warning':'neutral'}>{m.status.replace('_',' ')}</Pill>:<select aria-label={`${m.label} access`} className={`${field} w-40`} disabled={busy} value={m.status} onChange={e=>void run(()=>api('/api/platform/entitlements',{method:'PUT',body:{module:m.module,status:e.target.value}}),async()=>{refresh();await refreshSession();})}><option value="active">Active</option><option value="read_only">Read-only</option><option value="disabled">Disabled</option></select>}</li>)}</ul>}
  <p className="mt-3 text-xs text-slate-500">Disabling a module hides it and blocks its routes. Records created while it was enabled are never deleted; choose Read-only to keep them viewable and exportable.</p>
 </Section>;
}

type AuditEvent={id:string;event_type:string;summary:string;actor_name:string|null;actor_email:string|null;created_at:string;entity_type:string};
export function ActivityLog({projectId}:{projectId?:string}){
 const {data,error,loading,refresh}=useApi<{events:AuditEvent[]}>(`/api/platform/audit${projectId?`?projectId=${projectId}`:''}`);
 return <Section title="Activity" description="Audit trail of controlled changes." actions={<Btn variant="secondary" onClick={refresh}>Refresh</Btn>}>
  <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:!data?.events.length?<EmptyState title="No activity has been recorded yet."/>:<ul className="divide-y">{data.events.map(e=><li key={e.id} className="py-2.5 text-sm"><p>{e.summary||e.event_type}</p><p className="mt-0.5 text-xs text-slate-500">{e.actor_name||e.actor_email||'System'} · {dateText(e.created_at)} · {e.event_type}</p></li>)}</ul>}
 </Section>;
}

export function AdminArea({sub,onNavigate}:{sub:string;onNavigate:(label:never)=>void}){
 const {can}=useSession();
 void onNavigate;
 if(sub==='Company')return <CompanyProfile/>;
 if(sub==='Rates')return <RatesAdmin/>;
 if(sub==='Company Library')return <RegisterView register="library" description="Reusable company knowledge. Tender returnables and project setup link to these items instead of duplicating them."/>;
 if(sub==='Team & Permissions')return <TeamAdmin/>;
 if(sub==='Integrations')return can('org.admin')?<IntegrationsAdmin/>:<EmptyState title="Integrations are managed by administrators."/>;
 if(sub==='Settings')return <div className="grid gap-4"><WorkspaceBrandSettings/><EntitlementsAdmin/>{can('audit.view')&&<ActivityLog/>}</div>;
 return null;
}
export {MODULE_LABELS};
