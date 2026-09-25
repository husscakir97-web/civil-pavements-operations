'use client';
// Typed resource registers: workers with competencies, plant with compliance,
// and legacy migration issues. Rates are only shown to commercial roles.
import {useState,type FormEvent,type ReactNode} from 'react';
import {api,useApi,useAction,useSession,PageHeader,Section,EmptyState,ErrorState,Loading,Pill,Tabs,Field,Btn,field,money,dateText} from './kit';
import {usePeople} from './register-view';

type Competency={id:string;competency_type:string;reference:string|null;issued_date:string|null;expiry_date:string|null;state:string;source:string};
type Worker={id:string;name:string;status:string;first_name:string|null;last_name:string|null;employee_number:string|null;email:string|null;phone:string|null;role_title:string|null;employment_type:string|null;user_id:string|null;hourly_rate?:number|null;location:string|null;active:boolean;revision:number;competencies:Competency[]};
type Plant={id:string;name:string;status:string;plant_number:string|null;registration:string|null;category:string|null;description:string|null;make:string|null;model:string|null;ownership:string|null;hourly_rate?:number|null;day_rate?:number|null;compliance_expiry:string|null;complianceState:string;location:string|null;active:boolean;revision:number};
type Issue={id:string;entity_type:string;entity_id:string;entity_name:string|null;field:string;issue:string;legacy_value:string|null;created_at:string};
export type ResourceTab='workers'|'plant'|'issues'|'other';

const WORKER_STATUSES=['Active','Leave','Inactive'],PLANT_STATUSES=['Available','Allocated','Maintenance','Out of service','Unavailable','Inactive'],EMPLOYMENT=['employee','casual','contractor','labour hire'];
const expiryTone=(s:string)=>s==='expired'?'danger':s==='expiring'?'warning':s==='current'?'success':'neutral';
const expiryLabel=(s:string,d:string|null)=>s==='expired'?`Expired ${dateText(d)}`:s==='expiring'?`Expires ${dateText(d)}`:s==='current'?`Valid to ${dateText(d)}`:'No expiry recorded';

export function ResourcesArea({initial='workers',other}:{initial?:ResourceTab;other?:ReactNode}){
 const [tab,setTab]=useState<ResourceTab>(initial);
 const issues=useApi<{issues:Issue[]}>('/api/operations/resources?kind=issues');
 const open=issues.data?.issues.length||0;
 return <div className="mx-auto max-w-7xl p-4 sm:p-6">
  <PageHeader title="Resources" subtitle="Workers, competencies and plant used by the scheduler's conflict checks."/>
  <Tabs label="Resource registers" active={tab} onChange={setTab} tabs={[{key:'workers',label:'Workers'},{key:'plant',label:'Plant & equipment'},{key:'other',label:'Crews, suppliers & subcontractors',hidden:!other},{key:'issues',label:'Migration issues',badge:open?<Pill tone="warning">{open}</Pill>:undefined}]}/>
  {tab==='workers'&&<Workers/>}
  {tab==='plant'&&<PlantList/>}
  {tab==='other'&&other}
  {tab==='issues'&&<Issues state={issues}/>}
 </div>;
}

