'use client';
import {useState,type ReactNode} from 'react';
import {ArrowRight,CalendarDays,Plus,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,field,Section,PageHeader,NextAction,Progress,Tabs,Stat,money,dateText,Pill} from './kit';
import {RegisterView,usePeople} from './register-view';
import {SwmsPanel} from './swms';
import {ProjectCommercial,ForecastSummary} from './commercial';
import {ActivityLog} from './admin';
import {useNav} from './nav';
import {allowedTransitions} from '@/lib/platform/workflow';
import type {Forecast} from '@/lib/platform/finance';

type Project={id:string;name:string;projectNumber:string|null;clientName:string|null;stage:string;stageLabel:string;projectManagerUserId:string|null;projectManagerName:string|null;startDate:string|null;practicalCompletionDate:string|null;finishDate:string|null;siteAddress:string|null;contractNumber:string|null;contractType:string|null;retentionPct:number|null;retentionEnabled?:boolean;retentionCapAmount?:number|null;paymentTermsDays:number|null;defectsMonths:number|null;scope:string|null;assumptions:string|null;exclusions:string|null;clientRequirements:string|null;mobilisationNotes:string|null;sourceTenderId:string|null;sourceEstimateId:string|null;sourceEstimateRevisionId:string|null;revision:number;contractValue?:number|null;originalBudget?:number|null;readiness:number|null;nextAction:string|null;blockerCount?:number};
type ReadinessItem={id?:string;category:string;title:string;mandatory:boolean;ok:boolean;status:string;source:'checklist'|'derived';detail?:string|null};
type Detail={project:Project;readiness:{percent:number|null;blockers:string[];categories:Array<{category:string;items:ReadinessItem[]}>;mandatoryTotal:number;mandatoryComplete:number};closeout:{items:number;blockers:string[]}|null;baselines:Array<{id:string;revision:number;reason:string;sourceType:string;estimateRevisionId:string|null;tenderId:string|null;scope:string|null;assumptions:string|null;exclusions:string|null;clarifications:Array<{reference:string;question:string;response:string|null}>;createdAt:string;contractValue?:number;budget?:Record<string,number>}>;financials:{forecast:Forecast}|null;activity:Array<{id:string;event_type:string;summary:string;actor_email:string|null;created_at:string}>};

export function ProjectsView(){
 const {route,navigate}=useNav();
 if(route.id)return <ProjectWorkspace id={route.id} tab={route.tab} onBack={()=>navigate('Projects')}/>;
 return <ProjectRegister/>;
}

function ProjectRegister(){
 const {data,error,loading,refresh}=useApi<{projects:Project[]}>('/api/projects');
 const {navigate}=useNav();const {can}=useSession();const [creating,setCreating]=useState(false);
 return <div className="grid gap-4">
  <PageHeader title="Projects" subtitle="Every awarded or manually created project, with readiness and the next action." actions={can('project.edit')&&<Btn variant="secondary" onClick={()=>setCreating(true)}><Plus aria-hidden className="size-4"/>New project without tender</Btn>}/>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!data?.projects.length?<EmptyState title="No projects yet." detail="Projects are created automatically when a tender or estimate is awarded, preserving the approved baseline."/>:
   <section className="surface overflow-hidden"><ul className="divide-y">{data.projects.map(p=><li key={p.id}><button onClick={()=>navigate('Projects',undefined,p.id)} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] md:items-center">
    <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block text-xs text-slate-500">{[p.projectNumber,p.clientName,p.projectManagerName].filter(Boolean).join(' · ')||'Client not recorded'}</span></span>
    <span><StatusBadge machine="project" state={p.stage}/></span>
    <span>{can('commercial.view')?<span className="text-sm">{money(p.contractValue)}</span>:<span className="text-sm text-slate-500">{dateText(p.startDate)}</span>}</span>
    <span><Progress value={p.readiness} label="Ready"/>{p.nextAction&&<span className="mt-1 block truncate text-xs text-orange-800">{p.nextAction}</span>}</span>
   </button></li>)}</ul></section>}
  <Sheet open={creating} onOpenChange={setCreating}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">New project</SheetTitle><SheetDescription className="sr-only">Create project</SheetDescription>{creating&&<NewProjectForm onDone={id=>{setCreating(false);refresh();if(id)navigate('Projects',undefined,id);}}/>}</SheetContent></Sheet>
 </div>;
}
function NewProjectForm({onDone}:{onDone:(id?:string)=>void}){
 const [v,setV]=useState({name:'',clientName:'',startDate:'',siteAddress:''});const {busy,error,run}=useAction();
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api<{projectId:string}>('/api/projects',{method:'POST',body:v}),r=>onDone(r.projectId));}}>
  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Use this when work did not come through a tender (for example IMS-only or Projects-only customers). Record the baseline in Setup.</p>
  <Field label="Project name" required><input className={field} required value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Client"><input className={field} value={v.clientName} onChange={e=>setV({...v,clientName:e.target.value})}/></Field><Field label="Start date"><input className={field} type="date" value={v.startDate} onChange={e=>setV({...v,startDate:e.target.value})}/></Field><Field label="Site address"><textarea className={`${field} min-h-16`} value={v.siteAddress} onChange={e=>setV({...v,siteAddress:e.target.value})}/></Field>
  <ErrorState error={error}/><div className="flex gap-2"><Btn busy={busy} type="submit">Create project</Btn><Btn type="button" variant="secondary" onClick={()=>onDone()}>Cancel</Btn></div>
 </form>;
}

