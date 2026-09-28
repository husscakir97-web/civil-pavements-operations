'use client';
import {useState,type ReactNode} from 'react';
import {ArrowRight,CalendarDays,CheckCircle2,Plus,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,StatusBadge,EmptyState,ErrorState,Loading,Btn,Field,field,Section,PageHeader,NextAction,Progress,Tabs,Stat,money,pct,dateText,Pill,humanStatus,ReasonDialog} from './kit';
import {ClientPicker,SitePicker,PersonPicker} from './lookup';
import {RegisterView,usePeople} from './register-view';
import {SwmsPanel} from './swms';
import {KnowledgeCheckPanel} from './knowledge-checks';
import {ProjectCommercial,presetClaimLine} from './commercial';
import {ActivityLog} from './admin';
import {useNav} from './nav';
import {allowedTransitions} from '@/lib/platform/workflow';
import type {Forecast} from '@/lib/platform/finance';
import {setupAreas,fixFor,categoryLabel,nextActionTarget,type SetupTarget} from '@/lib/v1/project-setup';

type Project={id:string;name:string;projectNumber:string|null;clientName:string|null;clientId?:string|null;siteId?:string|null;stage:string;stageLabel:string;projectManagerUserId:string|null;projectManagerName:string|null;startDate:string|null;practicalCompletionDate:string|null;finishDate:string|null;siteAddress:string|null;contractNumber:string|null;contractType:string|null;retentionPct:number|null;retentionEnabled?:boolean;retentionCapAmount?:number|null;paymentTermsDays:number|null;defectsMonths:number|null;scope:string|null;assumptions:string|null;exclusions:string|null;clientRequirements:string|null;mobilisationNotes:string|null;sourceTenderId:string|null;sourceEstimateId:string|null;sourceEstimateRevisionId:string|null;revision:number;contractValue?:number|null;originalBudget?:number|null;readiness:number|null;nextAction:string|null;blockerCount?:number};
type ReadinessItem={id?:string;category:string;title:string;mandatory:boolean;ok:boolean;status:string;source:'checklist'|'derived';detail?:string|null};
type Detail={project:Project;readiness:{percent:number|null;blockers:string[];categories:Array<{category:string;items:ReadinessItem[]}>;mandatoryTotal:number;mandatoryComplete:number};closeout:{items:number;blockers:string[]}|null;baselines:Array<{id:string;revision:number;reason:string;sourceType:string;estimateRevisionId:string|null;tenderId:string|null;scope:string|null;assumptions:string|null;exclusions:string|null;clarifications:Array<{reference:string;question:string;response:string|null}>;createdAt:string;contractValue?:number;budget?:Record<string,number>}>;financials:{forecast:Forecast}|null;activity:Array<{id:string;event_type:string;summary:string;actor_email:string|null;created_at:string}>};

export function ProjectsView(){
 const {route,navigate}=useNav();
 const area=route.area==='Deliver Work'?'Deliver Work':'Prepare Work';
 if(route.id)return <ProjectWorkspace id={route.id} tab={route.tab} area={area} onBack={()=>navigate(area,'Projects')}/>;
 return <ProjectRegister area={area}/>;
}

