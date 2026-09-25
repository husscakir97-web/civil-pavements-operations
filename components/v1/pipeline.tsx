'use client';
import {useState,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {ArrowRight,Plus,Trophy} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,FieldGroup,field,Section,PageHeader,NextAction,Progress,Tabs,Stat,money,dateText,Pill} from './kit';
import {AiAssist} from './ai';
import {RegisterView,usePeople,DocumentInput} from './register-view';
import {EstimateApprovalPanel} from './estimating';
import {useNav} from './nav';

const TenderReviewAssistant=dynamic(()=>import('@/components/tender-review-assistant').then(m=>m.TenderReviewAssistant),{loading:()=><Loading label="Loading tender documents…"/>});

export function OpportunitiesView(){
 const {navigate}=useNav();const {can}=useSession();const {busy,error,run}=useAction();
 return <div className="grid gap-4">
  <PageHeader title="Opportunities" subtitle="Work you are chasing. Qualify it, then convert it to a tender — the tender keeps the link back to this opportunity."/>
  <ErrorState error={error}/>
  <RegisterView register="opportunities" rowActions={(r,refresh)=>{
   if(r.tender_id)return <Btn variant="ghost" onClick={()=>navigate('Pipeline','Tenders',String(r.tender_id))}>Open tender<ArrowRight aria-hidden className="size-4"/></Btn>;
   if(['qualified','bidding'].includes(String(r.stage))&&can('pipeline.edit'))return <Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api<{tenderId:string}>('/api/tenders/register',{method:'POST',body:{opportunityId:r.id}}),t=>{refresh();navigate('Pipeline','Tenders',t.tenderId);})}>Convert to tender</Btn>;
   return null;
  }}/>
 </div>;
}

type Tender={awardBlockers?:string[];id:string;opportunityId:string;reference:string|null;title:string;clientName:string|null;ownerUserId:string|null;ownerName:string|null;stage:string;stageLabel:string;dueDate:string|null;location:string|null;scopeSummary:string|null;estimateId:string|null;approvalStatus:string;approvedAt:string|null;approvalNotes:string|null;submittedAt:string|null;submissionMethod:string|null;submissionVersion:string|null;submissionNotes:string|null;submissionOverrideReason:string|null;outcomeAt:string|null;outcomeReason:string|null;projectId:string|null;revision:number;estimatedValue?:number|null;approvedSellPrice?:number|null;approvedMarginPct?:number|null;completion:number;nextAction:string|null;checks:Array<{key:string;label:string;ok:boolean;detail:string|null}>;stats:{documents:number;requirements:number;suggested:number;mandatoryOpen:number;returnables:number;returnablesMandatoryOpen:number;clarificationsOpen:number;nextClarificationDue:string|null;estimateState:string|null;bidDecision:string;approvedRevisionNumber:number|null}};

export function TendersView(){
 const {route,navigate}=useNav();
 if(route.id)return <TenderWorkspace id={route.id} tab={route.tab} onBack={()=>navigate('Pipeline','Tenders')}/>;
 return <TenderRegister/>;
}

