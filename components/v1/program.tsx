'use client';
// Collaborative project programme. The activity model and dependency engine remain authoritative;
// this surface adds Board/List/Timeline/Lookahead/Calendar views, drag reorder, typed project-team
// owners and immutable activity comments without duplicating Schedule.
import {useState,type FormEvent} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,CalendarDays,Copy,GripVertical,MessageSquare,Plus,UserRound} from 'lucide-react';
import {api,useApi,useAction,useSession,PageHeader,Section,ErrorState,Btn,Pill,Field,field as fieldClass} from './kit';
import {useNav} from './nav';
import {addDays,moveActivity,moveActivityTo,responsibleToken,type Activity} from '@/lib/v1/program';

type Row=Activity&{revision:number;sequence:number|null;start:string;finish:string;delayDays:number;responsible:string;responsibleUserId:string|null;responsibleName:string;work_package:string;resource_requirement:string;planned_quantity:number;quantity_unit:string;production_per_day:number};
type Member={id:string;name:string;email:string;projectRole:string};
type Comment={id:string;activityId:string;text:string;actorUserId:string|null;actorName:string;createdAt:string};
type Feed={activities:Row[];members:Member[];comments:Comment[]};
type View='Board'|'List'|'Timeline'|'Lookahead'|'Calendar';

const STATUSES=['planned','ready','in_progress','on_hold','complete'] as const;
const BOARD:Array<{key:(typeof STATUSES)[number];label:string;description:string}>=[
 {key:'planned',label:'Planned',description:'Not ready to start yet'},
 {key:'ready',label:'Ready',description:'Can commence when scheduled'},
 {key:'in_progress',label:'In progress',description:'Currently underway'},
 {key:'on_hold',label:'Blocked',description:'Waiting on a constraint'},
 {key:'complete',label:'Complete',description:'Finished'},
];
const statusLabel=(s:string)=>s==='in_progress'?'In progress':s==='on_hold'?'Blocked':s==='ready'?'Ready':s.charAt(0).toUpperCase()+s.slice(1);
const todayText=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
const blank=(start:string)=>({name:'',startDate:start,durationDays:1,predecessorId:null as string|null,responsible:'',workPackage:'',resourceRequirement:'',plannedQuantity:0,quantityUnit:'',productionPerDay:0,status:'planned'});
const cell='min-h-9 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-50';
const dateLabel=(d:string,weekday=false)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-AU',{day:'numeric',month:'short',...(weekday?{weekday:'short'}:{}),timeZone:'UTC'});
const monday=(d:string)=>{const x=new Date(d+'T12:00:00Z'),n=(x.getUTCDay()+6)%7;return addDays(d,-n);};

