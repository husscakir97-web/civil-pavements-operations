'use client';
// CRM bulk import and legacy linking UI. Import: template or the customer's own sheet →
// mapping → preview (create / update / possible duplicate / skip / error) → decisions →
// confirm. Legacy linking: links records whose client name matches exactly one client, and
// lets a person choose for the rest. Nothing changes before confirmation.
import {useMemo,useState} from 'react';
import {AlertTriangle,Download,FileSpreadsheet,Link2} from 'lucide-react';
import {api,useApi,useAction,ErrorState,Loading,Pill,Btn,field} from './kit';
import {ClientPicker} from './lookup';

type Kind='clients'|'contacts'|'sites';
type Action='create'|'update'|'skip'|'possible'|'error';
type PreviewRow={key:string;sheet:string;kind:Kind;rowNumber:number;label:string;client:string|null;action:Action;matchLabel:string|null;candidates:Array<{id:string;label:string}>;reasons:string[];errors:string[];warnings:string[]};
type Preview={fileName:string;sheets:Array<{name:string;kind:Kind;mapped:Array<{source:string;target:string|null}>;unmapped:string[];fields:Array<{key:string;label:string}>}>;rows:PreviewRow[];summary:Record<Action|'total',number>};
type Result={summary:{created:number;updated:number;skipped:number;possibleUnresolved:number;errors:number;total:number}};
const TONE:Record<Action,'success'|'info'|'warning'|'neutral'|'danger'>={create:'success',update:'info',possible:'warning',skip:'neutral',error:'danger'};
const LABEL:Record<Action,string>={create:'Create',update:'Update',possible:'Possible duplicate',skip:'Skip',error:'Error'};