type TabKey='overview'|'setup'|'delivery'|'quality'|'commercial'|'documents'|'closeout';
function ProjectWorkspace({id,tab,onBack}:{id:string;tab?:string;onBack:()=>void}){
 const {navigate}=useNav();const session=useSession();const {busy,error:actionError,run}=useAction();
 const active=(tab||'overview') as TabKey;
 // Re-fetch on tab change so the header (readiness, next action) reflects work done in other tabs.
 const {data,error,loading,refresh}=useApi<Detail>(`/api/projects/workspace?id=${id}&view=${active}`);
 if(loading&&!data)return <Loading label="Loading project…"/>;
 if(error&&!data)return <div className="grid gap-3"><ErrorState error={error} onRetry={refresh}/><Btn variant="secondary" onClick={onBack}>Back to projects</Btn></div>;
 const d=data!,p=d.project,closed=p.stage==='closed';
 const moves=allowedTransitions('project',p.stage,session.role,true);
 const move=(to:string)=>{let reason:string|undefined;if(p.stage==='closed'){reason=prompt('Reason for reopening')||'';if(!reason)return;}void run(()=>api('/api/projects/workspace',{method:'POST',body:{action:'transition',id,to,reason}}),refresh);};
 const tabs:Array<{key:TabKey;label:string;badge?:ReactNode;hidden?:boolean}>=[{key:'overview',label:'Overview'},{key:'setup',label:'Setup',badge:d.readiness.blockers.length&&p.stage==='setup'?<Pill tone="warning">{d.readiness.blockers.length}</Pill>:undefined},{key:'delivery',label:'Delivery'},{key:'quality',label:'Quality & HSEQ',hidden:!session.module('ims')},{key:'commercial',label:'Commercial',hidden:!session.can('commercial.view')||!session.module('commercial')},{key:'documents',label:'Documents'},{key:'closeout',label:'Closeout'}];
 return <div>
  <div className="sticky top-[72px] z-10 -mx-4 mb-4 border-b bg-[#f6f7f9]/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
   <PageHeader crumbs={[{label:'Projects',onClick:onBack},{label:p.name}]} title={p.name} badges={<StatusBadge machine="project" state={p.stage}/>} subtitle={[p.projectNumber,p.clientName,p.projectManagerName?`PM ${p.projectManagerName}`:null].filter(Boolean).join(' · ')}
    actions={<div className="flex flex-wrap items-center gap-2"><Progress value={d.readiness.percent} label="Readiness"/>{moves.filter(m=>session.can(m.capability)).map(m=>{const blocked=m.to==='ready'&&d.readiness.blockers.length>0||m.to==='closed'&&Boolean(d.closeout?.blockers.length);return <Btn key={m.to} variant={m.to==='closed'?'danger':'secondary'} busy={busy} disabled={blocked} title={blocked?'Resolve the outstanding requirements first':undefined} onClick={()=>move(m.to)}>{m.label}</Btn>;})}</div>}/>
   <NextAction text={p.nextAction}/>
  </div>
  <ErrorState error={actionError||error} onRetry={refresh}/>
  {closed&&<p className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">This project is closed. Records are read-only; reopen it (with a reason) to add operational records.</p>}
  <Tabs label="Project workspace" tabs={tabs} active={active} onChange={k=>navigate('Projects',undefined,id,k)}/>
  {active==='overview'&&<Overview d={d} onTab={k=>navigate('Projects',undefined,id,k)}/>}
  {active==='setup'&&<Setup d={d} onChanged={refresh}/>}
  {active==='delivery'&&<Delivery projectId={id}/>}
  {active==='quality'&&<Quality projectId={id} closed={closed} onChanged={refresh}/>}
  {active==='commercial'&&<ProjectCommercial projectId={id} closed={closed} onChanged={refresh}/>}
  {active==='documents'&&<Documents projectId={id} closed={closed}/>}
  {active==='closeout'&&<Closeout d={d} onChanged={refresh}/>}
 </div>;
}

function Overview({d,onTab}:{d:Detail;onTab:(k:TabKey)=>void}){
 const p=d.project;const {can}=useSession();
 const risks=useApi<{records:Array<Record<string,string>>}>(`/api/registers/risks?parentId=${p.id}`);
 const top=(risks.data?.records||[]).filter(r=>r.status==='open').sort((a,b)=>['Extreme','High','Medium','Low'].indexOf(a.residual_rating||a.initial_rating)-['Extreme','High','Medium','Low'].indexOf(b.residual_rating||b.initial_rating)).slice(0,5);
 return <div className="grid gap-4">
  {d.financials&&can('commercial.view')?<Section title="Commercial position" actions={<Btn variant="ghost" onClick={()=>onTab('commercial')}>Details<ArrowRight aria-hidden className="size-4"/></Btn>}><ForecastSummary f={d.financials.forecast}/></Section>:null}
  <div className="grid gap-4 lg:grid-cols-2">
   <Section title="Programme"><div className="grid gap-3 sm:grid-cols-3"><Stat label="Start" value={dateText(p.startDate)}/><Stat label="Practical completion" value={dateText(p.practicalCompletionDate)}/><Stat label="Finish" value={dateText(p.finishDate)}/></div></Section>
   <Section title="Readiness" actions={<Btn variant="ghost" onClick={()=>onTab('setup')}>Open setup<ArrowRight aria-hidden className="size-4"/></Btn>}><Progress value={d.readiness.percent} label={`${d.readiness.mandatoryComplete} of ${d.readiness.mandatoryTotal} mandatory requirements`}/>{d.readiness.blockers.length>0?<ul className="mt-3 grid gap-1 text-sm">{d.readiness.blockers.slice(0,6).map(b=><li key={b} className="text-amber-900">• {b}</li>)}</ul>:<p className="mt-3 text-sm text-emerald-700">All mandatory readiness requirements are satisfied.</p>}</Section>
   <Section title="Major open risks" actions={<Btn variant="ghost" onClick={()=>onTab('quality')}>Risk register<ArrowRight aria-hidden className="size-4"/></Btn>}>{top.length?<ul className="divide-y text-sm">{top.map(r=><li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.title}</span><Pill tone={['Extreme','High'].includes(r.residual_rating||r.initial_rating)?'danger':'warning'}>{r.residual_rating||r.initial_rating||'Unrated'}</Pill></li>)}</ul>:<EmptyState title="No open risks recorded."/>}</Section>
   <Section title="Recent activity">{d.activity.length?<ul className="divide-y text-sm">{d.activity.slice(0,8).map(a=><li key={a.id} className="py-2"><p>{a.summary||a.event_type}</p><p className="text-xs text-slate-500">{a.actor_email||'System'} · {dateText(a.created_at)}</p></li>)}</ul>:<EmptyState title="No activity recorded yet."/>}</Section>
  </div>
 </div>;
}