function TenderRegister(){
 const {data,error,loading,refresh}=useApi<{tenders:Tender[]}>('/api/tenders/register');
 const {navigate}=useNav();const {can}=useSession();const [creating,setCreating]=useState(false);
 const open=(data?.tenders||[]).filter(t=>!['awarded','lost'].includes(t.stage)),closed=(data?.tenders||[]).filter(t=>['awarded','lost'].includes(t.stage));
 const row=(t:Tender)=><li key={t.id}><button onClick={()=>navigate('Pipeline','Tenders',t.id)} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] md:items-center">
  <span className="min-w-0"><span className="block font-medium">{t.title}</span><span className="block text-xs text-slate-500">{[t.reference,t.clientName].filter(Boolean).join(' · ')||'No client recorded'}</span></span>
  <span className="flex flex-wrap items-center gap-2"><StatusBadge machine="tender" state={t.stage}/>{t.stats.suggested>0&&<Pill tone="warning">{t.stats.suggested} suggested</Pill>}</span>
  <span className="text-sm text-slate-600">{t.dueDate?`Due ${dateText(t.dueDate)}`:'No due date'}</span>
  <span><Progress value={t.completion} label="Complete"/>{t.nextAction&&<span className="mt-1 block truncate text-xs text-orange-800">{t.nextAction}</span>}</span>
 </button></li>;
 return <div className="grid gap-4">
  <PageHeader title="Tenders" subtitle="One workspace per tender: intake, requirements, bid review, estimate, returnables, approval, submission, clarifications and award." actions={can('pipeline.edit')&&<Btn onClick={()=>setCreating(true)}><Plus aria-hidden className="size-4"/>New tender</Btn>}/>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:<>
   <section className="surface overflow-hidden"><h2 className="border-b px-4 py-3 font-semibold">Active tenders ({open.length})</h2>{open.length?<ul className="divide-y">{open.map(row)}</ul>:<div className="p-4"><EmptyState title="No tenders are in progress." detail="Convert a qualified opportunity, or create a tender directly when an invitation arrives." action={can('pipeline.edit')?<Btn variant="secondary" onClick={()=>setCreating(true)}>New tender</Btn>:undefined}/></div>}</section>
   {closed.length>0&&<section className="surface overflow-hidden"><h2 className="border-b px-4 py-3 font-semibold">Decided ({closed.length})</h2><ul className="divide-y">{closed.map(row)}</ul></section>}
  </>}
  <Sheet open={creating} onOpenChange={setCreating}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">New tender</SheetTitle><SheetDescription className="sr-only">Create a tender</SheetDescription>{creating&&<TenderForm onDone={id=>{setCreating(false);refresh();if(id)navigate('Pipeline','Tenders',id);}}/>}</SheetContent></Sheet>
 </div>;
}

function TenderForm({tender,onDone}:{tender?:Tender;onDone:(id?:string)=>void}){
 const people=usePeople();const {can}=useSession();const {busy,error,run}=useAction();
 const [v,setV]=useState({title:tender?.title||'',clientName:tender?.clientName||'',reference:tender?.reference||'',dueDate:tender?.dueDate?.slice(0,10)||'',estimatedValue:tender?.estimatedValue??'',ownerUserId:tender?.ownerUserId||'',location:tender?.location||'',scopeSummary:tender?.scopeSummary||''});
 const set=(k:string,val:string)=>setV(s=>({...s,[k]:val}));
 const body={...v,estimatedValue:v.estimatedValue===''?null:Number(v.estimatedValue),dueDate:v.dueDate||null,ownerUserId:v.ownerUserId||null};
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(async()=>tender?(await api('/api/tenders/workspace',{method:'PATCH',body:{...body,id:tender.id,revision:tender.revision}}),tender.id):(await api<{tenderId:string}>('/api/tenders/register',{method:'POST',body})).tenderId,id=>onDone(id));}}>
  <Field label="Tender title" required><input className={field} required value={v.title} onChange={e=>set('title',e.target.value)}/></Field>
  <div className="grid gap-4 sm:grid-cols-2"><Field label="Client"><input className={field} value={v.clientName} onChange={e=>set('clientName',e.target.value)}/></Field><Field label="Client reference"><input className={field} value={v.reference} onChange={e=>set('reference',e.target.value)}/></Field>
  <Field label="Closing date"><input className={field} type="date" value={v.dueDate} onChange={e=>set('dueDate',e.target.value)}/></Field>{can('commercial.view')&&<Field label="Estimated value"><input className={field} type="number" value={String(v.estimatedValue)} onChange={e=>set('estimatedValue',e.target.value)}/></Field>}
  <Field label="Owner"><select className={field} value={v.ownerUserId} onChange={e=>set('ownerUserId',e.target.value)}><option value="">Unassigned</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Location"><input className={field} value={v.location} onChange={e=>set('location',e.target.value)}/></Field></div>
  <Field label="Scope summary"><textarea className={`${field} min-h-24`} value={v.scopeSummary} onChange={e=>set('scopeSummary',e.target.value)}/></Field>
  <ErrorState error={error}/>
  <div className="flex gap-2"><Btn busy={busy} type="submit">{tender?'Save details':'Create tender'}</Btn><Btn variant="secondary" type="button" onClick={()=>onDone()}>Cancel</Btn></div>
 </form>;
}

