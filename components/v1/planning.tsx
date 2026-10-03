'use client';
// Planning v0.1 (docs/PLANNING-V0-1-DECISION.md): an undated methodology canvas with live costing, saved scenarios and a
// relative timeline. One calculation (lib/v1/planning.ts) drives the preview here and the authoritative server result.
import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Download,GitBranch,Link2,Milestone,Plus,Trash2,X} from 'lucide-react';
import {api,useApi,useAction,useSession,PageHeader,Section,ErrorState,EmptyState,Btn,Pill,Stat,Tabs,Field,field as fieldClass,money} from './kit';
import {FIELDS,KNOWN_UNITS,blankActivity,calculatePlan,findCycle,fits,newId,validatePlan,type FieldSpec,type PlanActivity,type PlanDocument,type PlanResult,type Positions,type Requirement} from '@/lib/v1/planning';

type PlanSummary={id:string;name:string;ownerUserId:string;accessScope:'organisation'|'owner';status:string;revision:number;updatedAt:string;scenarios:{id:string;name:string;revision:number}[]};
type List={plans:PlanSummary[];ratesVisible:boolean;canEdit:boolean};
type Choice={type:'worker'|'plant';id:string;label:string;detail:string;archived?:boolean};
type Loaded={plan:PlanSummary;scenario:{id:string;name:string;revision:number;status:string};positions:Positions;document:PlanDocument;result:PlanResult;ratesVisible:boolean;canEdit:boolean;resourcesAvailable:boolean;resources:Record<string,Choice>};
type View='Flowchart'|'Timeline'|'Costs';
const NODE_W=210,NODE_H=96;

const cost=(v:number|null|undefined,visible:boolean)=>!visible?'Restricted':v===null||v===undefined?'Unknown':money(v,true);
/** An activity with no resources or setup costs entered has no cost yet: say so rather than showing $0.00. */
const costLabel=(a:PlanActivity,total:number|null|undefined,visible:boolean)=>visible&&!a.requirements.length&&!a.costItems.length?'No costs entered':cost(total,visible);
const dayText=(v:number|null|undefined)=>v===null||v===undefined?'Unknown':`${v} d`;

/** Numeric input that keeps what the user typed: empty is UNKNOWN (null), never zero. */
function NumInput({value,onChange,label,disabled,spec}:{value:number|null;onChange:(v:number|null)=>void;label:string;disabled?:boolean;spec:FieldSpec}){
 const [text,setText]=useState(value===null?'':String(value));
 // Adopt an external change (reload, discard) without disturbing what the user is typing.
 const [seen,setSeen]=useState(value);
 if(seen!==value){setSeen(value);if(!((text.trim()===''&&value===null)||Number(text)===value))setText(value===null?'':String(value));}
 const typed=text.trim()===''?null:Number(text);
 // A value the database cannot store exactly is rejected (and previewed as unknown) rather than silently rounded on save.
 const problem=typed===null?'':!Number.isFinite(typed)||typed<0?'Enter a number of zero or more.':fits(typed,spec)?'':spec.positive&&typed===0?'Must be above zero.':`Use at most ${spec.scale} decimal places (up to ${spec.max.toLocaleString('en-AU')}).`;
 return <><input aria-label={label} aria-invalid={Boolean(problem)} inputMode="decimal" disabled={disabled} className={`${fieldClass} ${problem?'border-red-400':''}`} placeholder="Unknown" value={text}
  onChange={e=>{const t=e.target.value;setText(t);if(t.trim()==='')onChange(null);else if(Number.isFinite(Number(t))&&Number(t)>=0)onChange(Number(t));}}/>{problem&&<span data-testid="num-problem" className="text-xs text-red-700">{problem}</span>}</>;
}

export function Planning(){
 const list=useApi<List>('/api/planning');
 const [open,setOpen]=useState<string|null>(null);
 const [name,setName]=useState(''),[scope,setScope]=useState<'organisation'|'owner'>('organisation');
 const action=useAction();
 const create=()=>action.run(()=>api<Loaded>('/api/planning',{method:'POST',body:{action:'create-plan',name,accessScope:scope}}),r=>{setName('');list.refresh();setOpen(r.scenario.id);});
 if(open)return <Editor key={open} scenarioId={open} onBack={()=>{setOpen(null);list.refresh();}}/>;
 const canEdit=list.data?.canEdit;
 return <div className="space-y-5"><PageHeader title="Planning" subtitle="Methodology plans with live costing and scenarios. Undated: durations are relative and no resource availability is implied."/>
  <ErrorState error={list.error}/>
  {canEdit&&<Section title="New plan" description="Works on its own: no project or Commercial module is needed.">
   <form className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" onSubmit={e=>{e.preventDefault();if(name.trim())void create();}}>
    <Field label="Plan name"><input className={fieldClass} value={name} maxLength={180} onChange={e=>setName(e.target.value)} placeholder="e.g. Main Street resurfacing methodology"/></Field>
    <Field label="Who can open it"><select className={fieldClass} value={scope} onChange={e=>setScope(e.target.value as 'organisation'|'owner')}><option value="organisation">Everyone in the organisation</option><option value="owner">Only me and administrators</option></select></Field>
    <Btn type="submit" busy={action.busy} disabled={!name.trim()}><Plus aria-hidden className="size-4"/>Create plan</Btn>
   </form>{action.error&&<p role="alert" className="mt-2 text-sm text-red-700">{action.error}</p>}
  </Section>}
  <Section title="Plans">{list.data&&!list.data.plans.length?<EmptyState title="No plans yet" detail="Create a plan to start sketching a methodology."/>:<ul className="divide-y">{list.data?.plans.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.scenarios.length} scenario{p.scenarios.length===1?'':'s'} · {p.accessScope==='owner'?'Private to owner':'Organisation'}</p></div><Btn variant="secondary" onClick={()=>setOpen(p.scenarios[0].id)}>Open</Btn></li>)}</ul>}</Section>
 </div>;
}