const SETUP_FIELDS:Array<[keyof Project,string,'text'|'date'|'number'|'textarea']>=[['name','Project name','text'],['clientName','Client','text'],['projectManagerName','Project manager','text'],['contractNumber','Contract number','text'],['contractType','Contract type','text'],['siteAddress','Project location / site','textarea'],['startDate','Start date','date'],['practicalCompletionDate','Practical completion date','date'],['finishDate','Finish date','date'],['retentionPct','Retention %','number'],['retentionCapAmount','Retention cap (AUD, optional)','number'],['paymentTermsDays','Payment terms (days)','number'],['defectsMonths','Defects period (months)','number'],['scope','Scope','textarea'],['assumptions','Assumptions','textarea'],['exclusions','Exclusions','textarea'],['clientRequirements','Client requirements','textarea'],['mobilisationNotes','Mobilisation requirements','textarea']];
function Setup({d,onChanged}:{d:Detail;onChanged:()=>void}){
 const p=d.project;const {can}=useSession();const people=usePeople();const {busy,error,run}=useAction();
 const [v,setV]=useState<Record<string,unknown>>(()=>Object.fromEntries([...SETUP_FIELDS.map(([k])=>[k,p[k]??'']),['projectManagerUserId',p.projectManagerUserId||''],['retentionEnabled',Boolean(p.retentionEnabled)]]));
 const editable=can('project.edit')&&p.stage!=='closed';
 const [baselineOpen,setBaselineOpen]=useState(false);
 return <div className="grid gap-4">
  <Section title="Contract details" actions={editable&&<Btn busy={busy} onClick={()=>void run(()=>api('/api/projects/workspace',{method:'PATCH',body:{id:p.id,revision:p.revision,...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x===''?null:x]))}}),onChanged)}>Save setup</Btn>}>
   <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{SETUP_FIELDS.map(([k,label,type])=><Field key={k} label={label}>{type==='textarea'?<textarea className={`${field} min-h-20`} disabled={!editable} value={String(v[k]??'')} onChange={e=>setV({...v,[k]:e.target.value})}/>:<input className={field} type={type} disabled={!editable} value={String(v[k]??'')} onChange={e=>setV({...v,[k]:type==='number'&&e.target.value!==''?Number(e.target.value):e.target.value})}/>}</Field>)}
    <label className="flex items-center gap-2 self-end text-sm font-medium text-slate-700"><input type="checkbox" className="size-5" disabled={!editable} checked={Boolean(v.retentionEnabled)} onChange={e=>setV({...v,retentionEnabled:e.target.checked})}/>Withhold retention on progress claims</label>
    <Field label="Project manager (member)"><select className={field} disabled={!editable} value={String(v.projectManagerUserId||'')} onChange={e=>setV({...v,projectManagerUserId:e.target.value})}><option value="">Not assigned</option>{people.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>
   <div className="mt-3"><ErrorState error={error}/></div>
  </Section>
  <Section title="Approved baseline" description="The original baseline is immutable. Budget changes flow through approved variations." actions={!d.baselines.length&&can('project.baseline')&&p.stage!=='closed'&&<Btn onClick={()=>setBaselineOpen(true)}>Record baseline</Btn>}>
   {!d.baselines.length?<EmptyState title="No baseline has been recorded for this project." detail="Awarded projects inherit their baseline from the approved estimate revision. Manually created projects record one here."/>:d.baselines.map(b=><div key={b.id} className="grid gap-3"><p className="text-sm">Revision {b.revision} · {b.reason} · {dateText(b.createdAt)}{b.estimateRevisionId&&' · from the approved estimate revision'}</p>
    {b.budget&&<div className="grid gap-3 sm:grid-cols-4"><Stat label="Contract value" value={money(b.contractValue)}/>{Object.entries(b.budget).map(([k,x])=><Stat key={k} label={`${k.charAt(0).toUpperCase()+k.slice(1)} budget`} value={money(x)}/>)}</div>}
    <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-slate-500">Scope</p><p className="whitespace-pre-wrap">{b.scope||'—'}</p></div><div><p className="text-slate-500">Assumptions</p><p className="whitespace-pre-wrap">{b.assumptions||'—'}</p></div><div><p className="text-slate-500">Exclusions</p><p className="whitespace-pre-wrap">{b.exclusions||'—'}</p></div></div>
    {b.clarifications.length>0&&<div className="text-sm"><p className="text-slate-500">Tender clarifications carried into the baseline</p><ul>{b.clarifications.map(c=><li key={c.reference}>{c.reference}: {c.question} — {c.response||'no response recorded'}</li>)}</ul></div>}</div>)}
  </Section>
  <Section title="Readiness" description={`${d.readiness.mandatoryComplete} of ${d.readiness.mandatoryTotal} mandatory requirements satisfied. Readiness is calculated from recorded evidence, approved SWMS, the risk register and the IMS pack.`}>
   <div className="grid gap-3 sm:grid-cols-2">{d.readiness.categories.map(c=><div key={c.category} className="rounded-lg border p-3"><p className="text-sm font-semibold capitalize">{c.category}</p><ul className="mt-1 grid gap-1 text-sm">{c.items.map((i,n)=><li key={i.id||n} className="flex items-start gap-2"><span aria-hidden className={i.ok?'text-emerald-600':i.mandatory?'text-amber-600':'text-slate-400'}>{i.ok?'✓':'•'}</span><span><span className={i.ok?'text-slate-500':''}>{i.title}</span>{i.source==='derived'&&<span className="ml-1 text-xs text-slate-400">(calculated)</span>}{!i.ok&&i.detail&&<span className="block text-xs text-slate-500">{i.detail}</span>}</span></li>)}</ul></div>)}</div>
  </Section>
  <RegisterView register="readiness" parentId={p.id} onChanged={onChanged} hideCreate={p.stage==='closed'}/>
  <RegisterView register="cost_codes" parentId={p.id} hideCreate={p.stage==='closed'}/>
  <RegisterView register="contacts" parentId={p.id} hideCreate={p.stage==='closed'}/>
  <Sheet open={baselineOpen} onOpenChange={setBaselineOpen}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">Record original baseline</SheetTitle><SheetDescription className="sr-only">Baseline</SheetDescription>{baselineOpen&&<BaselineForm projectId={p.id} onDone={()=>{setBaselineOpen(false);onChanged();}}/>}</SheetContent></Sheet>
 </div>;
}
function BaselineForm({projectId,onDone}:{projectId:string;onDone:()=>void}){
 const [v,setV]=useState<Record<string,string>>({contractValue:'',labour:'0',plant:'0',material:'0',subcontract:'0',other:'0',indirect:'0',reason:'Signed contract'});const {busy,error,run}=useAction();
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/projects/workspace',{method:'POST',body:{action:'baseline',id:projectId,...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='reason'?x:Number(x)||0]))}}),onDone);}}>
  <p className="text-sm text-slate-600">The baseline cannot be edited after it is recorded.</p>
  {(['contractValue','labour','plant','material','subcontract','other','indirect'] as const).map(k=><Field key={k} label={k==='contractValue'?'Contract value (ex GST)':`${k.charAt(0).toUpperCase()+k.slice(1)} budget`}><input className={field} type="number" step="0.01" required value={v[k]} onChange={e=>setV({...v,[k]:e.target.value})}/></Field>)}
  <Field label="Source / reason" required><input className={field} value={v.reason} onChange={e=>setV({...v,reason:e.target.value})}/></Field>
  <ErrorState error={error}/><Btn className="justify-self-start" busy={busy} type="submit">Record baseline</Btn>
 </form>;
}