type TabKey='intake'|'requirements'|'bid'|'estimate'|'returnables'|'approval'|'submission'|'clarifications'|'award';
function TenderWorkspace({id,tab,onBack}:{id:string;tab?:string;onBack:()=>void}){
 const {navigate}=useNav();const session=useSession();
 const active=(tab||'intake') as TabKey;
 const {data,error,loading,refresh}=useApi<{tender:Tender;bidReview:Record<string,string|null>|null}>(`/api/tenders/workspace?id=${id}&view=${active}`);
 if(loading&&!data)return <Loading label="Loading tender…"/>;
 if(error&&!data)return <div className="grid gap-3"><ErrorState error={error} onRetry={refresh}/><Btn variant="secondary" onClick={onBack}>Back to tenders</Btn></div>;
 const t=data!.tender,closed=['awarded','lost'].includes(t.stage);
 const tabs:Array<{key:TabKey;label:string;badge?:ReactNode}>=[{key:'intake',label:'Intake',badge:t.stats.documents?<Pill>{t.stats.documents}</Pill>:undefined},{key:'requirements',label:'Requirements',badge:t.stats.mandatoryOpen+t.stats.suggested?<Pill tone="warning">{t.stats.mandatoryOpen+t.stats.suggested}</Pill>:undefined},{key:'bid',label:'Bid review'},{key:'estimate',label:'Estimate'},{key:'returnables',label:'Returnables',badge:t.stats.returnablesMandatoryOpen?<Pill tone="warning">{t.stats.returnablesMandatoryOpen}</Pill>:undefined},{key:'approval',label:'Internal approval'},{key:'submission',label:'Submission'},{key:'clarifications',label:'Clarifications',badge:t.stats.clarificationsOpen?<Pill tone="warning">{t.stats.clarificationsOpen}</Pill>:undefined},{key:'award',label:'Award'}];
 const go=(k:TabKey)=>navigate('Pipeline','Tenders',id,k);
 return <div>
  <div className="sticky top-[72px] z-10 -mx-4 mb-4 border-b bg-[#f6f7f9]/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
   <PageHeader crumbs={[{label:'Pipeline'},{label:'Tenders',onClick:onBack},{label:t.title}]} title={t.title} badges={<StatusBadge machine="tender" state={t.stage}/>} subtitle={[t.reference,t.clientName,t.dueDate?`Due ${dateText(t.dueDate)}`:'No due date',t.ownerName?`Owner ${t.ownerName}`:'No owner'].filter(Boolean).join(' · ')}
    actions={<div className="flex items-center gap-3">{session.can('commercial.view')&&<span className="text-sm text-slate-600">{t.approvedSellPrice!=null?`Approved ${money(t.approvedSellPrice)}`:t.estimatedValue!=null?`Est. ${money(t.estimatedValue)}`:'Value not available'}</span>}<Progress value={t.completion} label="Complete"/></div>}/>
   <NextAction text={t.nextAction}/>
  </div>
  <ErrorState error={error} onRetry={refresh}/>
  <Tabs label="Tender workspace" tabs={tabs} active={active} onChange={go}/>
  {active==='intake'&&<IntakeTab t={t} closed={closed} onChanged={refresh}/>}
  {active==='requirements'&&<RequirementsTab t={t} closed={closed} onChanged={refresh}/>}
  {active==='bid'&&<BidTab t={t} review={data!.bidReview} onChanged={refresh}/>}
  {active==='estimate'&&<EstimateTab t={t} onChanged={refresh}/>}
  {active==='returnables'&&<RegisterView register="returnables" parentId={id} onChanged={refresh} hideCreate={closed} description="Link reusable Company Library content instead of recreating documents."/>}
  {active==='approval'&&<ApprovalTab t={t} onChanged={refresh}/>}
  {active==='submission'&&<SubmissionTab t={t} onChanged={refresh}/>}
  {active==='clarifications'&&<RegisterView register="clarifications" parentId={id} onChanged={refresh} description="A price change after estimate approval requires a new estimate revision and approval before award."/>}
  {active==='award'&&<AwardTab t={t} onChanged={refresh}/>}
 </div>;
}