export function CrmImporter({onImported}:{onImported:()=>void}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null);
 const [update,setUpdate]=useState(true),[mapping,setMapping]=useState<Record<string,Record<string,string>>>({}),[kinds,setKinds]=useState<Record<string,Kind>>({}),[decisions,setDecisions]=useState<Record<string,string>>({}),[dirty,setDirty]=useState(false),[filter,setFilter]=useState<Action|'all'>('all');
 const {busy,error,run}=useAction();
 const send=<T,>(mode:'preview'|'apply')=>{if(!file)return Promise.reject(new Error('Choose an .xlsx or .csv spreadsheet.'));const f=new FormData();f.set('file',file);f.set('mode',mode);f.set('updateExisting',String(update));f.set('mapping',JSON.stringify(mapping));f.set('sheetKinds',JSON.stringify(kinds));f.set('decisions',JSON.stringify(decisions));return api<T>('/api/platform/clients/import',{method:'POST',body:f});};
 const check=()=>void run(()=>send<Preview>('preview'),r=>{setPreview(r);setResult(null);setDirty(false);});
 const apply=()=>void run(()=>send<Result>('apply'),r=>{setResult(r);setPreview(null);onImported();});
 const reset=()=>{setPreview(null);setResult(null);setMapping({});setKinds({});setDecisions({});setDirty(false);};
 const rows=useMemo(()=>(preview?.rows||[]).filter(r=>filter==='all'||r.action===filter),[preview,filter]);
 const writes=preview?preview.summary.create+preview.summary.update:0;
 return <div>
  <div className="sticky top-0 z-10 border-b bg-white px-5 py-4"><h2 className="text-lg font-semibold">Import clients, contacts and sites</h2><p className="mt-1 text-sm text-slate-500">Use the template or upload your existing customer spreadsheet. Nothing changes until you confirm the preview.</p></div>
  <div className="grid gap-4 p-4 sm:p-5">
   <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
    <a className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50" href="/api/platform/clients/import?template=1"><Download aria-hidden className="size-4"/>Download template</a>
    <label className="grid gap-1 text-sm"><span className="font-medium text-slate-700">Spreadsheet (.xlsx or .csv)</span><input type="file" accept=".xlsx,.csv" className={field} onChange={e=>{setFile(e.target.files?.[0]||null);reset();}}/></label>
   </div>
   <label className="flex items-start gap-2 rounded-xl border bg-slate-50 p-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={update} onChange={e=>{setUpdate(e.target.checked);setDirty(true);}}/><span><strong>Update matching existing records</strong><span className="mt-0.5 block text-xs text-slate-500">Clients match on a valid ABN, client code, then exact name. Blank cells never overwrite.</span></span></label>
   <div><Btn busy={busy} disabled={!file} onClick={check}><FileSpreadsheet aria-hidden className="size-4"/>{preview?'Re-check preview':'Preview import'}</Btn></div>
   <ErrorState error={error}/>
   {preview&&<>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">{(['total','create','update','possible','skip','error'] as const).map(k=><button key={k} onClick={()=>setFilter(k==='total'?'all':k)} aria-pressed={filter===(k==='total'?'all':k)} className="rounded-xl border bg-white p-3 text-left shadow-sm aria-pressed:border-slate-900"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{k==='total'?'Rows':LABEL[k]}</p><p className={`mt-1 text-xl font-semibold ${k==='error'&&preview.summary.error?'text-red-700':k==='possible'&&preview.summary.possible?'text-amber-700':''}`}>{preview.summary[k]}</p></button>)}</div>
    <div className="grid gap-3">{preview.sheets.map(s=><div key={s.name} className="rounded-xl border p-3 text-sm">
     <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Sheet “{s.name}”</span><label className="flex items-center gap-2 text-xs">imports as<select className={`${field} min-h-9 w-auto py-1`} value={kinds[s.name]||s.kind} onChange={e=>{setKinds(k=>({...k,[s.name]:e.target.value as Kind}));setDirty(true);}}><option value="clients">Clients</option><option value="contacts">Contacts</option><option value="sites">Sites</option></select></label><span className="text-xs text-slate-500">{s.mapped.filter(m=>m.target).length} of {s.mapped.length} columns recognised</span></div>
     {s.unmapped.length>0&&<div className="mt-2 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 sm:grid-cols-2"><p className="flex items-center gap-1 text-xs font-medium text-amber-900 sm:col-span-2"><AlertTriangle aria-hidden className="size-3.5"/>Map the columns we did not recognise, or leave them ignored.</p>
      {s.unmapped.map(src=><label key={src} className="grid gap-1 text-xs"><span className="font-medium">{src}</span><select className={`${field} min-h-9 py-1`} value={mapping[s.name]?.[src]||''} onChange={e=>{setMapping(m=>({...m,[s.name]:{...(m[s.name]||{}),[src]:e.target.value}}));setDirty(true);}}><option value="">Ignore this column</option>{s.fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>)}</div>}
    </div>)}</div>
    <div className="max-h-[48dvh] overflow-auto rounded-xl border bg-white"><table className="w-full min-w-[640px] text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Row</th><th className="p-2">Record</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead><tbody className="divide-y">
     {rows.slice(0,300).map(r=><tr key={r.key} className="align-top"><td className="whitespace-nowrap p-2 text-slate-500">{r.sheet} {r.rowNumber}</td>
      <td className="p-2"><span className="font-medium">{r.label}</span><span className="block text-[10px] text-slate-500">{r.kind==='clients'?'Client':r.kind==='contacts'?'Contact':'Site'}{r.client?` · ${r.client}`:''}{r.matchLabel?` · matches ${r.matchLabel}`:''}</span></td>
      <td className="p-2"><Pill tone={TONE[r.action]}>{LABEL[r.action]}</Pill></td>
      <td className="p-2">{r.errors.map(e=><p key={e} className="text-red-700">{e}</p>)}{r.warnings.map(w=><p key={w} className="text-slate-500">{w}</p>)}
       {(r.action==='possible'||decisions[r.key])&&<div className="mt-1 grid gap-1"><p className="text-amber-800">{r.reasons.join(' · ')}{r.candidates.length?`: ${r.candidates.map(c=>c.label).join(', ')}`:''}</p>
        <select aria-label={`Decision for row ${r.rowNumber}`} className={`${field} min-h-9 py-1`} value={decisions[r.key]||''} onChange={e=>{setDecisions(d=>({...d,[r.key]:e.target.value}));setDirty(true);}}><option value="">Decide…</option>{r.candidates.map(c=><option key={c.id} value={`use:${c.id}`}>Use existing: {c.label}</option>)}<option value="create">Create new</option><option value="skip">Skip</option></select></div>}</td></tr>)}
    </tbody></table></div>
    {rows.length>300&&<p className="text-xs text-slate-500">Showing 300 of {rows.length} rows.</p>}
    <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-white py-3"><Btn busy={busy} disabled={dirty||!writes} onClick={apply}>{dirty?'Re-check the preview before importing':`Import ${writes} record${writes===1?'':'s'}`}</Btn>
     {(preview.summary.error>0||preview.summary.possible>0)&&<span className="text-xs text-slate-500">{preview.summary.error} error{preview.summary.error===1?'':'s'} and {preview.summary.possible} undecided duplicate{preview.summary.possible===1?'':'s'} will not be imported.</span>}</div>
   </>}
   {result&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-900">Import complete</p><p className="mt-1 text-sm text-emerald-800">{result.summary.created} created · {result.summary.updated} updated · {result.summary.skipped} skipped · {result.summary.possibleUnresolved} undecided duplicates · {result.summary.errors} errors</p></div>}
  </div>
 </div>;
}

type LegacyRow={table:'opportunities'|'tenders'|'jobs';type:string;id:string;title:string;clientName:string;status:'linked'|'ambiguous'|'none';clientId:string|null;candidates:Array<{id:string;name:string}>};
export function LegacyLinks({onChanged}:{onChanged:()=>void}){
 const {data,error,loading,refresh}=useApi<{summary:{linkable:number;ambiguous:number;unmatched:number};rows:LegacyRow[]}>('/api/platform/clients?view=legacy');
 const {busy,error:actionError,run}=useAction(),[choice,setChoice]=useState<Record<string,string>>({}),[done,setDone]=useState<string|null>(null);
 const post=(body:Record<string,unknown>,msg:string)=>void run(()=>api<{applied?:number}>('/api/platform/clients',{method:'POST',body}),r=>{setDone(msg.replace('{n}',String(r.applied??1)));refresh();onChanged();});
 return <div>
  <div className="sticky top-0 z-10 border-b bg-white px-5 py-4"><h2 className="text-lg font-semibold">Link old records to clients</h2><p className="mt-1 text-sm text-slate-500">Older opportunities, tenders and projects carry a client name but no client record. Only exact, unambiguous name matches link automatically; you choose the rest. The original text is always kept.</p></div>
  <div className="grid gap-4 p-5">
   <ErrorState error={error||actionError} onRetry={refresh}/>{done&&<p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p>}
   {loading&&!data?<Loading/>:data&&<>
    <div className="grid grid-cols-3 gap-2">{([['linkable','Safe to link'],['ambiguous','Several matches'],['unmatched','No match']] as const).map(([k,l])=><div key={k} className="rounded-xl border bg-white p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{l}</p><p className="mt-1 text-xl font-semibold">{data.summary[k]}</p></div>)}</div>
    {data.summary.linkable>0&&<div><Btn busy={busy} onClick={()=>post({action:'linkLegacy',apply:true},'{n} records linked.')}><Link2 aria-hidden className="size-4"/>Link {data.summary.linkable} exact match{data.summary.linkable===1?'':'es'}</Btn></div>}
    {data.rows.filter(r=>r.status!=='linked').length>0&&<ul className="divide-y rounded-xl border">{data.rows.filter(r=>r.status!=='linked').slice(0,100).map(r=><li key={r.table+r.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
     <span className="min-w-0"><span className="block font-medium">{r.title||r.type}</span><span className="block text-xs text-slate-500">{r.type} · Client not linked — recorded as “{r.clientName}”{r.status==='ambiguous'?` · ${r.candidates.length} possible clients`:''}</span></span>
     <ClientPicker label="Choose matching client" value={choice[r.id]||null} onChange={c=>setChoice(x=>({...x,[r.id]:c?.id||''}))}/>
     <Btn variant="secondary" busy={busy} disabled={!choice[r.id]} onClick={()=>post({action:'linkRecord',type:r.table,id:r.id,clientId:choice[r.id]},'Record linked.')}>Link</Btn>
    </li>)}</ul>}
    {!data.summary.linkable&&!data.summary.ambiguous&&!data.summary.unmatched&&<p className="text-sm text-slate-600">Every record with a client name is linked to a client.</p>}
   </>}
  </div>
 </div>;
}
