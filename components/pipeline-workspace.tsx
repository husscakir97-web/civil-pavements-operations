'use client';

import {useEffect,useMemo,useState} from 'react';
import {BriefcaseBusiness,CalendarClock,ChevronRight,List,LayoutGrid,Plus} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Textarea} from '@/components/ui/textarea';
import {TenderReviewAssistant} from '@/components/tender-review-assistant';
import {PreparationWorkspace} from '@/components/preparation-workspace';
import {EstimatesQuotes} from '@/components/estimates-quotes';

type Opportunity={
 id:string;
 name:string;
 status:string;
 metadata:Record<string,unknown>;
 createdAt:string;
};

type TenderTab='Overview'|'Documents & Requirements'|'Bid Review'|'Actions & Returnables'|'Estimate'|'Approval & Submission'|'Award';

const pipelineStages=['Lead','Qualifying','Bid Decision Required','Tendering','Internal Approval','Submitted','Clarification','Preferred Tenderer','Won','Lost','Withdrawn'] as const;
const tenderFlow=['Intake','Requirements','Bid Review','Estimate','Returnables','Internal Approval','Submission','Clarification','Award'] as const;

function str(value:unknown){return value===null||value===undefined?'':String(value);}
function num(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
function money(value:unknown){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(num(value));}

function stageOf(status:string){
 const s=status.toLowerCase().replaceAll('_',' ').trim();
 if(['lead','draft','received'].includes(s))return 'Lead';
 if(['qualifying','initial review'].includes(s))return 'Qualifying';
 if(['bid / no-bid','bid/no-bid','bid review','bid decision required','no bid'].includes(s))return 'Bid Decision Required';
 if(['estimating','tendering','in preparation','preparation'].includes(s))return 'Tendering';
 if(['internal review','approved for submission','ready to submit'].includes(s))return 'Internal Approval';
 if(['submitted'].includes(s))return 'Submitted';
 if(['clarification','shortlisted'].includes(s))return 'Clarification';
 if(['preferred','preferred tenderer'].includes(s))return 'Preferred Tenderer';
 if(['won','awarded'].includes(s))return 'Won';
 if(['lost'].includes(s))return 'Lost';
 if(['withdrawn','cancelled'].includes(s))return 'Withdrawn';
 return 'Qualifying';
}

function flowIndex(record:Opportunity){
 const s=stageOf(record.status);
 if(s==='Lead'||s==='Qualifying')return 0;
 if(s==='Bid Decision Required')return 2;
 if(s==='Tendering')return 4;
 if(s==='Internal Approval')return 5;
 if(s==='Submitted')return 6;
 if(s==='Clarification'||s==='Preferred Tenderer')return 7;
 if(s==='Won'||s==='Lost'||s==='Withdrawn')return 8;
 return 0;
}

function nextAction(record:Opportunity){
 const explicit=str(record.metadata.nextAction);
 if(explicit)return explicit;
 const stage=stageOf(record.status);
 if(stage==='Lead'||stage==='Qualifying')return 'Complete qualification and bid decision';
 if(stage==='Bid Decision Required')return 'Complete bid / no-bid review';
 if(stage==='Tendering')return 'Complete requirements, estimate and returnables';
 if(stage==='Internal Approval')return 'Complete internal tender approval';
 if(stage==='Submitted')return 'Monitor client clarification / outcome';
 if(stage==='Clarification')return 'Respond to clarification and record revision';
 if(stage==='Preferred Tenderer')return 'Confirm final award position and contract';
 if(stage==='Won')return 'Complete tender-to-project handover';
 if(stage==='Lost')return 'Record outcome and lessons learned';
 return 'Review opportunity';
}

function dateDiffDays(value:string){
 if(!/^\d{4}-\d{2}-\d{2}/.test(value))return null;
 const target=new Date(value+'T23:59:59');
 return Math.ceil((target.getTime()-Date.now())/86400000);
}

async function readRecords(){
 const r=await fetch('/api/os/records?module=opportunities',{cache:'no-store'});
 const p=await r.json() as {records?:Opportunity[];error?:string};
 if(!r.ok)throw new Error(p.error||'Pipeline could not be loaded.');
 return p.records||[];
}

function Workflow({record}:{record:Opportunity}){
 const active=flowIndex(record);
 return <div className="overflow-x-auto"><ol className="flex min-w-max gap-1" aria-label="Tender workflow">{tenderFlow.map((step,index)=><li key={step} className={'rounded-full border px-3 py-1.5 text-xs font-medium '+(index<active?'border-emerald-200 bg-emerald-50 text-emerald-800':index===active?'border-orange-300 bg-orange-50 text-orange-900':'bg-white text-slate-500')}>{step}</li>)}</ol></div>;
}

function BidReview({record,onUpdated}:{record:Opportunity;onUpdated:(record:Opportunity)=>void}){
 const [decision,setDecision]=useState(str(record.metadata.bidNoBid)||'Undecided');
 const [reason,setReason]=useState(str(record.metadata.bidDecisionReason));
 const [conditions,setConditions]=useState(str(record.metadata.bidConditions));
 const [busy,setBusy]=useState(false);
 async function save(){
  setBusy(true);
  try{
   const status=decision==='Bid'?'Tendering':decision==='No Bid'?'Withdrawn':'Bid Review';
   const r=await fetch('/api/os/records',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:'opportunities',id:record.id,name:record.name,status,metadata:{bidNoBid:decision,bidDecisionReason:reason,bidConditions:conditions}})});
   const p=await r.json() as {record?:Opportunity;error?:string};
   if(!r.ok||!p.record)throw new Error(p.error||'Bid review could not be saved.');
   onUpdated({...record,...p.record,metadata:{...record.metadata,...p.record.metadata}});
   toast.success('Bid decision recorded.');
  }catch(e){toast.error(e instanceof Error?e.message:'Bid review could not be saved.');}
  finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-xl border bg-white p-5"><div><h3 className="font-semibold">Bid / No-Bid Review</h3><p className="mt-1 text-sm text-slate-500">Record the decision and conditions. Detailed capability, commercial and delivery review can be evidenced in the linked tender preparation records.</p></div><div className="grid gap-4 md:grid-cols-3"><label className="text-sm">Decision<NativeSelect className="mt-1" value={decision} onChange={e=>setDecision(e.target.value)}><NativeSelectOption value="Undecided">Undecided</NativeSelectOption><NativeSelectOption value="Bid">Bid</NativeSelectOption><NativeSelectOption value="No Bid">No Bid</NativeSelectOption><NativeSelectOption value="Bid Subject to Conditions">Bid Subject to Conditions</NativeSelectOption></NativeSelect></label><label className="text-sm md:col-span-2">Decision reason<Textarea className="mt-1" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Strategic fit, capability, capacity, risk and commercial rationale"/></label></div><label className="text-sm">Conditions / unresolved matters<Textarea className="mt-1" value={conditions} onChange={e=>setConditions(e.target.value)} placeholder="Conditions that must be resolved before submission or award"/></label><Button disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save bid review'}</Button></section>;
}