function IntakeTab({t,closed,onChanged}:{t:Tender;closed:boolean;onChanged:()=>void}){
 const [editing,setEditing]=useState(false);const {can}=useSession();
 return <div className="grid gap-4">
  <Section title="Tender details" actions={!closed&&can('pipeline.edit')&&<Btn variant="secondary" onClick={()=>setEditing(true)}>Edit details</Btn>}>
   <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">Client</dt><dd>{t.clientName||'Not recorded'}</dd></div><div><dt className="text-slate-500">Location</dt><dd>{t.location||'Not recorded'}</dd></div><div><dt className="text-slate-500">Closing</dt><dd>{dateText(t.dueDate)}</dd></div><div className="sm:col-span-3"><dt className="text-slate-500">Scope summary</dt><dd className="whitespace-pre-wrap">{t.scopeSummary||'Not recorded'}</dd></div></dl>
  </Section>
  <TenderReviewAssistant opportunityId={t.opportunityId} opportunityName={t.title}/>
  <Sheet open={editing} onOpenChange={setEditing}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">Tender details</SheetTitle><SheetDescription className="sr-only">Edit tender</SheetDescription>{editing&&<TenderForm tender={t} onDone={()=>{setEditing(false);onChanged();}}/>}</SheetContent></Sheet>
 </div>;
}

function RequirementsTab({t,closed,onChanged}:{t:Tender;closed:boolean;onChanged:()=>void}){
 const {can}=useSession();const [tick,setTick]=useState(0);const {busy,error,run}=useAction();const [message,setMessage]=useState('');
 return <div className="grid gap-4">
  {!closed&&can('pipeline.edit')&&<Section title="Suggested requirements from documents" description="Reads fields extracted from the tender documents on the Intake tab. Suggestions stay Suggested until a person confirms or rejects each one; manual entry always works.">
   <div className="flex flex-wrap items-center gap-3"><Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api<{created:number}>('/api/tenders/workspace',{method:'POST',body:{action:'suggest-requirements',id:t.id}}),r=>{setMessage(r.created?`${r.created} suggestion${r.created===1?'':'s'} added for review.`:'No new suggestions. Process documents on the Intake tab first, or add requirements manually.');onChanged();})}>Create suggestions from documents</Btn>{message&&<span role="status" className="text-sm text-slate-600">{message}</span>}</div><div className="mt-2"><ErrorState error={error}/></div>
  </Section>}
  {!closed&&<AiAssist feature="tender.requirements" title="AI requirement suggestions" description="Reads the text of the tender documents on the Intake tab and proposes requirements with the page or clause they came from. Accepted suggestions are added as Suggested requirements for a person to confirm." entityType="tender" entityId={t.id} runBody={{action:'tender-requirements',tenderId:t.id}} onApplied={()=>{setTick(x=>x+1);onChanged();}}/>}
  <RegisterView key={tick} register="requirements" parentId={t.id} onChanged={onChanged} hideCreate={closed} description="Mandatory requirements must be complete (or not applicable) before submission."/>
  {!closed&&<ResponseAssist tenderId={t.id} onApplied={()=>setTick(x=>x+1)}/>}
 </div>;
}

/** Non-price response drafting from the Company Library, one requirement at a time. */
function ResponseAssist({tenderId,onApplied}:{tenderId:string;onApplied:()=>void}){
 const {data}=useApi<{records:Array<{id:string;title:string;category:string|null;status:string}>}>(`/api/registers/requirements?parentId=${tenderId}`);
 const options=(data?.records||[]).filter(r=>!['complete','not_applicable','rejected'].includes(r.status)&&r.category!=='commercial');
 const [id,setId]=useState('');
 const chosen=options.find(o=>o.id===id)?.id||options[0]?.id;
 if(!chosen)return null;
 return <AiAssist key={chosen} feature="response.draft" title="Draft a non-price response" description="Drafts a response from your current Company Library entries only. Pricing and commercial requirements are excluded. Accepting puts the draft in the requirement's response for you to edit and complete." entityType="requirement" entityId={chosen} runBody={{action:'draft-response',requirementId:chosen}} onApplied={onApplied}
  extra={<Field label="Requirement"><select className={field} value={chosen} onChange={e=>setId(e.target.value)}>{options.map(o=><option key={o.id} value={o.id}>{o.title.slice(0,80)}</option>)}</select></Field>}/>;
}

