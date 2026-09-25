'use client';
import {useState} from 'react';
import {Download,FileSignature,Plus,Trash2} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,field,Section,dateText,Pill} from './kit';
import {useCachedApi,useOffline,requestId,isNetworkFailure} from './offline';
import {allowedTransitions} from '@/lib/platform/workflow';
import {HIGH_RISK_WORK,PPE_OPTIONS,type SwmsContent} from '@/lib/v1/swms-content';

type SwmsRow={id:string;projectId:string;projectName:string;reference:string;title:string;activity:string;status:string;currentRevisionNumber:number;issuedRevisionId:string|null;acknowledgements:number;acknowledgedByMe:boolean};
type Revision={id:string;revision_number:number;status:string;origin:string;change_reason:string|null;approved_at:string|null;issued_at:string|null;updated_at:string;content:SwmsContent};
type Detail={swms:SwmsRow&{currentRevisionId:string};revisions:Revision[];acknowledgements:Array<{worker_name:string;acknowledged_at:string}>};

export function SwmsPanel({projectId,shiftId,onChanged}:{projectId?:string;shiftId?:string;onChanged?:()=>void}){
 const {can,role}=useSession();
 const {data,error,loading,refresh,cachedAt}=useCachedApi<{swms:SwmsRow[]}>(`/api/hseq/swms${projectId?`?projectId=${projectId}`:''}`);
 const [open,setOpen]=useState<string|'new'|null>(null);
 return <Section title="Safe Work Method Statements" description="Draft from a questionnaire, review, approve and issue. Approved versions are immutable; changes create a new revision." actions={projectId&&can('hseq.edit')&&<Btn onClick={()=>setOpen('new')}><Plus aria-hidden className="size-4"/>Create SWMS</Btn>}>
  <ErrorState error={error} onRetry={refresh}/>
  {cachedAt&&<p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Offline copy saved {new Date(cachedAt).toLocaleString('en-AU')}.</p>}
  {loading&&!data?<Loading/>:!data?.swms.length?<EmptyState title={role==='field'?'No SWMS have been issued for this project yet.':'No SWMS have been created for this project.'} action={projectId&&can('hseq.edit')?<Btn variant="secondary" onClick={()=>setOpen('new')}>Create SWMS</Btn>:undefined}/>:
   <ul className="divide-y">{data.swms.map(s=><li key={s.id}><button className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-slate-50" onClick={()=>setOpen(s.id)}><span className="min-w-0 flex-1"><span className="block font-medium">{s.reference} · {s.title}</span><span className="block text-xs text-slate-500">{!projectId&&`${s.projectName} · `}{s.activity} · Rev {s.currentRevisionNumber}</span></span><StatusBadge machine="swms" state={s.status}/>{s.issuedRevisionId&&<Pill tone={s.acknowledgedByMe?'success':'warning'}>{role==='field'?(s.acknowledgedByMe?'Acknowledged':'Acknowledge'):`${s.acknowledgements} acknowledged`}</Pill>}</button></li>)}</ul>}
  <Sheet open={Boolean(open)} onOpenChange={o=>{if(!o)setOpen(null);}}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">{open==='new'?'Create SWMS':'SWMS'}</SheetTitle><SheetDescription className="sr-only">Safe work method statement</SheetDescription>
   {open==='new'&&projectId&&<SwmsQuestionnaireForm projectId={projectId} onCreated={id=>{refresh();onChanged?.();setOpen(id);}}/>}
   {open&&open!=='new'&&<SwmsDetail id={open} shiftId={shiftId} onChanged={()=>{refresh();onChanged?.();}}/>}
  </SheetContent></Sheet>
 </Section>;
}

function SwmsQuestionnaireForm({projectId,onCreated}:{projectId:string;onCreated:(id:string)=>void}){
 const {busy,error,run}=useAction();
 const [q,setQ]=useState({title:'',activity:'',location:'',steps:'',highRiskWork:[] as string[],plant:'',equipment:'',substances:'',ppe:['Hard hat','Hi-vis clothing','Safety boots'] as string[],competencies:'',licences:'',permits:'',emergency:'',responsiblePeople:''});
 const toggle=(k:'highRiskWork'|'ppe',v:string)=>setQ(s=>({...s,[k]:s[k].includes(v)?s[k].filter(x=>x!==v):[...s[k],v]}));
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api<{swmsId:string}>('/api/hseq/swms',{method:'POST',body:{action:'create',projectId,title:q.title,questionnaire:{activity:q.activity,location:q.location,workSteps:q.steps.split('\n').map(s=>s.trim()).filter(Boolean),highRiskWork:q.highRiskWork,plant:q.plant,equipment:q.equipment,substances:q.substances,ppe:q.ppe,competencies:q.competencies,licences:q.licences,permits:q.permits,emergency:q.emergency,responsiblePeople:q.responsiblePeople}}}),r=>onCreated(r.swmsId));}}>
  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Answers generate an editable draft with standard hazards and controls for the high-risk work you select. A competent person must review and tailor it before approval.</p>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="SWMS title" required><input className={field} required value={q.title} onChange={e=>setQ({...q,title:e.target.value})}/></Field><Field label="Activity / task" required><input className={field} required value={q.activity} onChange={e=>setQ({...q,activity:e.target.value})}/></Field><Field label="Location"><input className={field} value={q.location} onChange={e=>setQ({...q,location:e.target.value})}/></Field><Field label="Responsible people" required><input className={field} value={q.responsiblePeople} onChange={e=>setQ({...q,responsiblePeople:e.target.value})}/></Field></div>
  <Field label="Work steps" hint="One step per line"><textarea className={`${field} min-h-28`} value={q.steps} onChange={e=>setQ({...q,steps:e.target.value})}/></Field>
  <fieldset className="grid gap-2"><legend className="text-sm font-medium">High-risk construction work</legend>{HIGH_RISK_WORK.map(h=><label key={h.key} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={q.highRiskWork.includes(h.key)} onChange={()=>toggle('highRiskWork',h.key)}/>{h.label}</label>)}</fieldset>
  <fieldset className="grid gap-2"><legend className="text-sm font-medium">PPE</legend><div className="flex flex-wrap gap-2">{PPE_OPTIONS.map(p=><label key={p} className="flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm"><input type="checkbox" checked={q.ppe.includes(p)} onChange={()=>toggle('ppe',p)}/>{p}</label>)}</div></fieldset>
  <div className="grid gap-4 sm:grid-cols-2">{([['plant','Plant'],['equipment','Equipment'],['substances','Hazardous substances'],['competencies','Competencies'],['licences','Licences'],['permits','Permits'],['emergency','Emergency arrangements']] as const).map(([k,label])=><Field key={k} label={label}><textarea className={`${field} min-h-16`} value={q[k]} onChange={e=>setQ({...q,[k]:e.target.value})}/></Field>)}</div>
  <ErrorState error={error}/>
  <Btn className="justify-self-start" busy={busy} type="submit">Generate draft</Btn>
 </form>;
}