function TenderWorkspace({record,onUpdated}:{record:Opportunity;onUpdated:(record:Opportunity)=>void}){
 const [tab,setTab]=useState<TenderTab>('Overview');
 const tabs:TenderTab[]=['Overview','Documents & Requirements','Bid Review','Actions & Returnables','Estimate','Approval & Submission','Award'];
 const close=str(record.metadata.tenderCloseDate);
 const owner=str(record.metadata.assignedOwner)||'Unassigned';
 const client=str(record.metadata.client)||str(record.metadata.builder)||'Client not recorded';

 async function updateStatus(status:string,metadata:Record<string,unknown>={}){
  try{
   const r=await fetch('/api/os/records',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:'opportunities',id:record.id,name:record.name,status,metadata})});
   const p=await r.json() as {record?:Opportunity;error?:string};
   if(!r.ok||!p.record)throw new Error(p.error||'Tender status could not be updated.');
   onUpdated({...record,...p.record,metadata:{...record.metadata,...p.record.metadata}});
   toast.success('Tender status updated.');
  }catch(e){toast.error(e instanceof Error?e.message:'Tender status could not be updated.');}
 }

 return <div className="space-y-5">
  <section className="rounded-xl border bg-[#101a24] p-5 text-white">
   <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-orange-300">Tender</p><h1 className="mt-1 text-2xl font-bold">{record.name}</h1><p className="mt-2 text-sm text-slate-300">{client} · {stageOf(record.status)} · Owner: {owner}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300"><span>Close: {close||'Not recorded'}</span><span>Value: {money(record.metadata.estimatedValue)}</span></div></div><div className="max-w-md rounded-lg bg-white/10 p-3"><p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Next action</p><p className="mt-1 font-semibold">{nextAction(record)}</p></div></div>
   <div className="mt-5"><Workflow record={record}/></div>
  </section>
  <div className="text-sm text-slate-500">Pipeline <ChevronRight className="inline size-3"/> {record.name} <ChevronRight className="inline size-3"/> {tab}</div>
  <nav aria-label="Tender workspace sections" className="flex gap-2 overflow-x-auto border-b pb-3">{tabs.map(item=><Button key={item} className="shrink-0" variant={tab===item?'default':'outline'} onClick={()=>setTab(item)}>{item}</Button>)}</nav>

  {tab==='Overview'&&<div className="grid gap-4 lg:grid-cols-3">
   <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Stage</p><p className="mt-2 text-xl font-bold">{stageOf(record.status)}</p><p className="mt-2 text-sm text-slate-500">Stored status: {record.status}</p></article>
   <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tender close</p><p className="mt-2 text-xl font-bold">{close||'Not recorded'}</p>{close&&<p className="mt-2 text-sm text-slate-500">{dateDiffDays(close)===null?'':dateDiffDays(close)!<0?'Closed':dateDiffDays(close)+' days remaining'}</p>}</article>
   <article className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Estimated value</p><p className="mt-2 text-xl font-bold">{money(record.metadata.estimatedValue)}</p><p className="mt-2 text-sm text-slate-500">Owner: {owner}</p></article>
   <article className="rounded-xl border bg-white p-4 lg:col-span-3"><h3 className="font-semibold">Scope / notes</h3><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{str(record.metadata.notes)||str(record.metadata.workPackages)||'No scope notes recorded yet.'}</p></article>
  </div>}

  {tab==='Documents & Requirements'&&<TenderReviewAssistant key={record.id} opportunityId={record.id} opportunityName={record.name}/>}
  {tab==='Bid Review'&&<BidReview key={record.id} record={record} onUpdated={onUpdated}/>}
  {tab==='Actions & Returnables'&&<PreparationWorkspace scope="tender" opportunityId={record.id}/>}
  {tab==='Estimate'&&<EstimatesQuotes opportunityId={record.id} opportunityName={record.name}/>}
  {tab==='Approval & Submission'&&<section className="space-y-4 rounded-xl border bg-white p-5"><div><h3 className="font-semibold">Approval & submission control</h3><p className="mt-1 text-sm text-slate-500">Status transitions use the existing audited opportunity record. Submission packs and immutable preparation revisions remain in Actions & Returnables.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>void updateStatus('Internal Review')}>Internal review</Button><Button variant="outline" onClick={()=>void updateStatus('Approved for Submission')}>Approved for submission</Button><Button onClick={()=>void updateStatus('Submitted',{submittedAt:new Date().toISOString()})}>Record submitted</Button><Button variant="outline" onClick={()=>void updateStatus('Clarification')}>Clarification</Button><Button variant="outline" onClick={()=>void updateStatus('Preferred Tenderer')}>Preferred tenderer</Button></div></section>}
  {tab==='Award'&&<section className="space-y-4 rounded-xl border bg-white p-5"><div><h3 className="font-semibold">Award & handover</h3><p className="mt-1 text-sm text-slate-500">Award the approved estimate from the Estimate section to preserve the commercial baseline and create the linked project. Use Won/Lost here to record the tender outcome.</p></div><div className="flex flex-wrap gap-2"><Button onClick={()=>setTab('Estimate')}>Open estimate / award</Button><Button variant="outline" onClick={()=>void updateStatus('Won',{outcome:'Won'})}>Mark Won</Button><Button variant="outline" onClick={()=>void updateStatus('Lost',{outcome:'Lost'})}>Mark Lost</Button><Button variant="outline" onClick={()=>void updateStatus('Withdrawn',{outcome:'Withdrawn'})}>Withdraw</Button></div></section>}
 </div>;
}

