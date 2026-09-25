'use client';
// Mobile-first field flow. Payloads come from field-safe projections: no
// rates, margins, client pricing or office-only documents.
import {useState} from 'react';
import {ArrowLeft,CheckCircle2,ClipboardList,HardHat,MapPin,Plus,ShieldCheck,Trash2} from 'lucide-react';
import {api,useApi,useAction,ErrorState,Loading,Btn,Field,field,EmptyState,Pill} from './kit';
import {SwmsPanel} from './swms';
import {RegisterView} from './register-view';

type Shift={id:string;name:string;status:string;date:string;start:string;finish:string;location:string;supervisor:string;activity:string;instructions:string;siteContact:string;crew:Array<{name:string;role:string;category:string}>;project:{id:string;name:string;number:string|null;closed:boolean}|null;assignedToMe:boolean;swms:Array<{id:string;reference:string;title:string;acknowledged:boolean}>;swmsOutstanding:number;fieldRecord:{status:string}|null;dockets:Array<{id:string;docketNo:string;status:string}>};
type Today={date:string;today:Shift[];otherToday:Shift[];upcoming:Shift[]};

export function FieldToday({onOpenRecords}:{onOpenRecords:()=>void}){
 const {data,error,loading,refresh}=useApi<Today>('/api/field/today');
 const [selected,setSelected]=useState<string|null>(null);
 const all=[...(data?.today||[]),...(data?.otherToday||[]),...(data?.upcoming||[])];
 const shift=all.find(s=>s.id===selected);
 if(shift)return <ShiftDetail shift={shift} onBack={()=>{setSelected(null);refresh();}} onChanged={refresh} onOpenRecords={onOpenRecords}/>;
 const card=(s:Shift)=><li key={s.id}><button onClick={()=>setSelected(s.id)} className="w-full rounded-2xl border bg-white p-4 text-left shadow-sm active:bg-slate-50">
  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-lg font-semibold leading-6">{s.project?.name||s.name}</p><p className="text-sm text-slate-600">{s.start}–{s.finish}{s.date!==data?.date?` · ${s.date}`:''}</p></div><Pill tone={s.fieldRecord?.status==='Submitted'?'success':'info'}>{s.fieldRecord?.status==='Submitted'?'Submitted':s.status}</Pill></div>
  {s.location&&<p className="mt-2 flex items-center gap-1 text-sm text-slate-700"><MapPin aria-hidden className="size-4"/>{s.location}</p>}
  {s.activity&&<p className="mt-1 text-sm text-slate-700">{s.activity}</p>}
  {s.swmsOutstanding>0&&<p className="mt-2 flex items-center gap-1 text-sm font-medium text-amber-800"><ShieldCheck aria-hidden className="size-4"/>{s.swmsOutstanding} SWMS to acknowledge before starting</p>}
 </button></li>;
 return <div className="mx-auto grid max-w-xl gap-4">
  <div><p className="text-sm text-slate-500">{data?new Date(data.date+'T00:00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'}):''}</p><h1 className="text-2xl font-semibold">Today</h1></div>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading label="Loading today's work…"/>:<>
   {data?.today.length?<ul className="grid gap-3">{data.today.map(card)}</ul>:<EmptyState title="You have no shifts assigned today." detail="If you expected work today, contact your supervisor or the office."/>}
   {!!data?.otherToday.length&&<><h2 className="mt-2 text-sm font-semibold text-slate-600">Other shifts today</h2><ul className="grid gap-3">{data.otherToday.map(card)}</ul></>}
   {!!data?.upcoming.length&&<><h2 className="mt-2 text-sm font-semibold text-slate-600">Coming up</h2><ul className="grid gap-3">{data.upcoming.map(card)}</ul></>}
  </>}
 </div>;
}

