'use client';
import {ArrowRight,Calculator,CalendarCheck,CalendarDays,ChartColumn,ClipboardCheck,ClipboardList,DollarSign,FileDiff,FilePlus,FileText,Flag,FolderOpen,ListChecks,ShieldCheck,Siren,Target,UsersRound,Wrench} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {useNav} from './nav';
import type {TaskAction,ProjectTaskContext} from '@/lib/v1/task-actions';
import {taskRoute} from '@/lib/v1/task-actions';

const ICONS:Record<string,LucideIcon>={calculator:Calculator,'file-text':FileText,target:Target,clipboard:ClipboardList,'list-checks':ListChecks,calendar:CalendarDays,'calendar-check':CalendarCheck,users:UsersRound,'clipboard-check':ClipboardCheck,dollar:DollarSign,shield:ShieldCheck,folder:FolderOpen,chart:ChartColumn,wrench:Wrench,'file-diff':FileDiff,'file-plus':FilePlus,siren:Siren,flag:Flag};

/** One presentation for task entry points (Home, Project). Routes come from the task-action table; nothing is asked again. */
export function TaskLauncher({title,actions,context=null,label}:{title:string;actions:TaskAction[];context?:ProjectTaskContext|null;label:string}){
 const {navigate}=useNav();
 if(!actions.length)return null;
 return <section aria-label={label} className="surface overflow-hidden"><div className="border-b px-4 py-3"><h2 className="font-semibold">{title}</h2></div>
  <ul className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">{actions.map(a=>{const Icon=ICONS[a.icon]||ArrowRight;return <li key={a.key} className="bg-white"><button data-task={a.key} onClick={()=>{const r=taskRoute(a,context);navigate(r.area,r.sub,r.id,r.tab);}} className="group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700"><Icon aria-hidden className="size-4"/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{a.label}</span><span className="block truncate text-xs text-slate-500">{a.description}</span></span><ArrowRight aria-hidden className="size-4 shrink-0 text-slate-400 group-hover:text-slate-800"/></button></li>;})}</ul>
 </section>;
}
