'use client';
// Typed resource registers: workers with competencies, plant with compliance,
// and legacy migration issues. Rates are only shown to commercial roles.
import {useState,type FormEvent,type ReactNode} from 'react';
import {AlertTriangle,CheckCircle2,Download,FileSpreadsheet,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetDescription,SheetTitle} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,PageHeader,Section,EmptyState,ErrorState,Loading,Pill,Tabs,Field,Btn,field,money,dateText,ReasonDialog} from './kit';
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

type ImportKind='workers'|'plant';
type ImportPreview={fileName:string;availableFields:Array<{key:string;label:string}>;unmappedHeaders:string[];summary:{total:number;create:number;update:number;skip:number;error:number};rows:Array<{rowNumber:number;label:string;action:'create'|'update'|'skip'|'error';matchLabel:string|null;errors:string[];warnings:string[]}>};
type ImportResult={summary:{total:number;created:number;updated:number;skipped:number;failed:number};results:Array<{rowNumber:number;label:string;status:string;error?:string}>};

function ResourceImporter({kind,onImported}:{kind:ImportKind;onImported:()=>void}){
 const [open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<ImportPreview|null>(null),[result,setResult]=useState<ImportResult|null>(null),[updateExisting,setUpdateExisting]=useState(true),[mapping,setMapping]=useState<Record<string,string>>({}),[mappingDirty,setMappingDirty]=useState(false);
 const {busy,error,run}=useAction(),label=kind==='workers'?'employees':'fleet & plant';
 const send=(mode:'preview'|'apply')=>{if(!file)return Promise.reject(new Error('Choose an .xlsx or .csv spreadsheet.'));const form=new FormData();form.set('kind',kind);form.set('mode',mode);form.set('updateExisting',String(updateExisting));form.set('mapping',JSON.stringify(mapping));form.set('file',file);return api<ImportPreview|ImportResult>('/api/operations/resource-import',{method:'POST',body:form});};
 const check=()=>void run(()=>send('preview') as Promise<ImportPreview>,r=>{setPreview(r);setResult(null);setMappingDirty(false);});
 const apply=()=>void run(()=>send('apply') as Promise<ImportResult>,r=>{setResult(r);setPreview(null);onImported();});
 const issues=()=>{if(!preview)return;const rows=preview.rows.filter(r=>r.errors.length||r.warnings.length);const esc=(v:string)=>'"'+v.replaceAll('"','""')+'"';const csv=['Row,Record,Action,Issues',...rows.map(r=>[r.rowNumber,r.label,r.action,[...r.errors,...r.warnings].join(' | ')].map(v=>esc(String(v))).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`infrastruct-${kind}-import-issues.csv`;a.click();URL.revokeObjectURL(a.href);};
 const close=()=>{setOpen(false);setFile(null);setPreview(null);setResult(null);setMapping({});setMappingDirty(false);};
 return <>
  <Btn variant="secondary" onClick={()=>setOpen(true)}><Upload aria-hidden className="size-4"/>Import spreadsheet</Btn>
  <Sheet open={open} onOpenChange={o=>{if(!o)close();else setOpen(true);}}>
   <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl">
    <div className="sticky top-0 z-10 border-b bg-white px-5 py-4"><SheetTitle className="text-lg font-semibold">Bulk import {label}</SheetTitle><SheetDescription className="mt-1 text-sm text-slate-500">Use our template or upload your existing spreadsheet. Nothing changes until you confirm the preview.</SheetDescription></div>
    <div className="grid gap-4 p-4 sm:p-5">
     <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
      <a className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50" href={`/api/operations/resource-import?kind=${kind}&template=1`}><Download aria-hidden className="size-4"/>Download template</a>
      <label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">Spreadsheet</span><input type="file" accept=".xlsx,.csv" className={field} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setResult(null);setMapping({});setMappingDirty(false);}}/></label>
     </div>
     <label className="flex items-start gap-2 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700"><input type="checkbox" className="mt-0.5 size-4" checked={updateExisting} onChange={e=>{setUpdateExisting(e.target.checked);setPreview(null);setMappingDirty(false);}}/><span><strong>Update matching existing records</strong><span className="mt-0.5 block text-xs text-slate-500">{kind==='workers'?'Matches by employee number, email, then exact name.':'Matches by plant number, registration, then exact name.'} Blank cells keep the current value.</span></span></label>
     <div className="flex flex-wrap gap-2"><Btn busy={busy} disabled={!file} onClick={check}><FileSpreadsheet aria-hidden className="size-4"/>Preview import</Btn>{preview&&preview.summary.error>0&&<Btn variant="secondary" onClick={issues}>Download issues CSV</Btn>}</div>
     {error&&<ErrorState error={error}/>}
     {preview&&<div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[['Rows',preview.summary.total,'neutral'],['Create',preview.summary.create,'success'],['Update',preview.summary.update,'info'],['Skip',preview.summary.skip,'neutral'],['Errors',preview.summary.error,preview.summary.error?'danger':'success']].map(([l,v,t])=><div key={String(l)} className="rounded-xl border bg-white p-3 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{l}</p><p className={`mt-1 text-xl font-semibold ${t==='danger'?'text-red-700':t==='success'?'text-emerald-700':t==='info'?'text-sky-700':'text-slate-900'}`}>{v}</p></div>)}</div>
      {preview.unmappedHeaders.length>0&&<div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><div className="flex gap-2"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0"/><div><p className="font-semibold">Map columns we did not recognise</p><p className="mt-0.5 text-xs text-amber-800">Choose where each column belongs, or leave it ignored. Re-preview before importing.</p></div></div><div className="grid gap-2 sm:grid-cols-2">{preview.unmappedHeaders.map(source=><label key={source} className="grid gap-1"><span className="text-xs font-medium">{source}</span><select className={field} value={mapping[source]||''} onChange={e=>{setMapping(m=>({...m,[source]:e.target.value}));setMappingDirty(true);}}><option value="">Ignore this column</option>{preview.availableFields.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>)}</div>{mappingDirty&&<div><Btn variant="secondary" onClick={check}>Re-preview with mappings</Btn></div>}</div>}
      <div className="max-h-[45dvh] overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Row</th><th className="p-2">Record</th><th className="p-2">Action</th><th className="p-2">Checks</th></tr></thead><tbody className="divide-y">{preview.rows.slice(0,100).map(r=><tr key={r.rowNumber}><td className="p-2 text-slate-500">{r.rowNumber}</td><td className="p-2 font-medium">{r.label||'Unnamed'}{r.matchLabel&&<span className="block text-[10px] font-normal text-slate-500">Matches {r.matchLabel}</span>}</td><td className="p-2"><Pill tone={r.action==='error'?'danger':r.action==='create'?'success':r.action==='update'?'info':'neutral'}>{r.action}</Pill></td><td className="p-2">{r.errors.length?<span className="text-red-700">{r.errors.join(' ')}</span>:r.warnings.length?<span className="text-amber-800">{r.warnings.join(' ')}</span>:<span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5"/>Ready</span>}</td></tr>)}</tbody></table></div>
      {preview.rows.length>100&&<p className="text-xs text-slate-500">Showing the first 100 of {preview.rows.length} rows.</p>}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-white py-3"><Btn busy={busy} disabled={mappingDirty||preview.summary.create+preview.summary.update===0} onClick={apply}>{mappingDirty?'Re-preview mappings before import':`Import ${preview.summary.create+preview.summary.update} valid rows`}</Btn>{preview.summary.error>0&&<span className="text-xs text-slate-500">{preview.summary.error} invalid row{preview.summary.error===1?'':'s'} will be skipped.</span>}</div>
     </div>}
     {result&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-900">Import complete</p><p className="mt-1 text-sm text-emerald-800">{result.summary.created} created · {result.summary.updated} updated · {result.summary.skipped} skipped · {result.summary.failed} failed</p>{result.summary.failed>0&&<ul className="mt-2 text-xs text-red-700">{result.results.filter(r=>r.status==='failed').slice(0,20).map(r=><li key={r.rowNumber}>Row {r.rowNumber}: {r.label} — {r.error}</li>)}</ul>}</div>}
    </div>
   </SheetContent>
  </Sheet>
 </>;
}

function Workers(){
 const s=useSession(),{data,error,loading,refresh}=useApi<{workers:Worker[]}>('/api/operations/resources?kind=workers');
 const [editing,setEditing]=useState<Worker|'new'|null>(null),[filter,setFilter]=useState('');
 const canEdit=s.can('resources.edit'),rates=s.can('commercial.view');
 if(loading&&!data)return <Loading/>;
 if(error&&!data)return <ErrorState error={error} onRetry={refresh}/>;
 const list=(data?.workers||[]).filter(w=>!filter||`${w.name} ${w.role_title||''} ${w.competencies.map(c=>c.competency_type).join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
 return <Section title="Workers" description="Required competencies on a shift are checked against these records before it can be planned." actions={canEdit&&<div className="flex flex-wrap gap-2"><ResourceImporter kind="workers" onImported={refresh}/><Btn onClick={()=>setEditing('new')}>Add worker</Btn></div>}>
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
 const [revoking,setRevoking]=useState<Competency|null>(null);
 if(!canEdit)return null;
 const revoke=(c:Competency)=>setRevoking(c);
 const confirmRevoke=(reason:string)=>{const c=revoking!;setRevoking(null);void run(()=>api('/api/operations/resources',{method:'POST',body:{action:'revokeCompetency',workerId:worker.id,id:c.id,reason}}),onChanged);};
 return <div className="mt-2"><ReasonDialog open={Boolean(revoking)} title={`Revoke ${revoking?.competency_type||'competency'}`} description="The competency stays on the worker's record as revoked (never deleted), and scheduling treats it as not held from now on." label="Why is it being revoked?" required danger confirmLabel="Revoke competency" busy={busy} onCancel={()=>setRevoking(null)} onConfirm={confirmRevoke}/>
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
 return <Section title="Plant & equipment" description="Plant with expired registration or compliance cannot be planned onto a shift." actions={canEdit&&<div className="flex flex-wrap gap-2"><ResourceImporter kind="plant" onImported={refresh}/><Btn onClick={()=>setEditing('new')}>Add plant</Btn></div>}>
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
