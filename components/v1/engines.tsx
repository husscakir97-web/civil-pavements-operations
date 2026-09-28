'use client';

import {ArrowRight,BarChart3,BriefcaseBusiness,ClipboardCheck,DollarSign,RefreshCw,Truck,UsersRound} from 'lucide-react';
import {useNav} from './nav';
import {Btn,EmptyState,ErrorState,Loading,NextAction,PageHeader,Pill,Section,Stat,money,pct,useApi,useSession} from './kit';
import {ENGINE_ROUTE_OUTPUTS,engineMeta,type EngineKey} from '@/lib/v1/engines';
import {workspacesFor,enginesFor,engineLabelFor} from '@/lib/v1/workspaces';

type Reports={
 generatedAt:string;
 commercialVisible:boolean;
 pipeline?:{opportunities:Array<{stage:string;count:number;value?:number;weighted?:number}>;tenders:Array<{stage:string;count:number;value?:number}>;conversionPct:number|null;decided:number};
 projects?:{byStage:Record<string,number>;active:number;total:number};
 commercial?:{projects:Array<Record<string,unknown>>;totals:Record<string,number|null>;variations:Array<{status:string;count:number;value:number}>;claims:Array<{status:string;count:number;value:number}>};
 learn?:Array<{id:string;name:string;estimatedCost:number|null;actualCost:number;forecastFinalCost:number;tenderMarginPct:number|null;forecastMarginPct:number|null;estimatedLabourHours:number|null;actualLabourHours:number|null}>;
 operations?:{upcomingShifts14d:number;completedShifts30d:number;plannedHoursByCategory:Record<string,number>;fieldRecords30d:number;tonnesRecorded30d:number};
 dockets?:Record<string,{count:number;value?:number}>;
 hseq?:{openActions:number;overdueActions:number;incidents:Array<{type:string;status:string;count:number}>;ncrs:Record<string,number>;swms:Record<string,number>;itpItems:Record<string,number>};
};

const ICONS:Record<EngineKey,typeof BriefcaseBusiness>={
 'Win Work':BriefcaseBusiness,
 'Prepare Work':ClipboardCheck,
 'Resource Work':UsersRound,
 'Deliver Work':Truck,
 'Control Money':DollarSign,
 'Learn':BarChart3,
};

const countStage=(rows:Array<{stage:string;count:number}>|undefined,stages:string[])=>(rows||[]).filter(x=>stages.includes(x.stage)).reduce((n,x)=>n+Number(x.count||0),0);
const sumValues=(rows:Array<{value?:number}>|undefined)=>(rows||[]).reduce((n,x)=>n+Number(x.value||0),0);
const sumRecord=(r:Record<string,number>|undefined)=>Object.values(r||{}).reduce((n,v)=>n+Number(v||0),0);

