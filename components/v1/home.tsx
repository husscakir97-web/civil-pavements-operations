'use client';
import {ArrowRight,CalendarDays,CheckCheck,ClipboardList,Siren} from 'lucide-react';
import {useApi,useSession,ErrorState,Loading,PageHeader,Btn} from './kit';
import {useNav,areaTarget} from './nav';
import type {HomeItem} from '@/lib/seams/home';

type Feed={date:string;myActions:HomeItem[];needsAttention:HomeItem[];today:HomeItem[]};
const sev={danger:'border-l-red-500',warning:'border-l-amber-500',info:'border-l-sky-500'};

function List({title,icon,items,empty}:{title:string;icon:React.ReactNode;items:HomeItem[];empty:string}){
 const {navigate}=useNav();
 return <section className="surface overflow-hidden"><div className="flex items-center gap-2 border-b px-4 py-3">{icon}<h2 className="font-semibold">{title}</h2><span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{items.length}</span></div>
  {items.length?<ul className="divide-y">{items.map(i=><li key={i.key}><button onClick={()=>{const [a,s,id]=areaTarget(i.area,i.target);navigate(a,s,id);}} className={`group flex w-full items-center gap-3 border-l-4 px-4 py-3 text-left hover:bg-slate-50 ${sev[i.severity]}`}><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{i.title}</span><span className="mt-0.5 block text-xs text-slate-500">{i.detail}</span></span><ArrowRight aria-hidden className="size-4 shrink-0 text-slate-400 group-hover:text-slate-800"/></button></li>)}</ul>
  :<div className="flex items-start gap-3 p-4"><CheckCheck aria-hidden className="mt-0.5 size-5 text-emerald-600"/><p className="text-sm text-slate-600">{empty}</p></div>}
 </section>;
}

export function HomeV1(){
 const {data,error,loading,refresh}=useApi<Feed>('/api/platform/home');
 const {brand,userName,can}=useSession();const {navigate}=useNav();
 return <div>
  <PageHeader title={`Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}${userName?`, ${userName.split(' ')[0]}`:''}`} subtitle={`${new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full'}).format(new Date())} · ${brand.companyName}`}
   actions={<>{can('schedule.view')&&<Btn variant="secondary" onClick={()=>navigate('Operations','Schedule')}><CalendarDays aria-hidden className="size-4"/>Schedule</Btn>}{can('pipeline.edit')&&<Btn onClick={()=>navigate('Pipeline','Tenders')}>Tenders</Btn>}</>}/>
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading label="Loading your actions…"/>:data&&<div className="grid items-start gap-5 lg:grid-cols-3">
   <List title="My actions" icon={<ClipboardList aria-hidden className="size-4 text-orange-600"/>} items={data.myActions} empty="Nothing is waiting on you right now."/>
   <List title="Needs attention" icon={<Siren aria-hidden className="size-4 text-red-600"/>} items={data.needsAttention} empty="No overdue or at-risk items across your workspaces."/>
   <List title="Today" icon={<CalendarDays aria-hidden className="size-4 text-sky-600"/>} items={data.today} empty="No work is scheduled for today."/>
  </div>}
 </div>;
}
