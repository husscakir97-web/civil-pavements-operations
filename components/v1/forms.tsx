'use client';
// Forms engine UI: complete published forms in a context, view evidence with its correction
// history, and (for form managers) build versioned templates. The server re-validates everything.
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,ClipboardCheck,Eye,FilePlus2,History,PenLine,Plus,Trash2,Upload} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {api,useApi,useAction,useSession,Section,EmptyState,ErrorState,Loading,Pill,Tabs,Field,Btn,field,dateText} from './kit';
import {AddressLocationPicker,LocationSummary} from './location';
import type {LocationInput,LocationView} from '@/lib/v1/location';
import {FIELD_TYPES,FIELD_TYPE_LABELS,CONDITION_OPS,CONDITION_LABELS,FORM_CATEGORIES,allFields,visibleFields,isAnswered,fieldIdFrom,emptySchema,checkSchema,type Answers,type Condition,type FieldType,type FormContext,type FormField,type FormSchema,type SignatureValue} from '@/lib/v1/forms';

type Template={id:string;name:string;description:string|null;category:string;status:string;currentVersionId:string|null;currentVersionNumber:number|null;draftVersionId:string|null;draftVersionNumber:number|null;revision:number;updatedAt:string};
type Version={id:string;versionNumber:number;status:string;changeReason:string|null;publishedAt:string|null;revision:number;schema?:FormSchema};
type TemplateList={canManage:boolean;canPublish:boolean;canSubmit:boolean;templates:Template[]};
type TemplateDetail={template:Template;versions:Version[];current:Version|null;draft:Version|null;canManage:boolean;canPublish:boolean};
type SubmissionRow={id:string;templateName:string;versionNumber:number;contextType:string;contextId:string;projectName:string|null;submittedByName:string|null;submittedAt:string;amendments:number};
type Labels={people:Record<string,string>;assets:Record<string,string>;documents:Record<string,{title:string;contentType:string;url:string}>;locations:Record<string,LocationView>};
type SubmissionDetail={submission:{id:string;templateName:string;versionNumber:number;contextType:string;contextId:string;contextLabel:string;projectId:string|null;submittedByName:string|null;submittedAt:string};schema:FormSchema;original:Answers;effective:Answers;amendments:Array<{id:string;sequence:number;reason:string;amendedByName:string|null;amendedAt:string;changedFields:string[];responses:Answers}>;labels:Labels;canAmend:boolean};
export type FormsContext={type:FormContext;id:string;label:string;projectId?:string|null};
type EvidenceContext={type:string;id:string};
const CONTEXT_LABEL:Record<string,string>={organisation:'Company',project:'Project',shift:'Shift',asset:'Plant'};

// ---------------------------------------------------------------- IMS area
export function FormsArea(){
 const session=useSession();
 const [tab,setTab]=useState<'complete'|'submissions'|'templates'>('complete');
 const company:FormsContext={type:'organisation',id:'current',label:'Company'};
 return <div className="grid gap-4">
  <Tabs label="Forms" active={tab} onChange={setTab} tabs={[{key:'complete',label:'Complete a form'},{key:'submissions',label:'Submissions'},{key:'templates',label:'Templates',hidden:!session.can('forms.manage')}]}/>
  {tab==='complete'&&<FormLauncher context={company} hint="Company-level forms. Project and shift forms are completed from the project's Quality & HSEQ tab or the shift."/>}
  {tab==='submissions'&&<SubmissionList/>}
  {tab==='templates'&&<TemplateManager/>}
 </div>;
}

/** Project → Quality & HSEQ: complete forms against the project and see its evidence. */
export function ProjectForms({projectId,projectName='this project'}:{projectId:string;projectName?:string}){
 const session=useSession();
 const ctx:FormsContext={type:'project',id:projectId,label:projectName,projectId};
 const [tick,setTick]=useState(0);
 if(!session.can('forms.view')||!session.module('ims'))return null;
 return <div className="grid gap-4"><FormLauncher context={ctx} onSubmitted={()=>setTick(t=>t+1)}/><SubmissionList key={tick} context={ctx}/></div>;
}