const BID_FIELDS:Array<[string,string]>=[['strategic_fit','Strategic fit'],['capacity','Capacity'],['capability','Capability'],['client_assessment','Client'],['location_assessment','Project location'],['contract_risks','Contract risks'],['programme','Programme'],['resources','Resources'],['commercial_risks','Major commercial risks'],['hseq_risks','Major HSEQ risks'],['competition','Competition (where known)']];
function BidTab({t,review,onChanged}:{t:Tender;review:Record<string,string|null>|null;onChanged:()=>void}){
 const {can}=useSession();const {busy,error,run}=useAction();
 const [v,setV]=useState<Record<string,string>>(()=>Object.fromEntries([...BID_FIELDS.map(([k])=>k),'recommendation','recommendation_reason'].map(k=>[k,review?.[k]||''])));
 const [reason,setReason]=useState('');
 const editable=['draft','reviewing'].includes(t.stage)&&can('pipeline.edit');
 return <div className="grid gap-4">
  <Section title="Bid / no-bid review" description="A structured assessment. The decision is made by an authorised person — never by AI." actions={editable&&<Btn busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'bid-review',id:t.id,values:{...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x||null])),recommendation:v.recommendation||null}}}),onChanged)}>Save review</Btn>}>
   <div className="grid gap-4 sm:grid-cols-2">{BID_FIELDS.map(([k,label])=><Field key={k} label={label}><textarea className={`${field} min-h-20`} disabled={!editable} value={v[k]} onChange={e=>setV(s=>({...s,[k]:e.target.value}))}/></Field>)}
    <Field label="Recommendation"><select className={field} disabled={!editable} value={v.recommendation} onChange={e=>setV(s=>({...s,recommendation:e.target.value}))}><option value="">Not yet recommended</option><option value="bid">Bid</option><option value="conditional">Bid with conditions</option><option value="no_bid">No bid</option></select></Field>
    <Field label="Recommendation reasoning"><textarea className={`${field} min-h-20`} disabled={!editable} value={v.recommendation_reason} onChange={e=>setV(s=>({...s,recommendation_reason:e.target.value}))}/></Field></div>
   <div className="mt-3"><ErrorState error={error}/></div>
  </Section>
  {t.stage==='reviewing'&&can('tender.approve')&&<Section title="Decision" description="Requires a saved recommendation. The decision and reason are recorded in the audit trail.">
   <Field label="Decision reason" required><textarea className={`${field} min-h-16`} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
   <div className="mt-3 flex flex-wrap gap-2"><Btn busy={busy} disabled={!reason.trim()} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'bid-decision',id:t.id,decision:'bid',reason}}),onChanged)}>Decide to bid</Btn><Btn variant="danger" busy={busy} disabled={!reason.trim()} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'bid-decision',id:t.id,decision:'no_bid',reason}}),onChanged)}>Decide not to bid</Btn></div>
  </Section>}
  {t.stats.bidDecision!=='pending'&&<p className="text-sm text-slate-600">Decision recorded: <strong>{t.stats.bidDecision==='bid'?'Bid':'No bid'}</strong>.</p>}
 </div>;
}

function EstimateTab({t,onChanged}:{t:Tender;onChanged:()=>void}){
 const {navigate}=useNav();const {can}=useSession();const {busy,error,run}=useAction();
 if(!t.estimateId)return <Section title="Tender estimate"><EmptyState title="No estimate has been created for this tender." detail={t.stage==='pricing'?'Choose a discipline-neutral estimate built from work items, or include the asphalt quantity engine.':'Estimates are created once the bid decision is made.'} action={t.stage==='pricing'&&can('estimate.edit')?<div className="flex flex-wrap justify-center gap-2"><Btn busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'create-estimate',id:t.id,mode:'general'}}),onChanged)}>Create estimate</Btn><Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'create-estimate',id:t.id,mode:'paving'}}),onChanged)}>Create with paving engine</Btn></div>:undefined}/><div className="mt-3"><ErrorState error={error}/></div></Section>;
 return <div className="grid gap-4">
  <Section title="Tender estimate" actions={<Btn onClick={()=>navigate('Pipeline','Estimates',t.estimateId!)}>Open estimate<ArrowRight aria-hidden className="size-4"/></Btn>}>
   <div className="grid gap-3 sm:grid-cols-3"><Stat label="Workflow" value={<StatusBadge machine="estimate" state={t.stats.estimateState||'draft'}/>}/><Stat label="Approved revision" value={t.stats.approvedRevisionNumber?`Rev ${t.stats.approvedRevisionNumber}`:'None yet'}/>{can('commercial.view')&&<Stat label="Approved sell / margin" value={t.approvedSellPrice!=null?money(t.approvedSellPrice):'N/A'} hint={t.approvedMarginPct!=null?`${t.approvedMarginPct.toFixed(1)}% margin`:undefined}/>}</div>
  </Section>
  <EstimateApprovalPanel estimateId={t.estimateId} onChanged={onChanged}/>
 </div>;
}