function ShiftDetail({shift,onBack,onChanged,onOpenRecords}:{shift:Shift;onBack:()=>void;onChanged:()=>void;onOpenRecords:()=>void}){
 const [step,setStep]=useState<'start'|'during'|'finish'>(shift.swmsOutstanding?'start':'during');
 return <div className="mx-auto grid max-w-xl gap-4">
  <button onClick={onBack} className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700"><ArrowLeft aria-hidden className="size-4"/>Today</button>
  <section className="rounded-2xl border bg-white p-4">
   <p className="text-xs uppercase tracking-wide text-slate-500">{shift.project?.number||'Shift'}</p>
   <h1 className="text-xl font-semibold">{shift.project?.name||shift.name}</h1>
   <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Time</dt><dd className="font-medium">{shift.start}–{shift.finish}</dd></div><div><dt className="text-slate-500">Supervisor</dt><dd className="font-medium">{shift.supervisor||'Not recorded'}</dd></div><div className="col-span-2"><dt className="text-slate-500">Location</dt><dd>{shift.location||'Not recorded'}</dd></div>{shift.activity&&<div className="col-span-2"><dt className="text-slate-500">Activity</dt><dd>{shift.activity}</dd></div>}{shift.instructions&&<div className="col-span-2"><dt className="text-slate-500">Instructions</dt><dd className="whitespace-pre-wrap">{shift.instructions}</dd></div>}{shift.crew.length>0&&<div className="col-span-2"><dt className="text-slate-500">Crew and plant</dt><dd>{shift.crew.map(c=>`${c.name}${c.role?` (${c.role})`:''}`).join(', ')}</dd></div>}</dl>
   {shift.project?.closed&&<p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">This project is closed. Contact the office before recording work.</p>}
  </section>
  <nav className="grid grid-cols-3 gap-2" aria-label="Shift steps">{([['start','Start work',ShieldCheck],['during','During work',HardHat],['finish','Finish',ClipboardList]] as const).map(([k,label,Icon])=><button key={k} onClick={()=>setStep(k)} aria-current={step===k?'step':undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium ${step===k?'border-orange-400 bg-orange-50 text-orange-900':'bg-white text-slate-700'}`}><Icon aria-hidden className="size-5"/>{label}</button>)}</nav>
  {step==='start'&&shift.project&&<div className="grid gap-3"><p className="text-sm text-slate-600">Read each issued SWMS for this project and acknowledge it before starting work.</p><SwmsPanel projectId={shift.project.id} shiftId={shift.id}/><Btn className="min-h-12" onClick={()=>{onChanged();setStep('during');}}>Continue to work<CheckCircle2 aria-hidden className="size-4"/></Btn></div>}
  {step==='during'&&<div className="grid gap-3">
   <Btn className="min-h-12" onClick={onOpenRecords}><ClipboardList aria-hidden className="size-5"/>Open shift record (pre-start, production, photos)</Btn>
   {shift.project&&<RegisterView register="incidents" parentId={shift.project.id} title="Report an incident or near miss"/>}
   {shift.project&&<RegisterView register="itps" parentId={shift.project.id} title="Quality records (ITPs)" hideCreate rowActions={r=><ItpItems itpId={r.id} projectId={shift.project!.id}/>}/>}
  </div>}
  {step==='finish'&&<DocketForm shift={shift} onSubmitted={onChanged}/>}
 </div>;
}

function ItpItems({itpId,projectId}:{itpId:string;projectId:string}){const [open,setOpen]=useState(false);return open?<div className="mt-2 text-left"><RegisterView register="itp_items" parentId={itpId} projectId={projectId} hideCreate/></div>:<Btn variant="ghost" onClick={()=>setOpen(true)}>Inspection points</Btn>;}

function DocketForm({shift,onSubmitted}:{shift:Shift;onSubmitted:()=>void}){
 const {busy,error,run}=useAction();const [done,setDone]=useState<string|null>(null);
 const [v,setV]=useState({docketNo:'',labourHours:'',quantity:'',quantityUnit:'m',notes:''});
 const [lines,setLines]=useState([{description:'',quantity:'',unit:'h'}]);
 if(done)return <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><p className="font-semibold">Docket {done} submitted for review.</p><p className="mt-1 text-sm">The office will price and approve it. You can submit another if needed.</p><Btn className="mt-3" variant="secondary" onClick={()=>setDone(null)}>Submit another docket</Btn></section>;
 return <form className="grid gap-4 rounded-2xl border bg-white p-4" onSubmit={e=>{e.preventDefault();void run(()=>api<{docketNo:string}>('/api/field/today',{method:'POST',body:{shiftId:shift.id,docketNo:v.docketNo,workDate:shift.date,labourHours:Number(v.labourHours)||0,quantity:Number(v.quantity)||0,quantityUnit:v.quantityUnit,notes:v.notes,lines:lines.filter(l=>l.description.trim()).map(l=>({description:l.description,quantity:Number(l.quantity)||0,unit:l.unit}))}}),r=>{setDone(r.docketNo);onSubmitted();});}}>
  <h2 className="text-lg font-semibold">Finish work: submit docket</h2>
  {shift.dockets.length>0&&<p className="text-sm text-slate-600">Already submitted: {shift.dockets.map(d=>`${d.docketNo} (${d.status==='included_claim'?'claimed':d.status})`).join(', ')}</p>}
  <div className="grid grid-cols-2 gap-3"><Field label="Docket number" hint="Leave blank to generate"><input className={field} value={v.docketNo} onChange={e=>setV({...v,docketNo:e.target.value})}/></Field><Field label="Labour hours"><input className={field} inputMode="decimal" type="number" value={v.labourHours} onChange={e=>setV({...v,labourHours:e.target.value})}/></Field><Field label="Quantity completed"><input className={field} inputMode="decimal" type="number" value={v.quantity} onChange={e=>setV({...v,quantity:e.target.value})}/></Field><Field label="Unit"><select className={field} value={v.quantityUnit} onChange={e=>setV({...v,quantityUnit:e.target.value})}>{['m','m²','m³','t','each','load','h','item'].map(u=><option key={u}>{u}</option>)}</select></Field></div>
  <fieldset className="grid gap-2"><legend className="text-sm font-medium">Labour, plant and materials used</legend>{lines.map((l,i)=><div key={i} className="grid grid-cols-[1fr_5rem_4.5rem_auto] gap-2"><input aria-label="Item" placeholder="e.g. 20t excavator" className={field} value={l.description} onChange={e=>setLines(ls=>ls.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/><input aria-label="Quantity" inputMode="decimal" type="number" className={field} value={l.quantity} onChange={e=>setLines(ls=>ls.map((x,j)=>j===i?{...x,quantity:e.target.value}:x))}/><select aria-label="Unit" className={field} value={l.unit} onChange={e=>setLines(ls=>ls.map((x,j)=>j===i?{...x,unit:e.target.value}:x))}>{['h','t','m','m³','each','load'].map(u=><option key={u}>{u}</option>)}</select><button type="button" aria-label="Remove line" className="p-2 text-slate-400" onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))}><Trash2 className="size-4"/></button></div>)}<Btn type="button" variant="secondary" className="justify-self-start" onClick={()=>setLines(ls=>[...ls,{description:'',quantity:'',unit:'h'}])}><Plus aria-hidden className="size-4"/>Add line</Btn></fieldset>
  <Field label="Notes"><textarea className={`${field} min-h-20`} value={v.notes} onChange={e=>setV({...v,notes:e.target.value})}/></Field>
  <p className="text-xs text-slate-500">Prices are added by the office. Client or supervisor sign-off is captured in the shift record.</p>
  <ErrorState error={error}/>
  <Btn className="min-h-12" busy={busy} disabled={shift.project?.closed} type="submit">Submit docket for review</Btn>
 </form>;
}