function ProjectRegister({area}:{area:'Prepare Work'|'Deliver Work'}){
 const {data,error,loading,refresh}=useApi<{projects:Project[]}>('/api/projects');
 const {navigate}=useNav();const {can}=useSession();const [creating,setCreating]=useState(false);
 const [show,setShow]=useState<'active'|'setup'|'ready'|'delivery'|'closeout'|'closed'>('active');
 const all=data?.projects||[];
 const matches=(p:Project,k:typeof show)=>k==='closed'?p.stage==='closed':k==='setup'?p.stage==='setup':k==='ready'?p.stage==='ready':k==='delivery'?p.stage==='active':k==='closeout'?['practical_completion','closeout'].includes(p.stage):p.stage!=='closed';
 const list=all.filter(p=>matches(p,show));
 const filters=([['active','All active'],['setup','Setup'],['ready','Ready'],['delivery','Delivery'],['closeout','Closeout'],['closed','Closed']] as const).map(([key,label])=>({key,label,count:all.filter(p=>matches(p,key)).length}));
 return <div className="grid gap-4">
  <PageHeader title="Projects" subtitle="Every awarded or manually created project, with readiness and the next action." actions={can('project.edit')&&<Btn variant="secondary" onClick={()=>setCreating(true)}><Plus aria-hidden className="size-4"/>New project without tender</Btn>}/>
  <ErrorState error={error} onRetry={refresh}/>
  {all.length>0&&<div role="group" aria-label="Project workflow stage" className="flex flex-wrap gap-2">{filters.map(x=><button key={x.key} aria-pressed={show===x.key} onClick={()=>setShow(x.key)} className={`min-h-9 rounded-full border px-3 text-sm ${show===x.key?'border-[#172633] bg-[#172633] text-white':'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{x.label} ({x.count})</button>)}</div>}
  {loading&&!data?<Loading/>:!all.length?<EmptyState title="No projects yet." detail="Projects are created automatically when a tender or estimate is awarded, preserving the approved baseline."/>:!list.length?<EmptyState title={`No projects are in ${filters.find(x=>x.key===show)?.label.toLowerCase()}.`}/>:
   <section className="surface overflow-hidden"><ul className="divide-y">{list.map(p=><li key={p.id}><button onClick={()=>navigate(area,'Projects',p.id)} className="grid w-full gap-2 p-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] md:items-center">
    <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block text-xs text-slate-500">{[p.projectNumber,p.clientName,p.projectManagerName].filter(Boolean).join(' · ')||'Client not recorded'}</span></span>
    <span><StatusBadge machine="project" state={p.stage}/></span>
    <span>{can('commercial.view')?<span className="text-sm">{money(p.contractValue)}</span>:<span className="text-sm text-slate-500">{dateText(p.startDate)}</span>}</span>
    <span><Progress value={p.readiness} label="Ready"/>{p.nextAction&&<span className="mt-1 block truncate text-xs text-orange-800">{p.nextAction}</span>}</span>
   </button></li>)}</ul></section>}
  <Sheet open={creating} onOpenChange={setCreating}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg"><SheetTitle className="border-b px-5 py-4 text-lg font-semibold">New project</SheetTitle><SheetDescription className="sr-only">Create project</SheetDescription>{creating&&<NewProjectForm onDone={id=>{setCreating(false);refresh();if(id)navigate(area,'Projects',id);}}/>}</SheetContent></Sheet>
 </div>;
}
function NewProjectForm({onDone}:{onDone:(id?:string)=>void}){
 const [v,setV]=useState({name:'',clientId:null as string|null,siteId:null as string|null,startDate:'',siteAddress:''});const {busy,error,run}=useAction();
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api<{projectId:string}>('/api/projects',{method:'POST',body:v}),r=>onDone(r.projectId));}}>
  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Use this when work did not come through a tender (for example IMS-only or Projects-only customers). Record the baseline in Setup.</p>
  <Field label="Project name" required><input className={field} required value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field>
  {/* Choosing a client suggests its only site; a chosen site fills the address unless one is typed. */}
  <ClientPicker value={v.clientId} onChange={c=>setV(s=>({...s,clientId:c?.id??null,siteId:c?.sites.length===1?c.sites[0].id:c&&c.sites.some(x=>x.id===s.siteId)?s.siteId:null}))}/>
  {v.clientId&&<SitePicker clientId={v.clientId} value={v.siteId} onChange={x=>setV(s=>({...s,siteId:x?.id??null}))}/>}
  <Field label="Start date"><input className={field} type="date" value={v.startDate} onChange={e=>setV({...v,startDate:e.target.value})}/></Field>
  {!v.siteId&&<Field label="Site address"><textarea className={`${field} min-h-16`} value={v.siteAddress} onChange={e=>setV({...v,siteAddress:e.target.value})}/></Field>}
  <ErrorState error={error}/><div className="flex gap-2"><Btn busy={busy} type="submit">Create project</Btn><Btn type="button" variant="secondary" onClick={()=>onDone()}>Cancel</Btn></div>
 </form>;
}

type TabKey='overview'|'setup'|'delivery'|'quality'|'commercial'|'documents'|'closeout';
const TAB_LABEL:Record<TabKey,string>={overview:'Overview',setup:'Setup',delivery:'Delivery',quality:'Quality & HSEQ',commercial:'Commercial',documents:'Documents',closeout:'Closeout'};
function ProjectWorkspace({id,tab,area,onBack}:{id:string;tab?:string;area:'Prepare Work'|'Deliver Work';onBack:()=>void}){
 const {navigate}=useNav();const session=useSession();const {busy,error:actionError,run}=useAction();
 const active=(tab||'overview') as TabKey;
 const [checklistFocus,setChecklistFocus]=useState<string|null>(null);
 const [reopening,setReopening]=useState<string|null>(null);
 // Re-fetch on tab change so the header (readiness, next action) reflects work done in other tabs.
 const {data,error,loading,refresh}=useApi<Detail>(`/api/projects/workspace?id=${id}&view=${active}`);
 if(loading&&!data)return <Loading label="Loading project…"/>;
 if(error&&!data)return <div className="grid gap-3"><ErrorState error={error} onRetry={refresh}/><Btn variant="secondary" onClick={onBack}>Back to projects</Btn></div>;
 const d=data!,p=d.project,closed=p.stage==='closed';
 const moves=allowedTransitions('project',p.stage,session.role,true);
 const move=(to:string,reason?:string)=>{if(p.stage==='closed'&&reason===undefined){setReopening(to);return;}if(to==='closed'&&!confirm('Close this project? Records become read-only until it is reopened with a reason.'))return;void run(()=>api('/api/projects/workspace',{method:'POST',body:{action:'transition',id,to,reason}}),refresh);};
 const scrollTo=(anchor:string)=>setTimeout(()=>document.getElementById(anchor)?.scrollIntoView({behavior:'smooth',block:'start'}),350);
 /** Every "fix" and "next action" button lands on the place the work is done. */
 const goTarget=(t:SetupTarget)=>{
  if(t.kind==='tab')return navigate(area,'Projects',id,t.tab);
  if(t.kind==='area')return navigate(t.area,t.sub,t.withProject?id:undefined);
  navigate(area,'Projects',id,'setup');
  if(t.kind==='anchor')return scrollTo(t.anchor);
  setChecklistFocus(t.category);scrollTo('setup-checklist');
 };
 const nextTarget=nextActionTarget(p.stage,p.nextAction);
 const nextGo=nextTarget&&!(nextTarget.kind==='tab'&&nextTarget.tab===active)?()=>goTarget(nextTarget):undefined;
 const tabs:Array<{key:TabKey;label:string;badge?:ReactNode;hidden?:boolean}>=[{key:'overview',label:'Overview'},{key:'setup',label:'Setup',badge:d.readiness.blockers.length&&p.stage==='setup'?<Pill tone="warning">{d.readiness.blockers.length}</Pill>:undefined},{key:'delivery',label:'Delivery'},{key:'quality',label:'Quality & HSEQ',hidden:!session.module('ims')},{key:'commercial',label:'Commercial',hidden:!session.can('commercial.view')||!session.module('commercial')},{key:'documents',label:'Documents'},{key:'closeout',label:'Closeout'}];
 const blockedReady=d.readiness.blockers.length>0,blockedClose=Boolean(d.closeout?.blockers.length);
 return <div>
  <div className="-mx-4 mb-4 border-b bg-[#f6f7f9]/95 px-4 pb-3 pt-1 backdrop-blur sm:sticky sm:top-[72px] sm:z-10 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
   <PageHeader crumbs={[{label:'Projects',onClick:onBack},{label:p.name,onClick:active==='overview'?undefined:()=>navigate(area,'Projects',id)},...(active==='overview'?[]:[{label:TAB_LABEL[active]}])]} title={p.name} badges={<StatusBadge machine="project" state={p.stage}/>}
    subtitle={[p.projectNumber,p.clientName||'No client',p.projectManagerName?`PM ${p.projectManagerName}`:'No PM assigned',session.can('commercial.view')&&p.contractValue!=null?`Contract ${money(p.contractValue)}`:null].filter(Boolean).join(' · ')}
    actions={<div className="flex flex-wrap items-center gap-2">{p.stage==='setup'&&<Progress value={d.readiness.percent} label={blockedReady?`${d.readiness.blockers.length} blocker${d.readiness.blockers.length===1?'':'s'}`:'Ready'}/>}{moves.filter(m=>session.can(m.capability)).map(m=>{const blocked=m.to==='ready'&&blockedReady||m.to==='closed'&&blockedClose;return <Btn key={m.to} variant={m.to==='closed'?'danger':blocked?'secondary':'primary'} busy={busy} disabled={blocked} title={blocked?(m.to==='ready'?'Resolve the readiness blockers first':'Resolve the closeout items first'):undefined} onClick={()=>move(m.to)}>{m.label}</Btn>;})}</div>}/>
   <NextAction text={p.nextAction} onClick={nextGo} actionLabel={nextTarget?.kind==='tab'?`Go to ${TAB_LABEL[nextTarget.tab]}`:'Go'}/>
  </div>
  <ReasonDialog open={Boolean(reopening)} title="Reopen project" description="This moves the project from Closed back to Closeout so records can be added or corrected. The reason is recorded in the audit trail." label="Reason for reopening" required confirmLabel="Reopen project" busy={busy} onCancel={()=>setReopening(null)} onConfirm={r=>{const to=reopening!;setReopening(null);move(to,r);}}/>
  <ErrorState error={actionError||error} onRetry={refresh}/>
  {closed&&<p className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">This project is closed. Records are read-only; reopen it (with a reason) to add operational records.</p>}
  {/* Phones: one labelled picker for the seven areas (no sideways tab hunt). Same routes, so deep links and back/forward work. */}
  <label className="sticky top-[72px] z-10 -mx-4 mb-4 grid gap-1 border-b bg-[#f6f7f9]/95 px-4 pb-3 pt-2 text-sm backdrop-blur sm:hidden"><span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{p.name} · section</span><select aria-label="Project section" className={`${field} font-semibold`} value={active} onChange={e=>navigate(area,'Projects',id,e.target.value)}>{tabs.filter(t=>!t.hidden).map(t=><option key={t.key} value={t.key}>{t.label}{t.key==='setup'&&p.stage==='setup'&&d.readiness.blockers.length?` · ${d.readiness.blockers.length} blocker${d.readiness.blockers.length===1?'':'s'}`:''}</option>)}</select></label>
  <div className="hidden sm:block"><Tabs label="Project workspace" tabs={tabs} active={active} onChange={k=>navigate(area,'Projects',id,k)}/></div>
  {active==='overview'&&<Overview d={d} onTab={k=>navigate(area,'Projects',id,k)} goTarget={goTarget}/>}
  {active==='setup'&&<Setup d={d} onChanged={refresh} goTarget={goTarget} focus={checklistFocus} setFocus={setChecklistFocus}/>}
  {active==='delivery'&&<Delivery projectId={id} area={area}/>}
  {active==='quality'&&<Quality projectId={id} closed={closed} onChanged={refresh}/>}
  {active==='commercial'&&<ProjectCommercial projectId={id} closed={closed} onChanged={refresh}/>}
  {active==='documents'&&<Documents projectId={id} closed={closed}/>}
  {active==='closeout'&&<Closeout d={d} onChanged={refresh}/>}
 </div>;
}

type Attention={key:string;title:string;detail?:string;tone:'danger'|'warning'|'info';action:string;go:()=>void};
const TONE={danger:'border-l-red-500',warning:'border-l-amber-500',info:'border-l-sky-500'};
function AttentionList({items,empty}:{items:Attention[];empty:string}){
 if(!items.length)return <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 aria-hidden className="size-4"/>{empty}</p>;
 return <ul className="divide-y rounded-lg border">{items.map(i=><li key={i.key} className={`flex flex-wrap items-center gap-3 border-l-4 px-3 py-2.5 ${TONE[i.tone]}`}><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{i.title}</span>{i.detail&&<span className="block text-xs text-slate-500">{i.detail}</span>}</span><Btn variant="secondary" className="min-h-9 py-1" onClick={i.go}>{i.action}<ArrowRight aria-hidden className="size-3.5"/></Btn></li>)}</ul>;
}

type Rec=Record<string,string>;
function Overview({d,onTab,goTarget}:{d:Detail;onTab:(k:TabKey)=>void;goTarget:(t:SetupTarget)=>void}){
 const p=d.project;const {can,module}=useSession();const {navigate}=useNav();
 const hseq=can('hseq.view')&&module('ims'),money_=can('commercial.view')&&module('commercial'),knowledge=can('knowledge.view');
 const risks=useApi<{records:Rec[]}>(hseq?`/api/registers/risks?parentId=${p.id}`:null);
 const swms=useApi<{swms:Array<{id:string;reference:string;title:string;status:string}>}>(hseq?`/api/hseq/swms?projectId=${p.id}`:null);
 const ncrs=useApi<{records:Rec[]}>(hseq?`/api/registers/ncrs?parentId=${p.id}`:null);
 const incidents=useApi<{records:Rec[]}>(hseq?`/api/registers/incidents?parentId=${p.id}`:null);
 const variations=useApi<{records:Rec[]}>(money_?`/api/registers/variations?parentId=${p.id}`:null);
 const hub=useApi<{shifts:Array<{id:string;name:string;status:string;metadata:Record<string,string>}>;dockets:Array<{id:string;status:string}>}>(`/api/job-hub?jobId=${p.id}`);
 const rating=(r:Rec)=>r.residual_rating||r.initial_rating;
 const openRisks=(risks.data?.records||[]).filter(r=>r.status==='open').sort((a,b)=>['Extreme','High','Medium','Low'].indexOf(rating(a))-['Extreme','High','Medium','Low'].indexOf(rating(b)));
 // Exceptions first: what stops this project, in the order someone should deal with it.
 const items:Attention[]=[];
 if(['setup','ready'].includes(p.stage)){
  const gaps=d.readiness.categories.flatMap(c=>c.items).filter(i=>i.mandatory&&!i.ok);
  for(const g of gaps.slice(0,4)){const f=fixFor(g);items.push({key:`r-${g.id||g.title}`,title:g.title,detail:g.detail||`${categoryLabel(g.category)} · readiness`,tone:'warning',action:f.action,go:()=>goTarget(f.target)});}
  if(gaps.length>4)items.push({key:'r-more',title:`${gaps.length-4} more readiness item${gaps.length-4===1?'':'s'}`,tone:'info',action:'Open setup',go:()=>onTab('setup')});
 }
 for(const s of (swms.data?.swms||[]).filter(s=>['draft','review'].includes(s.status)))items.push({key:`s-${s.id}`,title:`${s.reference} ${s.title}`,detail:s.status==='review'?'SWMS waiting for approval':'SWMS still in draft',tone:'warning',action:'Open SWMS',go:()=>onTab('quality')});
 for(const i of (incidents.data?.records||[]).filter(r=>r.status!=='closed'))items.push({key:`i-${i.id}`,title:`Incident: ${i.description||i.incident_type||'reported'}`.slice(0,110),detail:`${i.severity||''} ${i.status||''}`.trim(),tone:'danger',action:'Review',go:()=>onTab('quality')});
 for(const n of (ncrs.data?.records||[]).filter(r=>r.status!=='closed'))items.push({key:`n-${n.id}`,title:`${n.reference?n.reference+' ':''}${n.title||'Non-conformance'}`,detail:'Open NCR',tone:'warning',action:'Review',go:()=>onTab('quality')});
 for(const r of openRisks.filter(r=>['Extreme','High'].includes(rating(r))))items.push({key:`k-${r.id}`,title:`${rating(r)} risk: ${r.title}`,detail:'Open risk without adequate controls',tone:'danger',action:'Open risk register',go:()=>onTab('quality')});
 for(const v of (variations.data?.records||[]).filter(r=>['draft','submitted'].includes(r.status)))items.push({key:`v-${v.id}`,title:`${v.reference} ${v.title}`,detail:v.status==='draft'?'Variation not yet submitted — notice periods may apply':'Submitted variation awaiting the client decision',tone:v.status==='draft'?'warning':'info',action:'Open commercial',go:()=>onTab('commercial')});
 const f=d.financials?.forecast;
 if(money_&&f&&Number(f.unbilled)>0)items.push({key:'unbilled',title:`Unbilled work ${money(f.unbilled)}`,detail:'Earned revenue not yet claimed',tone:'info',action:'Prepare claim',go:()=>onTab('commercial')});
 const reviewDockets=(hub.data?.dockets||[]).filter(x=>['review','uploaded','matched','ready','draft'].includes(x.status)).length;
 if(reviewDockets&&can('docket.approve'))items.push({key:'dockets',title:`${reviewDockets} docket${reviewDockets===1?'':'s'} waiting for review`,tone:'warning',action:'Review dockets',go:()=>navigate('Operations','Dockets')});
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
 const upcoming=(hub.data?.shifts||[]).filter(s=>(s.metadata.date||'')>=today&&!['Cancelled','Archived'].includes(s.status)).sort((a,b)=>`${a.metadata.date}${a.metadata.start}`.localeCompare(`${b.metadata.date}${b.metadata.start}`)).slice(0,5);
 return <div className="grid gap-4">
  <Section title="Needs attention" description={items.length?`${items.length} item${items.length===1?'':'s'} for this project`:undefined}><AttentionList items={items} empty="Nothing needs attention on this project right now."/></Section>
  {knowledge&&<KnowledgeCheckPanel title="Civil knowledge checks" topics={['project','contract','construction','hseq','pavements','asphalt','concrete','earthworks','drainage','traffic','plant','workforce']} scope={{projectId:p.id}} context={{project:{id:p.id,name:p.name,stage:p.stage,clientName:p.clientName,contractType:p.contractType,siteAddress:p.siteAddress,startDate:p.startDate,finishDate:p.finishDate,scope:p.scope,assumptions:p.assumptions,exclusions:p.exclusions,clientRequirements:p.clientRequirements,mobilisationNotes:p.mobilisationNotes}}}/>} 
  <div className="grid gap-4 lg:grid-cols-2">
   <Section title="Today and upcoming" actions={<Btn variant="ghost" onClick={()=>onTab('delivery')}>Delivery<ArrowRight aria-hidden className="size-4"/></Btn>}>{hub.loading&&!hub.data?<Loading/>:upcoming.length?<ul className="divide-y text-sm">{upcoming.map(s=><li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{s.metadata.date===today?'Today':dateText(s.metadata.date)}</span> · {s.name}<span className="block text-xs text-slate-500">{[s.metadata.start&&`${s.metadata.start}–${s.metadata.finish}`,s.metadata.supervisor].filter(Boolean).join(' · ')}</span></span><Pill>{s.status}</Pill></li>)}</ul>:<EmptyState title="No upcoming work is scheduled for this project." action={can('schedule.edit')?<Btn variant="secondary" onClick={()=>navigate('Operations','Schedule',p.id)}><CalendarDays aria-hidden className="size-4"/>Plan a shift</Btn>:undefined}/>}</Section>
   {money_&&f?<Section title="Financial snapshot" actions={<Btn variant="ghost" onClick={()=>onTab('commercial')}>Commercial<ArrowRight aria-hidden className="size-4"/></Btn>}><div className="grid grid-cols-2 gap-3"><Stat label="Current contract" value={money(f.currentContract)}/><Stat label="Forecast margin" value={pct(f.forecastMarginPct)} tone={f.forecastMarginPct==null?undefined:f.forecastMarginPct<0?'bad':f.forecastMarginPct<5?'warn':'good'} hint={`${money(f.forecastProfit)} profit`}/><Stat label="Actual cost" value={money(f.actual)} hint={`of ${money(f.currentBudget)} budget`}/><Stat label="Claimed" value={money(f.claimed)} hint={`${money(f.unbilled)} unbilled`}/></div></Section>
    :<Section title="Programme"><div className="grid gap-3 sm:grid-cols-3"><Stat label="Start" value={dateText(p.startDate)}/><Stat label="Practical completion" value={dateText(p.practicalCompletionDate)}/><Stat label="Finish" value={dateText(p.finishDate)}/></div></Section>}
  </div>
  <div className="grid gap-4 lg:grid-cols-2">
   {hseq&&<Section title="Open risks" actions={<Btn variant="ghost" onClick={()=>onTab('quality')}>Risk register<ArrowRight aria-hidden className="size-4"/></Btn>}>{openRisks.length?<ul className="divide-y text-sm">{openRisks.slice(0,5).map(r=><li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{r.title}</span><Pill tone={['Extreme','High'].includes(rating(r))?'danger':'warning'}>{rating(r)||'Unrated'}</Pill></li>)}</ul>:<EmptyState title="No open risks are recorded for this project."/>}</Section>}
   <Section title="Recent activity">{d.activity.length?<ul className="divide-y text-sm">{d.activity.slice(0,6).map(a=><li key={a.id} className="py-2"><p>{a.summary||a.event_type}</p><p className="text-xs text-slate-500">{a.actor_email||'System'} · {dateText(a.created_at)}</p></li>)}</ul>:<EmptyState title="No activity has been recorded for this project yet."/>}</Section>
  </div>
 </div>;
}

const SETUP_FIELDS:Array<[keyof Project,string,'text'|'date'|'number'|'textarea']>=[['name','Project name','text'],['clientName','Client','text'],['projectManagerName','Project manager','text'],['contractNumber','Contract number','text'],['contractType','Contract type','text'],['siteAddress','Project location / site','textarea'],['startDate','Start date','date'],['practicalCompletionDate','Practical completion date','date'],['finishDate','Finish date','date'],['retentionPct','Retention %','number'],['retentionCapAmount','Retention cap (AUD, optional)','number'],['paymentTermsDays','Payment terms (days)','number'],['defectsMonths','Defects period (months)','number'],['scope','Scope','textarea'],['assumptions','Assumptions','textarea'],['exclusions','Exclusions','textarea'],['clientRequirements','Client requirements','textarea'],['mobilisationNotes','Mobilisation requirements','textarea']];
const SETUP_GROUPS=[
 {key:'project',label:'Project & programme',description:'Who, where and when.',fields:['name','clientName','projectManagerName','siteAddress','startDate','practicalCompletionDate','finishDate']},
 {key:'contract',label:'Contract & payment',description:'Contract administration and payment settings.',fields:['contractNumber','contractType','retentionPct','retentionCapAmount','paymentTermsDays','defectsMonths']},
 {key:'scope',label:'Scope & mobilisation',description:'What is included, excluded and required before delivery.',fields:['scope','assumptions','exclusions','clientRequirements','mobilisationNotes']},
] as const;
const AREA_TONE={complete:'success',attention:'warning',not_started:'neutral'} as const;
const AREA_LABEL={complete:'Complete',attention:'Needs attention',not_started:'Not started'};

function Setup({d,onChanged,goTarget,focus,setFocus}:{d:Detail;onChanged:()=>void;goTarget:(t:SetupTarget)=>void;focus:string|null;setFocus:(c:string|null)=>void}){
 const p=d.project;const {can}=useSession();const people=usePeople();const {busy,error,run}=useAction();
 const [v,setV]=useState<Record<string,unknown>>(()=>Object.fromEntries([...SETUP_FIELDS.map(([k])=>[k,p[k]??'']),['projectManagerUserId',p.projectManagerUserId||''],['clientId',p.clientId||null],['retentionEnabled',Boolean(p.retentionEnabled)]]));
 const editable=can('project.edit')&&p.stage!=='closed';
 const [baselineOpen,setBaselineOpen]=useState(false);
 const [showAllBlockers,setShowAllBlockers]=useState(false);
 const missing=[['Contract number',p.contractNumber],['Start date',p.startDate],['Site',p.siteAddress],['Project manager',p.projectManagerUserId||p.projectManagerName]].filter(([,x])=>!x).map(([k])=>String(k));
 const areas=setupAreas(d.readiness.categories,{complete:!missing.length,missing});
 const complete=areas.filter(a=>a.status==='complete').length;
 const gaps=d.readiness.categories.flatMap(c=>c.items).filter(i=>i.mandatory&&!i.ok);
 const ready=!gaps.length;
 return <div className="grid gap-4">
  {/* Readiness leads with what blocks mobilisation; the percentage is secondary. */}
  <section aria-label="Readiness" className={`surface p-4 sm:p-5 ${ready?'':'border-amber-300'}`}>
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{ready?'Ready to mobilise':`Not ready · ${gaps.length} blocker${gaps.length===1?'':'s'}`}</h2><span className="w-48"><Progress value={d.readiness.percent} label={`${d.readiness.mandatoryComplete} of ${d.readiness.mandatoryTotal} requirements`}/></span></div>
   {ready?<p className="mt-2 text-sm text-emerald-700">All mandatory readiness requirements are satisfied.</p>:<ul className="mt-3 grid gap-2">{(showAllBlockers?gaps:gaps.slice(0,5)).map((g,i)=>{const f=fixFor(g);return <li key={g.id||g.title+i} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2"><span className="min-w-0 flex-1 text-sm"><span className="font-medium">{g.title}</span><span className="block text-xs text-slate-600">{g.detail||categoryLabel(g.category)}</span></span><Btn variant="secondary" className="min-h-9 py-1" onClick={()=>goTarget(f.target)}>{f.action}<ArrowRight aria-hidden className="size-3.5"/></Btn></li>;})}{gaps.length>5&&<li><button className="text-sm underline" onClick={()=>setShowAllBlockers(x=>!x)}>{showAllBlockers?'Show fewer':`Show all ${gaps.length} blockers`}</button></li>}</ul>}
  </section>
  <Section title="Setup checklist" description={`${complete} of ${areas.length} setup areas complete. Each area opens where the work is done.`}>
   <ul className="grid gap-2 md:grid-cols-2">{areas.map(a=><li key={a.key}><button onClick={()=>goTarget(a.target)} className="flex w-full items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left hover:bg-slate-50"><span aria-hidden className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${a.status==='complete'?'bg-emerald-100 text-emerald-800':a.status==='attention'?'bg-amber-100 text-amber-900':'bg-slate-100 text-slate-600'}`}>{a.status==='complete'?'✓':a.total-a.done}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{a.label}</span><span className="block truncate text-xs text-slate-500">{a.status==='complete'?`${a.done} of ${a.total} complete`:a.gaps[0]}</span></span><Pill tone={AREA_TONE[a.status]}>{AREA_LABEL[a.status]}</Pill></button></li>)}</ul>
  </Section>
  <div id="setup-contract" className="scroll-mt-48"><Section title="Project details" description="Grouped around setup decisions instead of one long form." actions={editable&&<Btn busy={busy} onClick={()=>void run(()=>api('/api/projects/workspace',{method:'PATCH',body:{id:p.id,revision:p.revision,...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x===''?null:x]))}}),onChanged)}>Save</Btn>}>
   <div className="grid gap-5">{SETUP_GROUPS.map(g=><fieldset key={g.key} className="rounded-lg border bg-slate-50/50 p-3 sm:p-4"><legend className="px-1 text-sm font-semibold text-slate-800">{g.label}</legend><p className="mb-3 text-xs text-slate-500">{g.description}</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{SETUP_FIELDS.filter(([k])=>(g.fields as readonly string[]).includes(String(k))).map(([k,label,type])=>k==='clientName'?<div key={k}><ClientPicker value={(v.clientId as string|null)||null} disabled={!editable} legacyName={p.clientId?null:p.clientName} onChange={c=>setV(x=>({...x,clientId:c?.id??null,clientName:c?.name??x.clientName}))}/></div>:<Field key={k} label={label}>{type==='textarea'?<textarea className={`${field} min-h-20`} disabled={!editable} value={String(v[k]??'')} onChange={e=>setV({...v,[k]:e.target.value})}/>:<input className={field} type={type} disabled={!editable} value={String(v[k]??'')} onChange={e=>setV({...v,[k]:type==='number'&&e.target.value!==''?Number(e.target.value):e.target.value})}/>}</Field>)}{g.key==='project'&&<div><PersonPicker label="Project manager (member)" people={people} disabled={!editable} value={String(v.projectManagerUserId||'')} onChange={id=>setV(x=>({...x,projectManagerUserId:id||''}))}/></div>}{g.key==='contract'&&<label className="flex items-center gap-2 self-end text-sm font-medium text-slate-700"><input type="checkbox" className="size-5" disabled={!editable} checked={Boolean(v.retentionEnabled)} onChange={e=>setV({...v,retentionEnabled:e.target.checked})}/>Withhold retention on progress claims</label>}</div></fieldset>)}</div>
   <div className="mt-3"><ErrorState error={error}/></div>
  </Section></div>
  {can('knowledge.view')&&<KnowledgeCheckPanel title="Live setup checks" topics={['project','contract','construction','hseq','pavements','asphalt','concrete','earthworks','drainage','traffic','plant','workforce']} scope={{projectId:p.id}} context={{project:{id:p.id,stage:p.stage,...v}}}/>}
  <div id="setup-baseline" className="scroll-mt-48"><Section title="Approved baseline" description="The original baseline is immutable. Budget changes flow through approved variations." actions={!d.baselines.length&&can('project.baseline')&&p.stage!=='closed'&&<Btn onClick={()=>setBaselineOpen(true)}>Record baseline</Btn>}>
   {!d.baselines.length?<EmptyState title="No baseline has been recorded for this project." detail="Awarded projects inherit their baseline from the approved estimate revision. Manually created projects record one here."/>:d.baselines.map(b=><div key={b.id} className="grid gap-3"><p className="text-sm">Revision {b.revision} · {b.reason} · {dateText(b.createdAt)}{b.estimateRevisionId&&' · from the approved estimate revision'}</p>
    {b.budget&&<div className="grid gap-3 sm:grid-cols-4"><Stat label="Contract value" value={money(b.contractValue)}/>{Object.entries(b.budget).map(([k,x])=><Stat key={k} label={`${k.charAt(0).toUpperCase()+k.slice(1)} budget`} value={money(x)}/>)}</div>}
    <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-slate-500">Scope</p><p className="whitespace-pre-wrap">{b.scope||'—'}</p></div><div><p className="text-slate-500">Assumptions</p><p className="whitespace-pre-wrap">{b.assumptions||'—'}</p></div><div><p className="text-slate-500">Exclusions</p><p className="whitespace-pre-wrap">{b.exclusions||'—'}</p></div></div>
    {b.clarifications.length>0&&<div className="text-sm"><p className="text-slate-500">Tender clarifications carried into the baseline</p><ul>{b.clarifications.map(c=><li key={c.reference}>{c.reference}: {c.question} — {c.response||'no response recorded'}</li>)}</ul></div>}</div>)}
  </Section></div>
  <div id="setup-checklist" className="scroll-mt-48">
   {focus&&<p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">Showing <strong>{categoryLabel(focus)}</strong> readiness items.<button className="underline" onClick={()=>setFocus(null)}>Show all</button></p>}
   <RegisterView key={focus||'all'} register="readiness" parentId={p.id} onChanged={onChanged} hideCreate={p.stage==='closed'} filter={focus?r=>String(r.category).toLowerCase()===focus.toLowerCase():undefined} focus={focus?undefined:{label:'Open',test:r=>!['complete','not_applicable'].includes(String(r.status)),empty:'Every readiness checklist item is complete or not applicable.'}}/>
  </div>
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

function Delivery({projectId,area}:{projectId:string;area:'Prepare Work'|'Deliver Work'}){
 const {navigate}=useNav();const {can,module}=useSession();
 const {data,error,loading,refresh}=useApi<{shifts:Array<{id:string;name:string;status:string;metadata:Record<string,string>}>;dockets:Array<{id:string;name:string;status:string;work_date:string}>}>(`/api/job-hub?jobId=${projectId}`);
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
 const shifts=[...(data?.shifts||[])].sort((a,b)=>`${a.metadata.date}${a.metadata.start}`.localeCompare(`${b.metadata.date}${b.metadata.start}`));
 const upcoming=shifts.filter(s=>(s.metadata.date||'')>=today),past=shifts.filter(s=>(s.metadata.date||'')<today).reverse();
 const toReview=(data?.dockets||[]).filter(d=>['review','uploaded','matched','ready','draft'].includes(d.status));
 const shiftRow=(s:{id:string;name:string;status:string;metadata:Record<string,string>})=><li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{s.metadata.date===today?'Today':dateText(s.metadata.date)}</span> · {s.name}<span className="block text-xs text-slate-500">{[s.metadata.start&&`${s.metadata.start}–${s.metadata.finish}`,s.metadata.supervisor,Array.isArray(s.metadata.assignments)?`${(s.metadata.assignments as unknown[]).length} resources`:null].filter(Boolean).join(' · ')}</span></span><Pill tone={s.status==='Draft'?'neutral':'info'}>{s.status}</Pill></li>;
 return <div className="grid gap-4">
  <Section title="Scheduled work" description="Shifts for this project, soonest first." actions={can('schedule.view')&&<Btn variant="secondary" onClick={()=>navigate('Operations','Schedule',projectId)}><CalendarDays aria-hidden className="size-4"/>{can('schedule.edit')?'Plan shifts for this project':'Open schedule'}</Btn>}>
   <ErrorState error={error} onRetry={refresh}/>{loading&&!data?<Loading/>:!shifts.length?<EmptyState title="No work has been scheduled for this project." detail="Workers, plant and competency conflicts are shown as you allocate them."/>:<>
    {upcoming.length?<ul className="divide-y text-sm">{upcoming.map(shiftRow)}</ul>:<p className="text-sm text-slate-500">No upcoming shifts.</p>}
    {past.length>0&&<details className="mt-3"><summary className="cursor-pointer text-sm text-slate-600">Earlier shifts ({past.length})</summary><ul className="divide-y text-sm">{past.map(shiftRow)}</ul></details>}</>}
  </Section>
  <Section title="Dockets" description={toReview.length?`${toReview.length} waiting for review`:undefined} actions={can('docket.approve')&&<Btn variant="secondary" onClick={()=>navigate('Operations','Dockets')}>{toReview.length?'Review dockets':'Open dockets'}</Btn>}>
   {!data?.dockets.length?<EmptyState title="No dockets have been submitted for this project."/>:<ul className="divide-y text-sm">{[...toReview,...data.dockets.filter(d=>!toReview.includes(d))].map(d=><li key={d.id} className="flex items-center justify-between gap-2 py-2"><span>{d.name}<span className="block text-xs text-slate-500">{dateText(d.work_date)}</span></span><span className="flex items-center gap-2">{d.status==='approved'&&can('claim.edit')&&module('commercial')&&<Btn variant="secondary" className="min-h-9 py-1" onClick={()=>{presetClaimLine(projectId,'docket',d.id);navigate(area,'Projects',projectId,'commercial');}}>Add to claim</Btn>}<Pill tone={d.status==='approved'?'success':['included_claim','invoiced'].includes(d.status)?'info':'warning'}>{d.status==='included_claim'?'Claimed':humanStatus(d.status)}</Pill></span></li>)}</ul>}
  </Section>
 </div>;
}

function Quality({projectId,closed,onChanged}:{projectId:string;closed:boolean;onChanged:()=>void}){
 const [itp,setItp]=useState<{id:string;title:string}|null>(null);
 return <div className="grid gap-4">
  <RegisterView register="risks" parentId={projectId} hideCreate={closed} onChanged={onChanged} focus={{label:'Open',test:r=>String(r.status)==='open',empty:'No open risks. Closed and controlled risks are under All.'}}/>
  <SwmsPanel projectId={projectId} onChanged={onChanged}/>
  <RegisterView register="itps" parentId={projectId} hideCreate={closed} rowActions={r=><Btn variant="ghost" onClick={()=>setItp({id:r.id,title:String(r.title)})}>Inspection points<ArrowRight aria-hidden className="size-4"/></Btn>}/>
  <RegisterView register="incidents" parentId={projectId} hideCreate={closed} focus={{label:'Open',test:r=>String(r.status)!=='closed',empty:'No open incidents.'}}/>
  <RegisterView register="ncrs" parentId={projectId} hideCreate={closed} focus={{label:'Open',test:r=>String(r.status)!=='closed',empty:'No open non-conformances.'}}/>
  <RegisterView register="actions" parentId={projectId} hideCreate={closed} focus={{label:'Open',test:r=>!['closed','complete','verified'].includes(String(r.status)),empty:'No open corrective actions.'}}/>
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
