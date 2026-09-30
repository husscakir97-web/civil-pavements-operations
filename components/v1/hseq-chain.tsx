'use client';
// Incident / NCR chain: what happened → what we found → what needs to happen (and who owns it)
// → completed? → independently verified? → can this record close? The server enforces every rule.
import {useEffect,useState} from 'react';
import {CheckCircle2,ClipboardList,Plus,Search,ShieldCheck,XCircle} from 'lucide-react';
import {api,useApi,useAction,Section,EmptyState,ErrorState,Loading,Pill,Btn,Field,field,dateText} from './kit';

type Review={id:string;outcome:'accepted'|'rejected';note:string;reviewerUserId:string;completedBy:string|null;completedAt:string|null;completionNotes:string|null;createdAt:string};
type Action={id:string;action:string;ownerUserId:string|null;ownerName:string|null;dueDate:string|null;status:string;overdue:boolean;completionNotes:string|null;completedBy:string|null;completedAt:string|null;verifiedBy:string|null;verifiedAt:string|null;verificationNote:string|null;revision:number;reviews:Review[]};
type Investigation={id:string;status:string;summary:string|null;facts:string|null;finding:string|null;rootCause:string|null;rootCauseNotEstablished:boolean;contributingFactors:string|null;method:string|null;investigatorUserId:string|null;completedBy:string|null;completedAt:string|null;revision:number};
type Chain={source:{type:string;id:string;title:string;status:string|null;closureRationale:string|null;closedBy:string|null;closedAt:string|null;verification:string|null;cause:string|null};investigation:Investigation|null;investigationGaps:string[];actions:Action[];closure:{blockers:string[]}|null;names:Record<string,string>;can:{investigate:boolean;addAction:boolean;verify:boolean;close:boolean;userId:string}};
const STATUS_LABEL:Record<string,string>={open:'Open',in_progress:'In progress',complete:'Complete — awaiting verification',verified:'Verified'};
const post=(body:Record<string,unknown>)=>api('/api/hseq/chain',{method:'POST',body});
const when=(s:string|null)=>s?`${dateText(s)} ${s.slice(11,16)}`:'';

let peopleCache:Promise<Array<{id:string;name:string}>>|null=null;
function usePeople(){
 const [p,setP]=useState<Array<{id:string;name:string}>>([]);
 useEffect(()=>{peopleCache??=api<{people:Array<{id:string;name:string}>}>('/api/platform/people').then(r=>r.people).catch(()=>{peopleCache=null;return [];});let live=true;void peopleCache.then(x=>{if(live)setP(x);});return()=>{live=false;};},[]);
 return p;
}

export function HseqChain({sourceType,sourceId,onChanged}:{sourceType:'incident'|'ncr';sourceId:string;onChanged?:()=>void}){
 const {data,error,loading,refresh}=useApi<Chain>(`/api/hseq/chain?sourceType=${sourceType}&sourceId=${encodeURIComponent(sourceId)}`);
 const changed=()=>{refresh();onChanged?.();};
 if(loading&&!data)return <Loading/>;
 if(!data)return <ErrorState error={error} onRetry={refresh}/>;
 const closed=data.source.status==='closed';
 return <div className="grid gap-4 border-t pt-4">
  <InvestigationPanel data={data} sourceType={sourceType} sourceId={sourceId} onChanged={changed}/>
  <ActionsPanel data={data} sourceType={sourceType} sourceId={sourceId} closed={closed} onChanged={changed}/>
  <ClosurePanel data={data} sourceType={sourceType} sourceId={sourceId} onChanged={changed}/>
 </div>;
}