function Editor({scenarioId,onBack}:{scenarioId:string;onBack:()=>void}){
 const session=useSession();void session;
 const [current,setCurrent]=useState(scenarioId);
 const loaded=useApi<Loaded>(`/api/planning?scenarioId=${current}`);
 const data=loaded.data;
 const [doc,setDoc]=useState<PlanDocument|null>(null),[positions,setPositions]=useState<Positions>({});
 const [dirtyDoc,setDirtyDoc]=useState(false),[dirtyPos,setDirtyPos]=useState(false);
 // Labels of assets picked in this session, so a just-linked (not yet saved) worker or plant item is named, not anonymous.
 const [picked,setPicked]=useState<Record<string,Choice>>({});
 const [view,setView]=useState<View>('Flowchart'),[drawer,setDrawer]=useState<string|null>(null),[linkFrom,setLinkFrom]=useState<string|null>(null);
 const [note,setNote]=useState(''),[stale,setStale]=useState(false),[newName,setNewName]=useState('');
 const save=useAction();
 const [synced,setSynced]=useState<Loaded|null>(null),[retainLayout,setRetainLayout]=useState<Positions|null>(null);
 // Server data replaces the local draft whenever a fresh response arrives (initial load, save, reload, scenario switch).
 if(data&&synced!==data){
  setSynced(data);setDoc(data.document);setDirtyDoc(false);setStale(false);
  // After a partial save (business data saved, layout not) keep the unsaved layout and stay dirty so a retry only has to save the layout.
  if(retainLayout){setPositions(retainLayout);setDirtyPos(true);setRetainLayout(null);}else{setPositions(data.positions);setDirtyPos(false);}
 }
 const rates=Boolean(data?.ratesVisible),editable=Boolean(data?.canEdit);
 const result=useMemo(()=>doc?calculatePlan(doc,{rates}):null,[doc,rates]);
 const issues=useMemo(()=>doc?validatePlan(doc):[],[doc]);
 const auto=useMemo(()=>{
  const out:Positions={};if(!doc||!result)return out;const level=new Map<string,number>(),rows=new Map<number,number>();
  for(const id of result.order){const preds=doc.dependencies.filter(d=>d.to===id).map(d=>level.get(d.from)??0);level.set(id,preds.length?Math.max(...preds)+1:0);}
  for(const id of result.order){const l=level.get(id)!,r=rows.get(l)??0;rows.set(l,r+1);out[id]={x:24+l*(NODE_W+60),y:24+r*(NODE_H+28)};}
  return out;
 },[doc,result]);
 if(loaded.error&&!data)return <div className="space-y-4"><Btn variant="secondary" onClick={onBack}>Back to plans</Btn><ErrorState error={loaded.error}/></div>;
 if(!data||!doc||!result)return <p role="status" className="py-6 text-sm text-slate-500">Loading plan…</p>;
 const pos=(id:string)=>positions[id]??auto[id]??{x:24,y:24};
 const edit=(fn:(d:PlanDocument)=>PlanDocument)=>{setDoc(d=>d?fn(d):d);setDirtyDoc(true);};
 const patch=(id:string,p:Partial<PlanActivity>)=>edit(d=>({...d,activities:d.activities.map(a=>a.id===id?{...a,...p}:a)}));
 const add=(kind:'activity'|'milestone')=>{const id=newId();const n=doc.activities.length;edit(d=>({...d,activities:[...d.activities,blankActivity(kind,kind==='milestone'?'New milestone':['Milling','Preparation','Paving'][n]||`Activity ${n+1}`,id)]}));setPositions(p=>({...p,[id]:{x:24+(n%4)*(NODE_W+60),y:24+Math.floor(n/4)*(NODE_H+28)}}));setDirtyPos(true);setDrawer(id);};
 const remove=(id:string)=>{edit(d=>({activities:d.activities.filter(a=>a.id!==id),dependencies:d.dependencies.filter(x=>x.from!==id&&x.to!==id),sharedCosts:d.sharedCosts}));setPositions(p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!==id)));setDrawer(null);};
 const connect=(from:string,to:string)=>{
  if(from===to||doc.dependencies.some(d=>d.from===from&&d.to===to))return;
  const next=[...doc.dependencies,{from,to}];const loop=findCycle(doc.activities.map(a=>a.id),next);
  if(loop){const names=new Map(doc.activities.map(a=>[a.id,a.name]));setNote(`Not connected: that would create a loop (${loop.map(i=>names.get(i)).join(' → ')}).`);setLinkFrom(null);return;}
  setNote('');edit(d=>({...d,dependencies:next}));setLinkFrom(null);
 };
 const persist=()=>save.run(async()=>{
  setNote('');
  let latest=data,businessSaved=false;
  if(dirtyDoc){
   if(issues.length)throw new Error(issues[0].message);
   latest=await api<Loaded>('/api/planning',{method:'POST',body:{action:'save',scenarioId:data.scenario.id,expectedRevision:data.scenario.revision,document:doc}}).catch(e=>{if(e&&(e as {status?:number}).status===409)setStale(true);throw e;});
   businessSaved=true;
  }
  // Layout is saved only for activities that still exist in the saved scenario: positions of removed activities are dropped, never sent.
  const live=new Set(latest.document.activities.map(a=>a.id));
  const layout:Positions=Object.fromEntries(Object.entries(positions).filter(([id])=>live.has(id)));
  if(dirtyPos&&Object.keys(layout).length){
   try{await api('/api/planning',{method:'POST',body:{action:'positions',scenarioId:data.scenario.id,positions:layout}});}
   catch(e){
    // The business save already happened: adopt its new revision so a retry saves only the layout instead of hitting a stale-version error.
    if(businessSaved){setRetainLayout(layout);loaded.setData(latest);}
    throw new Error(`${businessSaved?'Your changes were saved, but the layout could not be saved. ':''}${e instanceof Error?e.message:'The layout save failed.'} Press Save to retry the layout.`);
   }
  }
  return {latest,layout};
 },r=>{if(r){loaded.setData({...r.latest,positions:r.layout});setDirtyDoc(false);setDirtyPos(false);setNote('Saved.');}});
 const dirty=dirtyDoc||dirtyPos;
 const newScenario=()=>save.run(()=>api<Loaded>('/api/planning',{method:'POST',body:{action:'create-scenario',planId:data.plan.id,name:newName,basedOnScenarioId:data.scenario.id}}),l=>{setNewName('');setCurrent(l.scenario.id);});
 const selected=drawer?doc.activities.find(a=>a.id===drawer):null;
 const total=result.cost;

 return <div className="space-y-5">
  <PageHeader crumbs={[{label:'Planning',onClick:onBack},{label:data.plan.name}]} title={data.plan.name} subtitle="Undated methodology plan. The timeline is relative: working days from the start of the plan, with no availability claims."
   badges={<><Pill tone="info">Scenario: {data.scenario.name}</Pill>{dirty&&<Pill tone="warning">Unsaved changes</Pill>}</>}
   actions={<div className="flex flex-wrap gap-2">{editable&&<Btn onClick={()=>void persist()} busy={save.busy} disabled={!dirty||issues.length>0}>Save</Btn>}<a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50" href={`/api/planning?scenarioId=${data.scenario.id}&export=csv`}><Download aria-hidden className="size-4"/>Export CSV</a></div>}/>
  <ErrorState error={stale?'':(save.error||loaded.error)}/>
  {stale&&<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This scenario was changed elsewhere. Your edits were not saved.<Btn variant="secondary" onClick={()=>{save.setError('');setNote('');loaded.refresh();}}>Discard mine and reload</Btn></div>}
  {note&&<p role="status" className="text-sm text-slate-600">{note}</p>}
  {issues.length>0&&editable&&<ul role="alert" className="list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 pl-7 text-sm text-red-800">{issues.slice(0,4).map((i,k)=><li key={k}>{i.message}</li>)}</ul>}
  <Section title="Scenarios" description="Each scenario is an independent proposal. Nothing here changes an approved estimate or books a resource.">
   <div className="flex flex-wrap items-end gap-3">
    <Field label="Scenario"><select aria-label="Scenario" className={fieldClass} value={data.scenario.id} disabled={dirty} onChange={e=>setCurrent(e.target.value)}>{data.plan.scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    {dirty&&<p className="text-xs text-slate-500">Save or discard changes before switching.</p>}
    {dirty&&<Btn variant="ghost" onClick={()=>{save.setError('');setNote('');loaded.refresh();}}>Discard changes</Btn>}
    {editable&&!dirty&&<form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();if(newName.trim())void newScenario();}}><Field label="Save a copy as a new scenario"><input className={fieldClass} value={newName} maxLength={180} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Night shift option"/></Field><Btn type="submit" variant="secondary" disabled={!newName.trim()} busy={save.busy}><GitBranch aria-hidden className="size-4"/>New scenario</Btn></form>}
   </div>
  </Section>
  <div className="grid gap-3 sm:grid-cols-3">
   <Stat label="Plan cost (ex GST)" value={cost(total?.total,rates)} hint={!rates?'Rates are restricted for your role':total&&total.total===null?`${total.unknownCount} value${total.unknownCount===1?'':'s'} unknown; known so far ${money(total.knownTotal,true)}`:'Shared costs counted once'}/>
   <Stat label="Relative duration" value={result.duration.complete?dayText(result.duration.days):'Unknown'} hint={result.duration.complete?'Working days from plan start (relative)':`${result.duration.unknownActivities.length} activit${result.duration.unknownActivities.length===1?'y':'ies'} without a known finish`}/>
   <Stat label="Activities" value={doc.activities.length} hint={`${doc.dependencies.length} dependenc${doc.dependencies.length===1?'y':'ies'}`}/>
  </div>
  <Tabs label="Planning views" active={view} onChange={setView} tabs={[{key:'Flowchart',label:'Flowchart'},{key:'Timeline',label:'Relative timeline'},{key:'Costs',label:'Costs'}]}/>
  {editable&&view!=='Costs'&&<div className="flex flex-wrap gap-2"><Btn variant="secondary" onClick={()=>add('activity')}><Plus aria-hidden className="size-4"/>Add activity</Btn><Btn variant="secondary" onClick={()=>add('milestone')}><Milestone aria-hidden className="size-4"/>Add milestone</Btn>{linkFrom&&<Btn variant="ghost" onClick={()=>setLinkFrom(null)}>Cancel connecting</Btn>}</div>}
  {view==='Flowchart'&&<Canvas doc={doc} result={result} rates={rates} pos={pos} linkFrom={linkFrom} editable={editable} onMove={(id,p)=>{setPositions(s=>({...s,[id]:p}));setDirtyPos(true);}} onOpen={setDrawer} onLink={id=>linkFrom?connect(linkFrom,id):setLinkFrom(id)} onUnlink={(f,t)=>edit(d=>({...d,dependencies:d.dependencies.filter(x=>!(x.from===f&&x.to===t))}))}/>}
  {view==='Timeline'&&<Timeline doc={doc} result={result} onOpen={setDrawer}/>}
  {view==='Costs'&&<CostsPanel doc={doc} result={result} rates={rates} editable={editable} edit={edit}/>}
  {selected&&<Drawer key={selected.id} a={selected} doc={doc} result={result} rates={rates} editable={editable} labels={{...data.resources,...picked}} linkable={data.resourcesAvailable} onPick={c=>setPicked(p=>({...p,[`${c.type}:${c.id}`]:c}))} onClose={()=>setDrawer(null)} patch={p=>patch(selected.id,p)} edit={edit} remove={()=>remove(selected.id)}/>}
 </div>;
}