function SwmsDetail({id,shiftId,onChanged}:{id:string;shiftId?:string;onChanged:()=>void}){
 const {role,can}=useSession();
 const {data,error,loading,refresh,cachedAt}=useCachedApi<Detail>(`/api/hseq/swms?id=${id}`);
 const {busy,error:actionError,run}=useAction();const offline=useOffline();const [queued,setQueued]=useState(false);
 const [draft,setDraft]=useState<SwmsContent|null>(null);const [note,setNote]=useState('');
 if(loading&&!data)return <div className="p-5"><Loading/></div>;
 if(error&&!data)return <div className="p-5"><ErrorState error={error} onRetry={refresh}/></div>;
 const d=data!,current=d.revisions.find(r=>r.id===d.swms.currentRevisionId)||d.revisions[0],issued=d.revisions.find(r=>r.id===d.swms.issuedRevisionId);
 const shown=role==='field'?issued:current;
 if(!shown)return <div className="p-5"><EmptyState title="This SWMS has not been issued yet."/></div>;
 const editing=draft&&shown.status==='draft';const c=editing?draft:shown.content;
 const done=()=>{refresh();onChanged();};
 const act=(body:Record<string,unknown>)=>run(()=>api('/api/hseq/swms',{method:'POST',body:{...body,id}}),()=>{setDraft(null);setNote('');done();});
 const transitions=role==='field'?[]:allowedTransitions('swms',shown.status,role);
 const setStep=(i:number,k:string,v:string)=>setDraft(x=>x&&({...x,workSteps:x.workSteps.map((s,j)=>j===i?{...s,[k]:v}:s)}));
 return <div className="grid gap-4 p-5">
  <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{d.swms.reference} · {d.swms.title}</h3><StatusBadge machine="swms" state={shown.status}/><span className="text-sm text-slate-500">Revision {shown.revision_number}</span></div>
  <div className="flex flex-wrap gap-2">
   <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm" href={`/api/hseq/swms?id=${id}&format=pdf&revisionId=${shown.id}`}><Download aria-hidden className="size-4"/>PDF</a>
   {role!=='field'&&shown.status==='draft'&&can('hseq.edit')&&!editing&&<Btn variant="secondary" onClick={()=>setDraft(structuredClone(shown.content))}>Edit draft</Btn>}
   {editing&&<Btn busy={busy} onClick={()=>void act({action:'save',revisionId:shown.id,updatedAt:shown.updated_at,content:draft})}>Save draft</Btn>}
   {editing&&<Btn variant="ghost" onClick={()=>setDraft(null)}>Cancel</Btn>}
   {role!=='field'&&['approved','issued'].includes(shown.status)&&can('hseq.edit')&&<Btn variant="secondary" busy={busy} onClick={()=>{const r=prompt('Reason for the new revision');if(r)void act({action:'revise',reason:r});}}>Create new revision</Btn>}
   {issued&&can('swms.acknowledge')&&!queued&&<Btn busy={busy} onClick={()=>{
    // Offline: the acknowledgement of this exact revision is queued; the server refuses it if a newer revision was issued meanwhile.
    const body={action:'acknowledge',id,shiftId:shiftId||null,revisionId:issued.id,clientRequestId:requestId()};
    const queue=()=>offline!.enqueue({id:body.clientRequestId,kind:'swms-ack',label:`SWMS acknowledgement: ${d.swms.reference} rev ${issued.revision_number}`,url:'/api/hseq/swms',body}).then(()=>setQueued(true));
    if(offline&&!offline.online){void queue();return;}
    void run(async()=>{try{return await api('/api/hseq/swms',{method:'POST',body});}catch(e){if(offline&&isNetworkFailure(e)){await queue();return null;}throw e;}},r=>{if(r)done();});
   }}><FileSignature aria-hidden className="size-4"/>I have read and understood this SWMS</Btn>}
  </div>
  {transitions.length>0&&!editing&&<div className="grid gap-2 rounded-lg border bg-slate-50 p-3"><textarea className={`${field} min-h-14`} placeholder="Note (recorded in the audit trail)" value={note} onChange={e=>setNote(e.target.value)}/><div className="flex flex-wrap gap-2">{transitions.map(t=><Btn key={t.to} variant="secondary" busy={busy} onClick={()=>void act({action:'transition',to:t.to,note:note||undefined})}>{t.label}</Btn>)}</div></div>}
  <ErrorState error={actionError}/>
  {queued&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your acknowledgement is saved on this device and will be sent when you are back online. If the SWMS is revised before then, you will be asked to read the new revision.</p>}
  {cachedAt&&<p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Offline copy saved {new Date(cachedAt).toLocaleString('en-AU')}.</p>}
  <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Activity</dt><dd>{editing?<input className={field} value={c.activity} onChange={e=>setDraft({...draft!,activity:e.target.value})}/>:c.activity}</dd></div><div><dt className="text-slate-500">Location</dt><dd>{editing?<input className={field} value={c.location} onChange={e=>setDraft({...draft!,location:e.target.value})}/>:c.location||'—'}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">High-risk work</dt><dd>{c.highRiskWork?.join(', ')||'None identified'}</dd></div></dl>
  <div className="grid gap-2"><h4 className="font-semibold">Work steps, hazards and controls</h4>{c.workSteps.map((s,i)=><div key={i} className="grid gap-2 rounded-lg border p-3 text-sm">{editing?<><div className="flex gap-2"><input aria-label="Step" className={field} value={s.step} onChange={e=>setStep(i,'step',e.target.value)}/><button aria-label="Remove step" className="p-2 text-slate-400 hover:text-red-600" onClick={()=>setDraft(x=>x&&({...x,workSteps:x.workSteps.filter((_,j)=>j!==i)}))}><Trash2 className="size-4"/></button></div><textarea aria-label="Hazards" placeholder="Hazards" className={`${field} min-h-14`} value={s.hazards} onChange={e=>setStep(i,'hazards',e.target.value)}/><textarea aria-label="Controls" placeholder="Controls" className={`${field} min-h-14`} value={s.controls} onChange={e=>setStep(i,'controls',e.target.value)}/><div className="grid grid-cols-2 gap-2"><input aria-label="Responsible" placeholder="Responsible" className={field} value={s.responsible} onChange={e=>setStep(i,'responsible',e.target.value)}/><select aria-label="Residual risk" className={field} value={s.residualRisk} onChange={e=>setStep(i,'residualRisk',e.target.value)}><option value="">Residual risk</option><option>Low</option><option>Medium</option><option>High</option></select></div></>:<><p className="font-medium">{i+1}. {s.step}</p><p><span className="text-slate-500">Hazards:</span> {s.hazards||<span className="text-amber-700">Not identified</span>}</p><p><span className="text-slate-500">Controls:</span> {s.controls||<span className="text-amber-700">Not recorded</span>}</p><p className="text-xs text-slate-500">Responsible: {s.responsible||'—'} · Residual risk: {s.residualRisk||'—'}</p></>}</div>)}
   {editing&&<Btn variant="secondary" className="justify-self-start" onClick={()=>setDraft(x=>x&&({...x,workSteps:[...x.workSteps,{step:'',hazards:'',controls:'',responsible:x.responsiblePeople,residualRisk:''}]}))}><Plus aria-hidden className="size-4"/>Add step</Btn>}
  </div>
  <div className="grid gap-3 text-sm sm:grid-cols-2">{([['plant','Plant'],['equipment','Equipment'],['substances','Hazardous substances'],['competencies','Competencies'],['licences','Licences'],['permits','Permits'],['emergency','Emergency arrangements'],['responsiblePeople','Responsible people']] as const).map(([k,label])=><div key={k}><p className="text-slate-500">{label}</p>{editing?<textarea className={`${field} min-h-14`} value={String(c[k]||'')} onChange={e=>setDraft({...draft!,[k]:e.target.value})}/>:<p className="whitespace-pre-wrap">{String(c[k]||'—')}</p>}</div>)}<div><p className="text-slate-500">PPE</p><p>{c.ppe?.join(', ')||'—'}</p></div></div>
  {role!=='field'&&<div className="grid gap-2 border-t pt-3"><h4 className="font-semibold">Acknowledgements (issued revision)</h4>{d.acknowledgements.length?<ul className="text-sm">{d.acknowledgements.map((a,i)=><li key={i}>{a.worker_name} · {dateText(a.acknowledged_at)}</li>)}</ul>:<p className="text-sm text-slate-500">No worker has acknowledged the issued revision yet.</p>}
   <h4 className="mt-2 font-semibold">Revision history</h4><ul className="text-sm">{d.revisions.map(r=><li key={r.id} className="flex flex-wrap gap-2 py-1">Rev {r.revision_number} <StatusBadge machine="swms" state={r.status}/><span className="text-xs text-slate-500">{r.change_reason||''}{r.approved_at?` · approved ${dateText(r.approved_at)}`:''}{r.issued_at?` · issued ${dateText(r.issued_at)}`:''}</span></li>)}</ul></div>}
  {role==='field'&&d.acknowledgements.length>0&&<p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">You acknowledged this SWMS {dateText(d.acknowledgements[0].acknowledged_at)}.</p>}
 </div>;
}