function InvestigationPanel({data,sourceType,sourceId,onChanged}:{data:Chain;sourceType:string;sourceId:string;onChanged:()=>void}){
 const inv=data.investigation,{busy,error,run}=useAction();
 const [draft,setDraft]=useState(()=>({summary:inv?.summary||'',facts:inv?.facts||'',finding:inv?.finding||'',rootCause:inv?.rootCause||'',rootCauseNotEstablished:Boolean(inv?.rootCauseNotEstablished),contributingFactors:inv?.contributingFactors||'',method:inv?.method||''}));
 const [reopen,setReopen]=useState('');
 const closed=data.source.status==='closed';
 if(!inv)return <Section title={<span className="flex items-center gap-2"><Search aria-hidden className="size-4"/>Investigation</span>} description="What did we find? Start an investigation when the cause needs to be understood.">
  {data.can.investigate&&!closed?<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void run(()=>post({action:'startInvestigation',sourceType,sourceId,summary:draft.summary}),onChanged);}}>
   <Field label="Scope / initial summary"><textarea className={`${field} min-h-16`} value={draft.summary} onChange={e=>setDraft({...draft,summary:e.target.value})}/></Field>
   <ErrorState error={error}/><Btn type="submit" busy={busy} className="justify-self-start">Start investigation</Btn>
  </form>:<EmptyState title="No investigation recorded."/>}
 </Section>;
 const editable=inv.status==='investigating'&&data.can.investigate&&!closed;
 const save=(then?:'complete')=>run(async()=>{await post({action:'updateInvestigation',id:inv.id,revision:inv.revision,values:draft});if(then)await post({action:'completeInvestigation',id:inv.id});},onChanged);
 return <Section title={<span className="flex items-center gap-2"><Search aria-hidden className="size-4"/>Investigation</span>} description={inv.status==='complete'?`Completed ${when(inv.completedAt)} by ${data.names[inv.completedBy||'']||'a team member'}.`:`Investigator: ${data.names[inv.investigatorUserId||'']||'—'}`} actions={<Pill tone={inv.status==='complete'?'success':'warning'}>{inv.status==='complete'?'Complete':'Investigating'}</Pill>}>
  {editable?<div className="grid gap-3 sm:grid-cols-2">
   <Field label="Summary / scope"><textarea className={`${field} min-h-20`} value={draft.summary} onChange={e=>setDraft({...draft,summary:e.target.value})}/></Field>
   <Field label="Facts and evidence"><textarea className={`${field} min-h-20`} value={draft.facts} onChange={e=>setDraft({...draft,facts:e.target.value})}/></Field>
   <Field label="Finding" required><textarea className={`${field} min-h-20`} value={draft.finding} onChange={e=>setDraft({...draft,finding:e.target.value})}/></Field>
   <div className="grid gap-2"><Field label="Root cause"><textarea className={`${field} min-h-20`} disabled={draft.rootCauseNotEstablished} value={draft.rootCause} onChange={e=>setDraft({...draft,rootCause:e.target.value})}/></Field>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={draft.rootCauseNotEstablished} onChange={e=>setDraft({...draft,rootCauseNotEstablished:e.target.checked})}/>Root cause could not be established</label></div>
   <Field label="Contributing factors"><textarea className={`${field} min-h-16`} value={draft.contributingFactors} onChange={e=>setDraft({...draft,contributingFactors:e.target.value})}/></Field>
   <Field label="Method (optional)"><input className={field} value={draft.method} maxLength={80} placeholder="e.g. 5 Whys, ICAM" onChange={e=>setDraft({...draft,method:e.target.value})}/></Field>
   {data.investigationGaps.length>0&&<ul className="list-disc rounded-lg bg-amber-50 p-3 pl-6 text-sm text-amber-900 sm:col-span-2">{data.investigationGaps.map(g=><li key={g}>{g}</li>)}</ul>}
   <ErrorState error={error}/>
   <div className="flex flex-wrap gap-2 sm:col-span-2"><Btn variant="secondary" busy={busy} onClick={()=>void save()}>Save</Btn><Btn busy={busy} onClick={()=>void save('complete')}><CheckCircle2 aria-hidden className="size-4"/>Save and complete investigation</Btn></div>
  </div>:<dl className="grid gap-3 text-sm sm:grid-cols-2">
   {([['Summary',inv.summary],['Facts and evidence',inv.facts],['Finding',inv.finding],['Root cause',inv.rootCauseNotEstablished?'Could not be established (recorded explicitly)':inv.rootCause],['Contributing factors',inv.contributingFactors],['Method',inv.method]] as const).map(([k,v])=><div key={k}><dt className="text-slate-500">{k}</dt><dd className="whitespace-pre-wrap">{v||'—'}</dd></div>)}
  </dl>}
  {inv.status==='complete'&&data.can.investigate&&!closed&&<form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void run(()=>post({action:'reopenInvestigation',id:inv.id,reason:reopen}),()=>{setReopen('');onChanged();});}}><div className="min-w-0 flex-1"><Field label="Reason to reopen"><input className={field} value={reopen} onChange={e=>setReopen(e.target.value)}/></Field></div><Btn type="submit" variant="ghost" busy={busy} disabled={reopen.trim().length<3}>Reopen investigation</Btn></form>}
  {inv.status==='complete'&&<ErrorState error={error}/>}
 </Section>;
}