function Delivery({projectId}:{projectId:string}){
 const {navigate}=useNav();
 const {data,error,loading,refresh}=useApi<{shifts:Array<{id:string;name:string;status:string;metadata:Record<string,string>}>;dockets:Array<{id:string;name:string;status:string;work_date:string}>}>(`/api/job-hub?jobId=${projectId}`);
 return <div className="grid gap-4">
  <Section title="Scheduled work" actions={<Btn variant="secondary" onClick={()=>navigate('Operations','Schedule')}><CalendarDays aria-hidden className="size-4"/>Open schedule</Btn>}>
   <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:!data?.shifts.length?<EmptyState title="No work has been scheduled for this project." detail="Plan shifts in Operations → Schedule. Workers, plant and competency conflicts are checked when you save."/>:<ul className="divide-y text-sm">{data.shifts.map(s=><li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{s.name}<span className="block text-xs text-slate-500">{[s.metadata.date,s.metadata.start&&`${s.metadata.start}–${s.metadata.finish}`,s.metadata.supervisor].filter(Boolean).join(' · ')}</span></span><Pill>{s.status}</Pill></li>)}</ul>}
  </Section>
  <Section title="Dockets" actions={<Btn variant="secondary" onClick={()=>navigate('Operations','Dockets')}>Review dockets</Btn>}>
   {!data?.dockets.length?<EmptyState title="No dockets are allocated to this project."/>:<ul className="divide-y text-sm">{data.dockets.map(d=><li key={d.id} className="flex items-center justify-between gap-2 py-2"><span>{d.name}<span className="block text-xs text-slate-500">{dateText(d.work_date)}</span></span><Pill tone={d.status==='approved'?'success':['included_claim','invoiced'].includes(d.status)?'info':'warning'}>{d.status==='included_claim'?'claimed':d.status}</Pill></li>)}</ul>}
  </Section>
 </div>;
}