function Canvas({doc,result,rates,pos,linkFrom,editable,onMove,onOpen,onLink,onUnlink}:{doc:PlanDocument;result:PlanResult;rates:boolean;pos:(id:string)=>{x:number;y:number};linkFrom:string|null;editable:boolean;onMove:(id:string,p:{x:number;y:number})=>void;onOpen:(id:string)=>void;onLink:(id:string)=>void;onUnlink:(f:string,t:string)=>void}){
 const drag=useRef<{id:string;dx:number;dy:number;moved:boolean}|null>(null);
 const width=Math.max(640,...doc.activities.map(a=>pos(a.id).x+NODE_W+40)),height=Math.max(320,...doc.activities.map(a=>pos(a.id).y+NODE_H+40));
 const down=(e:ReactPointerEvent<HTMLDivElement>,id:string)=>{if(!editable||(e.target as HTMLElement).closest('button'))return;const p=pos(id);drag.current={id,dx:e.clientX-p.x,dy:e.clientY-p.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId);};
 const move=(e:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;if(!d)return;d.moved=true;onMove(d.id,{x:Math.max(0,Math.round(e.clientX-d.dx)),y:Math.max(0,Math.round(e.clientY-d.dy))});};
 const up=()=>{drag.current=null;};
 const key=(e:React.KeyboardEvent<HTMLDivElement>,id:string)=>{const step=e.shiftKey?40:10,p=pos(id);const d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(d&&editable){e.preventDefault();onMove(id,{x:Math.max(0,p.x+d[0]),y:Math.max(0,p.y+d[1])});}else if(e.key==='Enter')onOpen(id);};
 if(!doc.activities.length)return <EmptyState title="Start with a block" detail="Add activities such as milling, preparation and paving, then connect their sequence."/>;
 return <div className="overflow-auto rounded-xl border bg-slate-50" style={{maxHeight:'70vh'}}><div data-testid="plan-canvas" className="relative" style={{width,height}}>
  <svg aria-hidden className="pointer-events-none absolute inset-0" width={width} height={height}><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs>
   {doc.dependencies.map(d=>{const a=pos(d.from),b=pos(d.to),x1=a.x+NODE_W,y1=a.y+NODE_H/2,x2=b.x,y2=b.y+NODE_H/2,mx=(x1+x2)/2;return <path key={`${d.from}>${d.to}`} data-testid="plan-edge" data-from={d.from} data-to={d.to} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} fill="none" stroke="#64748b" strokeWidth="1.6" markerEnd="url(#arrow)"/>;})}
  </svg>
  {editable&&doc.dependencies.map(d=>{const a=pos(d.from),b=pos(d.to);const names=new Map(doc.activities.map(x=>[x.id,x.name]));return <button key={`x${d.from}>${d.to}`} aria-label={`Remove link from ${names.get(d.from)} to ${names.get(d.to)}`} className="absolute z-10 flex size-6 items-center justify-center rounded-full border bg-white text-slate-500 shadow-sm hover:text-red-700" style={{left:(a.x+NODE_W+b.x)/2-12,top:(a.y+b.y+NODE_H)/2-12}} onClick={()=>onUnlink(d.from,d.to)}><X aria-hidden className="size-3"/></button>;})}
  {doc.activities.map(a=>{const p=pos(a.id),r=result.activities[a.id];return <div key={a.id} role="group" tabIndex={0} aria-label={`${a.name}, ${a.kind}`} data-testid="plan-node" data-activity-id={a.id} data-x={p.x} data-y={p.y} onKeyDown={e=>key(e,a.id)}
   onPointerDown={e=>down(e,a.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
   className={`absolute select-none rounded-xl border bg-white p-2.5 shadow-sm ${editable?'cursor-grab active:cursor-grabbing':''} ${linkFrom===a.id?'ring-2 ring-primary':''} ${a.kind==='milestone'?'border-amber-300 bg-amber-50':'border-slate-300'}`} style={{left:p.x,top:p.y,width:NODE_W,height:NODE_H,touchAction:'none'}}>
   <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-semibold text-slate-900">{a.kind==='milestone'&&<Milestone aria-hidden className="mr-1 inline size-3.5"/>}{a.name}</p></div>
   <p className="mt-0.5 text-xs text-slate-600">{a.kind==='milestone'?'Milestone':dayText(r.durationDays)} · day {r.start??'?'} → {r.finish??'?'}</p>
   {a.kind==='activity'&&<p className="text-xs text-slate-600">{costLabel(a,r.cost?.total,rates)}</p>}
   <div className="mt-1 flex gap-1.5"><button className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-slate-100" onClick={()=>onOpen(a.id)}>{editable?'Edit':'View'}</button>
    {editable&&<button aria-label={linkFrom&&linkFrom!==a.id?`Connect to ${a.name}`:`Connect from ${a.name}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-slate-100" onClick={()=>onLink(a.id)}><Link2 aria-hidden className="size-3"/>{linkFrom&&linkFrom!==a.id?'Connect here':linkFrom===a.id?'Choose next':'Connect'}</button>}</div>
  </div>;})}
 </div></div>;
}

function Timeline({doc,result,onOpen}:{doc:PlanDocument;result:PlanResult;onOpen:(id:string)=>void}){
 const max=Math.max(1,...result.order.map(id=>result.activities[id].finish??0));
 const byId=new Map(doc.activities.map(a=>[a.id,a]));
 return <Section title="Relative timeline" description="Working days from the start of the plan. No calendar dates and no resource availability are implied. Parallel paths join at the latest predecessor finish.">
  {!doc.activities.length?<EmptyState title="Nothing to show yet"/>:<ol data-testid="plan-timeline" className="space-y-2">{result.order.map(id=>{const a=byId.get(id)!,r=result.activities[id];const left=r.start===null?0:r.start/max*100,w=r.finish===null||r.start===null?100:Math.max(1.5,(r.finish-r.start)/max*100);
   return <li key={id} data-activity-id={id} className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center"><button className="truncate text-left text-sm font-medium text-slate-900 hover:underline" onClick={()=>onOpen(id)}>{a.name}</button>
    <div className="relative h-7 rounded bg-slate-100">{r.start===null||r.finish===null?<span className="absolute inset-0 flex items-center justify-center rounded border border-dashed border-slate-400 text-xs text-slate-500">Unknown duration or predecessor</span>:<span data-start={r.start} data-finish={r.finish} className={`absolute top-0 flex h-7 items-center overflow-hidden whitespace-nowrap rounded px-1.5 text-xs text-white ${a.kind==='milestone'?'bg-amber-600':'bg-primary'}`} style={{left:`${Math.min(left,99)}%`,width:`${Math.min(w,100-Math.min(left,99))}%`}}>{a.kind==='milestone'?`◆ day ${r.start}`:`${r.start}–${r.finish}`}</span>}</div></li>;})}</ol>}
  <p className="mt-3 text-xs text-slate-500">Relative timeline · {result.duration.complete?`${result.duration.days} working days in total`:'total unknown until every duration is known'}</p>
 </Section>;
}

function CostsPanel({doc,result,rates,editable,edit}:{doc:PlanDocument;result:PlanResult;rates:boolean;editable:boolean;edit:(fn:(d:PlanDocument)=>PlanDocument)=>void}){
 if(!rates)return <Section title="Costs"><p role="status" className="text-sm text-slate-600">Costs and rates are restricted for your role. Durations and the relative timeline remain available.</p></Section>;
 const c=result.cost!;
 return <div className="space-y-5"><Section title="Plan cost (ex GST)" description="Unknown values stay unknown: they are never counted as zero.">
  <dl className="grid gap-2 text-sm sm:grid-cols-2"><div className="flex justify-between"><dt>Resources</dt><dd data-testid="cost-run">{money(c.runTotal,true)}</dd></div><div className="flex justify-between"><dt>Activity setup</dt><dd data-testid="cost-setup">{money(c.activitySetupTotal,true)}</dd></div><div className="flex justify-between"><dt>Shared costs (counted once)</dt><dd data-testid="cost-shared">{money(c.sharedTotal,true)}</dd></div><div className="flex justify-between font-semibold"><dt>Total</dt><dd data-testid="cost-total">{c.total===null?`Unknown (${c.unknownCount} missing; known ${money(c.knownTotal,true)})`:money(c.total,true)}</dd></div></dl>
 </Section>
 <Section title="Shared costs" description="One cost used by several activities (for example mobilisation or traffic management). It is counted once in the plan total.">
  <ul className="space-y-2">{doc.sharedCosts.map(s=><li key={s.id} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"><Field label="Name"><input className={fieldClass} disabled={!editable} value={s.label} maxLength={180} onChange={e=>edit(d=>({...d,sharedCosts:d.sharedCosts.map(x=>x.id===s.id?{...x,label:e.target.value}:x)}))}/></Field><Field label="Amount (ex GST)"><NumInput spec={FIELDS.amount} label={`Amount for ${s.label}`} disabled={!editable} value={s.amount} onChange={v=>edit(d=>({...d,sharedCosts:d.sharedCosts.map(x=>x.id===s.id?{...x,amount:v}:x)}))}/></Field>{editable&&<Btn variant="ghost" aria-label={`Remove shared cost ${s.label}`} onClick={()=>edit(d=>({activities:d.activities.map(a=>({...a,sharedCostIds:a.sharedCostIds.filter(i=>i!==s.id)})),dependencies:d.dependencies,sharedCosts:d.sharedCosts.filter(x=>x.id!==s.id)}))}><Trash2 aria-hidden className="size-4"/></Btn>}</li>)}</ul>
  {editable&&<Btn className="mt-3" variant="secondary" onClick={()=>edit(d=>({...d,sharedCosts:[...d.sharedCosts,{id:newId(),label:'Shared cost',amount:null}]}))}><Plus aria-hidden className="size-4"/>Add shared cost</Btn>}
 </Section>
 <Section title="By activity"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Activity</th><th className="pr-3">Resources</th><th className="pr-3">Setup</th><th>Total</th></tr></thead><tbody>{doc.activities.map(a=>{const r=result.activities[a.id].cost!;return <tr key={a.id} className="border-t"><td className="py-1.5 pr-3">{a.name}</td><td className="pr-3">{a.requirements.length?cost(r.runCost,true):'—'}</td><td className="pr-3">{a.costItems.length?cost(r.setupCost,true):'—'}</td><td data-testid="activity-total">{costLabel(a,r.total,true)}</td></tr>;})}</tbody></table></div></Section></div>;
}

/**
 * Link one requirement to an existing worker (labour) or plant item. Selecting only records the reference: the name, count, rate,
 * rate basis and productivity of the line are never touched, and nothing about availability is implied (plans are undated).
 */
function ResourceLink({q,editable,available,labels,onPick,onChange}:{q:Requirement;editable:boolean;available:boolean;labels:Record<string,Choice>;onPick:(c:Choice)=>void;onChange:(ref:Requirement['resourceRef'])=>void}){
 const type=q.kind==='plant'?'plant':'worker',noun=type==='plant'?'plant item':'worker';
 const [open,setOpen]=useState(false),[term,setTerm]=useState('');
 // Results are remembered with the search text they answer, so a list for an older query is never shown (or clicked) for a newer one.
 const [found,setFound]=useState<{term:string;items:Choice[]}|null>(null),[error,setError]=useState('');
 const results=found&&found.term===term?found.items:null;
 useEffect(()=>{
  if(!open)return;
  let live=true;
  const t=setTimeout(()=>{api<{results:Choice[]}>(`/api/planning?lookup=${type}&q=${encodeURIComponent(term)}`).then(r=>{if(live){setFound({term,items:r.results});setError('');}},e=>{if(live){setFound({term,items:[]});setError(e instanceof Error?e.message:'Search failed.');}});},term?250:0);
  return()=>{live=false;clearTimeout(t);};
 },[open,term,type]);
 const ref=q.resourceRef,label=ref?labels[`${ref.type}:${ref.id}`]:undefined;
 const choose=(c:Choice)=>{onPick(c);onChange({type:c.type,id:c.id});setOpen(false);setTerm('');setFound(null);};
 return <div data-testid="resource-link" className="grid gap-1 sm:col-span-6">
  {ref?<div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
    <Link2 aria-hidden className="size-4 text-slate-500"/>
    <span data-testid="resource-link-label"><span className="text-slate-500">Linked {ref.type==='plant'?'plant':'worker'}: </span><strong>{label?label.label:'not available to you'}</strong>{label?.detail&&<span className="text-slate-500"> · {label.detail}</span>}{label?.archived&&<Pill tone="warning">Archived</Pill>}</span>
    {editable&&available&&<><Btn variant="ghost" aria-label={`Replace linked ${noun}`} onClick={()=>setOpen(true)}>Replace</Btn><Btn variant="ghost" aria-label={`Clear linked ${noun}`} onClick={()=>{onChange(null);setOpen(false);}}>Clear link</Btn></>}
    {editable&&!available&&<Btn variant="ghost" aria-label={`Clear linked ${noun}`} onClick={()=>onChange(null)}>Clear link</Btn>}
   </div>
  :editable&&(available?<div><Btn variant="secondary" aria-label={`Link a ${noun}`} onClick={()=>setOpen(true)}><Link2 aria-hidden className="size-4"/>Link a {noun}</Btn></div>:<p className="text-xs text-slate-500">Linking a worker or plant item needs Operations and resource access.</p>)}
  {open&&editable&&available&&<div className="grid gap-2 rounded-lg border bg-white p-2">
   <input aria-label={`Search ${type==='plant'?'plant':'workers'}`} autoFocus className={fieldClass} value={term} maxLength={80} placeholder={type==='plant'?'Search plant by number, name or category':'Search workers by name, number or role'} onChange={e=>setTerm(e.target.value)}/>
   <ul role="listbox" aria-label={`${type==='plant'?'Plant':'Workers'} matching your search`} className="max-h-56 divide-y overflow-auto rounded border">
    {results===null&&<li className="p-2 text-sm text-slate-500">Searching…</li>}
    {results?.length===0&&<li className="p-2 text-sm text-slate-500">{error||'No matching records.'}</li>}
    {results?.map(c=><li key={c.id} role="option" aria-selected={ref?.id===c.id}><button type="button" data-testid="resource-option" className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={()=>choose(c)}><span className="font-medium">{c.label}</span>{c.detail&&<span className="block text-xs text-slate-500">{c.detail}</span>}</button></li>)}
   </ul>
   <p className="text-xs text-slate-500">Linking records which {noun} this line refers to. It does not change the name, count or rate, and it does not check availability.</p>
   <div><Btn variant="ghost" onClick={()=>{setOpen(false);setTerm('');setFound(null);}}>Cancel</Btn></div>
  </div>}
 </div>;
}

function Drawer({a,doc,result,rates,editable,labels,linkable,onPick,onClose,patch,edit,remove}:{a:PlanActivity;doc:PlanDocument;result:PlanResult;rates:boolean;editable:boolean;labels:Record<string,Choice>;linkable:boolean;onPick:(c:Choice)=>void;onClose:()=>void;patch:(p:Partial<PlanActivity>)=>void;edit:(fn:(d:PlanDocument)=>PlanDocument)=>void;remove:()=>void}){
 const r=result.activities[a.id],ro=!editable;
 const preds=doc.dependencies.filter(d=>d.to===a.id).map(d=>d.from);
 const setReq=(id:string,p:Partial<Requirement>)=>patch({requirements:a.requirements.map(x=>x.id===id?{...x,...p}:x)});
 const togglePred=(id:string,on:boolean)=>{
  if(on){const next=[...doc.dependencies,{from:id,to:a.id}];const loop=findCycle(doc.activities.map(x=>x.id),next);if(loop)return;edit(d=>({...d,dependencies:next}));}
  else edit(d=>({...d,dependencies:d.dependencies.filter(x=>!(x.from===id&&x.to===a.id))}));
 };
 const wouldLoop=(id:string)=>!preds.includes(id)&&Boolean(findCycle(doc.activities.map(x=>x.id),[...doc.dependencies,{from:id,to:a.id}]));
 return <div role="dialog" aria-modal="true" aria-label={`Activity details: ${a.name}`} className="fixed inset-0 z-[70] flex justify-end bg-slate-950/30" onMouseDown={e=>{if(e.currentTarget===e.target)onClose();}} onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
  <div className="h-full w-full max-w-xl space-y-4 overflow-y-auto bg-white p-5 shadow-2xl">
   <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.kind==='milestone'?'Milestone':'Activity'}</p><h2 className="text-xl font-bold">{a.name||'Untitled'}</h2><p className="text-sm text-slate-500">Relative day {r.start??'?'} → {r.finish??'?'} · {a.kind==='milestone'?'zero duration':dayText(r.durationDays)}</p></div><Btn variant="secondary" onClick={onClose}>Close</Btn></div>
   <Field label="Name" required><input aria-label="Activity name" className={fieldClass} disabled={ro} value={a.name} maxLength={180} onChange={e=>patch({name:e.target.value})}/></Field>
   <Field label="Notes"><textarea className={fieldClass} rows={2} disabled={ro} value={a.notes} maxLength={4000} onChange={e=>patch({notes:e.target.value})}/></Field>
   {a.kind==='activity'&&<>
    <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-sm font-medium text-slate-700">Duration</legend>
     <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" disabled={ro} checked={a.durationMode==='entered'} onChange={()=>patch({durationMode:'entered'})}/>Enter the duration</label>
     <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" disabled={ro} checked={a.durationMode==='derived'} onChange={()=>patch({durationMode:'derived'})}/>Derive it from quantity and productivity</label>
     {a.durationMode==='entered'?<Field label="Duration (working days)" hint="Leave empty if unknown."><NumInput spec={FIELDS.durationDays} label="Duration days" disabled={ro} value={a.durationDays} onChange={v=>patch({durationDays:v})}/></Field>
      :<div className="grid gap-3 sm:grid-cols-2"><Field label="Quantity"><NumInput spec={FIELDS.quantity} label="Quantity" disabled={ro} value={a.quantity} onChange={v=>patch({quantity:v})}/></Field>
       <Field label="Quantity unit"><input aria-label="Quantity unit" list="plan-units" className={fieldClass} disabled={ro} value={a.unit??''} maxLength={20} onChange={e=>patch({unit:e.target.value||null})}/></Field>
       <Field label="Productivity (per productive hour)"><NumInput spec={FIELDS.productivity} label="Productivity" disabled={ro} value={a.productivity} onChange={v=>patch({productivity:v})}/></Field>
       <Field label="Productivity unit"><input aria-label="Productivity unit" list="plan-units" className={fieldClass} disabled={ro} value={a.productivityUnit??''} maxLength={20} onChange={e=>patch({productivityUnit:e.target.value||null})}/></Field>
       <p data-testid="derived-duration" className="text-sm text-slate-700 sm:col-span-2">Derived duration: <strong>{dayText(r.durationDays)}</strong>{r.durationDays===null&&' (needs quantity, productivity and productive hours per day)'}</p></div>}
     <Field label="Productive hours per day" hint="Needed for hourly rates and derived durations. Leave empty if unknown."><NumInput spec={FIELDS.hoursPerDay} label="Productive hours per day" disabled={ro} value={a.hoursPerDay} onChange={v=>patch({hoursPerDay:v})}/></Field>
     <datalist id="plan-units">{KNOWN_UNITS.map(u=><option key={u} value={u}/>)}</datalist>
    </fieldset>
    <fieldset className="grid gap-1 rounded-lg border p-3"><legend className="px-1 text-sm font-medium text-slate-700">Resources</legend>
     {a.requirements.map(q=>{const c=r.cost?.requirements.find(x=>x.id===q.id);return <div key={q.id} data-testid="requirement" className="grid gap-2 border-b pb-3 last:border-0 sm:grid-cols-[6rem_1fr_5rem_7rem_6rem_auto] sm:items-end">
      <Field label="Type"><select aria-label="Resource type" title={q.resourceRef?'Clear the linked worker or plant item to change the type.':undefined} className={fieldClass} disabled={ro||Boolean(q.resourceRef)} value={q.kind} onChange={e=>setReq(q.id,{kind:e.target.value as Requirement['kind']})}><option value="labour">Labour</option><option value="plant">Plant</option></select></Field>
      <Field label="Name"><input aria-label="Resource name" className={fieldClass} disabled={ro} value={q.name} maxLength={180} onChange={e=>setReq(q.id,{name:e.target.value})}/></Field>
      <Field label="Count"><NumInput spec={FIELDS.count} label="Resource count" disabled={ro} value={q.quantity} onChange={v=>setReq(q.id,{quantity:v})}/></Field>
      <Field label={rates?'Rate (ex GST)':'Rate'}>{rates?<NumInput spec={FIELDS.rate} label="Resource rate" disabled={ro} value={q.rate} onChange={v=>setReq(q.id,{rate:v})}/>:<span className="text-sm text-slate-500">Restricted</span>}</Field>
      <Field label="Per"><select aria-label="Rate basis" className={fieldClass} disabled={ro||!rates} value={q.rateBasis} onChange={e=>setReq(q.id,{rateBasis:e.target.value as 'hour'|'day'})}><option value="hour">hour</option><option value="day">day</option></select></Field>
      {!ro&&<Btn variant="ghost" aria-label={`Remove ${q.name||'resource'}`} onClick={()=>patch({requirements:a.requirements.filter(x=>x.id!==q.id)})}><Trash2 aria-hidden className="size-4"/></Btn>}
      <p className="text-xs text-slate-500 sm:col-span-6">Cost: {cost(c?.amount,rates)}</p>
      <ResourceLink q={q} editable={!ro} available={linkable} labels={labels} onPick={onPick} onChange={ref=>setReq(q.id,{resourceRef:ref})}/></div>;})}
     {!ro&&<div className="flex gap-2 pt-1"><Btn variant="secondary" onClick={()=>patch({requirements:[...a.requirements,{id:newId(),kind:'labour',name:'Labour',quantity:null,rate:null,rateBasis:'hour',resourceRef:null}]})}><Plus aria-hidden className="size-4"/>Add labour</Btn><Btn variant="secondary" onClick={()=>patch({requirements:[...a.requirements,{id:newId(),kind:'plant',name:'Plant',quantity:null,rate:null,rateBasis:'hour',resourceRef:null}]})}><Plus aria-hidden className="size-4"/>Add plant</Btn></div>}
    </fieldset>
    {rates&&<fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1 text-sm font-medium text-slate-700">Setup costs</legend>
     {a.costItems.map(c=><div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"><Field label="Setup item"><input aria-label="Setup cost name" className={fieldClass} disabled={ro} value={c.label} maxLength={180} onChange={e=>patch({costItems:a.costItems.map(x=>x.id===c.id?{...x,label:e.target.value}:x)})}/></Field><Field label="Amount (ex GST)"><NumInput spec={FIELDS.amount} label="Setup cost amount" disabled={ro} value={c.amount} onChange={v=>patch({costItems:a.costItems.map(x=>x.id===c.id?{...x,amount:v}:x)})}/></Field>{!ro&&<Btn variant="ghost" aria-label={`Remove ${c.label}`} onClick={()=>patch({costItems:a.costItems.filter(x=>x.id!==c.id)})}><Trash2 aria-hidden className="size-4"/></Btn>}</div>)}
     {!ro&&<Btn variant="secondary" className="justify-self-start" onClick={()=>patch({costItems:[...a.costItems,{id:newId(),label:'Setup',amount:null}]})}><Plus aria-hidden className="size-4"/>Add setup cost</Btn>}
    </fieldset>}
    {doc.sharedCosts.length>0&&<fieldset className="grid gap-1 rounded-lg border p-3"><legend className="px-1 text-sm font-medium text-slate-700">Relies on shared costs</legend><p className="text-xs text-slate-500">Counted once in the plan total, not in this activity.</p>
     {doc.sharedCosts.map(s=><label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={a.sharedCostIds.includes(s.id)} onChange={e=>patch({sharedCostIds:e.target.checked?[...a.sharedCostIds,s.id]:a.sharedCostIds.filter(x=>x!==s.id)})}/>{s.label}</label>)}</fieldset>}
   </>}
   <fieldset className="grid gap-1 rounded-lg border p-3"><legend className="px-1 text-sm font-medium text-slate-700">Starts after (finish-to-start)</legend>
    {doc.activities.filter(x=>x.id!==a.id).map(x=><label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro||wouldLoop(x.id)} checked={preds.includes(x.id)} onChange={e=>togglePred(x.id,e.target.checked)}/>{x.name}{wouldLoop(x.id)&&<span className="text-xs text-slate-500">(would create a loop)</span>}</label>)}
    {doc.activities.length<2&&<p className="text-xs text-slate-500">Add another activity to connect it.</p>}</fieldset>
   {a.kind==='activity'&&<p data-testid="activity-cost" className="rounded-lg bg-slate-50 p-3 text-sm">Activity cost: <strong>{costLabel(a,r.cost?.total,rates)}</strong>{rates&&r.cost&&r.cost.unknownCount>0&&<> · {r.cost.unknownCount} value{r.cost.unknownCount===1?'':'s'} unknown (known so far {money(r.cost.knownSubtotal,true)})</>}</p>}
   {!ro&&<Btn variant="danger" onClick={remove}><Trash2 aria-hidden className="size-4"/>Remove {a.kind}</Btn>}
  </div></div>;
}