function Checks({t}:{t:Tender}){return <ul className="grid gap-2">{t.checks.map(c=><li key={c.key} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${c.ok?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50'}`}><span aria-hidden>{c.ok?'✓':'•'}</span><span><strong>{c.label}</strong>{c.detail&&<span className="block text-xs text-slate-600">{c.detail}</span>}</span></li>)}</ul>;}

function ApprovalTab({t,onChanged}:{t:Tender;onChanged:()=>void}){
 const {can}=useSession();const {busy,error,run}=useAction();const [notes,setNotes]=useState('');
 return <Section title="Internal tender approval" description="An authorised approver confirms the price, risks and returnables before submission.">
  <Checks t={t}/>
  <div className="mt-4 grid gap-3">
   <p className="text-sm">Status: <StatusBadge state={t.approvalStatus} label={t.approvalStatus.replace('_',' ')}/>{t.approvedAt&&<span className="ml-2 text-xs text-slate-500">Approved {dateText(t.approvedAt)}</span>}{t.approvalNotes&&<span className="ml-2 text-xs text-slate-500">“{t.approvalNotes}”</span>}</p>
   {t.stage==='pricing'&&can('pipeline.edit')&&<Btn className="justify-self-start" busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'request-approval',id:t.id}}),onChanged)}>Request internal approval</Btn>}
   {t.stage==='approval'&&t.approvalStatus==='requested'&&can('tender.approve')&&<><Field label="Approval notes"><textarea className={`${field} min-h-16`} value={notes} onChange={e=>setNotes(e.target.value)}/></Field><div className="flex flex-wrap gap-2"><Btn busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'approval-decision',id:t.id,approve:true,notes}}),onChanged)}>Approve for submission</Btn><Btn variant="danger" busy={busy} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'approval-decision',id:t.id,approve:false,notes}}),onChanged)}>Return to pricing</Btn></div></>}
   <ErrorState error={error}/>
  </div>
 </Section>;
}

function SubmissionTab({t,onChanged}:{t:Tender;onChanged:()=>void}){
 const {can}=useSession();const {busy,error,run}=useAction();
 const [v,setV]=useState({method:'',version:'',notes:'',documentId:'',overrideReason:''});
 if(t.submittedAt)return <Section title="Submission record"><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Submitted</dt><dd>{dateText(t.submittedAt)}</dd></div><div><dt className="text-slate-500">Method</dt><dd>{t.submissionMethod}</dd></div><div><dt className="text-slate-500">Version</dt><dd>{t.submissionVersion||'Not recorded'}</dd></div><div><dt className="text-slate-500">Notes</dt><dd>{t.submissionNotes||'—'}</dd></div>{t.submissionOverrideReason&&<div className="sm:col-span-2"><dt className="text-slate-500">Checks overridden</dt><dd className="text-amber-800">{t.submissionOverrideReason}</dd></div>}</dl></Section>;
 const failing=t.checks.filter(c=>!c.ok);
 return <Section title="Record submission" description="Infrastruct records the submission; it does not lodge it with the client.">
  <Checks t={t}/>
  {t.stage!=='approval'?<p className="mt-4 text-sm text-slate-600">Obtain internal approval before recording the submission.</p>:can('tender.submit')&&<form className="mt-4 grid gap-4" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'submit',id:t.id,method:v.method,version:v.version||null,notes:v.notes||null,documentId:v.documentId||null,overrideReason:failing.length?v.overrideReason:null}}),onChanged);}}>
   <div className="grid gap-4 sm:grid-cols-2"><Field label="Submission method" required><select className={field} required value={v.method} onChange={e=>setV({...v,method:e.target.value})}><option value="">Choose…</option><option>Client portal</option><option>Email</option><option>Hand delivered</option><option>Tender box</option><option>Other</option></select></Field><Field label="Version"><input className={field} value={v.version} onChange={e=>setV({...v,version:e.target.value})}/></Field></div>
   <Field label="Notes"><textarea className={`${field} min-h-16`} value={v.notes} onChange={e=>setV({...v,notes:e.target.value})}/></Field>
   <FieldGroup label="Submission evidence"><DocumentInput value={v.documentId} onChange={id=>setV(s=>({...s,documentId:id}))} contextType="tender" contextId={t.id}/></FieldGroup>
   {failing.length>0&&(can('tender.approve')?<Field label="Override reason (authorised approvers only)" hint="Required because checks are incomplete. Recorded in the audit trail."><textarea className={`${field} min-h-16`} value={v.overrideReason} onChange={e=>setV({...v,overrideReason:e.target.value})}/></Field>:<p className="text-sm text-amber-800">Complete the checks above before submitting.</p>)}
   <ErrorState error={error}/>
   {failing.length>0&&!(can('tender.approve')&&v.overrideReason.trim())&&<p role="status" className="text-sm text-amber-900">Submission is blocked by {failing.length} incomplete check{failing.length===1?'':'s'} above{can('tender.approve')?' unless you record an override reason':''}.</p>}
   <Btn className="justify-self-start" busy={busy} type="submit" disabled={!v.method||(failing.length>0&&!(can('tender.approve')&&v.overrideReason.trim()))}>Record submission</Btn>
  </form>}
 </Section>;
}