function engineMetrics(engine:EngineKey,d:Reports):Array<{label:string;value:string|number;hint?:string}>{
 if(engine==='Win Work'){
  return [
   {label:'Active opportunities',value:countStage(d.pipeline?.opportunities,['lead','qualified','bidding'])},
   {label:'Active tenders',value:countStage(d.pipeline?.tenders,['draft','bid_review','estimating','returnables','internal_approval','approved','submitted','clarification'])},
   {label:'Tender conversion',value:pct(d.pipeline?.conversionPct),hint:String(d.pipeline?.decided||0)+' decided'},
   {label:'Opportunity value',value:d.commercialVisible?money(sumValues(d.pipeline?.opportunities)):'Restricted',hint:d.commercialVisible?'Recorded pipeline value':undefined},
  ];
 }
 if(engine==='Prepare Work')return [
  {label:'Projects in setup',value:Number(d.projects?.byStage?.setup||0)},
  {label:'Ready to mobilise',value:Number(d.projects?.byStage?.ready||0)},
  {label:'Open HSEQ actions',value:d.hseq?.openActions||0,hint:d.hseq?.overdueActions?String(d.hseq.overdueActions)+' overdue':undefined},
  {label:'SWMS in review',value:Number(d.hseq?.swms?.review||0)},
 ];
 if(engine==='Resource Work')return [
  {label:'Shifts next 14 days',value:d.operations?.upcomingShifts14d||0},
  {label:'Planned resource hours',value:Math.round(sumRecord(d.operations?.plannedHoursByCategory))},
  {label:'Completed shifts · 30d',value:d.operations?.completedShifts30d||0},
  {label:'Active projects',value:d.projects?.active||0},
 ];
 if(engine==='Deliver Work')return [
  {label:'Completed shifts · 30d',value:d.operations?.completedShifts30d||0},
  {label:'Field records · 30d',value:d.operations?.fieldRecords30d||0},
  {label:'Dockets pending review',value:d.dockets?.pendingReview?.count||0},
  {label:'Open HSEQ actions',value:d.hseq?.openActions||0,hint:d.hseq?.overdueActions?String(d.hseq.overdueActions)+' overdue':undefined},
 ];
 if(engine==='Control Money')return [
  {label:'Current contract',value:money(d.commercial?.totals?.currentContract)},
  {label:'Actual cost',value:money(d.commercial?.totals?.actual)},
  {label:'Unbilled work',value:money(d.commercial?.totals?.unbilled)},
  {label:'Forecast margin',value:pct(d.commercial?.totals?.forecastMarginPct),hint:money(d.commercial?.totals?.forecastProfit)},
 ];
 const rows=d.learn||[];
 const estimated=rows.reduce((n,x)=>n+Number(x.estimatedCost||0),0);
 const actual=rows.reduce((n,x)=>n+Number(x.actualCost||0),0);
 const labourEst=rows.reduce((n,x)=>n+Number(x.estimatedLabourHours||0),0);
 const labourAct=rows.reduce((n,x)=>n+Number(x.actualLabourHours||0),0);
 return [
  {label:'Projects with baseline',value:rows.length},
  {label:'Estimated cost',value:money(estimated)},
  {label:'Actual cost to date',value:money(actual),hint:estimated?pct(((actual-estimated)/estimated)*100)+' vs estimate':undefined},
  {label:'Labour hours · est / act',value:String(Math.round(labourEst))+' / '+String(Math.round(labourAct))},
 ];
}

function actionFor(engine:EngineKey,d:Reports):{text:string;sub:string;label:string}{
 if(engine==='Win Work'){
  const leads=countStage(d.pipeline?.opportunities,['lead']);
  if(leads)return {text:String(leads)+' lead'+(leads===1?'':'s')+' waiting to be qualified.',sub:'Opportunities',label:'Review opportunities'};
  return {text:'Review the active tender pipeline and move the next bid forward.',sub:'Tenders',label:'Open tenders'};
 }
 if(engine==='Prepare Work'){
  const setup=Number(d.projects?.byStage?.setup||0);
  if(setup)return {text:String(setup)+' project'+(setup===1?'':'s')+' still in setup. Resolve readiness blockers before mobilisation.',sub:'Projects',label:'Open projects'};
  if(d.hseq?.openActions)return {text:String(d.hseq.openActions)+' HSEQ action'+(d.hseq.openActions===1?'':'s')+' remain open.',sub:'IMS & HSEQ',label:'Open IMS & HSEQ'};
  return {text:'Review project readiness before the next mobilisation.',sub:'Projects',label:'Review readiness'};
 }
 if(engine==='Resource Work'){
  const n=d.operations?.upcomingShifts14d||0;
  return {text:n?String(n)+' shift'+(n===1?'':'s')+' are planned in the next 14 days. Check capacity and conflicts.':'No upcoming shifts are recorded. Plan the next work before crews and plant are committed.',sub:'Schedule',label:'Open schedule'};
 }
 if(engine==='Deliver Work'){
  const pending=d.dockets?.pendingReview?.count||0;
  if(pending)return {text:String(pending)+' docket'+(pending===1?'':'s')+' need review before the work becomes controlled actual cost.',sub:'Dockets',label:'Review dockets'};
  return {text:'Open active projects and keep today’s delivery, evidence and exceptions attached to the job.',sub:'Projects',label:'Open delivery'};
 }
 if(engine==='Control Money'){
  const unbilled=Number(d.commercial?.totals?.unbilled||0);
  return {text:unbilled?money(unbilled)+' of delivered work is currently unbilled.':'Review project commercial positions, variations and upcoming claims.',sub:'Commercial',label:'Open commercial'};
 }
 return {text:(d.learn||[]).length?'Review estimate-versus-actual performance and feed the variance back into future assumptions.':'Awarded projects with estimate baselines will populate the Learn engine automatically.',sub:'Reports',label:'Open performance'};
}