function Quality({projectId,closed,onChanged}:{projectId:string;closed:boolean;onChanged:()=>void}){
 const [itp,setItp]=useState<{id:string;title:string}|null>(null);
 return <div className="grid gap-4">
  <RegisterView register="risks" parentId={projectId} hideCreate={closed} onChanged={onChanged}/>
  <SwmsPanel projectId={projectId} onChanged={onChanged}/>
  <RegisterView register="itps" parentId={projectId} hideCreate={closed} rowActions={r=><Btn variant="ghost" onClick={()=>setItp({id:r.id,title:String(r.title)})}>Inspection points<ArrowRight aria-hidden className="size-4"/></Btn>}/>
  <RegisterView register="incidents" parentId={projectId} hideCreate={closed}/>
  <RegisterView register="ncrs" parentId={projectId} hideCreate={closed}/>
  <RegisterView register="actions" parentId={projectId} hideCreate={closed}/>
  <Sheet open={Boolean(itp)} onOpenChange={o=>{if(!o)setItp(null);}}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">{itp?.title}</SheetTitle><SheetDescription className="sr-only">Inspection points</SheetDescription>{itp&&<div className="p-4"><RegisterView register="itp_items" parentId={itp.id} projectId={projectId} hideCreate={closed}/></div>}</SheetContent></Sheet>
 </div>;
}