function AwardTab({t,onChanged}:{t:Tender;onChanged:()=>void}){
 const {can}=useSession();const {navigate}=useNav();const {busy,error,run}=useAction();const [reason,setReason]=useState('');const [notice,setNotice]=useState('');
 if(t.stage==='awarded')return <Section title="Awarded"><div className="flex flex-wrap items-center gap-3"><Trophy aria-hidden className="size-5 text-emerald-600"/><p className="text-sm">Awarded {dateText(t.outcomeAt)}. {t.projectId?'The project was created from the approved estimate revision with its original baseline.':'Projects is not enabled; export the award to continue.'}</p>{t.projectId?<Btn onClick={()=>navigate('Projects',undefined,t.projectId!)}>Open project<ArrowRight aria-hidden className="size-4"/></Btn>:<a className="text-sm underline" href={`/api/tenders/export?id=${t.id}`}>Export award (CSV)</a>}</div></Section>;
 if(t.stage==='lost')return <Section title="Lost / not bid"><p className="text-sm">{t.outcomeReason}</p><a className="mt-2 inline-block text-sm underline" href={`/api/tenders/export?id=${t.id}`}>Export tender record (CSV)</a></Section>;
 return <Section title="Outcome" description="Award creates the project from the approved estimate revision, preserving scope, assumptions, exclusions and clarifications.">
  {['submitted','clarification'].includes(t.stage)?<div className="grid gap-4">
   {Boolean(t.awardBlockers?.length)&&<div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Award is blocked until:</p><ul className="list-disc pl-5">{t.awardBlockers!.map(b=><li key={b}>{b}</li>)}</ul></div>}
   {can('tender.award')&&<Btn className="justify-self-start" busy={busy} disabled={Boolean(t.awardBlockers?.length)} onClick={()=>void run(()=>api<{projectCreated?:boolean;jobId?:string;message?:string}>('/api/tenders/workspace',{method:'POST',body:{action:'award',id:t.id}}),r=>{if(r.message)setNotice(r.message);onChanged();if(r.jobId)navigate('Projects',undefined,r.jobId);})}><Trophy aria-hidden className="size-4"/>Record award and create project</Btn>}
   <Field label="Loss reason"><textarea className={`${field} min-h-16`} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
   <Btn variant="danger" className="justify-self-start" busy={busy} disabled={!reason.trim()} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'lost',id:t.id,reason}}),onChanged)}>Record loss</Btn>
  </div>:<div className="grid gap-3"><p className="text-sm text-slate-600">The tender must be submitted before an outcome can be recorded.</p>{can('pipeline.edit')&&<><Field label="Withdraw reason"><textarea className={`${field} min-h-16`} value={reason} onChange={e=>setReason(e.target.value)}/></Field><Btn variant="danger" className="justify-self-start" busy={busy} disabled={!reason.trim()} onClick={()=>void run(()=>api('/api/tenders/workspace',{method:'POST',body:{action:'lost',id:t.id,reason}}),onChanged)}>Withdraw tender</Btn></>}</div>}
  {notice&&<p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}
  <div className="mt-3"><ErrorState error={error}/></div>
 </Section>;
}