export function EngineOverview({engine}:{engine:EngineKey}){
 const meta=engineMeta(engine);
 const Icon=ICONS[engine];
 const {navigate}=useNav();
 const session=useSession();
 const {data,error,loading,refresh}=useApi<Reports>('/api/platform/overview');
 const visible=workspacesFor(engine,session);
 const out=ENGINE_ROUTE_OUTPUTS[engine];
 const suggested=data?actionFor(engine,data):null;
 const action=suggested&&visible.some(w=>w.sub===suggested.sub)?suggested:visible[0]?{text:visible[0].description,sub:visible[0].sub,label:`Open ${visible[0].label}`}:null;
 const engines=enginesFor(session);
 const metricSources:Record<EngineKey,Array<keyof Reports>>={
  'Win Work':['pipeline','pipeline','pipeline','pipeline'],
  'Prepare Work':['projects','projects','hseq','hseq'],
  'Resource Work':['operations','operations','operations','projects'],
  'Deliver Work':['operations','operations','dockets','hseq'],
  'Control Money':['commercial','commercial','commercial','commercial'],
  'Learn':['learn','learn','learn','learn'],
 };
 const handoff=engines.some(e=>e.key===out.target[0])&&(!out.target[1]||out.target[1]==='Overview'||workspacesFor(out.target[0] as EngineKey,session).some(w=>w.sub===out.target[1]));
 return <div className="grid gap-5">
  <PageHeader title={engineLabelFor(engine,session)} subtitle={meta.purpose} badges={<Pill>Engine {meta.number} of 6</Pill>} actions={<Btn variant="secondary" onClick={refresh}><RefreshCw aria-hidden className="size-4"/>Refresh</Btn>}/>
  <section aria-label="Operating engine flow" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-6 sm:overflow-visible sm:px-0">{engines.map(e=>{const EIcon=ICONS[e.key];const active=e.key===engine;return <button key={e.key} onClick={()=>navigate(e.key,'Overview')} aria-current={active?'step':undefined} className={'min-w-[132px] snap-start rounded-2xl border p-3 text-left transition-colors sm:min-w-0 '+(active?'border-orange-300 bg-orange-50 shadow-sm':'bg-white hover:bg-slate-50')}><span className={'flex size-8 items-center justify-center rounded-xl '+(active?'bg-primary text-white':'bg-slate-100 text-slate-500')}><EIcon aria-hidden className="size-4"/></span><span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Engine {e.number}</span><span className="block text-sm font-semibold text-slate-900">{engineLabelFor(e.key,session)}</span></button>;})}</section>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:data&&<>
   {action&&<NextAction text={action.text} actionLabel={action.label} onClick={()=>navigate(engine,action.sub)}/>}
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{engineMetrics(engine,data).filter((_,i)=>data[metricSources[engine][i]]!==undefined).map(m=><Stat key={m.label} label={m.label} value={m.value} hint={m.hint}/>)}</div>
   <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <Section title="Workspaces" description={meta.question}>{visible.length?<div className="grid gap-3 sm:grid-cols-2">{visible.map(w=><button key={w.sub} onClick={()=>navigate(engine,w.sub)} className="group rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-orange-200 hover:bg-orange-50/30"><span className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-950">{w.label}</span><ArrowRight aria-hidden className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-600"/></span><span className="mt-1.5 block text-xs leading-5 text-slate-500">{w.description}</span></button>)}</div>:<EmptyState title="No workspaces in this engine are enabled for your role."/>}</Section>
    <Section title="Engine hand-off" description="Every engine leaves controlled information for the next one."><div className="rounded-2xl bg-slate-950 p-4 text-white"><span className="flex size-10 items-center justify-center rounded-xl bg-primary"><Icon aria-hidden className="size-5"/></span><p className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Output</p><p className="mt-1 font-semibold">{meta.output}</p>{handoff&&<button className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-sm font-medium hover:bg-white/15" onClick={()=>navigate(out.target[0],out.target[1])}><span>{out.label}</span><ArrowRight aria-hidden className="size-4 shrink-0"/></button>}</div></Section>
   </div>
  </>}
 </div>;
}