export function PipelineWorkspace({mode='pipeline',onOpenTender}:{mode?:'pipeline'|'tenders';onOpenTender?:()=>void}){
 const [records,setRecords]=useState<Opportunity[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [view,setView]=useState<'board'|'list'>('board');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [showCreate,setShowCreate]=useState(false);
 const [draft,setDraft]=useState({name:'',client:'',estimatedValue:'',tenderCloseDate:'',assignedOwner:'',nextAction:''});

 async function load(){
  try{setRecords(await readRecords());setError('');}catch(e){setError(e instanceof Error?e.message:'Pipeline could not be loaded.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(mode!=='tenders')return;try{const saved=window.localStorage.getItem('infrastruct.tender');if(saved)queueMicrotask(()=>setSelectedId(saved));}catch{}},[mode]);
 const selected=records.find(r=>r.id===selectedId)||null;
 const grouped=useMemo(()=>Object.fromEntries(pipelineStages.map(stage=>[stage,records.filter(r=>stageOf(r.status)===stage)])) as Record<string,Opportunity[]>,[records]);
 const dueSoon=records.filter(r=>{const d=dateDiffDays(str(r.metadata.tenderCloseDate));return d!==null&&d>=0&&d<=7&&!['Won','Lost','Withdrawn'].includes(stageOf(r.status));});
 const bidDue=records.filter(r=>stageOf(r.status)==='Bid Decision Required');

 function openTender(record:Opportunity){
  setSelectedId(record.id);
  try{window.localStorage.setItem('infrastruct.tender',record.id);}catch{}
  if(mode==='pipeline'&&onOpenTender)onOpenTender();
 }

 async function create(){
  if(!draft.name.trim()){toast.error('Opportunity name is required.');return;}
  try{
   const r=await fetch('/api/os/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module:'opportunities',name:draft.name,status:'Lead',metadata:{client:draft.client,estimatedValue:draft.estimatedValue,tenderCloseDate:draft.tenderCloseDate,assignedOwner:draft.assignedOwner,nextAction:draft.nextAction}})});
   const p=await r.json() as {record?:Opportunity;error?:string};
   if(!r.ok||!p.record)throw new Error(p.error||'Opportunity could not be created.');
   setDraft({name:'',client:'',estimatedValue:'',tenderCloseDate:'',assignedOwner:'',nextAction:''});setShowCreate(false);await load();toast.success('Opportunity created.');
  }catch(e){toast.error(e instanceof Error?e.message:'Opportunity could not be created.');}
 }

 function updated(record:Opportunity){setRecords(previous=>previous.map(item=>item.id===record.id?record:item));}

 if(loading)return <p className="rounded-xl border bg-white p-8">Loading pipeline…</p>;
 if(mode==='tenders'){
  return <div className="space-y-5">
   <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">Pipeline</p><h1 className="text-2xl font-bold">Tender Workspace</h1><p className="mt-1 text-sm text-slate-600">One contextual home for tender requirements, preparation, estimating, approval, submission and award.</p></div><NativeSelect aria-label="Tender" value={selectedId} onChange={e=>{setSelectedId(e.target.value);try{if(e.target.value)window.localStorage.setItem('infrastruct.tender',e.target.value);}catch{}}}><NativeSelectOption value="">Choose a tender</NativeSelectOption>{records.filter(r=>!['Archived'].includes(r.status)).map(r=><NativeSelectOption key={r.id} value={r.id}>{r.name} · {stageOf(r.status)}</NativeSelectOption>)}</NativeSelect></div>
   {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
   {!selected?<div className="rounded-xl border border-dashed bg-white p-6"><h2 className="font-semibold">Choose a tender</h2><p className="mt-1 text-sm text-slate-600">Select an opportunity/tender to open its controlled workspace. New opportunities are created from Pipeline → Opportunities.</p></div>:<TenderWorkspace key={selected.id} record={selected} onUpdated={updated}/>}
  </div>;
 }

 return <div className="space-y-5">
  <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">Pipeline</p><h1 className="text-2xl font-bold">Opportunities & Tenders</h1><p className="mt-1 text-sm text-slate-600">Track work by business stage, see attention items and open the tender workspace without navigating the internal module structure.</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>setView(view==='board'?'list':'board')}>{view==='board'?<List className="size-4"/>:<LayoutGrid className="size-4"/>}{view==='board'?' List view':' Board view'}</Button><Button onClick={()=>setShowCreate(v=>!v)}><Plus className="size-4"/>New opportunity</Button></div></div>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {showCreate&&<section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Create opportunity</h2><div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3"><Input placeholder="Opportunity / project name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/><Input placeholder="Client / principal" value={draft.client} onChange={e=>setDraft({...draft,client:e.target.value})}/><Input type="number" placeholder="Estimated value" value={draft.estimatedValue} onChange={e=>setDraft({...draft,estimatedValue:e.target.value})}/><label className="text-sm">Tender close<Input className="mt-1" type="date" value={draft.tenderCloseDate} onChange={e=>setDraft({...draft,tenderCloseDate:e.target.value})}/></label><Input placeholder="Owner" value={draft.assignedOwner} onChange={e=>setDraft({...draft,assignedOwner:e.target.value})}/><Input placeholder="Next action" value={draft.nextAction} onChange={e=>setDraft({...draft,nextAction:e.target.value})}/></div><div className="mt-4 flex gap-2"><Button onClick={()=>void create()}>Create</Button><Button variant="outline" onClick={()=>setShowCreate(false)}>Cancel</Button></div></section>}
  <section className="grid gap-3 md:grid-cols-2"><article className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><CalendarClock className="size-4 text-amber-800"/><h2 className="font-semibold text-amber-950">Tenders closing within 7 days</h2></div><p className="mt-2 text-2xl font-bold">{dueSoon.length}</p>{dueSoon.slice(0,4).map(r=><button key={r.id} onClick={()=>openTender(r)} className="mt-2 block text-left text-sm underline">{r.name} · {str(r.metadata.tenderCloseDate)}</button>)}</article><article className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2"><BriefcaseBusiness className="size-4"/><h2 className="font-semibold">Bid decisions required</h2></div><p className="mt-2 text-2xl font-bold">{bidDue.length}</p>{bidDue.slice(0,4).map(r=><button key={r.id} onClick={()=>openTender(r)} className="mt-2 block text-left text-sm underline">{r.name}</button>)}</article></section>

  {!records.length?<div className="rounded-xl border border-dashed bg-white p-6"><h2 className="font-semibold">No opportunities yet</h2><p className="mt-1 text-sm text-slate-600">Create an opportunity when work is identified. When an RFT/RFQ arrives, open that record in the Tender Workspace.</p></div>:view==='board'?<div className="flex gap-3 overflow-x-auto pb-3">{pipelineStages.map(stage=><section key={stage} className="w-72 shrink-0 rounded-xl border bg-slate-50 p-3"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{stage}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs">{grouped[stage].length}</span></div><div className="space-y-2">{grouped[stage].map(r=><button key={r.id} onClick={()=>openTender(r)} className="block w-full rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-orange-300"><p className="font-semibold">{r.name}</p><p className="mt-1 text-xs text-slate-500">{str(r.metadata.client)||'Client not recorded'}</p><p className="mt-2 text-sm font-medium">{money(r.metadata.estimatedValue)}</p><p className="mt-1 text-xs text-slate-500">Close {str(r.metadata.tenderCloseDate)||'—'} · {str(r.metadata.assignedOwner)||'Unassigned'}</p><p className="mt-2 text-xs text-orange-800">{nextAction(r)}</p></button>)}</div></section>)}</div>:<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Opportunity</th><th className="p-3">Client</th><th className="p-3">Stage</th><th className="p-3">Value</th><th className="p-3">Close</th><th className="p-3">Owner</th><th className="p-3">Next action</th></tr></thead><tbody>{records.map(r=><tr key={r.id} className="border-t hover:bg-slate-50" onClick={()=>openTender(r)}><td className="cursor-pointer p-3 font-medium">{r.name}</td><td className="p-3">{str(r.metadata.client)||'—'}</td><td className="p-3">{stageOf(r.status)}</td><td className="p-3">{money(r.metadata.estimatedValue)}</td><td className="p-3">{str(r.metadata.tenderCloseDate)||'—'}</td><td className="p-3">{str(r.metadata.assignedOwner)||'—'}</td><td className="p-3">{nextAction(r)}</td></tr>)}</tbody></table></div>}
 </div>;
}
