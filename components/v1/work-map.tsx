'use client';
// Project Work map: draw, edit and archive operational work-area / stage polygons.
// The editor is provider-independent: it draws on a plain metric grid anchored to the project's location pin, so it works
// with no map provider and uses no third-party imagery. The address pin (components/v1/location.tsx) is shown but never edited here.
// An aerial basemap can be added later behind the same projection (see docs/WORK-MAP.md — licensing is unresolved).
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,Archive,Crosshair,Maximize2,Minus,PenLine,Plus,Redo2,Trash2,Undo2} from 'lucide-react';
import {api,useApi,useAction,Btn,Field,field,Pill,EmptyState,ErrorState,Loading} from './kit';
import {DefRows,DisciplineSwatch,Heading,PatternDefs,fillFor} from './studio';
import {LocationSummary} from './location';
import {useNavGuard} from './nav';
import {WorkPointPanel} from './work-point';
import {DELIVERY_LABEL,DISCIPLINE_LABEL,KIND_LABEL,WORK_AREA_DELIVERY,WORK_AREA_DISCIPLINES,WORK_AREA_KINDS,WORK_AREA_LIMITS,fromLocal,toLocal,validateRing,type WorkAreaDelivery,type WorkAreaDiscipline,type WorkAreaKind,type WorkAreaView,type WorkMapView,type Xy} from '@/lib/v1/work-areas';
import {EMPTY_PARTS,type LatLng} from '@/lib/v1/location';

type Form={name:string;kind:WorkAreaKind;discipline:WorkAreaDiscipline;delivery:WorkAreaDelivery;contractorLabel:string;sequence:string;notes:string};
type Edit={id:string|null;revision:number;form:Form;ring:LatLng[];drawing:boolean;sel:number|null;dirty:boolean};
type View={cx:number;cy:number;mpp:number};
const emptyForm:Form={name:'',kind:'work_area',discipline:'asphalt',delivery:'own',contractorLabel:'',sequence:'',notes:''};
const formOf=(a:WorkAreaView):Form=>({name:a.name,kind:a.kind,discipline:a.discipline,delivery:a.delivery,contractorLabel:a.contractorLabel||'',sequence:a.sequence==null?'':String(a.sequence),notes:a.notes||''});
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const niceStep=(m:number)=>{const p=10**Math.floor(Math.log10(m)),f=m/p;return (f<1.5?1:f<3.5?2:f<7.5?5:10)*p;};
const fmtArea=(m2:number)=>m2>=10000?`${(m2/10000).toFixed(2)} ha`:`${Math.round(m2).toLocaleString('en-AU')} m²`;
const fmtLen=(m:number)=>m>=1000?`${m/1000} km`:`${m} m`;

