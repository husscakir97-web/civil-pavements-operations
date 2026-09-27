'use client';
import {ArrowRight,CalendarDays,CheckCheck,ClipboardList,Siren,BarChart3} from 'lucide-react';
import {useApi,useSession,ErrorState,Loading,Btn,money,pct,StatusBadge} from './kit';
import {useNav,areaTarget} from './nav';
import type {HomeItem} from '@/lib/seams/home';

// Home answers "what needs me?": my work first, then today, then exceptions, and only
// then portfolio figures. Everything comes from the role-aware home feed.
type Feed={date:string;myActions:HomeItem[];needsAttention:HomeItem[];today:HomeItem[]};
type PortfolioRow={id:string;name:string;projectNumber:string|null;stage:string;currentContract:number|null;forecastMarginPct:number|null;unbilled:number|null;retentionHeld:number};
const sev={danger:'border-l-red-500',warning:'border-l-amber-500',info:'border-l-sky-500'};

function List({title,icon,items,empty,columns}:{title:string;icon:React.ReactNode;items:HomeItem[];empty:string;columns?:boolean}){
 const {navigate}=useNav();
 return <section className="surface overflow-hidden" aria-label={title}><div className="flex items-center gap-2 border-b px-4 py-3">{icon}<h2 className="font-semibold">{title}</h2><span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{items.length}</span></div>
  {items.length?<ul className={`divide-y ${columns?'lg:grid lg:grid-cols-2 lg:divide-y-0':''}`}>{items.map(i=><li key={i.key} className={columns?'lg:border-b':''}><button onClick={()=>{const [a,s,id]=areaTarget(i.area,i.target);navigate(a,s,id);}} className={`group flex w-full items-center gap-3 border-l-4 px-4 py-3 text-left hover:bg-slate-50 ${sev[i.severity]}`}><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{i.title}</span><span className="mt-0.5 block text-xs text-slate-500">{i.detail}</span></span><ArrowRight aria-hidden className="size-4 shrink-0 text-slate-400 group-hover:text-slate-800"/></button></li>)}</ul>
  :<div className="flex items-start gap-3 p-4"><CheckCheck aria-hidden className="mt-0.5 size-5 text-emerald-600"/><p className="text-sm text-slate-600">{empty}</p></div>}
 </section>;
}

/** Live projects with their existing per-project figures: no new arithmetic on Home. */
function Portfolio(){
 const {data,error}=useApi<{projects:PortfolioRow[]}>('/api/commercial/portfolio');
 const {navigate}=useNav();
 const live=(data?.projects||[]).filter(p=>!['closed'].includes(p.stage)).slice(0,6);
 if(error||!data||!live.length)return null;
 return <section className="surface overflow-hidden" aria-label="Portfolio"><div className="flex items-center gap-2 border-b px-4 py-3"><BarChart3 aria-hidden className="size-4 text-slate-500"/><h2 className="font-semibold">Portfolio</h2><Btn variant="ghost" className="ml-auto min-h-8 py-1 text-xs" onClick={()=>navigate('Commercial')}>All projects<ArrowRight aria-hidden className="size-3.5"/></Btn></div>
  <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="px-4 py-2 font-medium">Project</th><th className="font-medium">Stage</th><th className="font-medium">Current contract</th><th className="font-medium">Forecast margin</th><th className="font-medium">Unbilled</th><th className="pr-4 font-medium">Retention held</th></tr></thead>
   <tbody className="divide-y">{live.map(p=><tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={()=>navigate('Projects',undefined,p.id)}><td className="px-4 py-2"><span className="font-medium">{p.name}</span>{p.projectNumber&&<span className="ml-2 text-xs text-slate-500">{p.projectNumber}</span>}</td><td><StatusBadge machine="project" state={p.stage}/></td><td>{money(p.currentContract)}</td><td className={p.forecastMarginPct!=null&&p.forecastMarginPct<0?'text-red-700':''}>{pct(p.forecastMarginPct)}</td><td>{money(p.unbilled)}</td><td className="pr-4">{money(p.retentionHeld)}</td></tr>)}</tbody></table></div>
 </section>;
}

export function HomeV1(){
 const {data,error,loading,refresh}=useApi<Feed>('/api/platform/home');
 const {brand,userName,can,module}=useSession();const {navigate}=useNav();
 const hour=new Date().getHours();
 return <div className="grid gap-5">
  <header className="flex flex-wrap items-end justify-between gap-3">
   <div><p className="text-sm text-slate-500">{new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full'}).format(new Date())} · {brand.companyName}</p><h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Good {hour<12?'morning':hour<17?'afternoon':'evening'}{userName?`, ${userName.split(' ')[0]}`:''}</h1></div>
   <div className="flex flex-wrap gap-2">{can('schedule.view')&&module('operations')&&<Btn variant="secondary" onClick={()=>navigate('Operations','Schedule')}><CalendarDays aria-hidden className="size-4"/>Today&apos;s schedule</Btn>}{can('pipeline.edit')&&module('pipeline')&&<Btn variant="secondary" onClick={()=>navigate('Pipeline','Tenders')}>Tenders</Btn>}</div>
  </header>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading label="Loading your work…"/>:data&&<>
   <div className="grid items-start gap-5 lg:grid-cols-3">
    <div className="lg:col-span-2"><List title="My work" icon={<ClipboardList aria-hidden className="size-4 text-orange-600"/>} items={data.myActions} empty="Nothing is waiting on you right now."/></div>
    <List title="Today" icon={<CalendarDays aria-hidden className="size-4 text-sky-600"/>} items={data.today} empty="No work is scheduled for today."/>
   </div>
   <List title="Needs attention" columns icon={<Siren aria-hidden className="size-4 text-red-600"/>} items={data.needsAttention} empty="No overdue or at-risk items across your workspaces."/>
   {can('commercial.view')&&module('commercial')&&<Portfolio/>}
  </>}
 </div>;
}