/** Reusable launcher: pick a published form and complete it in the given context. */
export function FormLauncher({context,hint,onSubmitted}:{context:FormsContext;hint?:string;onSubmitted?:()=>void}){
 const session=useSession(),allowed=session.can('forms.submit')&&session.module('ims');
 const {data,error,loading,refresh}=useApi<TemplateList>(allowed?'/api/forms?op=templates':null);
 const [open,setOpen]=useState<Template|null>(null),[done,setDone]=useState<string|null>(null);
 const available=(data?.templates||[]).filter(t=>t.status==='active'&&t.currentVersionId);
 if(!allowed)return null;
 return <Section title="Forms" description={hint||`Complete a form for ${CONTEXT_LABEL[context.type].toLowerCase()} ${context.label}.`}>
  <ErrorState error={error} onRetry={refresh}/>
  {done&&<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Form submitted. <button className="underline" onClick={()=>setDone(null)}>Dismiss</button></p>}
  {loading&&!data?<Loading/>:!available.length?<EmptyState title="No published forms yet." detail={data?.canManage?'Create and publish a form in IMS & HSEQ → Forms → Templates.':'Ask your HSEQ manager to publish the forms you need.'}/>:
   <ul className="grid gap-2 sm:grid-cols-2">{available.map(t=><li key={t.id}><button onClick={()=>setOpen(t)} className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-white px-3 py-2 text-left hover:bg-slate-50"><ClipboardCheck aria-hidden className="size-5 shrink-0 text-slate-500"/><span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.name}</span><span className="block text-xs text-slate-500">{t.category} · v{t.currentVersionNumber}</span></span></button></li>)}</ul>}
  <Sheet open={!!open} onOpenChange={o=>{if(!o)setOpen(null);}}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
   <SheetTitle className="px-5 pt-5">{open?.name}</SheetTitle><SheetDescription className="px-5">{CONTEXT_LABEL[context.type]}: {context.label}</SheetDescription>
   {open&&<FormFill templateId={open.id} context={context} onDone={id=>{setOpen(null);setDone(id);onSubmitted?.();}}/>}
  </SheetContent></Sheet>
 </Section>;
}

function FormFill({templateId,context,onDone}:{templateId:string;context:FormsContext;onDone:(id:string)=>void}){
 const {data,error,loading}=useApi<TemplateDetail>(`/api/forms?op=template&id=${encodeURIComponent(templateId)}`);
 const [values,setValues]=useState<Answers>({});const {busy,error:saveError,run}=useAction();
 const version=data?.current;
 if(loading&&!data)return <div className="p-5"><Loading/></div>;
 if(!version?.schema)return <div className="p-5"><ErrorState error={error}/></div>;
 return <form className="grid gap-4 p-5" onSubmit={e=>{e.preventDefault();void run(()=>api<{id:string}>('/api/forms',{method:'POST',body:{action:'submit',templateId,versionId:version.id,contextType:context.type,contextId:context.id,responses:values,clientSubmittedAt:new Date().toISOString()}}),r=>onDone(r.id));}}>
  <FormRenderer schema={version.schema} values={values} onChange={setValues} evidence={{type:context.type,id:context.id}}/>
  <ErrorState error={saveError}/>
  <div className="sticky bottom-0 -mx-5 border-t bg-white px-5 py-3"><Btn type="submit" busy={busy} className="min-h-12 w-full sm:w-auto">Submit form</Btn><p className="mt-1 text-xs text-slate-500">Submitted forms are kept as evidence. Mistakes are fixed with a recorded correction.</p></div>
 </form>;
}

// ---------------------------------------------------------------- renderer
type Options={people:Array<{id:string;name:string}>;assets:Array<{id:string;name:string}>};
let optionsCache:Promise<Options>|null=null;
function useFormOptions(needed:boolean){
 const [o,setO]=useState<Options>({people:[],assets:[]});
 useEffect(()=>{if(!needed)return;optionsCache??=api<Options>('/api/forms?op=options').catch(()=>{optionsCache=null;return {people:[],assets:[]};});let live=true;void optionsCache.then(x=>{if(live)setO(x);});return()=>{live=false;};},[needed]);
 return o;
}
export function FormRenderer({schema,values,onChange,evidence,readOnly,labels}:{schema:FormSchema;values:Answers;onChange?:(v:Answers)=>void;evidence:EvidenceContext|null;readOnly?:boolean;labels?:Labels}){
 const visible=useMemo(()=>visibleFields(schema,values),[schema,values]);
 const needsOptions=!readOnly&&allFields(schema).some(f=>f.type==='person'||f.type==='asset');
 const options=useFormOptions(needsOptions);
 const set=(id:string,v:unknown)=>onChange?.({...values,[id]:v});
 return <div className="grid gap-5">{schema.sections.map(s=>{
  const fields=s.fields.filter(f=>visible.has(f.id));if(!fields.length)return null;
  return <fieldset key={s.id} className="grid gap-4 rounded-lg border p-3 sm:p-4"><legend className="px-1 text-sm font-semibold">{s.title}</legend>
   {fields.map(f=><FieldInput key={f.id} f={f} value={values[f.id]} onChange={v=>set(f.id,v)} options={options} evidence={evidence} readOnly={readOnly} labels={labels}/>)}
  </fieldset>;})}</div>;
}

function FieldInput({f,value,onChange,options,evidence,readOnly,labels}:{f:FormField;value:unknown;onChange:(v:unknown)=>void;options:Options;evidence:EvidenceContext|null;readOnly?:boolean;labels?:Labels}){
 if(readOnly)return <div className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{f.label}</span><div className="text-slate-900">{isAnswered(value)?<ReadValue f={f} value={value} labels={labels}/>:<span className="text-slate-400">Not answered</span>}</div></div>;
 const str=value==null?'':String(value);
 switch(f.type){
  case 'text':return <Field label={f.label} hint={f.help||undefined} required={f.required}><input className={field} value={str} maxLength={500} onChange={e=>onChange(e.target.value)}/></Field>;
  case 'textarea':return <Field label={f.label} hint={f.help||undefined} required={f.required}><textarea className={`${field} min-h-24`} value={str} maxLength={5000} onChange={e=>onChange(e.target.value)}/></Field>;
  case 'number':return <Field label={f.label} hint={f.help||undefined} required={f.required}><input className={field} type="number" inputMode="decimal" step="any" min={f.min??undefined} max={f.max??undefined} value={str} onChange={e=>onChange(e.target.value===''?null:Number(e.target.value))}/></Field>;
  case 'date':return <Field label={f.label} hint={f.help||undefined} required={f.required}><input className={field} type="date" value={str} onChange={e=>onChange(e.target.value||null)}/></Field>;
  case 'datetime':return <Field label={f.label} hint={f.help||undefined} required={f.required}><input className={field} type="datetime-local" value={str.slice(0,16)} onChange={e=>onChange(e.target.value||null)}/></Field>;
  case 'boolean':return <div role="radiogroup" aria-label={f.label} className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{f.label}{f.required&&<span aria-hidden className="text-red-600"> *</span>}</span>{f.help&&<span className="text-xs text-slate-500">{f.help}</span>}<span className="flex gap-2">{[true,false].map(b=><button type="button" role="radio" aria-checked={value===b} key={String(b)} onClick={()=>onChange(value===b?null:b)} className={`min-h-12 flex-1 rounded-lg border px-4 font-medium ${value===b?(b?'border-emerald-600 bg-emerald-50 text-emerald-900':'border-red-600 bg-red-50 text-red-900'):'bg-white'}`}>{b?'Yes':'No'}</button>)}</span></div>;
  case 'checkbox':return <label className="flex min-h-12 items-start gap-3 rounded-lg border bg-white p-3 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={value===true} onChange={e=>onChange(e.target.checked)}/><span><span className="font-medium">{f.label}</span>{f.required&&<span aria-hidden className="text-red-600"> *</span>}{f.help&&<span className="block text-xs text-slate-500">{f.help}</span>}</span></label>;
  case 'select':return <Field label={f.label} hint={f.help||undefined} required={f.required}><select className={field} value={str} onChange={e=>onChange(e.target.value||null)}><option value="">Select…</option>{f.options!.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
  case 'multiselect':{const cur=Array.isArray(value)?value as string[]:[];return <fieldset className="grid gap-1 text-sm"><legend className="font-medium text-slate-700">{f.label}{f.required&&<span aria-hidden className="text-red-600"> *</span>}</legend>{f.options!.map(o=><label key={o.value} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={cur.includes(o.value)} onChange={e=>onChange(e.target.checked?[...cur,o.value]:cur.filter(x=>x!==o.value))}/>{o.label}</label>)}</fieldset>;}
  case 'person':return <Field label={f.label} hint={f.help||undefined} required={f.required}><select className={field} value={str} onChange={e=>onChange(e.target.value||null)}><option value="">Choose a person…</option>{options.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
  case 'asset':return <Field label={f.label} hint={f.help||undefined} required={f.required}><select className={field} value={str} onChange={e=>onChange(e.target.value||null)}><option value="">Choose plant…</option>{options.assets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
  case 'location':{const v=value as (LocationInput&{locationId?:string})|null;return v?.locationId?<div className="grid gap-1 text-sm"><span className="font-medium text-slate-700">{f.label}</span><LocationSummary location={labels?.locations[v.locationId]??null}/><Btn type="button" variant="ghost" className="justify-self-start" onClick={()=>onChange(null)}>Change location</Btn></div>:<AddressLocationPicker label={f.label} mode="compact" value={v??null} onChange={l=>onChange(l)} hint={f.help||undefined}/>;}
  case 'photo':case 'file':return <UploadField f={f} value={Array.isArray(value)?value as string[]:[]} onChange={onChange} evidence={evidence} labels={labels}/>;
  case 'signature':return <SignatureField f={f} value={value as SignatureValue|null} onChange={onChange} evidence={evidence}/>;
 }
}

function ReadValue({f,value,labels}:{f:FormField;value:unknown;labels?:Labels}){
 switch(f.type){
  case 'boolean':case 'checkbox':return <>{value?'Yes':'No'}</>;
  case 'select':return <>{f.options?.find(o=>o.value===value)?.label??String(value)}</>;
  case 'multiselect':return <>{(value as string[]).map(v=>f.options?.find(o=>o.value===v)?.label??v).join(', ')}</>;
  case 'person':return <>{labels?.people[String(value)]??'Person'}</>;
  case 'asset':return <>{labels?.assets[String(value)]??'Plant'}</>;
  case 'datetime':return <>{String(value).replace('T',' ')}</>;
  case 'location':return <LocationSummary location={labels?.locations[(value as {locationId:string}).locationId]??null} compact/>;
  case 'photo':case 'file':return <ul className="grid gap-1">{(value as string[]).map(d=>{const doc=labels?.documents[d];return <li key={d}>{doc?<a className="text-sky-700 underline" href={doc.url} target="_blank" rel="noreferrer">{doc.title}</a>:'File'}</li>;})}</ul>;
  case 'signature':{const s=value as SignatureValue;const doc=s.documentId?labels?.documents[s.documentId]:null;return <span className="grid gap-1"><span>Signed by <strong>{s.name}</strong>{s.signerUserId&&labels?.people[s.signerUserId]&&labels.people[s.signerUserId]!==s.name?` (recorded by ${labels.people[s.signerUserId]})`:''}{s.signedAt?` · ${dateText(s.signedAt)} ${s.signedAt.slice(11,16)} UTC`:''}</span>{doc&&<a className="text-sky-700 underline" href={doc.url} target="_blank" rel="noreferrer">View drawn signature</a>}</span>;}
  default:return <span className="whitespace-pre-wrap">{String(value)}</span>;
 }
}

/** Forms evidence goes to the controlled Forms document context for this exact form context (IMS, not Field). */
async function uploadFile(file:File|Blob,name:string,evidence:EvidenceContext|null){
 if(!evidence)throw new Error('Files can be attached when completing or correcting a form.');
 const form=new FormData();form.set('file',file instanceof File?file:new File([file],name,{type:'image/png'}));form.set('contextType',evidence.type);form.set('contextId',evidence.id);
 return (await api<{document:{id:string;title:string}}>('/api/forms/evidence',{method:'POST',body:form})).document;
}
function UploadField({f,value,onChange,evidence,labels}:{f:FormField;value:string[];onChange:(v:unknown)=>void;evidence:EvidenceContext|null;labels?:Labels}){
 const [names,setNames]=useState<Record<string,string>>({});const {busy,error,run}=useAction();
 return <div className="grid gap-2 text-sm"><span className="font-medium text-slate-700">{f.label}{f.required&&<span aria-hidden className="text-red-600"> *</span>}</span>{f.help&&<span className="text-xs text-slate-500">{f.help}</span>}
  {value.length>0&&<ul className="grid gap-1">{value.map(d=><li key={d} className="flex items-center gap-2 rounded border bg-white px-2 py-1"><span className="min-w-0 flex-1 truncate">{names[d]||labels?.documents[d]?.title||'Uploaded file'}</span><button type="button" aria-label="Remove file" className="rounded p-2 hover:bg-slate-100" onClick={()=>onChange(value.filter(x=>x!==d))}><Trash2 aria-hidden className="size-4"/></button></li>)}</ul>}
  <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 justify-self-start rounded-lg border bg-white px-4 font-medium hover:bg-slate-50"><Upload aria-hidden className="size-4"/>{busy?'Uploading…':f.type==='photo'?'Take or add photo':'Attach file'}<input type="file" className="sr-only" accept={f.type==='photo'?'image/*':undefined} capture={f.type==='photo'?'environment':undefined} disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(()=>uploadFile(file,file.name,evidence),doc=>{setNames(n=>({...n,[doc.id]:doc.title}));onChange([...value,doc.id]);});}}/></label>
  <ErrorState error={error}/>
 </div>;
}

function SignatureField({f,value,onChange,evidence}:{f:FormField;value:SignatureValue|null;onChange:(v:unknown)=>void;evidence:EvidenceContext|null}){
 const canvas=useRef<HTMLCanvasElement>(null),drawing=useRef(false),[drawn,setDrawn]=useState(false);const {busy,error,run}=useAction();
 const name=value?.name||'',confirmed=value?.confirmed===true;
 const update=(patch:{name?:string;confirmed?:boolean;documentId?:string|null})=>{const next={name,confirmed,documentId:value?.documentId??null,...patch};onChange(next.name||next.confirmed||next.documentId?next:null);};
 const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return [(e.clientX-r.left)*(e.currentTarget.width/r.width),(e.clientY-r.top)*(e.currentTarget.height/r.height)] as const;};
 return <div className="grid gap-2 rounded-lg border bg-white p-3 text-sm"><span className="font-medium text-slate-700">{f.label}{f.required&&<span aria-hidden className="text-red-600"> *</span>}</span>
  <Field label="Full name"><input className={field} value={name} maxLength={160} autoComplete="name" onChange={e=>update({name:e.target.value})}/></Field>
  <div><canvas ref={canvas} width={600} height={160} aria-label="Draw signature (optional)" className="h-28 w-full touch-none rounded border border-dashed bg-slate-50"
   onPointerDown={e=>{drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const c=e.currentTarget.getContext('2d')!;const [x,y]=point(e);c.lineWidth=3;c.lineCap='round';c.beginPath();c.moveTo(x,y);}}
   onPointerMove={e=>{if(!drawing.current)return;const c=e.currentTarget.getContext('2d')!;const [x,y]=point(e);c.lineTo(x,y);c.stroke();setDrawn(true);}}
   onPointerUp={()=>{drawing.current=false;}}/>
   <span className="mt-1 flex flex-wrap gap-2">{drawn&&!value?.documentId&&<Btn type="button" variant="secondary" busy={busy} onClick={()=>void run(async()=>{const blob=await new Promise<Blob|null>(r=>canvas.current!.toBlob(r,'image/png'));if(!blob)throw new Error('Could not capture the drawing.');return uploadFile(blob,`Signature — ${name||'signer'}.png`,evidence);},doc=>update({documentId:doc.id}))}>Attach drawing</Btn>}{(drawn||value?.documentId)&&<Btn type="button" variant="ghost" onClick={()=>{canvas.current?.getContext('2d')?.clearRect(0,0,600,160);setDrawn(false);update({documentId:null});}}>Clear drawing</Btn>}{value?.documentId&&<Pill tone="success">Drawing attached</Pill>}</span></div>
  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={confirmed} onChange={e=>update({confirmed:e.target.checked})}/>I confirm this record is accurate.</label>
  <p className="text-xs text-slate-500">Your account and the time are recorded with this signature. This is an operational sign-off, not a certified digital signature.</p>
  <ErrorState error={error}/>
 </div>;
}

// ---------------------------------------------------------------- submissions
export function SubmissionList({context}:{context?:FormsContext}){
 const url=`/api/forms?op=submissions${context?`&contextType=${context.type}&contextId=${encodeURIComponent(context.id)}`:''}`;
 const {data,error,loading,refresh}=useApi<{submissions:SubmissionRow[]}>(url);
 const [open,setOpen]=useState<string|null>(null);
 return <Section title="Submitted forms" description="Each submission is kept exactly as submitted, with any corrections recorded alongside.">
  <ErrorState error={error} onRetry={refresh}/>
  {loading&&!data?<Loading/>:!data?.submissions.length?<EmptyState title="No forms submitted yet."/>:
   <ul className="divide-y rounded-lg border">{data.submissions.map(s=><li key={s.id}><button onClick={()=>setOpen(s.id)} className="flex min-h-14 w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"><span className="min-w-0 flex-1"><span className="block font-medium">{s.templateName} <span className="text-xs font-normal text-slate-500">v{s.versionNumber}</span></span><span className="block text-xs text-slate-500">{[CONTEXT_LABEL[s.contextType],s.projectName,s.submittedByName,`${dateText(s.submittedAt)} ${s.submittedAt.slice(11,16)} UTC`].filter(Boolean).join(' · ')}</span></span>{s.amendments>0&&<Pill tone="warning">{s.amendments} correction{s.amendments===1?'':'s'}</Pill>}</button></li>)}</ul>}
  <Sheet open={!!open} onOpenChange={o=>{if(!o){setOpen(null);refresh();}}}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">{open&&<SubmissionView id={open}/>}</SheetContent></Sheet>
 </Section>;
}

function SubmissionView({id}:{id:string}){
 const {data,error,loading,refresh}=useApi<SubmissionDetail>(`/api/forms?op=submission&id=${encodeURIComponent(id)}`);
 const [view,setView]=useState<string>('effective'),[amending,setAmending]=useState(false);
 if(loading&&!data)return <div className="p-5"><Loading/></div>;
 if(!data)return <div className="p-5"><ErrorState error={error}/></div>;
 const s=data.submission,shown=view==='effective'?data.effective:view==='original'?data.original:data.amendments.find(a=>String(a.sequence)===view)?.responses||data.effective;
 const changed=view==='effective'?new Set(data.amendments.flatMap(a=>a.changedFields)):new Set(data.amendments.find(a=>String(a.sequence)===view)?.changedFields||[]);
 return <div className="grid gap-4 p-5">
  <SheetTitle>{s.templateName} <span className="text-sm font-normal text-slate-500">v{s.versionNumber}</span></SheetTitle>
  <SheetDescription>{CONTEXT_LABEL[s.contextType]}: {s.contextLabel} · submitted by {s.submittedByName||'a team member'} on {dateText(s.submittedAt)} {s.submittedAt.slice(11,16)} UTC</SheetDescription>
  {data.amendments.length>0&&<div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><History aria-hidden className="size-4"/>Correction history</p>
   <label className="grid gap-1"><span className="text-xs text-slate-600">Show</span><select className={field} value={view} onChange={e=>setView(e.target.value)}><option value="effective">Current corrected record</option><option value="original">Original submission (as submitted)</option>{data.amendments.map(a=><option key={a.id} value={String(a.sequence)}>Correction {a.sequence} — {dateText(a.amendedAt)}</option>)}</select></label>
   <ol className="grid gap-1">{data.amendments.map(a=><li key={a.id}>Correction {a.sequence} by {a.amendedByName||'a team member'} on {dateText(a.amendedAt)}: <em>{a.reason}</em> <span className="text-xs text-slate-500">({a.changedFields.length} field{a.changedFields.length===1?'':'s'} changed)</span></li>)}</ol>
  </div>}
  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{view==='original'?'Original submission — unchanged evidence':view==='effective'?(data.amendments.length?'Current corrected record':'Submitted record'):`As corrected in correction ${view}`}</p>
  {amending?<AmendForm data={data} onDone={()=>{setAmending(false);setView('effective');refresh();}} onCancel={()=>setAmending(false)}/>:<>
   <FormRenderer schema={data.schema} values={shown} evidence={null} readOnly labels={data.labels}/>
   {changed.size>0&&view!=='original'&&<p className="text-xs text-amber-800">Corrected fields: {allFields(data.schema).filter(f=>changed.has(f.id)).map(f=>f.label).join(', ')}</p>}
   {data.canAmend&&<Btn variant="secondary" className="justify-self-start" onClick={()=>setAmending(true)}><PenLine aria-hidden className="size-4"/>Correct this record</Btn>}
  </>}
 </div>;
}
function AmendForm({data,onDone,onCancel}:{data:SubmissionDetail;onDone:()=>void;onCancel:()=>void}){
 const [values,setValues]=useState<Answers>(data.effective),[reason,setReason]=useState('');const {busy,error,run}=useAction();
 return <form className="grid gap-4" onSubmit={e=>{e.preventDefault();void run(()=>api('/api/forms',{method:'POST',body:{action:'amend',id:data.submission.id,responses:values,reason}}),onDone);}}>
  <p className="rounded-lg bg-slate-50 p-3 text-sm">The original submission is kept unchanged. Your correction is added to the record&apos;s history with your name, the time and the reason.</p>
  <FormRenderer schema={data.schema} values={values} onChange={setValues} evidence={{type:data.submission.contextType,id:data.submission.contextId}} labels={data.labels}/>
  <Field label="Reason for correction" required><textarea className={`${field} min-h-20`} required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
  <ErrorState error={error}/>
  <div className="flex flex-wrap gap-2"><Btn type="submit" busy={busy} disabled={reason.trim().length<3}>Save correction</Btn><Btn type="button" variant="ghost" onClick={onCancel}>Cancel</Btn></div>
 </form>;
}

// ---------------------------------------------------------------- templates (form managers)
function TemplateManager(){
 const {data,error,loading,refresh}=useApi<TemplateList>('/api/forms?op=templates');
 const [q,setQ]=useState(''),[open,setOpen]=useState<string|null>(null),[creating,setCreating]=useState(false);
 const rows=(data?.templates||[]).filter(t=>!q||`${t.name} ${t.category}`.toLowerCase().includes(q.toLowerCase()));
 return <Section title="Form templates" description="Published versions are locked. Changes are made in a new draft version and published when ready; submissions always keep the version they used." actions={<Btn onClick={()=>setCreating(true)}><FilePlus2 aria-hidden className="size-4"/>New form</Btn>}>
  <input type="search" aria-label="Search forms" placeholder="Search forms" className={`${field} mb-3`} value={q} onChange={e=>setQ(e.target.value)}/>
  <ErrorState error={error} onRetry={refresh}/>
  {creating&&<CreateTemplate onDone={id=>{setCreating(false);refresh();if(id)setOpen(id);}}/>}
  {loading&&!data?<Loading/>:!rows.length?<EmptyState title="No form templates yet."/>:
   <ul className="divide-y rounded-lg border">{rows.map(t=><li key={t.id}><button onClick={()=>setOpen(t.id)} className="flex min-h-14 w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"><span className="min-w-0 flex-1"><span className="block font-medium">{t.name}</span><span className="block text-xs text-slate-500">{t.category}</span></span>{t.status==='archived'&&<Pill>Archived</Pill>}{t.currentVersionNumber?<Pill tone="success">Published v{t.currentVersionNumber}</Pill>:<Pill tone="warning">Not published</Pill>}{t.draftVersionNumber&&<Pill tone="info">Draft v{t.draftVersionNumber}</Pill>}</button></li>)}</ul>}
  <Sheet open={!!open} onOpenChange={o=>{if(!o){setOpen(null);refresh();}}}><SheetContent className="w-full overflow-y-auto sm:max-w-3xl">{open&&<TemplateEditor id={open} onChanged={refresh}/>}</SheetContent></Sheet>
 </Section>;
}
function CreateTemplate({onDone}:{onDone:(id?:string)=>void}){
 const [name,setName]=useState(''),[category,setCategory]=useState<string>('Inspection'),[description,setDescription]=useState('');const {busy,error,run}=useAction();
 return <form className="mb-3 grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(()=>api<{id:string}>('/api/forms',{method:'POST',body:{action:'create',name,category,description}}),r=>onDone(r.id));}}>
  <Field label="Form name" required><input className={field} required value={name} onChange={e=>setName(e.target.value)} placeholder="Daily plant prestart"/></Field>
  <Field label="Category"><select className={field} value={category} onChange={e=>setCategory(e.target.value)}>{FORM_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
  <div className="sm:col-span-2"><Field label="Description"><input className={field} value={description} onChange={e=>setDescription(e.target.value)}/></Field></div>
  <ErrorState error={error}/>
  <div className="flex gap-2 sm:col-span-2"><Btn type="submit" busy={busy}>Create draft</Btn><Btn type="button" variant="ghost" onClick={()=>onDone()}>Cancel</Btn></div>
 </form>;
}

function TemplateEditor({id,onChanged}:{id:string;onChanged:()=>void}){
 const {data,error,loading,refresh}=useApi<TemplateDetail>(`/api/forms?op=template&id=${encodeURIComponent(id)}`);
 const {busy,error:actionError,run}=useAction();
 const [preview,setPreview]=useState<string|null>(null);
 const act=(body:Record<string,unknown>)=>void run(()=>api('/api/forms',{method:'POST',body:{id,...body}}),()=>{refresh();onChanged();});
 if(loading&&!data)return <div className="p-5"><Loading/></div>;
 if(!data)return <div className="p-5"><ErrorState error={error}/></div>;
 const t=data.template,archived=t.status==='archived';
 return <div className="grid gap-4 p-5">
  <SheetTitle>{t.name}</SheetTitle><SheetDescription>{t.category}{t.description?` · ${t.description}`:''}</SheetDescription>
  <div className="flex flex-wrap gap-2">
   {!archived&&!data.draft&&<Btn variant="secondary" busy={busy} onClick={()=>act({action:'revise'})}><Plus aria-hidden className="size-4"/>Start new revision</Btn>}
   {archived?<Btn variant="secondary" busy={busy} onClick={()=>act({action:'restore'})}>Restore</Btn>:<Btn variant="ghost" busy={busy} onClick={()=>act({action:'archive'})}>Archive</Btn>}
  </div>
  <ErrorState error={actionError}/>
  {archived&&<p className="rounded-lg bg-slate-50 p-3 text-sm">Archived forms cannot be completed. Every version and submission stays available.</p>}
  {data.draft&&!archived&&<FormBuilder key={`${data.draft.id}-${data.draft.revision}`} templateId={id} template={t} draft={data.draft} canPublish={data.canPublish} onSaved={()=>{refresh();onChanged();}}/>}
  <Section title="Versions">
   <ul className="divide-y rounded-lg border">{data.versions.map(v=><li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="font-medium">v{v.versionNumber}</span><Pill tone={v.status==='published'?'success':v.status==='draft'?'info':'neutral'}>{v.status==='published'?'Published (current)':v.status==='draft'?'Draft':'Superseded'}</Pill><span className="min-w-0 flex-1 text-xs text-slate-500">{[v.publishedAt&&`Published ${dateText(v.publishedAt)}`,v.changeReason].filter(Boolean).join(' · ')}</span>{v.status!=='draft'&&<Btn variant="ghost" className="min-h-9 py-1" onClick={()=>setPreview(preview===v.id?null:v.id)}><Eye aria-hidden className="size-4"/>{preview===v.id?'Hide':'View'}</Btn>}</li>)}</ul>
   {preview&&<VersionPreview id={preview}/>}
  </Section>
 </div>;
}
function VersionPreview({id}:{id:string}){
 const {data,error}=useApi<{version:Version}>(`/api/forms?op=version&id=${encodeURIComponent(id)}`);
 if(!data?.version.schema)return <ErrorState error={error}/>;
 return <div className="mt-3 rounded-lg border bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-500">v{data.version.versionNumber} is locked. This is exactly what was published.</p><FormRenderer schema={data.version.schema} values={{}} evidence={null} readOnly/></div>;
}

function FormBuilder({templateId,template,draft,canPublish,onSaved}:{templateId:string;template:Template;draft:Version;canPublish:boolean;onSaved:()=>void}){
 const [schema,setSchema]=useState<FormSchema>(draft.schema||emptySchema());
 const [name,setName]=useState(template.name),[category,setCategory]=useState(template.category),[description,setDescription]=useState(template.description||''),[reason,setReason]=useState(draft.changeReason||'');
 const [dirty,setDirty]=useState(false),[showPreview,setShowPreview]=useState(false),[previewValues,setPreviewValues]=useState<Answers>({});
 const {busy,error,run}=useAction();
 const problems=checkSchema(schema).errors;
 const change=(fn:(s:FormSchema)=>FormSchema)=>{setSchema(s=>fn(structuredClone(s)));setDirty(true);};
 const taken=new Set([...schema.sections.map(s=>s.id),...allFields(schema).map(f=>f.id)]);
 const save=()=>run(()=>api('/api/forms',{method:'POST',body:{action:'saveDraft',id:templateId,versionId:draft.id,revision:draft.revision,schema,name,category,description,changeReason:reason}}),()=>{setDirty(false);onSaved();});
 const move=<T,>(list:T[],i:number,d:number)=>{const j=i+d;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];};
 return <Section title={`Draft v${draft.versionNumber}`} description="Only this draft can be edited. Field ids stay fixed once created so historical answers keep their meaning.">
  <div className="grid gap-3 sm:grid-cols-2">
   <Field label="Form name" required><input className={field} value={name} onChange={e=>{setName(e.target.value);setDirty(true);}}/></Field>
   <Field label="Category"><select className={field} value={category} onChange={e=>{setCategory(e.target.value);setDirty(true);}}>{[...new Set([category,...FORM_CATEGORIES])].map(c=><option key={c}>{c}</option>)}</select></Field>
   <div className="sm:col-span-2"><Field label="Description"><input className={field} value={description} onChange={e=>{setDescription(e.target.value);setDirty(true);}}/></Field></div>
  </div>
  <div className="mt-4 grid gap-4">{schema.sections.map((s,si)=><div key={s.id} className="rounded-lg border p-3">
   <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Field label={`Section ${si+1} title`}><input className={field} value={s.title} onChange={e=>change(x=>{x.sections[si].title=e.target.value;return x;})}/></Field></div>
    <IconBtn label="Move section up" onClick={()=>change(x=>{move(x.sections,si,-1);return x;})}><ArrowUp className="size-4"/></IconBtn><IconBtn label="Move section down" onClick={()=>change(x=>{move(x.sections,si,1);return x;})}><ArrowDown className="size-4"/></IconBtn>
    <IconBtn label="Remove section" onClick={()=>change(x=>{x.sections.splice(si,1);return x;})}><Trash2 className="size-4"/></IconBtn></div>
   <ConditionEditor label="Show this section" condition={s.showIf??null} candidates={schema.sections.slice(0,si).flatMap(x=>x.fields)} onChange={c=>change(x=>{x.sections[si].showIf=c;return x;})}/>
   <ul className="mt-3 grid gap-2">{s.fields.map((f,fi)=><li key={f.id}><FieldEditor f={f} candidates={[...schema.sections.slice(0,si).flatMap(x=>x.fields),...s.fields.slice(0,fi)]}
    onChange={nf=>change(x=>{x.sections[si].fields[fi]=nf;return x;})}
    onMove={d=>change(x=>{move(x.sections[si].fields,fi,d);return x;})}
    onRemove={()=>change(x=>{x.sections[si].fields.splice(fi,1);return x;})}/></li>)}</ul>
   <AddField taken={taken} onAdd={nf=>change(x=>{x.sections[si].fields.push(nf);return x;})}/>
  </div>)}</div>
  <Btn variant="secondary" className="mt-3" onClick={()=>change(x=>{x.sections.push({id:fieldIdFrom('section',taken),title:`Section ${x.sections.length+1}`,fields:[]});return x;})}><Plus aria-hidden className="size-4"/>Add section</Btn>
  <div className="mt-4"><Field label="What changed in this version"><input className={field} value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);setDirty(true);}} placeholder="e.g. Added tyre condition check"/></Field></div>
  {problems.length>0&&<ul className="mt-3 list-disc rounded-lg bg-amber-50 p-3 pl-6 text-sm text-amber-900">{problems.slice(0,6).map(p=><li key={p}>{p}</li>)}</ul>}
  <ErrorState error={error}/>
  <div className="mt-3 flex flex-wrap gap-2">
   <Btn busy={busy} disabled={!dirty||problems.length>0} onClick={()=>void save()}>Save draft</Btn>
   <Btn variant="secondary" onClick={()=>{setShowPreview(p=>!p);setPreviewValues({});}}><Eye aria-hidden className="size-4"/>{showPreview?'Hide preview':'Preview'}</Btn>
   {canPublish&&<Btn variant="secondary" busy={busy} disabled={dirty||problems.length>0||!allFields(schema).length} onClick={()=>void run(()=>api('/api/forms',{method:'POST',body:{action:'publish',id:templateId,versionId:draft.id,changeReason:reason}}),onSaved)}>Publish v{draft.versionNumber}</Btn>}
  </div>
  {dirty&&<p className="mt-1 text-xs text-slate-500">Save the draft before publishing.</p>}
  {showPreview&&<div className="mt-4 rounded-lg border bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-500">Preview — answers here are not saved. Conditional fields appear as you answer.</p><FormRenderer schema={schema} values={previewValues} onChange={setPreviewValues} evidence={null}/></div>}
 </Section>;
}
function IconBtn({label,onClick,children}:{label:string;onClick:()=>void;children:React.ReactNode}){return <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-11 place-items-center rounded-lg border bg-white hover:bg-slate-50">{children}</button>;}

function AddField({taken,onAdd}:{taken:Set<string>;onAdd:(f:FormField)=>void}){
 const [type,setType]=useState<FieldType>('boolean'),[label,setLabel]=useState('');
 const add=()=>{if(!label.trim())return;const f:FormField={id:fieldIdFrom(label,taken),type,label:label.trim(),required:false};if(type==='select'||type==='multiselect')f.options=[{value:'option_1',label:'Option 1'}];onAdd(f);setLabel('');};
 return <div className="mt-3 grid gap-2 rounded-lg border border-dashed p-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
  <Field label="New field label"><input className={field} value={label} onChange={e=>setLabel(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}} placeholder="e.g. Is the plant safe to operate?"/></Field>
  <Field label="Type"><select className={field} value={type} onChange={e=>setType(e.target.value as FieldType)}>{FIELD_TYPES.map(t=><option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}</select></Field>
  <Btn type="button" variant="secondary" disabled={!label.trim()} onClick={add}><Plus aria-hidden className="size-4"/>Add field</Btn>
 </div>;
}
function FieldEditor({f,candidates,onChange,onMove,onRemove}:{f:FormField;candidates:FormField[];onChange:(f:FormField)=>void;onMove:(d:number)=>void;onRemove:()=>void}){
 const [open,setOpen]=useState(false);
 const set=(patch:Partial<FormField>)=>onChange({...f,...patch});
 return <div className="rounded-lg border bg-white">
  <div className="flex flex-wrap items-center gap-2 p-2"><button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={()=>setOpen(o=>!o)} aria-expanded={open}><span className="block font-medium">{f.label}{f.required&&<span className="text-red-600"> *</span>}</span><span className="block text-xs text-slate-500">{FIELD_TYPE_LABELS[f.type]} · id {f.id}{f.showIf?' · conditional':''}</span></button>
   <IconBtn label="Move field up" onClick={()=>onMove(-1)}><ArrowUp className="size-4"/></IconBtn><IconBtn label="Move field down" onClick={()=>onMove(1)}><ArrowDown className="size-4"/></IconBtn><IconBtn label="Remove field" onClick={onRemove}><Trash2 className="size-4"/></IconBtn></div>
  {open&&<div className="grid gap-3 border-t p-3">
   <Field label="Label"><input className={field} value={f.label} onChange={e=>set({label:e.target.value})}/></Field>
   <Field label="Help text"><input className={field} value={f.help||''} onChange={e=>set({help:e.target.value||null})}/></Field>
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={Boolean(f.required)} onChange={e=>set({required:e.target.checked})}/>Required{f.type==='checkbox'?' (must be ticked)':''}</label>
   {f.type==='number'&&<div className="grid grid-cols-2 gap-2"><Field label="Minimum"><input className={field} type="number" value={f.min??''} onChange={e=>set({min:e.target.value===''?null:Number(e.target.value)})}/></Field><Field label="Maximum"><input className={field} type="number" value={f.max??''} onChange={e=>set({max:e.target.value===''?null:Number(e.target.value)})}/></Field></div>}
   {(f.type==='select'||f.type==='multiselect')&&<OptionsEditor f={f} onChange={options=>set({options})}/>}
   <ConditionEditor label="Show this field" condition={f.showIf??null} candidates={candidates} onChange={c=>set({showIf:c})}/>
  </div>}
 </div>;
}
function OptionsEditor({f,onChange}:{f:FormField;onChange:(o:NonNullable<FormField['options']>)=>void}){
 const options=f.options||[],taken=new Set(options.map(o=>o.value));
 return <fieldset className="grid gap-2 text-sm"><legend className="font-medium text-slate-700">Options</legend>
  {options.map((o,i)=><div key={o.value} className="flex items-center gap-2"><input aria-label={`Option ${i+1} label`} className={field} value={o.label} onChange={e=>onChange(options.map((x,j)=>j===i?{...x,label:e.target.value}:x))}/><span className="hidden text-xs text-slate-400 sm:inline">{o.value}</span><IconBtn label="Remove option" onClick={()=>onChange(options.filter((_,j)=>j!==i))}><Trash2 className="size-4"/></IconBtn></div>)}
  <Btn type="button" variant="ghost" className="justify-self-start" onClick={()=>onChange([...options,{value:fieldIdFrom(`option ${options.length+1}`,taken),label:`Option ${options.length+1}`}])}><Plus aria-hidden className="size-4"/>Add option</Btn>
 </fieldset>;
}
function ConditionEditor({label,condition,candidates,onChange}:{label:string;condition:Condition|null;candidates:FormField[];onChange:(c:Condition|null)=>void}){
 const usable=candidates.filter(f=>!['photo','file','signature','location'].includes(f.type));
 if(!usable.length&&!condition)return null;
 const target=usable.find(f=>f.id===condition?.field);
 const valueOptions=target?.type==='boolean'||target?.type==='checkbox'?[{value:'true',label:'Yes'},{value:'false',label:'No'}]:target?.options||null;
 return <div className="mt-2 grid gap-2 rounded bg-slate-50 p-2 text-sm sm:grid-cols-3">
  <label className="grid gap-1"><span className="text-xs text-slate-600">{label}</span><select className={field} value={condition?.field||''} onChange={e=>onChange(e.target.value?{field:e.target.value,op:'eq',value:null}:null)}><option value="">Always</option>{usable.map(f=><option key={f.id} value={f.id}>when {f.label}</option>)}</select></label>
  {condition&&<label className="grid gap-1"><span className="text-xs text-slate-600">Rule</span><select className={field} value={condition.op} onChange={e=>onChange({...condition,op:e.target.value as Condition['op'],value:e.target.value==='answered'?null:e.target.value==='in'?[]:null})}>{CONDITION_OPS.map(o=><option key={o} value={o}>{CONDITION_LABELS[o]}</option>)}</select></label>}
  {condition&&condition.op!=='answered'&&<label className="grid gap-1"><span className="text-xs text-slate-600">Value</span>{valueOptions?(condition.op==='in'?<select multiple className={`${field} min-h-20`} value={Array.isArray(condition.value)?condition.value:[]} onChange={e=>onChange({...condition,value:[...e.target.selectedOptions].map(o=>o.value)})}>{valueOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<select className={field} value={String(condition.value??'')} onChange={e=>onChange({...condition,value:e.target.value||null})}><option value="">Select…</option>{valueOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>):<input className={field} value={Array.isArray(condition.value)?condition.value.join(', '):String(condition.value??'')} onChange={e=>onChange({...condition,value:condition.op==='in'?e.target.value.split(',').map(x=>x.trim()).filter(Boolean):e.target.value})}/>}</label>}
 </div>;
}