type Doc={id:string;title:string;fileName:string;category:string;version:number;visibility:string;createdAt:string;url:string;sizeBytes:number};
export function Documents({projectId,closed}:{projectId:string;closed:boolean}){
 const {can}=useSession();const {data,error,loading,refresh}=useApi<{documents:Doc[]}>(`/api/documents?projectId=${projectId}`);const {busy,error:upError,run}=useAction();
 const [category,setCategory]=useState('General'),[visibility,setVisibility]=useState('office');
 return <Section title="Project documents" description="Files are private: downloads go through authenticated, organisation-scoped links. Field-visible files are available to site staff." actions={!closed&&can('document.upload')&&<label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-[#172633] px-3.5 text-sm font-medium text-white"><Upload aria-hidden className="size-4"/>{busy?'Uploading…':'Upload'}<input type="file" className="sr-only" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const f=new FormData();f.set('file',file);f.set('contextType','project');f.set('projectId',projectId);f.set('category',category);f.set('visibility',visibility);void run(()=>api('/api/documents',{method:'POST',body:f}),refresh);e.target.value='';}}/></label>}>
  {!closed&&can('document.upload')&&<div className="mb-3 grid gap-3 sm:grid-cols-2"><Field label="Category for next upload"><select className={field} value={category} onChange={e=>setCategory(e.target.value)}>{['General','Contract','Drawings','Specification','Programme','HSEQ','Quality','As-built','Correspondence','Photos'].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Visibility"><select className={field} value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="office">Office only</option><option value="field">Office and field</option></select></Field></div>}
  <ErrorState error={error||upError} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!data?.documents.length?<EmptyState title="No documents have been uploaded for this project."/>:<ul className="divide-y text-sm">{data.documents.map(d=><li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><a className="text-sky-700 underline" href={d.url}>{d.title}</a><span className="text-xs text-slate-500">{d.category} · v{d.version} · {d.visibility==='field'?'field visible':'office only'} · {dateText(d.createdAt)}</span></li>)}</ul>}
 </Section>;
}

function Closeout({d,onChanged}:{d:Detail;onChanged:()=>void}){
 const p=d.project;
 if(!['practical_completion','closeout','closed'].includes(p.stage))return <Section title="Closeout"><EmptyState title="Closeout starts after practical completion." detail="Record practical completion from the project header when works are complete."/></Section>;
 return <div className="grid gap-4">
  {d.closeout&&d.closeout.blockers.length>0&&<Section title="Before the project can close"><ul className="grid gap-1 text-sm">{d.closeout.blockers.map(b=><li key={b} className="text-amber-900">• {b}</li>)}</ul></Section>}
  <RegisterView register="closeout" parentId={p.id} onChanged={onChanged} hideCreate={p.stage==='closed'} description="Outstanding works, defects, final QA/HSEQ records, as-builts, client documents, final claim, invoices and lessons learned."/>
  <ActivityLog projectId={p.id}/>
 </div>;
}
