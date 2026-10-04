'use client';
// Project Work map: draw, edit and archive operational work-area / stage polygons.
// The editor is provider-independent: it draws on a plain metric grid anchored to the project's location pin, so it works
// with no map provider and uses no third-party imagery. The address pin (components/v1/location.tsx) is shown but never edited here.
// An aerial basemap can be added later behind the same projection (see docs/WORK-MAP.md — licensing is unresolved).
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Archive,Crosshair,Maximize2,Minus,PenLine,Plus,Redo2,Trash2,Undo2} from 'lucide-react';
import {api,useApi,useAction,Btn,Field,field,Section,Pill,EmptyState,ErrorState,Loading} from './kit';
import {LocationSummary} from './location';
import {DELIVERY_LABEL,DISCIPLINE_COLOUR,DISCIPLINE_LABEL,KIND_LABEL,WORK_AREA_DELIVERY,WORK_AREA_DISCIPLINES,WORK_AREA_KINDS,WORK_AREA_LIMITS,fromLocal,toLocal,validateRing,type WorkAreaDelivery,type WorkAreaDiscipline,type WorkAreaKind,type WorkAreaView,type WorkMapView,type Xy} from '@/lib/v1/work-areas';
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

export function WorkMap({projectId}:{projectId:string}){
 const [showArchived,setShowArchived]=useState(false);
 const res=useApi<WorkMapView>(`/api/projects/work-areas?projectId=${encodeURIComponent(projectId)}${showArchived?'&archived=1':''}`);
 const [selected,setSelected]=useState<string|null>(null);
 const [edit,setEdit]=useState<Edit|null>(null);
 const act=useAction();
 const data=res.data;
 const [conflict,setConflict]=useState(false);

 // Guard against losing an unsaved shape on reload/close.
 useEffect(()=>{if(!edit?.dirty)return;const h=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[edit?.dirty]);

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

 return <div className="grid gap-4" data-testid="work-map">
  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="note"><strong>Operational work-area overview.</strong> Not an approved traffic management plan, survey or design. Drawn on a plain grid anchored to the project pin; no aerial imagery is used.</div>
  {data.closed&&<p role="status" className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700" data-testid="workmap-closed">This project is closed. The work map is read-only.</p>}
  {!data.closed&&!data.canEdit&&<p role="status" className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">You can view the work map. Editing needs permission to edit projects.</p>}
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
   <Section title="Work map" description={data.pin?undefined:'This project has no location pin yet. Set the project location in Setup to anchor the map.'} actions={<div className="flex flex-wrap items-center gap-2">
     {data.canEdit&&!edit&&<Btn onClick={startDraw} disabled={!canDraw} data-testid="draw-start"><PenLine aria-hidden className="size-4"/>Draw area</Btn>}
     <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="size-4" checked={showArchived} disabled={Boolean(edit)} onChange={e=>setShowArchived(e.target.checked)}/>Show archived</label></div>}>
    <Canvas data={data} edit={edit} selected={selected} onSelect={setSelected} setRing={setRing} onFinish={()=>setEdit(e=>e&&{...e,drawing:false,sel:null})} showArchived={showArchived}/>
    <Legend/>
    {data.pin&&<div className="mt-3 border-t pt-3"><LocationSummary label="Project address pin (not edited here)" location={{...EMPTY_PARTS,pin:data.pin,formattedAddress:data.address}}/></div>}
   </Section>
   <div className="grid content-start gap-4">
    {edit?<Section title={edit.id?'Edit work area':'New work area'} description={edit.drawing?'Tap the map to add points. Finish when the outline is complete.':'Drag points to reshape. Tap a mid-point to add one.'}>
     <EditPanel edit={edit} patchForm={patchForm} setRing={setRing} setEdit={setEdit} ringValid={ringValid!} busy={act.busy} error={act.error} conflict={conflict} onSave={save} onCancel={cancel} onReload={reload}/>
    </Section>:<Section title="Work areas and stages" description={`${active.length} active${data.areas.length>active.length?` · ${data.areas.length-active.length} archived`:''}`}>
     {act.error&&<p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{act.error}</p>}
     {!data.areas.length?<EmptyState title="No work areas yet." detail={data.canEdit?(data.pin?'Use Draw area to outline the first work area or stage.':'Set the project location first.'):'Nothing has been drawn for this project.'}/>:<ul className="divide-y" data-testid="area-list">{data.areas.map(a=><li key={a.id}>
      <button type="button" onClick={()=>setSelected(a.id===selected?null:a.id)} aria-pressed={a.id===selected} className={`flex min-h-11 w-full items-start gap-2 py-2 text-left text-sm ${a.id===selected?'bg-sky-50':''} ${a.status==='archived'?'opacity-60':''}`} data-testid="area-row">
       <span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm" style={{background:DISCIPLINE_COLOUR[a.discipline]}}/>
       <span className="min-w-0 flex-1"><span className="block font-medium">{a.name}</span><span className="block text-xs text-slate-500">{[KIND_LABEL[a.kind],DISCIPLINE_LABEL[a.discipline],a.delivery==='subcontracted'?`Subcontracted${a.contractorLabel?` · ${a.contractorLabel}`:''}`:null,fmtArea(a.areaM2)].filter(Boolean).join(' · ')}</span></span>
       {a.status==='archived'&&<Pill>Archived</Pill>}
      </button>
      {a.id===selected&&<div className="grid gap-2 pb-3 pl-5 text-sm" data-testid="area-detail">
       {a.sequence!=null&&<p className="text-xs text-slate-600">Sequence {a.sequence}</p>}
       {a.notes&&<p className="whitespace-pre-line text-slate-700">{a.notes}</p>}
       <p className="text-xs text-slate-500">ID <code data-testid="area-id">{a.id}</code> · revision {a.revision}</p>
       {data.canEdit&&a.status==='active'&&<div className="flex flex-wrap gap-2"><Btn variant="secondary" onClick={()=>startEdit(a)} data-testid="area-edit"><PenLine aria-hidden className="size-4"/>Edit</Btn><Btn variant="secondary" onClick={()=>archive(a)} busy={act.busy} data-testid="area-archive"><Archive aria-hidden className="size-4"/>Archive</Btn></div>}
      </div>}
     </li>)}</ul>}
    </Section>}
   </div>
  </div>
 </div>;
}

function Legend(){return <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">{WORK_AREA_DISCIPLINES.map(d=><li key={d} className="flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm" style={{background:DISCIPLINE_COLOUR[d]}}/>{DISCIPLINE_LABEL[d]}</li>)}<li className="flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm border border-dashed border-slate-500"/>Archived</li></ul>;}

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
  <p role="status" className={`text-xs ${ringValid.ok?'text-emerald-800':'text-amber-800'}`} data-testid="shape-status">{edit.ring.length<3?'Add at least 3 points.':ringValid.ok?`Shape OK · ${fmtArea(ringValid.areaM2)}`:ringValid.error}</p>
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
  {error&&<div role="alert" className="rounded-lg bg-red-50 p-2 text-red-800" data-testid="save-error">{error}{conflict&&<div className="mt-2"><Btn variant="secondary" onClick={onReload} data-testid="reload-latest">Discard my changes and reload</Btn></div>}</div>}
  <div className="sticky bottom-0 -mx-1 flex gap-2 border-t bg-white/95 px-1 py-2 backdrop-blur">
   <Btn onClick={onSave} disabled={!ok||busy} busy={busy} data-testid="save">Save</Btn>
   <Btn variant="secondary" onClick={onCancel} disabled={busy} data-testid="cancel">Cancel</Btn>
  </div>
 </div>;
}

// ---------------------------------------------------------------- canvas
function Canvas({data,edit,selected,onSelect,setRing,onFinish,showArchived}:{data:WorkMapView;edit:Edit|null;selected:string|null;onSelect:(id:string|null)=>void;setRing:(r:LatLng[],sel?:number|null)=>void;onFinish:()=>void;showArchived:boolean}){
 const box=useRef<HTMLDivElement>(null),[size,setSize]=useState({w:600,h:420}),[measured,setMeasured]=useState(false);
 useEffect(()=>{const el=box.current;if(!el)return;const ro=new ResizeObserver(([e])=>{setSize({w:Math.max(200,Math.round(e.contentRect.width)),h:Math.round(e.contentRect.width<640?340:440)});setMeasured(true);});ro.observe(el);return()=>ro.disconnect();},[]);
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
 for(let x=gx0;x<=v.cx+size.w/2*v.mpp;x+=step){const px=(x-v.cx)/v.mpp+size.w/2;lines.push(<line key={'x'+x} x1={px} x2={px} y1={0} y2={size.h} stroke="#cbd5e1" strokeWidth={1}/>);}
 for(let y=gy0;y<=v.cy+size.h/2*v.mpp;y+=step){const py=-(y-v.cy)/v.mpp+size.h/2;lines.push(<line key={'y'+y} x1={0} x2={size.w} y1={py} y2={py} stroke="#cbd5e1" strokeWidth={1}/>);}
 const pts=(ring:LatLng[])=>ring.map(p=>{const q=toPx(p);return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;}).join(' ');
 const shown=data.areas.filter(a=>(a.status==='active'||showArchived)&&a.id!==edit?.id);
 const pinPx=data.pin?toPx(data.pin):null;
 // Label only as much of the name as fits the shape on screen (about 6.5 px per character), so labels never pile up.
 const label=(a:WorkAreaView)=>{const xs=a.ring.map(p=>toPx(p).x),w=Math.max(...xs)-Math.min(...xs),max=Math.floor(w/6.5);if(max<6)return '';const n=a.name.replace(/^DEMO\s*[–-]\s*/i,'DEMO ');return n.length>max?n.slice(0,max-1)+'…':n;};
 const barM=niceStep(v.mpp*100),barPx=barM/v.mpp;
 const ring=edit?.ring||[];
 const ringPx=ring.map(toPx);
 // Touch targets are 48 px wide, but shrink where neighbouring points are close so a thin shape never steals a tap from the next point.
 const hitR=(i:number)=>{let nn=Infinity;ringPx.forEach((o,k)=>{if(k!==i)nn=Math.min(nn,Math.hypot(o.x-ringPx[i].x,o.y-ringPx[i].y));});return clamp(nn/2-1,9,24);};
 const col=edit?DISCIPLINE_COLOUR[edit.form.discipline]:'#334155';
 return <div ref={box} className="relative w-full overflow-hidden rounded-lg border bg-slate-50" data-testid="map-canvas">
  <svg ref={svg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="application" aria-label={editing?(drawing?'Work map. Tap to add points.':'Work map. Drag points to reshape.'):'Work map showing project work areas and stages'}
   style={{touchAction:editing?'none':'pan-y',cursor:drawing?'crosshair':'grab',display:'block',userSelect:'none'}}
   onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
   <rect width={size.w} height={size.h} fill="#f8fafc"/>
   {lines}
   {shown.map(a=>{const c=DISCIPLINE_COLOUR[a.discipline],arch=a.status==='archived',sel=a.id===selected,cen=toPx(centroid(a.ring));
    return <g key={a.id} data-area={arch?undefined:a.id} data-testid={`area-shape`} data-name={a.name} opacity={editing&&!sel?0.45:1}>
     <polygon points={pts(a.ring)} fill={c} fillOpacity={arch?0.05:sel?0.4:0.25} stroke={c} strokeWidth={sel?3:2} strokeDasharray={arch?'6 4':undefined} data-area={arch?undefined:a.id} style={{cursor:arch?'default':'pointer'}}/>
     {label(a)&&<text x={cen.x} y={cen.y} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#0f172a" stroke="#fff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{label(a)}</text>}
    </g>;})}
   {edit&&ring.length>0&&<g data-testid="draft-shape">
    {ring.length>=3&&<polygon points={pts(ring)} fill={col} fillOpacity={0.3} stroke={col} strokeWidth={3}/>}
    {ring.length<3&&<polyline points={pts(ring)} fill="none" stroke={col} strokeWidth={3}/>}
    {!drawing&&ringPx.map((a,i)=>{const b=ringPx[(i+1)%ringPx.length];return <g key={'m'+i} data-mid={i}><circle cx={(a.x+b.x)/2} cy={(a.y+b.y)/2} r={22} fill="transparent" data-mid={i}/><circle cx={(a.x+b.x)/2} cy={(a.y+b.y)/2} r={4.5} fill="#fff" stroke={col} strokeWidth={1.5} pointerEvents="none"/></g>;})}
    {ringPx.map((q,i)=><g key={'v'+i} data-vertex={i} tabIndex={0} role="button" aria-label={`Point ${i+1} of ${ring.length}${drawing&&i===0&&ring.length>=3?'. Tap to finish the shape':''}`} onKeyDown={e=>onKey(e,i)} data-testid="vertex" style={{cursor:'move',outline:'none'}}>
     <circle cx={q.x} cy={q.y} r={hitR(i)} fill="transparent" data-vertex={i}/>
     <circle cx={q.x} cy={q.y} r={edit.sel===i?9:7} fill={edit.sel===i?'#f59e0b':i===0?'#16a34a':'#fff'} stroke={col} strokeWidth={2.5} data-vertex={i} pointerEvents="none"/>
    </g>)}
   </g>}
   {pinPx&&<g pointerEvents="none" data-testid="project-pin"><circle cx={pinPx.x} cy={pinPx.y} r={9} fill="#dc2626" fillOpacity={0.25}/><circle cx={pinPx.x} cy={pinPx.y} r={4.5} fill="#dc2626" stroke="#fff" strokeWidth={1.5}/><text x={pinPx.x+10} y={pinPx.y-8} fontSize={11} fill="#7f1d1d" stroke="#fff" strokeWidth={3} paintOrder="stroke">Project pin</text></g>}
   <g pointerEvents="none"><line x1={12} x2={12+barPx} y1={size.h-14} y2={size.h-14} stroke="#0f172a" strokeWidth={3}/><text x={12} y={size.h-20} fontSize={11} fill="#0f172a" stroke="#fff" strokeWidth={3} paintOrder="stroke">{fmtLen(barM)}</text>
    <text x={size.w-18} y={22} fontSize={13} fontWeight={700} fill="#0f172a" textAnchor="middle" stroke="#fff" strokeWidth={3} paintOrder="stroke">N</text><path d={`M${size.w-18},28 l-5,12 l5,-3 l5,3 z`} fill="#0f172a"/></g>
  </svg>
  <div className="absolute right-2 top-10 flex flex-col gap-1">
   <button type="button" aria-label="Zoom in" onClick={()=>zoom(1.4)} className="grid size-11 place-items-center rounded-lg border bg-white shadow-sm" data-testid="zoom-in"><Plus aria-hidden className="size-5"/></button>
   <button type="button" aria-label="Zoom out" onClick={()=>zoom(1/1.4)} className="grid size-11 place-items-center rounded-lg border bg-white shadow-sm" data-testid="zoom-out"><Minus aria-hidden className="size-5"/></button>
   <button type="button" aria-label="Fit to work areas" onClick={fit} className="grid size-11 place-items-center rounded-lg border bg-white shadow-sm" data-testid="zoom-fit"><Maximize2 aria-hidden className="size-5"/></button>
  </div>
  <p className="flex items-center gap-1 border-t bg-white px-2 py-1 text-xs text-slate-500" data-testid="basemap-status"><Crosshair aria-hidden className="size-3.5"/>Plain grid (no aerial imagery). Grid squares {fmtLen(step)}.</p>
 </div>;
}
function centroid(ring:LatLng[]):LatLng{const r=validateRing(ring);if(r.ok)return r.centroid;const n=ring.length||1;return {lat:ring.reduce((s,p)=>s+p.lat,0)/n,lng:ring.reduce((s,p)=>s+p.lng,0)/n};}