export function Program(){
 const [projectId,setProjectId]=useState('');
 const list=useApi<{projects:{id:string;name:string}[]}>('/api/projects/program');
 return <div className="space-y-5"><PageHeader title="Planning & programme" subtitle="Collaborative activities, dependencies and lookahead. Operational shifts stay in Schedule."/><ErrorState error={list.error}/>
  <label className="block max-w-md text-sm"><span className="font-medium text-slate-700">Project</span><select className={fieldClass} value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Choose project</option>{list.data?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {projectId&&<ProgrammePanel key={projectId} projectId={projectId}/>}
 </div>;
}

export function ProgrammePanel({projectId}:{projectId:string}){
 const data=useApi<Feed>(`/api/projects/program?projectId=${encodeURIComponent(projectId)}`),action=useAction(),session=useSession(),{navigate}=useNav();
 const writable=session.writable('projects')&&session.can('programme.edit');
 const [view,setView]=useState<View>('Board'),[editing,setEditing]=useState<Row|null>(null),[dragging,setDragging]=useState<string|null>(null),[calendarStart,setCalendarStart]=useState(()=>monday(todayText()));
 const [pending,setPending]=useState<{src:unknown;ids:string[]}|null>(null);
 const server=data.data?.activities||[],members=data.data?.members||[],comments=data.data?.comments||[];
 const order=pending&&pending.src===data.data?pending.ids:null;
 const byId=new Map(server.map(a=>[a.id,a]));
 const all=order?order.map(id=>byId.get(id)).filter(Boolean) as Row[]:server;
 const today=todayText(),lookaheadEnd=addDays(today,13),lookahead=all.filter(a=>a.finish>=today&&a.start<=lookaheadEnd&&a.status!=='complete');
 const nextStart=all.length?addDays(all.reduce((m,a)=>a.finish>m?a.finish:m,all[0].finish),1):today;
 const done=()=>data.refresh();
 const quick=(a:Row,changes:Record<string,unknown>)=>void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'update',projectId,id:a.id,revision:a.revision,changes}}),done);
 const reorder=(ids:string[])=>{setPending({src:data.data,ids});void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'reorder',projectId,ids}}),done);};
 const move=(id:string,delta:number)=>reorder(moveActivity(all.map(a=>a.id),id,delta));
 const dropBefore=(targetId:string)=>{if(!dragging||dragging===targetId)return;reorder(moveActivityTo(all.map(a=>a.id),dragging,targetId));setDragging(null);};
 const duplicate=(a:Row)=>void action.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'duplicate',projectId,id:a.id}}),done);
 const commentsFor=(id:string)=>comments.filter(c=>c.activityId===id);
 return <div className="space-y-4">
  <ErrorState error={data.error||action.error} onRetry={data.error?data.refresh:undefined}/>
  <div className="flex flex-wrap items-center gap-2">
   <div role="group" aria-label="Programme view" className="flex flex-wrap gap-2">{(['Board','List','Timeline','Lookahead','Calendar'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)} className={`min-h-9 rounded-full border px-3 text-sm ${view===v?'border-[#172633] bg-[#172633] text-white':'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{v}</button>)}</div>
   {session.can('schedule.view')&&<Btn variant="secondary" className="ml-auto" onClick={()=>navigate('Operations','Schedule',projectId)}><CalendarDays aria-hidden className="size-4"/>{session.can('schedule.edit')?'Plan shifts':'View schedule'}</Btn>}
  </div>
  {writable&&<QuickAdd projectId={projectId} defaultStart={nextStart} members={members} onAdded={done}/>}
  {view==='Board'&&<BoardView rows={all} writable={writable} comments={comments} dragging={dragging} onDrag={setDragging} onStatus={(a,s)=>quick(a,{status:s})} onEdit={setEditing}/>}
  {view==='List'&&<ListView rows={all} members={members} writable={writable} comments={comments} dragging={dragging} onDrag={setDragging} onDrop={dropBefore} onMove={move} onDuplicate={duplicate} onQuick={quick} onEdit={setEditing}/>}
  {view==='Timeline'&&<TimelineView rows={all}/>}
  {view==='Lookahead'&&<LookaheadView rows={lookahead} comments={comments} onEdit={setEditing}/>}
  {view==='Calendar'&&<CalendarView rows={all} start={calendarStart} onStart={setCalendarStart} onEdit={setEditing}/>}
  {editing&&<DetailDrawer projectId={projectId} activity={editing} activities={server} members={members} comments={commentsFor(editing.id)} writable={writable} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);done();}} onCommented={done}/>}
 </div>;
}

function BoardView({rows,writable,comments,dragging,onDrag,onStatus,onEdit}:{rows:Row[];writable:boolean;comments:Comment[];dragging:string|null;onDrag:(id:string|null)=>void;onStatus:(a:Row,s:string)=>void;onEdit:(a:Row)=>void}){
 return <div className="grid gap-3 xl:grid-cols-5">{BOARD.map(col=><section key={col.key} onDragOver={e=>writable&&e.preventDefault()} onDrop={()=>{const a=rows.find(x=>x.id===dragging);if(a&&a.status!==col.key)onStatus(a,col.key);onDrag(null);}} className="min-w-0 rounded-xl border bg-slate-50 p-2">
  <div className="mb-2 px-1"><div className="flex items-center justify-between"><h3 className="font-semibold">{col.label}</h3><span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{rows.filter(a=>a.status===col.key).length}</span></div><p className="text-xs text-slate-500">{col.description}</p></div>
  <div className="grid gap-2">{rows.filter(a=>a.status===col.key).map(a=><article key={a.id} draggable={writable} onDragStart={()=>onDrag(a.id)} onDragEnd={()=>onDrag(null)} className={`rounded-lg border bg-white p-3 shadow-sm ${dragging===a.id?'opacity-50':''}`}>
   <button type="button" className="w-full text-left" onClick={()=>onEdit(a)}><p className="font-medium">{a.name}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(a.start,true)} → {dateLabel(a.finish)}</p>{a.work_package&&<p className="mt-1 truncate text-xs text-slate-600">{a.work_package}</p>}</button>
   <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><UserRound aria-hidden className="size-3.5"/><span className="min-w-0 flex-1 truncate">{a.responsibleName||'Unassigned'}</span>{comments.some(c=>c.activityId===a.id)&&<span className="inline-flex items-center gap-1"><MessageSquare aria-hidden className="size-3.5"/>{comments.filter(c=>c.activityId===a.id).length}</span>}</div>
   {a.delayDays>0&&<p className="mt-2 text-xs font-medium text-amber-800">{a.delayDays}d dependency delay</p>}
  </article>)}</div>
 </section>)}</div>;
}

function ListView({rows,members,writable,comments,dragging,onDrag,onDrop,onMove,onDuplicate,onQuick,onEdit}:{rows:Row[];members:Member[];writable:boolean;comments:Comment[];dragging:string|null;onDrag:(id:string|null)=>void;onDrop:(id:string)=>void;onMove:(id:string,d:number)=>void;onDuplicate:(a:Row)=>void;onQuick:(a:Row,c:Record<string,unknown>)=>void;onEdit:(a:Row)=>void}){
 const today=todayText();
 return <Section title="Programme list">{!rows.length?<p className="text-sm text-slate-500">No activities yet. Add the first activity above.</p>:<ol className="divide-y">{rows.map((a,i)=><li key={a.id} draggable={writable} onDragStart={()=>onDrag(a.id)} onDragEnd={()=>onDrag(null)} onDragOver={e=>writable&&e.preventDefault()} onDrop={()=>onDrop(a.id)} className={`grid gap-2 py-3 ${dragging===a.id?'opacity-50':''}`}>
  <div className="flex flex-wrap items-center gap-2">
   {writable&&<GripVertical aria-hidden className="size-4 cursor-grab text-slate-400"/>}<span className="w-7 text-sm tabular-nums text-slate-400">{String(i+1).padStart(2,'0')}</span>
   {writable?<input aria-label="Activity name" className={`${cell} min-w-40 flex-1 font-medium`} defaultValue={a.name} key={`n${a.revision}`} onBlur={e=>{const v=e.target.value.trim();if(v&&v!==a.name)onQuick(a,{name:v});}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}/>:<strong className="min-w-40 flex-1">{a.name}</strong>}
   {a.delayDays>0&&<Pill tone="warning">{a.delayDays}d late</Pill>}{a.status!=='complete'&&a.finish<today&&<Pill tone="danger">Overdue</Pill>}
   {writable&&<span className="flex gap-1"><Btn variant="ghost" className="min-h-9 px-2" disabled={i===0} aria-label={`Move ${a.name} up`} onClick={()=>onMove(a.id,-1)}><ArrowUp aria-hidden className="size-4"/></Btn><Btn variant="ghost" className="min-h-9 px-2" disabled={i===rows.length-1} aria-label={`Move ${a.name} down`} onClick={()=>onMove(a.id,1)}><ArrowDown aria-hidden className="size-4"/></Btn><Btn variant="ghost" className="min-h-9 px-2" aria-label={`Duplicate ${a.name}`} onClick={()=>onDuplicate(a)}><Copy aria-hidden className="size-4"/></Btn></span>}
  </div>
  <div className="flex flex-wrap items-center gap-2 pl-9 text-sm">
   {writable?<><label className="flex items-center gap-1"><span className="text-slate-500">Start</span><input type="date" className={cell} defaultValue={a.start_date} key={`s${a.revision}`} onChange={e=>{if(e.target.value&&e.target.value!==a.start_date)onQuick(a,{startDate:e.target.value});}}/></label><label className="flex items-center gap-1"><span className="text-slate-500">Days</span><input type="number" min={1} className={`${cell} w-20`} defaultValue={a.duration_days} key={`d${a.revision}`} onBlur={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n!==Number(a.duration_days))onQuick(a,{durationDays:n});}}/></label><select aria-label="Status" className={cell} value={a.status} onChange={e=>onQuick(a,{status:e.target.value})}>{STATUSES.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select><OwnerSelect activity={a} members={members} onChange={v=>onQuick(a,{responsible:v})}/></>:<span className="text-slate-600">{a.start} → {a.finish} · {a.duration_days}d · {statusLabel(a.status)} · {a.responsibleName||'Unassigned'}</span>}
   <span className="text-slate-500">Projected {a.start} → {a.finish}</span><Btn variant="ghost" className="min-h-9 px-2 text-sm" onClick={()=>onEdit(a)}>Details{comments.some(c=>c.activityId===a.id)?` (${comments.filter(c=>c.activityId===a.id).length})`:''}</Btn>
  </div>
 </li>)}</ol>}</Section>;
}

function TimelineView({rows}:{rows:Row[]}){
 if(!rows.length)return <Section title="Timeline"><p className="text-sm text-slate-500">No activities yet.</p></Section>;
 const first=rows.reduce((m,a)=>a.start<m?a.start:m,rows[0].start),last=rows.reduce((m,a)=>a.finish>m?a.finish:m,rows[0].finish);
 const span=Math.min(90,Math.max(14,Math.round((Date.parse(last)-Date.parse(first))/86400000)+1)),days=Array.from({length:span},(_,i)=>addDays(first,i));
 return <Section title="Timeline"><div className="overflow-x-auto"><div className="min-w-max"><div className="ml-56 grid" style={{gridTemplateColumns:`repeat(${days.length}, 34px)`}}>{days.map((d,i)=><span key={d} className={`border-b border-r py-1 text-center text-[10px] text-slate-500 ${i%7===0?'bg-slate-100':''}`}>{d.slice(8)}</span>)}</div>{rows.map(a=><div key={a.id} className="flex"><div className="w-56 shrink-0 truncate border-b py-2 pr-3 text-sm"><strong>{a.name}</strong><span className="block text-xs text-slate-500">{a.responsibleName||'Unassigned'}</span></div><div className="grid border-b" style={{gridTemplateColumns:`repeat(${days.length}, 34px)`}}>{days.map(d=><span key={d} title={d} className={`border-r ${d>=a.start&&d<=a.finish?'bg-orange-200':d===todayText()?'bg-sky-50':''}`}/>)}</div></div>)}</div></div></Section>;
}

function LookaheadView({rows,comments,onEdit}:{rows:Row[];comments:Comment[];onEdit:(a:Row)=>void}){
 return <Section title="Two-week lookahead">{!rows.length?<p className="text-sm text-slate-500">No incomplete activities in the next two weeks.</p>:<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{rows.map(a=><button key={a.id} type="button" className="rounded-lg border bg-white p-3 text-left hover:bg-slate-50" onClick={()=>onEdit(a)}><div className="flex items-start justify-between gap-2"><strong>{a.name}</strong><Pill>{statusLabel(a.status)}</Pill></div><p className="mt-1 text-sm text-slate-600">{dateLabel(a.start,true)} → {dateLabel(a.finish)}</p><p className="mt-1 text-xs text-slate-500">{a.responsibleName||'Unassigned'}{comments.some(c=>c.activityId===a.id)?` · ${comments.filter(c=>c.activityId===a.id).length} comment(s)`:''}</p>{a.resource_requirement&&<p className="mt-2 line-clamp-2 text-xs text-slate-600">{a.resource_requirement}</p>}</button>)}</div>}</Section>;
}

function CalendarView({rows,start,onStart,onEdit}:{rows:Row[];start:string;onStart:(s:string)=>void;onEdit:(a:Row)=>void}){
 const days=Array.from({length:28},(_,i)=>addDays(start,i));
 return <Section title="Four-week calendar"><div className="mb-3 flex flex-wrap items-center gap-2"><Btn variant="secondary" onClick={()=>onStart(addDays(start,-28))}><ArrowLeft aria-hidden className="size-4"/>Previous</Btn><Btn variant="secondary" onClick={()=>onStart(monday(todayText()))}>Today</Btn><Btn variant="secondary" onClick={()=>onStart(addDays(start,28))}>Next<ArrowRight aria-hidden className="size-4"/></Btn><span className="text-sm text-slate-500">{dateLabel(start)} → {dateLabel(addDays(start,27))}</span></div><div className="overflow-x-auto"><div className="grid min-w-[900px] grid-cols-7 gap-px rounded-lg border bg-slate-200">{days.map((d,i)=><div key={d} className={`min-h-28 bg-white p-2 ${d===todayText()?'ring-2 ring-inset ring-sky-300':''}`}><p className="text-xs font-medium text-slate-500">{i<7&&<span className="mr-1">{dateLabel(d,true).split(' ')[0]}</span>}{d.slice(8)}</p><div className="mt-1 grid gap-1">{rows.filter(a=>a.start===d).map(a=><button key={a.id} type="button" className="rounded bg-orange-50 px-1.5 py-1 text-left text-xs text-orange-950 hover:bg-orange-100" onClick={()=>onEdit(a)}><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-[10px]">{a.duration_days}d · {statusLabel(a.status)}</span></button>)}</div></div>)}</div></div></Section>;
}

function OwnerSelect({activity:a,members,onChange}:{activity:Row;members:Member[];onChange:(value:string)=>void}){
 return <label className="flex items-center gap-1"><span className="sr-only">Responsible person</span><select className={cell} value={a.responsibleUserId||''} onChange={e=>onChange(e.target.value?responsibleToken(e.target.value):'')}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>{!a.responsibleUserId&&a.responsible&&<span className="max-w-36 truncate text-xs text-amber-700" title={a.responsible}>Legacy: {a.responsible}</span>}</label>;
}

function QuickAdd({projectId,defaultStart,members,onAdded}:{projectId:string;defaultStart:string;members:Member[];onAdded:()=>void}){
 const [name,setName]=useState(''),[start,setStart]=useState(''),[days,setDays]=useState(1),[owner,setOwner]=useState('');const {busy,error,run}=useAction();
 const submit=(e:FormEvent)=>{e.preventDefault();if(!name.trim())return;void run(()=>api('/api/projects/program',{method:'POST',body:{...blank(start||defaultStart),name:name.trim(),durationDays:days,responsible:owner?responsibleToken(owner):'',projectId}}),()=>{setName('');setStart('');setDays(1);setOwner('');onAdded();});};
 return <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border bg-slate-50 p-3" aria-label="Add activity"><label className="grid min-w-48 flex-1 gap-1 text-sm"><span className="font-medium text-slate-700">New activity</span><input className={fieldClass} placeholder="e.g. Profiling" value={name} onChange={e=>setName(e.target.value)}/></label><label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">Start</span><input type="date" className={fieldClass} value={start||defaultStart} onChange={e=>setStart(e.target.value)}/></label><label className="grid w-24 gap-1 text-sm"><span className="font-medium text-slate-700">Days</span><input type="number" min={1} className={fieldClass} value={days} onChange={e=>setDays(Math.max(1,Number(e.target.value)||1))}/></label><label className="grid min-w-44 gap-1 text-sm"><span className="font-medium text-slate-700">Owner</span><select className={fieldClass} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><Btn type="submit" busy={busy} disabled={!name.trim()}><Plus aria-hidden className="size-4"/>Add</Btn>{error&&<p role="alert" className="w-full text-sm text-red-700">{error}</p>}</form>;
}

function DetailDrawer({projectId,activity:a,activities,members,comments,writable,onClose,onSaved,onCommented}:{projectId:string;activity:Row;activities:Row[];members:Member[];comments:Comment[];writable:boolean;onClose:()=>void;onSaved:()=>void;onCommented:()=>void}){
 const [form,setForm]=useState({name:a.name,startDate:a.start_date,durationDays:Number(a.duration_days),predecessorId:a.predecessor_id,responsible:a.responsibleUserId?responsibleToken(a.responsibleUserId):a.responsible||'',workPackage:a.work_package||'',resourceRequirement:a.resource_requirement||'',plannedQuantity:Number(a.planned_quantity||0),quantityUnit:a.quantity_unit||'',productionPerDay:Number(a.production_per_day||0),status:a.status}),[comment,setComment]=useState('');
 const save=useAction(),commentAction=useAction();const patch=(k:string,v:unknown)=>setForm(f=>({...f,[k]:v}));
 return <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/30" role="dialog" aria-modal="true" aria-label={`Activity details: ${a.name}`} onMouseDown={e=>{if(e.currentTarget===e.target)onClose();}}><div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Programme activity</p><h2 className="text-xl font-bold">{a.name}</h2><p className="text-sm text-slate-500">{a.start} → {a.finish}</p></div><Btn variant="secondary" onClick={onClose}>Close</Btn></div>
  <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();if(!writable)return;void save.run(()=>api('/api/projects/program',{method:'POST',body:{...form,projectId,id:a.id,revision:a.revision}}),onSaved);}}>
   <Field label="Name"><input className={fieldClass} disabled={!writable} value={form.name} onChange={e=>patch('name',e.target.value)}/></Field><Field label="Status"><select className={fieldClass} disabled={!writable} value={form.status} onChange={e=>patch('status',e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></Field>
   <Field label="Start"><input className={fieldClass} disabled={!writable} type="date" value={form.startDate} onChange={e=>patch('startDate',e.target.value)}/></Field><Field label="Duration (days)"><input className={fieldClass} disabled={!writable} type="number" min={1} value={form.durationDays} onChange={e=>patch('durationDays',Number(e.target.value))}/></Field>
   <Field label="Responsible person"><select className={fieldClass} disabled={!writable} value={String(form.responsible).startsWith('user:')?String(form.responsible).slice(5):''} onChange={e=>patch('responsible',e.target.value?responsibleToken(e.target.value):'')}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>{!a.responsibleUserId&&a.responsible&&<p className="mt-1 text-xs text-amber-700">Legacy responsible: {a.responsible}</p>}</Field>
   <Field label="Starts after (predecessor)"><select className={fieldClass} disabled={!writable} value={form.predecessorId||''} onChange={e=>patch('predecessorId',e.target.value||null)}><option value="">None</option>{activities.filter(x=>x.id!==a.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
   {([['workPackage','Work package','text'],['resourceRequirement','Crew / plant / subcontractor requirements','text'],['plannedQuantity','Planned quantity','number'],['quantityUnit','Quantity unit','text'],['productionPerDay','Production per day','number']] as const).map(([k,label,type])=><Field key={k} label={label}><input className={fieldClass} disabled={!writable} type={type} min={0} step={type==='number'?'any':undefined} value={form[k]} onChange={e=>patch(k,type==='number'?Number(e.target.value):e.target.value)}/></Field>)}
   {form.productionPerDay>0&&<p className="text-sm text-slate-600 sm:col-span-2">Production assumption: {Math.ceil(form.plannedQuantity/form.productionPerDay)} working days. Confirm the calendar allowance in Duration.</p>}
   {save.error&&<p role="alert" className="text-sm text-red-700 sm:col-span-2">{save.error}</p>}{writable&&<div className="sm:col-span-2"><Btn type="submit" busy={save.busy}>Save details</Btn></div>}
  </form>
  <section className="mt-6 border-t pt-4"><div className="mb-2 flex items-center gap-2"><MessageSquare aria-hidden className="size-4 text-slate-500"/><h3 className="font-semibold">Comments</h3><span className="text-xs text-slate-500">{comments.length}</span></div>{writable&&<form className="mb-3 flex gap-2" onSubmit={e=>{e.preventDefault();if(!comment.trim())return;void commentAction.run(()=>api('/api/projects/program',{method:'PATCH',body:{action:'comment',projectId,id:a.id,text:comment.trim()}}),()=>{setComment('');onCommented();});}}><input className={fieldClass} placeholder="Add a project update…" value={comment} onChange={e=>setComment(e.target.value)}/><Btn type="submit" busy={commentAction.busy} disabled={!comment.trim()}>Comment</Btn></form>}{commentAction.error&&<p className="mb-2 text-sm text-red-700">{commentAction.error}</p>}{comments.length?<ul className="divide-y">{comments.map(c=><li key={c.id} className="py-2 text-sm"><p>{c.text}</p><p className="mt-1 text-xs text-slate-500">{c.actorName} · {new Date(c.createdAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})}</p></li>)}</ul>:<p className="text-sm text-slate-500">No comments yet.</p>}</section>
 </div></div>;
}