function ActionsPanel({data,sourceType,sourceId,closed,onChanged}:{data:Chain;sourceType:string;sourceId:string;closed:boolean;onChanged:()=>void}){
 const people=usePeople(),{busy,error,run}=useAction();
 const [draft,setDraft]=useState({action:'',ownerUserId:'',dueDate:''}),[adding,setAdding]=useState(false);
 return <Section title={<span className="flex items-center gap-2"><ClipboardList aria-hidden className="size-4"/>Corrective actions</span>} description="What needs to happen, who owns it, whether it is done and who independently verified it." actions={data.can.addAction&&!closed&&!adding&&<Btn variant="secondary" onClick={()=>setAdding(true)}><Plus aria-hidden className="size-4"/>Add corrective action</Btn>}>
  {adding&&<form className="mb-3 grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-[1fr_12rem_10rem]" onSubmit={e=>{e.preventDefault();void run(()=>post({action:'addAction',sourceType,sourceId,actionText:draft.action,ownerUserId:draft.ownerUserId,dueDate:draft.dueDate||null}),()=>{setDraft({action:'',ownerUserId:'',dueDate:''});setAdding(false);onChanged();});}}>
   <Field label="Action" required><input className={field} required value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value})}/></Field>
   <Field label="Owner" required><select className={field} required value={draft.ownerUserId} onChange={e=>setDraft({...draft,ownerUserId:e.target.value})}><option value="">Choose…</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   <Field label="Due"><input className={field} type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})}/></Field>
   <div className="flex gap-2 sm:col-span-3"><Btn type="submit" busy={busy}>Add action</Btn><Btn type="button" variant="ghost" onClick={()=>setAdding(false)}>Cancel</Btn></div>
  </form>}
  <ErrorState error={error}/>
  {!data.actions.length?<EmptyState title="No corrective actions yet."/>:<ul className="grid gap-2">{data.actions.map(a=><ActionItem key={a.id} a={a} data={data} onChanged={onChanged}/>)}</ul>}
 </Section>;
}

function ActionItem({a,data,onChanged}:{a:Action;data:Chain;onChanged:()=>void}){
 const {busy,error,run}=useAction();const [note,setNote]=useState(''),[mode,setMode]=useState<null|'complete'|'review'>(null);
 const transition=(to:string,n?:string)=>run(()=>api('/api/registers/actions',{method:'PATCH',body:{id:a.id,transition:to,note:n}}),()=>{setMode(null);setNote('');onChanged();});
 const review=(outcome:'accepted'|'rejected')=>run(()=>post({action:'reviewAction',id:a.id,outcome,note}),()=>{setMode(null);setNote('');onChanged();});
 const ownCompletion=a.completedBy===data.can.userId;
 return <li className="rounded-lg border bg-white p-3 text-sm">
  <div className="flex flex-wrap items-start gap-2"><span className="min-w-0 flex-1"><span className="block font-medium">{a.action}</span><span className="block text-xs text-slate-500">{[a.ownerName||data.names[a.ownerUserId||'']||'No owner',a.dueDate?`due ${a.dueDate}`:'no due date'].join(' · ')}</span></span>
   {a.overdue&&<Pill tone="danger">Overdue</Pill>}<Pill tone={a.status==='verified'?'success':a.status==='complete'?'info':'warning'}>{STATUS_LABEL[a.status]||a.status}</Pill></div>
  {a.completedAt&&a.status!=='open'&&<p className="mt-2 text-xs text-slate-600">Completed by {data.names[a.completedBy||'']||'a team member'} {when(a.completedAt)}{a.completionNotes?`: ${a.completionNotes}`:''}</p>}
  {a.status==='verified'&&<p className="mt-1 flex items-center gap-1 text-xs text-emerald-800"><ShieldCheck aria-hidden className="size-3.5"/>Verified by {data.names[a.verifiedBy||'']||'a verifier'} {when(a.verifiedAt)}: {a.verificationNote}</p>}
  {a.reviews.filter(r=>r.outcome==='rejected').map(r=><p key={r.id} className="mt-1 flex items-start gap-1 text-xs text-red-800"><XCircle aria-hidden className="mt-0.5 size-3.5 shrink-0"/>Rejected by {data.names[r.reviewerUserId]||'a verifier'} {when(r.createdAt)}: {r.note} (completion by {data.names[r.completedBy||'']||'—'} kept in history)</p>)}
  {data.source.status!=='closed'&&<div className="mt-2 flex flex-wrap gap-2">
   {data.can.addAction&&a.status==='open'&&<Btn variant="ghost" className="min-h-9 py-1" busy={busy} onClick={()=>void transition('in_progress')}>Start</Btn>}
   {data.can.addAction&&(a.status==='open'||a.status==='in_progress')&&<Btn variant="secondary" className="min-h-9 py-1" onClick={()=>setMode(mode==='complete'?null:'complete')}>Mark complete</Btn>}
   {data.can.verify&&a.status==='complete'&&(ownCompletion?<span className="text-xs text-slate-500">You completed this action, so another authorised person must verify it.</span>:<Btn className="min-h-9 py-1" onClick={()=>setMode(mode==='review'?null:'review')}><ShieldCheck aria-hidden className="size-4"/>Verify</Btn>)}
  </div>}
  {mode&&<div className="mt-2 grid gap-2"><Field label={mode==='complete'?'Completion notes':'Verification note / reason'} required><textarea className={`${field} min-h-16`} value={note} onChange={e=>setNote(e.target.value)}/></Field>
   <div className="flex flex-wrap gap-2">{mode==='complete'?<Btn busy={busy} disabled={!note.trim()} onClick={()=>void transition('complete',note)}>Complete action</Btn>:<><Btn busy={busy} disabled={note.trim().length<3} onClick={()=>void review('accepted')}>Accept — verified</Btn><Btn variant="danger" busy={busy} disabled={note.trim().length<3} onClick={()=>void review('rejected')}>Reject for rework</Btn></>}<Btn variant="ghost" onClick={()=>setMode(null)}>Cancel</Btn></div></div>}
  <ErrorState error={error}/>
 </li>;
}