export function WorkMap({projectId,focusId}:{projectId:string;focusId?:string}){
 const [showArchived,setShowArchived]=useState(false);
 const res=useApi<WorkMapView>(`/api/projects/work-areas?projectId=${encodeURIComponent(projectId)}${showArchived?'&archived=1':''}`);
 const [selected,setSelected]=useState<string|null>(focusId??null);
 const [edit,setEdit]=useState<Edit|null>(null);
 const act=useAction();
 const data=res.data;
 const [conflict,setConflict]=useState(false);

 // An unsaved drawing or reshape lives only in this component: warn before any route change, reload or close drops it.
 useNavGuard(edit?.dirty?'You have an unsaved work area on the map. Leave without saving? Your drawing and changes will be lost.':null);

 if(res.error&&!data)return <ErrorState error={res.error} onRetry={res.refresh}/>;
 if(!data)return <Loading label="Loading work map…"/>;
 const active=data.areas.filter(a=>a.status==='active');
 const canDraw=data.canEdit&&(Boolean(data.pin)||data.areas.length>0);
 const ringValid=edit?validateRing(edit.ring):null;

 const startDraw=()=>{setConflict(false);act.setError('');setSelected(null);setEdit({id:null,revision:0,form:{...emptyForm,kind:'work_area'},ring:[],drawing:true,sel:null,dirty:false});};
 const startEdit=(a:WorkAreaView)=>{setConflict(false);act.setError('');setEdit({id:a.id,revision:a.revision,form:formOf(a),ring:a.ring.map(p=>({...p})),drawing:false,sel:null,dirty:false});};
 const cancel=()=>{setEdit(null);act.setError('');setConflict(false);};
 const patchForm=(p:Partial<Form>)=>setEdit(e=>e&&{...e,form:{...e.form,...p},dirty:true});
 const setRing=(ring:LatLng[],sel:number|null=null)=>setEdit(e=>e&&{...e,ring,sel,dirty:true});
 const save=()=>{
  if(!edit||!ringValid||!ringValid.ok)return;
  const f=edit.form,payload={name:f.name.trim(),kind:f.kind,discipline:f.discipline,delivery:f.delivery,contractorLabel:f.delivery==='subcontracted'?f.contractorLabel.trim()||null:null,sequence:f.sequence?Number(f.sequence):null,notes:f.notes.trim()||null,ring:ringValid.ring};
  void act.run(async()=>{
   try{return edit.id?await api<{area:WorkAreaView}>('/api/projects/work-areas',{method:'PATCH',body:{id:edit.id,revision:edit.revision,...payload}}):await api<{area:WorkAreaView}>('/api/projects/work-areas',{method:'POST',body:{projectId,...payload}});}
   catch(e){if((e as {status?:number}).status===409)setConflict(true);throw e;}
  },r=>{setEdit(null);setSelected(r.area.id);setConflict(false);res.refresh();});
 };
 const archive=(a:WorkAreaView)=>{if(!window.confirm(`Archive “${a.name}”? It will be hidden from the map but kept in the history.`))return;void act.run(()=>api('/api/projects/work-areas',{method:'PATCH',body:{id:a.id,revision:a.revision,archive:true}}),()=>{setSelected(null);res.refresh();});};
 const reload=()=>{setEdit(null);setConflict(false);act.setError('');res.refresh();};

 const sel=data.areas.find(a=>a.id===selected)||null;
 const index=(a:WorkAreaView)=>String(data.areas.indexOf(a)+1).padStart(2,'0');
 return <div className="grid gap-5" data-testid="work-map">
  <div className="gs-note gs-note-warn" role="note"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0"/><p><strong>Operational work-area overview.</strong> Not an approved traffic management plan, survey or design. Drawn on a plain grid anchored to the project pin; no aerial imagery is used.</p></div>
  {data.closed&&<p role="status" className="gs-note" data-testid="workmap-closed">This project is closed. The work map is read-only.</p>}
  {!data.closed&&!data.canEdit&&<p role="status" className="gs-note">You can view the work map. Editing needs permission to edit projects.</p>}
  <WorkPointPanel data={data} onChanged={res.refresh}/>
  <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-0">
   <section aria-label="Work map" className="min-w-0 lg:pr-8">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
     <div><p className="gs-eyebrow">Work map</p>{!data.pin&&<p className="mt-1 text-xs text-slate-500">This project has no location pin yet. Set the project location in Setup to anchor the map.</p>}</div>
     <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {data.canEdit&&!edit&&<Btn onClick={startDraw} disabled={!canDraw} data-testid="draw-start"><PenLine aria-hidden className="size-4"/>Draw area</Btn>}
      <label className="flex min-h-11 items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" className="size-4 accent-[var(--gs-graphite)]" checked={showArchived} disabled={Boolean(edit)} onChange={e=>setShowArchived(e.target.checked)}/>Show archived</label>
     </div>
    </div>
    <Canvas data={data} confirmed={data.workPoint.status==='moved'?data.workPoint.confirmed?.point??null:null} edit={edit} selected={selected} onSelect={setSelected} setRing={setRing} onFinish={()=>setEdit(e=>e&&{...e,drawing:false,sel:null})} showArchived={showArchived}/>
    <Legend/>
    {data.pin&&<div className="mt-4 border-t border-[var(--gs-line)] pt-3"><LocationSummary label="Project address pin (not edited here)" location={{...EMPTY_PARTS,pin:data.pin,formattedAddress:data.address}}/></div>}
   </section>
   <aside aria-label={edit?'Edit work area':'Work areas'} className="grid min-w-0 content-start gap-8 border-t border-[var(--gs-line)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
    {edit?<div>
     <Heading eyebrow={edit.drawing?'Drawing':'Reshaping'} title={edit.id?'Edit work area':'New work area'}/>
     <p className="mb-4 mt-2 text-[13px] text-slate-500">{edit.drawing?'Tap the map to add points. Finish when the outline is complete.':'Drag points to reshape. Tap a mid-point to add one.'}</p>
     <EditPanel edit={edit} patchForm={patchForm} setRing={setRing} setEdit={setEdit} ringValid={ringValid!} busy={act.busy} error={act.error} conflict={conflict} onSave={save} onCancel={cancel} onReload={reload}/>
    </div>:<>
     {sel&&<div data-testid="area-detail">
      <Heading eyebrow={`${DISCIPLINE_LABEL[sel.discipline]} / ${sel.delivery==='subcontracted'?'Subcontracted':'Own crew'}`} title={sel.name}/>
      <div className="mt-5"><DefRows rows={[['Type',KIND_LABEL[sel.kind]],['Work type',<span key="w" className="inline-flex items-center gap-2"><DisciplineSwatch discipline={sel.discipline} className="size-3.5"/>{DISCIPLINE_LABEL[sel.discipline]}</span>],['Delivered by',sel.delivery==='subcontracted'?`Subcontracted${sel.contractorLabel?` · ${sel.contractorLabel}`:''}`:'Own crew'],['Area',fmtArea(sel.areaM2)],...(sel.sequence!=null?[['Sequence',String(sel.sequence)] as [string,string]]:[]),['Status',sel.status==='archived'?'Archived':'Active']]}/></div>
      {sel.notes&&<p className="mt-4 whitespace-pre-line text-sm text-slate-700">{sel.notes}</p>}
      <p className="mt-4 text-xs text-slate-500">ID <code data-testid="area-id">{sel.id}</code> · revision {sel.revision}</p>
      {data.canEdit&&sel.status==='active'&&<div className="mt-4 flex flex-wrap gap-2"><Btn onClick={()=>startEdit(sel)} data-testid="area-edit"><PenLine aria-hidden className="size-4"/>Edit</Btn><Btn variant="secondary" onClick={()=>archive(sel)} busy={act.busy} data-testid="area-archive"><Archive aria-hidden className="size-4"/>Archive</Btn></div>}
     </div>}
     <div>
      <div className="mb-2 flex items-baseline justify-between gap-3"><h3 className="gs-eyebrow">Work areas and stages</h3><p className="text-xs text-slate-500">{active.length} active{data.areas.length>active.length?` · ${data.areas.length-active.length} archived`:''}</p></div>
      {act.error&&<p role="alert" className="gs-note gs-note-error mb-2">{act.error}</p>}
      {!data.areas.length?<EmptyState title="No work areas yet." detail={data.canEdit?(data.pin?'Use Draw area to outline the first work area or stage.':'Set the project location first.'):'Nothing has been drawn for this project.'}/>:<ul className="border-t border-[var(--gs-line)]" data-testid="area-list">{data.areas.map(a=><li key={a.id} className="border-b border-[var(--gs-line)]">
       <button type="button" onClick={()=>setSelected(a.id===selected?null:a.id)} aria-pressed={a.id===selected} className={`relative flex min-h-12 w-full items-center gap-3 px-1 py-2.5 text-left text-sm hover:bg-[var(--gs-fog)] ${a.id===selected?'bg-[var(--gs-select)] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--gs-graphite)]':''} ${a.status==='archived'?'opacity-60':''}`} data-testid="area-row">
        <span aria-hidden className="gs-mono w-6 shrink-0 pl-1 text-[12px] text-slate-500">{index(a)}</span>
        <DisciplineSwatch discipline={a.discipline} className="size-3.5"/>
        <span className="min-w-0 flex-1"><span className="block font-medium text-[var(--gs-ink)] [overflow-wrap:anywhere]">{a.name}</span><span className="block text-xs text-slate-500">{[KIND_LABEL[a.kind],DISCIPLINE_LABEL[a.discipline],a.delivery==='subcontracted'?`Subcontracted${a.contractorLabel?` · ${a.contractorLabel}`:''}`:null,fmtArea(a.areaM2)].filter(Boolean).join(' · ')}</span></span>
        {a.status==='archived'&&<Pill>Archived</Pill>}
       </button>
      </li>)}</ul>}
     </div>
    </>}
   </aside>
  </div>
 </div>;
}