function Workers(){
 const s=useSession(),{data,error,loading,refresh}=useApi<{workers:Worker[]}>('/api/operations/resources?kind=workers');
 const [editing,setEditing]=useState<Worker|'new'|null>(null),[filter,setFilter]=useState('');
 const canEdit=s.can('resources.edit'),rates=s.can('commercial.view');
 if(loading&&!data)return <Loading/>;
 if(error&&!data)return <ErrorState error={error} onRetry={refresh}/>;
 const list=(data?.workers||[]).filter(w=>!filter||`${w.name} ${w.role_title||''} ${w.competencies.map(c=>c.competency_type).join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
 return <Section title="Workers" description="Required competencies on a shift are checked against these records before it can be planned." actions={canEdit&&<Btn onClick={()=>setEditing('new')}>Add worker</Btn>}>
  {editing&&<WorkerForm worker={editing==='new'?null:editing} rates={rates} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);refresh();}}/>}
  <label className="mb-3 block max-w-sm text-sm"><span className="sr-only">Filter workers</span><input className={field} placeholder="Filter by name, role or competency" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
  {!list.length?<EmptyState title={filter?'No workers match this filter':'No workers yet'} detail={filter?undefined:'Add the people you schedule so competencies and double-booking can be checked.'}/>:
  <ul className="divide-y rounded-lg border">{list.map(w=><li key={w.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
   <div className="min-w-0"><p className="font-medium">{w.name} <span className="text-sm font-normal text-slate-500">{w.role_title||''}</span></p>
    <p className="text-xs text-slate-500">{[w.employee_number,w.employment_type,w.location,w.phone].filter(Boolean).join(' · ')||'No details recorded'}{rates&&w.hourly_rate!=null?` · ${money(w.hourly_rate,true)}/h`:''}</p>
    <div className="mt-2 flex flex-wrap gap-1.5">{w.competencies.length?w.competencies.map(c=><Pill key={c.id} tone={expiryTone(c.state)}>{c.competency_type}: {expiryLabel(c.state,c.expiry_date)}</Pill>):<Pill tone="warning">No competencies recorded</Pill>}</div>
    <CompetencyEditor worker={w} canEdit={canEdit} onChanged={refresh}/>
   </div>
   <div className="flex items-start gap-2"><Pill tone={!w.active?'danger':w.status==='Leave'?'warning':'success'}>{w.status}</Pill>{canEdit&&<Btn variant="secondary" onClick={()=>setEditing(w)} aria-label={`Edit ${w.name}`}>Edit</Btn>}</div>
  </li>)}</ul>}
 </Section>;
}

function WorkerForm({worker,rates,onClose,onSaved}:{worker:Worker|null;rates:boolean;onClose:()=>void;onSaved:()=>void}){
 const people=usePeople();
 const [f,setF]=useState<Record<string,string>>({userId:worker?.user_id||'',firstName:worker?.first_name||worker?.name||'',lastName:worker?.last_name||'',employeeNumber:worker?.employee_number||'',email:worker?.email||'',phone:worker?.phone||'',roleTitle:worker?.role_title||'',employmentType:worker?.employment_type||'',location:worker?.location||'',hourlyRate:worker?.hourly_rate==null?'':String(worker.hourly_rate),status:worker?.status&&WORKER_STATUSES.includes(worker.status)?worker.status:'Active'});
 const {busy,error,run}=useAction(),set=(k:string)=>(e:{target:{value:string}})=>setF(v=>({...v,[k]:e.target.value}));
 const submit=(e:FormEvent)=>{e.preventDefault();const payload:Record<string,string>={...f};if(!rates)delete payload.hourlyRate;void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'saveWorker',id:worker?.id||null,revision:worker?.revision??null,worker:payload}}),onSaved);};
 return <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border bg-slate-50 p-4 sm:grid-cols-3" aria-label={worker?`Edit ${worker.name}`:'New worker'}>
  <Field label="First name" required><input className={field} required value={f.firstName} onChange={set('firstName')}/></Field>
  <Field label="Last name"><input className={field} value={f.lastName} onChange={set('lastName')}/></Field>
  <Field label="Employee number"><input className={field} value={f.employeeNumber} onChange={set('employeeNumber')}/></Field>
  <Field label="Role / trade"><input className={field} value={f.roleTitle} onChange={set('roleTitle')}/></Field>
  <Field label="Employment type"><select className={field} value={f.employmentType} onChange={set('employmentType')}><option value="">Not set</option>{EMPLOYMENT.map(o=><option key={o}>{o}</option>)}</select></Field>
  <Field label="Status"><select className={field} value={f.status} onChange={set('status')}>{WORKER_STATUSES.map(o=><option key={o}>{o}</option>)}</select></Field>
  <Field label="Email"><input className={field} type="email" value={f.email} onChange={set('email')}/></Field>
  <Field label="Phone"><input className={field} value={f.phone} onChange={set('phone')}/></Field>
  <Field label="Base / location"><input className={field} value={f.location} onChange={set('location')}/></Field>
  <Field label="App user" hint="Links the worker to a member so their shifts appear in Field Today."><select className={field} value={f.userId} onChange={set('userId')}><option value="">Not linked</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
  {rates&&<Field label="Hourly rate (AUD)"><input className={field} type="number" min={0} step="0.01" value={f.hourlyRate} onChange={set('hourlyRate')}/></Field>}
  {error&&<p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p>}
  <div className="flex gap-2 sm:col-span-3"><Btn type="submit" busy={busy}>{worker?'Save worker':'Add worker'}</Btn><Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn></div>
 </form>;
}

function CompetencyEditor({worker,canEdit,onChanged}:{worker:Worker;canEdit:boolean;onChanged:()=>void}){
 const [open,setOpen]=useState(false),[f,setF]=useState({competencyType:'',reference:'',issuedDate:'',expiryDate:''});
 const {busy,error,run}=useAction();
 if(!canEdit)return null;
 const revoke=(c:Competency)=>{const reason=window.prompt(`Why is ${c.competency_type} being revoked?`);if(reason)void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'revokeCompetency',workerId:worker.id,id:c.id,reason}}),onChanged);};
 return <div className="mt-2">
  {!open?<Btn variant="ghost" className="px-2 text-xs" onClick={()=>setOpen(true)}>Manage competencies</Btn>:
  <div className="mt-2 rounded-lg border bg-white p-3">
   {worker.competencies.length>0&&<ul className="mb-3 grid gap-1 text-sm">{worker.competencies.map(c=><li key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span>{c.competency_type}{c.reference?` · ${c.reference}`:''} · {expiryLabel(c.state,c.expiry_date)}{c.source==='legacy'?' · migrated':''}</span><span className="flex gap-1"><Btn variant="ghost" className="px-2 text-xs" onClick={()=>setF({competencyType:c.competency_type,reference:c.reference||'',issuedDate:c.issued_date||'',expiryDate:c.expiry_date||''})}>Edit</Btn><Btn variant="ghost" className="px-2 text-xs text-red-700" onClick={()=>revoke(c)}>Revoke</Btn></span></li>)}</ul>}
   <form className="grid gap-2 sm:grid-cols-5" onSubmit={e=>{e.preventDefault();const existing=worker.competencies.find(c=>c.competency_type.toLowerCase()===f.competencyType.trim().toLowerCase());void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'saveCompetency',workerId:worker.id,id:existing?.id||null,competency:f}}),()=>{setF({competencyType:'',reference:'',issuedDate:'',expiryDate:''});onChanged();});}}>
    <Field label="Competency / licence" required><input className={field} required value={f.competencyType} onChange={e=>setF({...f,competencyType:e.target.value})}/></Field>
    <Field label="Card / licence no."><input className={field} value={f.reference} onChange={e=>setF({...f,reference:e.target.value})}/></Field>
    <Field label="Issued"><input className={field} type="date" value={f.issuedDate} onChange={e=>setF({...f,issuedDate:e.target.value})}/></Field>
    <Field label="Expires"><input className={field} type="date" value={f.expiryDate} onChange={e=>setF({...f,expiryDate:e.target.value})}/></Field>
    <div className="flex items-end gap-2"><Btn type="submit" busy={busy}>Save</Btn><Btn type="button" variant="ghost" onClick={()=>setOpen(false)}>Close</Btn></div>
   </form>
   {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>}
 </div>;
}

function PlantList(){
 const s=useSession(),{data,error,loading,refresh}=useApi<{plant:Plant[]}>('/api/operations/resources?kind=plant');
 const [editing,setEditing]=useState<Plant|'new'|null>(null);
 const canEdit=s.can('resources.edit'),rates=s.can('commercial.view');
 if(loading&&!data)return <Loading/>;
 if(error&&!data)return <ErrorState error={error} onRetry={refresh}/>;
 const list=data?.plant||[];
 return <Section title="Plant & equipment" description="Plant with expired registration or compliance cannot be planned onto a shift." actions={canEdit&&<Btn onClick={()=>setEditing('new')}>Add plant</Btn>}>
  {editing&&<PlantForm plant={editing==='new'?null:editing} rates={rates} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);refresh();}}/>}
  {!list.length?<EmptyState title="No plant yet" detail="Add plant and equipment so the scheduler can check availability and compliance."/>:
  <ul className="divide-y rounded-lg border">{list.map(p=><li key={p.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
   <div className="min-w-0"><p className="font-medium">{p.name} <span className="text-sm font-normal text-slate-500">{[p.category,p.plant_number,p.registration].filter(Boolean).join(' · ')}</span></p>
    <p className="text-xs text-slate-500">{[p.make,p.model,p.ownership,p.location].filter(Boolean).join(' · ')||'No details recorded'}{rates&&p.hourly_rate!=null?` · ${money(p.hourly_rate,true)}/h`:''}{rates&&p.day_rate!=null?` · ${money(p.day_rate,true)}/day`:''}</p>
    <div className="mt-2"><Pill tone={expiryTone(p.complianceState)}>Compliance: {expiryLabel(p.complianceState,p.compliance_expiry)}</Pill></div></div>
   <div className="flex items-start gap-2"><Pill tone={!p.active?'danger':['Maintenance','Out of service','Unavailable'].includes(p.status)?'warning':'success'}>{p.status}</Pill>{canEdit&&<Btn variant="secondary" onClick={()=>setEditing(p)} aria-label={`Edit ${p.name}`}>Edit</Btn>}</div>
  </li>)}</ul>}
 </Section>;
}

function PlantForm({plant,rates,onClose,onSaved}:{plant:Plant|null;rates:boolean;onClose:()=>void;onSaved:()=>void}){
 const [f,setF]=useState<Record<string,string>>({name:plant?.name||'',plantNumber:plant?.plant_number||'',registration:plant?.registration||'',category:plant?.category||'',description:plant?.description||'',make:plant?.make||'',model:plant?.model||'',ownership:plant?.ownership||'',hourlyRate:plant?.hourly_rate==null?'':String(plant.hourly_rate),dayRate:plant?.day_rate==null?'':String(plant.day_rate),complianceExpiry:plant?.compliance_expiry||'',location:plant?.location||'',status:plant?.status&&PLANT_STATUSES.includes(plant.status)?plant.status:'Available'});
 const {busy,error,run}=useAction(),set=(k:string)=>(e:{target:{value:string}})=>setF(v=>({...v,[k]:e.target.value}));
 const submit=(e:FormEvent)=>{e.preventDefault();const payload:Record<string,string>={...f};if(!rates){delete payload.hourlyRate;delete payload.dayRate;}void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'savePlant',id:plant?.id||null,revision:plant?.revision??null,plant:payload}}),onSaved);};
 return <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border bg-slate-50 p-4 sm:grid-cols-3" aria-label={plant?`Edit ${plant.name}`:'New plant item'}>
  <Field label="Name" required><input className={field} required value={f.name} onChange={set('name')}/></Field>
  <Field label="Plant number"><input className={field} value={f.plantNumber} onChange={set('plantNumber')}/></Field>
  <Field label="Registration"><input className={field} value={f.registration} onChange={set('registration')}/></Field>
  <Field label="Category"><input className={field} placeholder="Paver, roller, truck, TMA…" value={f.category} onChange={set('category')}/></Field>
  <Field label="Make"><input className={field} value={f.make} onChange={set('make')}/></Field>
  <Field label="Model"><input className={field} value={f.model} onChange={set('model')}/></Field>
  <Field label="Ownership"><select className={field} value={f.ownership} onChange={set('ownership')}><option value="">Not set</option><option>owned</option><option>hired</option><option>leased</option></select></Field>
  <Field label="Registration / compliance expiry"><input className={field} type="date" value={f.complianceExpiry} onChange={set('complianceExpiry')}/></Field>
  <Field label="Status"><select className={field} value={f.status} onChange={set('status')}>{PLANT_STATUSES.map(o=><option key={o}>{o}</option>)}</select></Field>
  <Field label="Location"><input className={field} value={f.location} onChange={set('location')}/></Field>
  {rates&&<Field label="Hourly rate (AUD)"><input className={field} type="number" min={0} step="0.01" value={f.hourlyRate} onChange={set('hourlyRate')}/></Field>}
  {rates&&<Field label="Day rate (AUD)"><input className={field} type="number" min={0} step="0.01" value={f.dayRate} onChange={set('dayRate')}/></Field>}
  <Field label="Description"><input className={field} value={f.description} onChange={set('description')}/></Field>
  {error&&<p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p>}
  <div className="flex gap-2 sm:col-span-3"><Btn type="submit" busy={busy}>{plant?'Save plant':'Add plant'}</Btn><Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn></div>
 </form>;
}

function Issues({state}:{state:ReturnType<typeof useApi<{issues:Issue[]}>>}){
 const s=useSession(),{busy,error,run}=useAction();
 const {data,error:loadError,loading,refresh}=state;
 if(loading&&!data)return <Loading/>;
 if(loadError&&!data)return <ErrorState error={loadError} onRetry={refresh}/>;
 const list=data?.issues||[];
 return <Section title="Migration issues" description="Legacy values that could not be converted to typed fields were left blank rather than guessed. Correct the record, then mark the issue resolved. The original legacy value is kept.">
  {error&&<p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
  {!list.length?<EmptyState title="No open migration issues" detail="Every legacy worker, plant item and shift converted cleanly, or its issues have been resolved."/>:
  <ul className="divide-y rounded-lg border">{list.map(i=><li key={i.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
   <div className="min-w-0"><p className="font-medium">{i.entity_name||i.entity_id} <span className="font-normal text-slate-500">· {i.entity_type} · {i.field}</span></p><p>{i.issue}</p>{i.legacy_value&&<p className="break-all text-xs text-slate-500">Legacy value: {i.legacy_value.slice(0,300)}</p>}</div>
   {s.can('resources.edit')&&<Btn variant="secondary" busy={busy} onClick={()=>void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'resolveIssue',id:i.id,note:''}}),refresh)}>Mark resolved</Btn>}
  </li>)}</ul>}
 </Section>;
}