function ClosurePanel({data,sourceType,sourceId,onChanged}:{data:Chain;sourceType:'incident'|'ncr';sourceId:string;onChanged:()=>void}){
 const {busy,error,run}=useAction();const [text,setText]=useState('');
 if(data.source.status==='closed')return <Section title="Closure"><p className="text-sm">Closed by {data.names[data.source.closedBy||'']||'a team member'} {when(data.source.closedAt)}.{data.source.closureRationale&&<> Rationale: <em>{data.source.closureRationale}</em></>}{sourceType==='ncr'&&data.source.verification&&<> Final verification: <em>{data.source.verification}</em></>}</p></Section>;
 const blockers=data.closure?.blockers||[];
 const noChain=!data.investigation&&!data.actions.length;
 const label=sourceType==='incident'?(noChain?'Closure rationale (required without investigation or actions)':'Closure note (optional)'):'Final verification';
 return <Section title="Closure" description={blockers.length?'This record cannot close yet.':'Ready to close.'}>
  {blockers.length>0&&<ul className="mb-3 list-disc rounded-lg bg-amber-50 p-3 pl-6 text-sm text-amber-900">{blockers.map(b=><li key={b}>{b}</li>)}</ul>}
  {data.can.close?<div className="grid gap-2"><Field label={label}><textarea className={`${field} min-h-16`} value={text} onChange={e=>setText(e.target.value)}/></Field><ErrorState error={error}/>
   <Btn className="justify-self-start" busy={busy} onClick={()=>void run(()=>post({action:'close',sourceType,sourceId,...(sourceType==='incident'?{rationale:text}:{verification:text})}),onChanged)}>{sourceType==='incident'?'Close incident':'Verify and close NCR'}</Btn></div>
   :<p className="text-sm text-slate-500">{sourceType==='ncr'?'An authorised verifier closes NCRs.':'You cannot close this record.'}</p>}
 </Section>;
}

/** Review panel for a corrective action opened from the actions register. */
export function ActionReviewPanel({record,onChanged}:{record:Record<string,unknown>;onChanged:()=>void}){
 const {busy,error,run}=useAction();const [note,setNote]=useState('');
 if(record.status!=='complete')return null;
 return <div className="grid gap-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><ShieldCheck aria-hidden className="size-4"/>Independent verification</p>
  <p className="text-xs text-slate-600">Verification must be done by an authorised person who did not complete the action.</p>
  <Field label="Verification note / reason" required><textarea className={`${field} min-h-16`} value={note} onChange={e=>setNote(e.target.value)}/></Field><ErrorState error={error}/>
  <div className="flex flex-wrap gap-2"><Btn busy={busy} disabled={note.trim().length<3} onClick={()=>void run(()=>post({action:'reviewAction',id:record.id,outcome:'accepted',note}),onChanged)}>Accept — verified</Btn><Btn variant="danger" busy={busy} disabled={note.trim().length<3} onClick={()=>void run(()=>post({action:'reviewAction',id:record.id,outcome:'rejected',note}),onChanged)}>Reject for rework</Btn></div>
 </div>;
}