function Legend(){return <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600" aria-label="Legend">{WORK_AREA_DISCIPLINES.map(d=><li key={d} className="flex items-center gap-1.5"><DisciplineSwatch discipline={d} className="size-3.5"/>{DISCIPLINE_LABEL[d]}</li>)}<li className="flex items-center gap-1.5"><span aria-hidden className="size-3.5 border border-dashed border-[var(--gs-graphite)]"/>Archived</li><li className="flex items-center gap-1.5"><span aria-hidden className="size-3.5 border-2 border-[var(--gs-ink)]"/>Selected</li></ul>;}

function EditPanel({edit,patchForm,setRing,setEdit,ringValid,busy,error,conflict,onSave,onCancel,onReload}:{edit:Edit;patchForm:(p:Partial<Form>)=>void;setRing:(r:LatLng[],sel?:number|null)=>void;setEdit:(f:(e:Edit|null)=>Edit|null)=>void;ringValid:ReturnType<typeof validateRing>;busy:boolean;error:string;conflict:boolean;onSave:()=>void;onCancel:()=>void;onReload:()=>void}){
 const f=edit.form,named=f.name.trim().length>0,ok=ringValid.ok&&named&&!edit.drawing;
 const undo=()=>setRing(edit.ring.slice(0,-1));
 return <div className="grid gap-3 text-sm">
  {edit.drawing?<div className="flex flex-wrap items-center gap-2">
   <Btn onClick={()=>setEdit(e=>e&&{...e,drawing:false,sel:null})} disabled={edit.ring.length<WORK_AREA_LIMITS.minVertices} data-testid="draw-finish">Finish shape</Btn>
   <Btn variant="secondary" onClick={undo} disabled={!edit.ring.length} data-testid="draw-undo"><Undo2 aria-hidden className="size-4"/>Undo point</Btn>
   <span className="text-xs text-slate-500" data-testid="point-count">{edit.ring.length} point{edit.ring.length===1?'':'s'}</span>
  </div>:<div className="flex flex-wrap items-center gap-2">
   <Btn variant="secondary" onClick={()=>edit.sel!=null&&setRing(edit.ring.filter((_,i)=>i!==edit.sel))} disabled={edit.sel==null||edit.ring.length<=WORK_AREA_LIMITS.minVertices} data-testid="vertex-delete"><Trash2 aria-hidden className="size-4"/>Delete point</Btn>
   <Btn variant="secondary" onClick={()=>setEdit(e=>e&&{...e,drawing:true,sel:null})} data-testid="draw-continue"><Redo2 aria-hidden className="size-4"/>Add points</Btn>
   <span className="text-xs text-slate-500" data-testid="point-count">{edit.ring.length} points{edit.sel!=null?` · point ${edit.sel+1} selected`:''}</span>
  </div>}
  <p role="status" className={`text-xs ${ringValid.ok?'text-[var(--gs-ok)]':'text-[var(--gs-warn)]'}`} data-testid="shape-status">{ringValid.ok?'✓ ':'⚠ '}{edit.ring.length<3?'Add at least 3 points.':ringValid.ok?`Shape OK · ${fmtArea(ringValid.areaM2)}`:ringValid.error}</p>
  <Field label="Name" required><input className={field} value={f.name} maxLength={WORK_AREA_LIMITS.maxNameLength} onChange={e=>patchForm({name:e.target.value})} data-testid="form-name"/></Field>
  <div className="grid grid-cols-2 gap-2">
   <Field label="Type"><select className={field} value={f.kind} onChange={e=>patchForm({kind:e.target.value as WorkAreaKind})} data-testid="form-kind">{WORK_AREA_KINDS.map(k=><option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
   <Field label="Sequence"><input className={field} inputMode="numeric" value={f.sequence} placeholder="optional" onChange={e=>patchForm({sequence:e.target.value.replace(/\D/g,'').slice(0,3)})}/></Field>
  </div>
  <div className="grid grid-cols-2 gap-2">
   <Field label="Work type"><select className={field} value={f.discipline} onChange={e=>patchForm({discipline:e.target.value as WorkAreaDiscipline})} data-testid="form-discipline">{WORK_AREA_DISCIPLINES.map(d=><option key={d} value={d}>{DISCIPLINE_LABEL[d]}</option>)}</select></Field>
   <Field label="Delivered by"><select className={field} value={f.delivery} onChange={e=>patchForm({delivery:e.target.value as WorkAreaDelivery})} data-testid="form-delivery">{WORK_AREA_DELIVERY.map(d=><option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}</select></Field>
  </div>
  {f.delivery==='subcontracted'&&<Field label="Subcontractor" hint="Name only; not linked to the resource register."><input className={field} maxLength={160} value={f.contractorLabel} onChange={e=>patchForm({contractorLabel:e.target.value})} data-testid="form-contractor"/></Field>}
  <Field label="Notes"><textarea className={field} rows={3} maxLength={WORK_AREA_LIMITS.maxNotesLength} value={f.notes} onChange={e=>patchForm({notes:e.target.value})}/></Field>
  {error&&<div role="alert" className="gs-note gs-note-error block" data-testid="save-error">{error}{conflict&&<div className="mt-2"><Btn variant="secondary" onClick={onReload} data-testid="reload-latest">Discard my changes and reload</Btn></div>}</div>}
  <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-[var(--gs-line)] bg-[var(--gs-ivory)] px-1 py-3">
   <Btn onClick={onSave} disabled={!ok||busy} busy={busy} data-testid="save">Save</Btn>
   <Btn variant="secondary" onClick={onCancel} disabled={busy} data-testid="cancel">Cancel</Btn>
  </div>
 </div>;
}

// ---------------------------------------------------------------- canvas
function Canvas({data,confirmed,edit,selected,onSelect,setRing,onFinish,showArchived}:{data:WorkMapView;confirmed:LatLng|null;edit:Edit|null;selected:string|null;onSelect:(id:string|null)=>void;setRing:(r:LatLng[],sel?:number|null)=>void;onFinish:()=>void;showArchived:boolean}){
 const box=useRef<HTMLDivElement>(null),[size,setSize]=useState({w:600,h:420}),[measured,setMeasured]=useState(false);
 useEffect(()=>{const el=box.current;if(!el)return;const ro=new ResizeObserver(([e])=>{setSize({w:Math.max(200,Math.round(e.contentRect.width)),h:Math.round(e.contentRect.width<640?380:Math.max(460,Math.min(640,e.contentRect.width*0.58)))});setMeasured(true);});ro.observe(el);return()=>ro.disconnect();},[]);
 // Local metric origin: the project pin, else the first area. Fixed for the life of the canvas so panning never shifts shapes.
 const origin=useMemo<LatLng>(()=>data.pin||data.areas[0]?.ring[0]||{lat:0.0001,lng:0.0001},[data.pin,data.areas]);
 const originKey=`${origin.lat},${origin.lng}`;
 const fitPts=useCallback(():Xy[]=>{const pts:Xy[]=[];if(data.pin)pts.push(toLocal(data.pin,origin));for(const a of data.areas)if(a.status==='active')for(const p of a.ring)pts.push(toLocal(p,origin));return pts;},[data,origin]);
 const [view,setView]=useState<View|null>(null);
 const fit=useCallback(()=>{
  const pts=fitPts();if(!pts.length){setView({cx:0,cy:0,mpp:0.2});return;}
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),w=Math.max(Math.max(...xs)-Math.min(...xs),20),h=Math.max(Math.max(...ys)-Math.min(...ys),20);
  setView({cx:(Math.max(...xs)+Math.min(...xs))/2,cy:(Math.max(...ys)+Math.min(...ys))/2,mpp:clamp(Math.max(w/(size.w*0.8),h/(size.h*0.8)),0.05,50)});
 },[fitPts,size.w,size.h]);
 const fitted=useRef('');
 // Fit once the real canvas width is known (the first render uses a placeholder size).
 useEffect(()=>{if(measured&&fitted.current!==originKey){fitted.current=originKey;fit();}},[measured,originKey,fit]);
 const v=view||{cx:0,cy:0,mpp:0.2};
 const toPx=(p:LatLng)=>{const q=toLocal(p,origin);return {x:(q.x-v.cx)/v.mpp+size.w/2,y:-(q.y-v.cy)/v.mpp+size.h/2};};
 const fromPx=(x:number,y:number):LatLng=>fromLocal({x:(x-size.w/2)*v.mpp+v.cx,y:-(y-size.h/2)*v.mpp+v.cy},origin);
 const zoom=(f:number,ax=size.w/2,ay=size.h/2)=>setView(c=>{const s=c||v,mpp=clamp(s.mpp/f,0.05,50),k=s.mpp-mpp;return {mpp,cx:s.cx+(ax-size.w/2)*k,cy:s.cy-(ay-size.h/2)*k};});

 // ---- pointer handling (mouse, pen and touch share one path; two touches pinch)
 const svg=useRef<SVGSVGElement>(null);
 const ptrs=useRef(new Map<number,{x:number;y:number}>());
 const gesture=useRef<{kind:'none'|'pan'|'vertex'|'pinch';moved:boolean;start:{x:number;y:number};view:View;vertex?:number;target?:string|null;dist?:number;mid?:{x:number;y:number};hit?:string|null}>({kind:'none',moved:false,start:{x:0,y:0},view:v});
 const local=(e:{clientX:number;clientY:number})=>{const r=svg.current!.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 const editing=Boolean(edit),drawing=Boolean(edit?.drawing);
 const onDown=(e:React.PointerEvent)=>{
  const p=local(e);ptrs.current.set(e.pointerId,p);
  try{svg.current!.setPointerCapture(e.pointerId);}catch{/* synthetic pointers */}
  const g=gesture.current;
  if(ptrs.current.size===2){const [a,b]=[...ptrs.current.values()];g.kind='pinch';g.dist=Math.hypot(a.x-b.x,a.y-b.y);g.mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};g.view=v;g.moved=true;return;}
  const t=(e.target as Element).closest('[data-vertex],[data-mid],[data-area]') as HTMLElement|null;
  g.start=p;g.view=v;g.moved=false;g.hit=t?.dataset.area??null;g.target=null;
  if(edit&&t?.dataset.vertex!==undefined&&!drawing){g.kind='vertex';g.vertex=Number(t.dataset.vertex);}
  else if(edit&&t?.dataset.vertex!==undefined&&drawing){g.kind='vertex';g.vertex=Number(t.dataset.vertex);}
  else if(edit&&t?.dataset.mid!==undefined&&!drawing){g.kind='none';g.target='mid:'+t.dataset.mid;}
  else g.kind='pan';
 };
 const onMove=(e:React.PointerEvent)=>{
  if(!ptrs.current.has(e.pointerId))return;
  const p=local(e);ptrs.current.set(e.pointerId,p);const g=gesture.current;
  if(g.kind==='pinch'&&ptrs.current.size>=2){const [a,b]=[...ptrs.current.values()],d=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(g.dist&&g.mid){const mpp=clamp(g.view.mpp*g.dist/Math.max(d,1),0.05,50);setView({mpp,cx:g.view.cx-(mid.x-g.mid.x)*mpp+(g.mid.x-size.w/2)*(g.view.mpp-mpp),cy:g.view.cy+(mid.y-g.mid.y)*mpp-(g.mid.y-size.h/2)*(g.view.mpp-mpp)});}return;}
  const dx=p.x-g.start.x,dy=p.y-g.start.y;
  if(!g.moved&&Math.hypot(dx,dy)>(e.pointerType==='touch'?10:5))g.moved=true;
  if(!g.moved)return;
  if(g.kind==='pan')setView({...g.view,cx:g.view.cx-dx*g.view.mpp,cy:g.view.cy+dy*g.view.mpp});
  else if(g.kind==='vertex'&&edit&&g.vertex!=null){const next=edit.ring.map((q,i)=>i===g.vertex?fromPx(p.x,p.y):q);setRing(next,g.vertex);}
 };
 const onUp=(e:React.PointerEvent)=>{
  const g=gesture.current,p=local(e);
  const had=ptrs.current.delete(e.pointerId);
  if(!had)return;
  if(g.kind==='pinch'){if(ptrs.current.size<2){g.kind='none';}return;}
  if(!g.moved){// a tap / click
   if(edit&&g.kind==='vertex'&&g.vertex!=null){if(drawing&&g.vertex===0&&edit.ring.length>=3)onFinish();else setRing(edit.ring,edit.sel===g.vertex?null:g.vertex);}
   else if(edit&&g.target?.startsWith('mid:')){const i=Number(g.target.slice(4)),a=edit.ring[i],b=edit.ring[(i+1)%edit.ring.length];if(edit.ring.length<WORK_AREA_LIMITS.maxVertices){const next=[...edit.ring];next.splice(i+1,0,{lat:(a.lat+b.lat)/2,lng:(a.lng+b.lng)/2});setRing(next,i+1);}}
   else if(edit&&drawing){if(edit.ring.length<WORK_AREA_LIMITS.maxVertices)setRing([...edit.ring,fromPx(p.x,p.y)],edit.ring.length);}
   else if(!edit)onSelect(g.hit&&g.hit!==selected?g.hit:g.hit?selected:null);
   else if(edit&&!drawing)setRing(edit.ring,null);
  }
  g.kind='none';
 };
 const onCancel=(e:React.PointerEvent)=>{ptrs.current.delete(e.pointerId);gesture.current.kind='none';};
 // Wheel zoom must be a non-passive native listener.
 useEffect(()=>{const el=svg.current;if(!el)return;const h=(e:WheelEvent)=>{e.preventDefault();const r=el.getBoundingClientRect();zoom(e.deltaY<0?1.25:0.8,e.clientX-r.left,e.clientY-r.top);};el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);});
 const onKey=(e:React.KeyboardEvent,i:number)=>{
  if(!edit)return;
  const step=(e.shiftKey?5:1)/111195;const d:Record<string,[number,number]>={ArrowUp:[step,0],ArrowDown:[-step,0],ArrowLeft:[0,-step],ArrowRight:[0,step]};
  if(d[e.key]){e.preventDefault();setRing(edit.ring.map((q,k)=>k===i?{lat:q.lat+d[e.key][0],lng:q.lng+d[e.key][1]/Math.cos(q.lat*Math.PI/180)}:q),i);}
  else if((e.key==='Delete'||e.key==='Backspace')&&edit.ring.length>WORK_AREA_LIMITS.minVertices){e.preventDefault();setRing(edit.ring.filter((_,k)=>k!==i));}
 };

 // ---- drawing
 const step=niceStep(v.mpp*90),gx0=Math.floor(((v.cx-size.w/2*v.mpp)/step))*step,gy0=Math.floor(((v.cy-size.h/2*v.mpp)/step))*step;
 const lines:React.ReactNode[]=[];
 for(let x=gx0;x<=v.cx+size.w/2*v.mpp;x+=step){const px=(x-v.cx)/v.mpp+size.w/2;lines.push(<line key={'x'+x} x1={px} x2={px} y1={0} y2={size.h} stroke="#e0dcd1" strokeWidth={1}/>);}
 for(let y=gy0;y<=v.cy+size.h/2*v.mpp;y+=step){const py=-(y-v.cy)/v.mpp+size.h/2;lines.push(<line key={'y'+y} x1={0} x2={size.w} y1={py} y2={py} stroke="#e0dcd1" strokeWidth={1}/>);}
 const pts=(ring:LatLng[])=>ring.map(p=>{const q=toPx(p);return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join(' ');
 const shown=data.areas.filter(a=>(a.status==='active'||showArchived)&&a.id!==edit?.id);
 const pinPx=data.pin?toPx(data.pin):null;
 const barM=niceStep(v.mpp*100),barPx=barM/v.mpp;
 const ring=edit?.ring||[];
 const ringPx=ring.map(toPx);
 // Touch targets are 48 px wide, but shrink where neighbouring points are close so a thin shape never steals a tap from the next point.
 const hitR=(i:number)=>{let nn=Infinity;ringPx.forEach((o,k)=>{if(k!==i)nn=Math.min(nn,Math.hypot(o.x-ringPx[i].x,o.y-ringPx[i].y));});return clamp(nn/2-1,9,24);};
 const INK='#242424',GRAPH='#2d2f31',PAPER='#f7f5f0';
 const col=GRAPH;
 // Selected area: a boxed label with its number and name and a leader to the shape (as in the reference); other areas carry a small numbered mark.
 const mark=(a:WorkAreaView)=>String(data.areas.indexOf(a)+1).padStart(2,'0');
 const shortName=(n:string)=>n.replace(/^DEMO\s*[–-]\s*/i,'');
 const fitName=(n:string,max:number)=>n.length>max?n.slice(0,max-1)+'…':n;
 const selArea=shown.find(a=>a.id===selected)||null;
 return <div ref={box} className="relative w-full overflow-hidden border border-[var(--gs-line-strong)] bg-[#f7f5f0]" data-testid="map-canvas">
  <svg ref={svg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="application" aria-label={editing?(drawing?'Work map. Tap to add points.':'Work map. Drag points to reshape.'):'Work map showing project work areas and stages'}
   style={{touchAction:editing?'none':'pan-y',cursor:drawing?'crosshair':'grab',display:'block',userSelect:'none'}}
   onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
   <PatternDefs/>
   <rect width={size.w} height={size.h} fill={PAPER}/>
   {lines}
   {shown.map(a=>{const arch=a.status==='archived',sel=a.id===selected,cen=toPx(centroid(a.ring));
    return <g key={a.id} data-area={arch?undefined:a.id} data-testid={`area-shape`} data-name={a.name} opacity={editing&&!sel?0.4:1}>
     {sel&&<polygon points={pts(a.ring)} fill="none" stroke="#f7f5f0" strokeWidth={7} strokeLinejoin="round" pointerEvents="none"/>}
     <polygon points={pts(a.ring)} fill={arch?'#ece9e0':fillFor(a.discipline)} fillOpacity={arch?0.6:1} stroke={sel?INK:GRAPH} strokeWidth={sel?3:1.5} strokeLinejoin="round" strokeDasharray={arch?'6 4':undefined} data-area={arch?undefined:a.id} style={{cursor:arch?'default':'pointer'}}/>
     {!sel&&!arch&&<g pointerEvents="none"><circle cx={cen.x} cy={cen.y} r={9.5} fill={PAPER} stroke={GRAPH} strokeWidth={1}/><text x={cen.x} y={cen.y+0.5} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fontWeight={600} fill={INK}>{mark(a)}</text></g>}
    </g>;})}
   {selArea&&!edit&&(()=>{const cen=toPx(centroid(selArea.ring)),txt=`${mark(selArea)}  ${fitName(shortName(selArea.name),Math.max(10,Math.floor(size.w/16)))}`,w=Math.min(size.w-16,txt.length*6.9+22),x=clamp(cen.x-w/2,8,size.w-w-8),y=clamp(cen.y-46,8,size.h-60);
    return <g pointerEvents="none" data-testid="area-label"><line x1={x+w/2} y1={y+26} x2={cen.x} y2={cen.y} stroke={INK} strokeWidth={1}/><circle cx={cen.x} cy={cen.y} r={3.5} fill={INK} stroke={PAPER} strokeWidth={1.5}/><rect x={x} y={y} width={w} height={26} fill={PAPER} stroke={INK} strokeWidth={1}/><text x={x+11} y={y+17} fontSize={12.5} fontWeight={600} fill={INK}>{txt}</text></g>;})()}
   {edit&&ring.length>0&&<g data-testid="draft-shape">
    {ring.length>=3&&<polygon points={pts(ring)} fill={fillFor(edit.form.discipline)} fillOpacity={0.85} stroke={col} strokeWidth={3} strokeLinejoin="round"/>}
    {ring.length<3&&<polyline points={pts(ring)} fill="none" stroke={col} strokeWidth={3}/>}
    {!drawing&&ringPx.map((a,i)=>{const b=ringPx[(i+1)%ringPx.length];return <g key={'m'+i} data-mid={i}><circle cx={(a.x+b.x)/2} cy={(a.y+b.y)/2} r={22} fill="transparent" data-mid={i}/><rect x={(a.x+b.x)/2-4} y={(a.y+b.y)/2-4} width={8} height={8} fill={PAPER} stroke={col} strokeWidth={1.5} pointerEvents="none"/></g>;})}
    {ringPx.map((q,i)=><g key={'v'+i} data-vertex={i} tabIndex={0} role="button" aria-label={`Point ${i+1} of ${ring.length}${drawing&&i===0&&ring.length>=3?'. Tap to finish the shape':''}`} onKeyDown={e=>onKey(e,i)} data-testid="vertex" style={{cursor:'move',outline:'none'}}>
     <circle cx={q.x} cy={q.y} r={hitR(i)} fill="transparent" data-vertex={i}/>
     {edit.sel===i&&<circle cx={q.x} cy={q.y} r={13} fill="none" stroke={INK} strokeWidth={1.5} pointerEvents="none"/>}
     <circle cx={q.x} cy={q.y} r={edit.sel===i?8:7} fill={edit.sel===i||i===0?INK:PAPER} stroke={col} strokeWidth={2.5} data-vertex={i} pointerEvents="none"/>
    </g>)}
   </g>}
   {confirmed&&(()=>{const q=toPx(confirmed);return <g pointerEvents="none" data-testid="confirmed-point"><circle cx={q.x} cy={q.y} r={10} fill="none" stroke="#7a4a00" strokeWidth={2} strokeDasharray="4 3"/><text x={q.x+13} y={q.y+15} fontSize={11} fontWeight={600} fill="#7a4a00" stroke={PAPER} strokeWidth={3} paintOrder="stroke">Confirmed work point (review)</text></g>;})()}
   {pinPx&&<g pointerEvents="none" data-testid="project-pin"><circle cx={pinPx.x} cy={pinPx.y} r={9} fill="none" stroke={INK} strokeWidth={1}/><path d={`M${pinPx.x-5},${pinPx.y} h10 M${pinPx.x},${pinPx.y-5} v10`} stroke={INK} strokeWidth={1.4}/><text x={pinPx.x+13} y={pinPx.y-9} fontSize={11} fill={INK} stroke={PAPER} strokeWidth={3} paintOrder="stroke">Project pin</text></g>}
   <g pointerEvents="none">
    <path d={`M12,${size.h-16} v-5 M12,${size.h-18.5} H${12+barPx} M${12+barPx},${size.h-16} v-5`} stroke={INK} strokeWidth={1.5} fill="none"/><text x={12} y={size.h-26} fontSize={11} fill={INK} stroke={PAPER} strokeWidth={3} paintOrder="stroke">{fmtLen(barM)}</text>
    <text x={size.w-24} y={26} fontSize={12} fontWeight={600} fill={INK} textAnchor="middle">N</text><path d={`M${size.w-24},32 l-6,15 l6,-4 l6,4 z`} fill={INK}/></g>
  </svg>
  <div className="absolute bottom-10 right-3 flex flex-col border border-[var(--gs-line-strong)] bg-[var(--gs-ivory)]">
   <button type="button" aria-label="Zoom in" onClick={()=>zoom(1.4)} className="grid size-11 place-items-center border-b border-[var(--gs-line)] hover:bg-[var(--gs-fog)]" data-testid="zoom-in"><Plus aria-hidden className="size-5" strokeWidth={1.6}/></button>
   <button type="button" aria-label="Zoom out" onClick={()=>zoom(1/1.4)} className="grid size-11 place-items-center border-b border-[var(--gs-line)] hover:bg-[var(--gs-fog)]" data-testid="zoom-out"><Minus aria-hidden className="size-5" strokeWidth={1.6}/></button>
   <button type="button" aria-label="Fit to work areas" onClick={fit} className="grid size-11 place-items-center hover:bg-[var(--gs-fog)]" data-testid="zoom-fit"><Maximize2 aria-hidden className="size-5" strokeWidth={1.6}/></button>
  </div>
  <p className="flex items-center gap-1.5 border-t border-[var(--gs-line)] bg-[var(--gs-ivory)] px-3 py-1.5 text-xs text-slate-500" data-testid="basemap-status"><Crosshair aria-hidden className="size-3.5"/>Plain grid (no aerial imagery). Grid squares {fmtLen(step)}.</p>
 </div>;
}
function centroid(ring:LatLng[]):LatLng{const r=validateRing(ring);if(r.ok)return r.centroid;const n=ring.length||1;return {lat:ring.reduce((s,p)=>s+p.lat,0)/n,lng:ring.reduce((s,p)=>s+p.lng,0)/n};}
